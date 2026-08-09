/*
  BexHR Admin User Access Employee Display Name - v1.0.0

  PURPOSE
  -------
  Keep Platform Admin > User Access Setup aligned with the authoritative
  employee name maintained by HR.

  BUSINESS BEHAVIOUR
  ------------------
  HR maintains employee names in public.employees:
  - first_name
  - middle_name
  - last_name

  Platform Admin currently reads profile.full_name through the protected
  admin_list_profiles_for_tenant_linking() RPC.

  profile.full_name can therefore become stale after HR changes an
  employee's name.

  This migration adds employee_full_name to the existing protected RPC.
  The Admin browser can then prefer the current employee name while still
  retaining profile.full_name and email as safe fallbacks.

  SECURITY / SCOPE
  ----------------
  - Existing Platform Admin authorization guard is retained.
  - SECURITY DEFINER is retained.
  - search_path = public is retained.
  - Existing profile fields are retained.
  - Existing Admin execute grants are restored.
  - No employee records are changed.
  - No profile records are changed.
  - No tenant assignments are changed.
  - No authentication or RLS policies are changed.
  - No payroll, leave or HR workflow is changed.
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';


/* =========================================================
   PREFLIGHT
   Stop safely if the established BexHR schema is not present.
   ========================================================= */

do $admin_employee_name_preflight$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Admin employee-name sync stopped: public.profiles does not exist.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'Admin employee-name sync stopped: public.employees does not exist.';
  end if;

  if to_regprocedure(
    'public.admin_list_profiles_for_tenant_linking()'
  ) is null then
    raise exception
      'Admin employee-name sync stopped: admin_list_profiles_for_tenant_linking() does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'user_id'
  ) then
    raise exception
      'Admin employee-name sync stopped: employees.user_id is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'first_name'
  ) then
    raise exception
      'Admin employee-name sync stopped: employees.first_name is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'middle_name'
  ) then
    raise exception
      'Admin employee-name sync stopped: employees.middle_name is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'last_name'
  ) then
    raise exception
      'Admin employee-name sync stopped: employees.last_name is missing.';
  end if;
end;
$admin_employee_name_preflight$;


/* =========================================================
   RPC CONTRACT UPDATE

   PostgreSQL cannot change an existing RETURNS TABLE signature
   with CREATE OR REPLACE alone, so recreate the zero-argument
   RPC inside this transaction.

   All existing fields are preserved.
   employee_full_name is additive.
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
  employee_full_name text
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
    p.role,
    p.tenant_id,
    p.created_at,
    p.updated_at,

    /*
      Prefer the authoritative HR employee name when the profile has
      a linked employee record.

      concat_ws ignores NULL middle names, while trim/nullif prevents
      an empty generated name from overriding the existing profile
      fallback in the Admin frontend.
    */
    employee_identity.employee_full_name

  from public.profiles p

  /*
    Use a lateral lookup rather than a normal join so one profile still
    produces exactly one RPC row even if historical employee data ever
    contains more than one candidate.

    employees.user_id = profiles.id is the project's established primary
    employee/login identity relationship.

    When the profile already has a company assignment, prefer an employee
    from that same tenant.
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
      )::text as employee_full_name

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
  ) employee_identity on true

  where lower(coalesce(p.role, ''))
    not in ('admin', 'system_admin')

  /*
    Admin should sort using the same preferred identity that will
    subsequently be displayed in the browser.
  */
  order by
    coalesce(
      employee_identity.employee_full_name,
      nullif(trim(p.full_name), ''),
      p.email
    ) asc;
end;
$function$;


/* =========================================================
   EXECUTE PRIVILEGES

   Restore the same hardened permission model already established
   for this Admin RPC.
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
   MIGRATION VERIFICATION
   ========================================================= */

do $admin_employee_name_verification$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into v_definition
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'admin_list_profiles_for_tenant_linking'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_definition is null then
    raise exception
      'Admin employee-name sync verification failed: RPC was not recreated.';
  end if;

  if position(
    'employee_full_name'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Admin employee-name sync verification failed: employee_full_name is missing.';
  end if;

  if position(
    'employee.user_id = p.id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Admin employee-name sync verification failed: employee/profile identity join is missing.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.admin_list_profiles_for_tenant_linking()',
    'EXECUTE'
  ) then
    raise exception
      'Admin employee-name sync verification failed: authenticated EXECUTE permission is missing.';
  end if;
end;
$admin_employee_name_verification$;


commit;