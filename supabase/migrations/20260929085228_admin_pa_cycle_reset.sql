-- ============================================================
-- BexHR - PLATFORM ADMIN PA CYCLE CLEAR
--
-- Adds a PA-only destructive Admin action that:
--   - clears Performance Appraisal cycle/history records for
--     one selected tenant;
--   - preserves PA templates;
--   - preserves tenant/company identity;
--   - preserves employees, departments, reporting lines,
--     payroll, leave, email setup and all non-PA records;
--   - records the successful destructive action in the Admin
--     security audit log.
--
-- Also hardens Reset Workspace with an early PA preflight.
-- Reset Workspace does NOT clear PA automatically.
-- ============================================================


-- ============================================================
-- 1. CLEAR PA CYCLE RECORDS
-- ============================================================

create or replace function public.admin_clear_tenant_pa_cycle_records(
    target_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_actor_user_id uuid;
    v_actor_role text;
    v_actor_email text;

    v_tenant_id uuid;
    v_company_name text;

    v_rows integer := 0;
    v_total_deleted integer := 0;
    v_templates_preserved integer := 0;

    v_counts jsonb := '{}'::jsonb;
begin

    -- --------------------------------------------------------
    -- AUTHENTICATED PLATFORM ADMIN
    -- --------------------------------------------------------

    v_actor_user_id := auth.uid();

    if v_actor_user_id is null then
        raise exception
            'Clear PA Cycles requires an authenticated Platform Admin.';
    end if;

    select
        lower(trim(coalesce(p.role, ''))),
        nullif(trim(coalesce(p.email, '')), '')
    into
        v_actor_role,
        v_actor_email
    from public.profiles p
    where p.id = v_actor_user_id;

    if coalesce(v_actor_role, '') <> 'admin' then
        raise exception
            'Only a Platform Admin can clear Performance Appraisal cycle records.';
    end if;

    if v_actor_email is null then
        v_actor_email :=
            nullif(
                trim(
                    coalesce(
                        auth.jwt() ->> 'email',
                        ''
                    )
                ),
                ''
            );
    end if;


    -- --------------------------------------------------------
    -- VALIDATE + LOCK TARGET COMPANY
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- PA TEMPLATES ARE CONFIGURATION AND MUST SURVIVE
    -- --------------------------------------------------------

    select count(*)
    into v_templates_preserved
    from public.pa_templates template
    where template.tenant_id = v_tenant_id;


    -- --------------------------------------------------------
    -- DELETE PA RECORDS IN LIVE FK-SAFE ORDER
    -- --------------------------------------------------------

    delete from public.pa_employee_acknowledgements
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_employee_acknowledgements',
            v_rows
        );


    delete from public.pa_hr_finalisations
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_hr_finalisations',
            v_rows
        );


    delete from public.pa_manager_appraisals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_manager_appraisals',
            v_rows
        );


    delete from public.pa_self_appraisals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_self_appraisals',
            v_rows
        );


    delete from public.pa_employee_appraisals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_employee_appraisals',
            v_rows
        );


    delete from public.pa_progress_updates
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_progress_updates',
            v_rows
        );


    delete from public.pa_individual_goals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_individual_goals',
            v_rows
        );


    delete from public.pa_department_goals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_department_goals',
            v_rows
        );


    delete from public.pa_deliverables
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_deliverables',
            v_rows
        );


    delete from public.pa_organisation_goals
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_organisation_goals',
            v_rows
        );


    delete from public.pa_cycles
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_total_deleted := v_total_deleted + v_rows;

    v_counts :=
        v_counts ||
        jsonb_build_object(
            'pa_cycles',
            v_rows
        );


    -- --------------------------------------------------------
    -- ADMIN SECURITY AUDIT
    --
    -- The audit write is part of the same transaction.
    -- If it cannot be recorded, the destructive transaction
    -- must not report a successful committed clear.
    -- --------------------------------------------------------

    insert into public.admin_security_audit_logs (
        event_type,
        action_status,
        actor_user_id,
        actor_email,
        target_tenant_id,
        details
    )
    values (
        'pa_cycle_records_cleared',
        'success',
        v_actor_user_id,
        v_actor_email,
        v_tenant_id,
        jsonb_build_object(
            'company_name',
            v_company_name,

            'deleted_total',
            v_total_deleted,

            'deleted_counts',
            v_counts,

            'pa_templates_preserved',
            v_templates_preserved
        )
    );


    -- --------------------------------------------------------
    -- SUCCESS
    -- --------------------------------------------------------

    return jsonb_build_object(
        'success',
        true,

        'tenant_id',
        v_tenant_id,

        'company_name',
        v_company_name,

        'deleted_total',
        v_total_deleted,

        'deleted_counts',
        v_counts,

        'pa_templates_preserved',
        v_templates_preserved,

        'message',
        format(
            'Performance Appraisal cycle records cleared for %s. %s PA cycle record(s) were removed and %s PA template(s) were preserved.',
            v_company_name,
            v_total_deleted,
            v_templates_preserved
        )
    );

