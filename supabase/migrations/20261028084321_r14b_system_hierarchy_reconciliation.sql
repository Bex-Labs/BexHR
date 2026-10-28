-- BEXHR R-14B SYSTEM HIERARCHY RECONCILIATION
-- Scope:
--   1. Active Primary lines must match the current reporting hierarchy, not stale history.
--   2. Position/role changes automatically deactivate Primary lines that no longer fit.
--   3. Deactivation preserves reporting-line history; it does not delete the row.
--   4. A position change fails closed if automatic deactivation would strand a Pending Approval leave request.
--   5. Leave readiness also requires the Primary line to be hierarchy-valid.
--   6. No CEO/COO title text is used by these database rules. Whole-organization scope comes
--      from Organization Job Title setup + the employee's no-department assignment.
--   7. Secondary/supporting-manager lines are not altered here.
--
-- Out of scope:
--   - Performance Appraisal policy.
--   - Configurable executive-to-executive ordering (the existing frontend ordering remains unchanged here).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $r14b_preflight$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.employee_reporting_lines') is null
     or to_regclass('public.organization_job_titles') is null
     or to_regclass('public.leave_requests') is null then
    raise exception 'R-14B stopped: required employee/reporting/organization/leave tables are missing.';
  end if;

  if to_regprocedure('public.hrp_resolve_leave_employee(uuid)') is null then
    raise exception 'R-14B stopped: canonical leave employee resolver is missing.';
  end if;

  if to_regprocedure('public.get_employee_leave_primary_manager_readiness()') is null then
    raise exception 'R-14B stopped: R-14A Leave readiness RPC is missing.';
  end if;

  if to_regprocedure('public.require_current_tenant_administrator()') is null then
    raise exception 'R-14B stopped: Tenant Administrator guard is missing.';
  end if;
end;
$r14b_preflight$;

create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PRIVATE HIERARCHY FACTS
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.is_whole_organization_employee(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and nullif(trim(coalesce(e.department, '')), '') is null
      and nullif(trim(coalesce(e.job_title, '')), '') is not null
      and exists (
        select 1
        from public.organization_job_titles jt
        where jt.department_id is null
          and lower(trim(coalesce(jt.job_title, ''))) = lower(trim(coalesce(e.job_title, '')))
          and (jt.tenant_id = e.tenant_id or jt.tenant_id is null)
      )
  );
$function$;

revoke all on function bexhr_private.is_whole_organization_employee(uuid)
from public, anon, authenticated;

create or replace function bexhr_private.is_hr_admin_employee(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and lower(trim(coalesce(e.system_role, ''))) in ('hr', 'hr_manager')
      and exists (
        select 1
        from public.profiles p
        where (
          p.id = e.user_id
          or (
            nullif(trim(coalesce(e.work_email, '')), '') is not null
            and lower(trim(coalesce(p.email, ''))) = lower(trim(coalesce(e.work_email, '')))
          )
        )
          and p.tenant_id = e.tenant_id
          and coalesce(p.is_active, false) is true
          and lower(trim(coalesce(p.role, ''))) = 'hr'
          and lower(trim(coalesce(p.hr_access_level, 'standard'))) = 'tenant_admin'
      )
  );
$function$;

