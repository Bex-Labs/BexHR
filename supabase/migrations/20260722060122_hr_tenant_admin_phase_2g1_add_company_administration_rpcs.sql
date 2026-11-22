-- BexHR Phase 2G1
-- Add protected Tenant Administrator Company Administration RPCs.
--
-- IMPORTANT:
--   This phase adds the protected server-side write path only.
--   It does NOT revoke the current direct table writes yet.
--   The HR Dashboard will be changed to use these RPCs and tested first.
--
-- Protected capability requires all of:
--   - authenticated user
--   - active profiles row
--   - profiles.role = 'hr'
--   - profiles.hr_access_level = 'tenant_admin'
--   - non-null profiles.tenant_id
--
-- Tenant IDs, company identity, created_by, and updated_by are derived
-- server-side and are never accepted from the browser.

begin;

do $phase_2g1_preflight$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Phase 2G1 stopped: public.profiles is missing.';
  end if;

  if to_regclass('public.tenants') is null then
    raise exception 'Phase 2G1 stopped: public.tenants is missing.';
  end if;

  if to_regclass('public.organization_settings') is null then
    raise exception 'Phase 2G1 stopped: public.organization_settings is missing.';
  end if;

  if to_regclass('public.organization_departments') is null then
    raise exception 'Phase 2G1 stopped: public.organization_departments is missing.';
  end if;

  if to_regclass('public.organization_job_titles') is null then
    raise exception 'Phase 2G1 stopped: public.organization_job_titles is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'hr_access_level'
  ) then
    raise exception
      'Phase 2G1 stopped: public.profiles.hr_access_level is missing.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'organization_settings'
      and indexname = 'organization_settings_tenant_singleton_unique'
  ) then
    raise exception
      'Phase 2G1 stopped: organization_settings tenant singleton uniqueness is missing.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'organization_departments'
      and indexname = 'organization_departments_tenant_name_unique'
  ) then
    raise exception
      'Phase 2G1 stopped: tenant department-name uniqueness is missing.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'organization_job_titles'
      and indexname = 'organization_job_titles_tenant_department_title_unique'
  ) then
    raise exception
      'Phase 2G1 stopped: tenant job-title uniqueness is missing.';
  end if;
end;
$phase_2g1_preflight$;

create or replace function public.require_current_tenant_administrator()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
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
    and lower(trim(coalesce(profile.role, ''))) = 'hr'
    and lower(trim(coalesce(profile.hr_access_level, ''))) = 'tenant_admin'
    and profile.tenant_id is not null
  for share;

  if not found or v_tenant_id is null then
    raise exception
      'Only an active Tenant Administrator can maintain Company Administration.'
      using errcode = '42501';
  end if;

  return v_tenant_id;
end;
$function$;

comment on function public.require_current_tenant_administrator() is
'Internal Phase 2G guard. Returns the authenticated active HR Tenant Administrator tenant_id or raises 42501.';

revoke all
on function public.require_current_tenant_administrator()
from public, anon, authenticated;

grant execute
on function public.require_current_tenant_administrator()
to service_role;

create or replace function public.hr_tenant_admin_save_organization_settings(
  p_organization_email text default null,
  p_phone_number text default null,
  p_payroll_contact_email text default null,
  p_address_line text default null,
  p_city text default null,
  p_tax_identification_number text default null,
  p_registration_number text default null
)
returns public.organization_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_company_name text;
  v_result public.organization_settings%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();

  select nullif(trim(tenant.company_name), '')
  into v_company_name
  from public.tenants tenant
  where tenant.id = v_tenant_id
  for share;

  if not found or v_company_name is null then
    raise exception
      'The signed-in company identity could not be resolved.'
      using errcode = 'P0002';
  end if;

  insert into public.organization_settings (
    singleton_key,
    organization_name,
    organization_email,
    phone_number,
    address_line,
    city,
    country,
    tax_identification_number,
    registration_number,
    default_currency,
    default_pay_cycle,
    payroll_contact_email,
    status,
    notes,
    created_by,
    updated_by,
    tenant_id
  )
  values (
    true,
    v_company_name,
    nullif(trim(p_organization_email), ''),
    nullif(trim(p_phone_number), ''),
    nullif(trim(p_address_line), ''),
    nullif(trim(p_city), ''),
    'Nigeria',
    nullif(trim(p_tax_identification_number), ''),
    nullif(trim(p_registration_number), ''),
    'NGN',
    'Monthly',
    nullif(trim(p_payroll_contact_email), ''),
    'Active',
    null,
    auth.uid(),
    auth.uid(),
    v_tenant_id
  )
  on conflict (tenant_id, singleton_key)
  do update
  set
    organization_name = excluded.organization_name,
    organization_email = excluded.organization_email,
    phone_number = excluded.phone_number,
    payroll_contact_email = excluded.payroll_contact_email,
    address_line = excluded.address_line,
    city = excluded.city,
    tax_identification_number = excluded.tax_identification_number,
    registration_number = excluded.registration_number,
    updated_by = auth.uid(),
    updated_at = now()
  returning *
  into v_result;

  return v_result;
