-- BexHR Phase 2G4
-- Final Company Administration write lock-down.
--
-- Purpose:
--   - keep authenticated tenant-scoped SELECT access;
--   - remove every direct browser INSERT / UPDATE / DELETE path;
--   - leave the protected Company Admin SECURITY DEFINER RPCs as the only
--     authenticated write route;
--   - keep service_role access for trusted backend operations.
--
-- This migration does not change existing Company Administration data.
-- It does not change profiles.role or profiles.hr_access_level.

begin;

do $phase_2g4_preflight$
declare
  v_table_name text;
  v_function_oid oid;
begin
  foreach v_table_name in array array[
    'organization_settings',
    'organization_departments',
    'organization_job_titles'
  ]
  loop
    if to_regclass(format('public.%I', v_table_name)) is null then
      raise exception
        'Phase 2G4 stopped: public.% is missing.',
        v_table_name;
    end if;

    if not exists (
      select 1
      from pg_class table_record
      join pg_namespace namespace_record
        on namespace_record.oid = table_record.relnamespace
      where namespace_record.nspname = 'public'
        and table_record.relname = v_table_name
        and table_record.relrowsecurity is true
    ) then
      raise exception
        'Phase 2G4 stopped: RLS is not enabled on public.%.',
        v_table_name;
    end if;
  end loop;

  foreach v_function_oid in array array[
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_settings(text,text,text,text,text,text,text)'
    ),
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_department(uuid,text,text,text)'
    ),
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)'
    )
  ]
  loop
    if v_function_oid is null then
      raise exception
        'Phase 2G4 stopped: a protected Company Administration RPC is missing.';
    end if;

    if not exists (
      select 1
      from pg_proc procedure_record
      where procedure_record.oid = v_function_oid
        and procedure_record.prosecdef is true
    ) then
      raise exception
        'Phase 2G4 stopped: a protected Company Administration RPC is not SECURITY DEFINER.';
    end if;

    if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
      raise exception
        'Phase 2G4 stopped: anon can execute a protected Company Administration RPC.';
    end if;

    if not has_function_privilege(
      'authenticated',
      v_function_oid,
      'EXECUTE'
    ) then
      raise exception
        'Phase 2G4 stopped: authenticated cannot execute a protected Company Administration RPC.';
    end if;
  end loop;
end;
$phase_2g4_preflight$;

-- Remove every existing non-SELECT RLS policy from the three protected tables.
-- SELECT policies remain untouched so tenant-scoped read access continues.
do $phase_2g4_drop_write_policies$
declare
  v_policy record;
begin
  for v_policy in
    select
      policy_record.tablename,
      policy_record.policyname
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename in (
        'organization_settings',
        'organization_departments',
        'organization_job_titles'
      )
      and upper(policy_record.cmd) <> 'SELECT'
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  end loop;
end;
$phase_2g4_drop_write_policies$;

-- Anonymous users receive no direct table access.
revoke all privileges
on table public.organization_settings
from anon;

revoke all privileges
on table public.organization_departments
from anon;

revoke all privileges
on table public.organization_job_titles
from anon;

-- PUBLIC receives no direct table access.
revoke all privileges
on table public.organization_settings
from public;

revoke all privileges
on table public.organization_departments
from public;

revoke all privileges
on table public.organization_job_titles
from public;

-- Authenticated browser sessions retain read access only.
revoke all privileges
on table public.organization_settings
from authenticated;

revoke all privileges
on table public.organization_departments
from authenticated;

revoke all privileges
on table public.organization_job_titles
from authenticated;

grant select
on table public.organization_settings
to authenticated;

grant select
on table public.organization_departments
to authenticated;

grant select
on table public.organization_job_titles
to authenticated;

-- Trusted backend operations retain full table access.
grant all privileges
on table public.organization_settings
to service_role;

grant all privileges
on table public.organization_departments
to service_role;

grant all privileges
on table public.organization_job_titles
to service_role;

do $phase_2g4_verify$
declare
  v_table_name text;
  v_function_oid oid;
  v_remaining_write_policy_count integer;
