-- LEAVE TYPE CLASSIFICATION - STEP 5I
-- Purpose:
-- Replace the earlier Annual Leave-only auto-allocation trigger with a
-- complete default leave balance allocation rule.
--
-- HR behaviour:
-- - Annual Leave: all active employees, 21 days.
-- - Sick Leave: all active employees, 10 days.
-- - Compassionate Leave: all active employees, 5 days.
-- - Maternity Leave: female employees only, 90 days.
-- - Paternity Leave: male employees only, 10 days.
--
-- Safety:
-- - Existing balances are not reset.
-- - Existing used days are not overwritten.
-- - Existing remaining days are not recalculated.
-- - UNIQUE(employee_id, leave_type_id) prevents duplicate balance rows.
-- - Gender-specific balances are only created when employee gender is eligible.

create or replace function public.ensure_default_leave_balances_for_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_status text;
  employee_gender text;
begin
  employee_status := lower(trim(coalesce(new.status, 'active')));
  employee_gender := lower(trim(coalesce(new.gender, '')));

  if employee_status <> 'active' then
    return new;
  end if;

  -- All active employees receive these default entitlement-based balances.
  insert into public.employee_leave_balances (
    employee_id,
    leave_type_id,
    entitled_days,
    used_days,
    remaining_days
  )
  select
    new.id,
    lt.id,
    case upper(trim(coalesce(lt.code, '')))
      when 'ANNUAL' then 21
      when 'SICK' then 10
      when 'COMPASSIONATE' then 5
    end,
    0,
    case upper(trim(coalesce(lt.code, '')))
      when 'ANNUAL' then 21
      when 'SICK' then 10
      when 'COMPASSIONATE' then 5
    end
  from public.leave_types lt
  where coalesce(lt.is_active, true) = true
    and upper(trim(coalesce(lt.code, ''))) in ('ANNUAL', 'SICK', 'COMPASSIONATE')
  on conflict (employee_id, leave_type_id) do nothing;

  -- Maternity Leave is created only for eligible female employees.
  if employee_gender in ('female', 'woman') then
    insert into public.employee_leave_balances (
      employee_id,
      leave_type_id,
      entitled_days,
      used_days,
      remaining_days
    )
    select
      new.id,
      lt.id,
      90,
      0,
      90
    from public.leave_types lt
    where coalesce(lt.is_active, true) = true
      and upper(trim(coalesce(lt.code, ''))) = 'MATERNITY'
    on conflict (employee_id, leave_type_id) do nothing;
  end if;

  -- Paternity Leave is created only for eligible male employees.
  if employee_gender in ('male', 'man') then
    insert into public.employee_leave_balances (
      employee_id,
      leave_type_id,
      entitled_days,
      used_days,
      remaining_days
    )
    select
      new.id,
      lt.id,
      10,
      0,
      10
    from public.leave_types lt
    where coalesce(lt.is_active, true) = true
      and upper(trim(coalesce(lt.code, ''))) = 'PATERNITY'
    on conflict (employee_id, leave_type_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_annual_leave_balance_for_employee
on public.employees;

drop trigger if exists trg_ensure_default_leave_balances_for_employee
on public.employees;

create trigger trg_ensure_default_leave_balances_for_employee
after insert or update of status, gender
on public.employees
for each row
execute function public.ensure_default_leave_balances_for_employee();