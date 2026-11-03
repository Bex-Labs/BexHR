-- BexHR Phase 7 - Lean Offboarding
--
-- HR enters the business facts: employee, reason, last working day, optional note.
-- BexHR derives lifecycle state: Exited/Active, login availability, reporting-line
-- applicability, Salary Setup applicability, and future payroll eligibility.
--
-- Historical employee, payroll, payslip, leave, PA, Salary Setup and reporting rows
-- are preserved. No historical payroll row is updated or deleted.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $phase7_preflight$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.employee_reporting_lines') is null
     or to_regclass('public.payroll_master_records') is null
     or to_regclass('public.payroll_records') is null then
    raise exception 'Phase 7 stopped: required employee/profile/reporting/payroll tables are missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'Phase 7 stopped: tenant identity helper is missing.';
  end if;

  -- Existing compensation RLS is RESTRICTIVE and checks the active tenant
  -- helper. Preserve that already-deployed payroll tenant guard exactly.
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'payroll_records'
      and p.policyname = 'phase45b_tenant_scope_payroll_records'
      and p.permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'payroll_master_records'
      and p.policyname = 'phase45b_tenant_scope_payroll_master_records'
      and p.permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Phase 7 stopped: existing restrictive payroll tenant security is missing.';
  end if;

  if position(
    'is_active' in pg_catalog.pg_get_functiondef(
      to_regprocedure('public.current_authenticated_profile_tenant_id()')
    )
  ) = 0 then
    raise exception 'Phase 7 stopped: authenticated tenant helper does not check account activity.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.policyname in (
        'phase7_active_tenant_employees',
        'phase7_active_tenant_reporting_lines',
        'phase7_active_profile_updates'
      )
  ) then
    raise exception 'Phase 7 stopped: new lifecycle RLS policy already exists; inspect migration state.';
  end if;

  if to_regclass('public.employee_lifecycle_events') is not null then
    raise exception 'Phase 7 stopped: public.employee_lifecycle_events already exists.';
  end if;
end;
$phase7_preflight$;

create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

create table public.employee_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on update cascade on delete restrict,
  employee_id uuid not null references public.employees(id) on update cascade on delete restrict,
  action text not null check (action in ('offboard', 'reactivate')),
  reason text null,
  last_working_day date null,
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint employee_lifecycle_events_offboard_facts_check check (
    action <> 'offboard'
    or (
      nullif(trim(coalesce(reason, '')), '') is not null
      and last_working_day is not null
    )
  )
);

create index employee_lifecycle_events_employee_idx
on public.employee_lifecycle_events (tenant_id, employee_id, created_at desc);

comment on table public.employee_lifecycle_events is
'Append-only HR lifecycle history for employee offboarding and reactivation. Operational records are preserved elsewhere.';

alter table public.employee_lifecycle_events enable row level security;
revoke all on table public.employee_lifecycle_events from public, anon, authenticated;
grant select, insert on table public.employee_lifecycle_events to service_role;

create or replace function bexhr_private.phase7_current_people_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_employee_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = auth.uid()
    and coalesce(profile.is_active, false) is true;

  if v_profile.id is null or v_profile.tenant_id is null then
    raise exception 'An active company HR profile is required.' using errcode = '42501';
  end if;

  if lower(trim(coalesce(v_profile.role, ''))) not in (
    'hr', 'hr_manager', 'admin', 'system_admin'
  ) then
    raise exception 'An active HR/Admin access role is required for employee lifecycle actions.'
      using errcode = '42501';
  end if;

  select lower(trim(coalesce(employee.system_role, '')))
  into v_employee_role
  from public.employees employee
  where employee.tenant_id = v_profile.tenant_id
    and (
      employee.user_id = auth.uid()
      or lower(trim(coalesce(employee.work_email, ''))) = lower(trim(coalesce(v_profile.email, '')))
    )
  order by case when employee.user_id = auth.uid() then 0 else 1 end
  limit 1;

  v_employee_role := coalesce(nullif(v_employee_role, ''), lower(trim(coalesce(v_profile.role, ''))));

  if v_employee_role not in ('hr', 'hr_manager', 'admin', 'system_admin') then
    raise exception 'People maintenance permission is required for employee lifecycle actions.' using errcode = '42501';
  end if;

  return v_profile.tenant_id;
end;
$function$;

revoke all on function bexhr_private.phase7_current_people_tenant()
from public, anon, authenticated;

