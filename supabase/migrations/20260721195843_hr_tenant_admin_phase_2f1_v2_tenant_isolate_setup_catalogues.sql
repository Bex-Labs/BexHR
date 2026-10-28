/*
  BexHR HR Tenant Admin - Phase 2F1 V2
  Idempotent tenant isolation for organisation departments and job titles

  PURPOSE
  -------
  Make the organisation setup catalogues tenant-owned while safely supporting:
    - a clean legacy database with global setup rows;
    - the current production database, where the first Phase 2F1 execution
      completed the tenant data but reported a temporary-table error.

  IMPORTANT
  ---------
  This migration does not depend on a temporary mapping table. Tenant job-title
  copies are matched to tenant department copies by normalized department name.

  SECURITY
  --------
  - Legacy null-tenant rows remain preserved but hidden from authenticated HR.
  - Authenticated HR can only read/write rows for their own active profile tenant.
  - Anonymous table access is removed.
  - Authenticated DELETE remains blocked.
  - Department/job-title tenant relationships are enforced by foreign keys.

  TRANSITIONAL ACCESS
  -------------------
  Existing authorized HR/HR Manager setup maintenance remains available during
  this phase. Tenant Administrator-only write enforcement will be added later
  through protected RPCs and UI gating.

  OUT OF SCOPE
  ------------
  - No Tenant Administrator assignment
  - No Tenant Administrator permission grant
  - No employee/profile/tenant/organization_settings data changes
  - No Platform Admin capability changes
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $phase_2f1_v2_preflight$
begin
  if to_regclass('public.organization_departments') is null
     or to_regclass('public.organization_job_titles') is null
     or to_regclass('public.employees') is null
     or to_regclass('public.tenants') is null
     or to_regclass('public.profiles') is null
  then
    raise exception
      'Phase 2F1 V2 stopped: one or more required tables are missing.';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where lower(trim(coalesce(tenant.status, ''))) = 'active'
  ) then
    raise exception
      'Phase 2F1 V2 stopped: no active tenant exists.';
  end if;

  if exists (
    select 1
    from public.organization_departments department
    where nullif(trim(department.department_name), '') is null
  ) then
    raise exception
      'Phase 2F1 V2 stopped: a department has a blank name.';
  end if;

  if exists (
    select 1
    from public.organization_job_titles job_title
    where nullif(trim(job_title.job_title), '') is null
  ) then
    raise exception
      'Phase 2F1 V2 stopped: a job title has a blank title.';
  end if;
end;
$phase_2f1_v2_preflight$;


/*
  Active-profile tenant helper used by column defaults and RLS.
*/
create or replace function public.current_authenticated_profile_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select profile.tenant_id
  from public.profiles profile
  where profile.id = auth.uid()
    and coalesce(profile.is_active, false) is true
  limit 1;
$function$;

comment on function
  public.current_authenticated_profile_tenant_id()
is
'Returns the active authenticated profile tenant_id for tenant-scoped organisation setup defaults and RLS.';

revoke all on function
  public.current_authenticated_profile_tenant_id()
from public;

revoke execute on function
  public.current_authenticated_profile_tenant_id()
from anon;

grant execute on function
  public.current_authenticated_profile_tenant_id()
to authenticated, service_role;


/*
  Add tenant ownership columns only when absent.
*/
alter table public.organization_departments
add column if not exists tenant_id uuid
default public.current_authenticated_profile_tenant_id();

alter table public.organization_job_titles
add column if not exists tenant_id uuid
default public.current_authenticated_profile_tenant_id();


/*
  Remove the former global uniqueness constraints when they still exist.
*/
alter table public.organization_job_titles
drop constraint if exists
  organization_job_titles_department_title_unique;

alter table public.organization_departments
drop constraint if exists
  organization_departments_name_unique;


/*
  Tenant-aware indexes. Legacy null-tenant rows retain separate unique indexes.
*/
create unique index if not exists
  organization_departments_global_name_unique
on public.organization_departments (
  lower(trim(department_name))
)
where tenant_id is null;

create unique index if not exists
  organization_departments_tenant_name_unique
on public.organization_departments (
  tenant_id,
  lower(trim(department_name))
)
where tenant_id is not null;

create unique index if not exists
  organization_job_titles_global_department_title_unique
on public.organization_job_titles (
  department_id,
  lower(trim(job_title))
)
where tenant_id is null;

