-- ADMIN DELETE ACTIONS - CLEAR VALIDATION HISTORY
-- Supports Admin Email Setup > Clear Validation History.
-- Deletes only email_delivery_logs rows for the selected company.
-- Does not delete approved recipients, users, companies, or external provider records.

create or replace function public.admin_clear_email_validation_history(
  target_tenant_id uuid
)
returns table (
  success boolean,
  deleted_count integer,
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
  v_deleted_count integer := 0;
begin
  select lower(coalesce(role, ''))
  into caller_role
  from public.profiles
  where id = auth.uid();

  if caller_role <> 'admin' then
    return query
    select false, 0, 'Only Admin users can clear validation history.';
    return;
  end if;

  if target_tenant_id is null then
    return query
    select false, 0, 'No company record was selected.';
    return;
  end if;

  select company_name, tenant_code
  into target_company_name, target_company_code
  from public.tenants
  where id = target_tenant_id;

  if target_company_name is null then
    return query
    select false, 0, 'The selected company record could not be found.';
    return;
  end if;

  delete from public.email_delivery_logs
  where tenant_id = target_tenant_id;

  get diagnostics v_deleted_count = row_count;

  return query
  select
    true,
    v_deleted_count,
    format(
      'Cleared %s validation history record(s) for "%s" (%s).',
      v_deleted_count,
      target_company_name,
      coalesce(target_company_code, '--')
    );
end;
$$;

grant execute on function public.admin_clear_email_validation_history(uuid) to authenticated;