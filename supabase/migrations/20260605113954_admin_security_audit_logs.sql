-- HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 4A-1
-- Admin security audit log for sensitive platform actions such as HR MFA reset.
-- This table is append-only from the application perspective.
-- Edge Functions insert audit rows using service-role access.
-- Admins read logs through a controlled RPC, not direct unrestricted table access.

create table if not exists public.admin_security_audit_logs (
  id uuid primary key default gen_random_uuid(),

  event_type text not null,
  action_status text not null default 'success',

  actor_user_id uuid,
  actor_email text,

  target_user_id uuid,
  target_email text,
  target_role text,
  target_tenant_id uuid,

  deleted_factor_count integer not null default 0,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.admin_security_audit_logs is
  'Append-only Admin security audit log for sensitive platform actions such as HR MFA reset.';

comment on column public.admin_security_audit_logs.event_type is
  'Security event key, for example hr_mfa_reset.';

comment on column public.admin_security_audit_logs.action_status is
  'Outcome of the action, for example success, failed, or skipped.';

comment on column public.admin_security_audit_logs.deleted_factor_count is
  'Number of MFA factors removed during the action, where applicable.';

create index if not exists idx_admin_security_audit_logs_created_at
  on public.admin_security_audit_logs (created_at desc);

create index if not exists idx_admin_security_audit_logs_event_type
  on public.admin_security_audit_logs (event_type);

create index if not exists idx_admin_security_audit_logs_actor_user_id
  on public.admin_security_audit_logs (actor_user_id);

create index if not exists idx_admin_security_audit_logs_target_user_id
  on public.admin_security_audit_logs (target_user_id);

alter table public.admin_security_audit_logs enable row level security;

-- HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 4A-1
-- No broad table policies are added here.
-- Admin reads are exposed through the security-definer RPC below.
revoke all on public.admin_security_audit_logs from anon;
revoke all on public.admin_security_audit_logs from authenticated;

-- HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 4A-1
-- Admin-only read RPC for recent security audit events.
-- This avoids weakening RLS on the audit table.
create or replace function public.admin_list_security_audit_logs(
  p_event_type text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  event_type text,
  action_status text,
  actor_user_id uuid,
  actor_email text,
  target_user_id uuid,
  target_email text,
  target_role text,
  target_tenant_id uuid,
  deleted_factor_count integer,
  details jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
      and coalesce(p.is_active, true) = true
  ) then
    raise exception 'Only active Admin users can view security audit logs.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  return query
  select
    l.id,
    l.event_type,
    l.action_status,
    l.actor_user_id,
    l.actor_email,
    l.target_user_id,
    l.target_email,
    l.target_role,
    l.target_tenant_id,
    l.deleted_factor_count,
    l.details,
    l.created_at
  from public.admin_security_audit_logs l
  where p_event_type is null
     or l.event_type = p_event_type
  order by l.created_at desc
  limit v_limit;
end;
$$;

grant execute on function public.admin_list_security_audit_logs(text, integer)
  to authenticated;