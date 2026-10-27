-- BEXHR R-13 PA CYCLE INTEGRITY
-- Production-safe, idempotent deployment SQL for the current PA model.
-- Scope:
--   1. one employee + one cycle = one appraisal;
--   2. every employee appraisal belongs to a cycle;
--   3. acknowledged appraisal history cannot be mutated through normal PA writes;
--   4. completed cycles cannot be reopened/edited;
--   5. cycle activation + employee appraisal creation is atomic;
--   6. active employees are included regardless of employee/system role.
--
-- This script intentionally does NOT add executive approval or top-level employee logic.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- PREFLIGHT: stop rather than silently rewriting inconsistent data.
-- ---------------------------------------------------------------------------
do $bexhr_pa_cycle_integrity_preflight$
begin
  if to_regclass('public.pa_cycles') is null then
    raise exception 'R-13 stopped: public.pa_cycles is missing.';
  end if;

  if to_regclass('public.pa_templates') is null then
    raise exception 'R-13 stopped: public.pa_templates is missing.';
  end if;

  if to_regclass('public.pa_employee_appraisals') is null then
    raise exception 'R-13 stopped: public.pa_employee_appraisals is missing.';
  end if;

  if to_regclass('public.pa_self_appraisals') is null
     or to_regclass('public.pa_manager_appraisals') is null
     or to_regclass('public.pa_hr_finalisations') is null
     or to_regclass('public.pa_employee_acknowledgements') is null
     or to_regclass('public.pa_individual_goals') is null
     or to_regclass('public.pa_progress_updates') is null then
    raise exception 'R-13 stopped: one or more PA history tables are missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'R-13 stopped: public.employees is missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'R-13 stopped: tenant identity helper is missing.';
  end if;

  if to_regprocedure('public.pa_current_user_is_hr_admin()') is null then
    raise exception 'R-13 stopped: PA HR Admin authorization helper is missing.';
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    where appraisal.cycle_id is null
  ) then
    raise exception 'R-13 stopped: pa_employee_appraisals contains a null cycle_id.';
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    group by appraisal.tenant_id, appraisal.cycle_id, appraisal.employee_id
    having count(*) > 1
  ) then
    raise exception 'R-13 stopped: duplicate employee + cycle appraisal records exist.';
  end if;
end;
$bexhr_pa_cycle_integrity_preflight$;

-- ---------------------------------------------------------------------------
-- CORE DATABASE INVARIANTS.
-- ---------------------------------------------------------------------------
alter table public.pa_employee_appraisals
  alter column cycle_id set not null;

do $bexhr_pa_cycle_unique_constraint$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.pa_employee_appraisals'::regclass
      and constraint_row.conname = 'pa_employee_appraisals_tenant_cycle_employee_unique'
  ) then
    alter table public.pa_employee_appraisals
      add constraint pa_employee_appraisals_tenant_cycle_employee_unique
      unique (tenant_id, cycle_id, employee_id);
  end if;
end;
$bexhr_pa_cycle_unique_constraint$;

