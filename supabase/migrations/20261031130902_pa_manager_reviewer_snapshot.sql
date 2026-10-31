-- BEXHR PA MANAGER REVIEWER SNAPSHOT
-- 2026-10-31
--
-- Fixes Phase 4B omission:
-- resolve_pa_manager_review_route() already returns primaryManagerEmployeeId,
-- but enforce_pa_manager_review_route() previously snapshotted only route/reason.
--
-- New behaviour:
--   PRIMARY_MANAGER
--     -> manager_employee_id is snapshotted
--     -> payload.managerEmployeeId is snapshotted
--     -> reviewer cannot later be changed for that appraisal
--
--   TOP_LEVEL / CONFIGURATION_ERROR
--     -> manager_employee_id remains null
--
-- Existing historical cycles are not broadly rewritten.
-- Backfill is limited to cycles created under
-- EXCLUDE_HIGHEST_ACTIVE_TIER participation logic.

do $preflight$
begin
  if to_regclass('public.pa_employee_appraisals') is null then
    raise exception
      'PA reviewer snapshot migration stopped: pa_employee_appraisals is missing.';
  end if;

  if to_regclass('public.pa_cycles') is null then
    raise exception
      'PA reviewer snapshot migration stopped: pa_cycles is missing.';
  end if;

  if to_regprocedure(
    'bexhr_private.resolve_pa_manager_review_route(uuid,uuid)'
  ) is null then
    raise exception
      'PA reviewer snapshot migration stopped: route resolver is missing.';
  end if;

  if to_regprocedure(
    'bexhr_private.enforce_pa_manager_review_route()'
  ) is null then
    raise exception
      'PA reviewer snapshot migration stopped: route trigger function is missing.';
  end if;
end;
$preflight$;


-- ---------------------------------------------------------------------------
-- BACKFILL ONLY NEW PARTICIPATION-SNAPSHOT CYCLES.
--
-- Do this while the previous Phase 4B trigger is still installed because that
-- trigger permits PRIMARY_MANAGER rows with null manager_employee_id to receive
-- their missing reviewer.
--
-- Historical cycles created before the new participation model are untouched.
-- ---------------------------------------------------------------------------

with resolved as (
  select
    appraisal.id,
    appraisal.tenant_id,
    appraisal.employee_id,
    bexhr_private.resolve_pa_manager_review_route(
      appraisal.employee_id,
      appraisal.tenant_id
    ) as resolution
  from public.pa_employee_appraisals appraisal
  join public.pa_cycles cycle
    on cycle.id = appraisal.cycle_id
   and cycle.tenant_id = appraisal.tenant_id
  where appraisal.manager_review_route = 'PRIMARY_MANAGER'
    and appraisal.manager_employee_id is null
    and (
      cycle.payload
        -> 'participationSnapshot'
        ->> 'rule'
    ) = 'EXCLUDE_HIGHEST_ACTIVE_TIER'
),
repairable as (
  select
    resolved.id,
    nullif(
      trim(
        coalesce(
          resolved.resolution ->> 'primaryManagerEmployeeId',
          ''
        )
      ),
      ''
    )::uuid as manager_employee_id
  from resolved
  where resolved.resolution ->> 'route' = 'PRIMARY_MANAGER'
)
update public.pa_employee_appraisals appraisal
set
  manager_employee_id = repairable.manager_employee_id,
  payload = jsonb_set(
    coalesce(appraisal.payload, '{}'::jsonb),
    '{managerEmployeeId}',
    to_jsonb(repairable.manager_employee_id::text),
    true
  )
from repairable
where appraisal.id = repairable.id
  and repairable.manager_employee_id is not null;


-- ---------------------------------------------------------------------------
-- ROUTE + REVIEWER SNAPSHOT ENFORCEMENT.
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
  v_manager_employee_id uuid;