create unique index if not exists
  organization_job_titles_tenant_department_title_unique
on public.organization_job_titles (
  tenant_id,
  department_id,
  lower(trim(job_title))
)
where tenant_id is not null;


/*
  Tenant and composite relationship constraints, created only when absent.
*/
do $phase_2f1_v2_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
          'public.organization_departments'::regclass
      and constraint_record.conname =
          'organization_departments_tenant_id_fkey'
  ) then
    alter table public.organization_departments
    add constraint organization_departments_tenant_id_fkey
    foreign key (tenant_id)
    references public.tenants(id)
    on update cascade
    on delete restrict
    not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
          'public.organization_departments'::regclass
      and constraint_record.conname =
          'organization_departments_id_tenant_unique'
  ) then
    alter table public.organization_departments
    add constraint organization_departments_id_tenant_unique
    unique (id, tenant_id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
          'public.organization_job_titles'::regclass
      and constraint_record.conname =
          'organization_job_titles_tenant_id_fkey'
  ) then
    alter table public.organization_job_titles
    add constraint organization_job_titles_tenant_id_fkey
    foreign key (tenant_id)
    references public.tenants(id)
    on update cascade
    on delete restrict
    not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
          'public.organization_job_titles'::regclass
      and constraint_record.conname =
          'organization_job_titles_department_tenant_fkey'
  ) then
    alter table public.organization_job_titles
    add constraint organization_job_titles_department_tenant_fkey
    foreign key (
      department_id,
      tenant_id
    )
    references public.organization_departments(
      id,
      tenant_id
    )
    on update cascade
    on delete restrict
    not valid;
  end if;
end;
$phase_2f1_v2_constraints$;


/*
  Clone every legacy department into every active tenant.

  ON CONFLICT makes this safe for both fresh and already-completed databases.
*/
insert into public.organization_departments (
  id,
  department_name,
  status,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at,
  tenant_id
)
select
  gen_random_uuid(),
  legacy_department.department_name,
  legacy_department.status,
  legacy_department.notes,
  legacy_department.created_by,
  legacy_department.updated_by,
  legacy_department.created_at,
  legacy_department.updated_at,
  tenant.id
from public.organization_departments legacy_department
cross join public.tenants tenant
where legacy_department.tenant_id is null
  and lower(trim(coalesce(tenant.status, ''))) = 'active'
on conflict do nothing;


/*
  Add tenant-specific departments already used by employees but absent from
  that tenant's catalogue.
*/
insert into public.organization_departments (
  department_name,
  status,
  notes,
  tenant_id
)
select distinct
  trim(to_jsonb(employee) ->> 'department'),
  'Active'::text,
  'Backfilled from an existing employee record during Phase 2F1 tenant isolation.'::text,
  employee.tenant_id
from public.employees employee
join public.tenants tenant
  on tenant.id = employee.tenant_id
 and lower(trim(coalesce(tenant.status, ''))) = 'active'
where nullif(
  trim(to_jsonb(employee) ->> 'department'),
  ''
) is not null
  and not exists (
    select 1
    from public.organization_departments department
    where department.tenant_id = employee.tenant_id
      and lower(trim(department.department_name)) =
          lower(trim(to_jsonb(employee) ->> 'department'))
  )
on conflict do nothing;


/*
  Repair any partial-state job-title clone that references a tenant department
  but still has tenant_id = null.
*/
update public.organization_job_titles job_title
set tenant_id = department.tenant_id
from public.organization_departments department
where department.id = job_title.department_id
  and job_title.tenant_id is null
  and department.tenant_id is not null;


/*
  Clone every legacy job title into each active tenant's matching cloned
  department. No temporary mapping table is required.
*/
insert into public.organization_job_titles (
  id,
  department_id,
  job_title,
  status,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at,
  tenant_id
)
select
  gen_random_uuid(),
  tenant_department.id,
  legacy_job_title.job_title,
  legacy_job_title.status,
  legacy_job_title.notes,
  legacy_job_title.created_by,
  legacy_job_title.updated_by,
  legacy_job_title.created_at,
  legacy_job_title.updated_at,
  tenant_department.tenant_id
from public.organization_job_titles legacy_job_title
join public.organization_departments legacy_department
  on legacy_department.id = legacy_job_title.department_id
 and legacy_department.tenant_id is null
