/*
  BexHR HR Tenant Admin - Phase 2E
  Enforce Tenant Administrator profile invariants centrally

  PURPOSE
  -------
  A profile may retain hr_access_level = 'tenant_admin' only while all of the
  following remain true:
    - role = 'hr'
    - tenant_id is not null
    - is_active = true

  The trigger automatically returns hr_access_level to 'standard' whenever a
  role change, company-access removal, tenant reassignment, deactivation, or
  other profile update makes the Tenant Administrator assignment invalid.

  DEFENCE IN DEPTH
  ----------------
  A validated CHECK constraint guarantees that an invalid tenant_admin row
  cannot remain stored even if a future workflow bypasses expected UI/RPC code.

  OUT OF SCOPE
  ------------
  - No Tenant Administrator permissions are granted
  - No user is promoted
  - No tenant/company data is changed
  - No RLS policy is changed
  - No existing RPC contract is replaced
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $phase_2e_preflight$
declare
  v_invalid_tenant_admin_count bigint;
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Phase 2E stopped: public.profiles does not exist.';
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
      'Phase 2E stopped: public.profiles.hr_access_level is missing or incorrectly defined.';
  end if;

  if to_regprocedure(
    'public.enforce_hr_access_level_invariant()'
  ) is not null then
    raise exception
      'Phase 2E stopped: public.enforce_hr_access_level_invariant() already exists.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.profiles'::regclass
      and trigger_record.tgname =
        'enforce_profiles_hr_access_level_invariant'
      and trigger_record.tgisinternal is false
  ) then
    raise exception
      'Phase 2E stopped: profiles invariant trigger already exists.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.profiles'::regclass
      and constraint_record.conname =
        'profiles_tenant_admin_invariant_check'
  ) then
    raise exception
      'Phase 2E stopped: profiles tenant-admin invariant constraint already exists.';
  end if;

  select count(*)
  into v_invalid_tenant_admin_count
  from public.profiles profile
  where profile.hr_access_level = 'tenant_admin'
    and not (
      lower(trim(coalesce(profile.role, ''))) = 'hr'
      and profile.tenant_id is not null
      and coalesce(profile.is_active, false) is true
    );

  if v_invalid_tenant_admin_count <> 0 then
    raise exception
      'Phase 2E stopped: % invalid Tenant Administrator profile(s) already exist. Review them before applying enforcement.',
      v_invalid_tenant_admin_count;
  end if;
end;
$phase_2e_preflight$;


create function public.enforce_hr_access_level_invariant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  /*
    standard is always safe.

    tenant_admin remains valid only for an active HR Dashboard profile linked
    to a company. Any workflow that removes one of those prerequisites
    automatically returns the profile to standard HR access.
  */
  if new.hr_access_level = 'tenant_admin'
     and not (
       lower(trim(coalesce(new.role, ''))) = 'hr'
       and new.tenant_id is not null
       and coalesce(new.is_active, false) is true
     )
  then
    new.hr_access_level := 'standard';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_hr_access_level_invariant() is
'Central profiles trigger guard. Automatically resets hr_access_level to standard whenever tenant_admin prerequisites are no longer valid.';


revoke all on function
  public.enforce_hr_access_level_invariant()
from public;

revoke execute on function
  public.enforce_hr_access_level_invariant()
from anon, authenticated, service_role;


create trigger enforce_profiles_hr_access_level_invariant
before insert or update of
  role,
  tenant_id,
  is_active,
  hr_access_level
on public.profiles
for each row
execute function public.enforce_hr_access_level_invariant();

comment on trigger enforce_profiles_hr_access_level_invariant
on public.profiles is
'Keeps tenant_admin limited to active HR profiles with a non-null tenant/company link.';


alter table public.profiles
add constraint profiles_tenant_admin_invariant_check
check (
  hr_access_level <> 'tenant_admin'
  or (
    lower(trim(coalesce(role, ''))) = 'hr'
    and tenant_id is not null
    and coalesce(is_active, false) is true
  )
) not valid;

alter table public.profiles
validate constraint profiles_tenant_admin_invariant_check;


do $phase_2e_verify$
declare
  v_function_oid oid;
  v_trigger_definition text;
  v_constraint_definition text;
  v_invalid_tenant_admin_count bigint;
