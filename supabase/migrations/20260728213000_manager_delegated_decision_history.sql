begin;

create or replace function public.get_manager_leave_decision_authority_history()
returns table (
  leave_request_id uuid,
  authority_type text,
  delegation_id uuid,
  actor_manager_name text,
  primary_manager_name text,
  decision_status text,
  decision_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with current_manager as (
    select manager_employee_id, tenant_id
    from public.hrp_current_manager_employee()
    limit 1
  ),
  visible_audit as (
    select audit.*
    from public.manager_leave_decision_authority_audit audit
    join current_manager current
      on current.tenant_id = audit.tenant_id
    where exists (
      select 1
      from public.employee_reporting_lines line
      where line.employee_id = audit.target_employee_id
        and line.manager_employee_id = current.manager_employee_id
        and lower(trim(coalesce(line.status, 'active'))) = 'active'
        and (line.tenant_id is null or line.tenant_id = current.tenant_id)
    )
  )
  select
    audit.leave_request_id,
    audit.authority_type,
    audit.delegation_id,
    coalesce(
      nullif(trim(concat_ws(' ', actor.first_name, actor.middle_name, actor.last_name)), ''),
      actor.work_email,
      'Decision manager'
    ) as actor_manager_name,
    coalesce(
      nullif(trim(concat_ws(' ', primary_manager.first_name, primary_manager.middle_name, primary_manager.last_name)), ''),
      primary_manager.work_email,
      'Primary Manager'
    ) as primary_manager_name,
    audit.decision_status,
    audit.decision_at
  from visible_audit audit
  join public.employees actor
    on actor.id = audit.actor_manager_employee_id
   and actor.tenant_id = audit.tenant_id
  join public.employees primary_manager
    on primary_manager.id = audit.primary_manager_employee_id
   and primary_manager.tenant_id = audit.tenant_id
  order by audit.decision_at desc;
$function$;

revoke all
on function public.get_manager_leave_decision_authority_history()
from public, anon;

grant execute
on function public.get_manager_leave_decision_authority_history()
to authenticated;

comment on function public.get_manager_leave_decision_authority_history() is
'Tenant-scoped processed leave authority history for employees in the signed-in manager reporting lines. Exposes whether the decision was direct or delegated, the acting manager, and the Primary Manager who granted authority.';

commit;
