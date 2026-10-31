-- BEXHR PA PERSONA INTEGRITY
-- 2026-10-31
--
-- Browser + database integrity for:
--   * cycle-specific My Appraisal participation
--   * immutable manager reviewer snapshots
--   * Primary-only department-goal authority
--   * HR Standard current participant goal scope
--   * nullable department on legitimate Whole-organization individual goals
--
-- No HR Admin company-wide appraisal visibility is removed.

begin;

do $preflight$
begin
  if to_regclass('public.pa_cycles') is null
     or to_regclass('public.pa_employee_appraisals') is null
     or to_regclass('public.pa_self_appraisals') is null
     or to_regclass('public.pa_manager_appraisals') is null
     or to_regclass('public.pa_individual_goals') is null
     or to_regclass('public.pa_progress_updates') is null
     or to_regclass('public.employee_reporting_lines') is null then
    raise exception
      'PA persona integrity stopped: one or more required PA/reporting tables are missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null
     or to_regprocedure('public.pa_current_employee_id()') is null
     or to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)') is null
     or to_regprocedure('bex_pa_private.validate_goal_write()') is null
     or to_regprocedure('bexhr_private.is_whole_organization_employee(uuid)') is null then
    raise exception
      'PA persona integrity stopped: one or more required authorization helpers are missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pa_employee_appraisals'
      and column_name = 'manager_employee_id'
  ) then
    raise exception
      'PA persona integrity stopped: reviewer snapshot column is missing.';
  end if;
end;
$preflight$;


-- ---------------------------------------------------------------------------
-- Whole-organization individual goals.
-- Department goals remain department-bound; only individual goals become
-- nullable because legitimate Whole-organization employees have no department.
-- ---------------------------------------------------------------------------

alter table public.pa_individual_goals
  alter column department_id drop not null;


-- ---------------------------------------------------------------------------
-- Department goal authority is Primary-only.
-- Existing policies already call manages_department(), so replacing the helper
-- tightens both INSERT and UPDATE without adding a competing authorization path.
-- ---------------------------------------------------------------------------

create or replace function bex_pa_private.manages_department(
  p_department uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.organization_departments department
      join public.employees employee
        on employee.tenant_id = department.tenant_id
       and lower(trim(coalesce(employee.department, ''))) =
           lower(trim(coalesce(department.department_name, '')))
      where department.id = p_department
        and department.tenant_id =
            public.current_authenticated_profile_tenant_id()
        and lower(trim(coalesce(employee.status, 'active'))) = 'active'
        and 1 = (
          select count(*)
          from public.organization_departments other
          where other.tenant_id = department.tenant_id
            and lower(trim(coalesce(other.department_name, ''))) =
                lower(trim(coalesce(department.department_name, '')))
        )
        and bex_pa_private.is_manager_of(
          employee.id,
          true
        )
    );
$function$;


-- ---------------------------------------------------------------------------
-- Individual-goal validator cloned from the existing canonical validator.
-- Only this table receives the nullable Whole-organization rule.
-- ---------------------------------------------------------------------------

create or replace function bex_pa_private.validate_individual_goal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.pa_cycles%rowtype;
  v_parent jsonb;
  v_parent_cycle text;
  v_parent_department uuid;
  v_parent_id text;
  v_start date;
  v_due date;
  v_department text;
  v_employee_department text;