begin
  select procedure_record.oid
  into v_function_oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'enforce_hr_access_level_invariant'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_function_oid is null then
    raise exception
      'Phase 2E verification failed: invariant trigger function was not found.';
  end if;

  select pg_catalog.pg_get_triggerdef(
    trigger_record.oid,
    true
  )
  into v_trigger_definition
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.profiles'::regclass
    and trigger_record.tgname =
      'enforce_profiles_hr_access_level_invariant'
    and trigger_record.tgisinternal is false
    and trigger_record.tgenabled <> 'D';

  if v_trigger_definition is null then
    raise exception
      'Phase 2E verification failed: enabled profiles invariant trigger was not found.';
  end if;

  if position(
    'BEFORE INSERT OR UPDATE OF ROLE, TENANT_ID, IS_ACTIVE, HR_ACCESS_LEVEL'
    in upper(v_trigger_definition)
  ) = 0 then
    raise exception
      'Phase 2E verification failed: trigger event coverage is incorrect.';
  end if;

  select pg_catalog.pg_get_constraintdef(
    constraint_record.oid,
    true
  )
  into v_constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'public.profiles'::regclass
    and constraint_record.conname =
      'profiles_tenant_admin_invariant_check'
    and constraint_record.contype = 'c'
    and constraint_record.convalidated is true;

  if v_constraint_definition is null then
    raise exception
      'Phase 2E verification failed: validated invariant constraint was not found.';
  end if;

  if pg_catalog.has_function_privilege(
    'public',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2E verification failed: PUBLIC can execute invariant trigger function.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2E verification failed: anon can execute invariant trigger function.';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2E verification failed: authenticated can execute invariant trigger function.';
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2E verification failed: service_role can execute invariant trigger function directly.';
  end if;

  select count(*)
  into v_invalid_tenant_admin_count
  from public.profiles profile
  where profile.hr_access_level = 'tenant_admin'
    and not (
      lower(trim(coalesce(profile.role, ''))) = 'hr'
      and profile.tenant_id is not null
      and coalesce(profile.is_active, false) is true
    );

  if v_invalid_tenant_admin_count <> 0 then
    raise exception
      'Phase 2E verification failed: % invalid Tenant Administrator profile(s) remain.',
      v_invalid_tenant_admin_count;
  end if;
end;
$phase_2e_verify$;

commit;


/*
  POST-RUN VERIFICATION REPORT

  Expected:
    function_exists = true
    trigger_exists_and_enabled = true
    constraint_exists_and_validated = true
    invalid_tenant_admin_count = 0
    tenant_admin_total = unchanged
    PUBLIC/anon/authenticated/service_role direct function execution = false
*/

with
function_info as (
  select
    procedure_record.oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'enforce_hr_access_level_invariant'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = ''
),
trigger_info as (
  select
    trigger_record.oid,
    trigger_record.tgenabled
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.profiles'::regclass
    and trigger_record.tgname =
      'enforce_profiles_hr_access_level_invariant'
    and trigger_record.tgisinternal is false
),
constraint_info as (
  select
    constraint_record.oid,
    constraint_record.convalidated
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'public.profiles'::regclass
    and constraint_record.conname =
      'profiles_tenant_admin_invariant_check'
)
select
  exists (
    select 1
    from function_info
  ) as function_exists,

  exists (
    select 1
    from trigger_info
    where trigger_info.tgenabled <> 'D'
  ) as trigger_exists_and_enabled,

  exists (
    select 1
    from constraint_info
    where constraint_info.convalidated is true
  ) as constraint_exists_and_validated,

  (
    select count(*)
    from public.profiles profile
    where profile.hr_access_level = 'tenant_admin'
  ) as tenant_admin_total,

  (
    select count(*)
    from public.profiles profile
    where profile.hr_access_level = 'tenant_admin'
      and not (
        lower(trim(coalesce(profile.role, ''))) = 'hr'
        and profile.tenant_id is not null
        and coalesce(profile.is_active, false) is true
      )
  ) as invalid_tenant_admin_count,

  pg_catalog.has_function_privilege(
    'public',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as public_can_execute_function,

  pg_catalog.has_function_privilege(
    'anon',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as anon_can_execute_function,

  pg_catalog.has_function_privilege(
    'authenticated',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as authenticated_can_execute_function,

  pg_catalog.has_function_privilege(
    'service_role',
    (select function_info.oid from function_info),
    'EXECUTE'
  ) as service_role_can_execute_function;
