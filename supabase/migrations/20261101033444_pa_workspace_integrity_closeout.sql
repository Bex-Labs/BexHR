-- BexHR PA Workspace Integrity Closeout
--
-- This migration makes HR Standard a first-class read-only PA operational
-- persona without exposing confidential self/manager appraisal payloads.
-- It does not add HR Standard write authority.
-- It does not change HR Admin, Employee, Primary Manager, Secondary Manager,
-- reviewer-snapshot, or Governance Option A authority.

begin;
set local lock_timeout = '5s';


do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.employees') is null
     or to_regclass('public.pa_cycles') is null
     or to_regclass('public.pa_employee_appraisals') is null
     or to_regclass('public.pa_self_appraisals') is null
     or to_regclass('public.pa_manager_appraisals') is null
     or to_regclass('public.pa_hr_finalisations') is null
     or to_regclass('public.pa_employee_acknowledgements') is null
     or to_regclass('public.pa_individual_goals') is null
     or to_regclass('public.pa_progress_updates') is null then
    raise exception
      'PA workspace integrity closeout stopped: required PA/profile tables are missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null
     or to_regprocedure('public.pa_current_employee_id()') is null then
    raise exception
      'PA workspace integrity closeout stopped: canonical tenant/employee helpers are missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
  ) then
    raise exception
      'PA workspace integrity closeout stopped: profiles.hr_access_level is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pa_employee_appraisals'
      and column_name = 'manager_review_route'
  ) then
    raise exception
      'PA workspace integrity closeout stopped: manager review route snapshot is missing.';
  end if;
end;
$preflight$;


create schema if not exists bex_pa_private;
revoke all on schema bex_pa_private from public, anon;
grant usage on schema bex_pa_private to authenticated;


create or replace function bex_pa_private.current_user_is_hr_standard()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and coalesce(profile.is_active, false) is true
        and lower(trim(coalesce(profile.role, ''))) = 'hr'
        and lower(trim(coalesce(profile.hr_access_level, ''))) = 'standard'
        and profile.tenant_id =
            public.current_authenticated_profile_tenant_id()
    );
$function$;

comment on function bex_pa_private.current_user_is_hr_standard() is
'Internal PA authorization predicate. True only for an active same-tenant HR profile with canonical standard HR access.';

revoke all
on function bex_pa_private.current_user_is_hr_standard()
from public, anon, authenticated;


create or replace function bex_pa_private.current_hr_standard_can_read_active_pa_employee(
  p_employee_id uuid,
  p_cycle_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    bex_pa_private.current_user_is_hr_standard()
    and exists (
      select 1
      from public.pa_employee_appraisals appraisal
      join public.pa_cycles cycle
        on cycle.id = appraisal.cycle_id
       and cycle.tenant_id = appraisal.tenant_id
      where appraisal.tenant_id =
            public.current_authenticated_profile_tenant_id()
        and appraisal.employee_id = p_employee_id
        and appraisal.cycle_id = p_cycle_id
        and lower(trim(coalesce(cycle.status, ''))) = 'active'
    );
$function$;

comment on function bex_pa_private.current_hr_standard_can_read_active_pa_employee(uuid, text) is
'Internal PA policy helper. Allows Standard HR read-only goal/progress access only for same-tenant employees with an appraisal row in the Active cycle.';

revoke all
on function bex_pa_private.current_hr_standard_can_read_active_pa_employee(uuid, text)
from public, anon;
revoke all
on function bex_pa_private.current_hr_standard_can_read_active_pa_employee(uuid, text)
from authenticated;
grant execute
on function bex_pa_private.current_hr_standard_can_read_active_pa_employee(uuid, text)
to authenticated;


alter table public.pa_individual_goals enable row level security;
alter table public.pa_progress_updates enable row level security;


drop policy if exists
  "PA HR Standard reads active participant individual goals"
on public.pa_individual_goals;

create policy
  "PA HR Standard reads active participant individual goals"
on public.pa_individual_goals
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_hr_standard_can_read_active_pa_employee(
    employee_id,
    cycle_id
  )
);


