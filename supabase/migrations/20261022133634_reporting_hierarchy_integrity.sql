begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- BexHR Reporting Hierarchy Integrity - R-12
-- Universal business rules:
--   1. No employee may manage themselves.
--   2. Active Primary Manager relationships must remain acyclic.
--
-- Existing records are not silently rewritten by this migration.
-- The trigger protects all future inserts/updates while HR repairs any
-- historical invalid relationships deliberately through the normal UI.

do $bexhr_reporting_preflight$
begin
  if to_regclass('public.employee_reporting_lines') is null then
    raise exception 'Reporting hierarchy integrity stopped: public.employee_reporting_lines is missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'Reporting hierarchy integrity stopped: public.employees is missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'Reporting hierarchy integrity stopped: tenant identity helper is missing.';
  end if;
end;
$bexhr_reporting_preflight$;

create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

create or replace function bexhr_private.enforce_reporting_hierarchy_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee_tenant_id uuid;
  v_old_reporting_line_id uuid;
  v_has_cycle boolean := false;
begin
  if new.employee_id is null or new.manager_employee_id is null then
    return new;
  end if;

  if new.employee_id = new.manager_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_REPORTING_SELF_MANAGER: An employee cannot be assigned as their own manager.';
  end if;

  -- Only active Primary Manager relationships define the formal reporting tree.
  -- Secondary/dotted-line relationships remain outside the cycle calculation.
  if lower(trim(coalesce(new.manager_type::text, ''))) <> 'primary'
     or lower(trim(coalesce(new.status::text, 'active'))) <> 'active' then
    return new;
  end if;

  select employee.tenant_id
  into v_employee_tenant_id
  from public.employees employee
  where employee.id = new.employee_id;

  if v_employee_tenant_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_reporting_line_id := old.id;
  end if;

  -- Walk upward from the proposed Primary Manager.
  -- The path starts with the employee plus proposed manager, so encountering
  -- any already-visited person means the resulting hierarchy would loop.
  with recursive manager_chain as (
    select
      new.manager_employee_id as current_employee_id,
      array[new.employee_id, new.manager_employee_id]::uuid[] as path,
      (new.manager_employee_id = new.employee_id) as has_cycle

    union all

    select
      reporting_line.manager_employee_id as current_employee_id,
      manager_chain.path || reporting_line.manager_employee_id,
      reporting_line.manager_employee_id = any(manager_chain.path) as has_cycle
    from manager_chain
    join public.employee_reporting_lines reporting_line
      on reporting_line.employee_id = manager_chain.current_employee_id
    join public.employees reporting_employee
      on reporting_employee.id = reporting_line.employee_id
     and reporting_employee.tenant_id = v_employee_tenant_id
    join public.employees reporting_manager
      on reporting_manager.id = reporting_line.manager_employee_id
     and reporting_manager.tenant_id = v_employee_tenant_id
    where manager_chain.has_cycle is false
      and reporting_line.manager_employee_id is not null
      and lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'
      and lower(trim(coalesce(reporting_line.status::text, 'active'))) = 'active'
      and (
        reporting_line.tenant_id is null
        or reporting_line.tenant_id = v_employee_tenant_id
      )
      and (
        v_old_reporting_line_id is null
        or reporting_line.id <> v_old_reporting_line_id
      )
  )
  select exists (
    select 1
    from manager_chain
    where manager_chain.has_cycle is true
  )
  into v_has_cycle;

  if v_has_cycle then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_REPORTING_CYCLE: Circular Primary Manager relationship blocked.',
      detail = 'The selected Primary Manager is already inside a reporting chain that would become circular.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_reporting_hierarchy_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_reporting_hierarchy_integrity
on public.employee_reporting_lines;

create trigger bexhr_enforce_reporting_hierarchy_integrity
before insert or update of employee_id, manager_employee_id, manager_type, status, tenant_id
on public.employee_reporting_lines
for each row
execute function bexhr_private.enforce_reporting_hierarchy_integrity();

-- Replace one employee's reporting lines atomically.
-- This closes the current delete-then-insert gap in the HR browser save path:
-- if the hierarchy trigger rejects the replacement, PostgreSQL rolls back the
-- delete and preserves the employee's previous valid reporting relationships.
create or replace function public.hr_replace_employee_reporting_lines(
  p_employee_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to maintain employee reporting lines.';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have a tenant context.';
  end if;

  if p_employee_id is null then
    raise exception using
      errcode = '22023',
      message = 'An employee is required when replacing reporting lines.';
  end if;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Reporting lines must be supplied as a JSON array.';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.tenant_id = v_tenant_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The employee is not available in the authenticated tenant.';
  end if;

  delete from public.employee_reporting_lines reporting_line
  where reporting_line.employee_id = p_employee_id;

  if jsonb_array_length(v_rows) = 0 then
    return 0;
  end if;

  insert into public.employee_reporting_lines (
    employee_id,
    tenant_id,
    manager_employee_id,
    manager_type,
    effective_date,
    status,
    notes,
    created_by,
    updated_by
  )
  select
    p_employee_id,
    v_tenant_id,
    parsed.manager_employee_id,
    parsed.manager_type,
    parsed.effective_date,
    parsed.status,
    parsed.notes,
    auth.uid(),
    auth.uid()
  from jsonb_populate_recordset(
    null::public.employee_reporting_lines,
    v_rows
  ) as parsed
  where parsed.manager_employee_id is not null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function public.hr_replace_employee_reporting_lines(uuid, jsonb)
from public, anon;

grant execute on function public.hr_replace_employee_reporting_lines(uuid, jsonb)
to authenticated, service_role;

comment on function public.hr_replace_employee_reporting_lines(uuid, jsonb) is
'Atomically replaces one same-tenant employee reporting setup. Existing employee_reporting_lines RLS remains authoritative; hierarchy integrity is enforced by trigger.';

commit;