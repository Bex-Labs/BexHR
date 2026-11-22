-- BEXHR PHASE 4A-1 ORGANIZATION POSITION HIERARCHY
--
-- Purpose:
--   Introduce tenant-configurable ordering between whole-organization positions.
--
-- Examples are data, never executable title logic:
--   COO -> CEO
--   Executive Director -> Managing Director
--
-- Scope:
--   1. Tenant-scoped position-to-position hierarchy.
--   2. Explicit top-level positions use reports_to_job_title_id = NULL.
--   3. Missing hierarchy row means the position has not been configured.
--   4. Whole-organization positions only.
--   5. Active positions only.
--   6. No self-reporting or circular position chains.
--   7. Company/Tenant Administrator writes through protected RPCs only.
--   8. Authenticated tenant users receive read-only hierarchy access.
--   9. Hierarchy changes are recorded in the existing administrative audit store.
--
-- Deliberately out of scope:
--   - employee_reporting_lines reconciliation or automatic reassignment;
--   - leave workflow changes;
--   - Performance Appraisal routing;
--   - literal CEO/COO/MD title-name rules.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- PREFLIGHT
-- ---------------------------------------------------------------------------
do $phase4a_preflight$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'Phase 4A stopped: public.tenants is missing.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'Phase 4A stopped: public.profiles is missing.';
  end if;

  if to_regclass('public.organization_job_titles') is null then
    raise exception 'Phase 4A stopped: public.organization_job_titles is missing.';
  end if;

  if to_regclass('public.administrative_audit_events') is null then
    raise exception 'Phase 4A stopped: public.administrative_audit_events is missing.';
  end if;

  if to_regprocedure('public.require_current_tenant_administrator()') is null then
    raise exception 'Phase 4A stopped: Tenant Administrator guard is missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'Phase 4A stopped: authenticated tenant resolver is missing.';
  end if;

  if to_regclass('public.organization_job_title_hierarchy') is not null then
    raise exception 'Phase 4A stopped: public.organization_job_title_hierarchy already exists.';
  end if;
end;
$phase4a_preflight$;

create schema if not exists bexhr_private;

revoke all on schema bexhr_private
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- TENANT-SCOPED POSITION HIERARCHY
--
-- job_title_id identifies the configured position.
--
-- reports_to_job_title_id:
--   NULL     = explicitly configured top-level position.
--   non-NULL = direct parent position.
--
-- The absence of a row is intentionally different from a NULL parent:
--   no row      = hierarchy not configured;
--   row + NULL  = explicitly top-level.
-- ---------------------------------------------------------------------------
create table public.organization_job_title_hierarchy (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null
    references public.tenants(id)
    on update cascade
    on delete restrict,

  job_title_id uuid not null
    references public.organization_job_titles(id)
    on update cascade
    on delete restrict,

  reports_to_job_title_id uuid null
    references public.organization_job_titles(id)
    on update cascade
    on delete restrict,

  created_by uuid null,
  updated_by uuid null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_job_title_hierarchy_no_self_parent
    check (
      reports_to_job_title_id is null
      or reports_to_job_title_id <> job_title_id
    ),

  constraint organization_job_title_hierarchy_tenant_job_unique
    unique (tenant_id, job_title_id)
);

comment on table public.organization_job_title_hierarchy is
'Tenant-specific reporting order between active whole-organization job titles. A NULL parent means explicitly top-level; absence of a row means not configured.';

comment on column public.organization_job_title_hierarchy.job_title_id is
'Whole-organization job title being configured for this tenant.';

comment on column public.organization_job_title_hierarchy.reports_to_job_title_id is
'Direct parent whole-organization position. NULL means this position is explicitly top-level.';

-- A configured child may only point at another position that has itself been
-- configured for the same tenant. This keeps the hierarchy complete rather
-- than allowing dangling parent positions.
alter table public.organization_job_title_hierarchy
  add constraint organization_job_title_hierarchy_parent_configured_fkey
  foreign key (
    tenant_id,
    reports_to_job_title_id
  )
  references public.organization_job_title_hierarchy (
    tenant_id,
    job_title_id
  )
  on update cascade
  on delete restrict
  deferrable initially deferred;

