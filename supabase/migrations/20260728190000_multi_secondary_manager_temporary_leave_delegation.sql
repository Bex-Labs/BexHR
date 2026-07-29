-- BexHR Multi-Secondary-Manager Temporary Leave Delegation - v1.0.0
--
-- Scope:
--   * A Primary Manager may create independent temporary delegations for one or
--     more existing Secondary Managers.
--   * Delegation may cover the shared reporting-line intersection or one employee.
--   * Every delegation is tenant-scoped, time-bound, revocable, and audited.
--   * The existing transactional leave decision RPC remains the single save path.
--   * Existing tenant entitlement calculations, including Alpatech rules, are not changed.

begin;

create table if not exists public.manager_leave_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  primary_manager_employee_id uuid not null references public.employees(id) on delete restrict,
  delegated_manager_employee_id uuid not null references public.employees(id) on delete restrict,
  scope_type text not null check (scope_type in ('team', 'employee')),
  covered_employee_id uuid null references public.employees(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  revoked_by_profile_id uuid null,
  revoked_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint manager_leave_delegations_distinct_managers
    check (primary_manager_employee_id <> delegated_manager_employee_id),
  constraint manager_leave_delegations_valid_period
    check (ends_at > starts_at),
  constraint manager_leave_delegations_scope_employee
    check (
      (scope_type = 'team' and covered_employee_id is null)
      or
      (scope_type = 'employee' and covered_employee_id is not null)
    )
);

create index if not exists manager_leave_delegations_delegate_active_idx
  on public.manager_leave_delegations (
    tenant_id,
    delegated_manager_employee_id,
    starts_at,
    ends_at
  )
  where status = 'active';

create index if not exists manager_leave_delegations_primary_active_idx
  on public.manager_leave_delegations (
    tenant_id,
    primary_manager_employee_id,
    starts_at,
    ends_at
  )
  where status = 'active';

alter table public.manager_leave_delegations enable row level security;
revoke all on table public.manager_leave_delegations from public, anon, authenticated;

create table if not exists public.manager_leave_decision_authority_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  leave_request_id uuid not null references public.leave_requests(id) on delete restrict,
  target_employee_id uuid not null references public.employees(id) on delete restrict,
  actor_manager_employee_id uuid not null references public.employees(id) on delete restrict,
  primary_manager_employee_id uuid not null references public.employees(id) on delete restrict,
  authority_type text not null check (authority_type in ('primary', 'delegated')),
  delegation_id uuid null references public.manager_leave_delegations(id) on delete restrict,
  decision_status text not null,
  decision_at timestamptz not null default now(),
  actor_profile_id uuid not null
);

create unique index if not exists manager_leave_decision_authority_audit_request_idx
  on public.manager_leave_decision_authority_audit (leave_request_id);

alter table public.manager_leave_decision_authority_audit enable row level security;
revoke all on table public.manager_leave_decision_authority_audit from public, anon, authenticated;

create or replace function public.hrp_current_manager_employee()
returns table (manager_employee_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with signed_in_profile as (
    select p.id, p.email, p.tenant_id
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, false) is true
      and p.tenant_id is not null
    limit 1
  )
  select e.id, e.tenant_id
  from public.employees e
  join signed_in_profile p
    on e.tenant_id = p.tenant_id
   and (
     e.user_id = p.id
     or (
       p.email is not null
       and lower(coalesce(e.work_email, '')) = lower(p.email)
     )
   )
  where lower(trim(coalesce(e.status, 'active'))) = 'active'
  order by case when e.user_id = p.id then 0 else 1 end,
           e.created_at desc nulls last
  limit 1;
$function$;

revoke all on function public.hrp_current_manager_employee() from public, anon;
grant execute on function public.hrp_current_manager_employee() to authenticated;

