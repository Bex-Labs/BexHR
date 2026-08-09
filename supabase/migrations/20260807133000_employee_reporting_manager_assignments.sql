-- EMPLOYEE DASHBOARD - ASSIGNED MANAGERS VISIBILITY - STEP 1
-- Returns only the active reporting managers assigned to the signed-in employee.
--
-- Security:
-- - resolves the employee from auth.uid() / authenticated email;
-- - restricts manager records to the same tenant;
-- - exposes read-only manager identity/display fields only;
-- - does not grant access to other employees' reporting relationships;
-- - does not change employee_reporting_lines RLS or manager authority.

drop function if exists public.get_employee_reporting_manager_assignments();

create function public.get_employee_reporting_manager_assignments()
returns table (
  reporting_line_id uuid,
  employee_id uuid,
  manager_employee_id uuid,
  manager_type text,
  status text,
  manager_first_name text,
  manager_last_name text,
  manager_work_email text,
  manager_department text,
  manager_job_title text
)
language sql
security definer
set search_path = public
as $$
  with signed_in_employee as (
    select
      e.id,
      e.tenant_id
    from public.employees e
    where auth.uid() is not null
      and (
        e.user_id = auth.uid()
        or lower(coalesce(e.work_email, '')) =
           lower(coalesce(auth.jwt() ->> 'email', ''))
      )
      and lower(coalesce(e.status, 'active')) = 'active'
    order by e.created_at desc nulls last
    limit 1
  )
  select
    erl.id as reporting_line_id,
    employee_record.id as employee_id,
    manager_record.id as manager_employee_id,
    erl.manager_type::text,
    erl.status::text,
    manager_record.first_name::text as manager_first_name,
    manager_record.last_name::text as manager_last_name,
    manager_record.work_email::text as manager_work_email,
    manager_record.department::text as manager_department,
    manager_record.job_title::text as manager_job_title
  from signed_in_employee employee_record
  join public.employee_reporting_lines erl
    on erl.employee_id = employee_record.id
  join public.employees manager_record
    on manager_record.id = erl.manager_employee_id
  where lower(coalesce(erl.status, 'active')) = 'active'
    and lower(coalesce(erl.manager_type::text, '')) in ('primary', 'secondary')
    and (
      erl.tenant_id is null
      or employee_record.tenant_id is null
      or erl.tenant_id = employee_record.tenant_id
    )
    and (
      employee_record.tenant_id is null
      or manager_record.tenant_id = employee_record.tenant_id
    )
  order by
    case
      when lower(coalesce(erl.manager_type::text, '')) = 'primary' then 1
      when lower(coalesce(erl.manager_type::text, '')) = 'secondary' then 2
      else 3
    end,
    manager_record.first_name,
    manager_record.last_name;
$$;

revoke all on function public.get_employee_reporting_manager_assignments()
from public, anon;

grant execute on function public.get_employee_reporting_manager_assignments()
to authenticated;