/*
BexHR Phase 4A repair

Purpose
-------
Repair the Phase 4A hierarchy audit trigger actor lookup.

The deployed Phase 4A audit function accidentally referenced
public.profiles.user_id. This project uses public.profiles.id as the
authenticated profile key, matching the earlier Phase 2I-A repair.

Safety
------
- Does not alter hierarchy data.
- Does not alter employee reporting lines, Leave, or PA data.
- Replaces only the invalid actor lookup inside the existing audit function.
- Aborts if the expected broken definition is not present.
- Verifies the repaired function and trigger before commit.
*/

begin;

do $phase4a_audit_actor_repair_preflight$
declare
  v_definition text;
begin
  if to_regprocedure(
    'bexhr_private.capture_organization_job_title_hierarchy_audit()'
  ) is null then
    raise exception
      'Phase 4A repair stopped: hierarchy audit function does not exist.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) then
    raise exception
      'Phase 4A repair stopped: profiles.user_id exists unexpectedly.';
  end if;

  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into v_definition
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'bexhr_private'
    and procedure_record.proname =
      'capture_organization_job_title_hierarchy_audit'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if position(
    'profile.user_id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 4A repair stopped: invalid profiles.user_id reference was not found.';
  end if;
end;
$phase4a_audit_actor_repair_preflight$;

do $phase4a_audit_actor_repair$
declare
  v_definition text;
  v_repaired_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into v_definition
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'bexhr_private'
    and procedure_record.proname =
      'capture_organization_job_title_hierarchy_audit'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  v_repaired_definition := pg_catalog.regexp_replace(
    v_definition,
    'where[[:space:]]+profile[.]id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+or[[:space:]]+profile[.]user_id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+order by[[:space:]]+case[[:space:]]+when[[:space:]]+profile[.]id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+then[[:space:]]+0[[:space:]]+else[[:space:]]+1[[:space:]]+end[[:space:]]+limit[[:space:]]+1;',
    E'where profile.id = v_actor_user_id\n  limit 1;',
    'i'
  );

  if v_repaired_definition = v_definition then
    raise exception
      'Phase 4A repair stopped: actor lookup pattern was not replaced.';
  end if;

  execute v_repaired_definition;
end;
$phase4a_audit_actor_repair$;

do $phase4a_audit_actor_repair_verification$
declare
  v_definition text;
  v_function_oid oid;
  v_security_definer boolean;
begin
  select
    procedure_record.oid,
    pg_catalog.pg_get_functiondef(procedure_record.oid),
    procedure_record.prosecdef
  into
    v_function_oid,
    v_definition,
    v_security_definer
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'bexhr_private'
    and procedure_record.proname =
      'capture_organization_job_title_hierarchy_audit'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_function_oid is null then
    raise exception
      'Phase 4A repair verification failed: hierarchy audit function is missing.';
  end if;

  if v_security_definer is not true then
    raise exception
      'Phase 4A repair verification failed: hierarchy audit function is not SECURITY DEFINER.';
  end if;

  if position(
    'where profile.id = v_actor_user_id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 4A repair verification failed: profiles.id actor lookup is missing.';
  end if;

  if position(
    'profile.user_id'
    in lower(v_definition)
  ) <> 0 then
    raise exception
      'Phase 4A repair verification failed: profiles.user_id reference remains.';
  end if;

  if has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 4A repair verification failed: anon can execute the private audit function.';
  end if;

  if has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 4A repair verification failed: authenticated can execute the private audit function.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_title_hierarchy'::regclass
      and trigger_record.tgname =
        'audit_organization_job_title_hierarchy_changes'
      and trigger_record.tgfoid = v_function_oid
      and trigger_record.tgisinternal is false
  ) then
    raise exception
      'Phase 4A repair verification failed: hierarchy audit trigger is not attached to the repaired function.';
  end if;
end;
$phase4a_audit_actor_repair_verification$;

commit;
