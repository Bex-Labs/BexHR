-- ============================================================
-- BEXHR PHASE 3R-D - TENANT STAFF LEVEL SUGGESTION LEARNING
--
-- Purpose:
--   Remember genuinely new Staff Level text after successful Salary Setup saves.
--   Suggestions are tenant-owned and never global/cross-tenant fallbacks.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $phase_3rd_preflight$
begin
  if to_regclass('public.tenants') is null
     or to_regclass('public.profiles') is null
  then
    raise exception
      'Phase 3R-D stopped: required tenants/profiles tables are missing.';
  end if;

  if to_regprocedure('public.current_authenticated_profile_tenant_id()') is null then
    raise exception
      'Phase 3R-D stopped: current_authenticated_profile_tenant_id() is missing.';
  end if;
end;
$phase_3rd_preflight$;

create table if not exists public.payroll_staff_level_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id)
    on update cascade
    on delete cascade,
  label text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint payroll_staff_level_suggestions_label_not_blank
    check (nullif(btrim(label), '') is not null)
);

create unique index if not exists
  payroll_staff_level_suggestions_tenant_label_unique
on public.payroll_staff_level_suggestions (
  tenant_id,
  lower(btrim(label))
);

alter table public.payroll_staff_level_suggestions
enable row level security;

drop policy if exists
  "Tenant HR can read payroll staff level suggestions"
on public.payroll_staff_level_suggestions;

drop policy if exists
  "Tenant HR can create payroll staff level suggestions"
on public.payroll_staff_level_suggestions;

create policy "Tenant HR can read payroll staff level suggestions"
on public.payroll_staff_level_suggestions
for select
to authenticated
using (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in ('hr', 'hr_manager')
  )
);

create policy "Tenant HR can create payroll staff level suggestions"
on public.payroll_staff_level_suggestions
for insert
to authenticated
with check (
  tenant_id = public.current_authenticated_profile_tenant_id()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in ('hr', 'hr_manager')
  )
);

revoke all on table public.payroll_staff_level_suggestions
from public, anon, authenticated;

grant select, insert on table public.payroll_staff_level_suggestions
to authenticated;

grant all on table public.payroll_staff_level_suggestions
to service_role;

do $phase_3rd_verify$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'payroll_staff_level_suggestions'
      and indexname = 'payroll_staff_level_suggestions_tenant_label_unique'
  ) then
    raise exception
      'Phase 3R-D verification failed: normalized tenant label uniqueness index is missing.';
  end if;
end;
$phase_3rd_verify$;

commit;
