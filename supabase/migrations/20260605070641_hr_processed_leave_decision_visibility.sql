-- LEAVE DECISION DOWNSTREAM VISIBILITY - STEP 1D
-- Capture HR tenant-level visibility for processed manager leave decisions.
--
-- HR behaviour:
-- - HR can audit Approved, Rejected, Returned, and Returned for Clarification
--   leave decisions for employees in their own tenant.
-- - HR does not gain manager approval authority.
-- - Pending Approval remains a manager workflow item and is not exposed here.
--
-- Technical behaviour:
-- - Supports leave_requests.employee_id stored as:
--   1) employees.id
--   2) employees.user_id / auth user id
--   3) profiles.id resolved through employee work_email.
-- - Tenant safety is enforced by matching the signed-in HR profile tenant_id
--   to the resolved employee tenant_id.

create or replace function public.hrp_is_current_user_hr_for_leave_employee(
  p_leave_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with signed_in_hr_profile as (
    select
      p.id,
      p.role,
      p.tenant_id,
      p.is_active
    from public.profiles p
    where p.id = auth.uid()
      and lower(trim(coalesce(p.role, ''))) = 'hr'
      and coalesce(p.is_active, true) = true
    limit 1
  ),
  target_leave_employee as (
    select
      e.id as employee_id,
      e.tenant_id
    from public.employees e
    left join public.profiles leave_profile
      on leave_profile.id = p_leave_employee_id
    where
      e.id = p_leave_employee_id
      or e.user_id = p_leave_employee_id
      or (
        leave_profile.email is not null
        and lower(coalesce(e.work_email, '')) = lower(leave_profile.email)
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
    from signed_in_hr_profile hp
    join target_leave_employee tle
      on tle.tenant_id = hp.tenant_id
  );
$$;

grant execute on function public.hrp_is_current_user_hr_for_leave_employee(uuid)
to authenticated;

drop policy if exists hr_select_tenant_processed_leave_decisions
on public.leave_requests;

create policy hr_select_tenant_processed_leave_decisions
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
  and public.hrp_is_current_user_hr_for_leave_employee(employee_id)
);