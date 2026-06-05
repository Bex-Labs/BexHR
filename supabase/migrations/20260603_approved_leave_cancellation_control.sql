-- LEAVE REQUEST REVERSAL / CANCELLATION CONTROL - STEP 1G
-- Capture approved-leave cancellation/reversal support in source control.
--
-- HR behaviour:
-- - Approved leave must not be silently edited.
-- - HR can cancel/reverse approved leave through a controlled process.
-- - Balance is restored once only.
-- - Cancellation audit records who cancelled it, when, why, the original status,
--   and how many leave days were restored.
--
-- Technical behaviour:
-- - Adds cancellation/reversal audit columns to public.leave_requests.
-- - Adds public.hrp_cancel_approved_leave_once(...).
-- - The RPC locks the leave request row, blocks repeat cancellation, restores
--   balance once, and writes cancellation audit in one transaction.

alter table public.leave_requests
add column if not exists cancelled_at timestamptz,
add column if not exists cancelled_by uuid,
add column if not exists cancelled_by_name text,
add column if not exists cancellation_reason text,
add column if not exists cancelled_from_status text,
add column if not exists balance_restored_at timestamptz,
add column if not exists balance_restored_days numeric;

comment on column public.leave_requests.cancelled_at is
'Timestamp when an approved leave request was cancelled/reversed through the controlled HR cancellation process.';

comment on column public.leave_requests.cancelled_by is
'User ID of the HR user or authorised actor who cancelled/reversed the leave request.';

comment on column public.leave_requests.cancelled_by_name is
'Display name or email of the user who cancelled/reversed the leave request.';

comment on column public.leave_requests.cancellation_reason is
'Mandatory HR reason explaining why the approved leave request was cancelled/reversed.';

comment on column public.leave_requests.cancelled_from_status is
'Original leave request status before cancellation, normally Approved.';

comment on column public.leave_requests.balance_restored_at is
'Timestamp when leave balance was restored as part of cancellation/reversal.';

comment on column public.leave_requests.balance_restored_days is
'Number of leave days restored to the employee balance during cancellation/reversal.';


create or replace function public.hrp_cancel_approved_leave_once(
  p_leave_request_id uuid,
  p_cancellation_reason text
)
returns table (
  id uuid,
  status text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancelled_by_name text,
  cancellation_reason text,
  cancelled_from_status text,
  balance_restored_at timestamptz,
  balance_restored_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_employee_id uuid;
  v_reason text;
  v_actor_name text;
  v_balance public.employee_leave_balances%rowtype;
  v_restore_days numeric;
  v_next_used_days numeric;
  v_next_remaining_days numeric;
begin
  v_reason := nullif(trim(coalesce(p_cancellation_reason, '')), '');

  if v_reason is null then
    raise exception 'A cancellation reason is required.';
  end if;

  select *
  into v_request
  from public.leave_requests lr
  where lr.id = p_leave_request_id
  for update;

  if not found then
    raise exception 'Leave request was not found.';
  end if;

  if v_request.cancelled_at is not null
     or lower(trim(coalesce(v_request.status, ''))) = 'cancelled' then
    raise exception 'This leave request has already been cancelled.';
  end if;

  if lower(trim(coalesce(v_request.status, ''))) <> 'approved' then
    raise exception 'Only approved leave can be cancelled through this process.';
  end if;

  if not public.hrp_is_current_user_hr_for_leave_employee(v_request.employee_id) then
    raise exception 'Only HR can cancel approved leave for this employee.';
  end if;

  select e.id
  into v_employee_id
  from public.employees e
  left join public.profiles leave_profile
    on leave_profile.id = v_request.employee_id
  where
    e.id = v_request.employee_id
    or e.user_id = v_request.employee_id
    or (
      leave_profile.email is not null
      and lower(coalesce(e.work_email, '')) = lower(leave_profile.email)
    )
  order by
    case
      when e.id = v_request.employee_id then 0
      when e.user_id = v_request.employee_id then 1
      else 2
    end
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee record could not be resolved for this leave request.';
  end if;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(p.email), ''),
      'HR'
    )
  into v_actor_name
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  v_actor_name := coalesce(v_actor_name, 'HR');
  v_restore_days := coalesce(v_request.total_days, 0);

  if v_restore_days <= 0 then
    raise exception 'Leave request total days is invalid, so balance cannot be restored.';
  end if;

  select *
  into v_balance
  from public.employee_leave_balances elb
  where elb.employee_id = v_employee_id
    and elb.leave_type_id = v_request.leave_type_id
  for update;

  if not found then
    raise exception 'No leave balance record exists for this employee and leave type.';
  end if;

  v_next_used_days :=
    greatest(coalesce(v_balance.used_days, 0) - v_restore_days, 0);

  v_next_remaining_days :=
    greatest(coalesce(v_balance.entitled_days, 0) - v_next_used_days, 0);

  update public.employee_leave_balances elb
  set
    used_days = v_next_used_days,
    remaining_days = v_next_remaining_days
  where elb.id = v_balance.id;

  return query
  update public.leave_requests lr
  set
    status = 'Cancelled',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancelled_by_name = v_actor_name,
    cancellation_reason = v_reason,
    cancelled_from_status = v_request.status,
    balance_restored_at = now(),
    balance_restored_days = v_restore_days
  where lr.id = v_request.id
  returning
    lr.id,
    lr.status,
    lr.cancelled_at,
    lr.cancelled_by,
    lr.cancelled_by_name,
    lr.cancellation_reason,
    lr.cancelled_from_status,
    lr.balance_restored_at,
    lr.balance_restored_days;
end;
$$;

grant execute on function public.hrp_cancel_approved_leave_once(uuid, text)
to authenticated;