-- BEXHR PA MANAGER POSITION-SCOPE RESOLVER
--
-- Returns only the authenticated user's own employee/job-title scope.
-- Raw employees.department is deliberately not used as position authority.

create or replace function public.pa_get_my_position_scope()
returns table (
  employee_id uuid,
  job_title text,
  position_scope text,
  position_id uuid,
  is_ambiguous boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid :=
    (select auth.uid());

  v_tenant_id uuid;

  v_email text :=
    lower(
      trim(
        coalesce(
          (select auth.jwt() ->> 'email'),
          ''
        )
      )
    );

  v_employee_id uuid;
  v_job_title text;

  v_whole_position_count integer := 0;
  v_department_position_count integer := 0;

  v_whole_position_ids uuid[] :=
    '{}'::uuid[];
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_AUTH_REQUIRED: Authentication is required.';
  end if;

  select profile.tenant_id
  into v_tenant_id
  from public.profiles profile
  where profile.id = v_user_id
    and coalesce(
      profile.is_active,
      true
    ) = true
  limit 1;

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_TENANT_NOT_RESOLVED: The authenticated user does not have an active company workspace.';
  end if;

  select
    employee.id,
    nullif(
      trim(
        coalesce(
          employee.job_title,
          ''
        )
      ),
      ''
    )
  into
    v_employee_id,
    v_job_title
  from public.employees employee
  where employee.tenant_id =
        v_tenant_id
    and lower(
      trim(
        coalesce(
          employee.status,
          'active'
        )
      )
    ) = 'active'
    and (
      employee.user_id =
        v_user_id
      or (
        employee.user_id is null
        and v_email <> ''
        and lower(
          trim(
            coalesce(
              employee.work_email,
              ''
            )
          )
        ) = v_email
      )
    )
  order by
    case
      when employee.user_id =
           v_user_id
        then 0
      else 1
    end,
    employee.created_at desc
      nulls last
  limit 1;

  if v_employee_id is null then
    raise exception using
      errcode = '42501',
      message =
        'BEXHR_PA_EMPLOYEE_NOT_RESOLVED: The authenticated user does not have an active employee record.';
  end if;

  if v_job_title is null then
    return query
    select
      v_employee_id,
      null::text,
      'unconfigured'::text,
      null::uuid,
      false;

    return;
  end if;

  select
    count(*) filter (
      where position.department_id
            is null
    )::integer,

    coalesce(
      array_agg(
        position.id
        order by position.id
      ) filter (
        where position.department_id
              is null
      ),
      '{}'::uuid[]
    ),

    count(*) filter (
      where position.department_id
            is not null
    )::integer

  into
    v_whole_position_count,
    v_whole_position_ids,
    v_department_position_count

  from public.organization_job_titles position

  where (
    position.tenant_id =
      v_tenant_id
    or position.tenant_id
       is null
  )
    and lower(
      trim(
        coalesce(
          position.status,
          'active'
        )
      )
    ) = 'active'
    and lower(
      trim(
        coalesce(
          position.job_title,
          ''
        )
      )
    ) =
    lower(v_job_title);

  return query
  select
    v_employee_id,
    v_job_title,

    case
      when
        v_whole_position_count = 1
        and
        v_department_position_count = 0
        then 'organization'

      when
        v_whole_position_count = 0
        and
        v_department_position_count > 0
        then 'department'

      when
        v_whole_position_count = 0
        and
        v_department_position_count = 0
        then 'unconfigured'

      else 'ambiguous'
    end::text,

    case
      when
        v_whole_position_count = 1
        and
        v_department_position_count = 0
        then v_whole_position_ids[1]
      else null
    end::uuid,

    (
      v_whole_position_count > 1
      or (
        v_whole_position_count > 0
        and
        v_department_position_count > 0
      )
    );
end;
$function$;


revoke all
on function public.pa_get_my_position_scope()
from public;

revoke all
on function public.pa_get_my_position_scope()
from anon;

grant execute
on function public.pa_get_my_position_scope()
to authenticated;


comment on function
  public.pa_get_my_position_scope()
is
  'Returns only the authenticated employee own canonical Job Title scope for PA UI routing.';


do $verify$
declare
  v_oid oid;
begin
  select to_regprocedure(
    'public.pa_get_my_position_scope()'
  )::oid
  into v_oid;

  if v_oid is null then
    raise exception
      'PA manager position-scope verification failed: function missing.';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = v_oid
      and procedure.prosecdef = true
  ) then
    raise exception
      'PA manager position-scope verification failed: protected resolver is not SECURITY DEFINER.';
  end if;

  if has_function_privilege(
    'anon',
    v_oid,
    'EXECUTE'
  ) then
    raise exception
      'PA manager position-scope verification failed: anon can execute resolver.';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_oid,
    'EXECUTE'
  ) then
    raise exception
      'PA manager position-scope verification failed: authenticated cannot execute resolver.';
  end if;
end;
$verify$;