join public.organization_departments tenant_department
  on tenant_department.tenant_id is not null
 and lower(trim(tenant_department.department_name)) =
     lower(trim(legacy_department.department_name))
join public.tenants tenant
  on tenant.id = tenant_department.tenant_id
 and lower(trim(coalesce(tenant.status, ''))) = 'active'
where legacy_job_title.tenant_id is null
on conflict do nothing;


/*
  Add employee-used job titles that are absent from that tenant's catalogue.
*/
insert into public.organization_job_titles (
  department_id,
  job_title,
  status,
  notes,
  tenant_id
)
select distinct
  department.id,
  trim(to_jsonb(employee) ->> 'job_title'),
  'Active'::text,
  'Backfilled from an existing employee record during Phase 2F1 tenant isolation.'::text,
  employee.tenant_id
from public.employees employee
join public.tenants tenant
  on tenant.id = employee.tenant_id
 and lower(trim(coalesce(tenant.status, ''))) = 'active'
join public.organization_departments department
  on department.tenant_id = employee.tenant_id
 and lower(trim(department.department_name)) =
     lower(trim(to_jsonb(employee) ->> 'department'))
where nullif(
  trim(to_jsonb(employee) ->> 'department'),
  ''
) is not null
  and nullif(
    trim(to_jsonb(employee) ->> 'job_title'),
    ''
  ) is not null
  and not exists (
    select 1
    from public.organization_job_titles job_title
    where job_title.tenant_id = employee.tenant_id
      and job_title.department_id = department.id
      and lower(trim(job_title.job_title)) =
          lower(trim(to_jsonb(employee) ->> 'job_title'))
  )
on conflict do nothing;


/*
  Enable RLS and replace global role-only policies with same-tenant policies.
*/
alter table public.organization_departments
enable row level security;

alter table public.organization_job_titles
enable row level security;

drop policy if exists
  "HR can read organization departments"
on public.organization_departments;

drop policy if exists
  "HR can create organization departments"
on public.organization_departments;

drop policy if exists
  "HR can update organization departments"
on public.organization_departments;

drop policy if exists
  "Tenant HR can read organization departments"
on public.organization_departments;

drop policy if exists
  "Tenant HR can create organization departments"
on public.organization_departments;

drop policy if exists
  "Tenant HR can update organization departments"
on public.organization_departments;

create policy "Tenant HR can read organization departments"
on public.organization_departments
for select
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);

create policy "Tenant HR can create organization departments"
on public.organization_departments
for insert
to authenticated
with check (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);

create policy "Tenant HR can update organization departments"
on public.organization_departments
for update
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
)
with check (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);


drop policy if exists
  "HR can read organization job titles"
on public.organization_job_titles;

drop policy if exists
  "HR can create organization job titles"
on public.organization_job_titles;

drop policy if exists
  "HR can update organization job titles"
on public.organization_job_titles;

drop policy if exists
  "Tenant HR can read organization job titles"
on public.organization_job_titles;

drop policy if exists
  "Tenant HR can create organization job titles"
on public.organization_job_titles;

drop policy if exists
  "Tenant HR can update organization job titles"
on public.organization_job_titles;

create policy "Tenant HR can read organization job titles"
on public.organization_job_titles
for select
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);

create policy "Tenant HR can create organization job titles"
on public.organization_job_titles
for insert
to authenticated
with check (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);

create policy "Tenant HR can update organization job titles"
on public.organization_job_titles
for update
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
)
with check (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager'
      )
  )
);


/*
  Restrict table grants to the browser operations currently used.
*/
revoke all on table
  public.organization_departments
from public, anon, authenticated;

revoke all on table
  public.organization_job_titles
from public, anon, authenticated;

grant select, insert, update on table
  public.organization_departments
to authenticated;

grant select, insert, update on table
  public.organization_job_titles
to authenticated;

grant all on table
  public.organization_departments
to service_role;

grant all on table
  public.organization_job_titles
to service_role;


/*
  Validate foreign keys after tenant rows are complete.
*/
alter table public.organization_departments
validate constraint organization_departments_tenant_id_fkey;

alter table public.organization_job_titles
validate constraint organization_job_titles_tenant_id_fkey;

alter table public.organization_job_titles
validate constraint organization_job_titles_department_tenant_fkey;


