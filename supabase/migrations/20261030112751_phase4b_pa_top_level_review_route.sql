-- BEXHR PHASE 4B-1 — PA MANAGER REVIEW ROUTE (REVISED BEFORE DEPLOYMENT)
--
-- Purpose:
--   Make PA distinguish a genuine configured top-level employee from an
--   employee whose manager/reporting setup is incomplete or inconsistent.
--
-- Route contract:
--   PRIMARY_MANAGER     = a valid manager review is required.
--   TOP_LEVEL           = manager review is explicitly not applicable.
--   CONFIGURATION_ERROR = PA must not silently treat missing/invalid reporting
--                         setup as a top-level appraisal.
--
-- The route is snapshotted when the employee appraisal is created. No literal
-- CEO/COO/MD title logic is used. Whole-organization manager positions are
-- validated against the tenant's configured organization position hierarchy.
-- Normal employees continue to use the locked R-14B Primary Manager rules.
--
-- Existing/historical appraisals retain the pre-4B conservative default of
-- PRIMARY_MANAGER. This migration does not rewrite historical PA records.
--
-- Deliberately out of scope for this slice:
--   - HR Admin top-authority fallback when no whole-organization root is occupied;
--   - automatic employee reporting-line creation/reassignment;
--   - manager identity snapshotting/reassignment during an active PA cycle;
--   - frontend PA rendering changes (added only after this DB contract is verified).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- PREFLIGHT
-- ---------------------------------------------------------------------------
do $phase4b_preflight$
begin
  if to_regclass('public.pa_employee_appraisals') is null
     or to_regclass('public.pa_self_appraisals') is null
     or to_regclass('public.pa_manager_appraisals') is null
     or to_regclass('public.pa_hr_finalisations') is null then
    raise exception 'Phase 4B stopped: required PA appraisal tables are missing.';
  end if;

  if to_regclass('public.employees') is null
     or to_regclass('public.employee_reporting_lines') is null
     or to_regclass('public.organization_job_titles') is null
     or to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'Phase 4B stopped: required employee/reporting/position hierarchy tables are missing.';
  end if;

  if to_regprocedure('public.pa_activate_cycle(text)') is null then
    raise exception 'Phase 4B stopped: atomic PA cycle activation is missing.';
  end if;

  if to_regprocedure('bexhr_private.is_whole_organization_employee(uuid)') is null
     or to_regprocedure('bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)') is null then
    raise exception 'Phase 4B stopped: R-14B reporting hierarchy helpers are missing.';
  end if;
end;
$phase4b_preflight$;

create schema if not exists bexhr_private;
revoke all on schema bexhr_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- APPRAISAL ROUTE SNAPSHOT
-- ---------------------------------------------------------------------------
alter table public.pa_employee_appraisals
  add column if not exists manager_review_route text
  not null
  default 'PRIMARY_MANAGER';

do $phase4b_route_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.pa_employee_appraisals'::regclass
      and constraint_record.conname = 'pa_employee_appraisals_manager_review_route_check'
  ) then
    alter table public.pa_employee_appraisals
      add constraint pa_employee_appraisals_manager_review_route_check
      check (
        manager_review_route in (
          'PRIMARY_MANAGER',
          'TOP_LEVEL',
          'CONFIGURATION_ERROR'
        )
      );
  end if;
end;
$phase4b_route_constraint$;

comment on column public.pa_employee_appraisals.manager_review_route is
'PA manager-review route snapshotted when the appraisal is created. PRIMARY_MANAGER requires a valid Primary Manager review; TOP_LEVEL means manager review is not applicable for an explicitly configured top-level whole-organization Manager with no active Primary Manager; CONFIGURATION_ERROR means PA detected incomplete or inconsistent manager/hierarchy setup.';

