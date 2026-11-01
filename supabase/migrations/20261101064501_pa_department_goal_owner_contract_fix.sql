begin;

do $fix$
declare
  v_oid oid;
  v_definition text;
  v_rewritten text;
begin
  v_oid := to_regprocedure(
    'bex_pa_private.validate_goal_write()'
  );

  if v_oid is null then
    raise exception
      'PA owner-contract fix stopped: validate_goal_write() is missing.';
  end if;

  select pg_get_functiondef(v_oid)
  into v_definition;

  if position(
    'Department goal owner is required'
    in v_definition
  ) = 0 then
    raise notice
      'PA owner-contract fix: obsolete owner requirement is already absent.';
    return;
  end if;

  /*
   * Preserve the complete current validation function.
   * Disable only the obsolete Responsible Owner exception.
   */
  v_rewritten := regexp_replace(
    v_definition,
    $re$raise[[:space:]]+exception[[:space:]]+'Department goal owner is required';$re$,
    'null;',
    'i'
  );

  if v_rewritten = v_definition
     or position(
       'Department goal owner is required'
       in v_rewritten
     ) > 0 then
    raise exception
      'PA owner-contract fix stopped: obsolete owner rule could not be isolated safely.';
  end if;

  execute v_rewritten;

  select pg_get_functiondef(
    to_regprocedure(
      'bex_pa_private.validate_goal_write()'
    )
  )
  into v_definition;

  if position(
    'Department goal owner is required'
    in v_definition
  ) > 0 then
    raise exception
      'PA owner-contract fix verification failed.';
  end if;
end;
$fix$;

commit;