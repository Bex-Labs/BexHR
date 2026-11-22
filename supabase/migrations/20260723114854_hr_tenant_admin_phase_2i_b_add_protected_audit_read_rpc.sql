/*
BexHR HR Tenant Admin - Phase 2I-B
Protected administrative audit read RPC

Purpose
-------
Expose immutable administrative audit history through one role-aware,
read-only RPC without granting direct table access.

Visibility
----------
- Active BexHR Platform Admin:
  may read all administrative audit events.
- Active Company Admin:
  may read only events whose tenant_id matches their own tenant.
- Standard HR Officer, Manager, Employee, anonymous user:
  denied.

Presentation correction
-----------------------
Platform Admin profiles retain the database default hr_access_level = standard,
but that field is not applicable to the Platform Admin role. The RPC therefore
returns actor_access_level_label = 'Not applicable' for actor_role = admin.
Raw immutable audit values are not rewritten.
*/

begin;

do $phase_2i_b_preflight$
begin
  if to_regclass(
    'public.administrative_audit_events'
  ) is null then
    raise exception
      'Phase 2I-B stopped: public.administrative_audit_events does not exist.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception
      'Phase 2I-B stopped: public.profiles does not exist.';
  end if;

  if to_regprocedure(
    'public.list_administrative_audit_events(integer, integer)'
  ) is not null then
    raise exception
      'Phase 2I-B stopped: list_administrative_audit_events(integer, integer) already exists.';
  end if;
end;
$phase_2i_b_preflight$;