create index organization_job_title_hierarchy_parent_idx
on public.organization_job_title_hierarchy (
  tenant_id,
  reports_to_job_title_id
)
where reports_to_job_title_id is not null;

-- ---------------------------------------------------------------------------
-- DATA API / RLS
--
-- Browser users may read their tenant hierarchy.
-- Browser users may not INSERT / UPDATE / DELETE directly.
-- Company Administration writes go through the protected RPCs below.
-- ---------------------------------------------------------------------------
alter table public.organization_job_title_hierarchy
  enable row level security;

revoke all
on table public.organization_job_title_hierarchy
from public, anon, authenticated;

grant select
on table public.organization_job_title_hierarchy
to authenticated;

grant select, insert, update, delete
on table public.organization_job_title_hierarchy
to service_role;

create policy "Tenant users read organization position hierarchy"
on public.organization_job_title_hierarchy
for select
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
);

-- ---------------------------------------------------------------------------
-- STRUCTURAL INTEGRITY
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_organization_job_title_hierarchy_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cycle_found boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.job_title_id is distinct from old.job_title_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_HIERARCHY_IDENTITY_LOCK: Hierarchy identity, tenant and position cannot be changed.';
    end if;

    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;

  -- The configured child must be an active whole-organization position
  -- available to the hierarchy tenant. It may be tenant-owned or global.
  if not exists (
    select 1
    from public.organization_job_titles position
    where position.id = new.job_title_id
      and position.department_id is null
      and lower(trim(coalesce(position.status, ''))) = 'active'
      and (
        position.tenant_id = new.tenant_id
        or position.tenant_id is null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_POSITION_HIERARCHY_CHILD_INVALID: The position must be an active whole-organization job title available to this tenant.';
  end if;

  if new.reports_to_job_title_id is not null then
    if new.reports_to_job_title_id = new.job_title_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_HIERARCHY_SELF_REFERENCE: A position cannot report to itself.';
    end if;

    -- The direct parent must also be an active whole-organization position
    -- available to this tenant.
    if not exists (
      select 1
      from public.organization_job_titles parent_position
      where parent_position.id = new.reports_to_job_title_id
        and parent_position.department_id is null
        and lower(trim(coalesce(parent_position.status, ''))) = 'active'
        and (
          parent_position.tenant_id = new.tenant_id
          or parent_position.tenant_id is null
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_HIERARCHY_PARENT_INVALID: The parent must be an active whole-organization job title available to this tenant.';
    end if;

    -- Configure the parent first. A hierarchy may therefore be built safely
    -- from the top downward.
    if not exists (
      select 1
      from public.organization_job_title_hierarchy configured_parent
      where configured_parent.tenant_id = new.tenant_id
        and configured_parent.job_title_id = new.reports_to_job_title_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_HIERARCHY_PARENT_NOT_CONFIGURED: Configure the parent position in the hierarchy before assigning a child to it.';
    end if;

    -- Walk upward from the proposed parent. Reaching the child means the
    -- proposed edge would create a direct or indirect cycle.
    select exists (
      with recursive parent_chain(job_title_id) as (
        select new.reports_to_job_title_id

        union

        select hierarchy.reports_to_job_title_id
        from public.organization_job_title_hierarchy hierarchy
        join parent_chain chain
          on hierarchy.job_title_id = chain.job_title_id
        where hierarchy.tenant_id = new.tenant_id
          and hierarchy.reports_to_job_title_id is not null
      )
      select 1
      from parent_chain
      where job_title_id = new.job_title_id
    )
    into v_cycle_found;

    if v_cycle_found then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_HIERARCHY_CYCLE: This reporting relationship would create a circular position hierarchy.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_organization_job_title_hierarchy_integrity()
from public, anon, authenticated;

create trigger bexhr_enforce_organization_job_title_hierarchy_integrity
before insert or update
on public.organization_job_title_hierarchy
for each row
execute function bexhr_private.enforce_organization_job_title_hierarchy_integrity();

-- ---------------------------------------------------------------------------
-- PROTECT SOURCE JOB TITLES WHILE THEY PARTICIPATE IN THE HIERARCHY
--
-- Renaming is safe because hierarchy identity is UUID-based.
--
-- Moving an in-use title into a department, making it inactive, or changing
-- its tenant would invalidate an existing hierarchy, so those changes fail
-- until the hierarchy entry is removed/reassigned.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.guard_organization_job_title_hierarchy_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.organization_job_title_hierarchy hierarchy
      where hierarchy.job_title_id = old.id
         or hierarchy.reports_to_job_title_id = old.id
    ) then
      raise exception using
        errcode = '23503',
        message = 'BEXHR_POSITION_HIERARCHY_POSITION_IN_USE: Remove or reassign this position in the organization hierarchy before deleting it.';
    end if;

    return old;
  end if;

  if (
       new.department_id is not null
       or lower(trim(coalesce(new.status, ''))) <> 'active'
       or new.tenant_id is distinct from old.tenant_id
     )
     and exists (
       select 1
       from public.organization_job_title_hierarchy hierarchy
       where hierarchy.job_title_id = old.id
          or hierarchy.reports_to_job_title_id = old.id
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_POSITION_HIERARCHY_POSITION_IN_USE: An in-use hierarchy position must remain active, whole-organization scoped and available to the same tenant.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.guard_organization_job_title_hierarchy_source()
from public, anon, authenticated;

create trigger bexhr_guard_organization_job_title_hierarchy_source
before update of department_id, status, tenant_id or delete
on public.organization_job_titles
for each row
execute function bexhr_private.guard_organization_job_title_hierarchy_source();

-- ---------------------------------------------------------------------------
-- TENANT ADMIN SAVE RPC
--
-- p_reports_to_job_title_id = NULL explicitly marks the position as top-level.
-- ---------------------------------------------------------------------------
create or replace function public.hr_tenant_admin_save_organization_job_title_hierarchy(
  p_job_title_id uuid,
  p_reports_to_job_title_id uuid default null
)
returns public.organization_job_title_hierarchy
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_result public.organization_job_title_hierarchy%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  if p_job_title_id is null then
    raise exception 'A position is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_job_titles position
    where position.id = p_job_title_id
      and position.department_id is null
      and lower(trim(coalesce(position.status, ''))) = 'active'
      and (
        position.tenant_id = v_tenant_id
        or position.tenant_id is null
      )
  ) then
    raise exception
      'The selected position is not an active whole-organization job title available to your company workspace.'
      using errcode = '23514';
  end if;

  if p_reports_to_job_title_id is not null then
    if p_reports_to_job_title_id = p_job_title_id then
      raise exception
        'A position cannot report to itself.'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.organization_job_title_hierarchy parent_hierarchy
      where parent_hierarchy.tenant_id = v_tenant_id
        and parent_hierarchy.job_title_id = p_reports_to_job_title_id
    ) then
      raise exception
        'Configure the selected parent position in the hierarchy first.'
        using errcode = '23514';
    end if;
  end if;

  insert into public.organization_job_title_hierarchy (
    tenant_id,
    job_title_id,
    reports_to_job_title_id,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    p_job_title_id,
    p_reports_to_job_title_id,
    auth.uid(),
    auth.uid()
  )
  on conflict on constraint organization_job_title_hierarchy_tenant_job_unique
  do update
  set
    reports_to_job_title_id = excluded.reports_to_job_title_id,
    updated_by = auth.uid(),
    updated_at = now()
  returning *
  into v_result;

  return v_result;
end;
$function$;

comment on function public.hr_tenant_admin_save_organization_job_title_hierarchy(
  uuid,
  uuid
) is
'Creates or updates one tenant-scoped whole-organization position hierarchy entry. A NULL parent explicitly marks the position as top-level.';

revoke all
on function public.hr_tenant_admin_save_organization_job_title_hierarchy(
  uuid,
  uuid
)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_organization_job_title_hierarchy(
  uuid,
  uuid
)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- TENANT ADMIN DELETE / UNCONFIGURE RPC
--
-- Deleting the hierarchy row means the position is no longer configured.
-- A configured position with children cannot be removed until those children
-- are reassigned or removed.
-- ---------------------------------------------------------------------------
create or replace function public.hr_tenant_admin_delete_organization_job_title_hierarchy(
  p_job_title_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  if p_job_title_id is null then
    raise exception 'A position is required.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.organization_job_title_hierarchy child_hierarchy
    where child_hierarchy.tenant_id = v_tenant_id
      and child_hierarchy.reports_to_job_title_id = p_job_title_id
  ) then
    raise exception
      'Reassign or remove the child positions before removing this hierarchy position.'
      using errcode = '23503';
  end if;

  delete from public.organization_job_title_hierarchy hierarchy
  where hierarchy.tenant_id = v_tenant_id
    and hierarchy.job_title_id = p_job_title_id;

  if not found then
    raise exception
      'The selected hierarchy position was not found in your company workspace.'
      using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

comment on function public.hr_tenant_admin_delete_organization_job_title_hierarchy(
  uuid
) is
'Removes one tenant-scoped position hierarchy entry. Child positions must be reassigned or removed first.';

revoke all
on function public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)
from public, anon;

grant execute
on function public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ADMINISTRATIVE AUDIT
--
-- Keep this separate from the older generic audit trigger because that function
-- intentionally rejects source tables it does not explicitly understand.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.capture_organization_job_title_hierarchy_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
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
  v_tenant_id uuid;
  v_entity_id text;
  v_event_type text;
  v_previous_values jsonb;
  v_new_values jsonb;
  v_changed_fields text[] := array[]::text[];
begin
  select profile.*
  into v_actor
  from public.profiles profile
  where profile.id = v_actor_user_id
     or profile.user_id = v_actor_user_id
  order by
    case when profile.id = v_actor_user_id then 0 else 1 end
  limit 1;

  v_tenant_id := nullif(
    coalesce(
      v_new ->> 'tenant_id',
      v_old ->> 'tenant_id'
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

  v_event_type := case tg_op
    when 'INSERT' then 'organization_job_title_hierarchy_created'
    when 'UPDATE' then 'organization_job_title_hierarchy_updated'
    else 'organization_job_title_hierarchy_deleted'
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

  insert into public.administrative_audit_events (
    event_scope,
    tenant_id,

    actor_user_id,
    actor_profile_id,
    actor_email,
    actor_name,
    actor_role,
    actor_hr_access_level,

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
    'tenant',
    v_tenant_id,

    v_actor_user_id,
    v_actor.id,
    nullif(trim(coalesce(v_actor.email, '')), ''),
    nullif(trim(coalesce(v_actor.full_name, '')), ''),
    nullif(trim(coalesce(v_actor.role, '')), ''),
    nullif(trim(coalesce(v_actor.hr_access_level, '')), ''),

    v_event_type,
    'organization_job_title_hierarchy',
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

revoke all
on function bexhr_private.capture_organization_job_title_hierarchy_audit()
from public, anon, authenticated;

create trigger audit_organization_job_title_hierarchy_changes
after insert or update or delete
on public.organization_job_title_hierarchy
for each row
execute function bexhr_private.capture_organization_job_title_hierarchy_audit();

-- ---------------------------------------------------------------------------
-- INSTALL-TIME VERIFICATION
-- ---------------------------------------------------------------------------
do $phase4a_verify$
declare
  v_save_function_oid oid;
  v_delete_function_oid oid;
  v_rls_enabled boolean;
begin
  if to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'Phase 4A verification failed: hierarchy table is missing.';
  end if;

  select relation.relrowsecurity
  into v_rls_enabled
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = relation.relnamespace
  where namespace_record.nspname = 'public'
    and relation.relname = 'organization_job_title_hierarchy';

  if v_rls_enabled is not true then
    raise exception 'Phase 4A verification failed: hierarchy table RLS is not enabled.';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.organization_job_title_hierarchy',
    'SELECT'
  ) then
    raise exception 'Phase 4A verification failed: authenticated users cannot read the hierarchy table.';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.organization_job_title_hierarchy',
    'INSERT'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_job_title_hierarchy',
    'UPDATE'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_job_title_hierarchy',
    'DELETE'
  ) then
    raise exception 'Phase 4A verification failed: authenticated users have direct hierarchy write access.';
  end if;

  if has_table_privilege(
    'anon',
    'public.organization_job_title_hierarchy',
    'SELECT'
  )
  or has_table_privilege(
    'anon',
    'public.organization_job_title_hierarchy',
    'INSERT'
  )
  or has_table_privilege(
    'anon',
    'public.organization_job_title_hierarchy',
    'UPDATE'
  )
  or has_table_privilege(
    'anon',
    'public.organization_job_title_hierarchy',
    'DELETE'
  ) then
    raise exception 'Phase 4A verification failed: anon has hierarchy table access.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
      'public.organization_job_title_hierarchy'::regclass
      and constraint_record.conname =
        'organization_job_title_hierarchy_tenant_job_unique'
      and constraint_record.contype = 'u'
  ) then
    raise exception 'Phase 4A verification failed: tenant-position uniqueness is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
      'public.organization_job_title_hierarchy'::regclass
      and constraint_record.conname =
        'organization_job_title_hierarchy_parent_configured_fkey'
      and constraint_record.contype = 'f'
  ) then
    raise exception 'Phase 4A verification failed: configured-parent foreign key is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_title_hierarchy'::regclass
      and trigger_record.tgname =
        'bexhr_enforce_organization_job_title_hierarchy_integrity'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Phase 4A verification failed: hierarchy integrity trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_title_hierarchy'::regclass
      and trigger_record.tgname =
        'audit_organization_job_title_hierarchy_changes'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Phase 4A verification failed: hierarchy audit trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_titles'::regclass
      and trigger_record.tgname =
        'bexhr_guard_organization_job_title_hierarchy_source'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Phase 4A verification failed: source job-title guard is missing.';
  end if;

  v_save_function_oid := to_regprocedure(
    'public.hr_tenant_admin_save_organization_job_title_hierarchy(uuid,uuid)'
  );

  if v_save_function_oid is null then
    raise exception 'Phase 4A verification failed: hierarchy save RPC is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid = v_save_function_oid
      and procedure_record.prosecdef is true
  ) then
    raise exception 'Phase 4A verification failed: hierarchy save RPC is not SECURITY DEFINER.';
  end if;

  if has_function_privilege(
    'anon',
    v_save_function_oid,
    'EXECUTE'
  ) then
    raise exception 'Phase 4A verification failed: anon can execute the hierarchy save RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_save_function_oid,
    'EXECUTE'
  ) then
    raise exception 'Phase 4A verification failed: authenticated cannot execute the protected hierarchy save RPC.';
  end if;

  v_delete_function_oid := to_regprocedure(
    'public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)'
  );

  if v_delete_function_oid is null then
    raise exception 'Phase 4A verification failed: hierarchy delete RPC is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid = v_delete_function_oid
      and procedure_record.prosecdef is true
  ) then
    raise exception 'Phase 4A verification failed: hierarchy delete RPC is not SECURITY DEFINER.';
  end if;

  if has_function_privilege(
    'anon',
    v_delete_function_oid,
    'EXECUTE'
  ) then
    raise exception 'Phase 4A verification failed: anon can execute the hierarchy delete RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_delete_function_oid,
    'EXECUTE'
  ) then
    raise exception 'Phase 4A verification failed: authenticated cannot execute the protected hierarchy delete RPC.';
  end if;
end;
$phase4a_verify$;

commit;