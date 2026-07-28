-- BexHR Secondary Manager Pending Leave Visibility - Step 1
--
-- Business rule:
--   1. Primary and Secondary Managers may view Pending Approval requests for
--      employees on their active reporting line in the same tenant.
--   2. Secondary Managers remain view-only.
--   3. The existing leave-decision RPC remains Primary-Manager-only.
--   4. Delegated approval is not introduced by this migration.

begin;

do $secondary_manager_pending_leave_preflight$
declare
  v_rls_enabled boolean;
  v_decision_definition text;
begin
  if to_regclass('public.leave_requests') is null then
    raise exception
      'Secondary-manager pending leave visibility stopped: public.leave_requests does not exist.';
  end if;

  if to_regclass('public.employee_reporting_lines') is null then
    raise exception
      'Secondary-manager pending leave visibility stopped: public.employee_reporting_lines does not exist.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'Secondary-manager pending leave visibility stopped: public.employees does not exist.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception
      'Secondary-manager pending leave visibility stopped: public.profiles does not exist.';
  end if;

  select class.relrowsecurity
  into v_rls_enabled
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace
    on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'leave_requests';

  if coalesce(v_rls_enabled, false) is not true then
    raise exception
      'Secondary-manager pending leave visibility stopped: RLS is not enabled on public.leave_requests.';
  end if;

  if to_regprocedure(
    'public.hrp_apply_leave_decision_once(uuid,text,text)'
  ) is null then
    raise exception
      'Secondary-manager pending leave visibility stopped: the protected leave-decision RPC was not found.';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into v_decision_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'hrp_apply_leave_decision_once'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
        'p_leave_request_id uuid, p_decision_status text, p_decision_comment text';

  if position(
    'hrp_is_current_user_primary_manager_for_leave_employee'
    in coalesce(v_decision_definition, '')
  ) = 0 then
    raise exception
      'Secondary-manager pending leave visibility stopped: the decision RPC no longer contains the Primary Manager authority guard.';
  end if;
end;
$secondary_manager_pending_leave_preflight$;

create or replace function
  public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(
    p_leave_employee_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with signed_in_profile as (
    select
      profile.id as profile_id,
      profile.email as profile_email,
      profile.tenant_id
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and profile.tenant_id is not null
    limit 1
  ),
  signed_in_manager_employee as (
    select
      employee.id as manager_employee_id,
      employee.tenant_id
    from public.employees employee
    join signed_in_profile profile
      on employee.tenant_id = profile.tenant_id
     and (
       employee.user_id = profile.profile_id
       or (
         profile.profile_email is not null
         and lower(coalesce(employee.work_email, '')) =
             lower(profile.profile_email)
       )
     )
    where lower(trim(coalesce(employee.status, 'active'))) = 'active'
    order by
      case
        when employee.user_id = profile.profile_id then 0
        else 1
      end,
      employee.created_at desc nulls last
    limit 1
  ),
  target_leave_employee as (
    select
      employee.id as employee_id,
      employee.tenant_id
    from public.employees employee
    left join public.profiles leave_profile
      on leave_profile.id = p_leave_employee_id
    where
      employee.id = p_leave_employee_id
      or employee.user_id = p_leave_employee_id
      or (
        leave_profile.email is not null
        and lower(coalesce(employee.work_email, '')) =
            lower(leave_profile.email)
      )
    order by
      case
        when employee.id = p_leave_employee_id then 0
        when employee.user_id = p_leave_employee_id then 1
        else 2
      end,
      employee.created_at desc nulls last
    limit 1
  )
  select exists (
    select 1
    from signed_in_manager_employee manager
    join target_leave_employee target
      on target.tenant_id = manager.tenant_id
    join public.employee_reporting_lines reporting_line
      on reporting_line.employee_id = target.employee_id
     and reporting_line.manager_employee_id =
         manager.manager_employee_id
    where lower(trim(coalesce(reporting_line.status, 'active'))) =
          'active'
      and lower(trim(coalesce(reporting_line.manager_type, ''))) in (
        'primary',
        'secondary'
      )
      and (
        reporting_line.tenant_id is null
        or reporting_line.tenant_id = manager.tenant_id
      )
  );
$function$;

comment on function
  public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(
    uuid
  )
is
'Returns true only when the authenticated active profile resolves to an active employee who is the Primary or Secondary Manager on an active same-tenant reporting line for the leave-request employee. This function grants pending-request visibility only; it grants no decision authority.';

revoke all
on function
  public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(
    uuid
  )
from public, anon;

grant execute
on function
  public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(
    uuid
  )
to authenticated;

drop policy if exists
  manager_supervisor_select_reporting_line_pending_leave_requests
on public.leave_requests;

create policy
  manager_supervisor_select_reporting_line_pending_leave_requests
on public.leave_requests
for select
to authenticated
using (
  lower(trim(coalesce(status, ''))) = 'pending approval'
  and
  public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(
    employee_id
  )
);

do $secondary_manager_pending_leave_verify$
declare
  v_policy_count integer;
  v_decision_definition text;
begin
  -- Verify the policy identity and SELECT command directly in pg_policy.
  -- The policy expression itself is static migration source and is verified
  -- separately after commit because PostgreSQL can normalise its deparsed form.
  select count(*)
  into v_policy_count
  from pg_catalog.pg_policy policy
  join pg_catalog.pg_class relation
    on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'leave_requests'
    and policy.polname =
        'manager_supervisor_select_reporting_line_pending_leave_requests'
    and policy.polcmd = 'r';

  if to_regprocedure(
    'public.hrp_is_current_user_active_reporting_manager_for_pending_leave_employee(uuid)'
  ) is null then
    raise exception
      'Secondary-manager pending leave visibility verification failed: helper function was not created.';
  end if;

  if v_policy_count <> 1 then
    raise exception
      'Secondary-manager pending leave visibility verification failed: expected SELECT policy was not found exactly once.';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into v_decision_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'hrp_apply_leave_decision_once'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
        'p_leave_request_id uuid, p_decision_status text, p_decision_comment text';

  if position(
    'hrp_is_current_user_primary_manager_for_leave_employee'
    in coalesce(v_decision_definition, '')
  ) = 0 then
    raise exception
      'Secondary-manager pending leave visibility verification failed: Primary Manager decision authority changed unexpectedly.';
  end if;
end;
$secondary_manager_pending_leave_verify$;

commit;