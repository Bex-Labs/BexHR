-- BexHR HR Tenant Admin - Phase 1C
-- Harden the existing HR employee role-routing RPC
--
-- Purpose:
--   Preserve the current delegated HR role-management workflow while enforcing
--   its self-role, peer-HR and tenant protections inside PostgreSQL.
--
-- This migration:
--   1. Keeps public.hr_sync_employee_manager_role(uuid, text).
--   2. Preserves the existing business-role -> dashboard-route mapping.
--   3. Preserves HR assignment by authorised HR users.
--   4. Prevents HR users from changing their own role through direct RPC calls.
--   5. Prevents HR users from demoting an existing HR employee.
--   6. Prevents HR users from modifying a Platform Admin profile.
--   7. Keeps same-role/no-op synchronisation available so HR biodata edits work.
--   8. Removes anonymous execution while retaining authenticated/service-role use.
--
-- Explicitly NOT included:
--   - no hr_access_level column
--   - no profile table privilege changes
--   - no RLS policy changes
--   - no UI changes
--   - no employee/profile data repair
--   - no payroll, leave, pension, salary or reporting-line changes

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.hr_sync_employee_manager_role(
  input_employee_id uuid,
  input_role text
)
returns table(
  success boolean,
  employee_id uuid,
  employee_system_role text,
  profile_id uuid,
  profile_role text,
  profile_found boolean,
  profile_updated boolean,
  message text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested_role_raw text := trim(coalesce(input_role, ''));
  v_role_key text;
  v_employee_system_role text;
  v_dashboard_role text;
  v_dashboard_label text;

  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_tenant_id uuid;
  v_caller_email text;
  v_is_platform_admin boolean := false;

  v_employee public.employees%rowtype;
  v_profile public.profiles%rowtype;

  v_saved_employee_role_key text;
  v_saved_profile_role_key text;
  v_target_is_caller boolean := false;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated.'
      using errcode = '42501';
  end if;

  select
    lower(coalesce(profile.role, '')),
    profile.tenant_id,
    lower(trim(coalesce(profile.email, '')))
  into
    v_caller_role,
    v_caller_tenant_id,
    v_caller_email
  from public.profiles profile
  where profile.id = v_caller_id
    and profile.is_active = true
  for share;

  if coalesce(v_caller_role, '') = '' then
    raise exception 'Active caller profile was not found.'
      using errcode = '42501';
  end if;

  v_is_platform_admin :=
    v_caller_role in ('admin', 'system_admin');

  if not (
    v_is_platform_admin
    or v_caller_role in ('hr', 'hr_manager')
  ) then
    raise exception
      'Only authorised HR/Admin users can update employee dashboard roles.'
      using errcode = '42501';
  end if;

  if v_requested_role_raw = '' then
    v_requested_role_raw := 'employee';
  end if;

  v_role_key := lower(
    regexp_replace(
      v_requested_role_raw,
      '[\s\-]+',
      '_',
      'g'
    )
  );

  if length(v_requested_role_raw) > 80 then
    raise exception 'System role is too long.'
      using errcode = '22001';
  end if;

  /*
    Business role -> dashboard route map.

    profiles.role remains one of the dashboards currently supported by
    login/session routing:
      employee, manager, hr, admin

    employees.system_role retains the HR/business role selected in the form.
  */
  v_dashboard_role := case
    when v_role_key in ('employee') then 'employee'

    when v_role_key in (
      'manager',
      'supervisor',
      'leadership',
      'executive'
    ) then 'manager'

    when v_role_key in (
      'hr',
      'hr_manager',
      'payroll',
      'payroll_manager',
      'auditor',
      'qa_analyst'
    ) then 'hr'

    when v_role_key in (
      'admin',
      'system_admin'
    ) then 'admin'

    else 'employee'
  end;

  v_dashboard_label := case v_dashboard_role
    when 'employee' then 'Employee Dashboard'
    when 'manager' then 'Manager Dashboard'
    when 'hr' then 'HR Dashboard'
    when 'admin' then 'Admin Dashboard'
    else 'Employee Dashboard'
  end;

  /*
    Platform Admin access is global. HR cannot grant it from the employee form
    or by directly invoking this RPC.
  */
  if v_dashboard_role = 'admin'
     and not v_is_platform_admin
  then
    raise exception
      'Only a platform admin can assign Admin dashboard access.'
      using errcode = '42501';
  end if;

  /*
    Store standard roles in normalised form. Preserve unknown/custom business
    role text while routing it safely to Employee Dashboard, matching the
    existing implementation.
  */
  v_employee_system_role := case
    when v_role_key in (
      'employee',
      'manager',
      'supervisor',
      'hr',
      'hr_manager',
      'payroll',
      'payroll_manager',
      'leadership',
      'executive',
      'system_admin',
      'admin',
      'auditor',
      'qa_analyst'
    ) then v_role_key
    else v_requested_role_raw
  end;

  /*
    Lock the exact target employee for the duration of this transaction.
  */
  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = input_employee_id
  for update;

  if not found then
    raise exception 'Employee record was not found.'
      using errcode = 'P0002';
  end if;

  /*
    Tenant boundary: non-platform Admin callers can operate only inside their
    own tenant.
  */
  if not v_is_platform_admin then
    if v_caller_tenant_id is null then
      raise exception 'Caller tenant context was not found.'
        using errcode = '42501';
    end if;

    if v_employee.tenant_id
       is distinct from
       v_caller_tenant_id
    then
      raise exception 'Employee is outside your tenant scope.'
        using errcode = '42501';
    end if;
  end if;

  /*
    Resolve and lock the linked login profile. Prefer employees.user_id, then
    fall back to the tenant-matched work email exactly as before.
  */
  select profile.*
  into v_profile
  from public.profiles profile
  where (
    (
      v_employee.user_id is not null
      and profile.id = v_employee.user_id
    )
    or (
      coalesce(v_employee.work_email, '') <> ''
      and lower(profile.email) =
          lower(v_employee.work_email)
    )
  )
  and (
    v_is_platform_admin
    or profile.tenant_id
       is not distinct from
       v_employee.tenant_id
  )
  order by
    case
      when v_employee.user_id is not null
           and profile.id = v_employee.user_id
        then 1
      when coalesce(v_employee.work_email, '') <> ''
           and lower(profile.email) =
               lower(v_employee.work_email)
        then 2
      else 3
    end
  limit 1
  for update;

  v_saved_employee_role_key := lower(
    regexp_replace(
      trim(coalesce(v_employee.system_role, 'employee')),
      '[\s\-]+',
      '_',
      'g'
    )
  );

  v_saved_profile_role_key :=
    lower(trim(coalesce(v_profile.role, '')));

  /*
    Resolve whether the target employee/login belongs to the caller.

    The user_id comparison is authoritative. Email comparison is only a fallback
    for older employee rows that have not yet been linked by user_id.
  */
  v_target_is_caller :=
    v_employee.user_id = v_caller_id
    or v_profile.id = v_caller_id
    or (
      v_employee.user_id is null
      and v_caller_email <> ''
      and lower(trim(coalesce(v_employee.work_email, ''))) =
          v_caller_email
    );

  /*
    HR self-role protection.

    Keep same-role/no-op synchronisation available because the full employee form
    calls this RPC after ordinary biodata saves. Block only an actual change to
    the caller's business role or dashboard route.
  */
  if not v_is_platform_admin
     and v_target_is_caller
     and (
       v_role_key is distinct from
         v_saved_employee_role_key
       or (
         v_profile.id is not null
         and v_dashboard_role is distinct from
             v_saved_profile_role_key
       )
     )
  then
    raise exception
      'HR users cannot change their own system role or dashboard access.'
      using errcode = '42501';
  end if;

  /*
    Peer-HR protection.

    Existing HR employee records may still be saved with role=hr unchanged when
    HR edits biodata. Demoting or changing an existing HR employee remains a
    Platform Admin action, matching the current HR interface rule.
  */
  if not v_is_platform_admin
     and v_saved_employee_role_key = 'hr'
     and v_role_key is distinct from
         v_saved_employee_role_key
  then
    raise exception
      'Existing HR access is protected. Ask a Platform Admin to change this employee role.'
      using errcode = '42501';
  end if;

  /*
    Platform Admin profile protection.

    Even if an inconsistent employee row points at an Admin profile, HR cannot
    overwrite that profile's dashboard route.
  */
  if not v_is_platform_admin
     and v_saved_profile_role_key in (
       'admin',
       'system_admin'
     )
  then
    raise exception
      'Platform Admin access cannot be changed from the HR employee workflow.'
      using errcode = '42501';
  end if;

  /*
    Atomic role synchronisation.
  */
  update public.employees employee
  set
    system_role = v_employee_system_role,
    user_id = case
      when employee.user_id is null
           and v_profile.id is not null
        then v_profile.id
      else employee.user_id
    end,
    updated_at = now()
  where employee.id = v_employee.id
  returning employee.*
  into v_employee;

  if v_profile.id is not null then
    update public.profiles profile
    set
      role = v_dashboard_role,
      updated_at = now()
    where profile.id = v_profile.id
    returning profile.*
    into v_profile;
  end if;

  return query
  select
    true as success,
    v_employee.id as employee_id,
    v_employee.system_role as employee_system_role,
    v_profile.id as profile_id,
    v_profile.role as profile_role,
    (v_profile.id is not null) as profile_found,
    (v_profile.id is not null) as profile_updated,
    case
      when v_profile.id is not null then
        'Employee system role saved as ' ||
        coalesce(
          v_employee.system_role,
          'employee'
        ) ||
        '. Login dashboard routing synced to ' ||
        v_dashboard_label ||
        '.'
      else
        'Employee system role saved as ' ||
        coalesce(
          v_employee.system_role,
          'employee'
        ) ||
        '. No login profile exists yet, so send a login invite before dashboard routing can apply.'
    end as message;
end;
$function$;


/*
  This RPC is called only after authentication. Anonymous users do not need
  execution rights.
*/
revoke execute on function
  public.hr_sync_employee_manager_role(uuid, text)
from public;

revoke execute on function
  public.hr_sync_employee_manager_role(uuid, text)
from anon;

grant execute on function
  public.hr_sync_employee_manager_role(uuid, text)
to authenticated, service_role;


/*
  Transactional verification.
*/
do $verification$
declare
  function_definition text;
begin
  select pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid =
       procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname =
        'hr_sync_employee_manager_role'
    and pg_get_function_identity_arguments(
          procedure_record.oid
        ) =
        'input_employee_id uuid, input_role text';

  if function_definition is null then
    raise exception
      'Verification failed: hr_sync_employee_manager_role(uuid, text) was not found.';
  end if;

  if position(
       'HR users cannot change their own system role or dashboard access.'
       in function_definition
     ) = 0
  then
    raise exception
      'Verification failed: HR self-role protection is missing.';
  end if;

  if position(
       'Existing HR access is protected. Ask a Platform Admin to change this employee role.'
       in function_definition
     ) = 0
  then
    raise exception
      'Verification failed: peer-HR protection is missing.';
  end if;

  if position(
       'Employee is outside your tenant scope.'
       in function_definition
     ) = 0
  then
    raise exception
      'Verification failed: tenant protection is missing.';
  end if;
end;
$verification$;

commit;


/*
  Post-migration privilege verification.
*/
select
  procedure_record.oid::regprocedure::text
    as function_signature,

  procedure_record.prosecdef
    as security_definer,

  procedure_record.proconfig
    as runtime_configuration,

  coalesce(
    (
      select bool_or(
        expanded_acl.privilege_type = 'EXECUTE'
      )
      from aclexplode(
        coalesce(
          procedure_record.proacl,
          acldefault(
            'f',
            procedure_record.proowner
          )
        )
      ) expanded_acl
      where expanded_acl.grantee = 0
    ),
    false
  ) as public_can_execute,

  has_function_privilege(
    'anon',
    procedure_record.oid,
    'EXECUTE'
  ) as anon_can_execute,

  has_function_privilege(
    'authenticated',
    procedure_record.oid,
    'EXECUTE'
  ) as authenticated_can_execute,

  has_function_privilege(
    'service_role',
    procedure_record.oid,
    'EXECUTE'
  ) as service_role_can_execute,

  position(
    'HR users cannot change their own system role or dashboard access.'
    in pg_get_functiondef(
         procedure_record.oid
       )
  ) > 0 as has_self_role_guard,

  position(
    'Existing HR access is protected. Ask a Platform Admin to change this employee role.'
    in pg_get_functiondef(
         procedure_record.oid
       )
  ) > 0 as has_peer_hr_guard,

  position(
    'Employee is outside your tenant scope.'
    in pg_get_functiondef(
         procedure_record.oid
       )
  ) > 0 as has_tenant_guard

from pg_proc procedure_record

join pg_namespace namespace_record
  on namespace_record.oid =
     procedure_record.pronamespace

where namespace_record.nspname = 'public'
  and procedure_record.proname =
      'hr_sync_employee_manager_role'
  and pg_get_function_identity_arguments(
        procedure_record.oid
      ) =
      'input_employee_id uuid, input_role text';
