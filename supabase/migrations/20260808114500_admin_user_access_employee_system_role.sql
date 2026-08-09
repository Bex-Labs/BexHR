/*
  BexHR Admin User Access Employee System Role Reflection - v1.0.0

  PURPOSE
  -------
  Platform Admin User Access currently displays profiles.role.

  profiles.role is the login/dashboard route:
  - employee
  - manager
  - hr
  - admin

  employees.system_role is the HR-selected business/system role:
  - employee
  - manager
  - payroll
  - payroll_manager
  - auditor
  - qa_analyst
  - hr
  - etc.

  This migration adds employee_system_role to the existing protected
  Admin tenant-linking RPC so Admin can display the authoritative
  employee System Role without changing dashboard-routing security.

  SECURITY
  --------
  - Read-only RPC change.
  - Existing Platform Admin guard retained.
  - Existing employee name reflection retained.
  - Existing profile.role retained.
  - No employee/profile data is updated.
  - No RLS, payroll, authentication, tenant or HR workflow changes.
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';


/* =========================================================
   RECREATE EXISTING ADMIN RPC WITH ONE ADDITIVE FIELD

   Existing return values are preserved.
   employee_system_role is added after employee_full_name.
   ========================================================= */

drop function public.admin_list_profiles_for_tenant_linking();


create function public.admin_list_profiles_for_tenant_linking()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  tenant_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  employee_full_name text,
  employee_system_role text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  /*
    Preserve the existing Platform Admin authorization boundary.
  */
  if not public.is_current_user_admin_for_tenant_setup() then
    raise exception
      'Only Admin/System Admin can view profiles for tenant linking.';
  end if;

  return query
  select
    p.id,
    p.email,
    p.full_name,

    /*
      Keep profile.role unchanged.

      This remains the real login/dashboard route and continues to support
      Admin security decisions such as HR MFA controls and Admin protection.
    */
    p.role,

    p.tenant_id,
    p.created_at,
    p.updated_at,

    /*
      Existing authoritative employee display name.
    */
    employee_identity.employee_full_name,

    /*
      New authoritative HR-selected business/system role.

      Admin presentation may prefer this value while profile.role remains
      available separately for dashboard-routing and security logic.
    */
    employee_identity.employee_system_role

  from public.profiles p

  /*
    Resolve at most one linked employee record per profile.

    The same identity relationship and tenant preference already used by
    the employee-name reflection migration are preserved.
  */
  left join lateral (
    select
      nullif(
        trim(
          concat_ws(
            ' ',
            employee.first_name,
            employee.middle_name,
            employee.last_name
          )
        ),
        ''
      )::text as employee_full_name,

      nullif(
        trim(employee.system_role),
        ''
      )::text as employee_system_role

    from public.employees employee

    where employee.user_id = p.id
      and (
        p.tenant_id is null
        or employee.tenant_id = p.tenant_id
      )

    order by
      case
        when p.tenant_id is not null
         and employee.tenant_id = p.tenant_id
          then 0
        else 1
      end,
      employee.updated_at desc nulls last,
      employee.created_at desc nulls last

    limit 1
  ) employee_identity
    on true

  where lower(coalesce(p.role, '')) not in (
    'admin',
    'system_admin'
  )

  order by
    coalesce(
      employee_identity.employee_full_name,
      nullif(trim(p.full_name), ''),
      p.email
    ) asc;
end;
$function$;


/* =========================================================
   RESTORE HARDENED EXECUTE PERMISSIONS
   ========================================================= */

revoke execute on function
  public.admin_list_profiles_for_tenant_linking()
from public;

revoke execute on function
  public.admin_list_profiles_for_tenant_linking()
from anon;

grant execute on function
  public.admin_list_profiles_for_tenant_linking()
to authenticated, service_role;


/* =========================================================
   VERIFICATION
   ========================================================= */

do $admin_employee_role_verification$
declare
  v_definition text;
begin
  select pg_get_functiondef(procedure_record.oid)
  into v_definition
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'admin_list_profiles_for_tenant_linking';

  if coalesce(v_definition, '') = '' then
    raise exception
      'Admin role reflection verification failed: RPC was not recreated.';
  end if;

  if position(
    'employee_system_role'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Admin role reflection verification failed: employee_system_role is missing.';
  end if;

  if position(
    'employee_full_name'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Admin role reflection verification failed: existing employee_full_name was lost.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.admin_list_profiles_for_tenant_linking()',
    'EXECUTE'
  ) then
    raise exception
      'Admin role reflection verification failed: authenticated EXECUTE permission is missing.';
  end if;
end;
$admin_employee_role_verification$;


commit;