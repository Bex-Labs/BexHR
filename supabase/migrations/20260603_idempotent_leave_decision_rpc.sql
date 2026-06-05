-- LEAVE APPROVAL IDEMPOTENCY / DOUBLE-DEDUCTION PROTECTION - STEP 1D
-- Capture transactional, database-level leave decision processing.
--
-- HR behaviour:
-- - A Pending Approval request can be decided once only.
-- - Approval deducts leave balance once only.
-- - Reject/Return save decision audit without deducting balance.
-- - Only the Primary Manager can approve/reject/return.
-- - Additional managers keep visibility only; they do not get decision authority.
--
-- Technical behaviour:
-- - Locks the leave request row with FOR UPDATE.
-- - Refuses any second decision after the request leaves Pending Approval.
-- - Resolves leave_requests.employee_id whether it stores employees.id,
--   employees.user_id, or profiles.id.
-- - Updates balance and decision audit in one database transaction.

create or replace function public.hrp_apply_leave_decision_once(
  p_leave_request_id uuid,
  p_decision_status text,
  p_decision_comment text default null
)
returns table (
  id uuid,
  status text,
  decision_at timestamptz,
  decision_by uuid,
  decision_by_name text,
  decision_comment text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_employee_id uuid;
  v_employee_user_id uuid;
  v_employee_profile_id uuid;
  v_decision_status text;
  v_normalised_status text;
  v_comment text;
  v_manager_name text;
  v_balance public.employee_leave_balances%rowtype;
  v_next_used_days numeric;
  v_next_remaining_days numeric;
begin
  v_normalised_status := lower(trim(coalesce(p_decision_status, '')));
  v_comment := nullif(trim(coalesce(p_decision_comment, '')), '');

  if v_normalised_status = 'approved' then
    v_decision_status := 'Approved';
  elsif v_normalised_status = 'rejected' then
    v_decision_status := 'Rejected';
  elsif v_normalised_status in ('returned', 'returned for clarification') then
    v_decision_status := 'Returned for Clarification';
  else
    raise exception 'Unsupported leave decision status: %', p_decision_status;
  end if;

  if v_normalised_status in ('rejected', 'returned', 'returned for clarification')
     and v_comment is null then
    raise exception 'A manager comment is required when rejecting or returning a leave request.';
  end if;

  select *
  into v_request
  from public.leave_requests lr
  where lr.id = p_leave_request_id
  for update;

  if not found then
    raise exception 'Leave request was not found.';
  end if;

  if lower(trim(coalesce(v_request.status, ''))) <> 'pending approval' then
    raise exception 'This leave request has already been decided and cannot be processed again.';
  end if;

  if not public.hrp_is_current_user_primary_manager_for_leave_employee(v_request.employee_id) then
    raise exception 'Only the primary manager can make this leave decision.';
  end if;

  select
    e.id,
    e.user_id
  into
    v_employee_id,
    v_employee_user_id
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

  select p.id
  into v_employee_profile_id
  from public.profiles p
  join public.employees e
    on lower(coalesce(e.work_email, '')) = lower(coalesce(p.email, ''))
  where e.id = v_employee_id
  limit 1;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(p.email), ''),
      'Manager'
    )
  into v_manager_name
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  v_manager_name := coalesce(v_manager_name, 'Manager');

  if v_decision_status = 'Approved' then
    if exists (
      select 1
      from public.leave_requests existing_lr
      where existing_lr.id <> v_request.id
        and lower(trim(coalesce(existing_lr.status, ''))) = 'approved'
        and existing_lr.employee_id in (
          select identity_id
          from (
            values
              (v_employee_id),
              (v_employee_user_id),
              (v_employee_profile_id)
          ) as identity_values(identity_id)
          where identity_id is not null
        )
        and existing_lr.start_date <= v_request.end_date
        and v_request.start_date <= existing_lr.end_date
    ) then
      raise exception 'This employee already has approved leave overlapping this period.';
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

    if coalesce(v_balance.remaining_days, 0) < coalesce(v_request.total_days, 0) then
      raise exception 'Insufficient leave balance. Remaining: %, requested: %.',
        coalesce(v_balance.remaining_days, 0),
        coalesce(v_request.total_days, 0);
    end if;

    v_next_used_days :=
      coalesce(v_balance.used_days, 0) + coalesce(v_request.total_days, 0);

    v_next_remaining_days :=
      greatest(coalesce(v_balance.entitled_days, 0) - v_next_used_days, 0);

    update public.employee_leave_balances elb
    set
      used_days = v_next_used_days,
      remaining_days = v_next_remaining_days
    where elb.id = v_balance.id;
  end if;

  update public.leave_requests lr
  set
    status = v_decision_status,
    decision_at = now(),
    decision_by = auth.uid(),
    decision_by_name = v_manager_name,
    decision_comment = v_comment
  where lr.id = v_request.id
  returning
    lr.id,
    lr.status,
    lr.decision_at,
    lr.decision_by,
    lr.decision_by_name,
    lr.decision_comment
  into
    id,
    status,
    decision_at,
    decision_by,
    decision_by_name,
    decision_comment;

  return next;
end;
$$;

grant execute on function public.hrp_apply_leave_decision_once(uuid, text, text)
to authenticated;