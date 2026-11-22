/*
BexHR Phase 2I-A repair

The initial administrative audit trigger referenced public.profiles.user_id.
This project uses public.profiles.id as the authenticated profile key.
The failed Company Admin promotion was rolled back; no access was changed.
*/

begin;

do $phase_2i_a_actor_lookup_repair$
declare
  v_definition text;
  v_repaired_definition text;
begin
  if to_regprocedure(
    'public.capture_administrative_audit_event()'
  ) is null then
    raise exception
      'Phase 2I-A repair stopped: capture function does not exist.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) then
    raise exception
      'Phase 2I-A repair stopped: profiles.user_id exists unexpectedly.';
  end if;

  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into v_definition
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'capture_administrative_audit_event'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if position(
    'profile.user_id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 2I-A repair stopped: invalid profiles.user_id reference was not found.';
  end if;

  v_repaired_definition := pg_catalog.regexp_replace(
    v_definition,
    'where[[:space:]]+profile[.]id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+or[[:space:]]+profile[.]user_id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+order by[[:space:]]+case[[:space:]]+when[[:space:]]+profile[.]id[[:space:]]*=[[:space:]]*v_actor_user_id[[:space:]]+then[[:space:]]+0[[:space:]]+else[[:space:]]+1[[:space:]]+end[[:space:]]+limit[[:space:]]+1;',
    E'where profile.id = v_actor_user_id\n  limit 1;',
    'i'
  );

  if v_repaired_definition = v_definition then
    raise exception
      'Phase 2I-A repair stopped: actor lookup pattern was not replaced.';
  end if;

  execute v_repaired_definition;
end;
$phase_2i_a_actor_lookup_repair$;

do $phase_2i_a_actor_lookup_verification$
declare
  v_definition text;
  v_security_definer boolean;
begin
  select
    pg_catalog.pg_get_functiondef(procedure_record.oid),
    procedure_record.prosecdef
  into
    v_definition,
    v_security_definer
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
      'capture_administrative_audit_event'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_security_definer is not true then
    raise exception
      'Phase 2I-A repair verification failed: function is not SECURITY DEFINER.';
  end if;

  if position(
    'where profile.id = v_actor_user_id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 2I-A repair verification failed: profiles.id actor lookup is missing.';
  end if;

  if position(
    'profile.user_id'
    in lower(v_definition)
  ) <> 0 then
    raise exception
      'Phase 2I-A repair verification failed: profiles.user_id reference remains.';
  end if;
end;
$phase_2i_a_actor_lookup_verification$;

commit;

select
  'Phase 2I-A profile actor lookup repaired' as result,
  position(
    'where profile.id = v_actor_user_id'
    in lower(
      pg_catalog.pg_get_functiondef(
        'public.capture_administrative_audit_event()'::regprocedure
      )
    )
  ) > 0 as profile_id_lookup_installed,
  position(
    'profile.user_id'
    in lower(
      pg_catalog.pg_get_functiondef(
        'public.capture_administrative_audit_event()'::regprocedure
      )
    )
  ) = 0 as invalid_user_id_reference_removed;