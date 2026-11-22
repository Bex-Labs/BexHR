-- BEXHR PA FINAL CLEANUP
-- 2026-11-01
--
-- Scope:
--   1. Prevent a new PA cycle from becoming Active while another cycle is Active.
--   2. Preserve existing legacy/test multi-Active rows; this migration rewrites no cycle data.
--   3. Serialize competing activation attempts per tenant.
--
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.pa_cycles') is null then
    raise exception 'PA final cleanup stopped: public.pa_cycles is missing.';
  end if;

  if to_regnamespace('bexhr_private') is null then
    raise exception 'PA final cleanup stopped: bexhr_private schema is missing.';
  end if;
end;
$preflight$;

create or replace function bexhr_private.enforce_pa_single_active_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(trim(coalesce(new.status, ''))) <> 'active' then
    return new;
  end if;

  -- Existing Active rows may still be updated or completed. The rule applies
  -- only when a row is newly entering Active state.
  if tg_op = 'UPDATE' then
    if lower(trim(coalesce(old.status, ''))) = 'active' then
      return new;
    end if;
  end if;

  -- Serialize activation attempts for this tenant so two concurrent Draft
  -- cycles cannot both pass the check. Hash collisions only cause harmless
  -- extra serialization between tenants.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.tenant_id::text)::bigint
  );

  if exists (
    select 1
    from public.pa_cycles existing_cycle
    where existing_cycle.tenant_id = new.tenant_id
      and existing_cycle.id <> new.id
      and lower(trim(coalesce(existing_cycle.status, ''))) = 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PA_SINGLE_ACTIVE_CYCLE: Another appraisal cycle is already Active. Complete or clear the current Active cycle before activating another.';
  end if;

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_pa_single_active_cycle()
from public, anon, authenticated, service_role;

drop trigger if exists bexhr_enforce_pa_single_active_cycle
on public.pa_cycles;

create trigger bexhr_enforce_pa_single_active_cycle
before insert or update of status
on public.pa_cycles
for each row
execute function bexhr_private.enforce_pa_single_active_cycle();

comment on function bexhr_private.enforce_pa_single_active_cycle() is
'Blocks only new transitions into Active state when another same-tenant PA cycle is already Active. Existing legacy/test multi-Active rows are not rewritten.';

do $verify$
declare
  v_function_oid oid;
  v_definition text;
begin
  v_function_oid := to_regprocedure(
    'bexhr_private.enforce_pa_single_active_cycle()'
  );

  if v_function_oid is null then
    raise exception 'PA final cleanup verification failed: single-Active trigger function is missing.';
  end if;

  select pg_get_functiondef(v_function_oid)
  into v_definition;

  if position('BEXHR_PA_SINGLE_ACTIVE_CYCLE' in v_definition) = 0 then
    raise exception 'PA final cleanup verification failed: single-Active fail-closed marker is missing.';
  end if;

  if position('pg_advisory_xact_lock' in v_definition) = 0 then
    raise exception 'PA final cleanup verification failed: activation serialization is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.pa_cycles'::regclass
      and trigger_row.tgname = 'bexhr_enforce_pa_single_active_cycle'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'PA final cleanup verification failed: single-Active trigger is missing.';
  end if;
end;
$verify$;

commit;
