-- ADMIN DELETE ACTIONS
-- Captures Supabase RPCs required by js/admin-dashboard.js.
-- These functions support:
-- 1. Removing user company access without deleting the Auth user.
-- 2. Guarded company deletion only when no tenant-linked records exist.

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
begin
  select lower(coalesce(role, ''))
  into caller_role
  from public.profiles
  where id = auth.uid();

  if caller_role <> 'admin' then
    return query
    select false, 'Only Admin users can remove company access.';
    return;
  end if;

  if target_profile_id is null then
    return query
    select false, 'No user profile was selected.';
    return;
  end if;

  update public.profiles
  set
    tenant_id = null,
    tenant_code = null,
    updated_at = now()
  where id = target_profile_id;

  if not found then
    return query
    select false, 'The selected user profile could not be found.';
    return;
  end if;

  return query
  select true, 'User company access was removed successfully.';
end;
$$;

grant execute on function public.admin_remove_profile_tenant_access(uuid) to authenticated;


create or replace function public.admin_delete_tenant_if_safe(
  target_tenant_id uuid
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
  target_company_name text;
  target_company_code text;
  linked_table record;
  linked_count integer;
begin
  select lower(coalesce(role, ''))
  into caller_role
  from public.profiles
  where id = auth.uid();

  if caller_role <> 'admin' then
    return query
    select false, 'Only Admin users can delete company records.';
    return;
  end if;

  if target_tenant_id is null then
    return query
    select false, 'No company record was selected.';
    return;
  end if;

  select company_name, tenant_code
  into target_company_name, target_company_code
  from public.tenants
  where id = target_tenant_id;

  if target_company_name is null then
    return query
    select false, 'The selected company record could not be found.';
    return;
  end if;

  /*
    Guarded delete:
    Block company deletion if any public table still has rows linked
    through tenant_id. This protects employees, profiles, payroll, leave,
    departments, email setup, logs, and future tenant-scoped records.
  */
  for linked_table in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and c.table_name <> 'tenants'
      and t.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format(
      'select count(*) from %I.%I where tenant_id::text = $1',
      linked_table.table_schema,
      linked_table.table_name
    )
    into linked_count
    using target_tenant_id::text;

    if linked_count > 0 then
      return query
      select
        false,
        format(
          'Company "%s" (%s) cannot be deleted because %s linked record(s) exist in %s. Set the company to Inactive instead.',
          target_company_name,
          coalesce(target_company_code, '--'),
          linked_count,
          linked_table.table_name
        );
      return;
    end if;
  end loop;

  delete from public.tenants
  where id = target_tenant_id;

  if not found then
    return query
    select false, 'The selected company record could not be deleted.';
    return;
  end if;

  return query
  select
    true,
    format(
      'Company "%s" (%s) was deleted successfully.',
      target_company_name,
      coalesce(target_company_code, '--')
    );
end;
$$;

grant execute on function public.admin_delete_tenant_if_safe(uuid) to authenticated;