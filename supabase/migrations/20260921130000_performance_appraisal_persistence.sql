/*
 BexHR Performance Appraisal Persistence Foundation - v1.0.0

 PURPOSE
 -------
 Establish tenant-scoped production persistence for Performance Appraisal
 without duplicating BexHR employee, department, authentication, or
 reporting-line master data.

 INTEGRATION CONTRACT
 --------------------
 - Employee identity: public.employees.id
 - Manager identity: public.employees.id
 - Tenant boundary: existing tenant UUID
 - Department identity: public.organization_departments.id
 - Manager authority: existing public.employee_reporting_lines
 - PA business IDs remain text to preserve the existing application model.
 - Existing PA record bodies are preserved in jsonb payloads.

 MIGRATION SAFETY
 ----------------
 - No existing table is altered.
 - No existing data is deleted.
 - No localStorage data is imported or deleted.
 - No employee/department/authentication master data is duplicated.
 - RLS is enabled immediately.
 - Direct anonymous access is not granted.
 */
begin;

set
    local lock_timeout = '5s';

do $pa_preflight$ begin if to_regclass('public.tenants') is null then raise exception 'Performance Appraisal migration stopped: public.tenants is missing.';

end if;

if to_regclass('public.employees') is null then raise exception 'Performance Appraisal migration stopped: public.employees is missing.';

end if;

if to_regclass('public.profiles') is null then raise exception 'Performance Appraisal migration stopped: public.profiles is missing.';

end if;

if to_regclass('public.organization_departments') is null then raise exception 'Performance Appraisal migration stopped: public.organization_departments is missing.';

end if;

if to_regclass('public.employee_reporting_lines') is null then raise exception 'Performance Appraisal migration stopped: public.employee_reporting_lines is missing.';

end if;

end;

$pa_preflight$;

/* --------------------------------------------------------------------------
 CONFIGURATION
 -------------------------------------------------------------------------- */
create table if not exists public.pa_cycles (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_cycles_id_tenant_unique unique (id, tenant_id)
);

create table if not exists public.pa_organisation_goals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    cycle_id text,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_organisation_goals_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

