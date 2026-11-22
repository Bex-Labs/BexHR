-- BexHR Phase 3: manager-owned goals, optional hierarchy, locked review definitions.
-- Copy into a NEW CLI-generated migration. Existing rows are preserved.
begin;
set local lock_timeout = '5s';

-- Abort rather than accidentally leave an unknown permissive write policy in place.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in ('pa_department_goals','pa_individual_goals')
      and cmd in ('INSERT','UPDATE','ALL') and policyname not in (
        'PA HR Admin can create department goals','PA HR Admin can update department goals',
        'PA HR Admin can create individual goals','PA HR Admin can update individual goals',
        'PA managers create department goals','PA managers update department goals',
        'PA primary managers create individual goals','PA primary managers update individual goals')
  ) then raise exception 'Unexpected goal write policy: inspect pg_policies before applying this migration'; end if;
end $$;

create schema if not exists bex_pa_private;
revoke all on schema bex_pa_private from public, anon;
grant usage on schema bex_pa_private to authenticated;

-- Internal lookup needs access to reporting/profile master data independently of
-- their UI RLS. Never expose this schema through the Data API. No dynamic SQL.
create or replace function bex_pa_private.is_manager_of(p_employee uuid, p_primary_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    join public.employees m on m.id = public.pa_current_employee_id() and m.tenant_id = p.tenant_id
    join public.employee_reporting_lines r on r.manager_employee_id = m.id
    join public.employees e on e.id = r.employee_id and e.tenant_id = p.tenant_id
    where p.id = auth.uid() and p.is_active is true and lower(trim(p.role)) = 'manager'
      and p.tenant_id = public.current_authenticated_profile_tenant_id()
      and e.id = p_employee and lower(coalesce(e.status, 'active')) = 'active'
      and lower(trim(coalesce(r.status, 'active'))) = 'active'
      and (r.tenant_id is null or r.tenant_id = p.tenant_id)
      and lower(trim(r.manager_type::text)) in ('primary','secondary')
      and (not p_primary_only or lower(trim(r.manager_type::text)) = 'primary')
  );
$$;

create or replace function bex_pa_private.manages_department(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_departments d
    join public.employees e on e.tenant_id = d.tenant_id
      and lower(trim(e.department)) = lower(trim(d.department_name))
    where d.id = p_department and d.tenant_id = public.current_authenticated_profile_tenant_id()
      -- Fail closed if duplicate department names make existing name-based linkage ambiguous.
      and 1 = (select count(*) from public.organization_departments other
        where other.tenant_id = d.tenant_id and lower(trim(other.department_name)) = lower(trim(d.department_name)))
      and bex_pa_private.is_manager_of(e.id, false)
  );
$$;

create or replace function bex_pa_private.goal_definition_locked(p_tenant uuid, p_employee uuid, p_cycle text)
returns boolean language sql volatile security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.pa_employee_appraisals a
    where a.tenant_id = p_tenant and a.employee_id = p_employee and a.cycle_id = p_cycle
      and (exists (select 1 from public.pa_self_appraisals s where s.tenant_id = a.tenant_id
        and s.appraisal_id = a.id and lower(s.status) = 'submitted')
      or exists (select 1 from public.pa_manager_appraisals m where m.tenant_id = a.tenant_id
        and m.appraisal_id = a.id and lower(m.status) = 'submitted')
      or exists (select 1 from public.pa_hr_finalisations h where h.tenant_id = a.tenant_id
        and h.appraisal_id = a.id and lower(h.status) = 'finalised')
      or exists (select 1 from public.pa_employee_acknowledgements k where k.tenant_id = a.tenant_id
        and k.appraisal_id = a.id and lower(k.status) = 'acknowledged'))
  );
$$;

revoke all on function bex_pa_private.is_manager_of(uuid,boolean) from public, anon;
revoke all on function bex_pa_private.manages_department(uuid) from public, anon;
revoke all on function bex_pa_private.goal_definition_locked(uuid,uuid,text) from public, anon;
grant execute on function bex_pa_private.is_manager_of(uuid,boolean) to authenticated;
grant execute on function bex_pa_private.manages_department(uuid) to authenticated;
-- Do not expose lock lookups as a freely callable oracle; trigger owner calls it.
revoke all on function bex_pa_private.goal_definition_locked(uuid,uuid,text) from authenticated;

alter table public.pa_department_goals enable row level security;
alter table public.pa_individual_goals enable row level security;
revoke all on public.pa_department_goals, public.pa_individual_goals from anon;
revoke delete on public.pa_department_goals, public.pa_individual_goals from authenticated;
grant select, insert, update on public.pa_department_goals, public.pa_individual_goals to authenticated;

drop policy if exists "PA HR Admin can create department goals" on public.pa_department_goals;
drop policy if exists "PA HR Admin can update department goals" on public.pa_department_goals;
drop policy if exists "PA HR Admin can create individual goals" on public.pa_individual_goals;
drop policy if exists "PA HR Admin can update individual goals" on public.pa_individual_goals;
drop policy if exists "PA managers create department goals" on public.pa_department_goals;
drop policy if exists "PA managers update department goals" on public.pa_department_goals;
drop policy if exists "PA primary managers create individual goals" on public.pa_individual_goals;
drop policy if exists "PA primary managers update individual goals" on public.pa_individual_goals;

