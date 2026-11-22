/*
  BexHR HR Tenant Admin - Phase 2C
  Add a dedicated protected RPC for Platform Admin HR access management

  PURPOSE
  -------
  Provide the Platform Admin dashboard with a safe, read-only list of HR
  profiles and their current HR access level.

  WHY A NEW RPC
  -------------
  The existing admin_list_profiles_for_tenant_linking() RPC is already used by
  company-access management. This migration does not alter that established
  contract or its current UI.

  OUT OF SCOPE
  ------------
  - No profile data changes
  - No Tenant Administrator assignment
  - No HR Dashboard UI changes
  - No Platform Admin UI changes
  - No RLS changes
  - No tenant, payroll, leave, employee, salary or authentication changes
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $phase_2c_preflight$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Phase 2C stopped: public.profiles does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
      and data_type = 'text'
      and is_nullable = 'NO'
  ) then
    raise exception
      'Phase 2C stopped: public.profiles.hr_access_level is missing or incorrectly defined. Apply and verify Phase 2B first.';
  end if;

  if to_regprocedure(
    'public.admin_list_hr_access_profiles()'
  ) is not null then
    raise exception
      'Phase 2C stopped: public.admin_list_hr_access_profiles() already exists.';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.profiles',
    'hr_access_level',
    'UPDATE'
  ) then
    raise exception
      'Phase 2C stopped: authenticated can directly update hr_access_level.';
  end if;
end;
$phase_2c_preflight$;


create function public.admin_list_hr_access_profiles()
returns table(
  profile_id uuid,
  email text,
  full_name text,
  profile_role text,
  tenant_id uuid,
  is_active boolean,
  hr_access_level text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_is_active boolean;
begin
  if v_caller_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select
    lower(trim(coalesce(profile.role, ''))),
    coalesce(profile.is_active, false)
  into
    v_caller_role,
    v_caller_is_active
  from public.profiles profile
  where profile.id = v_caller_id
  for share;

  if not found
     or v_caller_is_active is not true
     or v_caller_role not in ('admin', 'system_admin')
  then
    raise exception
      'Only an active BexHR Platform Admin can view HR access management records.'
      using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.email,
    profile.full_name,
    profile.role,
    profile.tenant_id,
    profile.is_active,
    profile.hr_access_level,
    profile.created_at,
    profile.updated_at
  from public.profiles profile
  where lower(trim(coalesce(profile.role, ''))) = 'hr'
  order by
    coalesce(
      nullif(trim(profile.full_name), ''),
      nullif(trim(profile.email), ''),
      profile.id::text
    );
end;
$function$;


revoke all on function
  public.admin_list_hr_access_profiles()
from public;

revoke execute on function
  public.admin_list_hr_access_profiles()
from anon;

grant execute on function
  public.admin_list_hr_access_profiles()
to authenticated, service_role;


do $phase_2c_verify$
declare
  v_function_oid oid;
  v_function_definition text;
  v_result_type text;
begin
  select procedure_record.oid
  into v_function_oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'admin_list_hr_access_profiles'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_function_oid is null then
    raise exception
      'Phase 2C verification failed: admin_list_hr_access_profiles() was not found.';
  end if;

  if not (
    select procedure_record.prosecdef
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid = v_function_oid
  ) then
    raise exception
      'Phase 2C verification failed: admin_list_hr_access_profiles() is not SECURITY DEFINER.';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_function_definition;

  if position(
    'Only an active BexHR Platform Admin can view HR access management records.'
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2C verification failed: active Platform Admin authorization guard is missing.';
  end if;

  if position(
    'where lower(trim(coalesce(profile.role, ''''))) = ''hr'''
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2C verification failed: HR-only result filter is missing.';
  end if;

  select pg_catalog.pg_get_function_result(v_function_oid)
  into v_result_type;

  if position('hr_access_level text' in v_result_type) = 0
     or position('is_active boolean' in v_result_type) = 0
     or position('tenant_id uuid' in v_result_type) = 0
  then
    raise exception
      'Phase 2C verification failed: expected access-management result columns are missing.';
  end if;

  if pg_catalog.has_function_privilege(
    'public',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2C verification failed: PUBLIC can execute admin_list_hr_access_profiles().';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2C verification failed: anon can execute admin_list_hr_access_profiles().';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2C verification failed: authenticated cannot execute admin_list_hr_access_profiles().';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2C verification failed: service_role cannot execute admin_list_hr_access_profiles().';
  end if;
end;
$phase_2c_verify$;

commit;


/*
  POST-RUN VERIFICATION REPORT

  Expected:
    function_exists = true
    security_definer = true
    runtime_configuration = ["search_path=pg_catalog, public"]
    PUBLIC/anon execution = false
    authenticated/service_role execution = true
    direct authenticated hr_access_level update = false
*/

with function_info as (
  select
    procedure_record.oid,
    procedure_record.prosecdef,
    procedure_record.proconfig
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'admin_list_hr_access_profiles'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = ''
)
select
  exists (
    select 1
    from function_info
  ) as function_exists,

  coalesce(
    (select function_info.prosecdef from function_info),
    false
  ) as security_definer,

  (select function_info.proconfig from function_info)
    as runtime_configuration,

  pg_catalog.has_function_privilege(
    'public',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as public_can_execute,

  pg_catalog.has_function_privilege(
    'anon',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as anon_can_execute,

  pg_catalog.has_function_privilege(
    'authenticated',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as authenticated_can_execute,

  pg_catalog.has_function_privilege(
    'service_role',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as service_role_can_execute,

  has_column_privilege(
    'authenticated',
    'public.profiles',
    'hr_access_level',
    'UPDATE'
  ) as authenticated_can_directly_update_hr_access_level;
