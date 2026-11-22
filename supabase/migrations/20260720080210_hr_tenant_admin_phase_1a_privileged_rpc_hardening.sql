-- BexHR HR Tenant Admin - Phase 1A
-- Immediate privileged RPC hardening
--
-- Scope:
--   1. Add an active platform-admin authorization guard to
--      public.admin_sync_company_user_employee.
--   2. Remove PUBLIC and anon execution rights from platform-admin RPCs.
--   3. Preserve authenticated Admin browser access and service-role access.
--
-- Explicitly NOT included:
--   - no hr_access_level column
--   - no role renaming
--   - no RLS policy changes
--   - no tenant-admin UI
--   - no department/job-title migration
--   - no payroll-grade data changes

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_sync_company_user_employee(
  p_email text,
  p_tenant_id uuid,
  p_full_name text default null::text,
  p_role text default 'employee'::text,
  p_department text default null::text
)
returns table(
  success boolean,
  action text,
  employee_id uuid,
  employee_number text,
  message text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller_role text;
  v_caller_is_active boolean;

  v_email text;
  v_full_name text;
  v_role text;
  v_department text;
  v_profile_id uuid;
  v_existing_employee public.employees%rowtype;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_name_parts text[];
  v_employee_number text;
  v_job_title text;
begin
  -- PLATFORM ADMIN AUTHORIZATION GUARD
  -- This RPC creates or updates employee records and must never be callable
  -- by anonymous users or ordinary tenant users.
  if auth.uid() is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select
    lower(coalesce(profile.role, '')),
    coalesce(profile.is_active, false)
  into
    v_caller_role,
    v_caller_is_active
  from public.profiles profile
  where profile.id = auth.uid();

  if not found
     or v_caller_is_active is not true
     or v_caller_role not in ('admin', 'system_admin')
  then
    raise exception
      'Only an active BexHR Platform Admin can synchronise company users to employee records.'
      using errcode = '42501';
  end if;

  -- Preserve the existing production behaviour below.
  v_email := lower(trim(coalesce(p_email, '')));
  v_full_name := trim(coalesce(p_full_name, ''));
  v_role := lower(trim(coalesce(p_role, 'employee')));
  v_department := nullif(trim(coalesce(p_department, '')), '');

  if v_email = '' then
    return query
    select
      false,
      'missing_email',
      null::uuid,
      null::text,
      'No email address was supplied for employee creation.';
    return;
  end if;

  if p_tenant_id is null then
    return query
    select
      false,
      'missing_tenant',
      null::uuid,
      null::text,
      'No company/tenant was supplied for employee creation.';
    return;
  end if;

  if v_role not in ('hr', 'manager', 'employee') then
    return query
    select
      false,
      'unsupported_role',
      null::uuid,
      null::text,
      'Only HR, Manager, and Employee users are converted into employee records.';
    return;
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id = p_tenant_id
  ) then
    return query
    select
      false,
      'tenant_not_found',
      null::uuid,
      null::text,
      'The selected company/tenant could not be found.';
    return;
  end if;

  select profile.id
  into v_profile_id
  from public.profiles profile
  where lower(coalesce(profile.email, '')) = v_email
  order by
    profile.updated_at desc nulls last,
    profile.created_at desc nulls last
  limit 1;

  select employee.*
  into v_existing_employee
  from public.employees employee
  where lower(coalesce(employee.work_email, '')) = v_email
  limit 1;

  if v_existing_employee.id is not null then
    if v_existing_employee.tenant_id = p_tenant_id then
      update public.employees employee
      set
        user_id = coalesce(employee.user_id, v_profile_id),
        system_role = v_role,
        updated_at = now()
      where employee.id = v_existing_employee.id
      returning
        employee.id,
        employee.employee_number
      into
        employee_id,
        employee_number;

      return query
      select
        true,
        'already_exists_linked',
        employee_id,
        employee_number,
        'Employee record already exists for this company user and has been linked/role-aligned.';
      return;
    end if;

    return query
    select
      false,
      'email_exists_in_another_company',
      v_existing_employee.id,
      v_existing_employee.employee_number,
      'This email already exists as an employee in another company. No duplicate employee record was created.';
    return;
  end if;

  v_name_parts := regexp_split_to_array(v_full_name, '\s+');

  v_first_name := coalesce(
    nullif(v_name_parts[1], ''),
    split_part(v_email, '@', 1)
  );

  if array_length(v_name_parts, 1) >= 2 then
    v_last_name := v_name_parts[array_length(v_name_parts, 1)];
  else
    v_last_name := v_first_name;
  end if;

  if array_length(v_name_parts, 1) > 2 then
    v_middle_name := array_to_string(
      v_name_parts[2:array_length(v_name_parts, 1) - 1],
      ' '
    );
  else
    v_middle_name := null;
  end if;

  v_job_title := case v_role
    when 'hr' then 'HR User'
    when 'manager' then 'Manager'
    else 'Employee'
  end;

  v_employee_number :=
    public.get_next_employee_number(p_tenant_id);

  insert into public.employees (
    id,
    tenant_id,
    user_id,
    first_name,
    middle_name,
    last_name,
    work_email,
    employee_number,
    department,
    job_title,
    employment_date,
    status,
    system_role,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    p_tenant_id,
    v_profile_id,
    v_first_name,
    v_middle_name,
    v_last_name,
    v_email,
    v_employee_number,
    coalesce(v_department, 'Admin Bootstrap'),
    v_job_title,
    current_date,
    'active',
    v_role,
    now(),
    now()
  )
  returning
    employees.id,
    employees.employee_number
  into
    employee_id,
    employee_number;

  return query
  select
    true,
    'created',
    employee_id,
    employee_number,
    'Employee record created for Admin-created company user.';