begin
  -- Trusted service/admin maintenance is not a browser write. Preserve admin reset actions.
  if auth.uid() is null then
    if current_setting('role', true) in ('authenticated','anon') then
      raise exception 'Authentication required' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from public.current_authenticated_profile_tenant_id() then
    raise exception 'Goal tenant mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
    or new.cycle_id is distinct from old.cycle_id or new.department_id is distinct from old.department_id) then
    raise exception 'Goal identity, tenant, cycle and department cannot change';
  end if;
  select * into v_cycle from public.pa_cycles where id = new.cycle_id and tenant_id = new.tenant_id;
  if not found or lower(coalesce(v_cycle.status,'')) = 'closed' then raise exception 'An open appraisal cycle is required'; end if;
  if new.department_id is null then
    if not bexhr_private.is_whole_organization_employee(new.employee_id) then
      raise exception 'Department is required unless the individual goal belongs to a Whole organization employee';
    end if;
    v_department := null;
  else
    select department_name into v_department from public.organization_departments
      where id = new.department_id and tenant_id = new.tenant_id;
    if not found then raise exception 'Department does not belong to the goal tenant'; end if;
  end if;
  if jsonb_typeof(new.payload) <> 'object' or new.payload->>'id' is distinct from new.id
    or new.payload->>'cycleId' is distinct from new.cycle_id
    or nullif(trim(coalesce(new.payload->>'departmentId','')), '') is distinct from new.department_id::text
    or lower(trim(coalesce(new.payload->>'department',''))) <> lower(trim(v_department))
    or new.payload->>'status' is distinct from new.status then
    raise exception 'Goal JSON identity does not match its database columns';
  end if;
  if nullif(trim(new.payload->>'title'),'') is null or nullif(trim(new.payload->>'description'),'') is null
    or nullif(trim(new.payload->>'target'),'') is null or nullif(trim(new.status),'') is null then
    raise exception 'Required goal fields are missing';
  end if;
  v_start := (new.payload->>'startDate')::date;
  v_due := (new.payload->>'dueDate')::date;
  if v_start is null or v_due is null or v_due < v_start
    or (v_cycle.payload->>'startDate')::date is null or (v_cycle.payload->>'endDate')::date is null
    or v_start < (v_cycle.payload->>'startDate')::date or v_due > (v_cycle.payload->>'endDate')::date then
    raise exception 'Goal dates must fall within the appraisal cycle';
  end if;
  if tg_table_name = 'pa_individual_goals' then
    if not bex_pa_private.is_manager_of(new.employee_id,true) then raise exception 'Primary Manager authority required' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then raise exception 'Goal employee cannot change'; end if;
    if new.payload->>'employeeId' is distinct from new.employee_id::text then raise exception 'Goal employee JSON mismatch'; end if;
    select department into v_employee_department from public.employees
      where id = new.employee_id and tenant_id = new.tenant_id;
    if not found or lower(trim(coalesce(v_employee_department,''))) <> lower(trim(v_department)) then
      raise exception 'Goal department must match the employee department';
    end if;
    -- Serialize goal writes with self-appraisal submission for the same employee/cycle.
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.employee_id::text || ':' || new.cycle_id,0));
    if bex_pa_private.goal_definition_locked(new.tenant_id,new.employee_id,new.cycle_id) then
      raise exception 'Goal definitions are locked after self-appraisal submission';
    end if;
    v_parent_id := nullif(new.payload->>'departmentGoalId','');
    if v_parent_id is not null then
      select payload,cycle_id,department_id into v_parent,v_parent_cycle,v_parent_department
        from public.pa_department_goals where id = v_parent_id and tenant_id = new.tenant_id;
      if not found or v_parent_department is distinct from new.department_id then
        raise exception 'Linked department goal must belong to the same tenant and department';
      end if;
    end if;
  else
    if not bex_pa_private.manages_department(new.department_id) then raise exception 'Department Manager scope required' using errcode = '42501'; end if;
    if nullif(trim(new.payload->>'owner'),'') is null then raise exception 'Department goal owner is required'; end if;
    v_parent_id := nullif(new.payload->>'organisationGoalId','');
    if v_parent_id is not null then
      select payload,cycle_id into v_parent,v_parent_cycle from public.pa_organisation_goals
        where id = v_parent_id and tenant_id = new.tenant_id;
      if not found then raise exception 'Linked organisation goal must belong to the same tenant'; end if;
    end if;
  end if;
  if v_parent_id is not null and (v_parent_cycle is distinct from new.cycle_id
    or (v_parent->>'startDate')::date is null or (v_parent->>'dueDate')::date is null
    or v_start < (v_parent->>'startDate')::date or v_due > (v_parent->>'dueDate')::date) then
    raise exception 'Linked goal must share the cycle and contain the child goal dates';
  end if;
  return new;