begin
  -- -------------------------------------------------------------------------
  -- UPDATE:
  -- Once an appraisal exists, both the review route and reviewer snapshot are
  -- immutable. Reporting-line changes affect future cycles, not this one.
  -- -------------------------------------------------------------------------
  if tg_op = 'UPDATE' then

    if new.manager_review_route
       is distinct from old.manager_review_route then
      raise exception using
        errcode = '23514',
        message =
          'BEXHR_PA_REVIEW_ROUTE_LOCK: The appraisal manager-review route is snapshotted and cannot be changed.';
    end if;

    if new.manager_employee_id
       is distinct from old.manager_employee_id then
      raise exception using
        errcode = '23514',
        message =
          'BEXHR_PA_REVIEWER_LOCK: The appraisal manager reviewer is snapshotted and cannot be changed.';
    end if;

    new.manager_review_route :=
      old.manager_review_route;

    new.manager_employee_id :=
      old.manager_employee_id;

    new.payload := jsonb_set(
      coalesce(new.payload, '{}'::jsonb),
      '{managerReviewRoute}',
      to_jsonb(old.manager_review_route),
      true
    );

    if old.manager_employee_id is not null then
      new.payload := jsonb_set(
        new.payload,
        '{managerEmployeeId}',
        to_jsonb(old.manager_employee_id::text),
        true
      );
    else
      new.payload :=
        new.payload - 'managerEmployeeId';
    end if;

    if coalesce(old.payload, '{}'::jsonb)
       ? 'managerReviewRouteReason' then

      new.payload := jsonb_set(
        new.payload,
        '{managerReviewRouteReason}',
        old.payload -> 'managerReviewRouteReason',
        true
      );

    else
      new.payload :=
        new.payload - 'managerReviewRouteReason';
    end if;

    return new;
  end if;


  -- -------------------------------------------------------------------------
  -- INSERT:
  -- Resolve and snapshot both the review route and actual reviewer.
  -- -------------------------------------------------------------------------

  v_resolution :=
    bexhr_private.resolve_pa_manager_review_route(
      new.employee_id,
      new.tenant_id
    );

  v_route :=
    nullif(
      trim(
        coalesce(
          v_resolution ->> 'route',
          ''
        )
      ),
      ''
    );

  v_reason :=
    nullif(
      trim(
        coalesce(
          v_resolution ->> 'reason',
          ''
        )
      ),
      ''
    );

  if v_route not in (
    'PRIMARY_MANAGER',
    'TOP_LEVEL',
    'CONFIGURATION_ERROR'
  ) then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_REVIEW_ROUTE_INVALID: PA could not resolve a valid manager-review route.';
  end if;


  new.manager_review_route :=
    v_route;


  if v_route = 'PRIMARY_MANAGER' then

    v_manager_employee_id :=
      nullif(
        trim(
          coalesce(
            v_resolution ->> 'primaryManagerEmployeeId',
            ''
          )
        ),
        ''
      )::uuid;

    if v_manager_employee_id is null then
      raise exception using
        errcode = '23514',
        message =
          'BEXHR_PA_PRIMARY_MANAGER_SNAPSHOT_MISSING: PA resolved a PRIMARY_MANAGER review route but could not resolve the reviewer employee.';
    end if;

    new.manager_employee_id :=
      v_manager_employee_id;

  else

    new.manager_employee_id :=
      null;

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
    to_jsonb(
      coalesce(
        v_reason,
        'UNRESOLVED'
      )
    ),
    true
  );


  if new.manager_employee_id is not null then

    new.payload := jsonb_set(
      new.payload,
      '{managerEmployeeId}',
      to_jsonb(new.manager_employee_id::text),
      true
    );

  else

    new.payload :=
      new.payload - 'managerEmployeeId';

  end if;


  return new;
end;
$function$;


revoke all
on function bexhr_private.enforce_pa_manager_review_route()
from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- INSTALL-TIME VERIFICATION.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_function_oid oid;
  v_definition text;
  v_security_definer boolean;
begin
  v_function_oid :=
    to_regprocedure(
      'bexhr_private.enforce_pa_manager_review_route()'
    );

  if v_function_oid is null then
    raise exception
      'PA reviewer snapshot verification failed: trigger function is missing.';
  end if;


  select
    pg_get_functiondef(v_function_oid),
    procedure_record.prosecdef
  into
    v_definition,
    v_security_definer
  from pg_catalog.pg_proc procedure_record
  where procedure_record.oid = v_function_oid;


  if v_security_definer is not true then
    raise exception
      'PA reviewer snapshot verification failed: trigger function security mode changed unexpectedly.';
  end if;


  if position(
    'primaryManagerEmployeeId'
    in v_definition
  ) = 0 then
    raise exception
      'PA reviewer snapshot verification failed: resolver reviewer ID is not being consumed.';
  end if;


  if position(
    'BEXHR_PA_REVIEWER_LOCK'
    in v_definition
  ) = 0 then
    raise exception
      'PA reviewer snapshot verification failed: reviewer immutability is missing.';
  end if;


  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    join public.pa_cycles cycle
      on cycle.id = appraisal.cycle_id
     and cycle.tenant_id = appraisal.tenant_id
    where appraisal.manager_review_route = 'PRIMARY_MANAGER'
      and appraisal.manager_employee_id is null
      and (
        cycle.payload
          -> 'participationSnapshot'
          ->> 'rule'
      ) = 'EXCLUDE_HIGHEST_ACTIVE_TIER'
  ) then
    raise exception
      'PA reviewer snapshot verification failed: a new participation-snapshot cycle still has a PRIMARY_MANAGER appraisal without a reviewer.';
  end if;


  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    join public.pa_cycles cycle
      on cycle.id = appraisal.cycle_id
     and cycle.tenant_id = appraisal.tenant_id
    where appraisal.manager_review_route = 'PRIMARY_MANAGER'
      and appraisal.manager_employee_id is not null
      and (
        cycle.payload
          -> 'participationSnapshot'
          ->> 'rule'
      ) = 'EXCLUDE_HIGHEST_ACTIVE_TIER'
      and (
        appraisal.payload ->> 'managerEmployeeId'
      ) is distinct from
        appraisal.manager_employee_id::text
  ) then
    raise exception
      'PA reviewer snapshot verification failed: relational and payload reviewer snapshots do not match.';
  end if;
end;
$verify$;