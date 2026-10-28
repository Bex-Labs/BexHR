/*
BexHR HR Tenant Admin - Phase 2I-A
Immutable tenant-isolated administrative audit foundation

Purpose
-------
Create an append-only administrative audit store for successful privileged
changes without altering existing HR, payroll, leave, tenant, or UI behaviour.

Captured automatically
----------------------
1. Profile access changes:
   - role
   - hr_access_level
   - tenant_id
   - is_active

2. Company Administration changes:
   - organization_settings
   - organization_departments
   - organization_job_titles

Security
--------
- Browser roles receive no direct table access.
- RLS is enabled with no direct application policies.
- Writes occur only through a SECURITY DEFINER database trigger.
- UPDATE and DELETE are blocked by an immutable-row trigger.
- Tenant, actor, target, before-state, after-state, changed fields, and time
  are server-derived.

Not included in Phase 2I-A
--------------------------
- No Company Admin or Platform Admin audit UI.
- No read/list RPCs.
- No failed-attempt logging.
- No employee, manager, or admin visual refresh.
*/

begin;

do $phase_2i_a_preflight$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Phase 2I-A stopped: public.profiles does not exist.';
  end if;

  if to_regclass('public.tenants') is null then
    raise exception 'Phase 2I-A stopped: public.tenants does not exist.';
  end if;

  if to_regclass('public.organization_settings') is null then
    raise exception 'Phase 2I-A stopped: public.organization_settings does not exist.';
  end if;

  if to_regclass('public.organization_departments') is null then
    raise exception 'Phase 2I-A stopped: public.organization_departments does not exist.';
  end if;

  if to_regclass('public.organization_job_titles') is null then
    raise exception 'Phase 2I-A stopped: public.organization_job_titles does not exist.';
  end if;

  if to_regclass('public.administrative_audit_events') is not null then
    raise exception 'Phase 2I-A stopped: public.administrative_audit_events already exists.';
  end if;

  if to_regprocedure('public.capture_administrative_audit_event()') is not null then
    raise exception 'Phase 2I-A stopped: public.capture_administrative_audit_event() already exists.';
  end if;

  if to_regprocedure('public.prevent_administrative_audit_event_mutation()') is not null then
    raise exception 'Phase 2I-A stopped: public.prevent_administrative_audit_event_mutation() already exists.';
  end if;
end;
$phase_2i_a_preflight$;

create table public.administrative_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_scope text not null,
  tenant_id uuid null references public.tenants(id) on delete restrict,

  actor_user_id uuid null,
  actor_profile_id uuid null,
  actor_email text null,
  actor_name text null,
  actor_role text null,
  actor_hr_access_level text null,

  target_profile_id uuid null,
  target_email text null,
  target_name text null,

  event_type text not null,
  entity_type text not null,
  entity_id text null,
  action_status text not null default 'success',

  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  changed_fields text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now(),

  constraint administrative_audit_events_scope_check
    check (event_scope in ('tenant', 'platform')),

  constraint administrative_audit_events_status_check
    check (action_status in ('success', 'failed', 'blocked', 'skipped')),

  constraint administrative_audit_events_tenant_scope_check
    check (
      event_scope = 'platform'
      or tenant_id is not null
    )
);

comment on table public.administrative_audit_events is
  'Append-only administrative audit events for profile access and Company Administration changes. Direct application writes are prohibited.';

comment on column public.administrative_audit_events.event_scope is
  'tenant for company-scoped administration; platform for BexHR Platform Admin actions.';

comment on column public.administrative_audit_events.previous_values is
  'Server-captured values before the successful administrative change.';

comment on column public.administrative_audit_events.new_values is
  'Server-captured values after the successful administrative change.';

create index administrative_audit_events_tenant_time_idx
  on public.administrative_audit_events (
    tenant_id,
    occurred_at desc
  );

create index administrative_audit_events_event_type_time_idx
  on public.administrative_audit_events (
    event_type,
    occurred_at desc
  );

create index administrative_audit_events_actor_time_idx
  on public.administrative_audit_events (
    actor_profile_id,
    occurred_at desc
  );

create index administrative_audit_events_target_profile_time_idx
  on public.administrative_audit_events (
    target_profile_id,
    occurred_at desc
  )
  where target_profile_id is not null;

alter table public.administrative_audit_events
  enable row level security;

revoke all on table public.administrative_audit_events
  from public, anon, authenticated;

grant select, insert on table public.administrative_audit_events
  to service_role;

create function public.prevent_administrative_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  raise exception
    'Administrative audit events are immutable and cannot be updated or deleted.'
    using errcode = '42501';
end;
$function$;

comment on function public.prevent_administrative_audit_event_mutation() is
  'Blocks UPDATE and DELETE so administrative audit events remain append-only.';