end $$;

revoke all
on function bex_pa_private.validate_individual_goal_write()
from public, anon, authenticated;

do $replace_individual_goal_validator$
declare
  trigger_record record;
  removed_count integer := 0;
begin
  for trigger_record in
    select trigger_row.tgname
    from pg_trigger trigger_row
    join pg_proc procedure_row
      on procedure_row.oid = trigger_row.tgfoid
    join pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where trigger_row.tgrelid =
          'public.pa_individual_goals'::regclass
      and trigger_row.tgisinternal is false
      and namespace_row.nspname = 'bex_pa_private'
      and procedure_row.proname = 'validate_goal_write'
  loop
    execute format(
      'drop trigger %I on public.pa_individual_goals',
      trigger_record.tgname
    );
    removed_count := removed_count + 1;
  end loop;

  if removed_count = 0 then
    raise exception
      'PA persona integrity stopped: existing individual-goal validator trigger was not found.';
  end if;
end;
$replace_individual_goal_validator$;

drop trigger if exists bexhr_validate_individual_goal_write
on public.pa_individual_goals;

create trigger bexhr_validate_individual_goal_write
before insert or update
on public.pa_individual_goals
for each row
execute function bex_pa_private.validate_individual_goal_write();


-- ---------------------------------------------------------------------------
-- Snapshot reviewer authorization helpers.
-- These are boolean authorization helpers only. They keep an original reviewer
-- authorized for the Active cycle even if the live reporting line later changes.
-- ---------------------------------------------------------------------------

create or replace function bex_pa_private.current_user_owns_active_pa_review(
  p_employee_id uuid,
  p_cycle_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.pa_employee_appraisals appraisal
      join public.pa_cycles cycle
        on cycle.id = appraisal.cycle_id
       and cycle.tenant_id = appraisal.tenant_id
      where appraisal.tenant_id =
            public.current_authenticated_profile_tenant_id()
        and appraisal.employee_id = p_employee_id
        and appraisal.cycle_id = p_cycle_id
        and upper(trim(coalesce(appraisal.manager_review_route, ''))) =
            'PRIMARY_MANAGER'
        and appraisal.manager_employee_id =
            public.pa_current_employee_id()
        and lower(trim(coalesce(cycle.status, ''))) = 'active'
    );
$function$;

revoke all
on function bex_pa_private.current_user_owns_active_pa_review(uuid,text)
from public, anon, authenticated;

grant execute
on function bex_pa_private.current_user_owns_active_pa_review(uuid,text)
to authenticated;


create or replace function bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
  p_appraisal_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.pa_employee_appraisals appraisal
      join public.pa_cycles cycle
        on cycle.id = appraisal.cycle_id
       and cycle.tenant_id = appraisal.tenant_id
      where appraisal.id = p_appraisal_id
        and appraisal.tenant_id =
            public.current_authenticated_profile_tenant_id()
        and upper(trim(coalesce(appraisal.manager_review_route, ''))) =
            'PRIMARY_MANAGER'
        and appraisal.manager_employee_id =
            public.pa_current_employee_id()
        and lower(trim(coalesce(cycle.status, ''))) = 'active'
    );
$function$;

revoke all
on function bex_pa_private.current_user_owns_active_pa_review_by_appraisal(text)
from public, anon, authenticated;

grant execute
on function bex_pa_private.current_user_owns_active_pa_review_by_appraisal(text)
to authenticated;


-- ---------------------------------------------------------------------------
-- Snapshot reviewer read path.
-- Existing HR/employee/current-reporting policies remain untouched.
-- ---------------------------------------------------------------------------

drop policy if exists
  "PA snapshot reviewer reads active employee appraisals"
on public.pa_employee_appraisals;

create policy
  "PA snapshot reviewer reads active employee appraisals"
on public.pa_employee_appraisals
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_user_owns_active_pa_review(
    employee_id,
    cycle_id
  )
);


drop policy if exists
  "PA snapshot reviewer reads active self appraisals"
on public.pa_self_appraisals;

create policy
  "PA snapshot reviewer reads active self appraisals"
