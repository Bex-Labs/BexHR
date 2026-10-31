-- BEXHR PA HIGHEST ACTIVE TIER PARTICIPATION
-- 2026-10-31
--
-- Business rule:
--   - The highest active occupied organization tier does not participate
--     in its own appraisal cycle.
--   - Rank comes from Organization Position Hierarchy, never creation order
--     and never hardcoded title names such as CEO / COO.
--   - A configured but vacant higher position does not prevent the next
--     occupied position below it from becoming the highest active PA tier.
--   - If there is no occupied whole-organization position, active HR Admin
--     employees are the fallback highest tier.
--   - All occupants of the resolved highest tier are excluded.
--   - The participation decision is snapshotted into the cycle payload.
--
-- Existing PA atomic activation, RLS and Phase 4B review-route triggers remain
-- authoritative for all employees who are included.

do $preflight$
begin
  if to_regclass('public.pa_cycles') is null then
    raise exception 'PA highest-tier migration stopped: pa_cycles is missing.';
  end if;

  if to_regclass('public.pa_employee_appraisals') is null then
    raise exception 'PA highest-tier migration stopped: pa_employee_appraisals is missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'PA highest-tier migration stopped: employees is missing.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'PA highest-tier migration stopped: profiles is missing.';
  end if;

  if to_regclass('public.organization_job_titles') is null then
    raise exception 'PA highest-tier migration stopped: organization_job_titles is missing.';
  end if;

  if to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'PA highest-tier migration stopped: organization_job_title_hierarchy is missing.';
  end if;

  if to_regprocedure('public.pa_activate_cycle(text)') is null then
    raise exception 'PA highest-tier migration stopped: pa_activate_cycle(text) is missing.';
  end if;

  if to_regprocedure('public.pa_current_user_is_hr_admin()') is null then
    raise exception 'PA highest-tier migration stopped: PA HR Admin guard is missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception 'PA highest-tier migration stopped: tenant resolver is missing.';
  end if;
end;
$preflight$;