revoke all on function bexhr_private.is_hr_admin_employee(uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PRIMARY REPORTING LEVEL VALIDITY
--
-- Current locked direct chain at the broad role/scope level:
--   Whole-organization Manager -> HR Admin / another whole-organization Manager
--   HR Admin                   -> HR Standard / Manager
--   Department Manager         -> ordinary employee in same department
--
-- Executive-to-executive immediate ordering remains a separate concern; this
-- function deliberately does not inspect literal CEO/COO title strings.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.is_primary_reporting_relationship_valid(
  p_employee_id uuid,
  p_manager_employee_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_employee_role text;
  v_manager_role text;
  v_employee_whole_organization boolean;
  v_manager_whole_organization boolean;
  v_employee_hr_admin boolean;
  v_manager_hr_admin boolean;
begin
  if p_employee_id is null
     or p_manager_employee_id is null
     or p_employee_id = p_manager_employee_id then
    return false;
  end if;

  select * into v_employee
  from public.employees e
  where e.id = p_employee_id;

  select * into v_manager
  from public.employees e
  where e.id = p_manager_employee_id;

  if v_employee.id is null or v_manager.id is null then
    return false;
  end if;

  if v_employee.tenant_id is distinct from v_manager.tenant_id then
    return false;
  end if;

  if lower(trim(coalesce(v_employee.status, 'active'))) <> 'active'
     or lower(trim(coalesce(v_manager.status, 'active'))) <> 'active' then
    return false;
  end if;

  v_employee_role := lower(trim(coalesce(v_employee.system_role, '')));
  v_manager_role := lower(trim(coalesce(v_manager.system_role, '')));
  v_employee_whole_organization := bexhr_private.is_whole_organization_employee(v_employee.id);
  v_manager_whole_organization := bexhr_private.is_whole_organization_employee(v_manager.id);
  v_employee_hr_admin := bexhr_private.is_hr_admin_employee(v_employee.id);
  v_manager_hr_admin := bexhr_private.is_hr_admin_employee(v_manager.id);

  -- Whole-organization reporting leaders do not directly own normal Employee,
  -- Manager, or HR Standard Primary lines. HR Admin is the bridge into the
  -- departmental hierarchy. Another whole-organization Manager may remain in
  -- the executive chain; cycle protection remains independently enforced.
  if v_manager_whole_organization and v_manager_role = 'manager' then
    return v_employee_hr_admin
      or (v_employee_whole_organization and v_employee_role = 'manager');
  end if;

  -- HR Admin owns the two sibling branches: HR Standard and Manager.
  if v_manager_hr_admin then
    return not v_employee_whole_organization
      and not v_employee_hr_admin
      and v_employee_role in ('hr', 'hr_manager', 'manager');
  end if;

  -- Department Managers own ordinary employees in their own department.
  if v_manager_role = 'manager' and not v_manager_whole_organization then
    return not v_employee_whole_organization
      and v_employee_role not in ('hr', 'hr_manager', 'manager')
      and nullif(lower(trim(coalesce(v_manager.department, ''))), '') is not null
      and lower(trim(coalesce(v_manager.department, ''))) =
          lower(trim(coalesce(v_employee.department, '')));
  end if;

  -- HR Standard and all other roles are not formal Primary Managers in the
  -- locked hierarchy.
  return false;
end;
$function$;

revoke all
on function bexhr_private.is_primary_reporting_relationship_valid(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- BLOCK INVALID NEW/UPDATED PRIMARY LINES
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_reporting_role_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.employee_id is null or new.manager_employee_id is null then
    return new;
  end if;

  if lower(trim(coalesce(new.manager_type::text, ''))) <> 'primary'
     or lower(trim(coalesce(new.status::text, 'active'))) <> 'active' then
    return new;
  end if;

  if not bexhr_private.is_primary_reporting_relationship_valid(
    new.employee_id,
    new.manager_employee_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_REPORTING_LEVEL_INVALID: This Primary Manager relationship does not match the employee hierarchy.',
      detail = 'Reassign the employee to the immediate valid reporting level before saving.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_reporting_role_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_reporting_role_integrity
on public.employee_reporting_lines;

create trigger bexhr_enforce_reporting_role_integrity
before insert or update of employee_id, manager_employee_id, manager_type, status, tenant_id
on public.employee_reporting_lines
for each row
execute function bexhr_private.enforce_reporting_role_integrity();

-- ---------------------------------------------------------------------------
-- POSITION-CHANGE RECONCILIATION
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.reconcile_employee_primary_reporting_lines(
  p_employee_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deactivated integer := 0;
  v_pending_employee_names text;
  v_affected_employee_ids uuid[] := '{}'::uuid[];
begin
  if p_employee_id is null then
    return 0;
  end if;

  -- Never strand an already Pending Approval request. If the position change
  -- would invalidate that employee's current Primary line, fail the position
  -- change and let HR resolve the pending workflow or reporting assignment first.
  select string_agg(
    distinct coalesce(
      nullif(trim(concat_ws(' ', child.first_name, child.middle_name, child.last_name)), ''),
      child.work_email,
      child.id::text
    ),
    ', '
  )
  into v_pending_employee_names
  from public.employee_reporting_lines rl
  join public.employees child on child.id = rl.employee_id
  where (rl.employee_id = p_employee_id or rl.manager_employee_id = p_employee_id)
    and lower(trim(coalesce(rl.manager_type::text, ''))) = 'primary'
    and lower(trim(coalesce(rl.status::text, 'active'))) = 'active'
    and not bexhr_private.is_primary_reporting_relationship_valid(
      rl.employee_id,
      rl.manager_employee_id
    )
    and exists (
      select 1
      from public.leave_requests lr
      join lateral public.hrp_resolve_leave_employee(lr.employee_id) resolved on true
      where resolved.employee_id = rl.employee_id
        and lower(trim(coalesce(lr.status, ''))) = 'pending approval'
    );

  if v_pending_employee_names is not null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_REPORTING_RECONCILE_PENDING_LEAVE: This position change would remove a Primary Manager from an employee with a Pending Approval leave request.',
      detail = 'Resolve the pending leave or reassign the affected employee first: ' || v_pending_employee_names;
  end if;

  with updated as (
    update public.employee_reporting_lines rl
    set
      status = 'Inactive',
      notes = concat_ws(
        E'\n',
        nullif(trim(coalesce(rl.notes, '')), ''),
        '[BEXHR R-14B] Automatically deactivated because the current employee/manager position no longer matches the active Primary reporting hierarchy.'
      ),
      updated_by = coalesce(auth.uid(), rl.updated_by)
    where (rl.employee_id = p_employee_id or rl.manager_employee_id = p_employee_id)
      and lower(trim(coalesce(rl.manager_type::text, ''))) = 'primary'
      and lower(trim(coalesce(rl.status::text, 'active'))) = 'active'
      and not bexhr_private.is_primary_reporting_relationship_valid(
        rl.employee_id,
        rl.manager_employee_id
      )
    returning rl.employee_id
  )
  select
    count(*),
    coalesce(array_agg(distinct employee_id), '{}'::uuid[])
  into v_deactivated, v_affected_employee_ids
  from updated;

  -- employee_reporting_lines is authoritative, but older BexHR screens still
  -- carry line_manager / approver_email snapshots. Clear those snapshots only
  -- for employees who no longer have any hierarchy-valid active Primary line.
  if cardinality(v_affected_employee_ids) > 0 then
    update public.employees employee
    set
      line_manager = null,
      approver_email = null
    where employee.id = any(v_affected_employee_ids)
      and not exists (
        select 1
        from public.employee_reporting_lines active_primary
        where active_primary.employee_id = employee.id
          and lower(trim(coalesce(active_primary.manager_type::text, ''))) = 'primary'
          and lower(trim(coalesce(active_primary.status::text, 'active'))) = 'active'
          and bexhr_private.is_primary_reporting_relationship_valid(
            active_primary.employee_id,
            active_primary.manager_employee_id
          )
      );
  end if;

  return v_deactivated;
end;
$function$;

revoke all
on function bexhr_private.reconcile_employee_primary_reporting_lines(uuid)
from public, anon, authenticated;

create or replace function bexhr_private.reconcile_reporting_after_employee_position_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.department is not distinct from old.department
     and new.job_title is not distinct from old.job_title
     and new.system_role is not distinct from old.system_role
     and new.status is not distinct from old.status
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  perform bexhr_private.reconcile_employee_primary_reporting_lines(new.id);
  return new;
end;
$function$;

revoke all
on function bexhr_private.reconcile_reporting_after_employee_position_change()
from public, anon, authenticated;

drop trigger if exists bexhr_reconcile_reporting_after_employee_position_change
on public.employees;

create trigger bexhr_reconcile_reporting_after_employee_position_change
after update of department, job_title, system_role, status, user_id
on public.employees
for each row
execute function bexhr_private.reconcile_reporting_after_employee_position_change();

-- HR Admin status is stored on profiles, so reconcile linked employee lines if
-- that access tier changes independently of the employee row.
create or replace function bexhr_private.reconcile_reporting_after_profile_authority_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
begin
  if new.role is not distinct from old.role
     and new.hr_access_level is not distinct from old.hr_access_level
     and new.is_active is not distinct from old.is_active
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  for v_employee_id in
    select e.id
    from public.employees e
    where e.user_id = new.id
       or (
         nullif(trim(coalesce(e.work_email, '')), '') is not null
         and lower(trim(coalesce(e.work_email, ''))) = lower(trim(coalesce(new.email, '')))
         and (new.tenant_id is null or e.tenant_id = new.tenant_id)
       )
  loop
    perform bexhr_private.reconcile_employee_primary_reporting_lines(v_employee_id);
  end loop;

  return new;
end;
$function$;

revoke all
on function bexhr_private.reconcile_reporting_after_profile_authority_change()
from public, anon, authenticated;

drop trigger if exists bexhr_reconcile_reporting_after_profile_authority_change
on public.profiles;

create trigger bexhr_reconcile_reporting_after_profile_authority_change
after update of role, hr_access_level, is_active, tenant_id
on public.profiles
for each row
execute function bexhr_private.reconcile_reporting_after_profile_authority_change();

-- ---------------------------------------------------------------------------
-- TENANT ADMIN ONE-TIME / SUPPORT RECONCILIATION
-- Existing stale lines are not changed merely by installing this migration.
-- Tenant Admin can explicitly reconcile the current company after reviewing the
-- preflight output. Future position changes reconcile automatically via trigger.
-- ---------------------------------------------------------------------------
create or replace function public.hr_tenant_admin_reconcile_reporting_hierarchy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_pending_names text;
  v_result jsonb;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  select string_agg(
    distinct coalesce(
      nullif(trim(concat_ws(' ', child.first_name, child.middle_name, child.last_name)), ''),
      child.work_email,
      child.id::text
    ),
    ', '
  )
  into v_pending_names
  from public.employee_reporting_lines rl
  join public.employees child
    on child.id = rl.employee_id
   and child.tenant_id = v_tenant_id
  where (rl.tenant_id is null or rl.tenant_id = v_tenant_id)
    and lower(trim(coalesce(rl.manager_type::text, ''))) = 'primary'
    and lower(trim(coalesce(rl.status::text, 'active'))) = 'active'
    and not bexhr_private.is_primary_reporting_relationship_valid(
      rl.employee_id,
      rl.manager_employee_id
    )
    and exists (
      select 1
      from public.leave_requests lr
      join lateral public.hrp_resolve_leave_employee(lr.employee_id) resolved on true
      where resolved.employee_id = rl.employee_id
        and resolved.tenant_id = v_tenant_id
        and lower(trim(coalesce(lr.status, ''))) = 'pending approval'
    );

  if v_pending_names is not null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_REPORTING_RECONCILE_PENDING_LEAVE: Current hierarchy cleanup would strand Pending Approval leave.',
      detail = 'Resolve pending leave or reassign these employees first: ' || v_pending_names;
  end if;

  with invalid as (
    select rl.id, rl.employee_id, rl.manager_employee_id
    from public.employee_reporting_lines rl
    join public.employees child
      on child.id = rl.employee_id
     and child.tenant_id = v_tenant_id
    join public.employees manager
      on manager.id = rl.manager_employee_id
     and manager.tenant_id = v_tenant_id
    where (rl.tenant_id is null or rl.tenant_id = v_tenant_id)
      and lower(trim(coalesce(rl.manager_type::text, ''))) = 'primary'
      and lower(trim(coalesce(rl.status::text, 'active'))) = 'active'
      and not bexhr_private.is_primary_reporting_relationship_valid(
        rl.employee_id,
        rl.manager_employee_id
      )
  ),
  updated as (
    update public.employee_reporting_lines rl
    set
      status = 'Inactive',
      notes = concat_ws(
        E'\n',
        nullif(trim(coalesce(rl.notes, '')), ''),
        '[BEXHR R-14B] Tenant Admin reconciliation deactivated this stale Primary reporting line.'
      ),
      updated_by = auth.uid()
    from invalid i
    where rl.id = i.id
    returning rl.id, rl.employee_id, rl.manager_employee_id
  ),
  cleared_snapshots as (
    update public.employees employee
    set
      line_manager = null,
      approver_email = null
    where employee.id in (select distinct updated.employee_id from updated)
      and employee.tenant_id = v_tenant_id
      and not exists (
        select 1
        from public.employee_reporting_lines active_primary
        where active_primary.employee_id = employee.id
          and lower(trim(coalesce(active_primary.manager_type::text, ''))) = 'primary'
          and lower(trim(coalesce(active_primary.status::text, 'active'))) = 'active'
          and bexhr_private.is_primary_reporting_relationship_valid(
            active_primary.employee_id,
            active_primary.manager_employee_id
          )
      )
    returning employee.id
  )
  select jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'deactivated_count', count(*),
    'cleared_employee_snapshot_count', (select count(*) from cleared_snapshots),
    'affected', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'reporting_line_id', updated.id,
          'employee_id', updated.employee_id,
          'employee_name', coalesce(
            nullif(trim(concat_ws(' ', child.first_name, child.middle_name, child.last_name)), ''),
            child.work_email,
            child.id::text
          ),
          'previous_manager_employee_id', updated.manager_employee_id,
          'previous_manager_name', coalesce(
            nullif(trim(concat_ws(' ', manager.first_name, manager.middle_name, manager.last_name)), ''),
            manager.work_email,
            manager.id::text
          )
        )
        order by child.last_name, child.first_name
      ) filter (where updated.id is not null),
      '[]'::jsonb
    )
  )
  into v_result
  from updated
  left join public.employees child on child.id = updated.employee_id
  left join public.employees manager on manager.id = updated.manager_employee_id;

  return v_result;
end;
$function$;

comment on function public.hr_tenant_admin_reconcile_reporting_hierarchy() is
'Tenant-Admin support action that deactivates active Primary reporting lines no longer valid under the current employee hierarchy. Pending Approval leave fails closed; rows are preserved as Inactive history.';

revoke all
on function public.hr_tenant_admin_reconcile_reporting_hierarchy()
from public, anon;

grant execute
on function public.hr_tenant_admin_reconcile_reporting_hierarchy()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- R-14A LEAVE READINESS: REQUIRE A HIERARCHY-VALID PRIMARY LINE
-- ---------------------------------------------------------------------------
create or replace function public.get_employee_leave_primary_manager_readiness()
returns table (
  employee_id uuid,
  has_primary_manager boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with signed_in_employee as (
    select
      employee.id,
      employee.tenant_id
    from public.employees employee
    where auth.uid() is not null
      and employee.tenant_id = public.current_authenticated_profile_tenant_id()
      and lower(trim(coalesce(employee.status, 'active'))) = 'active'
      and (
        employee.user_id = auth.uid()
        or lower(coalesce(employee.work_email, '')) =
           lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    order by
      case when employee.user_id = auth.uid() then 0 else 1 end,
      employee.created_at desc nulls last
    limit 1
  )
  select
    employee.id as employee_id,
    exists (
      select 1
      from public.employee_reporting_lines reporting_line
      join public.employees manager_employee
        on manager_employee.id = reporting_line.manager_employee_id
       and manager_employee.tenant_id = employee.tenant_id
       and lower(trim(coalesce(manager_employee.status, 'active'))) = 'active'
      where reporting_line.employee_id = employee.id
        and lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'
        and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active'
        and (
          reporting_line.tenant_id is null
          or reporting_line.tenant_id = employee.tenant_id
        )
        and bexhr_private.is_primary_reporting_relationship_valid(
          reporting_line.employee_id,
          reporting_line.manager_employee_id
        )
    ) as has_primary_manager
  from signed_in_employee employee;
$function$;

revoke all
on function public.get_employee_leave_primary_manager_readiness()
from public, anon;

grant execute
on function public.get_employee_leave_primary_manager_readiness()
to authenticated;

-- Replace R-14A submission guard so invalid stale Primary lines cannot satisfy it.
create or replace function bexhr_private.enforce_leave_primary_manager_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target record;
begin
  if lower(trim(coalesce(new.status, ''))) <> 'pending approval' then
    return new;
  end if;

  select *
  into v_target
  from public.hrp_resolve_leave_employee(new.employee_id);

  if v_target.employee_id is null or v_target.tenant_id is null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_LEAVE_EMPLOYEE_UNRESOLVED: The leave request employee could not be resolved to an active company record.';
  end if;

  if not exists (
    select 1
    from public.employees target_employee
    where target_employee.id = v_target.employee_id
      and target_employee.tenant_id = v_target.tenant_id
      and lower(trim(coalesce(target_employee.status, 'active'))) = 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_LEAVE_EMPLOYEE_INACTIVE: An inactive employee cannot submit a new manager-approved Leave request.';
  end if;

  if not exists (
    select 1
    from public.employee_reporting_lines reporting_line
    join public.employees manager_employee
      on manager_employee.id = reporting_line.manager_employee_id
     and manager_employee.tenant_id = v_target.tenant_id
     and lower(trim(coalesce(manager_employee.status, 'active'))) = 'active'
    where reporting_line.employee_id = v_target.employee_id
      and lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'
      and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active'
      and (
        reporting_line.tenant_id is null
        or reporting_line.tenant_id = v_target.tenant_id
      )
      and bexhr_private.is_primary_reporting_relationship_valid(
        reporting_line.employee_id,
        reporting_line.manager_employee_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_LEAVE_PRIMARY_MANAGER_REQUIRED: Leave request submission is unavailable until an active hierarchy-valid Primary Manager is assigned.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_leave_primary_manager_submission()
from public, anon, authenticated;

commit;