create policy "PA managers create department goals" on public.pa_department_goals for insert to authenticated
with check (tenant_id = public.current_authenticated_profile_tenant_id()
  and bex_pa_private.manages_department(department_id));
create policy "PA managers update department goals" on public.pa_department_goals for update to authenticated
using (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.manages_department(department_id))
with check (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.manages_department(department_id));
create policy "PA primary managers create individual goals" on public.pa_individual_goals for insert to authenticated
with check (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.is_manager_of(employee_id, true));
create policy "PA primary managers update individual goals" on public.pa_individual_goals for update to authenticated
using (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.is_manager_of(employee_id, true))
with check (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.is_manager_of(employee_id, true));

-- Retain original HR/employee/primary-manager read access; add secondary-manager read-only access.
drop policy if exists "PA secondary managers read individual goals" on public.pa_individual_goals;
create policy "PA secondary managers read individual goals" on public.pa_individual_goals for select to authenticated
using (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.is_manager_of(employee_id, false));
drop policy if exists "PA secondary managers read progress" on public.pa_progress_updates;
create policy "PA secondary managers read progress" on public.pa_progress_updates for select to authenticated
using (tenant_id = public.current_authenticated_profile_tenant_id() and bex_pa_private.is_manager_of(employee_id, false));

-- Integrity guard validates relational columns AND the JSON body used by the UI.
create or replace function bex_pa_private.validate_goal_write()
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
  select department_name into v_department from public.organization_departments
    where id = new.department_id and tenant_id = new.tenant_id;
  if not found then raise exception 'Department does not belong to the goal tenant'; end if;
  if jsonb_typeof(new.payload) <> 'object' or new.payload->>'id' is distinct from new.id
    or new.payload->>'cycleId' is distinct from new.cycle_id
    or new.payload->>'departmentId' is distinct from new.department_id::text
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
revoke all on function bex_pa_private.validate_goal_write() from public, anon, authenticated;
drop trigger if exists pa_validate_department_goal_write on public.pa_department_goals;
create trigger pa_validate_department_goal_write before insert or update on public.pa_department_goals
for each row execute function bex_pa_private.validate_goal_write();
drop trigger if exists pa_validate_individual_goal_write on public.pa_individual_goals;
create trigger pa_validate_individual_goal_write before insert or update on public.pa_individual_goals
for each row execute function bex_pa_private.validate_goal_write();

-- Self submission uses the same lock. Submitted forms cannot quietly revert to Draft.
create or replace function bex_pa_private.lock_goal_review_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_appraisal public.pa_employee_appraisals%rowtype; v_responses jsonb;
begin
  if auth.uid() is null then
    if current_setting('role', true) in ('authenticated','anon') then raise exception 'Authentication required' using errcode='42501'; end if;
    return new;
  end if;
  if new.tenant_id is distinct from public.current_authenticated_profile_tenant_id()
    or new.employee_id is distinct from public.pa_current_employee_id() then
    raise exception 'Only the employee can write their self-appraisal' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.appraisal_id is distinct from old.appraisal_id
    or new.employee_id is distinct from old.employee_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'Self-appraisal identity cannot change';
  end if;
  if tg_op='UPDATE' and lower(old.status)='submitted' and new is distinct from old then
    raise exception 'Submitted self-appraisals require an explicit authorised reopening workflow';
  end if;
  select * into v_appraisal from public.pa_employee_appraisals
    where id=new.appraisal_id and tenant_id=new.tenant_id and employee_id=new.employee_id;
  if not found then raise exception 'Invalid self-appraisal assignment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.employee_id::text || ':' || v_appraisal.cycle_id,0));
  if lower(new.status) = 'submitted' then
    v_responses := coalesce(new.payload->'goalResponses','[]'::jsonb);
    if jsonb_typeof(v_responses) <> 'array' then raise exception 'Goal responses must be an array'; end if;
    if jsonb_array_length(v_responses) <> (select count(*) from public.pa_individual_goals g
      where g.tenant_id=new.tenant_id and g.employee_id=new.employee_id and g.cycle_id=v_appraisal.cycle_id)
      or exists (select 1 from jsonb_array_elements(v_responses) response
        where not exists (select 1 from public.pa_individual_goals g where g.id=response->>'individualGoalId'
          and g.tenant_id=new.tenant_id and g.employee_id=new.employee_id and g.cycle_id=v_appraisal.cycle_id))
      or jsonb_array_length(v_responses) <> (select count(distinct response->>'individualGoalId')
        from jsonb_array_elements(v_responses) response) then
      raise exception 'Assigned goals changed: reload the self-appraisal before submitting';
    end if;
  end if;
  return new;
end $$;
revoke all on function bex_pa_private.lock_goal_review_scope() from public, anon, authenticated;
drop trigger if exists pa_lock_goal_review_scope on public.pa_self_appraisals;
create trigger pa_lock_goal_review_scope before insert or update on public.pa_self_appraisals
for each row execute function bex_pa_private.lock_goal_review_scope();
commit;
