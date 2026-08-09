/*
  BexHR System-wide Employee/Profile Name Synchronisation - v1.0.0

  PURPOSE
  -------
  Keep the linked login profile identity aligned with the authoritative
  HR employee record.

  HR maintains the employee's legal/display identity through:
  - employees.first_name
  - employees.middle_name
  - employees.last_name

  Manager and HR dashboard headers currently read profiles.full_name.
  Without this synchronisation, HR may successfully update an employee
  while the linked account continues showing the previous name.

  BEHAVIOUR
  ---------
  Employee name changes:
      employees
          -> linked profile
          -> profiles.full_name

  This is shared across all tenants.

  SECURITY / SCOPE
  ----------------
  - No frontend profile write is introduced.
  - No role is changed.
  - No HR access level is changed.
  - No tenant assignment is changed.
  - No payroll, leave, reporting line or authentication data is changed.
*/

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';


/* =========================================================
   PREFLIGHT
   ========================================================= */

do $employee_profile_name_sync_preflight$
begin
  if to_regclass('public.employees') is null then
    raise exception
      'Employee/profile name sync stopped: public.employees does not exist.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception
      'Employee/profile name sync stopped: public.profiles does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'user_id'
  ) then
    raise exception
      'Employee/profile name sync stopped: employees.user_id is missing.';
  end if;
end;
$employee_profile_name_sync_preflight$;


/* =========================================================
   AUTHORITATIVE SYNC FUNCTION

   Runs inside the database so HR browser code never needs
   permission to update another user's profile directly.
   ========================================================= */

create or replace function public.hrp_sync_employee_name_to_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_full_name text;
begin
  /*
    Build the same HR-controlled employee name used elsewhere
    in BexHR. concat_ws safely ignores a missing middle name.
  */
  v_full_name := nullif(
    trim(
      concat_ws(
        ' ',
        new.first_name,
        new.middle_name,
        new.last_name
      )
    ),
    ''
  );

  /*
    An employee without a linked login profile has nothing to
    synchronise yet. Login provisioning/linkage can continue
    through the existing workflow.
  */
  if new.user_id is null or v_full_name is null then
    return new;
  end if;

  /*
    Update only the linked profile identity.

    IS DISTINCT FROM prevents unnecessary profile updates and
    avoids generating redundant audit activity when the name
    has not actually changed.
  */
  update public.profiles profile
  set full_name = v_full_name
  where profile.id = new.user_id
    and profile.full_name is distinct from v_full_name;

  return new;
end;
$function$;


/* =========================================================
   EMPLOYEE NAME TRIGGER

   Fire only for fields capable of changing the linked
   account's displayed employee identity.
   ========================================================= */

drop trigger if exists
  trg_hrp_sync_employee_name_to_profile
on public.employees;

create trigger trg_hrp_sync_employee_name_to_profile
after insert or update of
  first_name,
  middle_name,
  last_name,
  user_id
on public.employees
for each row
execute function public.hrp_sync_employee_name_to_profile();


/* =========================================================
   ONE-TIME BACKFILL

   Bring already-linked profiles into alignment immediately,
   including names HR changed before this trigger existed.

   One employee is selected per linked profile using the most
   recently updated employee record.
   ========================================================= */

with authoritative_employee_identity as (
  select distinct on (employee.user_id)
    employee.user_id,
    employee.tenant_id,
    nullif(
      trim(
        concat_ws(
          ' ',
          employee.first_name,
          employee.middle_name,
          employee.last_name
        )
      ),
      ''
    ) as employee_full_name
  from public.employees employee
  where employee.user_id is not null
  order by
    employee.user_id,
    employee.updated_at desc nulls last,
    employee.created_at desc nulls last
)
update public.profiles profile
set full_name = identity.employee_full_name
from authoritative_employee_identity identity
where profile.id = identity.user_id
  and identity.employee_full_name is not null
  and (
    profile.tenant_id is null
    or identity.tenant_id = profile.tenant_id
  )
  and profile.full_name is distinct from identity.employee_full_name;


/* =========================================================
   VERIFICATION
   ========================================================= */

do $employee_profile_name_sync_verify$
begin
  if to_regprocedure(
    'public.hrp_sync_employee_name_to_profile()'
  ) is null then
    raise exception
      'Employee/profile name sync verification failed: trigger function is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'employees'
      and trigger_record.tgname =
        'trg_hrp_sync_employee_name_to_profile'
      and not trigger_record.tgisinternal
  ) then
    raise exception
      'Employee/profile name sync verification failed: employee trigger is missing.';
  end if;
end;
$employee_profile_name_sync_verify$;


commit;