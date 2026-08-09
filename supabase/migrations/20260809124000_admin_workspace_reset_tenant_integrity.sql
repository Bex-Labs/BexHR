-- ============================================================
-- BexHR August 2026 release
-- Capture tenant ownership repairs and Reset Workspace RPC
-- ============================================================

-- ------------------------------------------------------------
-- 1. leave_requests tenant ownership
-- ------------------------------------------------------------

alter table public.leave_requests
    add column if not exists tenant_id uuid;

-- Backfill through the existing authoritative leave-employee resolver.
with resolved_leave_requests as (
    select
        lr.id as leave_request_id,
        resolved.tenant_id
    from public.leave_requests lr
    cross join lateral public.hrp_resolve_leave_employee(lr.employee_id) resolved
    where lr.tenant_id is null
)
update public.leave_requests lr
set tenant_id = resolved_leave_requests.tenant_id
from resolved_leave_requests
where lr.id = resolved_leave_requests.leave_request_id
  and resolved_leave_requests.tenant_id is not null;

-- Do not silently delete unresolved business records in a migration.
-- Stop so they can be reviewed explicitly before NOT NULL is enforced.
do $$
begin
    if exists (
        select 1
        from public.leave_requests
        where tenant_id is null
    ) then
        raise exception
            'BexHR migration stopped: one or more leave_requests rows could not resolve tenant ownership.';
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'leave_requests_tenant_id_fkey'
          and conrelid = 'public.leave_requests'::regclass
    ) then
        alter table public.leave_requests
            add constraint leave_requests_tenant_id_fkey
            foreign key (tenant_id)
            references public.tenants(id)
            on delete restrict;
    end if;
end;
$$;

alter table public.leave_requests
    alter column tenant_id set not null;

create index if not exists idx_leave_requests_tenant_id
    on public.leave_requests (tenant_id);


-- ------------------------------------------------------------
-- 2. employee_bank_details tenant ownership
-- ------------------------------------------------------------

alter table public.employee_bank_details
    add column if not exists tenant_id uuid;

-- Employee is authoritative for bank-detail tenant ownership.
update public.employee_bank_details bank_detail
set tenant_id = employee.tenant_id
from public.employees employee
where employee.id = bank_detail.employee_id
  and bank_detail.tenant_id is distinct from employee.tenant_id;

do $$
begin
    if exists (
        select 1
        from public.employee_bank_details
        where tenant_id is null
    ) then
        raise exception
            'BexHR migration stopped: one or more employee_bank_details rows could not resolve tenant ownership.';
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'employee_bank_details_tenant_id_fkey'
          and conrelid = 'public.employee_bank_details'::regclass
    ) then
        alter table public.employee_bank_details
            add constraint employee_bank_details_tenant_id_fkey
            foreign key (tenant_id)
            references public.tenants(id)
            on delete restrict;
    end if;
end;
$$;

alter table public.employee_bank_details
    alter column tenant_id set not null;

create index if not exists idx_employee_bank_details_tenant_id
    on public.employee_bank_details (tenant_id);

create or replace function public.set_employee_bank_details_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    resolved_tenant_id uuid;
begin

    select e.tenant_id
    into resolved_tenant_id
    from public.employees e
    where e.id = new.employee_id;

    if resolved_tenant_id is null then
        raise exception
            'Employee Bank Details could not resolve tenant ownership for employee %.',
            new.employee_id;
    end if;

    new.tenant_id := resolved_tenant_id;

    return new;

end;
$function$;

drop trigger if exists trg_set_employee_bank_details_tenant
    on public.employee_bank_details;

create trigger trg_set_employee_bank_details_tenant
before insert or update of employee_id, tenant_id
on public.employee_bank_details
for each row
execute function public.set_employee_bank_details_tenant();