create or replace function public.hr_offboard_employee(
  p_employee_id uuid,
  p_reason text,
  p_last_working_day date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_employee public.employees%rowtype;
  v_profile public.profiles%rowtype;
  v_direct_report_names text;
  v_reporting_deactivated integer := 0;
  v_salary_ended integer := 0;
  v_previous_hr_access text;
  v_previous_profile_active boolean;
  v_result jsonb;
begin
  v_tenant_id := bexhr_private.phase7_current_people_tenant();

  if p_employee_id is null then
    raise exception 'Employee is required.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Offboarding reason is required.' using errcode = '22023';
  end if;
  if p_last_working_day is null then
    raise exception 'Last Working Day is required.' using errcode = '22023';
  end if;

  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = p_employee_id
    and employee.tenant_id = v_tenant_id
  for update;

  if v_employee.id is null then
    raise exception 'Employee was not found in your company workspace.' using errcode = 'P0002';
  end if;

  if lower(trim(coalesce(v_employee.status, 'active'))) <> 'active' then
    raise exception 'Employee is already inactive. Use Reactivate Employee when they return.' using errcode = '23514';
  end if;

  if v_employee.employment_date is not null and p_last_working_day < v_employee.employment_date then
    raise exception 'Last Working Day cannot be before Employment Date.' using errcode = '22023';
  end if;

  select string_agg(
    coalesce(
      nullif(trim(concat_ws(' ', child.first_name, child.middle_name, child.last_name)), ''),
      child.work_email,
      child.id::text
    ),
    ', '
    order by child.last_name, child.first_name
  )
  into v_direct_report_names
  from public.employee_reporting_lines reporting_line
  join public.employees child
    on child.id = reporting_line.employee_id
   and child.tenant_id = v_tenant_id
   and lower(trim(coalesce(child.status, 'active'))) = 'active'
  where reporting_line.manager_employee_id = v_employee.id
    and (reporting_line.tenant_id is null or reporting_line.tenant_id = v_tenant_id)
    and lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'
    and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active';

  if v_direct_report_names is not null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_OFFBOARD_ACTIVE_DIRECT_REPORTS: Reassign active direct reports before offboarding this employee.',
      detail = 'Reassign these active direct reports first: ' || v_direct_report_names;
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.tenant_id = v_tenant_id
    and (
      (v_employee.user_id is not null and profile.id = v_employee.user_id)
      or (
        nullif(trim(coalesce(v_employee.work_email, '')), '') is not null
        and lower(trim(coalesce(profile.email, ''))) = lower(trim(v_employee.work_email))
      )
    )
  order by case when v_employee.user_id is not null and profile.id = v_employee.user_id then 0 else 1 end
  limit 1
  for update;

  v_previous_hr_access := coalesce(v_profile.hr_access_level, 'standard');
  v_previous_profile_active := v_profile.is_active;

  update public.employee_reporting_lines reporting_line
  set
    status = 'Inactive',
    notes = concat_ws(
      E'
',
      nullif(trim(coalesce(reporting_line.notes, '')), ''),
      '[BEXHR PHASE 7] Deactivated by employee offboarding.'
    ),
    updated_by = auth.uid()
  where (reporting_line.tenant_id is null or reporting_line.tenant_id = v_tenant_id)
    -- Legacy NULL-tenant rows must still belong to this company's employee.
    and exists (
      select 1 from public.employees reporting_subject
      where reporting_subject.id = reporting_line.employee_id
        and reporting_subject.tenant_id = v_tenant_id
    )
    and (
      reporting_line.employee_id = v_employee.id
      or reporting_line.manager_employee_id = v_employee.id
    )
    and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active';
  get diagnostics v_reporting_deactivated = row_count;

  update public.payroll_master_records payroll_master
  set
    payroll_status = 'Inactive',
    updated_at = now()
  where payroll_master.employee_id = v_employee.id
    and lower(trim(coalesce(payroll_master.payroll_status, 'active'))) = 'active';
  get diagnostics v_salary_ended = row_count;

  update public.employees employee
  set
    status = 'Exited',
    exit_date = p_last_working_day,
    line_manager = null,
    approver_email = null,
    updated_at = now()
  where employee.id = v_employee.id
    and employee.tenant_id = v_tenant_id;

  if v_profile.id is not null then
    -- Existing profile invariant automatically parks tenant_admin at standard
    -- while the account is inactive. The previous access level is recorded below.
    update public.profiles profile
    set
      is_active = false,
      updated_at = now()
    where profile.id = v_profile.id;
  end if;

  insert into public.employee_lifecycle_events (
    tenant_id,
    employee_id,
    action,
    reason,
    last_working_day,
    note,
    metadata,
    created_by
  ) values (
    v_tenant_id,
    v_employee.id,
    'offboard',
    trim(p_reason),
    p_last_working_day,
    nullif(trim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'previous_employee_status', v_employee.status,
      'previous_exit_date', v_employee.exit_date,
      'profile_id', v_profile.id,
      'previous_profile_is_active', v_previous_profile_active,
      'previous_profile_role', v_profile.role,
      'previous_profile_hr_access_level', v_previous_hr_access,
      'reporting_lines_deactivated', v_reporting_deactivated,
      'salary_setups_ended', v_salary_ended
    ),
    auth.uid()
  );

  v_result := jsonb_build_object(
    'success', true,
    'employee_id', v_employee.id,
    'status', 'Exited',
    'last_working_day', p_last_working_day,
    'login_disabled', (v_profile.id is not null),
    'reporting_lines_deactivated', v_reporting_deactivated,
    'salary_setups_ended', v_salary_ended
  );

  return v_result;
end;
$function$;

comment on function public.hr_offboard_employee(uuid, text, date, text) is
'Atomically offboards one same-tenant employee. Blocks only for active Primary direct reports, archives as Exited, disables linked login, ends active Salary Setup and reporting assignments, and preserves history.';

revoke all on function public.hr_offboard_employee(uuid, text, date, text)
from public, anon;
grant execute on function public.hr_offboard_employee(uuid, text, date, text)
to authenticated, service_role;

create or replace function public.hr_reactivate_employee(
  p_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_employee public.employees%rowtype;
  v_profile public.profiles%rowtype;
  v_latest_lifecycle_action text;
  v_restore_hr_access text := 'standard';
  v_reporting_deactivated integer := 0;
  v_salary_ended integer := 0;
begin
  v_tenant_id := bexhr_private.phase7_current_people_tenant();

  if p_employee_id is null then
    raise exception 'Employee is required.' using errcode = '22023';
  end if;

  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = p_employee_id
    and employee.tenant_id = v_tenant_id
  for update;

  if v_employee.id is null then
    raise exception 'Employee was not found in your company workspace.' using errcode = 'P0002';
  end if;

  if lower(trim(coalesce(v_employee.status, ''))) <> 'exited' then
    raise exception 'Only an Exited employee can be reactivated through Employee Lifecycle.'
      using errcode = '23514';
  end if;

  -- The latest lifecycle event must be an actual Offboard action, not merely
  -- an old offboard somewhere in the employee history.
  select lifecycle.action
  into v_latest_lifecycle_action
  from public.employee_lifecycle_events lifecycle
  where lifecycle.tenant_id = v_tenant_id
    and lifecycle.employee_id = v_employee.id
  order by lifecycle.created_at desc, lifecycle.id desc
  limit 1;

  if coalesce(v_latest_lifecycle_action, '') <> 'offboard' then
    raise exception 'Employee reactivation requires a recorded latest offboarding event.'
      using errcode = '23514';
  end if;

  -- Reactivation never restores old reporting ownership. This also cleans up
  -- legacy inactive records that predate the Phase 7 workflow.
  update public.employee_reporting_lines reporting_line
  set
    status = 'Inactive',
    notes = concat_ws(
      E'
',
      nullif(trim(coalesce(reporting_line.notes, '')), ''),
      '[BEXHR PHASE 7] Kept inactive during employee reactivation; HR must assign managers again.'
    ),
    updated_by = auth.uid()
  where (reporting_line.tenant_id is null or reporting_line.tenant_id = v_tenant_id)
    -- Legacy NULL-tenant rows must still belong to this company's employee.
    and exists (
      select 1 from public.employees reporting_subject
      where reporting_subject.id = reporting_line.employee_id
        and reporting_subject.tenant_id = v_tenant_id
    )
    and (
      reporting_line.employee_id = v_employee.id
      or reporting_line.manager_employee_id = v_employee.id
    )
    and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active';
  get diagnostics v_reporting_deactivated = row_count;

  -- Reactivation never restores old salary. Any legacy active Salary Setup is
  -- ended here so HR must explicitly create a new Salary Setup.
  update public.payroll_master_records payroll_master
  set
    payroll_status = 'Inactive',
    updated_at = now()
  where payroll_master.employee_id = v_employee.id
    and lower(trim(coalesce(payroll_master.payroll_status, 'active'))) = 'active';
  get diagnostics v_salary_ended = row_count;

  update public.employees employee
  set
    status = 'Active',
    exit_date = null,
    line_manager = null,
    approver_email = null,
    updated_at = now()
  where employee.id = v_employee.id
    and employee.tenant_id = v_tenant_id;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.tenant_id = v_tenant_id
    and (
      (v_employee.user_id is not null and profile.id = v_employee.user_id)
      or (
        nullif(trim(coalesce(v_employee.work_email, '')), '') is not null
        and lower(trim(coalesce(profile.email, ''))) = lower(trim(v_employee.work_email))
      )
    )
  order by case when v_employee.user_id is not null and profile.id = v_employee.user_id then 0 else 1 end
  limit 1
  for update;

  if v_profile.id is not null then
    -- Reactivation restores ordinary access only. Company Admin/tenant_admin
    -- requires an explicit, separately audited grant through the HR access flow.
    v_restore_hr_access := 'standard';

    update public.profiles profile
    set
      is_active = true,
      hr_access_level = 'standard',
      updated_at = now()
    where profile.id = v_profile.id;
  end if;

  insert into public.employee_lifecycle_events (
    tenant_id,
    employee_id,
    action,
    reason,
    last_working_day,
    note,
    metadata,
    created_by
  ) values (
    v_tenant_id,
    v_employee.id,
    'reactivate',
    'Employee reactivated',
    null,
    null,
    jsonb_build_object(
      'profile_id', v_profile.id,
      'login_reenabled', (v_profile.id is not null),
      'restored_hr_access_level', case when v_profile.id is not null then v_restore_hr_access else null end,
      'salary_restored', false,
      'reporting_managers_restored', false,
      'legacy_reporting_lines_deactivated', v_reporting_deactivated,
      'legacy_salary_setups_ended', v_salary_ended
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'success', true,
    'employee_id', v_employee.id,
    'status', 'Active',
    'login_reenabled', (v_profile.id is not null),
    'salary_restored', false,
    'reporting_managers_restored', false
  );
end;
$function$;

comment on function public.hr_reactivate_employee(uuid) is
'Reactivates one same-tenant employee and linked login without restoring old Salary Setup or reporting-manager assignments.';

revoke all on function public.hr_reactivate_employee(uuid)
from public, anon;
grant execute on function public.hr_reactivate_employee(uuid)
to authenticated, service_role;

-- Defence in depth: an Exited employee profile cannot be switched back on by
-- a generic invite/access workflow. Reactivate Employee changes employee status
-- to Active first, then re-enables the profile in the same transaction.
create or replace function bexhr_private.enforce_offboarded_employee_login_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(new.is_active, false) is true
     and exists (
       select 1
       from public.employees employee
       where employee.tenant_id is not distinct from new.tenant_id
         and (
           employee.user_id = new.id
           or (
             nullif(trim(coalesce(employee.work_email, '')), '') is not null
             and lower(trim(coalesce(employee.work_email, ''))) = lower(trim(coalesce(new.email, '')))
           )
         )
         and lower(trim(coalesce(employee.status, 'active'))) = 'exited'
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_OFFBOARD_LOGIN_DISABLED: Reactivate Employee before enabling login for an exited employee.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_offboarded_employee_login_state()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_offboarded_employee_login_state on public.profiles;
create trigger bexhr_enforce_offboarded_employee_login_state
before insert or update of is_active, tenant_id, email
on public.profiles
for each row
execute function bexhr_private.enforce_offboarded_employee_login_state();

-- New Salary Setup is for active employees only. Historical Salary Setup updates
-- remain untouched so HR can review/correct preserved records deliberately.
create or replace function bexhr_private.enforce_active_employee_new_salary_setup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.employee_id is not null
     and not exists (
       select 1
       from public.employees employee
       where employee.id = new.employee_id
         and lower(trim(coalesce(employee.status, 'active'))) = 'active'
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_SALARY_SETUP_EMPLOYEE_INACTIVE: Reactivate Employee before creating a new Salary Setup.';
  end if;
  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_active_employee_new_salary_setup()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_active_employee_new_salary_setup on public.payroll_master_records;
create trigger bexhr_enforce_active_employee_new_salary_setup
before insert on public.payroll_master_records
for each row
execute function bexhr_private.enforce_active_employee_new_salary_setup();

-- Future payroll creation is blocked for exited/inactive employees at the DB
-- boundary. Historical payroll UPDATE/read paths are deliberately untouched.
create or replace function bexhr_private.enforce_active_employee_new_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.employee_id is not null
     and not exists (
       select 1
       from public.employees employee
       where employee.id = new.employee_id
         and lower(trim(coalesce(employee.status, 'active'))) = 'active'
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PAYROLL_EMPLOYEE_INACTIVE: Reactivate Employee before creating a new payroll record.';
  end if;
  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_active_employee_new_payroll()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_active_employee_new_payroll on public.payroll_records;
create trigger bexhr_enforce_active_employee_new_payroll
before insert on public.payroll_records
for each row
execute function bexhr_private.enforce_active_employee_new_payroll();

-- PHASE 7A HARDENING: preserve existing permissive role policies but add a
-- restrictive, active-profile and tenant barrier on direct employee/reporting
-- data access. The restrictive policies compose with (AND) existing policies,
-- so they cannot independently grant additional SELECT/INSERT/UPDATE rights.
-- Phase 4.5B already applies this model to payroll; those guards stay unchanged.
create or replace function bexhr_private.phase7_active_caller_in_tenant(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and (
        -- Platform administrators retain the authority of their existing
        -- *permissive* RLS policies; this clause never grants new access alone.
        lower(trim(coalesce(profile.role, ''))) in ('admin', 'system_admin')
        or (
          p_tenant_id is not null
          and profile.tenant_id = p_tenant_id
        )
      )
  );
$function$;

revoke all on function bexhr_private.phase7_active_caller_in_tenant(uuid)
from public, anon, authenticated, service_role;
grant execute on function bexhr_private.phase7_active_caller_in_tenant(uuid)
to authenticated;

create or replace function bexhr_private.phase7_active_caller_in_reporting_tenant(
  p_employee_id uuid,
  p_reporting_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_employee_id is not null and exists (
    select 1 from public.employees employee
    where employee.id = p_employee_id
      and (
        p_reporting_tenant_id is null
        or employee.tenant_id = p_reporting_tenant_id
      )
      and bexhr_private.phase7_active_caller_in_tenant(employee.tenant_id)
  );
$function$;

revoke all on function bexhr_private.phase7_active_caller_in_reporting_tenant(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function bexhr_private.phase7_active_caller_in_reporting_tenant(uuid,uuid)
to authenticated;

-- Only same-tenant manager identifiers may cross a direct reporting RLS
-- boundary. Historical rows remain intact; no data is rewritten here.
create or replace function bexhr_private.phase7_manager_in_child_tenant(
  p_employee_id uuid,
  p_manager_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_manager_employee_id is null or exists (
    select 1
    from public.employees child
    join public.employees manager on manager.id = p_manager_employee_id
    where child.id = p_employee_id
      and child.tenant_id is not null
      and manager.tenant_id = child.tenant_id
  );
$function$;

revoke all on function bexhr_private.phase7_manager_in_child_tenant(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function bexhr_private.phase7_manager_in_child_tenant(uuid,uuid)
to authenticated;

create or replace function bexhr_private.phase7_caller_profile_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
  );
$function$;

revoke all on function bexhr_private.phase7_caller_profile_active()
from public, anon, authenticated, service_role;
grant execute on function bexhr_private.phase7_caller_profile_active()
to authenticated;

create policy phase7_active_tenant_employees
on public.employees
as restrictive
for all
to authenticated
using (bexhr_private.phase7_active_caller_in_tenant(tenant_id))
with check (bexhr_private.phase7_active_caller_in_tenant(tenant_id));

-- Legacy reporting rows may have NULL reporting_line.tenant_id; resolve the
-- authoritative tenant through the linked employee rather than dropping rows.
create policy phase7_active_tenant_reporting_lines
on public.employee_reporting_lines
as restrictive
for all
to authenticated
using (
  bexhr_private.phase7_active_caller_in_reporting_tenant(employee_id, tenant_id)
  and bexhr_private.phase7_manager_in_child_tenant(employee_id, manager_employee_id)
)
with check (
  bexhr_private.phase7_active_caller_in_reporting_tenant(employee_id, tenant_id)
  and bexhr_private.phase7_manager_in_child_tenant(employee_id, manager_employee_id)
);

-- Retain own-profile SELECT for BexHR to detect disabled accounts during login,
-- but prevent even permitted self-service edits after offboarding.
create policy phase7_active_profile_updates
on public.profiles
as restrictive
for update
to authenticated
using (bexhr_private.phase7_caller_profile_active())
with check (bexhr_private.phase7_caller_profile_active());

-- An authenticated caller cannot bypass the lifecycle RPCs by directly writing
-- employees.status or exit_date through REST. The RPCs are SECURITY DEFINER
-- and execute their authorized employee lifecycle updates as the DB owner.
-- The trigger is deliberately SECURITY INVOKER so CURRENT_USER identifies a
-- direct authenticated/anon write (not the trigger function owner).
create or replace function bexhr_private.phase7_block_direct_lifecycle_edits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if lower(trim(coalesce(new.status, ''))) <> 'active'
         or new.exit_date is not null then
        raise exception using
          errcode = '42501',
          message = 'BEXHR_LIFECYCLE_RPC_REQUIRED: Create active employees only. Use Offboard Employee to end employment.';
      end if;
    elsif tg_op = 'UPDATE' then
      if lower(trim(coalesce(new.status, ''))) is distinct from
         lower(trim(coalesce(old.status, '')))
         or new.exit_date is distinct from old.exit_date then
        raise exception using
          errcode = '42501',
          message = 'BEXHR_LIFECYCLE_RPC_REQUIRED: Employee status changes require Offboard Employee or Reactivate Employee.';
      end if;
      -- Preserve exited-account ownership so direct employee edits cannot
      -- unlink an offboarded login and evade profile reactivation protection.
      if lower(trim(coalesce(old.status, ''))) = 'exited'
         and (
           new.tenant_id is distinct from old.tenant_id
           or new.user_id is distinct from old.user_id
           or lower(trim(coalesce(new.work_email, ''))) is distinct from
              lower(trim(coalesce(old.work_email, '')))
         ) then
        raise exception using
          errcode = '42501',
          message = 'BEXHR_EXITED_IDENTITY_LOCKED: Reactivate Employee before changing exited login ownership.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function bexhr_private.phase7_block_direct_lifecycle_edits()
from public, anon, authenticated, service_role;

create trigger bexhr_phase7_block_direct_lifecycle_edits
before insert or update of status, exit_date, tenant_id, user_id, work_email on public.employees
for each row
execute function bexhr_private.phase7_block_direct_lifecycle_edits();

do $phase7_verify$
begin
  if to_regclass('public.employee_lifecycle_events') is null then
    raise exception 'Phase 7 verification failed: lifecycle history table is missing.';
  end if;

  if to_regprocedure('public.hr_offboard_employee(uuid,text,date,text)') is null
     or to_regprocedure('public.hr_reactivate_employee(uuid)') is null then
    raise exception 'Phase 7 verification failed: lifecycle RPCs are missing.';
  end if;

  if has_function_privilege('anon', 'public.hr_offboard_employee(uuid,text,date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.hr_reactivate_employee(uuid)', 'EXECUTE') then
    raise exception 'Phase 7 verification failed: anon can execute employee lifecycle RPCs.';
  end if;

  if not has_function_privilege('authenticated', 'public.hr_offboard_employee(uuid,text,date,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.hr_reactivate_employee(uuid)', 'EXECUTE') then
    raise exception 'Phase 7 verification failed: authenticated lost lifecycle RPC access.';
  end if;

  if (
    select count(*) from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.permissive = 'RESTRICTIVE'
      and policy.policyname in (
        'phase7_active_tenant_employees',
        'phase7_active_tenant_reporting_lines',
        'phase7_active_profile_updates'
      )
  ) <> 3 then
    raise exception 'Phase 7 verification failed: a restrictive profile/tenant guard is missing.';
  end if;

  if to_regprocedure('bexhr_private.phase7_manager_in_child_tenant(uuid,uuid)') is null then
    raise exception 'Phase 7 verification failed: cross-company reporting manager guard is missing.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.employees'::regclass
      and trigger_record.tgname = 'bexhr_phase7_block_direct_lifecycle_edits'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 7 verification failed: direct lifecycle write guard trigger is missing.';
  end if;
end;
$phase7_verify$;

commit;