revoke all
  on function public.prevent_administrative_audit_event_mutation()
  from public, anon, authenticated;

grant execute
  on function public.prevent_administrative_audit_event_mutation()
  to service_role;

create trigger prevent_administrative_audit_event_mutation
before update or delete
on public.administrative_audit_events
for each row
execute function public.prevent_administrative_audit_event_mutation();

create function public.capture_administrative_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_old jsonb := case
    when tg_op = 'INSERT' then '{}'::jsonb
    else to_jsonb(old)
  end;

  v_new jsonb := case
    when tg_op = 'DELETE' then '{}'::jsonb
    else to_jsonb(new)
  end;

  v_actor public.profiles%rowtype;
  v_actor_user_id uuid := auth.uid();
  v_event_scope text := 'tenant';
  v_tenant_id uuid;
  v_target_profile_id uuid;
  v_target_email text;
  v_target_name text;
  v_event_type text;
  v_entity_type text := tg_table_name;
  v_entity_id text;
  v_previous_values jsonb := '{}'::jsonb;
  v_new_values jsonb := '{}'::jsonb;
  v_changed_fields text[] := array[]::text[];
begin
  select profile.*
  into v_actor
  from public.profiles profile
  where profile.id = v_actor_user_id
     or profile.user_id = v_actor_user_id
  order by
    case
      when profile.id = v_actor_user_id then 0
      else 1
    end
  limit 1;

  if lower(trim(coalesce(v_actor.role, ''))) = 'admin' then
    v_event_scope := 'platform';
  end if;

  v_tenant_id := nullif(
    coalesce(
      v_new ->> 'tenant_id',
      v_old ->> 'tenant_id',
      v_actor.tenant_id::text
    ),
    ''
  )::uuid;

  v_entity_id := nullif(
    coalesce(
      v_new ->> 'id',
      v_old ->> 'id'
    ),
    ''
  );

  select coalesce(
    array_agg(changed_key order by changed_key),
    array[]::text[]
  )
  into v_changed_fields
  from (
    select keys.key as changed_key
    from jsonb_object_keys(v_old || v_new) as keys(key)
    where v_old -> keys.key is distinct from v_new -> keys.key
  ) changed;

  if tg_table_name = 'profiles' then
    v_target_profile_id := nullif(
      coalesce(v_new ->> 'id', v_old ->> 'id'),
      ''
    )::uuid;

    v_target_email := nullif(
      coalesce(v_new ->> 'email', v_old ->> 'email'),
      ''
    );

    v_target_name := nullif(
      coalesce(v_new ->> 'full_name', v_old ->> 'full_name'),
      ''
    );

    v_event_type := 'profile_access_changed';

    v_previous_values := jsonb_build_object(
      'role', v_old -> 'role',
      'hr_access_level', v_old -> 'hr_access_level',
      'tenant_id', v_old -> 'tenant_id',
      'is_active', v_old -> 'is_active'
    );

    v_new_values := jsonb_build_object(
      'role', v_new -> 'role',
      'hr_access_level', v_new -> 'hr_access_level',
      'tenant_id', v_new -> 'tenant_id',
      'is_active', v_new -> 'is_active'
    );

    v_changed_fields := array(
      select field_name
      from unnest(
        array[
          'role',
          'hr_access_level',
          'tenant_id',
          'is_active'
        ]::text[]
      ) as field_name
      where v_old -> field_name is distinct from v_new -> field_name
      order by field_name
    );

    if cardinality(v_changed_fields) = 0 then
      if tg_op = 'DELETE' then
        return old;
      end if;

      return new;
    end if;
  elsif tg_table_name = 'organization_settings' then
    v_event_type := case tg_op
      when 'INSERT' then 'organization_settings_created'
      when 'UPDATE' then 'organization_settings_updated'
      else 'organization_settings_deleted'
    end;

    v_previous_values := v_old
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';

    v_new_values := v_new
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';
  elsif tg_table_name = 'organization_departments' then
    v_event_type := case tg_op
      when 'INSERT' then 'organization_department_created'
      when 'UPDATE' then 'organization_department_updated'
      else 'organization_department_deleted'
    end;

    v_previous_values := v_old
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';

    v_new_values := v_new
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';
  elsif tg_table_name = 'organization_job_titles' then
    v_event_type := case tg_op
      when 'INSERT' then 'organization_job_title_created'
      when 'UPDATE' then 'organization_job_title_updated'
      else 'organization_job_title_deleted'
    end;

    v_previous_values := v_old
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';

    v_new_values := v_new
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at';
  else
    raise exception
      'Unsupported administrative audit source table: %',
      tg_table_name;
  end if;

  insert into public.administrative_audit_events (
    event_scope,
    tenant_id,

    actor_user_id,
    actor_profile_id,
    actor_email,
    actor_name,
    actor_role,
    actor_hr_access_level,

    target_profile_id,
    target_email,
    target_name,

    event_type,
    entity_type,
    entity_id,
    action_status,

    previous_values,
    new_values,
    changed_fields,
    metadata
  )
  values (
    v_event_scope,
    v_tenant_id,

    v_actor_user_id,
    v_actor.id,
    nullif(trim(coalesce(v_actor.email, '')), ''),
    nullif(trim(coalesce(v_actor.full_name, '')), ''),
    nullif(trim(coalesce(v_actor.role, '')), ''),
    nullif(trim(coalesce(v_actor.hr_access_level, '')), ''),

    v_target_profile_id,
    v_target_email,
    v_target_name,

    v_event_type,
    v_entity_type,
    v_entity_id,
    'success',

    coalesce(v_previous_values, '{}'::jsonb),
    coalesce(v_new_values, '{}'::jsonb),
    coalesce(v_changed_fields, array[]::text[]),
    jsonb_build_object(
      'database_operation', tg_op,
      'source_schema', tg_table_schema,
      'source_table', tg_table_name
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

comment on function public.capture_administrative_audit_event() is
  'Server-side trigger writer for successful profile-access and Company Administration changes.';

revoke all
  on function public.capture_administrative_audit_event()
  from public, anon, authenticated;

grant execute
  on function public.capture_administrative_audit_event()
  to service_role;

create trigger audit_profile_access_changes
after update of role, hr_access_level, tenant_id, is_active
on public.profiles
for each row
when (
  old.role is distinct from new.role
  or old.hr_access_level is distinct from new.hr_access_level
  or old.tenant_id is distinct from new.tenant_id
  or old.is_active is distinct from new.is_active
)
execute function public.capture_administrative_audit_event();

create trigger audit_organization_settings_changes
after insert or update or delete
on public.organization_settings
for each row
execute function public.capture_administrative_audit_event();

create trigger audit_organization_department_changes
after insert or update or delete
on public.organization_departments
for each row
execute function public.capture_administrative_audit_event();

create trigger audit_organization_job_title_changes
after insert or update or delete
on public.organization_job_titles
for each row
execute function public.capture_administrative_audit_event();

do $phase_2i_a_verification$
declare
  v_table_rls_enabled boolean;
  v_capture_function_security_definer boolean;
  v_trigger_count integer;
begin
  select relation.relrowsecurity
  into v_table_rls_enabled
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = relation.relnamespace
  where namespace_record.nspname = 'public'
    and relation.relname = 'administrative_audit_events';

  if v_table_rls_enabled is not true then
    raise exception 'Phase 2I-A verification failed: audit table RLS is not enabled.';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.administrative_audit_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception 'Phase 2I-A verification failed: authenticated has direct audit table privileges.';
  end if;

  if has_table_privilege(
    'anon',
    'public.administrative_audit_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception 'Phase 2I-A verification failed: anon has direct audit table privileges.';
  end if;

  select procedure_record.prosecdef
  into v_capture_function_security_definer
  from pg_catalog.pg_proc procedure_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'capture_administrative_audit_event'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = '';

  if v_capture_function_security_definer is not true then
    raise exception 'Phase 2I-A verification failed: capture function is not SECURITY DEFINER.';
  end if;

  select count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgisinternal is false
    and trigger_record.tgname in (
      'prevent_administrative_audit_event_mutation',
      'audit_profile_access_changes',
      'audit_organization_settings_changes',
      'audit_organization_department_changes',
      'audit_organization_job_title_changes'
    );

  if v_trigger_count <> 5 then
    raise exception
      'Phase 2I-A verification failed: expected 5 audit triggers, found %.',
      v_trigger_count;
  end if;
end;
$phase_2i_a_verification$;

commit;

select
  'Phase 2I-A immutable administrative audit foundation installed' as result,
  to_regclass(
    'public.administrative_audit_events'
  ) is not null as audit_table_exists,
  to_regprocedure(
    'public.capture_administrative_audit_event()'
  ) is not null as capture_function_exists,
  to_regprocedure(
    'public.prevent_administrative_audit_event_mutation()'
  ) is not null as immutable_guard_exists,
  not has_table_privilege(
    'authenticated',
    'public.administrative_audit_events',
    'SELECT'
  ) as authenticated_direct_read_blocked,
  not has_table_privilege(
    'authenticated',
    'public.administrative_audit_events',
    'INSERT'
  ) as authenticated_direct_insert_blocked,
  not has_table_privilege(
    'authenticated',
    'public.administrative_audit_events',
    'UPDATE'
  ) as authenticated_direct_update_blocked,
  not has_table_privilege(
    'authenticated',
    'public.administrative_audit_events',
    'DELETE'
  ) as authenticated_direct_delete_blocked;