/*
  BexHR HR Tenant Admin - Phase 2B
  Add HR access level and protected Platform Admin assignment RPC

  PURPOSE
  -------
  Introduce a separate HR access tier without changing dashboard routing:
    - profiles.role = 'hr' remains the HR Dashboard route
    - profiles.hr_access_level = 'standard' or 'tenant_admin'

  SAFE DEFAULT
  ------------
  Every existing and future profile starts as:
    hr_access_level = 'standard'

  No user is promoted to tenant_admin by this migration.

  OUT OF SCOPE
  ------------
  - No HR Dashboard UI changes
  - No tenant-admin permissions yet
  - No RLS policy expansion
  - No employee/profile role changes
  - No tenant, payroll, leave, salary, pension or authentication changes
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $phase_2b_preflight$
declare
  v_authenticated_has_table_update boolean;
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Phase 2B stopped: public.profiles does not exist.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
  ) then
    raise exception
      'Phase 2B stopped: public.profiles.hr_access_level already exists.';
  end if;

  select has_table_privilege(
    'authenticated',
    'public.profiles',
    'UPDATE'
  )
  into v_authenticated_has_table_update;

  if v_authenticated_has_table_update then
    raise exception
      'Phase 2B stopped: authenticated still has table-wide UPDATE on public.profiles. Apply and verify Phase 1D first.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'profiles'
      and policy.policyname = 'profiles_self_update'
      and policy.cmd = 'UPDATE'
      and 'authenticated' = any(policy.roles)
      and policy.qual = '(id = auth.uid())'
      and policy.with_check = '(id = auth.uid())'
  ) then
    raise exception
      'Phase 2B stopped: the expected profiles_self_update RLS policy was not found.';
  end if;
end;
$phase_2b_preflight$;


alter table public.profiles
add column hr_access_level text
not null
default 'standard';


alter table public.profiles
add constraint profiles_hr_access_level_check
check (
  hr_access_level in (
    'standard',
    'tenant_admin'
  )
);


comment on column public.profiles.hr_access_level is
'HR access tier. standard = normal HR access; tenant_admin = company-scoped HR administration. Dashboard routing remains controlled by profiles.role.';


create index profiles_tenant_hr_access_level_idx
on public.profiles (
  tenant_id,
  hr_access_level
)
where lower(trim(coalesce(role, ''))) = 'hr';


create or replace function public.admin_set_hr_access_level(
  target_profile_id uuid,
  target_hr_access_level text
)
returns table(
  success boolean,
  profile_id uuid,
  tenant_id uuid,
  profile_role text,
  hr_access_level text,
  message text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_is_active boolean;

  v_requested_access_level text :=
    lower(trim(coalesce(target_hr_access_level, '')));

  v_target public.profiles%rowtype;
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
      'Only an active BexHR Platform Admin can change HR access levels.'
      using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'Target HR profile is required.'
      using errcode = '22023';
  end if;

  if v_requested_access_level not in (
    'standard',
    'tenant_admin'
  ) then
    raise exception
      'HR access level must be standard or tenant_admin.'
      using errcode = '22023';
  end if;

  select profile.*
  into v_target
  from public.profiles profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'Target profile was not found.'
      using errcode = 'P0002';
  end if;

  if lower(trim(coalesce(v_target.role, ''))) <> 'hr' then
    raise exception
      'Only HR Dashboard profiles can receive an HR access level.'
      using errcode = '42501';
  end if;

  if v_target.tenant_id is null then
    raise exception
      'The HR profile must be linked to a company before its HR access level can be changed.'
      using errcode = '23502';
  end if;

  if v_requested_access_level = 'tenant_admin'
     and coalesce(v_target.is_active, false) is not true
  then
    raise exception
      'An inactive HR profile cannot be promoted to Tenant Administrator.'
      using errcode = '42501';
  end if;

  update public.profiles profile
  set hr_access_level = v_requested_access_level
  where profile.id = v_target.id;

  return query
  select
    true,
    v_target.id,
    v_target.tenant_id,
    v_target.role,
    v_requested_access_level,
    case v_requested_access_level
      when 'tenant_admin'
      then 'HR profile promoted to Tenant Administrator.'
      else 'HR profile set to standard HR access.'
    end;
end;
$function$;


revoke all on function
  public.admin_set_hr_access_level(uuid, text)
from public;

revoke execute on function
  public.admin_set_hr_access_level(uuid, text)
from anon;

grant execute on function
  public.admin_set_hr_access_level(uuid, text)
to authenticated, service_role;


do $phase_2b_verify$
declare
  v_function_oid oid;
  v_function_definition text;
  v_non_standard_count bigint;
  v_null_access_count bigint;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
      and data_type = 'text'
      and is_nullable = 'NO'
      and column_default = '''standard''::text'
  ) then
    raise exception
      'Phase 2B verification failed: hr_access_level column definition is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_info
    join pg_catalog.pg_class relation
      on relation.oid = constraint_info.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'profiles'
      and constraint_info.conname = 'profiles_hr_access_level_check'
      and pg_catalog.pg_get_constraintdef(
        constraint_info.oid,
        true
      ) ilike '%tenant_admin%'
      and pg_catalog.pg_get_constraintdef(
        constraint_info.oid,
        true
      ) ilike '%standard%'
  ) then
    raise exception
      'Phase 2B verification failed: HR access-level constraint is missing or incorrect.';
  end if;

  select count(*)
  into v_null_access_count
  from public.profiles profile
  where profile.hr_access_level is null;

  if v_null_access_count <> 0 then
    raise exception
      'Phase 2B verification failed: one or more profiles have a null HR access level.';
  end if;

  select count(*)
  into v_non_standard_count
  from public.profiles profile
  where profile.hr_access_level <> 'standard';

  if v_non_standard_count <> 0 then
    raise exception
      'Phase 2B verification failed: this migration unexpectedly promoted one or more profiles.';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.profiles',
    'hr_access_level',
    'UPDATE'
  ) then
    raise exception
      'Phase 2B verification failed: authenticated can directly update hr_access_level.';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.profiles',
    'UPDATE'
  ) then
    raise exception
      'Phase 2B verification failed: service_role lost UPDATE access on public.profiles.';
  end if;

  select procedure_record.oid
  into v_function_oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'admin_set_hr_access_level'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = 'target_profile_id uuid, target_hr_access_level text';

  if v_function_oid is null then
    raise exception
      'Phase 2B verification failed: admin_set_hr_access_level(uuid, text) was not found.';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_function_definition;

  if position(
    'Only an active BexHR Platform Admin can change HR access levels.'
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2B verification failed: Platform Admin authorization guard is missing.';
  end if;

  if not (
    select procedure_record.prosecdef
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid = v_function_oid
  ) then
    raise exception
      'Phase 2B verification failed: admin_set_hr_access_level is not SECURITY DEFINER.';
  end if;

  if pg_catalog.has_function_privilege(
    'public',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2B verification failed: PUBLIC can execute admin_set_hr_access_level.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2B verification failed: anon can execute admin_set_hr_access_level.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2B verification failed: authenticated cannot execute admin_set_hr_access_level.';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2B verification failed: service_role cannot execute admin_set_hr_access_level.';
  end if;
end;
$phase_2b_verify$;

commit;


/*
  POST-RUN VERIFICATION REPORT
  ----------------------------
  Expected:
    column_exists = true
    authenticated_can_directly_update = false
    all existing profiles counted under standard
    tenant_admin profile count = 0
    PUBLIC/anon execution = false
    authenticated/service_role execution = true
*/

with function_info as (
  select procedure_record.oid
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'admin_set_hr_access_level'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = 'target_profile_id uuid, target_hr_access_level text'
)
select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
  ) as column_exists,

  has_column_privilege(
    'authenticated',
    'public.profiles',
    'hr_access_level',
    'UPDATE'
  ) as authenticated_can_directly_update,

  count(*) filter (
    where profile.hr_access_level = 'standard'
  ) as standard_profile_count,

  count(*) filter (
    where profile.hr_access_level = 'tenant_admin'
  ) as tenant_admin_profile_count,

  pg_catalog.has_function_privilege(
    'public',
    (select oid from function_info),
    'EXECUTE'
  ) as public_can_execute_assignment_rpc,

  pg_catalog.has_function_privilege(
    'anon',
    (select oid from function_info),
    'EXECUTE'
  ) as anon_can_execute_assignment_rpc,

  pg_catalog.has_function_privilege(
    'authenticated',
    (select oid from function_info),
    'EXECUTE'
  ) as authenticated_can_execute_assignment_rpc,

  pg_catalog.has_function_privilege(
    'service_role',
    (select oid from function_info),
    'EXECUTE'
  ) as service_role_can_execute_assignment_rpc
from public.profiles profile;
