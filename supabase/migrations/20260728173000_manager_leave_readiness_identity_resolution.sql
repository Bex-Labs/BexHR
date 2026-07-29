-- BexHR Manager Leave Readiness Identity Resolution - v1.0.0
--
-- System behaviour:
--   1. Resolve leave_requests.employee_id whether it stores employees.id,
--      employees.user_id, or a profile ID linked by same-tenant work email.
--   2. Return only readiness fields for employees on the signed-in manager's
--      active Primary or Secondary reporting lines in the same tenant.
--   3. Keep Secondary Managers view-only. This RPC grants no decision rights.
--   4. Preserve the existing Primary-Manager-only decision RPC unchanged.
--   5. Read existing employee_leave_balances only. Do not recalculate or alter
--      Alpatech or any other tenant's entitlement rules.

begin;

do $manager_leave_readiness_preflight$
declare
  v_decision_definition text;
begin
  if to_regclass('public.leave_requests') is null then
    raise exception
      'Manager leave readiness stopped: public.leave_requests does not exist.';
  end if;

  if to_regclass('public.employee_leave_balances') is null then
    raise exception
      'Manager leave readiness stopped: public.employee_leave_balances does not exist.';
  end if;

  if to_regclass('public.employee_reporting_lines') is null then
    raise exception
      'Manager leave readiness stopped: public.employee_reporting_lines does not exist.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'Manager leave readiness stopped: public.employees does not exist.';
  end if;

  if to_regclass('public.leave_types') is null then
    raise exception
      'Manager leave readiness stopped: public.leave_types does not exist.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception
      'Manager leave readiness stopped: public.profiles does not exist.';
  end if;

  if to_regprocedure(
    'public.hrp_apply_leave_decision_once(uuid,text,text)'
  ) is null then
    raise exception
      'Manager leave readiness stopped: the protected leave-decision RPC was not found.';
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
      'Manager leave readiness stopped: the decision RPC no longer contains the Primary Manager authority guard.';
  end if;
end;
$manager_leave_readiness_preflight$;

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
  remaining_days numeric
)
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
  signed_in_manager as (
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
  visible_readiness as (
    select
      leave_request.id as request_id,
      target_employee.id as canonical_employee_id,
      reporting_line.manager_type::text as manager_type,
      target_employee.gender::text as employee_gender,
      leave_request.leave_type_id,
      coalesce(leave_type.eligibility_rule::text, 'all_employees') as eligibility_rule,
      (balance.id is not null) as has_balance,
      balance.entitled_days::numeric as entitled_days,
      balance.used_days::numeric as used_days,
      balance.remaining_days::numeric as remaining_days,
      case
        when lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary' then 0
        when lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'secondary' then 1
        else 2
      end as relationship_rank,
      reporting_line.effective_date
    from signed_in_manager manager
    join public.leave_requests leave_request
      on true
    join lateral (
      select employee.*
      from public.employees employee
      left join public.profiles leave_profile
        on leave_profile.id = leave_request.employee_id
       and leave_profile.tenant_id = manager.tenant_id
      where employee.tenant_id = manager.tenant_id
        and (
          employee.id = leave_request.employee_id
          or employee.user_id = leave_request.employee_id
          or (
            leave_profile.email is not null
            and lower(coalesce(employee.work_email, '')) =
                lower(leave_profile.email)
          )
        )
      order by
        case
          when employee.id = leave_request.employee_id then 0
          when employee.user_id = leave_request.employee_id then 1
          else 2
        end,
        employee.created_at desc nulls last
      limit 1
    ) target_employee
      on true
    join public.employee_reporting_lines reporting_line
      on reporting_line.employee_id = target_employee.id
     and reporting_line.manager_employee_id = manager.manager_employee_id
    join public.leave_types leave_type
      on leave_type.id = leave_request.leave_type_id
    left join public.employee_leave_balances balance
      on balance.employee_id = target_employee.id
     and balance.leave_type_id = leave_request.leave_type_id
    where lower(trim(coalesce(reporting_line.status, 'active'))) = 'active'
      and lower(trim(coalesce(reporting_line.manager_type::text, ''))) in (
        'primary',
        'secondary'
      )
      and (
        reporting_line.tenant_id is null
        or reporting_line.tenant_id = manager.tenant_id
      )
  )
  select distinct on (visible_readiness.request_id)
    visible_readiness.request_id,
    visible_readiness.canonical_employee_id,
    visible_readiness.manager_type,
    visible_readiness.employee_gender,
    visible_readiness.leave_type_id,
    visible_readiness.eligibility_rule,
    visible_readiness.has_balance,
    visible_readiness.entitled_days,
    visible_readiness.used_days,
    visible_readiness.remaining_days
  from visible_readiness
  order by
    visible_readiness.request_id,
    visible_readiness.relationship_rank,
    visible_readiness.effective_date desc nulls last;
$function$;

comment on function public.get_manager_leave_readiness()
is
'Returns minimum same-tenant leave-readiness data only for employees on the authenticated manager''s active Primary or Secondary reporting lines. It resolves legacy leave-request identities to canonical employees.id, reads existing balances without changing tenant entitlement rules, and grants no decision authority.';

revoke all
on function public.get_manager_leave_readiness()
from public, anon;

grant execute
on function public.get_manager_leave_readiness()
to authenticated;

commit;