end;
$function$;

comment on function public.hr_tenant_admin_save_organization_settings(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) is
'Creates or updates only the approved editable Company Administration contact, address, payroll-contact, tax, and registration fields for the authenticated Tenant Administrator tenant.';

revoke all
on function public.hr_tenant_admin_save_organization_settings(
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_organization_settings(
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
to authenticated, service_role;

create or replace function public.hr_tenant_admin_save_organization_department(
  p_department_id uuid default null,
  p_department_name text default null,
  p_status text default 'Active',
  p_notes text default null
)
returns public.organization_departments
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_department_name text;
  v_status text;
  v_result public.organization_departments%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();
  v_department_name := nullif(trim(p_department_name), '');

  if v_department_name is null then
    raise exception 'Department name is required.'
      using errcode = '22023';
  end if;

  case lower(trim(coalesce(p_status, 'Active')))
    when 'active' then v_status := 'Active';
    when 'inactive' then v_status := 'Inactive';
    else
      raise exception 'Department status must be Active or Inactive.'
        using errcode = '22023';
  end case;

  if p_department_id is null then
    insert into public.organization_departments (
      department_name,
      status,
      notes,
      created_by,
      updated_by,
      tenant_id
    )
    values (
      v_department_name,
      v_status,
      nullif(trim(p_notes), ''),
      auth.uid(),
      auth.uid(),
      v_tenant_id
    )
    returning *
    into v_result;
  else
    update public.organization_departments department
    set
      department_name = v_department_name,
      status = v_status,
      notes = nullif(trim(p_notes), ''),
      updated_by = auth.uid(),
      updated_at = now()
    where department.id = p_department_id
      and department.tenant_id = v_tenant_id
    returning *
    into v_result;

    if not found then
      raise exception
        'The selected department was not found in your company workspace.'
        using errcode = 'P0002';
    end if;
  end if;

  return v_result;
end;
$function$;

comment on function public.hr_tenant_admin_save_organization_department(
  uuid,
  text,
  text,
  text
) is
'Creates or updates one department inside the authenticated Tenant Administrator tenant. Tenant and audit fields are server-derived.';

revoke all
on function public.hr_tenant_admin_save_organization_department(
  uuid,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_organization_department(
  uuid,
  text,
  text,
  text
)
to authenticated, service_role;

create or replace function public.hr_tenant_admin_save_organization_job_title(
  p_job_title_id uuid default null,
  p_department_id uuid default null,
  p_job_title text default null,
  p_status text default 'Active',
  p_notes text default null
)
returns public.organization_job_titles
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid;
  v_job_title text;
  v_status text;
  v_result public.organization_job_titles%rowtype;
begin
  v_tenant_id := public.require_current_tenant_administrator();
  v_job_title := nullif(trim(p_job_title), '');

  if p_department_id is null then
    raise exception 'Department is required.'
      using errcode = '22023';
  end if;

  if v_job_title is null then
    raise exception 'Job title is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_departments department
    where department.id = p_department_id
      and department.tenant_id = v_tenant_id
  ) then
    raise exception
      'The selected department does not belong to your company workspace.'
      using errcode = '42501';
  end if;

  case lower(trim(coalesce(p_status, 'Active')))
    when 'active' then v_status := 'Active';
    when 'inactive' then v_status := 'Inactive';
    else
      raise exception 'Job title status must be Active or Inactive.'
        using errcode = '22023';
  end case;

  if p_job_title_id is null then
    insert into public.organization_job_titles (
      department_id,
      job_title,
      status,
      notes,
      created_by,
      updated_by,
      tenant_id
    )
    values (
      p_department_id,
      v_job_title,
      v_status,
      nullif(trim(p_notes), ''),
      auth.uid(),
      auth.uid(),
      v_tenant_id
    )
    returning *
    into v_result;
  else
    update public.organization_job_titles job_title
    set
      department_id = p_department_id,
      job_title = v_job_title,
      status = v_status,
      notes = nullif(trim(p_notes), ''),
      updated_by = auth.uid(),
      updated_at = now()
    where job_title.id = p_job_title_id
      and job_title.tenant_id = v_tenant_id
    returning *
    into v_result;

    if not found then
      raise exception
        'The selected job title was not found in your company workspace.'
        using errcode = 'P0002';
    end if;
  end if;

  return v_result;
end;
$function$;

comment on function public.hr_tenant_admin_save_organization_job_title(
  uuid,
  uuid,
  text,
  text,
  text
) is
'Creates or updates one job title inside the authenticated Tenant Administrator tenant and requires a same-tenant department.';

revoke all
on function public.hr_tenant_admin_save_organization_job_title(
  uuid,
  uuid,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.hr_tenant_admin_save_organization_job_title(
  uuid,
  uuid,
  text,
  text,
  text
)
to authenticated, service_role;

do $phase_2g1_verify$
declare
  v_function_record record;
  v_function_count integer;
begin
  select count(*)
  into v_function_count
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname in (
      'require_current_tenant_administrator',
      'hr_tenant_admin_save_organization_settings',
      'hr_tenant_admin_save_organization_department',
      'hr_tenant_admin_save_organization_job_title'
    )
    and procedure_record.prosecdef is true;

  if v_function_count <> 4 then
    raise exception
      'Phase 2G1 verification failed: expected 4 SECURITY DEFINER functions, found %.',
      v_function_count;
  end if;

  for v_function_record in
    select procedure_record.oid
    from pg_proc procedure_record
    join pg_namespace namespace_record
      on namespace_record.oid = procedure_record.pronamespace
    where namespace_record.nspname = 'public'
      and procedure_record.proname in (
        'hr_tenant_admin_save_organization_settings',
        'hr_tenant_admin_save_organization_department',
        'hr_tenant_admin_save_organization_job_title'
      )
  loop
    if has_function_privilege('anon', v_function_record.oid, 'EXECUTE') then
      raise exception
        'Phase 2G1 verification failed: anon can execute a protected Company Administration RPC.';
    end if;

    if not has_function_privilege(
      'authenticated',
      v_function_record.oid,
      'EXECUTE'
    ) then
      raise exception
        'Phase 2G1 verification failed: authenticated cannot execute a protected Company Administration RPC.';
    end if;
  end loop;

  if has_function_privilege(
    'authenticated',
    'public.require_current_tenant_administrator()',
    'EXECUTE'
  ) then
    raise exception
      'Phase 2G1 verification failed: authenticated can directly execute the internal Tenant Administrator guard.';
  end if;
end;
$phase_2g1_verify$;

commit;

select
  'Phase 2G1 protected Company Administration RPCs installed' as result,
  to_regprocedure(
    'public.hr_tenant_admin_save_organization_settings(text,text,text,text,text,text,text)'
  ) is not null as organization_settings_rpc_exists,
  to_regprocedure(
    'public.hr_tenant_admin_save_organization_department(uuid,text,text,text)'
  ) is not null as department_rpc_exists,
  to_regprocedure(
    'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)'
  ) is not null as job_title_rpc_exists,
  not has_function_privilege(
    'anon',
    'public.hr_tenant_admin_save_organization_settings(text,text,text,text,text,text,text)',
    'EXECUTE'
  ) as anon_blocked_from_organization_settings_rpc,
  not has_function_privilege(
    'anon',
    'public.hr_tenant_admin_save_organization_department(uuid,text,text,text)',
    'EXECUTE'
  ) as anon_blocked_from_department_rpc,
  not has_function_privilege(
    'anon',
    'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) as anon_blocked_from_job_title_rpc,
  has_table_privilege(
    'authenticated',
    'public.organization_settings',
    'INSERT'
  ) as direct_table_writes_intentionally_unchanged_in_phase_2g1;