on public.pa_self_appraisals
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
    appraisal_id
  )
);


drop policy if exists
  "PA snapshot reviewer reads active manager appraisals"
on public.pa_manager_appraisals;

create policy
  "PA snapshot reviewer reads active manager appraisals"
on public.pa_manager_appraisals
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
    appraisal_id
  )
);


drop policy if exists
  "PA snapshot reviewer reads active individual goals"
on public.pa_individual_goals;

create policy
  "PA snapshot reviewer reads active individual goals"
on public.pa_individual_goals
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_user_owns_active_pa_review(
    employee_id,
    cycle_id
  )
);


drop policy if exists
  "PA snapshot reviewer reads active progress"
on public.pa_progress_updates;

create policy
  "PA snapshot reviewer reads active progress"
on public.pa_progress_updates
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_user_owns_active_pa_review(
    employee_id,
    cycle_id
  )
);


-- ---------------------------------------------------------------------------
-- Snapshot reviewer write path.
-- Permissive RLS can coexist with legacy current-manager policies, so a trigger
-- below is the final invariant: only the immutable snapshotted reviewer may
-- create/update the manager review for an Active cycle.
-- ---------------------------------------------------------------------------

drop policy if exists
  "PA snapshot reviewer creates manager appraisals"
on public.pa_manager_appraisals;

create policy
  "PA snapshot reviewer creates manager appraisals"
on public.pa_manager_appraisals
for insert
to authenticated
with check (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and manager_employee_id =
    public.pa_current_employee_id()
  and bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
    appraisal_id
  )
);


drop policy if exists
  "PA snapshot reviewer updates manager appraisals"
on public.pa_manager_appraisals;

create policy
  "PA snapshot reviewer updates manager appraisals"
on public.pa_manager_appraisals
for update
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and manager_employee_id =
    public.pa_current_employee_id()
  and bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
    appraisal_id
  )
)
with check (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and manager_employee_id =
    public.pa_current_employee_id()
  and bex_pa_private.current_user_owns_active_pa_review_by_appraisal(
    appraisal_id
  )
);


create or replace function bexhr_private.enforce_pa_snapshot_reviewer_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_appraisal_tenant_id uuid;
  v_appraisal_employee_id uuid;
  v_snapshot_manager_employee_id uuid;
  v_review_route text;
  v_cycle_status text;
  v_current_employee_id uuid;
begin
  -- Trusted service/admin maintenance is not a browser write.
  if auth.uid() is null then
    if current_setting('role', true) in ('authenticated', 'anon') then
      raise exception
        'Authentication required'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.tenant_id is distinct from
     public.current_authenticated_profile_tenant_id() then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_REVIEW_TENANT_MISMATCH: Manager review tenant does not match the authenticated company workspace.';
  end if;

  select
    appraisal.tenant_id,
    appraisal.employee_id,
    appraisal.manager_employee_id,
    appraisal.manager_review_route,
    cycle.status
  into
    v_appraisal_tenant_id,
    v_appraisal_employee_id,
    v_snapshot_manager_employee_id,
    v_review_route,
    v_cycle_status
  from public.pa_employee_appraisals appraisal
  join public.pa_cycles cycle
    on cycle.id = appraisal.cycle_id
   and cycle.tenant_id = appraisal.tenant_id
  where appraisal.id = new.appraisal_id;

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEW_PARENT_MISSING: The manager review does not reference a valid employee appraisal.';
  end if;

  if new.tenant_id is distinct from v_appraisal_tenant_id
     or new.employee_id is distinct from v_appraisal_employee_id then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEW_PARENT_MISMATCH: Manager review employee/tenant must match the parent appraisal.';
  end if;

  if upper(trim(coalesce(v_review_route, ''))) <>
     'PRIMARY_MANAGER'
     or v_snapshot_manager_employee_id is null then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEW_ROUTE_BLOCKED: This appraisal is not assigned to a Primary Manager reviewer.';
  end if;

  if lower(trim(coalesce(v_cycle_status, ''))) <> 'active' then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEW_CYCLE_NOT_ACTIVE: Manager review actions require an Active appraisal cycle.';
  end if;

  if new.manager_employee_id is distinct from
     v_snapshot_manager_employee_id then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_REVIEWER_MISMATCH: The manager review must remain owned by the snapshotted reviewer.';
  end if;

  v_current_employee_id :=
    public.pa_current_employee_id();

  if v_current_employee_id is distinct from
     v_snapshot_manager_employee_id then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_REVIEWER_FORBIDDEN: Only the snapshotted reviewer can write this manager review.';
  end if;

  if nullif(
       trim(
         coalesce(
           new.payload ->> 'managerEmployeeId',
           ''
         )
       ),
       ''
     ) is distinct from
     v_snapshot_manager_employee_id::text then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEWER_PAYLOAD_MISMATCH: Manager review payload reviewer must match the relational reviewer snapshot.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_pa_snapshot_reviewer_write()