-- ---------------------------------------------------------------------------
-- CANONICAL ROUTE RESOLVER
--
-- This reuses R-14B for ordinary Primary Manager validity and Phase 4A for
-- immediate whole-organization parent ordering.
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.resolve_pa_manager_review_route(
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
  v_manager public.employees%rowtype;
  v_primary_count integer := 0;
  v_primary_manager_id uuid;
  v_whole_organization boolean := false;
  v_hierarchy_count integer := 0;
  v_position_id uuid;
  v_parent_position_id uuid;
  v_parent_title text;
  v_route text := 'CONFIGURATION_ERROR';
  v_reason text := 'UNRESOLVED';
begin
  if p_employee_id is null or p_tenant_id is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_PA_REVIEW_ROUTE_INPUT_REQUIRED: Employee and tenant are required.';
  end if;

  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = p_employee_id
    and employee.tenant_id = p_tenant_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_PA_REVIEW_ROUTE_EMPLOYEE_INVALID: The appraisal employee was not found in the appraisal tenant.';
  end if;

  if lower(trim(coalesce(v_employee.status, 'active'))) <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_REVIEW_ROUTE_EMPLOYEE_INACTIVE: Only an active employee can receive a new appraisal route.';
  end if;

  select
    count(*)::integer,
    (array_agg(reporting_line.manager_employee_id))[1]
  into
    v_primary_count,
    v_primary_manager_id
  from public.employee_reporting_lines reporting_line
  where reporting_line.employee_id = v_employee.id
    and lower(trim(coalesce(reporting_line.status, 'active'))) = 'active'
    and lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'
    and (
      reporting_line.tenant_id is null
      or reporting_line.tenant_id = v_employee.tenant_id
    );

  v_whole_organization :=
    bexhr_private.is_whole_organization_employee(v_employee.id);

  -- Whole-organization Manager positions are governed by the explicit Phase 4A
  -- position hierarchy, including immediate-parent matching.
  if v_whole_organization
     and lower(trim(coalesce(v_employee.system_role, ''))) = 'manager' then

    select count(*)::integer
    into v_hierarchy_count
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

    if v_hierarchy_count = 0 then
      v_route := 'CONFIGURATION_ERROR';
      v_reason := 'WHOLE_ORGANIZATION_POSITION_NOT_CONFIGURED';

    elsif v_hierarchy_count > 1 then
      v_route := 'CONFIGURATION_ERROR';
      v_reason := 'WHOLE_ORGANIZATION_POSITION_AMBIGUOUS';

    else
      select
        hierarchy.job_title_id,
        hierarchy.reports_to_job_title_id
      into
        v_position_id,
        v_parent_position_id
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
            lower(trim(coalesce(v_employee.job_title, '')))
      limit 1;

      if v_parent_position_id is null then
        if v_primary_count = 0 then
          v_route := 'TOP_LEVEL';
          v_reason := 'EXPLICIT_TOP_LEVEL_NO_PRIMARY_MANAGER';
        else
          v_route := 'CONFIGURATION_ERROR';
          v_reason := 'TOP_LEVEL_POSITION_HAS_PRIMARY_MANAGER';
        end if;

      elsif v_primary_count = 0 then
        v_route := 'CONFIGURATION_ERROR';
        v_reason := 'CONFIGURED_PARENT_REQUIRES_PRIMARY_MANAGER';

      elsif v_primary_count > 1 then
        v_route := 'CONFIGURATION_ERROR';
        v_reason := 'MULTIPLE_ACTIVE_PRIMARY_MANAGERS';

      else
        select manager.*
        into v_manager
        from public.employees manager
        where manager.id = v_primary_manager_id;

        if v_manager.id is null
           or v_manager.tenant_id is distinct from v_employee.tenant_id
           or lower(trim(coalesce(v_manager.status, 'active'))) <> 'active' then
          v_route := 'CONFIGURATION_ERROR';
          v_reason := 'PRIMARY_MANAGER_INVALID';

        elsif not bexhr_private.is_primary_reporting_relationship_valid(
          v_employee.id,
          v_manager.id
        ) then
          v_route := 'CONFIGURATION_ERROR';
          v_reason := 'PRIMARY_MANAGER_HIERARCHY_INVALID';

        else
          select parent_position.job_title
          into v_parent_title
          from public.organization_job_titles parent_position
          where parent_position.id = v_parent_position_id
            and parent_position.department_id is null
            and lower(trim(coalesce(parent_position.status, ''))) = 'active'
            and (
              parent_position.tenant_id = v_employee.tenant_id
              or parent_position.tenant_id is null
            );

          if v_parent_title is null then
            v_route := 'CONFIGURATION_ERROR';
            v_reason := 'CONFIGURED_PARENT_POSITION_INVALID';

          elsif nullif(trim(coalesce(v_manager.department, '')), '') is not null
             or lower(trim(coalesce(v_manager.system_role, ''))) <> 'manager'
             or lower(trim(coalesce(v_manager.job_title, ''))) <>
                lower(trim(v_parent_title)) then
            v_route := 'CONFIGURATION_ERROR';
            v_reason := 'PRIMARY_MANAGER_DOES_NOT_OCCUPY_CONFIGURED_PARENT_POSITION';

          else
            v_route := 'PRIMARY_MANAGER';
            v_reason := 'VALID_CONFIGURED_PARENT_PRIMARY_MANAGER';
          end if;
        end if;
      end if;
    end if;

  else
    -- Everyone outside the explicit whole-organization Manager chain remains
    -- governed by the locked R-14B Primary Manager relationship rules.
    if v_primary_count = 0 then
      v_route := 'CONFIGURATION_ERROR';
      v_reason := 'PRIMARY_MANAGER_MISSING';

    elsif v_primary_count > 1 then
      v_route := 'CONFIGURATION_ERROR';
      v_reason := 'MULTIPLE_ACTIVE_PRIMARY_MANAGERS';

    elsif not bexhr_private.is_primary_reporting_relationship_valid(
      v_employee.id,
      v_primary_manager_id
    ) then
      v_route := 'CONFIGURATION_ERROR';
      v_reason := 'PRIMARY_MANAGER_HIERARCHY_INVALID';

    else
      v_route := 'PRIMARY_MANAGER';
      v_reason := 'VALID_PRIMARY_MANAGER';
    end if;
  end if;

  return jsonb_build_object(
    'route', v_route,
    'reason', v_reason,
    'primaryManagerEmployeeId', v_primary_manager_id,
    'activePrimaryManagerCount', v_primary_count,
    'wholeOrganization', v_whole_organization,
    'positionId', v_position_id,
    'parentPositionId', v_parent_position_id
  );
end;
$function$;

revoke all
on function bexhr_private.resolve_pa_manager_review_route(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ROUTE ASSIGNMENT + IMMUTABILITY
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_manager_review_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resolution jsonb;
  v_route text;
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    if new.manager_review_route is distinct from old.manager_review_route then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PA_REVIEW_ROUTE_LOCK: The appraisal manager-review route is snapshotted and cannot be changed.';
    end if;

    if old.manager_review_route = 'TOP_LEVEL'
       and new.manager_employee_id is not null then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PA_TOP_LEVEL_MANAGER_NOT_ALLOWED: A top-level appraisal cannot be assigned a manager reviewer.';
    end if;

    new.manager_review_route := old.manager_review_route;
    new.payload := jsonb_set(
      coalesce(new.payload, '{}'::jsonb),
      '{managerReviewRoute}',
      to_jsonb(old.manager_review_route),
      true
    );

    if coalesce(old.payload, '{}'::jsonb) ? 'managerReviewRouteReason' then
      new.payload := jsonb_set(
        new.payload,
        '{managerReviewRouteReason}',
        old.payload -> 'managerReviewRouteReason',
        true
      );
    else
      new.payload := new.payload - 'managerReviewRouteReason';
    end if;

    return new;
  end if;

  v_resolution := bexhr_private.resolve_pa_manager_review_route(
    new.employee_id,
    new.tenant_id
  );

  v_route := nullif(trim(coalesce(v_resolution ->> 'route', '')), '');
  v_reason := nullif(trim(coalesce(v_resolution ->> 'reason', '')), '');

  if v_route not in (
    'PRIMARY_MANAGER',
    'TOP_LEVEL',
    'CONFIGURATION_ERROR'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_REVIEW_ROUTE_INVALID: PA could not resolve a valid manager-review route.';
  end if;

  new.manager_review_route := v_route;

  if v_route = 'TOP_LEVEL' then
    new.manager_employee_id := null;
  end if;

  new.payload := jsonb_set(
    coalesce(new.payload, '{}'::jsonb),
    '{managerReviewRoute}',
    to_jsonb(v_route),
    true
  );

  new.payload := jsonb_set(
    new.payload,
    '{managerReviewRouteReason}',
    to_jsonb(coalesce(v_reason, 'UNRESOLVED')),
    true
  );

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_pa_manager_review_route()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_pa_manager_review_route
on public.pa_employee_appraisals;

create trigger bexhr_enforce_pa_manager_review_route
before insert or update of manager_review_route, manager_employee_id, payload
on public.pa_employee_appraisals
for each row
execute function bexhr_private.enforce_pa_manager_review_route();

-- ---------------------------------------------------------------------------
-- MANAGER APPRAISAL ROUTE GUARD
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_manager_appraisal_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route text;
begin
  select appraisal.manager_review_route
  into v_route
  from public.pa_employee_appraisals appraisal
  where appraisal.id = new.appraisal_id
    and appraisal.tenant_id = new.tenant_id
    and appraisal.employee_id = new.employee_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_PA_MANAGER_REVIEW_PARENT_INVALID: The parent employee appraisal was not found.';
  end if;

  if v_route = 'TOP_LEVEL' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_MANAGER_REVIEW_NOT_REQUIRED: This top-level appraisal does not require or permit a manager appraisal.';
  end if;

  if v_route = 'CONFIGURATION_ERROR' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_MANAGER_REVIEW_CONFIGURATION_ERROR: Correct the employee reporting/hierarchy configuration before manager review.';
  end if;

  if v_route <> 'PRIMARY_MANAGER' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_MANAGER_REVIEW_ROUTE_INVALID: The appraisal manager-review route is invalid.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_pa_manager_appraisal_route()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_pa_manager_appraisal_route
on public.pa_manager_appraisals;

create trigger bexhr_enforce_pa_manager_appraisal_route
before insert or update
on public.pa_manager_appraisals
for each row
execute function bexhr_private.enforce_pa_manager_appraisal_route();

-- ---------------------------------------------------------------------------
-- HR FINALISATION PREREQUISITES
-- ---------------------------------------------------------------------------
create or replace function bexhr_private.enforce_pa_hr_finalisation_prerequisites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route text;
begin
  if lower(trim(coalesce(new.status, ''))) <> 'finalised' then
    return new;
  end if;

  select appraisal.manager_review_route
  into v_route
  from public.pa_employee_appraisals appraisal
  where appraisal.id = new.appraisal_id
    and appraisal.tenant_id = new.tenant_id
    and appraisal.employee_id = new.employee_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_PA_FINALISATION_PARENT_INVALID: The parent employee appraisal was not found.';
  end if;

  if v_route = 'CONFIGURATION_ERROR' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_FINALISATION_CONFIGURATION_ERROR: Correct the employee reporting/hierarchy configuration before HR finalisation.';
  end if;

  if v_route not in ('PRIMARY_MANAGER', 'TOP_LEVEL') then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_FINALISATION_ROUTE_INVALID: The appraisal manager-review route is invalid.';
  end if;

  if not exists (
    select 1
    from public.pa_self_appraisals self_appraisal
    where self_appraisal.appraisal_id = new.appraisal_id
      and self_appraisal.tenant_id = new.tenant_id
      and self_appraisal.employee_id = new.employee_id
      and lower(trim(coalesce(self_appraisal.status, ''))) = 'submitted'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_FINALISATION_SELF_REQUIRED: The employee self-appraisal must be submitted before HR finalisation.';
  end if;

  if v_route = 'PRIMARY_MANAGER'
     and not exists (
       select 1
       from public.pa_manager_appraisals manager_appraisal
       where manager_appraisal.appraisal_id = new.appraisal_id
         and manager_appraisal.tenant_id = new.tenant_id
         and manager_appraisal.employee_id = new.employee_id
         and lower(trim(coalesce(manager_appraisal.status, ''))) = 'submitted'
     ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_FINALISATION_MANAGER_REQUIRED: The manager appraisal must be submitted before HR finalisation.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_pa_hr_finalisation_prerequisites()
from public, anon, authenticated;

drop trigger if exists bexhr_enforce_pa_hr_finalisation_prerequisites
on public.pa_hr_finalisations;

create trigger bexhr_enforce_pa_hr_finalisation_prerequisites
before insert or update
on public.pa_hr_finalisations
for each row
execute function bexhr_private.enforce_pa_hr_finalisation_prerequisites();

-- ---------------------------------------------------------------------------
-- INSTALL-TIME VERIFICATION
-- ---------------------------------------------------------------------------
do $phase4b_verify$
declare
  v_resolver_oid oid;
  v_route_function_oid oid;
  v_manager_function_oid oid;
  v_finalisation_function_oid oid;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pa_employee_appraisals'
      and column_name = 'manager_review_route'
      and is_nullable = 'NO'
      and column_default like '%PRIMARY_MANAGER%'
  ) then
    raise exception 'Phase 4B verification failed: manager_review_route column/default is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.pa_employee_appraisals'::regclass
      and constraint_record.conname = 'pa_employee_appraisals_manager_review_route_check'
  ) then
    raise exception 'Phase 4B verification failed: manager review route constraint is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.pa_employee_appraisals'::regclass
      and trigger_record.tgname = 'bexhr_enforce_pa_manager_review_route'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4B verification failed: employee appraisal route trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.pa_manager_appraisals'::regclass
      and trigger_record.tgname = 'bexhr_enforce_pa_manager_appraisal_route'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4B verification failed: manager appraisal route trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.pa_hr_finalisations'::regclass
      and trigger_record.tgname = 'bexhr_enforce_pa_hr_finalisation_prerequisites'
      and trigger_record.tgisinternal is false
  ) then
    raise exception 'Phase 4B verification failed: HR finalisation prerequisite trigger is missing.';
  end if;

  v_resolver_oid := to_regprocedure(
    'bexhr_private.resolve_pa_manager_review_route(uuid,uuid)'
  );
  v_route_function_oid := to_regprocedure(
    'bexhr_private.enforce_pa_manager_review_route()'
  );
  v_manager_function_oid := to_regprocedure(
    'bexhr_private.enforce_pa_manager_appraisal_route()'
  );
  v_finalisation_function_oid := to_regprocedure(
    'bexhr_private.enforce_pa_hr_finalisation_prerequisites()'
  );

  if v_resolver_oid is null
     or v_route_function_oid is null
     or v_manager_function_oid is null
     or v_finalisation_function_oid is null then
    raise exception 'Phase 4B verification failed: one or more private route/guard functions are missing.';
  end if;

  if has_function_privilege('anon', v_resolver_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_resolver_oid, 'EXECUTE')
     or has_function_privilege('anon', v_route_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_route_function_oid, 'EXECUTE')
     or has_function_privilege('anon', v_manager_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_manager_function_oid, 'EXECUTE')
     or has_function_privilege('anon', v_finalisation_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_finalisation_function_oid, 'EXECUTE') then
    raise exception 'Phase 4B verification failed: private route/guard function execution is exposed.';
  end if;
end;
$phase4b_verify$;

commit;
