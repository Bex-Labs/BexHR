/*
BexHR HR Access Label Clarity

Purpose:
Provide active HR dashboard users with the minimum profile information needed
to resolve employee account linkage and display HR Standard versus HR Admin.

Security:
- Authenticated HR users only.
- Caller must be active and tenant-linked.
- Results are restricted to the caller's tenant.
- No profile update capability.
- No payroll, salary, leave, bank, document, or authentication data.
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Migration stopped: public.profiles does not exist.';
  end if;

  if to_regprocedure(
    'public.hr_list_tenant_profile_linkage()'
  ) is not null then
    raise exception
      'Migration stopped: public.hr_list_tenant_profile_linkage() already exists.';
  end if;
end;
$preflight$;

create function public.hr_list_tenant_profile_linkage()
returns table(
  profile_id uuid,
  email text,
  full_name text,
  profile_role text,
  hr_access_level text,
  tenant_id uuid,
  is_active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_tenant_id uuid;
  v_caller_is_active boolean;
begin
  if v_caller_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select
    lower(trim(coalesce(profile.role, ''))),
    profile.tenant_id,
    coalesce(profile.is_active, false)
  into
    v_caller_role,
    v_caller_tenant_id,
    v_caller_is_active
  from public.profiles profile
  where profile.id = v_caller_id
  for share;

  if not found
    or v_caller_is_active is not true
    or v_caller_role <> 'hr'
    or v_caller_tenant_id is null
  then
    raise exception
      'Only an active tenant-linked HR user can view profile linkage records.'
      using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.email,
    profile.full_name,
    profile.role,
    profile.hr_access_level,
    profile.tenant_id,
    profile.is_active
  from public.profiles profile
  where profile.tenant_id = v_caller_tenant_id
  order by
    coalesce(
      nullif(trim(profile.full_name), ''),
      nullif(trim(profile.email), ''),
      profile.id::text
    );
end;
$function$;

revoke all on function
  public.hr_list_tenant_profile_linkage()
from public;

revoke execute on function
  public.hr_list_tenant_profile_linkage()
from anon;

grant execute on function
  public.hr_list_tenant_profile_linkage()
to authenticated, service_role;

do $verify$
declare
  v_function_oid oid;
  v_function_definition text;
begin
  select procedure_record.oid
  into v_function_oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'hr_list_tenant_profile_linkage'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_function_oid is null then
    raise exception
      'Verification failed: hr_list_tenant_profile_linkage() was not found.';
  end if;

  if not (
    select procedure_record.prosecdef
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid = v_function_oid
  ) then
    raise exception
      'Verification failed: function is not SECURITY DEFINER.';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_function_definition;

  if position(
    'profile.tenant_id = v_caller_tenant_id'
    in v_function_definition
  ) = 0 then
    raise exception
      'Verification failed: tenant result filter is missing.';
  end if;

  if position(
    'v_caller_role <> ''hr'''
    in v_function_definition
  ) = 0 then
    raise exception
      'Verification failed: HR caller guard is missing.';
  end if;

  if pg_catalog.has_function_privilege(
    'public',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Verification failed: PUBLIC can execute the function.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Verification failed: anon can execute the function.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Verification failed: authenticated cannot execute the function.';
  end if;
end;
$verify$;

commit;