from public, anon, authenticated;

drop trigger if exists
  bexhr_enforce_pa_snapshot_reviewer_write
on public.pa_manager_appraisals;

create trigger
  bexhr_enforce_pa_snapshot_reviewer_write
before insert or update
on public.pa_manager_appraisals
for each row
execute function
  bexhr_private.enforce_pa_snapshot_reviewer_write();


-- ---------------------------------------------------------------------------
-- Install-time verification.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_manages_department_definition text;
  v_validator_definition text;
  v_policy_count integer;
begin
  if (
    select column_row.is_nullable
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'pa_individual_goals'
      and column_row.column_name = 'department_id'
  ) <> 'YES' then
    raise exception
      'PA persona integrity verification failed: individual goal department_id is still NOT NULL.';
  end if;

  select pg_get_functiondef(
    'bex_pa_private.manages_department(uuid)'::regprocedure
  )
  into v_manages_department_definition;

  if position(
    'is_manager_of('
    in lower(v_manages_department_definition)
  ) = 0
     or position(
       'true'
       in lower(v_manages_department_definition)
     ) = 0 then
    raise exception
      'PA persona integrity verification failed: department authority is not visibly Primary-only.';
  end if;

  select pg_get_functiondef(
    'bex_pa_private.validate_individual_goal_write()'::regprocedure
  )
  into v_validator_definition;

  if position(
    'is_whole_organization_employee'
    in lower(v_validator_definition)
  ) = 0 then
    raise exception
      'PA persona integrity verification failed: Whole-organization individual-goal guard is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.pa_individual_goals'::regclass
      and trigger_row.tgname =
          'bexhr_validate_individual_goal_write'
      and trigger_row.tgisinternal is false
  ) then
    raise exception
      'PA persona integrity verification failed: individual-goal validator trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.pa_manager_appraisals'::regclass
      and trigger_row.tgname =
          'bexhr_enforce_pa_snapshot_reviewer_write'
      and trigger_row.tgisinternal is false
  ) then
    raise exception
      'PA persona integrity verification failed: reviewer write trigger is missing.';
  end if;

  select count(*)
  into v_policy_count
  from pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.policyname in (
      'PA snapshot reviewer reads active employee appraisals',
      'PA snapshot reviewer reads active self appraisals',
      'PA snapshot reviewer reads active manager appraisals',
      'PA snapshot reviewer reads active individual goals',
      'PA snapshot reviewer reads active progress',
      'PA snapshot reviewer creates manager appraisals',
      'PA snapshot reviewer updates manager appraisals'
    );

  if v_policy_count <> 7 then
    raise exception
      'PA persona integrity verification failed: snapshot reviewer policies are incomplete.';
  end if;

  if has_function_privilege(
    'anon',
    'bexhr_private.enforce_pa_snapshot_reviewer_write()',
    'EXECUTE'
  )
     or has_function_privilege(
       'authenticated',
       'bexhr_private.enforce_pa_snapshot_reviewer_write()',
       'EXECUTE'
     ) then
    raise exception
      'PA persona integrity verification failed: private reviewer trigger function is directly executable by browser roles.';
  end if;
end;
$verify$;

commit;
