CREATE OR REPLACE FUNCTION public.bexhr_bc_v9_promote_existing_highest(p_position_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid;
  v_path uuid[] := ARRAY[]::uuid[];
  v_current uuid;
  v_parent uuid;
  v_previous uuid;
  v_root uuid;
  v_roots integer;
  v_title text;
  v_root_title text;
  v_idx integer;
  v_count_before integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as an authorised HR Admin.'
      USING ERRCODE='42501';
  END IF;

  v_tenant := public.require_current_tenant_administrator();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tenant::text)::bigint);
  IF p_position_id IS NULL THEN
    RAISE EXCEPTION 'Select a position before changing the highest position.'
      USING ERRCODE='22023';
  END IF;

  SELECT j.job_title INTO v_title
    FROM public.organization_job_titles j
   WHERE j.tenant_id=v_tenant AND j.id=p_position_id
     AND lower(pg_catalog.btrim(coalesce(j.status,'')))='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected position is unavailable or inactive.'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*)::integer,(array_agg(h.job_title_id))[1]
    INTO v_roots,v_root
    FROM public.organization_job_title_hierarchy h
   WHERE h.tenant_id=v_tenant AND h.reports_to_job_title_id IS NULL;
  IF v_roots<>1 THEN
    RAISE EXCEPTION 'The company must have exactly one existing highest position.'
      USING ERRCODE='23514';
  END IF;
  IF p_position_id=v_root THEN
    RAISE EXCEPTION 'This position is already highest.'
      USING ERRCODE='23514';
  END IF;

  SELECT j.job_title INTO v_root_title
    FROM public.organization_job_titles j
   WHERE j.id=v_root AND j.tenant_id=v_tenant
     AND lower(pg_catalog.btrim(coalesce(j.status,'')))='active';
  IF v_root_title IS NULL THEN
    RAISE EXCEPTION 'Current highest position is not an active company position.'
      USING ERRCODE='23514';
  END IF;

  v_current:=p_position_id;
  LOOP
    IF coalesce(array_length(v_path,1),0)>=128 OR v_current=ANY(v_path) THEN
      RAISE EXCEPTION 'Circular or excessive organisational reporting chain.'
        USING ERRCODE='23514';
    END IF;
    SELECT h.reports_to_job_title_id INTO v_parent
      FROM public.organization_job_title_hierarchy h
      JOIN public.organization_job_titles j
        ON j.id=h.job_title_id AND j.tenant_id=h.tenant_id
     WHERE h.tenant_id=v_tenant AND h.job_title_id=v_current
       AND lower(pg_catalog.btrim(coalesce(j.status,'')))='active'
     FOR UPDATE OF h;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Configure this position under the current highest position first.'
        USING ERRCODE='23514';
    END IF;
    v_path:=array_append(v_path,v_current);
    EXIT WHEN v_parent IS NULL;
    v_current:=v_parent;
  END LOOP;

  IF v_current<>v_root THEN
    RAISE EXCEPTION 'Selected position is not connected to the existing highest position.'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*)::integer INTO v_count_before
    FROM public.employee_reporting_lines rl
   WHERE lower(pg_catalog.btrim(coalesce(rl.manager_type,'')))='primary'
     AND lower(pg_catalog.btrim(coalesce(rl.status,'active')))='active'
     AND rl.tenant_id=v_tenant;
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines rl
     WHERE rl.tenant_id=v_tenant
       AND lower(pg_catalog.btrim(coalesce(rl.manager_type,'')))='primary'
       AND lower(pg_catalog.btrim(coalesce(rl.status,'active')))='active'
       AND NOT bexhr_private.h11_current_primary_authority(rl.employee_id,rl.manager_employee_id)
  ) THEN
    RAISE EXCEPTION 'An existing Primary Manager needs reconciliation before highest-position changes.'
      USING ERRCODE='23514';
  END IF;

  -- The selected path is reversed only. All other position edges stay unchanged.
  -- Statement-level changes are atomic in PostgreSQL; any failure rolls them all back.
  FOR v_idx IN 1..array_length(v_path,1) LOOP
    v_previous:=CASE WHEN v_idx=1 THEN NULL ELSE v_path[v_idx-1] END;
    UPDATE public.organization_job_title_hierarchy h
       SET reports_to_job_title_id=v_previous,
           updated_by=auth.uid(),
           updated_at=now()
     WHERE h.tenant_id=v_tenant AND h.job_title_id=v_path[v_idx];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Organisation structure changed during review; refresh and try again.'
        USING ERRCODE='40001';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.organization_job_title_hierarchy h
      WHERE h.tenant_id=v_tenant AND h.reports_to_job_title_id IS NULL)<>1
     OR (SELECT h.job_title_id FROM public.organization_job_title_hierarchy h
         WHERE h.tenant_id=v_tenant AND h.reports_to_job_title_id IS NULL
         LIMIT 1) IS DISTINCT FROM p_position_id
  THEN
    RAISE EXCEPTION 'Single-highest-position protection failed; nothing was saved.'
      USING ERRCODE='23514';
  END IF;

  IF (SELECT count(*) FROM public.employee_reporting_lines rl
      WHERE rl.tenant_id=v_tenant
        AND lower(pg_catalog.btrim(coalesce(rl.manager_type,'')))='primary'
        AND lower(pg_catalog.btrim(coalesce(rl.status,'active')))='active'
     ) <> v_count_before
     OR EXISTS (
       SELECT 1 FROM public.employee_reporting_lines rl
        WHERE rl.tenant_id=v_tenant
          AND lower(pg_catalog.btrim(coalesce(rl.manager_type,'')))='primary'
          AND lower(pg_catalog.btrim(coalesce(rl.status,'active')))='active'
          AND NOT bexhr_private.h11_current_primary_authority(rl.employee_id,rl.manager_employee_id)
     )
  THEN
    RAISE EXCEPTION
      'Promotion would invalidate existing employee Primary Manager authority. No hierarchy change was saved. Reconcile employee reporting managers before promoting this position.'
      USING ERRCODE='23514';
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'highest_position_id',p_position_id,
    'highest_position',v_title,
    'previous_highest_position',v_root_title,
    'reversed_position_links',array_length(v_path,1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bexhr_bc_v9_promote_existing_highest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bexhr_bc_v9_promote_existing_highest(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bexhr_bc_v9_promote_existing_highest(uuid) TO authenticated;