-- ------------------------------------------------------------
-- 3. Platform Admin Reset Workspace RPC
-- Exact live function captured from the linked BexHR database.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reset_tenant_workspace(target_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor_user_id uuid;
    v_actor_role text;

    v_tenant_id uuid;
    v_company_name text;

    v_employee_count_before integer := 0;
    v_employee_count_after integer := 0;

    v_rows integer := 0;

    v_counts jsonb := '{}'::jsonb;

begin

    -- ========================================================
    -- 1. AUTHENTICATED CALLER
    -- ========================================================

    v_actor_user_id := auth.uid();

    if v_actor_user_id is null then
        raise exception
            'Reset Workspace requires an authenticated Platform Admin.';
    end if;


    -- ========================================================
    -- 2. PLATFORM ADMIN AUTHORIZATION
    --
    -- Frontend role state is not trusted.
    -- ========================================================

    select lower(trim(coalesce(p.role, '')))
    into v_actor_role
    from public.profiles p
    where p.id = v_actor_user_id;

    if coalesce(v_actor_role, '') <> 'admin' then
        raise exception
            'Only a Platform Admin can reset a company workspace.';
    end if;


    -- ========================================================
    -- 3. VALIDATE + LOCK TARGET COMPANY
    -- ========================================================

    select
        t.id,
        t.company_name
    into
        v_tenant_id,
        v_company_name
    from public.tenants t
    where t.id = target_tenant_id
    for update;

    if v_tenant_id is null then
        raise exception
            'The selected company could not be found.';
    end if;


    -- ========================================================
    -- 4. EMPLOYEE CONTROL TOTAL BEFORE RESET
    --
    -- Employees themselves MUST survive.
    -- ========================================================

    select count(*)
    into v_employee_count_before
    from public.employees e
    where e.tenant_id = v_tenant_id;


    -- ========================================================
    -- LEAVE / MANAGER DATA
    -- ========================================================

    delete from public.manager_leave_decision_authority_audit
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'manager_leave_decision_authority_audit',
            v_rows
        );


    delete from public.manager_leave_delegations
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'manager_leave_delegations',
            v_rows
        );


    -- leave_request_events cascade automatically through
    -- leave_requests.leave_request_id relationship.
    delete from public.leave_requests
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'leave_requests',
            v_rows
        );


    delete from public.employee_leave_balances elb
    where exists (
        select 1
        from public.employees e
        where e.id = elb.employee_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_leave_balances',
            v_rows
        );


    -- ========================================================
    -- PAYSLIP / PAYROLL DATA
    -- ========================================================

    delete from public.payslip_email_logs pel
    where exists (
        select 1
        from public.employees e
        where e.id = pel.employee_id
          and e.tenant_id = v_tenant_id
    )
    or exists (
        select 1
        from public.payroll_records pr
        join public.employees e
          on e.id = pr.employee_id
        where pr.id = pel.payroll_record_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payslip_email_logs',
            v_rows
        );


    delete from public.payroll_employee_overrides peo
    where exists (
        select 1
        from public.payroll_master_records pm
        join public.employees e
          on e.id = pm.employee_id
        where pm.id = peo.payroll_master_record_id
          and e.tenant_id = v_tenant_id
    )
    or exists (
        select 1
        from public.employees e
        where e.id = peo.employee_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_employee_overrides',
            v_rows
        );


    delete from public.payroll_allowance_components pac
    where exists (
        select 1
        from public.payroll_master_records pm
        join public.employees e
          on e.id = pm.employee_id
        where pm.id = pac.payroll_master_record_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_allowance_components',
            v_rows
        );


    delete from public.payroll_other_deductions pod
    where exists (
        select 1
        from public.payroll_master_records pm
        join public.employees e
          on e.id = pm.employee_id
        where pm.id = pod.payroll_master_record_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_other_deductions',
            v_rows
        );


    delete from public.payroll_statutory_deductions psd
    where exists (
        select 1
        from public.payroll_master_records pm
        join public.employees e
          on e.id = pm.employee_id
        where pm.id = psd.payroll_master_record_id
          and e.tenant_id = v_tenant_id
    )
    or exists (
        select 1
        from public.payroll_grade_levels pgl
        where pgl.id = psd.payroll_grade_level_id
          and pgl.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_statutory_deductions',
            v_rows
        );


    delete from public.payroll_records pr
    where exists (
        select 1
        from public.employees e
        where e.id = pr.employee_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_records',
            v_rows
        );


    delete from public.payroll_master_records pm
    where exists (
        select 1
        from public.employees e
        where e.id = pm.employee_id
          and e.tenant_id = v_tenant_id
    );

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_master_records',
            v_rows
        );


    delete from public.payroll_grade_levels
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'payroll_grade_levels',
            v_rows
        );


    -- ========================================================
    -- EMPLOYEE SUPPLEMENTARY / OPERATIONAL DATA
    --
    -- Employee rows themselves remain.
    -- ========================================================

    delete from public.employee_bank_details
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_bank_details',
            v_rows
        );


    delete from public.employee_documents
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_documents',
            v_rows
        );


    delete from public.employee_profile_correction_requests
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_profile_correction_requests',
            v_rows
        );


    delete from public.employee_reporting_lines
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_reporting_lines',
            v_rows
        );


    delete from public.employee_addresses
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_addresses',
            v_rows
        );


    delete from public.employee_dependants
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_dependants',
            v_rows
        );


    delete from public.employee_education_records
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_education_records',
            v_rows
        );


    delete from public.employee_next_of_kin
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'employee_next_of_kin',
            v_rows
        );


    -- ========================================================
    -- EMAIL OPERATIONAL DATA
    -- ========================================================

    delete from public.email_delivery_logs
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'email_delivery_logs',
            v_rows
        );


    delete from public.email_integration_test_recipients
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'email_integration_test_recipients',
            v_rows
        );


    -- ========================================================
    -- ADMINISTRATIVE AUDIT
    --
    -- PRESERVE.
    --
    -- administrative_audit_events has an immutable-history
    -- trigger and must never be deleted/bypassed by Reset.
    -- ========================================================

    select count(*)
    into v_rows
    from public.administrative_audit_events audit_event
    where audit_event.tenant_id = v_tenant_id;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'administrative_audit_events_preserved',
            v_rows
        );


    -- ========================================================
    -- ADMIN SECURITY AUDIT
    --
    -- PRESERVE.
    --
    -- IMPORTANT v1.0.2 FIX:
    -- Explicit table alias removes ambiguity between:
    --
    --   function argument: target_tenant_id
    --   table column:      target_tenant_id
    -- ========================================================

    select count(*)
    into v_rows
    from public.admin_security_audit_logs security_log
    where security_log.target_tenant_id = v_tenant_id;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'admin_security_audit_logs_preserved',
            v_rows
        );


    -- ========================================================
    -- ORGANISATION STRUCTURE
    --
    -- Job titles depend on departments, so delete job titles
    -- first.
    -- ========================================================

    delete from public.organization_job_titles
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'organization_job_titles',
            v_rows
        );


    delete from public.organization_departments
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'organization_departments',
            v_rows
        );


    -- ========================================================
    -- ORGANISATION SETTINGS
    --
    -- Company identity stays.
    --
    -- Restore operational payroll settings to the actual
    -- database defaults discovered earlier:
    --
    -- default_currency  = NGN
    -- default_pay_cycle = Monthly
    -- ========================================================

    update public.organization_settings
    set
        default_currency = 'NGN',
        default_pay_cycle = 'Monthly',
        payroll_contact_email = null,
        notes = null,
        updated_at = now(),
        updated_by = v_actor_user_id
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'organization_settings_reset',
            v_rows
        );


    -- ========================================================
    -- PRESERVED EMPLOYEES
    --
    -- Keep:
    --   employee UUID
    --   employee number
    --   names / identity
    --   contact identity
    --   tenant
    --   user/Auth linkage
    --
    -- Clear operational organisational/payroll assignments
    -- whose setup records were just reset.
    -- ========================================================

    update public.employees
    set
        department = null,
        job_title = null,
        line_manager = null,
        approver_email = null,
        employee_group = null,
        grade_level = null,
        updated_at = now()
    where tenant_id = v_tenant_id;


    -- ========================================================
    -- EMPLOYEE PRESERVATION ASSERTION
    --
    -- A reset must NEVER remove an employee.
    -- ========================================================

    select count(*)
    into v_employee_count_after
    from public.employees e
    where e.tenant_id = v_tenant_id;

    if v_employee_count_after <> v_employee_count_before then
        raise exception
            'Reset aborted because employee preservation validation failed.';
    end if;


    -- ========================================================
    -- SUCCESS
    -- ========================================================

    return jsonb_build_object(
        'success', true,
        'tenant_id', v_tenant_id,
        'company_name', v_company_name,
        'employees_preserved', v_employee_count_after,
        'reset_counts', v_counts,
        'message',
        format(
            'Workspace reset completed for %s. %s employee record(s) were preserved.',
            v_company_name,
            v_employee_count_after
        )
    );

end;
$function$;


-- Keep the destructive RPC unavailable to anonymous callers.
revoke all on function public.admin_reset_tenant_workspace(uuid) from public;
revoke all on function public.admin_reset_tenant_workspace(uuid) from anon;

grant execute on function public.admin_reset_tenant_workspace(uuid)
to authenticated;

grant execute on function public.admin_reset_tenant_workspace(uuid)
to service_role;