/*
  Final invariant verification.
*/
do $phase_2f1_v2_verify$
declare
  v_active_tenant_count bigint;
  v_legacy_department_count bigint;
  v_legacy_job_title_count bigint;
  v_tenant_department_count bigint;
  v_tenant_job_title_count bigint;
begin
  select count(*)
  into v_active_tenant_count
  from public.tenants tenant
  where lower(trim(coalesce(tenant.status, ''))) = 'active';

  select count(*)
  into v_legacy_department_count
  from public.organization_departments department
  where department.tenant_id is null;

  select count(*)
  into v_legacy_job_title_count
  from public.organization_job_titles job_title
  where job_title.tenant_id is null;

  select count(*)
  into v_tenant_department_count
  from public.organization_departments department
  where department.tenant_id is not null;

  select count(*)
  into v_tenant_job_title_count
  from public.organization_job_titles job_title
  where job_title.tenant_id is not null;

  if v_tenant_department_count <
     (v_active_tenant_count * v_legacy_department_count)
  then
    raise exception
      'Phase 2F1 V2 verification failed: expected at least % tenant departments, found %.',
      (v_active_tenant_count * v_legacy_department_count),
      v_tenant_department_count;
  end if;

  if v_tenant_job_title_count <
     (v_active_tenant_count * v_legacy_job_title_count)
  then
    raise exception
      'Phase 2F1 V2 verification failed: expected at least % tenant job titles, found %.',
      (v_active_tenant_count * v_legacy_job_title_count),
      v_tenant_job_title_count;
  end if;

  if exists (
    select 1
    from public.organization_job_titles job_title
    join public.organization_departments department
      on department.id = job_title.department_id
    where job_title.tenant_id is not null
      and job_title.tenant_id is distinct from department.tenant_id
  ) then
    raise exception
      'Phase 2F1 V2 verification failed: a tenant job title references a department from another tenant.';
  end if;

  if exists (
    select 1
    from public.organization_job_titles job_title
    where job_title.tenant_id is null
      and exists (
        select 1
        from public.organization_departments department
        where department.id = job_title.department_id
          and department.tenant_id is not null
      )
  ) then
    raise exception
      'Phase 2F1 V2 verification failed: a tenant department still has a null-tenant job title.';
  end if;

  if exists (
    select 1
    from public.employees employee
    join public.tenants tenant
      on tenant.id = employee.tenant_id
     and lower(trim(coalesce(tenant.status, ''))) = 'active'
    where nullif(
      trim(to_jsonb(employee) ->> 'department'),
      ''
    ) is not null
      and not exists (
        select 1
        from public.organization_departments department
        where department.tenant_id = employee.tenant_id
          and lower(trim(department.department_name)) =
              lower(trim(to_jsonb(employee) ->> 'department'))
      )
  ) then
    raise exception
      'Phase 2F1 V2 verification failed: an employee department is missing from its tenant catalogue.';
  end if;

  if exists (
    select 1
    from public.employees employee
    join public.tenants tenant
      on tenant.id = employee.tenant_id
     and lower(trim(coalesce(tenant.status, ''))) = 'active'
    where nullif(
      trim(to_jsonb(employee) ->> 'department'),
      ''
    ) is not null
      and nullif(
        trim(to_jsonb(employee) ->> 'job_title'),
        ''
      ) is not null
      and not exists (
        select 1
        from public.organization_job_titles job_title
        join public.organization_departments department
          on department.id = job_title.department_id
         and department.tenant_id = job_title.tenant_id
        where job_title.tenant_id = employee.tenant_id
          and lower(trim(department.department_name)) =
              lower(trim(to_jsonb(employee) ->> 'department'))
          and lower(trim(job_title.job_title)) =
              lower(trim(to_jsonb(employee) ->> 'job_title'))
      )
  ) then
    raise exception
      'Phase 2F1 V2 verification failed: an employee job title is missing from its tenant catalogue.';
  end if;

  if pg_catalog.has_table_privilege(
    'anon',
    'public.organization_departments',
    'SELECT'
  )
     or pg_catalog.has_table_privilege(
       'anon',
       'public.organization_job_titles',
       'SELECT'
     )
  then
    raise exception
      'Phase 2F1 V2 verification failed: anon retains setup-table access.';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated',
    'public.organization_departments',
    'DELETE'
  )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.organization_job_titles',
       'DELETE'
     )
  then
    raise exception
      'Phase 2F1 V2 verification failed: authenticated retains DELETE access.';
  end if;
