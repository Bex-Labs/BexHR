-- ANNUAL LEAVE ENTITLEMENT ALLOCATION - STEP 4A
-- Purpose:
-- Ensure every newly created active employee receives one Annual Leave
-- balance row with 21 entitled days.
--
-- HR behaviour:
-- - Employee users receive their own Annual Leave balance.
-- - HR users receive their own Annual Leave balance.
-- - Manager users receive their own Annual Leave balance.
-- - Manager approval still consumes the employee's balance, not the manager's.
--
-- Safety:
-- - Existing leave balances are not reset.
-- - Existing used days are not overwritten.
-- - The UNIQUE(employee_id, leave_type_id) guard prevents duplicate rows.

create or replace function public.ensure_annual_leave_balance_for_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  annual_leave_type_id uuid;
  employee_status text;
begin
  -- Treat blank status as active because HR-created employees default to active
  -- unless HR deliberately chooses another status.
  employee_status := lower(coalesce(new.status, 'active'));

  if employee_status <> 'active' then
    return new;
  end if;

  -- Resolve the active Annual Leave type.
  -- Prefer code ANNUAL, with name fallback for resilience.
  select lt.id
  into annual_leave_type_id
  from public.leave_types lt
  where coalesce(lt.is_active, true) = true
    and (
      upper(coalesce(lt.code, '')) = 'ANNUAL'
      or lower(coalesce(lt.name, '')) = 'annual leave'
    )
  order by
    case when upper(coalesce(lt.code, '')) = 'ANNUAL' then 0 else 1 end,
    lt.name
  limit 1;

  if annual_leave_type_id is null then
    return new;
  end if;

  -- Create only the missing Annual Leave balance.
  -- Do not reset any existing balance.
  insert into public.employee_leave_balances (
    employee_id,
    leave_type_id,
    entitled_days,
    used_days,
    remaining_days
  )
  values (
    new.id,
    annual_leave_type_id,
    21,
    0,
    21
  )
  on conflict (employee_id, leave_type_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_ensure_annual_leave_balance_for_employee
on public.employees;

create trigger trg_ensure_annual_leave_balance_for_employee
after insert or update of status
on public.employees
for each row
execute function public.ensure_annual_leave_balance_for_employee();