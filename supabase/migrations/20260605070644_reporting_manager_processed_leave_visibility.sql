-- LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1G
-- Capture processed leave visibility for every active reporting manager.
--
-- HR behaviour:
-- - Primary Manager remains the approval owner.
-- - Additional reporting managers can see processed leave decisions and
--   approved/current/upcoming leave schedule for employees on their reporting line.
-- - Additional reporting managers cannot approve, reject, or return pending leave
--   unless a future delegated-approver rule is explicitly added.

create or replace function public.hrp_is_current_user_reporting_manager_for_leave_employee(
  p_leave_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with signed_in_profile as (
    select
      auth.uid() as user_id,
      p.email as profile_email
    from (select auth.uid() as id) current_auth
    left join public.profiles p
      on p.id = current_auth.id
  ),
  signed_in_manager_employee as (
    select
      e.id as manager_employee_id
    from public.employees e
    cross join signed_in_profile sp
    where
      e.user_id = sp.user_id
      or (
        sp.profile_email is not null
        and lower(coalesce(e.work_email, '')) = lower(sp.profile_email)
      )
    order by
      case when e.user_id = sp.user_id then 0 else 1 end
    limit 1
  ),
  target_leave_employee as (
    select
      e.id as employee_id
    from public.employees e
    left join public.profiles p
      on p.id = p_leave_employee_id
    where
      e.id = p_leave_employee_id
      or e.user_id = p_leave_employee_id
      or (
        p.email is not null
        and lower(coalesce(e.work_email, '')) = lower(p.email)
      )
    order by
      case
        when e.id = p_leave_employee_id then 0
        when e.user_id = p_leave_employee_id then 1
        else 2
      end
    limit 1
  )
  select exists (
    select 1
    from public.employee_reporting_lines erl
    join target_leave_employee tle
      on tle.employee_id = erl.employee_id
    join signed_in_manager_employee sme
      on sme.manager_employee_id = erl.manager_employee_id
    where lower(coalesce(erl.status, '')) = 'active'
  );
$$;

grant execute on function public.hrp_is_current_user_reporting_manager_for_leave_employee(uuid)
to authenticated;

drop policy if exists manager_supervisor_select_reporting_line_processed_leave_requests
on public.leave_requests;

create policy manager_supervisor_select_reporting_line_processed_leave_requests
on public.leave_requests
for select
to authenticated
using (
  lower(trim(coalesce(status, ''))) in (
    'approved',
    'rejected',
    'returned',
    'returned for clarification'
  )
  and public.hrp_is_current_user_reporting_manager_for_leave_employee(employee_id)
);