create or replace function public.pa_activate_cycle(
  p_cycle_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_cycle public.pa_cycles%rowtype;
  v_template public.pa_templates%rowtype;

  v_template_id text;
  v_template_snapshot jsonb;

  v_active_employee_count integer := 0;
  v_employee_count integer := 0;
  v_appraisal_count integer := 0;
  v_excluded_count integer := 0;

  v_highest_position_count integer := 0;
  v_highest_position_ids uuid[] := '{}'::uuid[];
  v_highest_position_names text[] := '{}'::text[];

  v_highest_source text;
  v_unconfigured_position_names text[] := '{}'::text[];

  v_excluded_employee_ids uuid[] := '{}'::uuid[];
  v_participation_snapshot jsonb;

  v_activation_ms bigint :=
    floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to activate an appraisal cycle.';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have a tenant context.';
  end if;

  if not public.pa_current_user_is_hr_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only HR Admin can activate an appraisal cycle.';
  end if;

  if nullif(trim(coalesce(p_cycle_id, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'An appraisal cycle is required.';
  end if;


  -- Lock the Draft cycle before resolving its participation population.
  select cycle.*
  into v_cycle
  from public.pa_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'BEXHR_PA_CYCLE_NOT_FOUND: The appraisal cycle was not found in this company workspace.';
  end if;

  if lower(trim(coalesce(v_cycle.status, ''))) <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_CYCLE_NOT_DRAFT: Only a Draft appraisal cycle can be activated.';
  end if;

  if exists (
    select 1
    from public.pa_employee_appraisals appraisal
    where appraisal.tenant_id = v_tenant_id
      and appraisal.cycle_id = v_cycle.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_DRAFT_ASSIGNMENTS_EXIST: This Draft cycle already has appraisal assignments and requires review before activation.';
  end if;


  -- Resolve and validate the cycle template.
  v_template_id :=
    nullif(trim(coalesce(v_cycle.payload ->> 'templateId', '')), '');

  if v_template_id is null then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_MISSING: The appraisal cycle does not have a template.';
  end if;

  select template.*
  into v_template
  from public.pa_templates template
  where template.id = v_template_id
    and template.tenant_id = v_tenant_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_INVALID: The appraisal template was not found in this company workspace.';
  end if;

  if lower(trim(coalesce(v_template.status, ''))) <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_TEMPLATE_INACTIVE: The appraisal cycle requires an active template.';
  end if;

  v_template_snapshot := jsonb_build_object(
    'id', v_template.id,
    'name', coalesce(v_template.payload ->> 'name', ''),
    'description', coalesce(v_template.payload ->> 'description', ''),
    'ratingScale', coalesce(v_template.payload -> 'ratingScale', '[]'::jsonb),
    'competencies', coalesce(v_template.payload -> 'competencies', '[]'::jsonb)
  );


  -- Count the complete active workforce first.
  select count(*)
  into v_active_employee_count
  from public.employees employee
  where employee.tenant_id = v_tenant_id
    and lower(trim(coalesce(employee.status, 'active'))) = 'active';

  if v_active_employee_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_NO_ACTIVE_EMPLOYEES: The cycle cannot be activated because there are no active employees.';
  end if;


  -- -----------------------------------------------------------------------
  -- STRUCTURE COMPLETENESS GUARD.
  --
  -- Every occupied active whole-organization position must be represented
  -- in Organization Position Hierarchy before PA activation.
  --
  -- Do not silently ignore a company-wide position simply because HR
  -- forgot the second hierarchy-configuration step.
  -- -----------------------------------------------------------------------
  select coalesce(
    array_agg(
      distinct position.job_title
      order by position.job_title
    ),
    '{}'::text[]
  )
  into v_unconfigured_position_names
  from public.organization_job_titles position
  where position.department_id is null
    and lower(trim(coalesce(position.status, ''))) = 'active'
    and (
      position.tenant_id = v_tenant_id
      or position.tenant_id is null
    )
    and exists (
      select 1
      from public.employees employee
      where employee.tenant_id = v_tenant_id
        and lower(trim(coalesce(employee.status, 'active'))) = 'active'
        and nullif(trim(coalesce(employee.department, '')), '') is null
        and lower(trim(coalesce(employee.job_title, ''))) =
            lower(trim(coalesce(position.job_title, '')))
    )
    and not exists (
      select 1
      from public.organization_job_title_hierarchy hierarchy
      where hierarchy.tenant_id = v_tenant_id
        and hierarchy.job_title_id = position.id
    );

  if cardinality(v_unconfigured_position_names) > 0 then
    raise exception using
      errcode = '23514',
      message =
        'BEXHR_PA_UNCONFIGURED_WHOLE_ORG_POSITION: PA activation cannot continue because these occupied whole-organization positions are not configured in Organization Position Hierarchy: ' ||
        array_to_string(v_unconfigured_position_names, ', ') ||
        '. Complete Organization Position Hierarchy and try again.';
  end if;


  -- -----------------------------------------------------------------------
  -- RESOLVE THE HIGHEST ACTIVE OCCUPIED WHOLE-ORGANIZATION TIER.
  --
  -- This is hierarchy-driven:
  --   job_title_id -> reports_to_job_title_id
  --
  -- An occupied position is a candidate only when it has NO occupied
  -- ancestor anywhere above it. Vacant ancestors are therefore skipped.
  --
  -- Example:
  --   CEO configured but vacant
  --     ↓
  --   COO occupied
  --
  -- COO has no OCCUPIED ancestor, so COO is the highest active tier.
  -- -----------------------------------------------------------------------
  with recursive
  configured_positions as (
    select
      hierarchy.job_title_id,
      hierarchy.reports_to_job_title_id,
      position.job_title
    from public.organization_job_title_hierarchy hierarchy
    join public.organization_job_titles position
      on position.id = hierarchy.job_title_id
    where hierarchy.tenant_id = v_tenant_id
      and position.department_id is null
      and lower(trim(coalesce(position.status, ''))) = 'active'
      and (
        position.tenant_id = v_tenant_id
        or position.tenant_id is null
      )
  ),
  position_ancestors (
    descendant_job_title_id,
    ancestor_job_title_id
  ) as (
    select
      configured.job_title_id,
      configured.reports_to_job_title_id
    from configured_positions configured
    where configured.reports_to_job_title_id is not null

    union

    select
      ancestry.descendant_job_title_id,
      parent.reports_to_job_title_id
    from position_ancestors ancestry
    join configured_positions parent
      on parent.job_title_id = ancestry.ancestor_job_title_id
    where parent.reports_to_job_title_id is not null
  ),
  occupied_positions as (
    select distinct
      configured.job_title_id,
      configured.job_title
    from configured_positions configured
    where exists (
      select 1
      from public.employees employee
      where employee.tenant_id = v_tenant_id
        and lower(trim(coalesce(employee.status, 'active'))) = 'active'
        and nullif(trim(coalesce(employee.department, '')), '') is null
        and lower(trim(coalesce(employee.job_title, ''))) =
            lower(trim(coalesce(configured.job_title, '')))
    )
  ),
  highest_candidates as (
    select occupied.*
    from occupied_positions occupied
    where not exists (
      select 1
      from position_ancestors ancestry
      join occupied_positions occupied_ancestor
        on occupied_ancestor.job_title_id =
           ancestry.ancestor_job_title_id
      where ancestry.descendant_job_title_id =
            occupied.job_title_id
    )
  )
  select
    count(*)::integer,
    coalesce(
      array_agg(
        candidate.job_title_id
        order by candidate.job_title, candidate.job_title_id
      ),
      '{}'::uuid[]
    ),
    coalesce(
      array_agg(
        candidate.job_title
        order by candidate.job_title, candidate.job_title_id
      ),
      '{}'::text[]
    )
  into
    v_highest_position_count,
    v_highest_position_ids,
    v_highest_position_names
  from highest_candidates candidate;


  -- More than one highest ACTIVE position can be legitimate.
  --
  -- If their configured ancestors are vacant, all such occupied positions
  -- belong to the current highest active tier and are excluded together.
  --
  -- We do not force the tenant to invent a reporting relationship between
  -- parallel positions simply for PA purposes.


  if v_highest_position_count > 0 then
    v_highest_source := 'ORGANIZATION_POSITION';

    -- Exclude every active employee occupying any position in the resolved
    -- highest active tier.
    select coalesce(
      array_agg(employee.id order by employee.id),
      '{}'::uuid[]
    )
    into v_excluded_employee_ids
    from public.employees employee
    where employee.tenant_id = v_tenant_id
      and lower(trim(coalesce(employee.status, 'active'))) = 'active'
      and nullif(trim(coalesce(employee.department, '')), '') is null
      and exists (
        select 1
        from public.organization_job_titles position
        where position.id = any(v_highest_position_ids)
          and lower(trim(coalesce(position.job_title, ''))) =
              lower(trim(coalesce(employee.job_title, '')))
      );

  else
    -- No active whole-organization position is occupied.
    -- HR Admin becomes the highest applicable BexHR operating tier.
    v_highest_source := 'HR_ADMIN_FALLBACK';
    v_highest_position_ids := '{}'::uuid[];
    v_highest_position_names := array['HR Admin']::text[];

    select coalesce(
      array_agg(employee.id order by employee.id),
      '{}'::uuid[]
    )
    into v_excluded_employee_ids
    from public.employees employee
    join public.profiles profile
      on profile.id = employee.user_id
     and profile.tenant_id = employee.tenant_id
    where employee.tenant_id = v_tenant_id
      and lower(trim(coalesce(employee.status, 'active'))) = 'active'
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) = 'hr'
      and lower(trim(coalesce(profile.hr_access_level, 'standard'))) =
          'tenant_admin';

    if cardinality(v_excluded_employee_ids) = 0 then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PA_HIGHEST_TIER_UNRESOLVED: No occupied whole-organization position or active HR Admin employee could be resolved for this cycle.';
    end if;
  end if;


  v_excluded_count := cardinality(v_excluded_employee_ids);

  select count(*)
  into v_employee_count
  from public.employees employee
  where employee.tenant_id = v_tenant_id
    and lower(trim(coalesce(employee.status, 'active'))) = 'active'
    and not (
      employee.id = any(v_excluded_employee_ids)
    );

  if v_employee_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_NO_ELIGIBLE_EMPLOYEES: The highest active tier was resolved, but no employees remain below it for appraisal.';
  end if;


  -- Snapshot the participation decision so later hierarchy/occupancy changes
  -- cannot silently rewrite this already-active cycle.
  v_participation_snapshot := jsonb_build_object(
    'rule', 'EXCLUDE_HIGHEST_ACTIVE_TIER',
    'resolvedAt', now(),
    'source', v_highest_source,
    'highestPositionIds', to_jsonb(v_highest_position_ids),
    'highestPositionNames', to_jsonb(v_highest_position_names),
    'excludedEmployeeIds', to_jsonb(v_excluded_employee_ids),
    'excludedEmployeeCount', v_excluded_count,
    'activeEmployeeCount', v_active_employee_count,
    'eligibleEmployeeCount', v_employee_count
  );


  -- Create appraisal rows only for the snapshotted eligible population.
  -- Existing Phase 4B appraisal-route triggers remain responsible for
  -- manager_employee_id / manager-review route integrity.
  with eligible_employees as (
    select
      employee.id,
      coalesce(
        nullif(
          trim(
            concat_ws(
              ' ',
              nullif(trim(coalesce(employee.first_name, '')), ''),
              nullif(trim(coalesce(employee.middle_name, '')), ''),
              nullif(trim(coalesce(employee.last_name, '')), '')
            )
          ),
          ''
        ),
        nullif(trim(coalesce(employee.work_email, '')), ''),
        nullif(trim(coalesce(employee.employee_number, '')), ''),
        'Employee'
      ) as employee_name
    from public.employees employee
    where employee.tenant_id = v_tenant_id
      and lower(trim(coalesce(employee.status, 'active'))) = 'active'
      and not (
        employee.id = any(v_excluded_employee_ids)
      )
  ),
  prepared_appraisals as (
    select
      eligible.id as employee_id,
      eligible.employee_name,
      format(
        'BEX-PA-EMPLOYEE-APPRAISAL-%s-%s',
        v_activation_ms,
        eligible.id
      ) as appraisal_id
    from eligible_employees eligible
  )
  insert into public.pa_employee_appraisals (
    id,
    tenant_id,
    employee_id,
    manager_employee_id,
    cycle_id,
    status,
    payload
  )
  select
    prepared.appraisal_id,
    v_tenant_id,
    prepared.employee_id,
    null,
    v_cycle.id,
    'Draft',
    jsonb_build_object(
      'id', prepared.appraisal_id,
      'cycleId', v_cycle.id,
      'templateId', v_template.id,
      'templateSnapshot', v_template_snapshot,
      'employeeId', prepared.employee_id,
      'employeeName', prepared.employee_name,
      'status', 'Draft'
    )
  from prepared_appraisals prepared;

  get diagnostics v_appraisal_count = row_count;

  if v_appraisal_count <> v_employee_count then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_ASSIGNMENT_COUNT_MISMATCH: Cycle activation did not create exactly one appraisal for every eligible employee below the highest active tier.';
  end if;


  -- Activate the cycle and persist the immutable participation snapshot.
  update public.pa_cycles cycle
  set
    status = 'Active',
    payload = jsonb_set(
      jsonb_set(
        coalesce(cycle.payload, '{}'::jsonb),
        '{status}',
        to_jsonb('Active'::text),
        true
      ),
      '{participationSnapshot}',
      v_participation_snapshot,
      true
    ),
    updated_at = now()
  where cycle.id = v_cycle.id
    and cycle.tenant_id = v_tenant_id
    and lower(trim(coalesce(cycle.status, ''))) = 'draft';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'BEXHR_PA_ACTIVATION_RACE: The appraisal cycle changed while activation was in progress.';
  end if;


  return jsonb_build_object(
    'success', true,
    'cycle_id', v_cycle.id,
    'status', 'Active',
    'appraisal_count', v_appraisal_count,
    'active_employee_count', v_active_employee_count,
    'excluded_employee_count', v_excluded_count,
    'participation_snapshot', v_participation_snapshot
  );
end;
$function$;


comment on function public.pa_activate_cycle(text) is
'Atomically activates one same-tenant Draft PA cycle, resolves the highest active occupied organization tier from the configured position hierarchy, excludes that tier from PA participation, snapshots the decision, and creates one Draft appraisal for every eligible active employee below it. Falls back to active HR Admin employees when no whole-organization position is occupied.';


revoke all
on function public.pa_activate_cycle(text)
from public, anon;

grant execute
on function public.pa_activate_cycle(text)
to authenticated, service_role;


do $verify$
declare
  v_function_oid oid;
  v_definition text;
  v_security_definer boolean;
begin
  v_function_oid := to_regprocedure(
    'public.pa_activate_cycle(text)'
  );

  if v_function_oid is null then
    raise exception
      'PA highest-tier verification failed: pa_activate_cycle(text) is missing.';
  end if;

  select
    pg_get_functiondef(v_function_oid),
    procedure_record.prosecdef
  into
    v_definition,
    v_security_definer
  from pg_catalog.pg_proc procedure_record
  where procedure_record.oid = v_function_oid;

  if v_security_definer is true then
    raise exception
      'PA highest-tier verification failed: pa_activate_cycle must remain SECURITY INVOKER.';
  end if;

  if position(
    'participationSnapshot'
    in v_definition
  ) = 0 then
    raise exception
      'PA highest-tier verification failed: participation snapshot logic is missing.';
  end if;

  if position(
    'reports_to_job_title_id'
    in v_definition
  ) = 0 then
    raise exception
      'PA highest-tier verification failed: configured position hierarchy is not being used.';
  end if;

  if position(
    'BEXHR_PA_UNCONFIGURED_WHOLE_ORG_POSITION'
    in v_definition
  ) = 0 then
    raise exception
      'PA highest-tier verification failed: unconfigured occupied whole-organization positions are not guarded.';
  end if;

  if position(
    'highestPositionIds'
    in v_definition
  ) = 0 then
    raise exception
      'PA highest-tier verification failed: plural highest-tier snapshot is missing.';
  end if;

  if has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'PA highest-tier verification failed: anon can execute pa_activate_cycle.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception
      'PA highest-tier verification failed: authenticated lost pa_activate_cycle EXECUTE.';
  end if;
end;
$verify$;

