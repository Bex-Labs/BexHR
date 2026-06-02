-- MANAGER REPORTING LINE VISIBILITY - STEP 1P
-- Preserve the manager-safe reporting-line RPC used by Manager Dashboard.
--
-- HR behaviour:
-- - Primary managers can see employees assigned to them.
-- - Secondary managers can also see employees assigned to them.
-- - The RPC returns assigned employee display fields so the frontend does not
--   lose secondary employees when direct employees table reads are restricted
--   by RLS.

drop function if exists public.get_manager_reporting_line_assignments();

create function public.get_manager_reporting_line_assignments()
returns table (
  id uuid,
  employee_id uuid,
  employee_number text,
  first_name text,
  last_name text,
  work_email text,
  department text,
  job_title text,
  employment_date text,
  user_id uuid,
  employee_status text,
  manager_employee_id uuid,
  manager_type text,
  status text,
  effective_date text,
  tenant_id uuid
)
language sql
security definer
set search_path = public
as $$
  with signed_in_manager as (
    select
      e.id,
      e.tenant_id
    from public.employees e
    where (
        e.user_id = auth.uid()
        or lower(coalesce(e.work_email, '')) =
           lower(coalesce(auth.jwt() ->> 'email', ''))
      )
      and lower(coalesce(e.status, 'active')) = 'active'
    order by e.created_at desc nulls last
    limit 1
  )
  select
    erl.id,
    assigned_employee.id as employee_id,
    assigned_employee.employee_number::text,
    assigned_employee.first_name::text,
    assigned_employee.last_name::text,
    assigned_employee.work_email::text,
    assigned_employee.department::text,
    assigned_employee.job_title::text,
    assigned_employee.employment_date::text,
    assigned_employee.user_id,
    assigned_employee.status::text as employee_status,
    erl.manager_employee_id,
    erl.manager_type::text,
    erl.status::text,
    erl.effective_date::text,
    erl.tenant_id
  from signed_in_manager manager_record
  join public.employee_reporting_lines erl
    on erl.manager_employee_id = manager_record.id
  join public.employees assigned_employee
    on assigned_employee.id = erl.employee_id
  where lower(coalesce(erl.status, 'active')) = 'active'
    and (
      manager_record.tenant_id is null
      or assigned_employee.tenant_id = manager_record.tenant_id
    )
    and (
      erl.tenant_id is null
      or manager_record.tenant_id is null
      or erl.tenant_id = manager_record.tenant_id
    )
  order by
    case
      when lower(coalesce(erl.manager_type, '')) = 'primary' then 1
      when lower(coalesce(erl.manager_type, '')) = 'secondary' then 2
      else 3
    end,
    assigned_employee.employee_number;
$$;

grant execute on function public.get_manager_reporting_line_assignments()
to authenticated;