begin
  foreach v_table_name in array array[
    'organization_settings',
    'organization_departments',
    'organization_job_titles'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table_name),
      'SELECT'
    ) then
      raise exception
        'Phase 2G4 verification failed: authenticated lost SELECT on public.%.',
        v_table_name;
    end if;

    if has_table_privilege(
      'authenticated',
      format('public.%I', v_table_name),
      'INSERT'
    ) then
      raise exception
        'Phase 2G4 verification failed: authenticated still has INSERT on public.%.',
        v_table_name;
    end if;

    if has_table_privilege(
      'authenticated',
      format('public.%I', v_table_name),
      'UPDATE'
    ) then
      raise exception
        'Phase 2G4 verification failed: authenticated still has UPDATE on public.%.',
        v_table_name;
    end if;

    if has_table_privilege(
      'authenticated',
      format('public.%I', v_table_name),
      'DELETE'
    ) then
      raise exception
        'Phase 2G4 verification failed: authenticated still has DELETE on public.%.',
        v_table_name;
    end if;

    if has_table_privilege(
      'anon',
      format('public.%I', v_table_name),
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      format('public.%I', v_table_name),
      'INSERT'
    )
    or has_table_privilege(
      'anon',
      format('public.%I', v_table_name),
      'UPDATE'
    )
    or has_table_privilege(
      'anon',
      format('public.%I', v_table_name),
      'DELETE'
    ) then
      raise exception
        'Phase 2G4 verification failed: anon retains direct access to public.%.',
        v_table_name;
    end if;

    if not has_table_privilege(
      'service_role',
      format('public.%I', v_table_name),
      'SELECT'
    )
    or not has_table_privilege(
      'service_role',
      format('public.%I', v_table_name),
      'INSERT'
    )
    or not has_table_privilege(
      'service_role',
      format('public.%I', v_table_name),
      'UPDATE'
    )
    or not has_table_privilege(
      'service_role',
      format('public.%I', v_table_name),
      'DELETE'
    ) then
      raise exception
        'Phase 2G4 verification failed: service_role does not retain full access to public.%.',
        v_table_name;
    end if;
  end loop;

  select count(*)
  into v_remaining_write_policy_count
  from pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename in (
      'organization_settings',
      'organization_departments',
      'organization_job_titles'
    )
    and upper(policy_record.cmd) <> 'SELECT';

  if v_remaining_write_policy_count <> 0 then
    raise exception
      'Phase 2G4 verification failed: % non-SELECT RLS policies remain.',
      v_remaining_write_policy_count;
  end if;

  foreach v_function_oid in array array[
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_settings(text,text,text,text,text,text,text)'
    ),
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_department(uuid,text,text,text)'
    ),
    to_regprocedure(
      'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)'
    )
  ]
  loop
    if not has_function_privilege(
      'authenticated',
      v_function_oid,
      'EXECUTE'
    ) then
      raise exception
        'Phase 2G4 verification failed: authenticated lost protected RPC execution.';
    end if;

    if has_function_privilege(
      'anon',
      v_function_oid,
      'EXECUTE'
    ) then
      raise exception
        'Phase 2G4 verification failed: anon gained protected RPC execution.';
    end if;
  end loop;
end;
$phase_2g4_verify$;

commit;

select
  'Phase 2G4 Company Administration direct writes locked' as result,

  has_table_privilege(
    'authenticated',
    'public.organization_settings',
    'SELECT'
  ) as settings_select_allowed,

  (
    not has_table_privilege(
      'authenticated',
      'public.organization_settings',
      'INSERT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_settings',
      'UPDATE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_settings',
      'DELETE'
    )
  ) as settings_direct_writes_blocked,

  has_table_privilege(
    'authenticated',
    'public.organization_departments',
    'SELECT'
  ) as departments_select_allowed,

  (
    not has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'INSERT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'UPDATE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'DELETE'
    )
  ) as departments_direct_writes_blocked,

  has_table_privilege(
    'authenticated',
    'public.organization_job_titles',
    'SELECT'
  ) as job_titles_select_allowed,

  (
    not has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'INSERT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'UPDATE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'DELETE'
    )
  ) as job_titles_direct_writes_blocked,

  (
    select count(*) = 0
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename in (
        'organization_settings',
        'organization_departments',
        'organization_job_titles'
      )
      and upper(policy_record.cmd) <> 'SELECT'
  ) as non_select_policies_removed,

  has_function_privilege(
    'authenticated',
    'public.hr_tenant_admin_save_organization_settings(text,text,text,text,text,text,text)',
    'EXECUTE'
  ) as settings_rpc_available,

  has_function_privilege(
    'authenticated',
    'public.hr_tenant_admin_save_organization_department(uuid,text,text,text)',
    'EXECUTE'
  ) as department_rpc_available,

  has_function_privilege(
    'authenticated',
    'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) as job_title_rpc_available;