end;
$function$;


-- Remove anonymous execution rights from platform-admin RPCs.
-- Authenticated access is retained because the Admin Dashboard calls these
-- functions with the signed-in Admin session. Each RPC must still enforce
-- its own active platform-admin authorization check.

revoke execute on function
  public.admin_assign_profile_to_tenant(uuid, uuid)
from public;

revoke execute on function
  public.admin_assign_profile_to_tenant(uuid, uuid)
from anon;

grant execute on function
  public.admin_assign_profile_to_tenant(uuid, uuid)
to authenticated, service_role;


revoke execute on function
  public.admin_clear_email_validation_history(uuid)
from public;

revoke execute on function
  public.admin_clear_email_validation_history(uuid)
from anon;

grant execute on function
  public.admin_clear_email_validation_history(uuid)
to authenticated, service_role;


revoke execute on function
  public.admin_delete_tenant_if_safe(uuid)
from public;

revoke execute on function
  public.admin_delete_tenant_if_safe(uuid)
from anon;

grant execute on function
  public.admin_delete_tenant_if_safe(uuid)
to authenticated, service_role;


revoke execute on function
  public.admin_list_profiles_for_tenant_linking()
from public;

revoke execute on function
  public.admin_list_profiles_for_tenant_linking()
from anon;

grant execute on function
  public.admin_list_profiles_for_tenant_linking()
to authenticated, service_role;


revoke execute on function
  public.admin_list_security_audit_logs(text, integer)
from public;

revoke execute on function
  public.admin_list_security_audit_logs(text, integer)
from anon;

grant execute on function
  public.admin_list_security_audit_logs(text, integer)
to authenticated, service_role;


revoke execute on function
  public.admin_remove_profile_tenant_access(uuid)
from public;

revoke execute on function
  public.admin_remove_profile_tenant_access(uuid)
from anon;

grant execute on function
  public.admin_remove_profile_tenant_access(uuid)
to authenticated, service_role;


revoke execute on function
  public.admin_sync_company_user_employee(
    text,
    uuid,
    text,
    text,
    text
  )
from public;

revoke execute on function
  public.admin_sync_company_user_employee(
    text,
    uuid,
    text,
    text,
    text
  )
from anon;

grant execute on function
  public.admin_sync_company_user_employee(
    text,
    uuid,
    text,
    text,
    text
  )
to authenticated, service_role;


revoke execute on function
  public.admin_upsert_email_test_recipient(
    text,
    text,
    text
  )
from public;

revoke execute on function
  public.admin_upsert_email_test_recipient(
    text,
    text,
    text
  )
from anon;

grant execute on function
  public.admin_upsert_email_test_recipient(
    text,
    text,
    text
  )
to authenticated, service_role;


-- Migration verification.
do $verification$
declare
  vulnerable_function_definition text;
begin
  select pg_get_functiondef(procedure_record.oid)
  into vulnerable_function_definition
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
        'admin_sync_company_user_employee'
    and pg_get_function_identity_arguments(
          procedure_record.oid
        ) =
        'p_email text, p_tenant_id uuid, p_full_name text, p_role text, p_department text';

  if vulnerable_function_definition is null then
    raise exception
      'Verification failed: admin_sync_company_user_employee was not found.';
  end if;

  if position(
    'Only an active BexHR Platform Admin can synchronise company users to employee records.'
    in vulnerable_function_definition
  ) = 0 then
    raise exception
      'Verification failed: platform-admin authorization guard is missing.';
  end if;
end;
$verification$;

commit;


-- Post-migration privilege report.
select
  procedure_record.proname as function_name,
  pg_get_function_identity_arguments(
    procedure_record.oid
  ) as arguments,
  has_function_privilege(
    'anon',
    procedure_record.oid,
    'EXECUTE'
  ) as anon_can_execute,
  has_function_privilege(
    'authenticated',
    procedure_record.oid,
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'service_role',
    procedure_record.oid,
    'EXECUTE'
  ) as service_role_can_execute
from pg_proc procedure_record
join pg_namespace namespace_record
  on namespace_record.oid =
     procedure_record.pronamespace
where namespace_record.nspname = 'public'
  and procedure_record.proname in (
    'admin_assign_profile_to_tenant',
    'admin_clear_email_validation_history',
    'admin_delete_tenant_if_safe',
    'admin_list_profiles_for_tenant_linking',
    'admin_list_security_audit_logs',
    'admin_remove_profile_tenant_access',
    'admin_sync_company_user_employee',
    'admin_upsert_email_test_recipient'
  )
order by
  procedure_record.proname,
  pg_get_function_identity_arguments(
    procedure_record.oid
  );