end;
$function$;


comment on function public.admin_clear_tenant_pa_cycle_records(uuid) is
    'Platform Admin-only transactional clear of tenant PA cycle/history records. PA templates and non-PA records are preserved.';


revoke all on function public.admin_clear_tenant_pa_cycle_records(uuid)
from public;

revoke all on function public.admin_clear_tenant_pa_cycle_records(uuid)
from anon;

grant execute on function public.admin_clear_tenant_pa_cycle_records(uuid)
to authenticated;

grant execute on function public.admin_clear_tenant_pa_cycle_records(uuid)
to service_role;



-- ============================================================
-- 2. RESET WORKSPACE PA PREFLIGHT
--
-- Preserve the existing Reset Workspace behaviour exactly,
-- except that it now stops before destructive work if PA
-- cycle/history records exist for the selected tenant.
--
-- PA templates do not block Reset Workspace because they have
-- no department/cycle FK and are intentionally preserved.
-- ============================================================

create or replace function public.admin_reset_tenant_workspace(
    target_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- 4. PERFORMANCE APPRAISAL SAFETY PREFLIGHT
    --
    -- Reset Workspace must never silently clear PA.
    --
    -- Several PA tables also hold nullable cycle_id values, so
    -- this guard is tenant-scoped across every cycle/history
    -- table rather than checking pa_cycles alone.
    --
    -- pa_templates is intentionally excluded.
    -- ========================================================

    if
        exists (
            select 1
            from public.pa_employee_acknowledgements
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_hr_finalisations
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_manager_appraisals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_self_appraisals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_employee_appraisals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_progress_updates
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_individual_goals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_department_goals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_deliverables
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_organisation_goals
            where tenant_id = v_tenant_id
        )
        or exists (
            select 1
            from public.pa_cycles
            where tenant_id = v_tenant_id
        )
    then
        raise exception
            'Reset Workspace blocked for %. Clear Performance Appraisal cycle records first, then retry Reset Workspace.',
            v_company_name;
    end if;


    -- ========================================================
    -- 5. EMPLOYEE CONTROL TOTAL BEFORE RESET
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
    -- PRESERVE.
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
    -- PRESERVE.
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
        'success',
        true,
        'tenant_id',
        v_tenant_id,
        'company_name',
        v_company_name,
        'employees_preserved',
        v_employee_count_after,
        'reset_counts',
        v_counts,
        'message',
        format(
            'Workspace reset completed for %s. %s employee record(s) were preserved.',
            v_company_name,
            v_employee_count_after
        )
    );

end;
$function$;


-- Reassert the existing Reset Workspace execution boundary.
revoke all on function public.admin_reset_tenant_workspace(uuid)
from public;

revoke all on function public.admin_reset_tenant_workspace(uuid)
from anon;

grant execute on function public.admin_reset_tenant_workspace(uuid)
to authenticated;

grant execute on function public.admin_reset_tenant_workspace(uuid)
to service_role;