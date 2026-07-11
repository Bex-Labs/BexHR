-- ADMIN COMPANY ACCESS REMOVAL FIX
-- Corrects admin_remove_profile_tenant_access so it updates only columns
-- that exist on public.profiles.
--
-- This action removes company access only.
-- It does not delete the profile or Supabase Auth account.

create or replace function public.admin_remove_profile_tenant_access(
  target_profile_id uuid
)
returns table (
  success boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_is_active boolean;
  target_role text;
  target_tenant_id uuid;
begin
  select
    lower(coalesce(role, '')),
    coalesce(is_active, false)
  into
    caller_role,
    caller_is_active
  from public.profiles
  where id = auth.uid();

  if caller_role <> 'admin' or caller_is_active is not true then
    return query
    select false, 'Only an active Admin can remove company access.';
    return;
  end if;

  if target_profile_id is null then
    return query
    select false, 'No user profile was selected.';
    return;
  end if;

  if target_profile_id = auth.uid() then
    return query
    select false, 'You cannot remove your own Admin company access.';
    return;
  end if;

  select
    lower(coalesce(role, '')),
    tenant_id
  into
    target_role,
    target_tenant_id
  from public.profiles
  where id = target_profile_id;

  if not found then
    return query
    select false, 'The selected user profile could not be found.';
    return;
  end if;

  if target_role = 'admin' then
    return query
    select false, 'Platform Admin access cannot be removed through company access setup.';
    return;
  end if;

  if target_tenant_id is null then
    return query
    select false, 'The selected user is not linked to a company workspace.';
    return;
  end if;

  update public.profiles
  set
    tenant_id = null,
    updated_at = now()
  where id = target_profile_id;

  return query
  select true, 'User company access was removed successfully.';
end;
$$;

revoke all on function public.admin_remove_profile_tenant_access(uuid)
from public;

grant execute on function public.admin_remove_profile_tenant_access(uuid)
to authenticated;