-- BEXHR PHASE 4.5A - EXECUTIVE GOVERNANCE FOUNDATION
--
-- Purpose:
--   Add tenant-configurable governance controls for sensitive executive
--   compensation without hardcoding CEO, COO, CFO, MD, or any title text.
--
-- Design:
--   1. Governance is attached to configured whole-organization positions.
--   2. STANDARD_HR means normal HR compensation maintenance applies.
--   3. GOVERNANCE_RESTRICTED means ordinary HR must not maintain compensation.
--      Every configured whole-organization position must be explicitly classified;
--      unconfigured governance fails closed instead of defaulting to STANDARD_HR.
--   4. Independent governance authorities are tenant profiles that are:
--        - active,
--        - same-tenant,
--        - not HR,
--        - not Platform Admin,
--        - not the Company Admin assigning the authority,
--        - not occupants of a governance-restricted position.
--   5. Company Admin configures position governance and authority membership.
--   6. This migration does NOT yet add payroll-table write guards. Those are
--      Phase 4.5B after the live payroll schema/policies are verified.
--
-- Deliberately out of scope:
--   - no salary, allowance, deduction, payroll, leave, PA, or employee writes;
--   - no title-name logic;
--   - no automatic hierarchy fallback;
--   - no Platform Admin compensation authority.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- PREFLIGHT
-- ---------------------------------------------------------------------------
do $phase45a_preflight$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'Phase 4.5A stopped: public.tenants is missing.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'Phase 4.5A stopped: public.profiles is missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'Phase 4.5A stopped: public.employees is missing.';
  end if;

  if to_regclass('public.organization_job_titles') is null then
    raise exception 'Phase 4.5A stopped: public.organization_job_titles is missing.';
  end if;

  if to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'Phase 4.5A stopped: Phase 4A position hierarchy is missing.';
  end if;

  if to_regclass('public.administrative_audit_events') is null then
    raise exception 'Phase 4.5A stopped: administrative audit store is missing.';
  end if;

  if to_regprocedure('public.require_current_tenant_administrator()') is null then
    raise exception 'Phase 4.5A stopped: Company Admin guard is missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'Phase 4.5A stopped: authenticated tenant resolver is missing.';
  end if;

  if to_regclass('public.organization_job_title_governance') is not null then
    raise exception 'Phase 4.5A stopped: public.organization_job_title_governance already exists.';
  end if;

  if to_regclass('public.organization_governance_authorities') is not null then
    raise exception 'Phase 4.5A stopped: public.organization_governance_authorities already exists.';
  end if;
end;
$phase45a_preflight$;

create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- POSITION GOVERNANCE
-- ---------------------------------------------------------------------------
create table public.organization_job_title_governance (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null
    references public.tenants(id)
    on update cascade
    on delete restrict,

  job_title_id uuid not null,

  compensation_control text not null default 'STANDARD_HR',

  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_job_title_governance_compensation_control_check
    check (
      compensation_control in (
        'STANDARD_HR',
        'GOVERNANCE_RESTRICTED'
      )
    ),

  constraint organization_job_title_governance_tenant_position_unique
    unique (tenant_id, job_title_id),

  constraint organization_job_title_governance_hierarchy_position_fkey
    foreign key (tenant_id, job_title_id)
    references public.organization_job_title_hierarchy (
      tenant_id,
      job_title_id
    )
    on update cascade
    on delete restrict
);

comment on table public.organization_job_title_governance is
'Tenant-specific governance classification for configured whole-organization positions. No title-name logic is used.';

comment on column public.organization_job_title_governance.compensation_control is
'STANDARD_HR = ordinary HR compensation maintenance. GOVERNANCE_RESTRICTED = compensation maintenance requires independent governance authority.';

create index organization_job_title_governance_compensation_idx
on public.organization_job_title_governance (
  tenant_id,
  compensation_control
);

alter table public.organization_job_title_governance enable row level security;

revoke all
on table public.organization_job_title_governance
from public, anon, authenticated;

grant select
on table public.organization_job_title_governance
to authenticated;

grant select, insert, update, delete
on table public.organization_job_title_governance
to service_role;

create policy "HR users read organization position governance"
on public.organization_job_title_governance
for select
to authenticated
using (
  public.organization_job_title_governance.tenant_id =
    public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.tenant_id =
        public.organization_job_title_governance.tenant_id
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) = 'hr'
  )
);

-- ---------------------------------------------------------------------------
-- INDEPENDENT GOVERNANCE AUTHORITIES
-- ---------------------------------------------------------------------------
create table public.organization_governance_authorities (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null
    references public.tenants(id)
    on update cascade
    on delete restrict,

  profile_id uuid not null
    references public.profiles(id)
    on update cascade
    on delete restrict,

  authority_scope text not null default 'EXECUTIVE_COMPENSATION',
  status text not null default 'ACTIVE',

  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_governance_authorities_scope_check
    check (
      authority_scope in (
        'EXECUTIVE_COMPENSATION'
      )
    ),

  constraint organization_governance_authorities_status_check
    check (
      status in (
        'ACTIVE',
        'INACTIVE'
      )
    ),

  constraint organization_governance_authorities_tenant_profile_scope_unique
    unique (tenant_id, profile_id, authority_scope)
);