drop policy if exists
  "PA HR Standard reads active participant progress"
on public.pa_progress_updates;

create policy
  "PA HR Standard reads active participant progress"
on public.pa_progress_updates
for select
to authenticated
using (
  tenant_id =
    public.current_authenticated_profile_tenant_id()
  and bex_pa_private.current_hr_standard_can_read_active_pa_employee(
    employee_id,
    cycle_id
  )
);


create or replace function bex_pa_private.hr_standard_operational_appraisal_snapshot()
returns table (
  appraisal_id text,
  employee_id uuid,
  cycle_id text,
  appraisal_status text,
  template_id text,
  manager_employee_id uuid,
  manager_review_route text,
  manager_review_route_reason text,
  self_appraisal_id text,
  self_status text,
  self_updated_at timestamptz,
  manager_appraisal_id text,
  manager_status text,
  manager_updated_at timestamptz,
  hr_finalisation_id text,
  hr_finalisation_status text,
  hr_finalisation_updated_at timestamptz,
  acknowledgement_id text,
  acknowledgement_status text,
  acknowledgement_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  if not bex_pa_private.current_user_is_hr_standard() then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_PA_HR_STANDARD_REQUIRED: Standard HR authority is required for this operational appraisal snapshot.';
  end if;

  v_tenant_id :=
    public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_PA_TENANT_REQUIRED: A canonical tenant is required for this operational appraisal snapshot.';
  end if;

  return query
  select
    appraisal.id,
    appraisal.employee_id,
    appraisal.cycle_id,
    appraisal.status,
    nullif(trim(appraisal.payload ->> 'templateId'), ''),
    appraisal.manager_employee_id,
    appraisal.manager_review_route,
    nullif(trim(appraisal.payload ->> 'managerReviewRouteReason'), ''),
    self_review.id,
    self_review.status,
    self_review.updated_at,
    manager_review.id,
    manager_review.status,
    manager_review.updated_at,
    hr_finalisation.id,
    hr_finalisation.status,
    hr_finalisation.updated_at,
    acknowledgement.id,
    acknowledgement.status,
    acknowledgement.updated_at
  from public.pa_employee_appraisals appraisal
  join public.employees employee
    on employee.id = appraisal.employee_id
   and employee.tenant_id = appraisal.tenant_id
  left join public.pa_self_appraisals self_review
    on self_review.appraisal_id = appraisal.id
   and self_review.tenant_id = appraisal.tenant_id
  left join public.pa_manager_appraisals manager_review
    on manager_review.appraisal_id = appraisal.id
   and manager_review.tenant_id = appraisal.tenant_id
  left join public.pa_hr_finalisations hr_finalisation
    on hr_finalisation.appraisal_id = appraisal.id
   and hr_finalisation.tenant_id = appraisal.tenant_id
  left join public.pa_employee_acknowledgements acknowledgement
    on acknowledgement.appraisal_id = appraisal.id
   and acknowledgement.tenant_id = appraisal.tenant_id
  where appraisal.tenant_id = v_tenant_id
    and lower(trim(coalesce(employee.status, 'active'))) = 'active'
  order by appraisal.created_at, appraisal.id;
end;
$function$;

comment on function bex_pa_private.hr_standard_operational_appraisal_snapshot() is
'Private data-minimized Standard HR PA snapshot. Strictly authorizes canonical same-tenant Standard HR and returns lifecycle facts only.';

revoke all
on function bex_pa_private.hr_standard_operational_appraisal_snapshot()
from public, anon, authenticated;
grant execute
on function bex_pa_private.hr_standard_operational_appraisal_snapshot()
to authenticated;


create or replace function public.pa_get_hr_standard_operational_appraisal_snapshot()
returns table (
  appraisal_id text,
  employee_id uuid,
  cycle_id text,
  appraisal_status text,
  template_id text,
  manager_employee_id uuid,
  manager_review_route text,
  manager_review_route_reason text,
  self_appraisal_id text,
  self_status text,
  self_updated_at timestamptz,
  manager_appraisal_id text,
  manager_status text,
  manager_updated_at timestamptz,
  hr_finalisation_id text,
  hr_finalisation_status text,
  hr_finalisation_updated_at timestamptz,
  acknowledgement_id text,
  acknowledgement_status text,
  acknowledgement_updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select *
  from bex_pa_private.hr_standard_operational_appraisal_snapshot();
$function$;

comment on function public.pa_get_hr_standard_operational_appraisal_snapshot() is
'Data-minimized Standard HR PA read API. Security-invoker wrapper over the private strictly-authorized snapshot helper; no appraisal body payloads are returned.';

revoke all
on function public.pa_get_hr_standard_operational_appraisal_snapshot()
from public, anon, authenticated;
grant execute
on function public.pa_get_hr_standard_operational_appraisal_snapshot()
to authenticated;

do $verify$
declare
  v_policy_count integer;
  v_rpc_oid oid;
  v_private_rpc_oid oid;
  v_rpc_result text;
begin
  if to_regprocedure(
    'bex_pa_private.current_user_is_hr_standard()'
  ) is null then
    raise exception
      'PA workspace integrity verification failed: Standard HR authorization helper is missing.';
  end if;

  if to_regprocedure(
    'bex_pa_private.current_hr_standard_can_read_active_pa_employee(uuid,text)'
  ) is null then
    raise exception
      'PA workspace integrity verification failed: active participant read helper is missing.';
  end if;

  select count(*)
  into v_policy_count
  from pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.policyname in (
      'PA HR Standard reads active participant individual goals',
      'PA HR Standard reads active participant progress'
    );

  if v_policy_count <> 2 then
    raise exception
      'PA workspace integrity verification failed: expected two Standard HR read-only policies, found %.',
      v_policy_count;
  end if;

  select procedure_record.oid
  into v_rpc_oid
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
        'pa_get_hr_standard_operational_appraisal_snapshot'
    and pg_get_function_identity_arguments(procedure_record.oid) = '';

  if v_rpc_oid is null then
    raise exception
      'PA workspace integrity verification failed: Standard HR operational snapshot RPC is missing.';
  end if;

  if exists (
    select 1
    from pg_proc public_rpc
    where public_rpc.oid = v_rpc_oid
      and public_rpc.prosecdef is true
  ) then
    raise exception
      'PA workspace integrity verification failed: public Standard HR snapshot RPC must remain SECURITY INVOKER.';
  end if;

  select procedure_record.oid
  into v_private_rpc_oid
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'bex_pa_private'
    and procedure_record.proname =
        'hr_standard_operational_appraisal_snapshot'
    and pg_get_function_identity_arguments(procedure_record.oid) = '';

  if v_private_rpc_oid is null then
    raise exception
      'PA workspace integrity verification failed: private Standard HR snapshot helper is missing.';
  end if;

  if not exists (
    select 1
    from pg_proc private_rpc
    where private_rpc.oid = v_private_rpc_oid
      and private_rpc.prosecdef is true
  ) then
    raise exception
      'PA workspace integrity verification failed: private Standard HR snapshot helper must remain SECURITY DEFINER.';
  end if;

  select pg_get_function_result(v_rpc_oid)
  into v_rpc_result;

  if lower(coalesce(v_rpc_result, '')) like '%payload%'
     or lower(coalesce(v_rpc_result, '')) like '%comment%'
     or lower(coalesce(v_rpc_result, '')) like '%response%'
     or lower(coalesce(v_rpc_result, '')) like '%rating%' then
    raise exception
      'PA workspace integrity verification failed: operational snapshot RPC exposes appraisal body fields.';
  end if;

  if has_function_privilege(
       'anon',
       'public.pa_get_hr_standard_operational_appraisal_snapshot()',
       'EXECUTE'
     ) then
    raise exception
      'PA workspace integrity verification failed: anonymous users can execute the Standard HR snapshot RPC.';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.pa_get_hr_standard_operational_appraisal_snapshot()',
       'EXECUTE'
     ) then
    raise exception
      'PA workspace integrity verification failed: authenticated Standard HR cannot execute the snapshot RPC.';
  end if;
end;
$verify$;

commit;