-- Private trigger functions remain outside the exposed API schema surface.
create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- APPRAISAL IDENTITY + ACKNOWLEDGED HISTORY LOCK.
--
-- An appraisal may change status/payload during the normal workflow, but it may
-- never be moved to another employee/cycle/tenant. Once acknowledged, normal PA
-- updates to the parent record are blocked entirely.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_employee_appraisal_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.id is distinct from new.id
     or old.tenant_id is distinct from new.tenant_id
     or old.employee_id is distinct from new.employee_id
     or old.cycle_id is distinct from new.cycle_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_APPRAISAL_IDENTITY_LOCK: An appraisal cannot be moved to another employee or appraisal cycle.';
  end if;

  if exists (
    select 1
    from public.pa_employee_acknowledgements acknowledgement
    where acknowledgement.tenant_id = old.tenant_id
      and acknowledgement.appraisal_id = old.id
      and acknowledgement.employee_id = old.employee_id
      and lower(trim(coalesce(acknowledgement.status, ''))) = 'acknowledged'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_HISTORICAL_APPRAISAL_LOCK: An acknowledged appraisal is historical and cannot be changed.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_pa_employee_appraisal_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_pa_employee_appraisal_integrity
on public.pa_employee_appraisals;

create trigger bexhr_enforce_pa_employee_appraisal_integrity
before update of id, tenant_id, employee_id, cycle_id, status, payload, manager_employee_id
on public.pa_employee_appraisals
for each row
execute function bexhr_private.enforce_pa_employee_appraisal_integrity();

-- ---------------------------------------------------------------------------
-- ACKNOWLEDGED COMPONENT LOCK.
--
-- Freeze submitted/finalised component rows once the employee has acknowledged
-- the parent appraisal. DELETE remains untouched because the existing Platform
-- Admin PA-clear workflow intentionally owns destructive tenant cleanup.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_acknowledged_component_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_appraisal_id text;
  v_tenant_id uuid;
begin
  v_appraisal_id := old.appraisal_id;
  v_tenant_id := old.tenant_id;

  if exists (
    select 1
    from public.pa_employee_acknowledgements acknowledgement
    where acknowledgement.tenant_id = v_tenant_id
      and acknowledgement.appraisal_id = v_appraisal_id
      and lower(trim(coalesce(acknowledgement.status, ''))) = 'acknowledged'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_HISTORICAL_COMPONENT_LOCK: Acknowledged appraisal evidence cannot be changed.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_pa_acknowledged_component_integrity()
from public, anon, authenticated;

do $bexhr_pa_component_triggers$
declare
  v_table_name text;
  v_trigger_name text;
begin
  foreach v_table_name in array array[
    'pa_self_appraisals',
    'pa_manager_appraisals',
    'pa_hr_finalisations',
    'pa_employee_acknowledgements'
  ]
  loop
    v_trigger_name := 'bexhr_lock_acknowledged_' || v_table_name;

    execute format(
      'drop trigger if exists %I on public.%I',
      v_trigger_name,
      v_table_name
    );

    execute format(
      'create trigger %I before update on public.%I for each row execute function bexhr_private.enforce_pa_acknowledged_component_integrity()',
      v_trigger_name,
      v_table_name
    );
  end loop;
end;
$bexhr_pa_component_triggers$;

-- ---------------------------------------------------------------------------
-- HISTORICAL GOAL / PROGRESS LOCK.
--
-- Final appraisal display reads the employee's individual goals and progress
-- for that cycle. Once an appraisal is acknowledged, those underlying records
-- must not be edited or extended through normal authenticated PA writes.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_historical_goal_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_employee_id uuid;
  v_cycle_id text;
begin
  if tg_op = 'INSERT' then
    v_tenant_id := new.tenant_id;
    v_employee_id := new.employee_id;
    v_cycle_id := new.cycle_id;
  else
    v_tenant_id := old.tenant_id;
    v_employee_id := old.employee_id;
    v_cycle_id := old.cycle_id;
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    join public.pa_employee_acknowledgements acknowledgement
      on acknowledgement.tenant_id = appraisal.tenant_id
     and acknowledgement.appraisal_id = appraisal.id
     and acknowledgement.employee_id = appraisal.employee_id
    where appraisal.tenant_id = v_tenant_id
      and appraisal.employee_id = v_employee_id
      and appraisal.cycle_id = v_cycle_id
      and lower(trim(coalesce(acknowledgement.status, ''))) = 'acknowledged'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_HISTORICAL_GOAL_LOCK: Goals for an acknowledged appraisal are historical and cannot be changed.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_pa_historical_goal_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_lock_acknowledged_individual_goal
on public.pa_individual_goals;

create trigger bexhr_lock_acknowledged_individual_goal
before insert or update
on public.pa_individual_goals
for each row
execute function bexhr_private.enforce_pa_historical_goal_integrity();

create or replace function bexhr_private.enforce_pa_historical_progress_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_employee_id uuid;
  v_cycle_id text;
begin
  if tg_op = 'INSERT' then
    v_tenant_id := new.tenant_id;
    v_employee_id := new.employee_id;
    v_cycle_id := new.cycle_id;
  else
    v_tenant_id := old.tenant_id;
    v_employee_id := old.employee_id;
    v_cycle_id := old.cycle_id;
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    join public.pa_employee_acknowledgements acknowledgement
      on acknowledgement.tenant_id = appraisal.tenant_id
     and acknowledgement.appraisal_id = appraisal.id
     and acknowledgement.employee_id = appraisal.employee_id
    where appraisal.tenant_id = v_tenant_id
      and appraisal.employee_id = v_employee_id
      and appraisal.cycle_id = v_cycle_id
      and lower(trim(coalesce(acknowledgement.status, ''))) = 'acknowledged'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_HISTORICAL_PROGRESS_LOCK: Progress for an acknowledged appraisal is historical and cannot be changed.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_pa_historical_progress_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_lock_acknowledged_progress
on public.pa_progress_updates;

create trigger bexhr_lock_acknowledged_progress
before insert or update
on public.pa_progress_updates
for each row
execute function bexhr_private.enforce_pa_historical_progress_integrity();

-- ---------------------------------------------------------------------------
-- COMPLETED CYCLE LOCK.
--
-- The normal Active -> Completed transition is allowed because OLD.status is
-- Active. Once completed, later UPDATE attempts are rejected.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_completed_cycle_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(trim(coalesce(old.status, ''))) = 'completed' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_COMPLETED_CYCLE_LOCK: A completed appraisal cycle is historical and cannot be changed.';
  end if;

  return new;
end;
$function$;

revoke all on function bexhr_private.enforce_pa_completed_cycle_integrity()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_pa_completed_cycle_integrity
on public.pa_cycles;

create trigger bexhr_enforce_pa_completed_cycle_integrity
before update
on public.pa_cycles
for each row
execute function bexhr_private.enforce_pa_completed_cycle_integrity();

-- ---------------------------------------------------------------------------
-- ATOMIC CYCLE ACTIVATION.
--
-- SECURITY INVOKER is intentional: the caller remains subject to the existing
-- PA RLS policies. The function also performs an explicit HR Admin check.
-- All active tenant employees are assigned, without filtering by system role or
-- job title. Top-level reviewer/approver handling remains a later phase.
-- ---------------------------------------------------------------------------
create or replace function public.pa_activate_cycle(
  p_cycle_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_cycle public.pa_cycles%rowtype;
  v_template public.pa_templates%rowtype;
  v_template_id text;
  v_template_snapshot jsonb;
  v_employee_count integer := 0;
  v_appraisal_count integer := 0;
  v_activation_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to activate an appraisal cycle.';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have a tenant context.';
  end if;

  if not public.pa_current_user_is_hr_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only HR Admin can activate an appraisal cycle.';
  end if;

  if nullif(trim(coalesce(p_cycle_id, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'An appraisal cycle is required.';
  end if;

  select cycle.*
  into v_cycle
  from public.pa_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'BEXHR_PA_CYCLE_NOT_FOUND: The appraisal cycle was not found in this company workspace.';
  end if;

  if lower(trim(coalesce(v_cycle.status, ''))) <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_CYCLE_NOT_DRAFT: Only a Draft appraisal cycle can be activated.';
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    where appraisal.tenant_id = v_tenant_id
      and appraisal.cycle_id = v_cycle.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_DRAFT_ASSIGNMENTS_EXIST: This Draft cycle already has appraisal assignments and requires review before activation.';
  end if;

  v_template_id := nullif(trim(coalesce(v_cycle.payload ->> 'templateId', '')), '');

  if v_template_id is null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_MISSING: The appraisal cycle does not have a template.';
  end if;

  select template.*
  into v_template
  from public.pa_templates template
  where template.id = v_template_id
    and template.tenant_id = v_tenant_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_INVALID: The appraisal template was not found in this company workspace.';
  end if;

  if lower(trim(coalesce(v_template.status, ''))) <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_INACTIVE: The appraisal cycle requires an active template.';
  end if;

  v_template_snapshot := jsonb_build_object(
    'id', v_template.id,
    'name', coalesce(v_template.payload ->> 'name', ''),
    'description', coalesce(v_template.payload ->> 'description', ''),
    'ratingScale', coalesce(v_template.payload -> 'ratingScale', '[]'::jsonb),
    'competencies', coalesce(v_template.payload -> 'competencies', '[]'::jsonb)
  );

  select count(*)
  into v_employee_count
  from public.employees employee
  where employee.tenant_id = v_tenant_id
    and lower(trim(coalesce(employee.status, 'active'))) = 'active';

  if v_employee_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_NO_ACTIVE_EMPLOYEES: The cycle cannot be activated because there are no active employees.';
  end if;

  with eligible_employees as (
    select
      employee.id,
      coalesce(
        nullif(
          trim(
            concat_ws(
              ' ',
              nullif(trim(coalesce(employee.first_name, '')), ''),
              nullif(trim(coalesce(employee.middle_name, '')), ''),
              nullif(trim(coalesce(employee.last_name, '')), '')
            )
          ),
          ''
        ),
        nullif(trim(coalesce(employee.work_email, '')), ''),
        nullif(trim(coalesce(employee.employee_number, '')), ''),
        'Employee'
      ) as employee_name
    from public.employees employee
    where employee.tenant_id = v_tenant_id
      and lower(trim(coalesce(employee.status, 'active'))) = 'active'
  ),
  prepared_appraisals as (
    select
      eligible.id as employee_id,
      eligible.employee_name,
      format(
        'BEX-PA-EMPLOYEE-APPRAISAL-%s-%s',
        v_activation_ms,
        eligible.id
      ) as appraisal_id
    from eligible_employees eligible
  )
  insert into public.pa_employee_appraisals (
    id,
    tenant_id,
    employee_id,
    manager_employee_id,
    cycle_id,
    status,
    payload
  )
  select
    prepared.appraisal_id,
    v_tenant_id,
    prepared.employee_id,
    null,
    v_cycle.id,
    'Draft',
    jsonb_build_object(
      'id', prepared.appraisal_id,
      'cycleId', v_cycle.id,
      'templateId', v_template.id,
      'templateSnapshot', v_template_snapshot,
      'employeeId', prepared.employee_id,
      'employeeName', prepared.employee_name,
      'status', 'Draft'
    )
  from prepared_appraisals prepared;

  get diagnostics v_appraisal_count = row_count;

  if v_appraisal_count <> v_employee_count then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_ASSIGNMENT_COUNT_MISMATCH: Cycle activation did not create one appraisal for every active employee.';
  end if;

  update public.pa_cycles cycle
  set
    status = 'Active',
    payload = jsonb_set(
      coalesce(cycle.payload, '{}'::jsonb),
      '{status}',
      to_jsonb('Active'::text),
      true
    ),
    updated_at = now()
  where cycle.id = v_cycle.id
    and cycle.tenant_id = v_tenant_id
    and lower(trim(coalesce(cycle.status, ''))) = 'draft';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'BEXHR_PA_ACTIVATION_RACE: The appraisal cycle changed while activation was in progress.';
  end if;

  return jsonb_build_object(
    'success', true,
    'cycle_id', v_cycle.id,
    'status', 'Active',
    'appraisal_count', v_appraisal_count
  );
end;
$function$;

comment on function public.pa_activate_cycle(text) is
'Atomically activates one same-tenant Draft PA cycle and creates exactly one Draft employee appraisal for every active tenant employee. Uses SECURITY INVOKER so existing PA RLS remains authoritative.';

revoke all on function public.pa_activate_cycle(text)
from public, anon;

grant execute on function public.pa_activate_cycle(text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- INSTALL-TIME VERIFICATION.
-- ---------------------------------------------------------------------------
do $bexhr_pa_cycle_integrity_verify$
declare
  v_function_oid oid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pa_employee_appraisals'
      and column_name = 'cycle_id'
      and is_nullable <> 'NO'
  ) then
    raise exception 'R-13 verification failed: pa_employee_appraisals.cycle_id is still nullable.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.pa_employee_appraisals'::regclass
      and constraint_row.conname = 'pa_employee_appraisals_tenant_cycle_employee_unique'
      and constraint_row.contype = 'u'
  ) then
    raise exception 'R-13 verification failed: employee + cycle uniqueness is missing.';
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    group by appraisal.tenant_id, appraisal.cycle_id, appraisal.employee_id
    having count(*) > 1
  ) then
    raise exception 'R-13 verification failed: duplicate employee + cycle appraisals exist.';
  end if;

  v_function_oid := to_regprocedure('public.pa_activate_cycle(text)');

  if v_function_oid is null then
    raise exception 'R-13 verification failed: pa_activate_cycle(text) is missing.';
  end if;

  if exists (
    select 1
    from pg_proc procedure_row
    where procedure_row.oid = v_function_oid
      and procedure_row.prosecdef is true
  ) then
    raise exception 'R-13 verification failed: pa_activate_cycle(text) must remain SECURITY INVOKER.';
  end if;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'R-13 verification failed: anon can execute pa_activate_cycle(text).';
  end if;

  if not has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'R-13 verification failed: authenticated cannot execute pa_activate_cycle(text).';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pa_employee_appraisals'::regclass
      and tgname = 'bexhr_enforce_pa_employee_appraisal_integrity'
      and not tgisinternal
  ) then
    raise exception 'R-13 verification failed: appraisal history trigger is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pa_cycles'::regclass
      and tgname = 'bexhr_enforce_pa_completed_cycle_integrity'
      and not tgisinternal
  ) then
    raise exception 'R-13 verification failed: completed-cycle trigger is missing.';
  end if;
end;
$bexhr_pa_cycle_integrity_verify$;

commit;