comment on table public.organization_governance_authorities is
'Independent tenant governance authorities for restricted executive workflows. Direct browser table access is denied.';

create index organization_governance_authorities_active_idx
on public.organization_governance_authorities (
  tenant_id,
  authority_scope,
  profile_id
)
where status = 'ACTIVE';

alter table public.organization_governance_authorities enable row level security;

revoke all
on table public.organization_governance_authorities
from public, anon, authenticated;

grant select, insert, update, delete
on table public.organization_governance_authorities
to service_role;

-- ---------------------------------------------------------------------------
-- PRIVATE POSITION RESOLUTION
--
-- Resolve whether an employee occupies a configured whole-organization
-- position and whether that position has been explicitly classified for
-- compensation governance. Ordinary department employees remain STANDARD_HR.
-- Whole-organization positions fail closed unless BOTH hierarchy and governance
-- are explicitly configured. No title-name semantics are used.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.resolve_employee_compensation_governance(
  p_employee_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_position_match_count integer := 0;
  v_position_id uuid;
  v_governance_match_count integer := 0;
  v_control text;
begin
  if p_employee_id is null or p_tenant_id is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_INPUT_REQUIRED: Employee and tenant are required.';
  end if;

  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = p_employee_id
    and employee.tenant_id = p_tenant_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_EMPLOYEE_INVALID: Employee was not found in the tenant.';
  end if;

  -- Resolve the employee's title against configured whole-organization
  -- hierarchy positions before deciding that a populated department means
  -- ordinary HR control. This prevents a restricted executive from becoming
  -- STANDARD_HR merely because department data is populated incorrectly.
  select
    count(*)::integer,
    (array_agg(hierarchy.job_title_id))[1]
  into
    v_position_match_count,
    v_position_id
  from public.organization_job_title_hierarchy hierarchy
  join public.organization_job_titles position
    on position.id = hierarchy.job_title_id
  where hierarchy.tenant_id = v_employee.tenant_id
    and position.department_id is null
    and lower(trim(coalesce(position.status, ''))) = 'active'
    and (
      position.tenant_id = v_employee.tenant_id
      or position.tenant_id is null
    )
    and lower(trim(coalesce(position.job_title, ''))) =
        lower(trim(coalesce(v_employee.job_title, '')));

  if v_position_match_count > 1 then
    return jsonb_build_object(
      'control', 'CONFIGURATION_ERROR',
      'reason', 'WHOLE_ORGANIZATION_POSITION_AMBIGUOUS',
      'positionId', null
    );
  end if;

  if v_position_match_count = 1 then
    if nullif(trim(coalesce(v_employee.department, '')), '') is not null then
      return jsonb_build_object(
        'control', 'CONFIGURATION_ERROR',
        'reason', 'WHOLE_ORGANIZATION_POSITION_HAS_DEPARTMENT',
        'positionId', v_position_id
      );
    end if;
  else
    -- A department employee whose title does not match a configured
    -- whole-organization position remains ordinary HR-managed staff.
    if nullif(trim(coalesce(v_employee.department, '')), '') is not null then
      return jsonb_build_object(
        'control', 'STANDARD_HR',
        'reason', 'DEPARTMENT_EMPLOYEE',
        'positionId', null
      );
    end if;

    -- Department-null employees fail closed when their whole-organization
    -- position has not been configured in the hierarchy.
    return jsonb_build_object(
      'control', 'CONFIGURATION_ERROR',
      'reason', 'WHOLE_ORGANIZATION_POSITION_NOT_CONFIGURED',
      'positionId', null
    );
  end if;

  -- Every configured whole-organization position must be explicitly classified.
  -- Absence of a governance row is intentionally different from STANDARD_HR.
  select
    count(*)::integer,
    (array_agg(governance.compensation_control))[1]
  into
    v_governance_match_count,
    v_control
  from public.organization_job_title_governance governance
  where governance.tenant_id = v_employee.tenant_id
    and governance.job_title_id = v_position_id;

  if v_governance_match_count = 0 then
    return jsonb_build_object(
      'control', 'CONFIGURATION_ERROR',
      'reason', 'POSITION_GOVERNANCE_NOT_CONFIGURED',
      'positionId', v_position_id
    );
  end if;

  if v_governance_match_count > 1 then
    return jsonb_build_object(
      'control', 'CONFIGURATION_ERROR',
      'reason', 'POSITION_GOVERNANCE_AMBIGUOUS',
      'positionId', v_position_id
    );
  end if;

  if v_control = 'STANDARD_HR' then
    return jsonb_build_object(
      'control', 'STANDARD_HR',
      'reason', 'POSITION_GOVERNANCE_STANDARD_HR',
      'positionId', v_position_id
    );
  end if;

  if v_control = 'GOVERNANCE_RESTRICTED' then
    return jsonb_build_object(
      'control', 'GOVERNANCE_RESTRICTED',
      'reason', 'POSITION_GOVERNANCE_RESTRICTED',
      'positionId', v_position_id
    );
  end if;

  return jsonb_build_object(
    'control', 'CONFIGURATION_ERROR',
    'reason', 'POSITION_GOVERNANCE_CONTROL_INVALID',
    'positionId', v_position_id
  );
end;
$function$;

revoke all
on function bexhr_private.resolve_employee_compensation_governance(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PRIVATE GOVERNANCE AUTHORITY INDEPENDENCE CHECK
--
-- Independence is evaluated dynamically every time authority is used. This
-- prevents a profile that was valid when assigned from retaining authority
-- after later moving into a restricted or ambiguously configured position.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.is_governance_authority_profile_independent(
  p_profile_id uuid,
  p_tenant_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  if p_profile_id is null or p_tenant_id is null then
    return false;
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = p_profile_id
    and profile.tenant_id = p_tenant_id
    and coalesce(profile.is_active, false) is true;

  if not found then
    return false;
  end if;

  if lower(trim(coalesce(v_profile.role, ''))) in (
    'hr',
    'hr_manager',
    'payroll',
    'payroll_manager',
    'admin',
    'system_admin'
  )
  or lower(trim(coalesce(v_profile.hr_access_level, 'standard'))) =
      'tenant_admin' then
    return false;
  end if;

  if exists (
    select 1
    from public.employees employee
    cross join lateral (
      select bexhr_private.resolve_employee_compensation_governance(
        employee.id,
        employee.tenant_id
      ) as result
    ) resolution
    where employee.tenant_id = p_tenant_id
      and (
        employee.user_id = p_profile_id
        or (
          nullif(trim(coalesce(v_profile.email, '')), '') is not null
          and lower(trim(coalesce(employee.work_email, ''))) =
              lower(trim(v_profile.email))
        )
      )
      and coalesce(
        resolution.result ->> 'control',
        'CONFIGURATION_ERROR'
      ) in (
        'GOVERNANCE_RESTRICTED',
        'CONFIGURATION_ERROR'
      )
  ) then
    return false;
  end if;

  return true;
end;
$function$;

revoke all
on function bexhr_private.is_governance_authority_profile_independent(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PRIVATE GOVERNANCE AUTHORITY CHECK
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.current_user_has_governance_authority(
  p_tenant_id uuid,
  p_authority_scope text default 'EXECUTIVE_COMPENSATION'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_governance_authorities authority
    where authority.tenant_id = p_tenant_id
      and authority.profile_id = auth.uid()
      and authority.authority_scope = upper(trim(coalesce(p_authority_scope, '')))
      and authority.status = 'ACTIVE'
      and bexhr_private.is_governance_authority_profile_independent(
        authority.profile_id,
        authority.tenant_id
      )
  );
$function$;

revoke all
on function bexhr_private.current_user_has_governance_authority(uuid, text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- POSITION GOVERNANCE INTEGRITY
--
-- Company Admin may apply a governance restriction, but cannot silently remove
-- one. Releasing a restricted position requires an active independent
-- governance authority. The trigger also prevents a current governance
-- authority from becoming conflicted because their own occupied position is
-- newly marked restricted.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_organization_job_title_governance_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_position public.organization_job_titles%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.compensation_control = 'GOVERNANCE_RESTRICTED'
       and not bexhr_private.current_user_has_governance_authority(
         old.tenant_id,
         'EXECUTIVE_COMPENSATION'
       ) then
      raise exception using
        errcode = '42501',
        message = 'BEXHR_GOVERNANCE_RELEASE_REQUIRES_AUTHORITY: A restricted position can only be released by an active independent governance authority.';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.job_title_id is distinct from old.job_title_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_POSITION_GOVERNANCE_IDENTITY_LOCK: Governance identity, tenant and position cannot be changed.';
    end if;

    if old.compensation_control = 'GOVERNANCE_RESTRICTED'
       and new.compensation_control <> 'GOVERNANCE_RESTRICTED'
       and not bexhr_private.current_user_has_governance_authority(
         old.tenant_id,
         'EXECUTIVE_COMPENSATION'
       ) then
      raise exception using
        errcode = '42501',
        message = 'BEXHR_GOVERNANCE_RELEASE_REQUIRES_AUTHORITY: A restricted position can only be released by an active independent governance authority.';
    end if;

    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;

  select position.*
  into v_position
  from public.organization_job_titles position
  where position.id = new.job_title_id
    and position.department_id is null
    and lower(trim(coalesce(position.status, ''))) = 'active'
    and (
      position.tenant_id = new.tenant_id
      or position.tenant_id is null
    );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_POSITION_GOVERNANCE_POSITION_INVALID: Governance can only be assigned to an active whole-organization position available to this tenant.';
  end if;

  if new.compensation_control = 'GOVERNANCE_RESTRICTED'
     and not exists (
       select 1
       from public.organization_governance_authorities authority
       where authority.tenant_id = new.tenant_id
         and authority.authority_scope = 'EXECUTIVE_COMPENSATION'
         and authority.status = 'ACTIVE'
         and bexhr_private.is_governance_authority_profile_independent(
           authority.profile_id,
           authority.tenant_id
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED_BEFORE_RESTRICTION: Assign at least one active independent executive compensation governance authority before restricting a position.';
  end if;

  if new.compensation_control = 'GOVERNANCE_RESTRICTED'
     and exists (
       select 1
       from public.organization_governance_authorities authority
       join public.profiles profile
         on profile.id = authority.profile_id
       join public.employees employee
         on employee.tenant_id = new.tenant_id
        and (
          employee.user_id = authority.profile_id
          or (
            nullif(trim(coalesce(profile.email, '')), '') is not null
            and lower(trim(coalesce(employee.work_email, ''))) =
                lower(trim(profile.email))
          )
        )
       where authority.tenant_id = new.tenant_id
         and authority.authority_scope = 'EXECUTIVE_COMPENSATION'
         and authority.status = 'ACTIVE'
         and profile.tenant_id = new.tenant_id
         and coalesce(profile.is_active, false) is true
         and nullif(trim(coalesce(employee.department, '')), '') is null
         and lower(trim(coalesce(employee.job_title, ''))) =
             lower(trim(coalesce(v_position.job_title, '')))
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_POSITION_CONFLICT: Reassign the active governance authority before restricting a position they occupy.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_organization_job_title_governance_integrity()
from public, anon, authenticated;

create trigger bexhr_enforce_organization_job_title_governance_integrity
before insert or update or delete
on public.organization_job_title_governance
for each row
execute function bexhr_private.enforce_organization_job_title_governance_integrity();

-- ---------------------------------------------------------------------------
-- AUTHORITY INTEGRITY
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_organization_governance_authority_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status = 'ACTIVE'
       and exists (
         select 1
         from public.organization_job_title_governance governance
         where governance.tenant_id = old.tenant_id
           and governance.compensation_control = 'GOVERNANCE_RESTRICTED'
       )
       and not exists (
         select 1
         from public.organization_governance_authorities other_authority
         where other_authority.tenant_id = old.tenant_id
           and other_authority.authority_scope = old.authority_scope
           and other_authority.status = 'ACTIVE'
           and other_authority.id <> old.id
           and bexhr_private.is_governance_authority_profile_independent(
             other_authority.profile_id,
             other_authority.tenant_id
           )
       ) then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_GOVERNANCE_LAST_ACTIVE_AUTHORITY: Assign another active independent governance authority before removing the last authority while restricted positions exist.';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'ACTIVE'
       and new.status <> 'ACTIVE'
       and exists (
         select 1
         from public.organization_job_title_governance governance
         where governance.tenant_id = old.tenant_id
           and governance.compensation_control = 'GOVERNANCE_RESTRICTED'
       )
       and not exists (
         select 1
         from public.organization_governance_authorities other_authority
         where other_authority.tenant_id = old.tenant_id
           and other_authority.authority_scope = old.authority_scope
           and other_authority.status = 'ACTIVE'
           and other_authority.id <> old.id
           and bexhr_private.is_governance_authority_profile_independent(
             other_authority.profile_id,
             other_authority.tenant_id
           )
       ) then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_GOVERNANCE_LAST_ACTIVE_AUTHORITY: Assign another active independent governance authority before deactivating the last authority while restricted positions exist.';
    end if;

    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.profile_id is distinct from old.profile_id
       or new.authority_scope is distinct from old.authority_scope then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_GOVERNANCE_AUTHORITY_IDENTITY_LOCK: Authority identity cannot be changed.';
    end if;

    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = new.profile_id;

  if not found
     or v_profile.tenant_id is distinct from new.tenant_id
     or coalesce(v_profile.is_active, false) is not true then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_PROFILE_INVALID: Governance authority must be an active profile in the same tenant.';
  end if;

  if lower(trim(coalesce(v_profile.role, ''))) in (
    'hr',
    'hr_manager',
    'payroll',
    'payroll_manager',
    'admin',
    'system_admin'
  )
  or lower(trim(coalesce(v_profile.hr_access_level, 'standard'))) =
      'tenant_admin' then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_INDEPENDENCE: HR and Platform Admin profiles cannot be executive compensation governance authorities.';
  end if;

  if not bexhr_private.is_governance_authority_profile_independent(
    new.profile_id,
    new.tenant_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_CONFLICT: An occupant of a restricted or ambiguous governance position cannot govern restricted executive compensation.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_organization_governance_authority_integrity()
from public, anon, authenticated;

create trigger bexhr_enforce_organization_governance_authority_integrity
before insert or update or delete
on public.organization_governance_authorities
for each row
execute function bexhr_private.enforce_organization_governance_authority_integrity();

-- ---------------------------------------------------------------------------
-- COMPANY ADMIN POSITION GOVERNANCE RPC
-- ---------------------------------------------------------------------------
create or replace function public.hr_tenant_admin_save_job_title_governance(
  p_job_title_id uuid,
  p_compensation_control text
)
returns public.organization_job_title_governance
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_control text := upper(trim(coalesce(p_compensation_control, '')));
  v_saved public.organization_job_title_governance%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  if p_job_title_id is null then
    raise exception 'A position is required.' using errcode = '22023';
  end if;

  if v_control not in ('STANDARD_HR', 'GOVERNANCE_RESTRICTED') then
    raise exception
      'Compensation control must be STANDARD_HR or GOVERNANCE_RESTRICTED.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_job_title_hierarchy hierarchy
    where hierarchy.tenant_id = v_tenant_id
      and hierarchy.job_title_id = p_job_title_id
  ) then
    raise exception
      'Configure the whole-organization position hierarchy before assigning governance.'
      using errcode = '23514';
  end if;

  if v_control = 'STANDARD_HR'
     and exists (
       select 1
       from public.organization_job_title_governance existing_governance
       where existing_governance.tenant_id = v_tenant_id
         and existing_governance.job_title_id = p_job_title_id
         and existing_governance.compensation_control = 'GOVERNANCE_RESTRICTED'
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_RELEASE_REQUIRES_AUTHORITY: Company Admin cannot release a restricted compensation position. An independent governance authority must release it.';
  end if;

  insert into public.organization_job_title_governance (
    tenant_id,
    job_title_id,
    compensation_control,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    p_job_title_id,
    v_control,
    auth.uid(),
    auth.uid()
  )
  on conflict (tenant_id, job_title_id)
  do update set
    compensation_control = excluded.compensation_control,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_saved;

  return v_saved;
end;
$function$;

revoke all
on function public.hr_tenant_admin_save_job_title_governance(uuid, text)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_job_title_governance(uuid, text)
to authenticated, service_role;

create or replace function public.hr_tenant_admin_delete_job_title_governance(
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
    raise exception 'A position is required.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.organization_job_title_governance existing_governance
    where existing_governance.tenant_id = v_tenant_id
      and existing_governance.job_title_id = p_job_title_id
      and existing_governance.compensation_control = 'GOVERNANCE_RESTRICTED'
  ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_RELEASE_REQUIRES_AUTHORITY: Company Admin cannot delete a restricted compensation position. An independent governance authority must release it first.';
  end if;

  delete from public.organization_job_title_governance governance
  where governance.tenant_id = v_tenant_id
    and governance.job_title_id = p_job_title_id;

  if not found then
    raise exception
      'The selected position governance record was not found.'
      using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

revoke all
on function public.hr_tenant_admin_delete_job_title_governance(uuid)
from public, anon;

grant execute
on function public.hr_tenant_admin_delete_job_title_governance(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- INDEPENDENT GOVERNANCE RELEASE RPC
--
-- A restricted position is a durable governance decision. Company Admin may
-- apply the restriction but cannot remove it alone. Only an active independent
-- governance authority may release it back to STANDARD_HR.
-- ---------------------------------------------------------------------------
create or replace function public.governance_authority_release_job_title_governance(
  p_job_title_id uuid
)
returns public.organization_job_title_governance
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_saved public.organization_job_title_governance%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select profile.tenant_id
  into v_tenant_id
  from public.profiles profile
  where profile.id = auth.uid()
    and coalesce(profile.is_active, false) is true
    and profile.tenant_id is not null;

  if not found or v_tenant_id is null then
    raise exception
      'Active tenant profile is required.'
      using errcode = '42501';
  end if;

  if not bexhr_private.current_user_has_governance_authority(
    v_tenant_id,
    'EXECUTIVE_COMPENSATION'
  ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority can release a restricted position.';
  end if;

  if p_job_title_id is null then
    raise exception 'A position is required.'
      using errcode = '22023';
  end if;

  update public.organization_job_title_governance governance
  set
    compensation_control = 'STANDARD_HR',
    updated_by = auth.uid(),
    updated_at = now()
  where governance.tenant_id = v_tenant_id
    and governance.job_title_id = p_job_title_id
    and governance.compensation_control = 'GOVERNANCE_RESTRICTED'
  returning governance.* into v_saved;

  if not found then
    raise exception
      'The selected position is not currently governance restricted in your company workspace.'
      using errcode = 'P0002';
  end if;

  return v_saved;
end;
$function$;

comment on function public.governance_authority_release_job_title_governance(uuid) is
'Releases one governance-restricted position back to STANDARD_HR. Only an active independent executive compensation governance authority may execute the release.';

revoke all
on function public.governance_authority_release_job_title_governance(uuid)
from public, anon;

grant execute
on function public.governance_authority_release_job_title_governance(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- COMPANY ADMIN GOVERNANCE AUTHORITY RPCS
-- ---------------------------------------------------------------------------
create or replace function public.hr_tenant_admin_save_governance_authority(
  p_profile_id uuid,
  p_authority_scope text default 'EXECUTIVE_COMPENSATION'
)
returns public.organization_governance_authorities
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_scope text := upper(trim(coalesce(p_authority_scope, '')));
  v_saved public.organization_governance_authorities%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  if p_profile_id is null then
    raise exception 'A governance authority profile is required.'
      using errcode = '22023';
  end if;

  if p_profile_id = auth.uid() then
    raise exception
      'Company Admin cannot assign governance authority to their own profile.'
      using errcode = '42501';
  end if;

  if v_scope <> 'EXECUTIVE_COMPENSATION' then
    raise exception
      'Unsupported governance authority scope.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_profile_id
      and profile.tenant_id = v_tenant_id
      and coalesce(profile.is_active, false) is true
  ) then
    raise exception
      'Governance authority must be an active profile in your company workspace.'
      using errcode = '23514';
  end if;

  insert into public.organization_governance_authorities (
    tenant_id,
    profile_id,
    authority_scope,
    status,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    p_profile_id,
    v_scope,
    'ACTIVE',
    auth.uid(),
    auth.uid()
  )
  on conflict (tenant_id, profile_id, authority_scope)
  do update set
    status = 'ACTIVE',
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_saved;

  return v_saved;
end;
$function$;

revoke all
on function public.hr_tenant_admin_save_governance_authority(uuid, text)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_governance_authority(uuid, text)
to authenticated, service_role;

create or replace function public.hr_tenant_admin_remove_governance_authority(
  p_profile_id uuid,
  p_authority_scope text default 'EXECUTIVE_COMPENSATION'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_scope text := upper(trim(coalesce(p_authority_scope, '')));
begin
  v_tenant_id := public.require_current_tenant_administrator();

  if p_profile_id is null then
    raise exception 'A governance authority profile is required.'
      using errcode = '22023';
  end if;

  if v_scope <> 'EXECUTIVE_COMPENSATION' then
    raise exception 'Unsupported governance authority scope.'
      using errcode = '22023';
  end if;

  delete from public.organization_governance_authorities authority
  where authority.tenant_id = v_tenant_id
    and authority.profile_id = p_profile_id
    and authority.authority_scope = v_scope;

  if not found then
    raise exception 'The governance authority assignment was not found.'
      using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

revoke all
on function public.hr_tenant_admin_remove_governance_authority(uuid, text)
from public, anon;

grant execute
on function public.hr_tenant_admin_remove_governance_authority(uuid, text)
to authenticated, service_role;

create or replace function public.hr_tenant_admin_list_governance_authorities()
returns table (
  profile_id uuid,
  full_name text,
  email text,
  authority_scope text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  return query
  select
    profile.id,
    profile.full_name,
    profile.email,
    authority.authority_scope,
    authority.status,
    authority.created_at,
    authority.updated_at
  from public.organization_governance_authorities authority
  join public.profiles profile
    on profile.id = authority.profile_id
  where authority.tenant_id = v_tenant_id
  order by
    case when authority.status = 'ACTIVE' then 0 else 1 end,
    lower(coalesce(profile.full_name, profile.email, ''));
end;
$function$;

revoke all
on function public.hr_tenant_admin_list_governance_authorities()
from public, anon;

grant execute
on function public.hr_tenant_admin_list_governance_authorities()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- HR-SAFE GOVERNANCE SNAPSHOT
--
-- Exposes no salary amounts and no governance-authority identities. It lets the
-- HR UI distinguish standard HR-managed employees from restricted executives.
-- ---------------------------------------------------------------------------
create or replace function public.hr_get_employee_compensation_governance()
returns table (
  employee_id uuid,
  compensation_control text,
  governance_reason text,
  governance_position_id uuid,
  current_user_is_governance_authority boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if auth.uid() is null or v_tenant_id is null then
    raise exception 'Authentication and tenant context are required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.tenant_id = v_tenant_id
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) = 'hr'
  )
  and not bexhr_private.current_user_has_governance_authority(
    v_tenant_id,
    'EXECUTIVE_COMPENSATION'
  ) then
    raise exception 'The current profile cannot read compensation governance.'
      using errcode = '42501';
  end if;

  return query
  select
    employee.id,
    coalesce(resolution.result ->> 'control', 'CONFIGURATION_ERROR'),
    coalesce(resolution.result ->> 'reason', 'UNRESOLVED'),
    nullif(resolution.result ->> 'positionId', '')::uuid,
    bexhr_private.current_user_has_governance_authority(
      v_tenant_id,
      'EXECUTIVE_COMPENSATION'
    )
  from public.employees employee
  cross join lateral (
    select bexhr_private.resolve_employee_compensation_governance(
      employee.id,
      employee.tenant_id
    ) as result
  ) resolution
  where employee.tenant_id = v_tenant_id;
end;
$function$;

revoke all
on function public.hr_get_employee_compensation_governance()
from public, anon;

grant execute
on function public.hr_get_employee_compensation_governance()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ADMINISTRATIVE AUDIT
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.capture_organization_governance_audit()
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
  v_entity_type text;
  v_previous_values jsonb;
  v_new_values jsonb;
  v_changed_fields text[] := array[]::text[];
begin
  select profile.*
  into v_actor
  from public.profiles profile
  where profile.id = v_actor_user_id
  limit 1;

  v_tenant_id := nullif(
    coalesce(v_new ->> 'tenant_id', v_old ->> 'tenant_id'),
    ''
  )::uuid;

  v_entity_id := nullif(
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    ''
  );

  if tg_table_name = 'organization_job_title_governance' then
    v_entity_type := 'organization_job_title_governance';
    v_event_type := case tg_op
      when 'INSERT' then 'organization_job_title_governance_created'
      when 'UPDATE' then 'organization_job_title_governance_updated'
      else 'organization_job_title_governance_deleted'
    end;
  elsif tg_table_name = 'organization_governance_authorities' then
    v_entity_type := 'organization_governance_authority';
    v_event_type := case tg_op
      when 'INSERT' then 'organization_governance_authority_created'
      when 'UPDATE' then 'organization_governance_authority_updated'
      else 'organization_governance_authority_deleted'
    end;
  else
    raise exception 'Unsupported governance audit source table.';
  end if;

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

revoke all
on function bexhr_private.capture_organization_governance_audit()
from public, anon, authenticated;

create trigger audit_organization_job_title_governance_changes
after insert or update or delete
on public.organization_job_title_governance
for each row
execute function bexhr_private.capture_organization_governance_audit();

create trigger audit_organization_governance_authority_changes
after insert or update or delete
on public.organization_governance_authorities
for each row
execute function bexhr_private.capture_organization_governance_audit();

-- ---------------------------------------------------------------------------
-- INSTALL-TIME VERIFICATION
-- ---------------------------------------------------------------------------
do $phase45a_verify$
declare
  v_position_rls boolean;
  v_authority_rls boolean;
  v_resolver_oid oid;
  v_independence_check_oid oid;
  v_authority_check_oid oid;
  v_position_integrity_oid oid;
  v_authority_integrity_oid oid;
begin
  if to_regclass('public.organization_job_title_governance') is null then
    raise exception 'Phase 4.5A verification failed: position governance table is missing.';
  end if;

  if to_regclass('public.organization_governance_authorities') is null then
    raise exception 'Phase 4.5A verification failed: governance authority table is missing.';
  end if;

  select relation.relrowsecurity
  into v_position_rls
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = relation.relnamespace
  where namespace_record.nspname = 'public'
    and relation.relname = 'organization_job_title_governance';

  select relation.relrowsecurity
  into v_authority_rls
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = relation.relnamespace
  where namespace_record.nspname = 'public'
    and relation.relname = 'organization_governance_authorities';

  if v_position_rls is not true or v_authority_rls is not true then
    raise exception 'Phase 4.5A verification failed: governance RLS is not enabled.';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.organization_job_title_governance',
    'SELECT'
  ) then
    raise exception 'Phase 4.5A verification failed: tenant users cannot read position governance.';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.organization_job_title_governance',
    'INSERT'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_job_title_governance',
    'UPDATE'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_job_title_governance',
    'DELETE'
  ) then
    raise exception 'Phase 4.5A verification failed: authenticated users have direct position-governance write access.';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.organization_governance_authorities',
    'SELECT'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_governance_authorities',
    'INSERT'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_governance_authorities',
    'UPDATE'
  )
  or has_table_privilege(
    'authenticated',
    'public.organization_governance_authorities',
    'DELETE'
  ) then
    raise exception 'Phase 4.5A verification failed: governance authority table is directly exposed to authenticated users.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
      'public.organization_job_title_governance'::regclass
      and constraint_record.conname =
        'organization_job_title_governance_hierarchy_position_fkey'
      and constraint_record.contype = 'f'
  ) then
    raise exception 'Phase 4.5A verification failed: hierarchy-governance foreign key is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_title_governance'::regclass
      and trigger_record.tgname =
        'bexhr_enforce_organization_job_title_governance_integrity'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4.5A verification failed: position governance integrity trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_governance_authorities'::regclass
      and trigger_record.tgname =
        'bexhr_enforce_organization_governance_authority_integrity'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4.5A verification failed: authority integrity trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_job_title_governance'::regclass
      and trigger_record.tgname =
        'audit_organization_job_title_governance_changes'
      and trigger_record.tgisinternal is false
  )
  or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_governance_authorities'::regclass
      and trigger_record.tgname =
        'audit_organization_governance_authority_changes'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4.5A verification failed: governance audit trigger is missing.';
  end if;

  if to_regprocedure(
    'public.hr_tenant_admin_save_job_title_governance(uuid,text)'
  ) is null
  or to_regprocedure(
    'public.hr_tenant_admin_delete_job_title_governance(uuid)'
  ) is null
  or to_regprocedure(
    'public.governance_authority_release_job_title_governance(uuid)'
  ) is null
  or to_regprocedure(
    'public.hr_tenant_admin_save_governance_authority(uuid,text)'
  ) is null
  or to_regprocedure(
    'public.hr_tenant_admin_remove_governance_authority(uuid,text)'
  ) is null
  or to_regprocedure(
    'public.hr_tenant_admin_list_governance_authorities()'
  ) is null
  or to_regprocedure(
    'public.hr_get_employee_compensation_governance()'
  ) is null then
    raise exception 'Phase 4.5A verification failed: one or more governance RPCs are missing.';
  end if;

  v_resolver_oid := to_regprocedure(
    'bexhr_private.resolve_employee_compensation_governance(uuid,uuid)'
  );

  v_independence_check_oid := to_regprocedure(
    'bexhr_private.is_governance_authority_profile_independent(uuid,uuid)'
  );

  v_authority_check_oid := to_regprocedure(
    'bexhr_private.current_user_has_governance_authority(uuid,text)'
  );

  v_position_integrity_oid := to_regprocedure(
    'bexhr_private.enforce_organization_job_title_governance_integrity()'
  );

  v_authority_integrity_oid := to_regprocedure(
    'bexhr_private.enforce_organization_governance_authority_integrity()'
  );

  if v_resolver_oid is null
     or v_independence_check_oid is null
     or v_authority_check_oid is null
     or v_position_integrity_oid is null
     or v_authority_integrity_oid is null then
    raise exception 'Phase 4.5A verification failed: private governance helper is missing.';
  end if;

  if position(
    'POSITION_GOVERNANCE_NOT_CONFIGURED'
    in pg_get_functiondef(v_resolver_oid)
  ) = 0
  or position(
    'WHOLE_ORGANIZATION_POSITION_NOT_CONFIGURED'
    in pg_get_functiondef(v_resolver_oid)
  ) = 0
  or position(
    'WHOLE_ORGANIZATION_POSITION_HAS_DEPARTMENT'
    in pg_get_functiondef(v_resolver_oid)
  ) = 0 then
    raise exception 'Phase 4.5A verification failed: compensation governance resolver is not fail-closed for unconfigured or structurally inconsistent whole-organization positions.';
  end if;

  if position(
    'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED_BEFORE_RESTRICTION'
    in pg_get_functiondef(v_position_integrity_oid)
  ) = 0 then
    raise exception 'Phase 4.5A verification failed: restricted positions do not require an active independent governance authority.';
  end if;

  if position(
    'is_governance_authority_profile_independent'
    in pg_get_functiondef(v_authority_check_oid)
  ) = 0
  or position(
    'GOVERNANCE_RESTRICTED'
    in pg_get_functiondef(v_independence_check_oid)
  ) = 0
  or position(
    'CONFIGURATION_ERROR'
    in pg_get_functiondef(v_independence_check_oid)
  ) = 0 then
    raise exception 'Phase 4.5A verification failed: governance authority independence is not dynamically revalidated.';
  end if;

  if position(
    'BEXHR_GOVERNANCE_LAST_ACTIVE_AUTHORITY'
    in pg_get_functiondef(v_authority_integrity_oid)
  ) = 0 then
    raise exception 'Phase 4.5A verification failed: last-active-authority lockout protection is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'public.organization_governance_authorities'::regclass
      and trigger_record.tgname =
        'bexhr_enforce_organization_governance_authority_integrity'
      and not trigger_record.tgisinternal
      and position(
        'DELETE'
        in pg_get_triggerdef(trigger_record.oid)
      ) > 0
  ) then
    raise exception 'Phase 4.5A verification failed: authority integrity trigger does not protect deletes.';
  end if;

  if has_function_privilege('anon', v_resolver_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_resolver_oid, 'EXECUTE')
     or has_function_privilege('anon', v_independence_check_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_independence_check_oid, 'EXECUTE')
     or has_function_privilege('anon', v_authority_check_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_authority_check_oid, 'EXECUTE')
     or has_function_privilege('anon', v_position_integrity_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_position_integrity_oid, 'EXECUTE')
     or has_function_privilege('anon', v_authority_integrity_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_authority_integrity_oid, 'EXECUTE') then
    raise exception 'Phase 4.5A verification failed: private governance helper execution is exposed.';
  end if;
end;
$phase45a_verify$;

commit;
