-- ALPATECH ANNUAL LEAVE ENTITLEMENT RULES
-- Tenant-scoped Annual Leave entitlement for Alpatech only.
--
-- Business rule:
-- - HR / HR Manager / Manager = 15 working days
-- - Senior / Lead / Supervisor = 12 working days
-- - Second Level / Officer / Associate = 10 working days
-- - Junior / Entry = 6 working days
--
-- Safety:
-- - Applies only to Alpatech tenant/company.
-- - Recalculates Annual Leave only.
-- - Preserves used_days.
-- - remaining_days = entitlement - used_days.
-- - Non-Alpatech tenants keep existing/default leave behaviour.

create or replace function public.hrp_recalculate_alpatech_annual_leave_for_employee(
  p_employee_id uuid
)
returns table (
  employee_id uuid,
  employee_name text,
  tenant_id uuid,
  annual_leave_type_id uuid,
  leave_balance_id uuid,
  rule_source text,
  role_value text,
  grade_code text,
  grade_name text,
  grade_snapshot text,
  previous_entitled_days numeric,
  new_entitled_days numeric,
  used_days numeric,
  previous_remaining_days numeric,
  new_remaining_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee record;
  v_payroll_master record;
  v_leave_type_id uuid;
  v_balance record;
  v_updated_balance record;

  v_role text := '';
  v_grade_code text := '';
  v_grade_name text := '';
  v_grade_snapshot text := '';
  v_grade_text text := '';

  v_rule_source text := '';
  v_new_entitlement numeric := null;
  v_new_remaining numeric := null;
begin
  -- Resolve employee and tenant first so this cannot affect other companies.
  select
    e.*,
    t.company_name,
    t.tenant_code
  into v_employee
  from employees e
  inner join tenants t
    on t.id = e.tenant_id
  where e.id = p_employee_id;

  if not found then
    raise exception 'Employee % was not found.', p_employee_id;
  end if;

  if lower(coalesce(v_employee.company_name, '')) not like '%alpatech%'
     and lower(coalesce(v_employee.tenant_code, '')) not like '%alpatech%' then
    raise exception 'Employee % is not in the Alpatech tenant. No leave balance was changed.', p_employee_id;
  end if;

  if lower(coalesce(v_employee.status, '')) <> 'active' then
    raise exception 'Employee % is not active. No leave balance was changed.', p_employee_id;
  end if;

  -- Use latest active payroll master grade when grade-based entitlement is needed.
  select
    pmr_inner.*,
    pgl.grade_code,
    pgl.grade_name
  into v_payroll_master
  from payroll_master_records pmr_inner
  left join payroll_grade_levels pgl
    on pgl.id = pmr_inner.payroll_grade_level_id
  where pmr_inner.employee_id = p_employee_id
  order by
    case when lower(coalesce(pmr_inner.payroll_status, '')) = 'active' then 0 else 1 end,
    pmr_inner.salary_effective_date desc nulls last,
    pmr_inner.updated_at desc nulls last
  limit 1;

  v_role := lower(coalesce(v_employee.system_role, ''));

  if found then
    v_grade_code := coalesce(v_payroll_master.grade_code, '');
    v_grade_name := coalesce(v_payroll_master.grade_name, '');
    v_grade_snapshot := coalesce(v_payroll_master.payroll_grade_level, '');
  else
    v_grade_code := '';
    v_grade_name := '';
    v_grade_snapshot := '';
  end if;

  v_grade_text := lower(concat_ws(' ', v_grade_code, v_grade_name, v_grade_snapshot));

  -- Role override first: HR/Manager staff receive management entitlement.
  if v_role in ('hr', 'hr_manager', 'manager') then
    v_new_entitlement := 15;
    v_rule_source := 'Alpatech management role';

  elsif v_grade_text like '%management%'
     or v_grade_text like '%manager%' then
    v_new_entitlement := 15;
    v_rule_source := 'Alpatech management grade';

  elsif v_grade_text like '%senior%'
     or v_grade_text like '%lead%'
     or v_grade_text like '%supervisor%'
     or v_grade_text like '%gl-04%' then
    v_new_entitlement := 12;
    v_rule_source := 'Alpatech senior staff grade';

  elsif v_grade_text like '%second%'
     or v_grade_text like '%2nd%'
     or v_grade_text like '%officer%'
     or v_grade_text like '%associate%'
     or v_grade_text like '%gl-02%'
     or v_grade_text like '%alp-2nd%' then
    v_new_entitlement := 10;
    v_rule_source := 'Alpatech second level staff grade';

  elsif v_grade_text like '%junior%'
     or v_grade_text like '%entry%' then
    v_new_entitlement := 6;
    v_rule_source := 'Alpatech junior staff grade';

  else
    raise exception
      'Alpatech annual leave entitlement could not be resolved for employee %. Role=%, Grade=%',
      p_employee_id,
      coalesce(v_employee.system_role, ''),
      coalesce(v_grade_text, '');
  end if;

  -- Annual Leave only.
  select lt.id
  into v_leave_type_id
  from leave_types lt
  where lower(coalesce(lt.name, '')) = 'annual leave'
     or lower(coalesce(lt.code, '')) in ('annual', 'annual_leave')
  order by
    case when lower(coalesce(lt.name, '')) = 'annual leave' then 0 else 1 end
  limit 1;

  if v_leave_type_id is null then
    raise exception 'Annual Leave type was not found. No leave balance was changed.';
  end if;

  select elb.*
  into v_balance
  from employee_leave_balances elb
  where elb.employee_id = p_employee_id
    and elb.leave_type_id = v_leave_type_id
  limit 1;

  if not found then
    raise exception 'Annual Leave balance was not found for employee %. No leave balance was changed.', p_employee_id;
  end if;

  v_new_remaining := v_new_entitlement - coalesce(v_balance.used_days, 0);

  update employee_leave_balances
  set
    entitled_days = v_new_entitlement,
    remaining_days = v_new_remaining
  where id = v_balance.id
  returning *
  into v_updated_balance;

  return query
  select
    v_employee.id::uuid,
    concat_ws(' ', v_employee.first_name, v_employee.middle_name, v_employee.last_name)::text,
    v_employee.tenant_id::uuid,
    v_leave_type_id::uuid,
    v_updated_balance.id::uuid,
    v_rule_source::text,
    coalesce(v_employee.system_role, '')::text,
    v_grade_code::text,
    v_grade_name::text,
    v_grade_snapshot::text,
    coalesce(v_balance.entitled_days, 0)::numeric,
    coalesce(v_updated_balance.entitled_days, 0)::numeric,
    coalesce(v_updated_balance.used_days, 0)::numeric,
    coalesce(v_balance.remaining_days, 0)::numeric,
    coalesce(v_updated_balance.remaining_days, 0)::numeric;
end;
$$;

revoke all on function public.hrp_recalculate_alpatech_annual_leave_for_employee(uuid) from public;


create or replace function public.hrp_sync_alpatech_annual_leave_after_payroll_master_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_active_alpatech_employee boolean := false;
begin
  -- Only active Payroll Master rows drive current entitlement.
  if lower(coalesce(new.payroll_status, '')) <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.employee_id is not distinct from old.employee_id
     and new.payroll_grade_level_id is not distinct from old.payroll_grade_level_id
     and new.payroll_grade_level is not distinct from old.payroll_grade_level
     and new.payroll_status is not distinct from old.payroll_status
     and new.salary_effective_date is not distinct from old.salary_effective_date then
    return new;
  end if;

  select exists (
    select 1
    from employees e
    inner join tenants t
      on t.id = e.tenant_id
    where e.id = new.employee_id
      and lower(coalesce(e.status, '')) = 'active'
      and (
        lower(coalesce(t.company_name, '')) like '%alpatech%'
        or lower(coalesce(t.tenant_code, '')) like '%alpatech%'
      )
  )
  into v_is_active_alpatech_employee;

  if not v_is_active_alpatech_employee then
    return new;
  end if;

  perform 1
  from public.hrp_recalculate_alpatech_annual_leave_for_employee(new.employee_id);

  return new;
end;
$$;

drop trigger if exists trg_sync_alpatech_annual_leave_after_payroll_master_change
on public.payroll_master_records;

create trigger trg_sync_alpatech_annual_leave_after_payroll_master_change
after insert or update of
  employee_id,
  payroll_grade_level_id,
  payroll_grade_level,
  payroll_status,
  salary_effective_date
on public.payroll_master_records
for each row
execute function public.hrp_sync_alpatech_annual_leave_after_payroll_master_change();


create or replace function public.hrp_sync_alpatech_annual_leave_after_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_active_alpatech_employee boolean := false;
begin
  if tg_op = 'UPDATE'
     and new.system_role is not distinct from old.system_role
     and new.status is not distinct from old.status
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  select exists (
    select 1
    from tenants t
    where t.id = new.tenant_id
      and lower(coalesce(new.status, '')) = 'active'
      and (
        lower(coalesce(t.company_name, '')) like '%alpatech%'
        or lower(coalesce(t.tenant_code, '')) like '%alpatech%'
      )
  )
  into v_is_active_alpatech_employee;

  if not v_is_active_alpatech_employee then
    return new;
  end if;

  perform 1
  from public.hrp_recalculate_alpatech_annual_leave_for_employee(new.id);

  return new;
end;
$$;

drop trigger if exists trg_sync_alpatech_annual_leave_after_employee_role_change
on public.employees;

create trigger trg_sync_alpatech_annual_leave_after_employee_role_change
after update of
  system_role,
  status,
  tenant_id
on public.employees
for each row
execute function public.hrp_sync_alpatech_annual_leave_after_employee_role_change();


-- Existing-data alignment for active Alpatech employees.
-- This mirrors the tested Step 1F backfill. Any unmapped employee is reported
-- as a warning instead of silently receiving the wrong entitlement.
do $$
declare
  v_employee record;
begin
  for v_employee in
    select e.id
    from employees e
    join tenants t
      on t.id = e.tenant_id
    where lower(coalesce(e.status, '')) = 'active'
      and (
        lower(coalesce(t.company_name, '')) like '%alpatech%'
        or lower(coalesce(t.tenant_code, '')) like '%alpatech%'
      )
  loop
    begin
      perform 1
      from public.hrp_recalculate_alpatech_annual_leave_for_employee(v_employee.id);
    exception
      when others then
        raise warning 'Alpatech annual leave backfill skipped for employee %. Error: %',
          v_employee.id,
          sqlerrm;
    end;
  end loop;
end $$;