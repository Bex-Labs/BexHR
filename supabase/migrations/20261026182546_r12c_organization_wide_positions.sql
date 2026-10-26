-- BEXHR R-12C ORGANIZATION-WIDE POSITIONS
-- Allows approved whole-organization job titles (for example CEO/COO)
-- without creating fake departments or executive system roles.
-- Existing tenant isolation, audit triggers, and protected Company Admin RPC
-- remain authoritative.

begin;

do $r12c_preflight$
begin
  if to_regclass('public.organization_job_titles') is null then
    raise exception 'R-12C stopped: public.organization_job_titles is missing.';
  end if;

  if to_regclass('public.organization_departments') is null then
    raise exception 'R-12C stopped: public.organization_departments is missing.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception 'R-12C stopped: public.employees is missing.';
  end if;

  if to_regprocedure('public.require_current_tenant_administrator()') is null then
    raise exception 'R-12C stopped: Tenant Administrator guard is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_job_titles'
      and column_name = 'department_id'
  ) then
    raise exception 'R-12C stopped: organization_job_titles.department_id is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'department'
  ) then
    raise exception 'R-12C stopped: employees.department is missing.';
  end if;
end;
$r12c_preflight$;

-- Whole-organization titles and employees intentionally have no department.
alter table public.organization_job_titles
  alter column department_id drop not null;

alter table public.employees
  alter column department drop not null;

-- Existing department-scoped unique indexes allow multiple NULL department_id
-- values, so add explicit uniqueness for whole-organization titles.
create unique index if not exists
  organization_job_titles_tenant_orgwide_title_unique
on public.organization_job_titles (
  tenant_id,
  lower(trim(job_title))
)
where tenant_id is not null
  and department_id is null;

create unique index if not exists
  organization_job_titles_global_orgwide_title_unique
on public.organization_job_titles (
  lower(trim(job_title))
)
where tenant_id is null
  and department_id is null;

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

  if v_job_title is null then
    raise exception 'Job title is required.'
      using errcode = '22023';
  end if;

  if p_department_id is not null and not exists (
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
'Creates or updates one tenant job title. A null department_id means the title applies to the whole organization; non-null departments must belong to the same tenant.';

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

do $r12c_verify$
declare
  v_function_oid oid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_job_titles'
      and column_name = 'department_id'
      and is_nullable <> 'YES'
  ) then
    raise exception 'R-12C verification failed: job-title department_id is still required.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'department'
      and is_nullable <> 'YES'
  ) then
    raise exception 'R-12C verification failed: employee department is still required.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'organization_job_titles'
      and indexname = 'organization_job_titles_tenant_orgwide_title_unique'
  ) then
    raise exception 'R-12C verification failed: tenant whole-organization title uniqueness is missing.';
  end if;

  v_function_oid := to_regprocedure(
    'public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)'
  );

  if v_function_oid is null then
    raise exception 'R-12C verification failed: Job Title save RPC is missing.';
  end if;

  if not exists (
    select 1 from pg_proc where oid = v_function_oid and prosecdef is true
  ) then
    raise exception 'R-12C verification failed: Job Title save RPC is not SECURITY DEFINER.';
  end if;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'R-12C verification failed: anon can execute the protected Job Title RPC.';
  end if;

  if not has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'R-12C verification failed: authenticated lost the protected Job Title RPC.';
  end if;
end;
$r12c_verify$;

commit;