create table if not exists public.pa_deliverables (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    cycle_id text,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_deliverables_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

create table if not exists public.pa_department_goals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    cycle_id text,
    department_id uuid not null,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_department_goals_department_tenant_fkey foreign key (department_id, tenant_id) references public.organization_departments(id, tenant_id) on update cascade on delete restrict,
    constraint pa_department_goals_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

create table if not exists public.pa_templates (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

/* --------------------------------------------------------------------------
 EMPLOYEE PERFORMANCE
 -------------------------------------------------------------------------- */
create table if not exists public.pa_individual_goals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    employee_id uuid not null references public.employees(id),
    cycle_id text,
    department_id uuid not null,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_individual_goals_id_tenant_employee_unique unique (id, tenant_id, employee_id),
    constraint pa_individual_goals_department_tenant_fkey foreign key (department_id, tenant_id) references public.organization_departments(id, tenant_id) on update cascade on delete restrict,
    constraint pa_individual_goals_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

create table if not exists public.pa_progress_updates (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    employee_id uuid not null references public.employees(id),
    individual_goal_id text not null,
    cycle_id text,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_progress_updates_individual_goal_tenant_employee_fkey foreign key (individual_goal_id, tenant_id, employee_id) references public.pa_individual_goals(id, tenant_id, employee_id) on delete restrict,
    constraint pa_progress_updates_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

/* --------------------------------------------------------------------------
 APPRAISAL LIFECYCLE
 -------------------------------------------------------------------------- */
create table if not exists public.pa_employee_appraisals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    employee_id uuid not null references public.employees(id),
    manager_employee_id uuid references public.employees(id),
    cycle_id text,
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_employee_appraisals_id_tenant_unique unique (id, tenant_id),
    constraint pa_employee_appraisals_id_tenant_employee_unique unique (id, tenant_id, employee_id),
    constraint pa_employee_appraisals_cycle_tenant_fkey foreign key (cycle_id, tenant_id) references public.pa_cycles(id, tenant_id) on delete restrict
);

create table if not exists public.pa_self_appraisals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    appraisal_id text not null,
    employee_id uuid not null references public.employees(id),
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_self_appraisals_appraisal_tenant_unique unique (appraisal_id, tenant_id),
    constraint pa_self_appraisals_appraisal_tenant_employee_fkey foreign key (appraisal_id, tenant_id, employee_id) references public.pa_employee_appraisals(id, tenant_id, employee_id) on delete restrict
);

create table if not exists public.pa_manager_appraisals (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    appraisal_id text not null,
    employee_id uuid not null references public.employees(id),
    manager_employee_id uuid not null references public.employees(id),
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_manager_appraisals_appraisal_tenant_unique unique (appraisal_id, tenant_id),
    constraint pa_manager_appraisals_appraisal_tenant_employee_fkey foreign key (appraisal_id, tenant_id, employee_id) references public.pa_employee_appraisals(id, tenant_id, employee_id) on delete restrict
);

create table if not exists public.pa_hr_finalisations (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    appraisal_id text not null,
    employee_id uuid not null references public.employees(id),
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_hr_finalisations_appraisal_tenant_unique unique (appraisal_id, tenant_id),
    constraint pa_hr_finalisations_appraisal_tenant_employee_fkey foreign key (appraisal_id, tenant_id, employee_id) references public.pa_employee_appraisals(id, tenant_id, employee_id) on delete restrict
);

create table if not exists public.pa_employee_acknowledgements (
    id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    appraisal_id text not null,
    employee_id uuid not null references public.employees(id),
    status text,
    payload jsonb not null default '{}' :: jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pa_employee_acknowledgements_appraisal_tenant_unique unique (appraisal_id, tenant_id),
    constraint pa_employee_acknowledgements_appraisal_tenant_employee_fkey foreign key (appraisal_id, tenant_id, employee_id) references public.pa_employee_appraisals(id, tenant_id, employee_id) on delete restrict
);

/* --------------------------------------------------------------------------
 INDEXES
 -------------------------------------------------------------------------- */
create index if not exists pa_cycles_tenant_idx on public.pa_cycles (tenant_id);

create index if not exists pa_organisation_goals_tenant_cycle_idx on public.pa_organisation_goals (tenant_id, cycle_id);

create index if not exists pa_deliverables_tenant_cycle_idx on public.pa_deliverables (tenant_id, cycle_id);

create index if not exists pa_department_goals_tenant_cycle_idx on public.pa_department_goals (tenant_id, cycle_id);

create index if not exists pa_department_goals_tenant_department_idx on public.pa_department_goals (tenant_id, department_id);

create index if not exists pa_templates_tenant_idx on public.pa_templates (tenant_id);

create index if not exists pa_individual_goals_tenant_employee_idx on public.pa_individual_goals (tenant_id, employee_id);

create index if not exists pa_individual_goals_tenant_department_idx on public.pa_individual_goals (tenant_id, department_id);

create index if not exists pa_progress_updates_tenant_employee_idx on public.pa_progress_updates (tenant_id, employee_id);

create index if not exists pa_employee_appraisals_tenant_employee_idx on public.pa_employee_appraisals (tenant_id, employee_id);

create index if not exists pa_employee_appraisals_tenant_manager_idx on public.pa_employee_appraisals (tenant_id, manager_employee_id);

create index if not exists pa_self_appraisals_tenant_appraisal_idx on public.pa_self_appraisals (tenant_id, appraisal_id);

create index if not exists pa_manager_appraisals_tenant_appraisal_idx on public.pa_manager_appraisals (tenant_id, appraisal_id);

create index if not exists pa_hr_finalisations_tenant_appraisal_idx on public.pa_hr_finalisations (tenant_id, appraisal_id);

create index if not exists pa_employee_acknowledgements_tenant_appraisal_idx on public.pa_employee_acknowledgements (tenant_id, appraisal_id);

/* --------------------------------------------------------------------------
 ROW LEVEL SECURITY

 RLS is deliberately enabled before frontend integration.
 Detailed persona policies are added separately after the foundation has
 been verified against the existing BexHR authentication contract.
 -------------------------------------------------------------------------- */
alter table
    public.pa_cycles enable row level security;

alter table
    public.pa_organisation_goals enable row level security;

alter table
    public.pa_deliverables enable row level security;

alter table
    public.pa_department_goals enable row level security;

alter table
    public.pa_individual_goals enable row level security;

alter table
    public.pa_progress_updates enable row level security;

alter table
    public.pa_templates enable row level security;

alter table
    public.pa_employee_appraisals enable row level security;

alter table
    public.pa_self_appraisals enable row level security;

alter table
    public.pa_manager_appraisals enable row level security;

alter table
    public.pa_hr_finalisations enable row level security;

alter table
    public.pa_employee_acknowledgements enable row level security;

/* Explicitly avoid anonymous table access. */
revoke all on table public.pa_cycles
from
    anon;

revoke all on table public.pa_organisation_goals
from
    anon;

revoke all on table public.pa_deliverables
from
    anon;

revoke all on table public.pa_department_goals
from
    anon;

revoke all on table public.pa_individual_goals
from
    anon;

revoke all on table public.pa_progress_updates
from
    anon;

revoke all on table public.pa_templates
from
    anon;

revoke all on table public.pa_employee_appraisals
from
    anon;

revoke all on table public.pa_self_appraisals
from
    anon;

revoke all on table public.pa_manager_appraisals
from
    anon;

revoke all on table public.pa_hr_finalisations
from
    anon;

revoke all on table public.pa_employee_acknowledgements
from
    anon;

/* --------------------------------------------------------------------------
 PERFORMANCE APPRAISAL AUTHORIZATION HELPERS

 These helpers map authenticated BexHR identity to the three supported
 Performance Appraisal personas without creating another auth system.

 - Employee identity comes from public.employees.
 - HR Admin authority uses the canonical stored Tenant Administrator rule.
 - Manager authority requires an active PRIMARY reporting-line relationship.
 - Tenant isolation reuses public.current_authenticated_profile_tenant_id().
 -------------------------------------------------------------------------- */
create
or replace function public.pa_current_employee_id() returns uuid language sql stable security definer
set
    search_path = pg_catalog,
    public as $function$
select
    employee.id
from
    public.employees employee
where
    (
        employee.user_id = auth.uid()
        or lower(coalesce(employee.work_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    and lower(coalesce(employee.status, 'active')) = 'active'
    and employee.tenant_id = public.current_authenticated_profile_tenant_id()
order by
    employee.created_at desc nulls last
limit
    1;

$function$;

comment on function public.pa_current_employee_id() is 'Returns the active authenticated BexHR employee UUID in the current profile tenant for Performance Appraisal authorization.';

revoke all on function public.pa_current_employee_id()
from
    public;

revoke execute on function public.pa_current_employee_id()
from
    anon;

grant execute on function public.pa_current_employee_id() to authenticated,
service_role;

create
or replace function public.pa_current_user_is_hr_admin() returns boolean language sql stable security definer
set
    search_path = pg_catalog,
    public as $function$
select
    exists (
        select
            1
        from
            public.profiles profile
        where
            profile.id = auth.uid()
            and coalesce(profile.is_active, false) is true
            and lower(trim(coalesce(profile.role, ''))) = 'hr'
            and lower(trim(coalesce(profile.hr_access_level, ''))) = 'tenant_admin'
            and profile.tenant_id = public.current_authenticated_profile_tenant_id()
    );

$function$;

comment on function public.pa_current_user_is_hr_admin() is 'Returns true only for an active same-tenant BexHR HR profile with canonical tenant_admin access.';

revoke all on function public.pa_current_user_is_hr_admin()
from
    public;

revoke execute on function public.pa_current_user_is_hr_admin()
from
    anon;

grant execute on function public.pa_current_user_is_hr_admin() to authenticated,
service_role;

create
or replace function public.pa_current_user_is_primary_manager_of(p_employee_id uuid) returns boolean language sql stable security definer
set
    search_path = pg_catalog,
    public as $function$
select
    exists (
        select
            1
        from
            public.employee_reporting_lines reporting_line
            join public.employees managed_employee on managed_employee.id = reporting_line.employee_id
        where
            reporting_line.manager_employee_id = public.pa_current_employee_id()
            and reporting_line.employee_id = p_employee_id
            and lower(trim(coalesce(reporting_line.status, 'active'))) = 'active'
            and lower(
                trim(
                    coalesce(reporting_line.manager_type :: text, '')
                )
            ) = 'primary'
            and managed_employee.tenant_id = public.current_authenticated_profile_tenant_id()
            and (
                reporting_line.tenant_id is null
                or reporting_line.tenant_id = public.current_authenticated_profile_tenant_id()
            )
    );

$function$;

comment on function public.pa_current_user_is_primary_manager_of(uuid) is 'Returns true only when the authenticated BexHR employee has an active primary reporting-line relationship to the target same-tenant employee. Secondary-manager relationships do not grant Performance Appraisal manager authority.';

revoke all on function public.pa_current_user_is_primary_manager_of(uuid)
from
    public;

revoke execute on function public.pa_current_user_is_primary_manager_of(uuid)
from
    anon;

grant execute on function public.pa_current_user_is_primary_manager_of(uuid) to authenticated,
service_role;

/* --------------------------------------------------------------------------
 PERFORMANCE APPRAISAL TABLE PRIVILEGES

 RLS policies determine which rows each authenticated persona may access.

 - No authenticated DELETE access.
 - Progress updates are append-only.
 - Employee acknowledgements are terminal/append-only.
 - service_role retains trusted backend access.
 -------------------------------------------------------------------------- */
/* All supported personas require RLS-filtered read access. */
/* --------------------------------------------------------------------------
 PERFORMANCE APPRAISAL ROW LEVEL SECURITY

 Tenant-wide configuration records are readable only by supported BexHR
 identities in the current tenant. HR Admin is the only authenticated
 persona permitted to create or modify these records.
 -------------------------------------------------------------------------- */
/* Cycles */
create policy "PA supported users can read cycles" on public.pa_cycles for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            public.pa_current_employee_id() is not null
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create cycles" on public.pa_cycles for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

create policy "PA HR Admin can update cycles" on public.pa_cycles for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

/* Organisation goals */
create policy "PA supported users can read organisation goals" on public.pa_organisation_goals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            public.pa_current_employee_id() is not null
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create organisation goals" on public.pa_organisation_goals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

create policy "PA HR Admin can update organisation goals" on public.pa_organisation_goals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

/* Deliverables */
create policy "PA supported users can read deliverables" on public.pa_deliverables for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            public.pa_current_employee_id() is not null
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create deliverables" on public.pa_deliverables for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

create policy "PA HR Admin can update deliverables" on public.pa_deliverables for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

/* Department goals */
create policy "PA supported users can read department goals" on public.pa_department_goals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            public.pa_current_employee_id() is not null
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create department goals" on public.pa_department_goals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

create policy "PA HR Admin can update department goals" on public.pa_department_goals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

/* Templates */
create policy "PA supported users can read templates" on public.pa_templates for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            public.pa_current_employee_id() is not null
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create templates" on public.pa_templates for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

create policy "PA HR Admin can update templates" on public.pa_templates for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    );

/* --------------------------------------------------------------------------
 EMPLOYEE-SCOPED GOALS AND PROGRESS
 -------------------------------------------------------------------------- */
/* Individual goals */
create policy "PA authorised users can read individual goals" on public.pa_individual_goals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create individual goals" on public.pa_individual_goals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_individual_goals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

create policy "PA HR Admin can update individual goals" on public.pa_individual_goals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_individual_goals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

/* Progress updates */
create policy "PA authorised users can read progress updates" on public.pa_progress_updates for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA employees can create own progress updates" on public.pa_progress_updates for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and employee_id = public.pa_current_employee_id()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_progress_updates.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

/* --------------------------------------------------------------------------
 EMPLOYEE APPRAISAL, SELF APPRAISAL, AND MANAGER APPRAISAL ACCESS
 -------------------------------------------------------------------------- */
/* Employee appraisals */
create policy "PA authorised users can read employee appraisals" on public.pa_employee_appraisals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create employee appraisals" on public.pa_employee_appraisals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_employee_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
        and (
            manager_employee_id is null
            or exists (
                select
                    1
                from
                    public.employee_reporting_lines reporting_line
                where
                    reporting_line.employee_id = public.pa_employee_appraisals.employee_id
                    and reporting_line.manager_employee_id = public.pa_employee_appraisals.manager_employee_id
                    and lower(trim(coalesce(reporting_line.status, 'active'))) = 'active'
                    and lower(
                        trim(
                            coalesce(reporting_line.manager_type :: text, '')
                        )
                    ) = 'primary'
                    and (
                        reporting_line.tenant_id is null
                        or reporting_line.tenant_id = public.current_authenticated_profile_tenant_id()
                    )
            )
        )
    );

create policy "PA HR Admin can update employee appraisals" on public.pa_employee_appraisals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_employee_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
        and (
            manager_employee_id is null
            or exists (
                select
                    1
                from
                    public.employee_reporting_lines reporting_line
                where
                    reporting_line.employee_id = public.pa_employee_appraisals.employee_id
                    and reporting_line.manager_employee_id = public.pa_employee_appraisals.manager_employee_id
                    and lower(trim(coalesce(reporting_line.status, 'active'))) = 'active'
                    and lower(
                        trim(
                            coalesce(reporting_line.manager_type :: text, '')
                        )
                    ) = 'primary'
                    and (
                        reporting_line.tenant_id is null
                        or reporting_line.tenant_id = public.current_authenticated_profile_tenant_id()
                    )
            )
        )
    );

/* Self appraisals */
create policy "PA authorised users can read self appraisals" on public.pa_self_appraisals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA employees can create own self appraisals" on public.pa_self_appraisals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and employee_id = public.pa_current_employee_id()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_self_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

create policy "PA employees can update own self appraisals" on public.pa_self_appraisals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and employee_id = public.pa_current_employee_id()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and employee_id = public.pa_current_employee_id()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_self_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

/* Manager appraisals */
create policy "PA authorised users can read manager appraisals" on public.pa_manager_appraisals for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA primary managers can create manager appraisals" on public.pa_manager_appraisals for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and manager_employee_id = public.pa_current_employee_id()
        and public.pa_current_user_is_primary_manager_of(employee_id)
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_manager_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

create policy "PA primary managers can update manager appraisals" on public.pa_manager_appraisals for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and manager_employee_id = public.pa_current_employee_id()
        and public.pa_current_user_is_primary_manager_of(employee_id)
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and manager_employee_id = public.pa_current_employee_id()
        and public.pa_current_user_is_primary_manager_of(employee_id)
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_manager_appraisals.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

/* --------------------------------------------------------------------------
 HR FINALISATION AND EMPLOYEE ACKNOWLEDGEMENT ACCESS
 -------------------------------------------------------------------------- */
/* HR finalisations */
create policy "PA authorised users can read HR finalisations" on public.pa_hr_finalisations for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA HR Admin can create HR finalisations" on public.pa_hr_finalisations for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_hr_finalisations.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

create policy "PA HR Admin can update HR finalisations" on public.pa_hr_finalisations for
update
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
    ) with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and public.pa_current_user_is_hr_admin()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_hr_finalisations.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