end;
$phase_2f1_v2_verify$;

commit;


/*
  POST-RUN VERIFICATION REPORT

  Current production is expected to report:
    active_tenant_count = 4
    legacy_department_count = 18
    tenant_department_count = 74
    legacy_job_title_count = 73
    tenant_job_title_count = 309
    all gap/mismatch counts = 0
    anon access = false
    authenticated SELECT/INSERT/UPDATE = true
    authenticated DELETE = false
*/

select
  (
    select count(*)
    from public.tenants tenant
    where lower(trim(coalesce(tenant.status, ''))) = 'active'
  ) as active_tenant_count,

  (
    select count(*)
    from public.organization_departments department
    where department.tenant_id is null
  ) as legacy_department_count,

  (
    select count(*)
    from public.organization_departments department
    where department.tenant_id is not null
  ) as tenant_department_count,

  (
    select count(*)
    from public.organization_job_titles job_title
    where job_title.tenant_id is null
  ) as legacy_job_title_count,

  (
    select count(*)
    from public.organization_job_titles job_title
    where job_title.tenant_id is not null
  ) as tenant_job_title_count,

  (
    select count(*)
    from public.organization_job_titles job_title
    join public.organization_departments department
      on department.id = job_title.department_id
    where job_title.tenant_id is not null
      and job_title.tenant_id is distinct from department.tenant_id
  ) as cross_tenant_job_title_department_links,

  (
    select count(*)
    from public.organization_job_titles job_title
    join public.organization_departments department
      on department.id = job_title.department_id
    where job_title.tenant_id is null
      and department.tenant_id is not null
  ) as null_tenant_job_titles_on_tenant_departments,

  (
    select count(*)
    from public.employees employee
    join public.tenants tenant
      on tenant.id = employee.tenant_id
     and lower(trim(coalesce(tenant.status, ''))) = 'active'
    where nullif(
      trim(to_jsonb(employee) ->> 'department'),
      ''
    ) is not null
      and not exists (
        select 1
        from public.organization_departments department
        where department.tenant_id = employee.tenant_id
          and lower(trim(department.department_name)) =
              lower(trim(to_jsonb(employee) ->> 'department'))
      )
  ) as employee_departments_missing_from_tenant_catalogue,

  (
    select count(*)
    from public.employees employee
    join public.tenants tenant
      on tenant.id = employee.tenant_id
     and lower(trim(coalesce(tenant.status, ''))) = 'active'
    where nullif(
      trim(to_jsonb(employee) ->> 'department'),
      ''
    ) is not null
      and nullif(
        trim(to_jsonb(employee) ->> 'job_title'),
        ''
      ) is not null
      and not exists (
        select 1
        from public.organization_job_titles job_title
        join public.organization_departments department
          on department.id = job_title.department_id
         and department.tenant_id = job_title.tenant_id
        where job_title.tenant_id = employee.tenant_id
          and lower(trim(department.department_name)) =
              lower(trim(to_jsonb(employee) ->> 'department'))
          and lower(trim(job_title.job_title)) =
              lower(trim(to_jsonb(employee) ->> 'job_title'))
      )
  ) as employee_job_titles_missing_from_tenant_catalogue,

  pg_catalog.has_table_privilege(
    'anon',
    'public.organization_departments',
    'SELECT'
  ) as anon_can_read_departments,

  pg_catalog.has_table_privilege(
    'anon',
    'public.organization_job_titles',
    'SELECT'
  ) as anon_can_read_job_titles,

  (
    pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'SELECT'
    )
    and pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'INSERT'
    )
    and pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_departments',
      'UPDATE'
    )
  ) as authenticated_can_use_departments,

  (
    pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'SELECT'
    )
    and pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'INSERT'
    )
    and pg_catalog.has_table_privilege(
      'authenticated',
      'public.organization_job_titles',
      'UPDATE'
    )
  ) as authenticated_can_use_job_titles,

  pg_catalog.has_table_privilege(
    'authenticated',
    'public.organization_departments',
    'DELETE'
  ) as authenticated_can_delete_departments,

  pg_catalog.has_table_privilege(
    'authenticated',
    'public.organization_job_titles',
    'DELETE'
  ) as authenticated_can_delete_job_titles;
