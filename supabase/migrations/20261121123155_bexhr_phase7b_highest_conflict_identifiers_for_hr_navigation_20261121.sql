CREATE OR REPLACE FUNCTION public.bexhr_p7b_preflight_highest_position(p_position_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_tenant uuid;
 v_root uuid;
 v_roots integer;
 v_label text;
 v_root_label text;
 v_path uuid[]:=ARRAY[]::uuid[];
 v_cursor uuid;
 v_parent uuid;
 v_count integer;
 v_invalid integer;
 v_blocked integer;
 v_conflicting_employees jsonb := '[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL THEN
   RAISE EXCEPTION 'Sign in as an authorised HR Admin.' USING ERRCODE='42501';
 END IF;
 v_tenant:=public.require_current_tenant_administrator();
 IF p_position_id IS NULL THEN
   RETURN jsonb_build_object('allowed',false,'reason','Select a position.');
 END IF;
 SELECT job_title INTO v_label FROM public.organization_job_titles
 WHERE id=p_position_id AND tenant_id=v_tenant AND lower(btrim(coalesce(status,'')))='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','Selected position is inactive or unavailable.'); END IF;
 SELECT count(*)::integer,(array_agg(job_title_id))[1] INTO v_roots,v_root
 FROM public.organization_job_title_hierarchy
 WHERE tenant_id=v_tenant AND reports_to_job_title_id IS NULL;
 IF v_roots<>1 THEN RETURN jsonb_build_object('allowed',false,'reason','The organisation must have exactly one configured highest position.'); END IF;
 SELECT job_title INTO v_root_label FROM public.organization_job_titles
 WHERE id=v_root AND tenant_id=v_tenant AND lower(btrim(coalesce(status,'')))='active';
 IF v_root_label IS NULL THEN RETURN jsonb_build_object('allowed',false,'reason','The current highest position is unavailable.'); END IF;
 IF v_root=p_position_id THEN
   RETURN jsonb_build_object('allowed',false,'reason','This position is already highest.','highest_position',v_root_label);
 END IF;
 v_cursor:=p_position_id;
 LOOP
   IF coalesce(array_length(v_path,1),0)>=128 OR v_cursor=ANY(v_path) THEN
      RETURN jsonb_build_object('allowed',false,'reason','The saved reporting hierarchy is circular or invalid.');
   END IF;
   SELECT reports_to_job_title_id INTO v_parent
   FROM public.organization_job_title_hierarchy
   WHERE tenant_id=v_tenant AND job_title_id=v_cursor;
   IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','Connect this position to the saved reporting hierarchy first.'); END IF;
   v_path:=array_append(v_path,v_cursor);
   EXIT WHEN v_parent IS NULL;
   v_cursor:=v_parent;
 END LOOP;
 IF v_cursor IS DISTINCT FROM v_root THEN
   RETURN jsonb_build_object('allowed',false,'reason','Selected position is not connected to the current highest position.');
 END IF;

 SELECT count(*)::integer INTO v_invalid
 FROM public.employee_reporting_lines rl
 WHERE (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL)
 AND lower(btrim(coalesce(rl.manager_type,'')))='primary'
 AND lower(btrim(coalesce(rl.status,'active')))='active'
 AND EXISTS(SELECT 1 FROM public.employees e WHERE e.id=rl.employee_id AND e.tenant_id=v_tenant)
 AND NOT bexhr_private.h11_current_primary_authority(rl.employee_id,rl.manager_employee_id);
 IF v_invalid>0 THEN
   RETURN jsonb_build_object('allowed',false,'reason','Reconcile the existing Primary Manager assignments before changing the highest position.','conflicting_primary_count',v_invalid);
 END IF;

 -- Read-only prediction: treat selected-to-current-root path as reversed.
 -- No employee or hierarchy rows are altered.
 WITH RECURSIVE path AS (
   SELECT v_path[idx] AS position_id,idx AS ord FROM pg_catalog.generate_subscripts(v_path,1) idx
 ), revised AS (
   SELECT h.job_title_id,
      CASE WHEN p.position_id IS NOT NULL
           THEN (SELECT previous.position_id FROM path previous WHERE previous.ord=p.ord-1)
           ELSE h.reports_to_job_title_id END AS parent_id,
      h.reports_to_job_title_id AS original_parent
   FROM public.organization_job_title_hierarchy h
   LEFT JOIN path p ON p.position_id=h.job_title_id
   WHERE h.tenant_id=v_tenant
 ), current_lines AS (
   SELECT rl.employee_id,rl.manager_employee_id,
          bexhr_private.p7b_resolve_employee_position_id(rl.employee_id) child_position,
          bexhr_private.p7b_resolve_employee_position_id(rl.manager_employee_id) manager_position
   FROM public.employee_reporting_lines rl
   JOIN public.employees e ON e.id=rl.employee_id AND e.tenant_id=v_tenant
   WHERE lower(btrim(coalesce(rl.manager_type,'')))='primary'
     AND lower(btrim(coalesce(rl.status,'active')))='active'
     AND (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL)
 ), walk AS (
   SELECT l.employee_id, revised.parent_id AS ancestor, 1 AS depth,
          ARRAY[l.child_position]::uuid[] AS visited
   FROM current_lines l JOIN revised ON revised.job_title_id=l.child_position
   UNION ALL
   SELECT w.employee_id, r.parent_id,w.depth+1,w.visited||w.ancestor
   FROM walk w JOIN revised r ON r.job_title_id=w.ancestor
   WHERE w.ancestor IS NOT NULL AND NOT w.ancestor=ANY(w.visited) AND w.depth<128
    AND NOT EXISTS (
      SELECT 1 FROM public.employees occupant
      WHERE occupant.tenant_id=v_tenant
      AND lower(btrim(coalesce(occupant.status,'active')))='active'
      AND bexhr_private.p7b_resolve_employee_position_id(occupant.id)=w.ancestor
    )
 ), nearest AS (
   SELECT DISTINCT ON (w.employee_id) w.employee_id,w.ancestor AS position_id
   FROM walk w
   WHERE w.ancestor IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.employees occupant
      WHERE occupant.tenant_id=v_tenant
       AND lower(btrim(coalesce(occupant.status,'active')))='active'
       AND bexhr_private.p7b_resolve_employee_position_id(occupant.id)=w.ancestor
    )
   ORDER BY w.employee_id,w.depth
 )
 SELECT count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('employee_id',l.employee_id)),'[]'::jsonb)
 INTO v_blocked,v_conflicting_employees
 FROM current_lines l
 JOIN revised child_link ON child_link.job_title_id=l.child_position
 LEFT JOIN nearest n ON n.employee_id=l.employee_id
 WHERE (l.manager_position IS DISTINCT FROM n.position_id OR n.position_id IS NULL)
  AND NOT (
    child_link.parent_id IS NOT DISTINCT FROM child_link.original_parent
    AND child_link.parent_id IS NOT NULL
    AND bexhr_private.h6d_is_approved_current_primary_exception(l.employee_id,l.manager_employee_id)
  );

 IF v_blocked>0 THEN
   RETURN jsonb_build_object(
     'allowed',false,'reason','Changing the highest position would conflict with existing employee Primary Manager assignments. Review these assignments before proceeding.',
     'conflicting_primary_count',v_blocked,'conflicting_employees',v_conflicting_employees,'highest_position',v_root_label,'proposed_highest',v_label);
 END IF;
 RETURN jsonb_build_object('allowed',true,'reason','Eligible for review. The server will recheck all safeguards before saving.',
   'highest_position',v_root_label,'proposed_highest',v_label,'conflicting_primary_count',0);
END;
$function$;
REVOKE ALL ON FUNCTION public.bexhr_p7b_preflight_highest_position(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bexhr_p7b_preflight_highest_position(uuid) TO authenticated;