/* Employee acknowledgements */
create policy "PA authorised users can read employee acknowledgements" on public.pa_employee_acknowledgements for
select
    to authenticated using (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and (
            employee_id = public.pa_current_employee_id()
            or public.pa_current_user_is_primary_manager_of(employee_id)
            or public.pa_current_user_is_hr_admin()
        )
    );

create policy "PA employees can create own acknowledgements" on public.pa_employee_acknowledgements for
insert
    to authenticated with check (
        tenant_id = public.current_authenticated_profile_tenant_id()
        and employee_id = public.pa_current_employee_id()
        and exists (
            select
                1
            from
                public.employees employee
            where
                employee.id = public.pa_employee_acknowledgements.employee_id
                and employee.tenant_id = public.current_authenticated_profile_tenant_id()
        )
    );

grant
select
    on table public.pa_cycles,
    public.pa_organisation_goals,
    public.pa_deliverables,
    public.pa_department_goals,
    public.pa_individual_goals,
    public.pa_progress_updates,
    public.pa_templates,
    public.pa_employee_appraisals,
    public.pa_self_appraisals,
    public.pa_manager_appraisals,
    public.pa_hr_finalisations,
    public.pa_employee_acknowledgements to authenticated;

/* RLS WITH CHECK policies will restrict who may create each record. */
grant
insert
    on table public.pa_cycles,
    public.pa_organisation_goals,
    public.pa_deliverables,
    public.pa_department_goals,
    public.pa_individual_goals,
    public.pa_progress_updates,
    public.pa_templates,
    public.pa_employee_appraisals,
    public.pa_self_appraisals,
    public.pa_manager_appraisals,
    public.pa_hr_finalisations,
    public.pa_employee_acknowledgements to authenticated;

