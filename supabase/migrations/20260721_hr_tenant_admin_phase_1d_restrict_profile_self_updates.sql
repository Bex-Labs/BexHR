/*
  BexHR Phase 1D
  Restrict authenticated self-service updates on public.profiles

  PURPOSE
  -------
  Prevent a signed-in user from changing security-sensitive profile columns
  such as role, tenant_id, is_active, email, or id through the browser API.

  PRESERVED SELF-SERVICE WRITES
  -----------------------------
  - full_name
  - profile_image_path
  - department
  - must_change_password

  OUT OF SCOPE
  ------------
  - No row data changes
  - No RLS policy changes
  - No SELECT changes
  - No service_role changes
  - No changes to HR role-sync or Platform Admin RPCs
  - No employee, payroll, leave, tenant, or authentication changes
*/

begin;

do $phase_1d_preflight$
declare
  v_missing_columns text[];
  v_self_update_policy_count integer;
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Phase 1D stopped: public.profiles does not exist.';
  end if;

  select array_agg(required_column order by required_column)
  into v_missing_columns
  from (
    values
      ('full_name'),
      ('profile_image_path'),
      ('department'),
      ('must_change_password'),
      ('role'),
      ('tenant_id'),
      ('is_active'),
      ('email'),
      ('id')
  ) as required(required_column)
  where not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'profiles'
      and column_info.column_name = required.required_column
  );

  if v_missing_columns is not null then
    raise exception
      'Phase 1D stopped: public.profiles is missing expected columns: %',
      array_to_string(v_missing_columns, ', ');
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'profiles'
      and relation.relrowsecurity = true
  ) then
    raise exception
      'Phase 1D stopped: RLS is not enabled on public.profiles.';
  end if;

  select count(*)
  into v_self_update_policy_count
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'profiles'
    and policy.policyname = 'profiles_self_update'
    and policy.cmd = 'UPDATE'
    and 'authenticated' = any(policy.roles)
    and policy.qual = '(id = auth.uid())'
    and policy.with_check = '(id = auth.uid())';

  if v_self_update_policy_count <> 1 then
    raise exception
      'Phase 1D stopped: the expected authenticated self-update RLS policy was not found exactly once.';
  end if;
end;
$phase_1d_preflight$;

-- Remove table-wide UPDATE authority. Revoking from PUBLIC prevents an
-- inherited public grant from bypassing the intended column restriction.
revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;

-- Restore only the currently required self-service columns.
grant update (
  full_name,
  profile_image_path,
  department,
  must_change_password
)
on table public.profiles
to authenticated;

do $phase_1d_verify$
declare
  v_allowed_columns constant text[] := array[
    'full_name',
    'profile_image_path',
    'department',
    'must_change_password'
  ];
  v_forbidden_columns constant text[] := array[
    'role',
    'tenant_id',
    'is_active',
    'email',
    'id',
    'created_at',
    'updated_at'
  ];
  v_column text;
begin
  if has_table_privilege(
    'authenticated',
    'public.profiles',
    'UPDATE'
  ) then
    raise exception
      'Phase 1D verification failed: authenticated still has table-wide UPDATE on public.profiles.';
  end if;

  if has_table_privilege(
    'anon',
    'public.profiles',
    'UPDATE'
  ) then
    raise exception
      'Phase 1D verification failed: anon still has table-wide UPDATE on public.profiles.';
  end if;

  foreach v_column in array v_allowed_columns loop
    if not has_column_privilege(
      'authenticated',
      'public.profiles',
      v_column,
      'UPDATE'
    ) then
      raise exception
        'Phase 1D verification failed: authenticated is missing UPDATE on allowed column public.profiles.%.',
        v_column;
    end if;
  end loop;

  foreach v_column in array v_forbidden_columns loop
    if has_column_privilege(
      'authenticated',
      'public.profiles',
      v_column,
      'UPDATE'
    ) then
      raise exception
        'Phase 1D verification failed: authenticated can still UPDATE forbidden column public.profiles.%.',
        v_column;
    end if;
  end loop;

  if not has_table_privilege(
    'service_role',
    'public.profiles',
    'UPDATE'
  ) then
    raise exception
      'Phase 1D verification failed: service_role lost UPDATE on public.profiles.';
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
      'Phase 1D verification failed: profiles_self_update RLS policy changed unexpectedly.';
  end if;
end;
$phase_1d_verify$;

commit;

/*
  POST-RUN VERIFICATION RESULT
  ----------------------------
  This final read-only result should return:
  - authenticated_table_update = false
  - anon_table_update = false
  - each allowed authenticated column = true
  - each forbidden authenticated column = false
  - service_role_table_update = true
*/

select
  has_table_privilege(
    'authenticated',
    'public.profiles',
    'UPDATE'
  ) as authenticated_table_update,
  has_table_privilege(
    'anon',
    'public.profiles',
    'UPDATE'
  ) as anon_table_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'full_name',
    'UPDATE'
  ) as authenticated_full_name_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'profile_image_path',
    'UPDATE'
  ) as authenticated_profile_image_path_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'department',
    'UPDATE'
  ) as authenticated_department_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'must_change_password',
    'UPDATE'
  ) as authenticated_must_change_password_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'role',
    'UPDATE'
  ) as authenticated_role_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'tenant_id',
    'UPDATE'
  ) as authenticated_tenant_id_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'is_active',
    'UPDATE'
  ) as authenticated_is_active_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'email',
    'UPDATE'
  ) as authenticated_email_update,
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'id',
    'UPDATE'
  ) as authenticated_id_update,
  has_table_privilege(
    'service_role',
    'public.profiles',
    'UPDATE'
  ) as service_role_table_update;