create or replace function public.hrp_resolve_leave_employee(p_leave_employee_id uuid)
returns table (employee_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select e.id, e.tenant_id
  from public.employees e
  left join public.profiles leave_profile
    on leave_profile.id = p_leave_employee_id
  where e.id = p_leave_employee_id
     or e.user_id = p_leave_employee_id
     or (
       leave_profile.email is not null
       and lower(coalesce(e.work_email, '')) = lower(leave_profile.email)
     )
  order by case
             when e.id = p_leave_employee_id then 0
             when e.user_id = p_leave_employee_id then 1
             else 2
           end,
           e.created_at desc nulls last
  limit 1;
$function$;

revoke all on function public.hrp_resolve_leave_employee(uuid) from public, anon;
grant execute on function public.hrp_resolve_leave_employee(uuid) to authenticated;

create or replace function public.hrp_find_active_leave_delegation(
  p_leave_employee_id uuid
)
returns table (
  delegation_id uuid,
  primary_manager_employee_id uuid,
  delegated_manager_employee_id uuid,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with actor as (
    select * from public.hrp_current_manager_employee()
  ),
  target as (
    select * from public.hrp_resolve_leave_employee(p_leave_employee_id)
  )
  select
    d.id,
    d.primary_manager_employee_id,
    d.delegated_manager_employee_id,
    d.ends_at
  from actor a
  join target t on t.tenant_id = a.tenant_id
  join public.manager_leave_delegations d
    on d.tenant_id = a.tenant_id
   and d.delegated_manager_employee_id = a.manager_employee_id
   and d.status = 'active'
   and now() >= d.starts_at
   and now() < d.ends_at
   and (
     d.scope_type = 'team'
     or d.covered_employee_id = t.employee_id
   )
  join public.employee_reporting_lines primary_line
    on primary_line.employee_id = t.employee_id
   and primary_line.manager_employee_id = d.primary_manager_employee_id
   and lower(trim(coalesce(primary_line.status, 'active'))) = 'active'
   and lower(trim(coalesce(primary_line.manager_type::text, ''))) = 'primary'
   and (primary_line.tenant_id is null or primary_line.tenant_id = a.tenant_id)
  join public.employee_reporting_lines secondary_line
    on secondary_line.employee_id = t.employee_id
   and secondary_line.manager_employee_id = a.manager_employee_id
   and lower(trim(coalesce(secondary_line.status, 'active'))) = 'active'
   and lower(trim(coalesce(secondary_line.manager_type::text, ''))) = 'secondary'
   and (secondary_line.tenant_id is null or secondary_line.tenant_id = a.tenant_id)
  order by d.ends_at asc, d.created_at asc
  limit 1;
$function$;

revoke all on function public.hrp_find_active_leave_delegation(uuid) from public, anon;
grant execute on function public.hrp_find_active_leave_delegation(uuid) to authenticated;

create or replace function public.hrp_is_current_user_authorized_manager_for_leave_employee(
  p_leave_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    public.hrp_is_current_user_primary_manager_for_leave_employee(p_leave_employee_id)
    or exists (
      select 1
      from public.hrp_find_active_leave_delegation(p_leave_employee_id)
    );
$function$;

revoke all on function public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid) from public, anon;
grant execute on function public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid) to authenticated;

-- Preserve the existing transactional implementation and replace only its
-- authority predicate. This avoids duplicating or weakening balance, overlap,
-- idempotency, and audit protections already present in the deployed function.
do $replace_leave_decision_authority$
declare
  v_definition text;
  v_replaced text;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'hrp_apply_leave_decision_once'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_leave_request_id uuid, p_decision_status text, p_decision_comment text';

  if v_definition is null then
    raise exception 'Temporary delegation stopped: protected leave decision RPC was not found.';
  end if;

  if position(
    'public.hrp_is_current_user_primary_manager_for_leave_employee(v_request.employee_id)'
    in v_definition
  ) = 0 then
    raise exception 'Temporary delegation stopped: expected Primary Manager authority predicate was not found exactly as protected.';
  end if;

  v_replaced := replace(
    v_definition,
    'public.hrp_is_current_user_primary_manager_for_leave_employee(v_request.employee_id)',
    'public.hrp_is_current_user_authorized_manager_for_leave_employee(v_request.employee_id)'
  );

  execute v_replaced;
end;
$replace_leave_decision_authority$;

create or replace function public.create_manager_leave_delegation(
  p_delegate_employee_id uuid,
  p_scope_type text,
  p_covered_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
returns public.manager_leave_delegations
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_scope text := lower(trim(coalesce(p_scope_type, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_row public.manager_leave_delegations%rowtype;
begin
  select * into v_actor from public.hrp_current_manager_employee();
  if v_actor.manager_employee_id is null then
    raise exception 'Your login could not be resolved to an active manager employee record.';
  end if;

  if v_scope not in ('team', 'employee') then
    raise exception 'Delegation scope must be team or employee.';
  end if;
  if v_scope = 'employee' and p_covered_employee_id is null then
    raise exception 'An employee is required for employee-specific delegation.';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'Delegation end must be after its start.';
  end if;
  if p_ends_at <= now() then
    raise exception 'Delegation end must be in the future.';
  end if;
  if p_ends_at > now() + interval '90 days' then
    raise exception 'A temporary delegation cannot exceed 90 days from today.';
  end if;
  if v_reason is null then
    raise exception 'A delegation reason is required.';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.id = p_delegate_employee_id
      and e.tenant_id = v_actor.tenant_id
      and lower(trim(coalesce(e.status, 'active'))) = 'active'
  ) then
    raise exception 'The delegated manager is not an active employee in your tenant.';
  end if;

  if v_scope = 'employee' then
    if not exists (
      select 1
      from public.employee_reporting_lines primary_line
      join public.employee_reporting_lines secondary_line
        on secondary_line.employee_id = primary_line.employee_id
       and secondary_line.manager_employee_id = p_delegate_employee_id
       and lower(trim(coalesce(secondary_line.status, 'active'))) = 'active'
       and lower(trim(coalesce(secondary_line.manager_type::text, ''))) = 'secondary'
      where primary_line.employee_id = p_covered_employee_id
        and primary_line.manager_employee_id = v_actor.manager_employee_id
        and lower(trim(coalesce(primary_line.status, 'active'))) = 'active'
        and lower(trim(coalesce(primary_line.manager_type::text, ''))) = 'primary'
        and (primary_line.tenant_id is null or primary_line.tenant_id = v_actor.tenant_id)
        and (secondary_line.tenant_id is null or secondary_line.tenant_id = v_actor.tenant_id)
    ) then
      raise exception 'The selected Secondary Manager is not assigned to that employee under your Primary Manager coverage.';
    end if;
  else
    if not exists (
      select 1
      from public.employee_reporting_lines primary_line
      join public.employee_reporting_lines secondary_line
        on secondary_line.employee_id = primary_line.employee_id
       and secondary_line.manager_employee_id = p_delegate_employee_id
       and lower(trim(coalesce(secondary_line.status, 'active'))) = 'active'
       and lower(trim(coalesce(secondary_line.manager_type::text, ''))) = 'secondary'
      where primary_line.manager_employee_id = v_actor.manager_employee_id
        and lower(trim(coalesce(primary_line.status, 'active'))) = 'active'
        and lower(trim(coalesce(primary_line.manager_type::text, ''))) = 'primary'
        and (primary_line.tenant_id is null or primary_line.tenant_id = v_actor.tenant_id)
        and (secondary_line.tenant_id is null or secondary_line.tenant_id = v_actor.tenant_id)
    ) then
      raise exception 'The selected manager does not share any active Primary/Secondary employee coverage with you.';
    end if;
  end if;

  if exists (
    select 1
    from public.manager_leave_delegations d
    where d.tenant_id = v_actor.tenant_id
      and d.primary_manager_employee_id = v_actor.manager_employee_id
      and d.delegated_manager_employee_id = p_delegate_employee_id
      and d.status = 'active'
      and d.scope_type = v_scope
      and d.covered_employee_id is not distinct from p_covered_employee_id
      and tstzrange(d.starts_at, d.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'An overlapping active delegation already exists for this manager and scope.';
  end if;

  insert into public.manager_leave_delegations (
    tenant_id,
    primary_manager_employee_id,
    delegated_manager_employee_id,
    scope_type,
    covered_employee_id,
    starts_at,
    ends_at,
    reason,
    created_by_profile_id
  ) values (
    v_actor.tenant_id,
    v_actor.manager_employee_id,
    p_delegate_employee_id,
    v_scope,
    case when v_scope = 'employee' then p_covered_employee_id else null end,
    p_starts_at,
    p_ends_at,
    v_reason,
    auth.uid()
  ) returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_manager_leave_delegation(uuid,text,uuid,timestamptz,timestamptz,text) from public, anon;
grant execute on function public.create_manager_leave_delegation(uuid,text,uuid,timestamptz,timestamptz,text) to authenticated;

create or replace function public.revoke_manager_leave_delegation(p_delegation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.hrp_current_manager_employee();

  update public.manager_leave_delegations d
  set status = 'revoked',
      revoked_by_profile_id = auth.uid(),
      revoked_at = now(),
      updated_at = now()
  where d.id = p_delegation_id
    and d.tenant_id = v_actor.tenant_id
    and d.primary_manager_employee_id = v_actor.manager_employee_id
    and d.status = 'active';

  if not found then
    raise exception 'Active delegation was not found or you are not its Primary Manager owner.';
  end if;

  return true;
end;
$function$;

revoke all on function public.revoke_manager_leave_delegation(uuid) from public, anon;
grant execute on function public.revoke_manager_leave_delegation(uuid) to authenticated;

create or replace function public.get_manager_leave_delegation_context()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with actor as (
    select * from public.hrp_current_manager_employee()
  ),
  eligible as (
    select distinct
      secondary_line.manager_employee_id as delegate_employee_id,
      coalesce(nullif(trim(profile.full_name), ''), employee.work_email, 'Secondary Manager') as delegate_name,
      employee.work_email as delegate_email
    from actor a
    join public.employee_reporting_lines primary_line
      on primary_line.manager_employee_id = a.manager_employee_id
     and lower(trim(coalesce(primary_line.status, 'active'))) = 'active'
     and lower(trim(coalesce(primary_line.manager_type::text, ''))) = 'primary'
     and (primary_line.tenant_id is null or primary_line.tenant_id = a.tenant_id)
    join public.employee_reporting_lines secondary_line
      on secondary_line.employee_id = primary_line.employee_id
     and lower(trim(coalesce(secondary_line.status, 'active'))) = 'active'
     and lower(trim(coalesce(secondary_line.manager_type::text, ''))) = 'secondary'
     and (secondary_line.tenant_id is null or secondary_line.tenant_id = a.tenant_id)
    join public.employees employee
      on employee.id = secondary_line.manager_employee_id
     and employee.tenant_id = a.tenant_id
    left join public.profiles profile
      on profile.id = employee.user_id
      or lower(coalesce(profile.email, '')) = lower(coalesce(employee.work_email, ''))
    where secondary_line.manager_employee_id <> a.manager_employee_id
  ),
  granted as (
    select
      d.*,
      coalesce(nullif(trim(profile.full_name), ''), delegate.work_email, 'Secondary Manager') as delegate_name,
      case when d.scope_type = 'team' then 'Shared team coverage'
           else coalesce(
  nullif(
    trim(concat_ws(' ', target.first_name, target.middle_name, target.last_name)),
    ''
  ),
  target.work_email,
  'Employee-specific coverage'
) end as scope_label
    from actor a
    join public.manager_leave_delegations d
      on d.tenant_id = a.tenant_id
     and d.primary_manager_employee_id = a.manager_employee_id
     and d.status = 'active'
     and now() < d.ends_at
    join public.employees delegate on delegate.id = d.delegated_manager_employee_id
    left join public.profiles profile
      on profile.id = delegate.user_id
      or lower(coalesce(profile.email, '')) = lower(coalesce(delegate.work_email, ''))
    left join public.employees target on target.id = d.covered_employee_id
  ),
  received as (
    select
      d.*,
      coalesce(nullif(trim(profile.full_name), ''), primary_employee.work_email, 'Primary Manager') as primary_manager_name,
      case when d.scope_type = 'team' then 'Shared team coverage'
           else coalesce(
  nullif(
    trim(concat_ws(' ', target.first_name, target.middle_name, target.last_name)),
    ''
  ),
  target.work_email,
  'Employee-specific coverage'
) end as scope_label
    from actor a
    join public.manager_leave_delegations d
      on d.tenant_id = a.tenant_id
     and d.delegated_manager_employee_id = a.manager_employee_id
     and d.status = 'active'
     and now() >= d.starts_at
     and now() < d.ends_at
    join public.employees primary_employee on primary_employee.id = d.primary_manager_employee_id
    left join public.profiles profile
      on profile.id = primary_employee.user_id
      or lower(coalesce(profile.email, '')) = lower(coalesce(primary_employee.work_email, ''))
    left join public.employees target on target.id = d.covered_employee_id
  )
  select jsonb_build_object(
    'eligible_delegates', coalesce((select jsonb_agg(to_jsonb(eligible) order by delegate_name) from eligible), '[]'::jsonb),
    'active_granted', coalesce((select jsonb_agg(to_jsonb(granted) order by ends_at) from granted), '[]'::jsonb),
    'active_received', coalesce((select jsonb_agg(to_jsonb(received) order by ends_at) from received), '[]'::jsonb)
  );
$function$;

revoke all on function public.get_manager_leave_delegation_context() from public, anon;
grant execute on function public.get_manager_leave_delegation_context() to authenticated;

-- Replace readiness result with delegation-aware fields while retaining the
-- same canonical identity, balance, eligibility, tenant, and reporting-line rules.
drop function if exists public.get_manager_leave_readiness();

create function public.get_manager_leave_readiness()
returns table (
  request_id uuid,
  canonical_employee_id uuid,
  manager_type text,
  employee_gender text,
  leave_type_id uuid,
  eligibility_rule text,
  has_balance boolean,
  entitled_days numeric,
  used_days numeric,
  remaining_days numeric,
  can_decide boolean,
  decision_authority text,
  delegation_id uuid,
  delegation_ends_at timestamptz,
  delegated_by_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with actor as (
    select * from public.hrp_current_manager_employee()
  ),
  visible as (
    select
      lr.id as request_id,
      target.employee_id as canonical_employee_id,
      line.manager_type::text as manager_type,
      employee.gender::text as employee_gender,
      lr.leave_type_id,
      coalesce(lt.eligibility_rule::text, 'all_employees') as eligibility_rule,
      (balance.id is not null) as has_balance,
      balance.entitled_days::numeric,
      balance.used_days::numeric,
      balance.remaining_days::numeric,
      case when lower(trim(coalesce(line.manager_type::text, ''))) = 'primary' then 0 else 1 end as relationship_rank,
      line.effective_date
    from actor a
    join public.leave_requests lr on true
    join lateral public.hrp_resolve_leave_employee(lr.employee_id) target on target.tenant_id = a.tenant_id
    join public.employees employee on employee.id = target.employee_id
    join public.employee_reporting_lines line
      on line.employee_id = target.employee_id
     and line.manager_employee_id = a.manager_employee_id
     and lower(trim(coalesce(line.status, 'active'))) = 'active'
     and lower(trim(coalesce(line.manager_type::text, ''))) in ('primary', 'secondary')
     and (line.tenant_id is null or line.tenant_id = a.tenant_id)
    join public.leave_types lt on lt.id = lr.leave_type_id
    left join public.employee_leave_balances balance
      on balance.employee_id = target.employee_id
     and balance.leave_type_id = lr.leave_type_id
  ),
  chosen as (
    select distinct on (v.request_id) v.*
    from visible v
    order by v.request_id, v.relationship_rank, v.effective_date desc nulls last
  )
  select
    c.request_id,
    c.canonical_employee_id,
    c.manager_type,
    c.employee_gender,
    c.leave_type_id,
    c.eligibility_rule,
    c.has_balance,
    c.entitled_days,
    c.used_days,
    c.remaining_days,
    (
      lower(trim(coalesce(c.manager_type, ''))) = 'primary'
      or delegated.delegation_id is not null
    ) as can_decide,
    case
      when lower(trim(coalesce(c.manager_type, ''))) = 'primary' then 'primary'
      when delegated.delegation_id is not null then 'delegated'
      else 'view_only'
    end as decision_authority,
    delegated.delegation_id,
    delegated.ends_at,
    coalesce(nullif(trim(primary_profile.full_name), ''), primary_employee.work_email, '') as delegated_by_name
  from chosen c
  left join lateral public.hrp_find_active_leave_delegation(c.canonical_employee_id) delegated on true
  left join public.employees primary_employee on primary_employee.id = delegated.primary_manager_employee_id
  left join public.profiles primary_profile
    on primary_profile.id = primary_employee.user_id
    or lower(coalesce(primary_profile.email, '')) = lower(coalesce(primary_employee.work_email, ''));
$function$;

revoke all on function public.get_manager_leave_readiness() from public, anon;
grant execute on function public.get_manager_leave_readiness() to authenticated;

create or replace function public.hrp_capture_leave_decision_authority_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_target record;
  v_delegation record;
  v_primary_manager_id uuid;
begin
  if lower(trim(coalesce(old.status, ''))) <> 'pending approval'
     or lower(trim(coalesce(new.status, ''))) = 'pending approval' then
    return new;
  end if;

  select * into v_actor from public.hrp_current_manager_employee();
  select * into v_target from public.hrp_resolve_leave_employee(new.employee_id);
  if v_actor.manager_employee_id is null or v_target.employee_id is null then
    return new;
  end if;

  select * into v_delegation
  from public.hrp_find_active_leave_delegation(new.employee_id);

  if v_delegation.delegation_id is not null then
    v_primary_manager_id := v_delegation.primary_manager_employee_id;
  else
    select line.manager_employee_id into v_primary_manager_id
    from public.employee_reporting_lines line
    where line.employee_id = v_target.employee_id
      and line.manager_employee_id = v_actor.manager_employee_id
      and lower(trim(coalesce(line.status, 'active'))) = 'active'
      and lower(trim(coalesce(line.manager_type::text, ''))) = 'primary'
      and (line.tenant_id is null or line.tenant_id = v_actor.tenant_id)
    limit 1;
  end if;

  if v_primary_manager_id is not null then
    insert into public.manager_leave_decision_authority_audit (
      tenant_id,
      leave_request_id,
      target_employee_id,
      actor_manager_employee_id,
      primary_manager_employee_id,
      authority_type,
      delegation_id,
      decision_status,
      decision_at,
      actor_profile_id
    ) values (
      v_actor.tenant_id,
      new.id,
      v_target.employee_id,
      v_actor.manager_employee_id,
      v_primary_manager_id,
      case when v_delegation.delegation_id is null then 'primary' else 'delegated' end,
      v_delegation.delegation_id,
      new.status,
      coalesce(new.decision_at, now()),
      auth.uid()
    ) on conflict (leave_request_id) do nothing;
  end if;

  return new;
end;
$function$;

drop trigger if exists hrp_capture_leave_decision_authority_audit on public.leave_requests;
create trigger hrp_capture_leave_decision_authority_audit
after update of status on public.leave_requests
for each row
execute function public.hrp_capture_leave_decision_authority_audit();

comment on table public.manager_leave_delegations is
'Tenant-scoped, time-bound, independently revocable temporary leave decision authority granted by a Primary Manager to one or more existing Secondary Managers.';

comment on table public.manager_leave_decision_authority_audit is
'Immutable authority audit identifying whether a leave decision was made directly by the Primary Manager or through a specific active delegation.';

commit;