/*
 Mutable records only.

 pa_progress_updates and pa_employee_acknowledgements are intentionally
 excluded because their authenticated workflows are append-only.
 */
grant
update
    on table public.pa_cycles,
    public.pa_organisation_goals,
    public.pa_deliverables,
    public.pa_department_goals,
    public.pa_individual_goals,
    public.pa_templates,
    public.pa_employee_appraisals,
    public.pa_self_appraisals,
    public.pa_manager_appraisals,
    public.pa_hr_finalisations to authenticated;

/* Trusted backend access; authenticated DELETE remains ungranted. */
grant all on table public.pa_cycles,
public.pa_organisation_goals,
public.pa_deliverables,
public.pa_department_goals,
public.pa_individual_goals,
public.pa_progress_updates,
public.pa_templates,
public.pa_employee_appraisals,
public.pa_self_appraisals,
public.pa_manager_appraisals,
public.pa_hr_finalisations,
public.pa_employee_acknowledgements to service_role;

/* --------------------------------------------------------------------------
 VERIFICATION
 -------------------------------------------------------------------------- */
do $pa_verify$ declare v_table_name text;

begin foreach v_table_name in array array [
    'pa_cycles',
    'pa_organisation_goals',
    'pa_deliverables',
    'pa_department_goals',
    'pa_individual_goals',
    'pa_progress_updates',
    'pa_templates',
    'pa_employee_appraisals',
    'pa_self_appraisals',
    'pa_manager_appraisals',
    'pa_hr_finalisations',
    'pa_employee_acknowledgements'
  ] loop if to_regclass('public.' || v_table_name) is null then raise exception 'Performance Appraisal verification failed: public.% was not created.',
v_table_name;

end if;

if not exists (
    select
        1
    from
        pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where
        namespace.nspname = 'public'
        and relation.relname = v_table_name
        and relation.relrowsecurity is true
) then raise exception 'Performance Appraisal verification failed: RLS is not enabled on public.%.',
v_table_name;

end if;

end loop;

end;

$pa_verify$;

commit;