create function public.list_administrative_audit_events(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  id uuid,
  event_scope text,
  tenant_id uuid,

  actor_user_id uuid,
  actor_profile_id uuid,
  actor_email text,
  actor_name text,
  actor_role text,
  actor_hr_access_level text,
  actor_access_level_label text,

  target_profile_id uuid,
  target_email text,
  target_name text,

  event_type text,
  entity_type text,
  entity_id text,
  action_status text,

  previous_values jsonb,
  new_values jsonb,
  changed_fields text[],
  metadata jsonb,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller public.profiles%rowtype;
  v_role text;
  v_access_level text;
  v_limit integer := least(
    greatest(coalesce(p_limit, 100), 1),
    250
  );
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select profile.*
  into v_caller
  from public.profiles profile
  where profile.id = auth.uid()
  limit 1;

  if not found or coalesce(v_caller.is_active, false) is not true then
    raise exception
      'Only an active Company Admin or BexHR Platform Admin can view administrative audit history.'
      using errcode = '42501';
  end if;

  v_role := lower(trim(coalesce(v_caller.role, '')));
  v_access_level := lower(
    trim(coalesce(v_caller.hr_access_level, 'standard'))
  );

  if v_role = 'admin' then
    return query
    select
      count(*) over() as total_count,
      audit.id,
      audit.event_scope,
      audit.tenant_id,

      audit.actor_user_id,
      audit.actor_profile_id,
      audit.actor_email,
      audit.actor_name,
      audit.actor_role,
      audit.actor_hr_access_level,
      case
        when lower(trim(coalesce(audit.actor_role, ''))) = 'admin'
          then 'Not applicable'
        when lower(trim(coalesce(audit.actor_role, ''))) = 'hr'
          and lower(
            trim(
              coalesce(
                audit.actor_hr_access_level,
                'standard'
              )
            )
          ) = 'tenant_admin'
          then 'Company Admin'
        when lower(trim(coalesce(audit.actor_role, ''))) = 'hr'
          then 'HR Officer'
        else 'Not applicable'
      end as actor_access_level_label,

      audit.target_profile_id,
      audit.target_email,
      audit.target_name,

      audit.event_type,
      audit.entity_type,
      audit.entity_id,
      audit.action_status,

      audit.previous_values,
      audit.new_values,
      audit.changed_fields,
      audit.metadata,
      audit.occurred_at
    from public.administrative_audit_events audit
    order by audit.occurred_at desc, audit.id desc
    limit v_limit
    offset v_offset;

    return;
  end if;

  if (
    v_role = 'hr'
    and v_access_level = 'tenant_admin'
    and v_caller.tenant_id is not null
  ) then
    return query
    select
      count(*) over() as total_count,
      audit.id,
      audit.event_scope,
      audit.tenant_id,

      audit.actor_user_id,
      audit.actor_profile_id,
      audit.actor_email,
      audit.actor_name,
      audit.actor_role,
      audit.actor_hr_access_level,
      case
        when lower(trim(coalesce(audit.actor_role, ''))) = 'admin'
          then 'Not applicable'
        when lower(trim(coalesce(audit.actor_role, ''))) = 'hr'
          and lower(
            trim(
              coalesce(
                audit.actor_hr_access_level,
                'standard'
              )
            )
          ) = 'tenant_admin'
          then 'Company Admin'
        when lower(trim(coalesce(audit.actor_role, ''))) = 'hr'
          then 'HR Officer'
        else 'Not applicable'
      end as actor_access_level_label,

      audit.target_profile_id,
      audit.target_email,
      audit.target_name,

      audit.event_type,
      audit.entity_type,
      audit.entity_id,
      audit.action_status,

      audit.previous_values,
      audit.new_values,
      audit.changed_fields,
      audit.metadata,
      audit.occurred_at
    from public.administrative_audit_events audit
    where audit.tenant_id = v_caller.tenant_id
    order by audit.occurred_at desc, audit.id desc
    limit v_limit
    offset v_offset;

    return;
  end if;

  raise exception
    'Only an active Company Admin or BexHR Platform Admin can view administrative audit history.'
    using errcode = '42501';
end;
$function$;

comment on function public.list_administrative_audit_events(
  integer,
  integer
) is
  'Role-aware read-only administrative audit history. Platform Admin sees all events; Company Admin sees only their tenant.';

revoke all
  on function public.list_administrative_audit_events(
    integer,
    integer
  )
  from public;

revoke execute
  on function public.list_administrative_audit_events(
    integer,
    integer
  )
  from anon;

grant execute
  on function public.list_administrative_audit_events(
    integer,
    integer
  )
  to authenticated, service_role;

do $phase_2i_b_verification$
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
      'list_administrative_audit_events'
    and pg_catalog.pg_get_function_identity_arguments(
      procedure_record.oid
    ) = 'p_limit integer, p_offset integer';

  if v_definition is null then
    raise exception
      'Phase 2I-B verification failed: read RPC was not found.';
  end if;

  if v_security_definer is not true then
    raise exception
      'Phase 2I-B verification failed: read RPC is not SECURITY DEFINER.';
  end if;

  if position(
    'audit.tenant_id = v_caller.tenant_id'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 2I-B verification failed: Company Admin tenant filter is missing.';
  end if;

  if position(
    'not applicable'
    in lower(v_definition)
  ) = 0 then
    raise exception
      'Phase 2I-B verification failed: Platform Admin access-label correction is missing.';
  end if;

  if has_function_privilege(
    'public',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) then
    raise exception
      'Phase 2I-B verification failed: PUBLIC can execute the read RPC.';
  end if;

  if has_function_privilege(
    'anon',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) then
    raise exception
      'Phase 2I-B verification failed: anon can execute the read RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) then
    raise exception
      'Phase 2I-B verification failed: authenticated cannot execute the protected read RPC.';
  end if;
end;
$phase_2i_b_verification$;

commit;

select
  'Phase 2I-B protected administrative audit read RPC installed' as result,
  to_regprocedure(
    'public.list_administrative_audit_events(integer, integer)'
  ) is not null as read_rpc_exists,
  not has_function_privilege(
    'public',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) as public_execute_blocked,
  not has_function_privilege(
    'anon',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) as anonymous_execute_blocked,
  has_function_privilege(
    'authenticated',
    'public.list_administrative_audit_events(integer, integer)',
    'EXECUTE'
  ) as authenticated_execute_enabled,
  position(
    'not applicable'
    in lower(
      pg_catalog.pg_get_functiondef(
        'public.list_administrative_audit_events(integer, integer)'::regprocedure
      )
    )
  ) > 0 as platform_admin_display_correction_installed;