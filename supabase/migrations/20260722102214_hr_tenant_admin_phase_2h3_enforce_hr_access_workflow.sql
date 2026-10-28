-- BexHR Phase 2H3
-- Enforce the approved HR Officer / Company Admin role-assignment workflow.
--
-- Approved workflow:
--   1. Company Admin may grant or remove HR Officer access inside the same company.
--   2. HR Officer may not grant or remove HR access.
--   3. Platform Admin alone may grant or remove Company Admin access.
--   4. A new HR assignment defaults to hr_access_level = 'standard'.
--
-- Scope:
--   - replaces only public.hr_sync_employee_manager_role(uuid, text);
--   - changes no employee/profile data during migration;
--   - preserves existing tenant isolation, self-role protection, Admin protection,
--     role mapping, return shape, and browser RPC contract;
--   - keeps ordinary HR Officer People maintenance and non-HR role assignment
--     behaviour unchanged;
--   - protects transitions into, out of, or between HR / HR Manager roles.

begin;

do $phase_2h3_preflight$
declare
  v_role_sync_oid oid;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Phase 2H3 stopped: public.profiles is missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'Phase 2H3 stopped: public.employees is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = 'profiles'
      and column_record.column_name = 'hr_access_level'
      and column_record.is_nullable = 'NO'
      and column_record.column_default = '''standard''::text'
  ) then
    raise exception
      'Phase 2H3 stopped: profiles.hr_access_level is missing or does not default to standard.';
  end if;

  if exists (
    select 1
    from public.profiles profile
    where lower(trim(coalesce(profile.hr_access_level, ''))) = 'tenant_admin'
      and (
        lower(trim(coalesce(profile.role, ''))) <> 'hr'
        or profile.tenant_id is null
        or coalesce(profile.is_active, false) is false
      )
  ) then
    raise exception
      'Phase 2H3 stopped: an invalid Company Admin profile exists.';
  end if;

  v_role_sync_oid := to_regprocedure(
    'public.hr_sync_employee_manager_role(uuid,text)'
  );

  if v_role_sync_oid is null then
    raise exception
      'Phase 2H3 stopped: public.hr_sync_employee_manager_role(uuid,text) is missing.';
  end if;

  if not exists (
    select 1
    from pg_proc procedure_record
    where procedure_record.oid = v_role_sync_oid
      and procedure_record.prosecdef is true
  ) then
    raise exception
      'Phase 2H3 stopped: the current role-sync RPC is not SECURITY DEFINER.';
  end if;

  if has_function_privilege('anon', v_role_sync_oid, 'EXECUTE') then
    raise exception
      'Phase 2H3 stopped: anon can execute the current role-sync RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_role_sync_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2H3 stopped: authenticated cannot execute the current role-sync RPC.';
  end if;
end;
$phase_2h3_preflight$;

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
  v_caller_hr_access_level text;
  v_is_platform_admin boolean := false;
  v_caller_is_company_admin boolean := false;

  v_employee public.employees%rowtype;
  v_profile public.profiles%rowtype;

  v_saved_employee_role_key text;
  v_saved_profile_role_key text;
  v_target_hr_access_level text := 'standard';

  v_requested_is_hr_access boolean := false;
  v_saved_is_hr_access boolean := false;
  v_hr_role_change_requested boolean := false;
  v_hr_route_change_requested boolean := false;
  v_target_is_company_admin boolean := false;
  v_target_is_caller boolean := false;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated.'
      using errcode = '42501';
  end if;

  select
    lower(trim(coalesce(profile.role, ''))),
    profile.tenant_id,
    lower(trim(coalesce(profile.email, ''))),
    lower(trim(coalesce(profile.hr_access_level, 'standard')))
  into
    v_caller_role,
    v_caller_tenant_id,
    v_caller_email,
    v_caller_hr_access_level
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

  v_caller_is_company_admin :=
    v_caller_role = 'hr'
    and v_caller_hr_access_level = 'tenant_admin'
    and v_caller_tenant_id is not null;

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

  if v_dashboard_role = 'admin'
     and not v_is_platform_admin
  then
    raise exception
      'Only a platform admin can assign Admin dashboard access.'
      using errcode = '42501';
  end if;

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

  select employee.*
  into v_employee
  from public.employees employee
  where employee.id = input_employee_id
  for update;

  if not found then
    raise exception 'Employee record was not found.'
      using errcode = 'P0002';
  end if;

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

  v_target_hr_access_level :=
    lower(
      trim(
        coalesce(
          v_profile.hr_access_level,
          'standard'
        )
      )
    );

  v_requested_is_hr_access :=
    v_role_key in ('hr', 'hr_manager');

  v_saved_is_hr_access :=
    v_saved_employee_role_key in ('hr', 'hr_manager');

  v_hr_role_change_requested :=
    v_role_key is distinct from v_saved_employee_role_key
    and (
      v_requested_is_hr_access
      or v_saved_is_hr_access
    );

  v_hr_route_change_requested :=
    v_profile.id is not null
    and (
      (
        v_requested_is_hr_access
        and v_saved_profile_role_key is distinct from 'hr'
      )
      or (
        v_saved_is_hr_access
        and not v_requested_is_hr_access
        and v_saved_profile_role_key = 'hr'
      )
    );

  v_target_is_company_admin :=
    v_profile.id is not null
    and v_saved_profile_role_key = 'hr'
    and v_target_hr_access_level = 'tenant_admin';

  v_target_is_caller :=
    v_employee.user_id = v_caller_id
    or v_profile.id = v_caller_id
    or (
      v_employee.user_id is null
      and v_caller_email <> ''
      and lower(trim(coalesce(v_employee.work_email, ''))) =
          v_caller_email
    );

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

  if not v_is_platform_admin
     and v_target_is_company_admin
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
      'Company Admin access is protected. Ask a Platform Admin to change this employee role.'
      using errcode = '42501';
  end if;

  if not v_is_platform_admin
     and (
       v_hr_role_change_requested
       or v_hr_route_change_requested
     )
     and not v_caller_is_company_admin
  then
    raise exception
      'Only a Company Admin can grant or remove HR Officer access in this company.'
      using errcode = '42501';
  end if;

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
      hr_access_level = case
        when v_dashboard_role <> 'hr'
          then 'standard'

        when v_requested_is_hr_access
             and (
               not v_saved_is_hr_access
               or v_saved_profile_role_key is distinct from 'hr'
             )
          then 'standard'

        when v_target_is_company_admin
          then 'tenant_admin'

        else 'standard'
      end,
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
        case
          when v_requested_is_hr_access
            then ' with standard HR Officer access.'
          else '.'
        end
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

comment on function public.hr_sync_employee_manager_role(uuid, text) is
'Atomically synchronises employee business role and login dashboard route. HR Officer may perform ordinary People role maintenance but only a same-tenant Company Admin or Platform Admin may grant/remove HR or HR Manager access. Platform Admin alone controls tenant_admin through admin_set_hr_access_level.';

revoke all
on function public.hr_sync_employee_manager_role(uuid, text)
from public, anon;

grant execute
on function public.hr_sync_employee_manager_role(uuid, text)
to authenticated, service_role;

do $phase_2h3_verify$
declare
  v_role_sync_oid oid;
  v_function_definition text;
begin
  v_role_sync_oid := to_regprocedure(
    'public.hr_sync_employee_manager_role(uuid,text)'
  );

  if v_role_sync_oid is null then
    raise exception
      'Phase 2H3 verification failed: role-sync RPC is missing.';
  end if;

  select pg_get_functiondef(v_role_sync_oid)
  into v_function_definition;

  if not exists (
    select 1
    from pg_proc procedure_record
    where procedure_record.oid = v_role_sync_oid
      and procedure_record.prosecdef is true
  ) then
    raise exception
      'Phase 2H3 verification failed: role-sync RPC is not SECURITY DEFINER.';
  end if;

  if position(
    'v_caller_is_company_admin'
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2H3 verification failed: Company Admin caller guard is missing.';
  end if;

  if position(
    'Only a Company Admin can grant or remove HR Officer access in this company.'
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2H3 verification failed: HR Officer access guard is missing.';
  end if;

  if position(
    'hr_access_level = case'
    in v_function_definition
  ) = 0 then
    raise exception
      'Phase 2H3 verification failed: standard HR access assignment is missing.';
  end if;

  if has_function_privilege(
    'public',
    v_role_sync_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2H3 verification failed: PUBLIC can execute role-sync RPC.';
  end if;

  if has_function_privilege(
    'anon',
    v_role_sync_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2H3 verification failed: anon can execute role-sync RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_role_sync_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2H3 verification failed: authenticated lost role-sync RPC execution.';
  end if;

  if not has_function_privilege(
    'service_role',
    v_role_sync_oid,
    'EXECUTE'
  ) then
    raise exception
      'Phase 2H3 verification failed: service_role lost role-sync RPC execution.';
  end if;

  if exists (
    select 1
    from public.profiles profile
    where lower(trim(coalesce(profile.hr_access_level, ''))) = 'tenant_admin'
      and (
        lower(trim(coalesce(profile.role, ''))) <> 'hr'
        or profile.tenant_id is null
        or coalesce(profile.is_active, false) is false
      )
  ) then
    raise exception
      'Phase 2H3 verification failed: Company Admin invariant is broken.';
  end if;
end;
$phase_2h3_verify$;

commit;

select
  'Phase 2H3 HR access workflow enforced' as result,

  to_regprocedure(
    'public.hr_sync_employee_manager_role(uuid,text)'
  ) is not null as role_sync_rpc_exists,

  (
    select procedure_record.prosecdef
    from pg_proc procedure_record
    where procedure_record.oid = to_regprocedure(
      'public.hr_sync_employee_manager_role(uuid,text)'
    )
  ) as role_sync_is_security_definer,

  not has_function_privilege(
    'public',
    'public.hr_sync_employee_manager_role(uuid,text)',
    'EXECUTE'
  ) as public_blocked,

  not has_function_privilege(
    'anon',
    'public.hr_sync_employee_manager_role(uuid,text)',
    'EXECUTE'
  ) as anon_blocked,

  has_function_privilege(
    'authenticated',
    'public.hr_sync_employee_manager_role(uuid,text)',
    'EXECUTE'
  ) as authenticated_can_execute,

  position(
    'v_caller_is_company_admin'
    in pg_get_functiondef(
      to_regprocedure(
        'public.hr_sync_employee_manager_role(uuid,text)'
      )
    )
  ) > 0 as company_admin_guard_present,

  position(
    'Only a Company Admin can grant or remove HR Officer access in this company.'
    in pg_get_functiondef(
      to_regprocedure(
        'public.hr_sync_employee_manager_role(uuid,text)'
      )
    )
  ) > 0 as hr_officer_block_present,

  position(
    'hr_access_level = case'
    in pg_get_functiondef(
      to_regprocedure(
        'public.hr_sync_employee_manager_role(uuid,text)'
      )
    )
  ) > 0 as standard_access_assignment_present,

  (
    select count(*) = 0
    from public.profiles profile
    where lower(trim(coalesce(profile.hr_access_level, ''))) = 'tenant_admin'
      and (
        lower(trim(coalesce(profile.role, ''))) <> 'hr'
        or profile.tenant_id is null
        or coalesce(profile.is_active, false) is false
      )
  ) as company_admin_invariant_valid;
