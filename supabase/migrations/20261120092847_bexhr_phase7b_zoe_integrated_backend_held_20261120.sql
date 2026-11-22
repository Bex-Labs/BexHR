SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='120s';
DO $guard$ DECLARE n int; BEGIN
IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL THEN RAISE EXCEPTION 'P7B: already activated';END IF;
IF to_regclass('bexhr_private.p7b_legacy_primary_transition') IS NOT NULL THEN RAISE EXCEPTION 'P7B: snapshot exists';END IF;
IF to_regprocedure('bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed h6d_is_approved_current_primary_exception'; END IF;
IF to_regprocedure('public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed hr_tenant_admin_approve_primary_exception'; END IF;
IF to_regprocedure('public.hr_tenant_admin_revoke_primary_exception(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed hr_tenant_admin_revoke_primary_exception'; END IF;
IF to_regprocedure('public.hr_tenant_admin_list_primary_exceptions()') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed hr_tenant_admin_list_primary_exceptions'; END IF;
IF to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed h11_current_primary_authority'; END IF;
IF to_regprocedure('public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed hr_tenant_admin_assign_primary_exception'; END IF;
IF to_regprocedure('bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed h3b_live_leave_primary_pair'; END IF;
IF to_regprocedure('bexhr_private.h3b_guard_leave_delegation_insert()') IS NOT NULL THEN RAISE EXCEPTION 'P7B already installed h3b_guard_leave_delegation_insert'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('bexhr_private.enforce_reporting_role_integrity()')) IS DISTINCT FROM 'f89633a1fc72ef951c4ffeea3ec6690e' THEN RAISE EXCEPTION 'P7B source drift enforce_reporting_role_integrity'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)')) IS DISTINCT FROM '0a35bee0967fce3c218c23c584abc047' THEN RAISE EXCEPTION 'P7B source drift resolve_pa_manager_review_route'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('public.hrp_find_active_leave_delegation(uuid)')) IS DISTINCT FROM 'f0faf817163c64dc6e2e8e9888a791ea' THEN RAISE EXCEPTION 'P7B source drift hrp_find_active_leave_delegation'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)')) IS DISTINCT FROM '9375ae8ad7b869f5b2ce7702bd1b6a5c' THEN RAISE EXCEPTION 'P7B source drift is_manager_of'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('public.pa_current_user_is_primary_manager_of(uuid)')) IS DISTINCT FROM 'fca7355b8b901b72bed9214be5a164f0' THEN RAISE EXCEPTION 'P7B source drift pa_current_user_is_primary_manager_of'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)')) IS DISTINCT FROM '59ac96c9f7714088e9b6c92f89f9dd1b' THEN RAISE EXCEPTION 'P7B source drift hrp_is_current_user_authorized_manager_for_leave_employee'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_manager_leave_readiness()')) IS DISTINCT FROM '230b44b1c452fa23bd33c41f376e9b63' THEN RAISE EXCEPTION 'P7B source drift get_manager_leave_readiness'; END IF;
IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure('bex_pa_private.manages_department(uuid)')) IS DISTINCT FROM '655db764df3552a9691e68f99da46fb7' THEN RAISE EXCEPTION 'P7B source drift manages_department'; END IF;
SELECT count(*) INTO n FROM public.employee_reporting_lines WHERE lower(btrim(coalesce(manager_type,'')))='primary' AND lower(btrim(coalesce(status,'active')) )='active';
IF n<>19 THEN RAISE EXCEPTION 'P7B reporting count %',n;END IF;
END;$guard$;
CREATE TABLE bexhr_private.p7b_legacy_primary_transition(
line_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,employee_id uuid NOT NULL,manager_employee_id uuid NOT NULL,line_created_at timestamptz,
employee_title text NOT NULL,employee_department text NOT NULL,manager_title text NOT NULL,manager_department text NOT NULL
);
ALTER TABLE bexhr_private.p7b_legacy_primary_transition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bexhr_private.p7b_legacy_primary_transition FROM PUBLIC,anon,authenticated;
INSERT INTO bexhr_private.p7b_legacy_primary_transition
SELECT l.id,e.tenant_id,e.id,m.id,l.created_at,lower(btrim(coalesce(e.job_title,''))),lower(btrim(coalesce(e.department,''))),lower(btrim(coalesce(m.job_title,''))),lower(btrim(coalesce(m.department,'')))
FROM public.employee_reporting_lines l JOIN public.employees e ON e.id=l.employee_id JOIN public.employees m ON m.id=l.manager_employee_id AND m.tenant_id=e.tenant_id
WHERE lower(btrim(coalesce(l.manager_type,'')))='primary' AND lower(btrim(coalesce(l.status,'active')) )='active'
AND (l.tenant_id=e.tenant_id OR l.tenant_id IS NULL)
AND NOT bexhr_private.p7b_legacy_primary_pair_allowed(e.id,m.id)
AND NOT EXISTS(SELECT 1 FROM public.organization_job_title_hierarchy h WHERE h.tenant_id=e.tenant_id);
CREATE FUNCTION bexhr_private.p7b_legacy_transition_allowed(p_employee uuid,p_manager uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $guard$ SELECT EXISTS(
SELECT 1 FROM bexhr_private.p7b_legacy_primary_transition s
JOIN public.employee_reporting_lines l ON l.id=s.line_id AND l.employee_id=s.employee_id AND l.manager_employee_id=s.manager_employee_id
JOIN public.employees e ON e.id=s.employee_id AND e.tenant_id=s.tenant_id
JOIN public.employees m ON m.id=s.manager_employee_id AND m.tenant_id=s.tenant_id
JOIN public.profiles mp ON mp.id=m.user_id AND mp.tenant_id=s.tenant_id AND mp.is_active IS TRUE
WHERE s.employee_id=p_employee AND s.manager_employee_id=p_manager AND p_employee<>p_manager
AND (l.tenant_id=s.tenant_id OR l.tenant_id IS NULL)
AND l.created_at IS NOT DISTINCT FROM s.line_created_at
AND lower(btrim(coalesce(l.manager_type,'')))='primary' AND lower(btrim(coalesce(l.status,'active')) )='active'
AND lower(btrim(coalesce(e.status,'active')) )='active' AND lower(btrim(coalesce(m.status,'active')) )='active'
AND lower(btrim(coalesce(m.system_role,''))) IN ('manager','hr','hr_manager')
AND lower(btrim(coalesce(mp.role,''))) IN ('manager','hr','hr_manager')
AND lower(btrim(coalesce(e.job_title,'')))=s.employee_title AND lower(btrim(coalesce(e.department,'')))=s.employee_department
AND lower(btrim(coalesce(m.job_title,'')))=s.manager_title AND lower(btrim(coalesce(m.department,'')))=s.manager_department
AND NOT EXISTS(SELECT 1 FROM public.organization_job_title_hierarchy h WHERE h.tenant_id=s.tenant_id)
AND (SELECT count(*) FROM public.employee_reporting_lines a WHERE a.employee_id=s.employee_id AND lower(btrim(coalesce(a.manager_type,'')))='primary' AND lower(btrim(coalesce(a.status,'active')) )='active')=1
);$guard$;
REVOKE ALL ON FUNCTION bexhr_private.p7b_legacy_transition_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION bexhr_private.h6d_is_approved_current_primary_exception(p_employee_id uuid, p_manager_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_employee_id IS NOT NULL AND p_manager_employee_id IS NOT NULL
    AND p_employee_id<>p_manager_employee_id
    AND EXISTS (
      SELECT 1
      FROM bexhr_private.h6d_approved_primary_exceptions approval
      JOIN public.employee_reporting_lines line
        ON line.id=approval.reporting_line_id
       AND line.employee_id=approval.employee_id
       AND line.manager_employee_id=approval.manager_employee_id
       AND (line.tenant_id IS NULL OR line.tenant_id=approval.tenant_id)
       AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
       AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
      JOIN public.employees report
        ON report.id=approval.employee_id AND report.tenant_id=approval.tenant_id
       AND lower(pg_catalog.btrim(coalesce(report.status,'active')))='active'
      JOIN public.employees manager
        ON manager.id=approval.manager_employee_id AND manager.tenant_id=report.tenant_id
       AND lower(pg_catalog.btrim(coalesce(manager.status,'active')))='active'
       AND lower(pg_catalog.btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
      JOIN public.profiles manager_profile
        ON manager_profile.id=manager.user_id
       AND manager_profile.tenant_id=approval.tenant_id
       AND manager_profile.is_active IS TRUE
       AND lower(pg_catalog.btrim(coalesce(manager_profile.role,''))) IN ('manager','hr','hr_manager')
      JOIN public.organization_job_titles report_position
        ON report_position.id=approval.employee_position_id
       AND report_position.tenant_id=approval.tenant_id
       AND lower(pg_catalog.btrim(coalesce(report_position.status,'active')))='active'
      JOIN public.organization_job_titles manager_position
        ON manager_position.id=approval.manager_position_id
       AND manager_position.tenant_id=approval.tenant_id
       AND lower(pg_catalog.btrim(coalesce(manager_position.status,'active')))='active'
      WHERE approval.employee_id=p_employee_id
        AND approval.manager_employee_id=p_manager_employee_id
        AND approval.revoked_at IS NULL
        AND (approval.expires_at IS NULL OR approval.expires_at>pg_catalog.now())
        AND approval.employee_position_id=
          bexhr_private.p7b_resolve_employee_position_id(report.id)
        AND approval.manager_position_id=
          bexhr_private.p7b_resolve_employee_position_id(manager.id)
        -- Any later change to this position's configured reporting parent
        -- invalidates an old exception until HR Admin reviews it again.
        AND (
          (approval.child_position_link_was_configured AND EXISTS (
            SELECT 1 FROM public.organization_job_title_hierarchy link
            WHERE link.tenant_id=approval.tenant_id
              AND link.job_title_id=approval.employee_position_id
              AND link.reports_to_job_title_id IS NOT DISTINCT FROM
                approval.child_parent_position_at_approval
          )) OR
          (NOT approval.child_position_link_was_configured AND NOT EXISTS (
            SELECT 1 FROM public.organization_job_title_hierarchy link
            WHERE link.tenant_id=approval.tenant_id
              AND link.job_title_id=approval.employee_position_id
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_job_title_hierarchy h
          WHERE h.tenant_id=approval.tenant_id
            AND h.job_title_id=approval.employee_position_id
            AND h.reports_to_job_title_id IS NULL
        )
        AND (
          SELECT count(*) FROM public.employee_reporting_lines p
          WHERE p.employee_id=report.id
            AND lower(pg_catalog.btrim(coalesce(p.manager_type::text,'')))='primary'
            AND lower(pg_catalog.btrim(coalesce(p.status::text,'active')))='active'
        )=1
    );
$function$;
REVOKE ALL ON FUNCTION bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_approve_primary_exception(p_reporting_line_id uuid, p_reason text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid;
  v_line public.employee_reporting_lines%rowtype;
  v_report public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_report_position uuid;
  v_manager_position uuid;
  v_child_link_exists boolean := FALSE;
  v_child_parent uuid;
  v_result uuid;
  v_cycle boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H6D_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant := public.require_current_tenant_administrator();
  IF v_tenant IS NULL OR p_reporting_line_id IS NULL
    OR char_length(pg_catalog.btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
    OR (p_expires_at IS NOT NULL AND p_expires_at<=pg_catalog.now()) THEN
    RAISE EXCEPTION 'BEXHR_H6D_BAD_REQUEST: choose a line, give a reason (12-500 chars), and use a future expiry'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_line FROM public.employee_reporting_lines
   WHERE id=p_reporting_line_id FOR UPDATE;
  IF v_line.id IS NULL
    OR (v_line.tenant_id IS NOT NULL AND v_line.tenant_id<>v_tenant)
    OR lower(pg_catalog.btrim(coalesce(v_line.manager_type::text,'')))<>'primary'
    OR lower(pg_catalog.btrim(coalesce(v_line.status::text,'active')))<>'active'
    OR v_line.employee_id=v_line.manager_employee_id THEN
    RAISE EXCEPTION 'BEXHR_H6D_LINE_INVALID: active same-tenant Primary line required'
      USING ERRCODE='23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_line.employee_id::text)::bigint
  );
  SELECT * INTO v_report FROM public.employees WHERE id=v_line.employee_id;
  SELECT * INTO v_manager FROM public.employees WHERE id=v_line.manager_employee_id;
  IF v_report.id IS NULL OR v_manager.id IS NULL
    OR v_report.tenant_id IS DISTINCT FROM v_tenant
    OR v_manager.tenant_id IS DISTINCT FROM v_tenant
    OR lower(pg_catalog.btrim(coalesce(v_report.status,'active')))<>'active'
    OR lower(pg_catalog.btrim(coalesce(v_manager.status,'active')))<>'active'
    OR lower(pg_catalog.btrim(coalesce(v_manager.system_role,''))) NOT IN ('manager','hr','hr_manager')
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles profile
      WHERE profile.id=v_manager.user_id
        AND profile.tenant_id=v_tenant AND profile.is_active IS TRUE
        AND lower(pg_catalog.btrim(coalesce(profile.role,''))) IN ('manager','hr','hr_manager')
    ) THEN
    RAISE EXCEPTION 'BEXHR_H6D_MANAGER_INVALID: active, login-linked Manager/HR required'
      USING ERRCODE='23514';
  END IF;
  IF (
    SELECT count(*) FROM public.employee_reporting_lines line
    WHERE line.employee_id=v_report.id
      AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
  )<>1 THEN
    RAISE EXCEPTION 'BEXHR_H6D_MULTIPLE_PRIMARY: fix duplicate lines before approval'
      USING ERRCODE='23514';
  END IF;
  v_report_position := bexhr_private.p7b_resolve_employee_position_id(v_report.id);
  v_manager_position := bexhr_private.p7b_resolve_employee_position_id(v_manager.id);
  -- Require unambiguous tenant-owned catalogue IDs; never approve missing or
  -- foreign/global position IDs by making a speculative match.
  IF v_report_position IS NULL OR v_manager_position IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.organization_job_titles jt
      WHERE jt.id=v_report_position AND jt.tenant_id=v_tenant
        AND lower(pg_catalog.btrim(coalesce(jt.status,'active')))='active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.organization_job_titles jt
      WHERE jt.id=v_manager_position AND jt.tenant_id=v_tenant
        AND lower(pg_catalog.btrim(coalesce(jt.status,'active')))='active'
    ) THEN
    RAISE EXCEPTION 'BEXHR_H6D_POSITION_UNRESOLVED: link both employees to unambiguous company positions'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_job_title_hierarchy h
    WHERE h.tenant_id=v_tenant AND h.job_title_id=v_report_position
      AND h.reports_to_job_title_id IS NULL
  ) THEN
    RAISE EXCEPTION 'BEXHR_H6D_ROOT_CANNOT_REPORT' USING ERRCODE='23514';
  END IF;
  SELECT link.reports_to_job_title_id INTO v_child_parent
  FROM public.organization_job_title_hierarchy link
  WHERE link.tenant_id=v_tenant AND link.job_title_id=v_report_position;
  v_child_link_exists := FOUND;
  IF bexhr_private.p7b_configured_primary_match(v_report.id,v_manager.id) THEN
    RAISE EXCEPTION 'BEXHR_H6D_NOT_NEEDED: Primary already follows configured position path'
      USING ERRCODE='22023';
  END IF;

  -- Protect against existing cycles and excessively deep legacy reporting.
  WITH RECURSIVE manager_chain(next_manager,visited,depth) AS (
    SELECT line.manager_employee_id,ARRAY[line.employee_id]::uuid[],1
    FROM public.employee_reporting_lines line
    WHERE line.id=v_line.id
    UNION ALL
    SELECT line.manager_employee_id,chain.visited||chain.next_manager,chain.depth+1
    FROM manager_chain chain
    JOIN public.employee_reporting_lines line ON line.employee_id=chain.next_manager
      AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
      AND (line.tenant_id IS NULL OR line.tenant_id=v_tenant)
    WHERE chain.depth<129 AND NOT chain.next_manager=ANY(chain.visited)
  )
  SELECT EXISTS (
    SELECT 1 FROM manager_chain
    WHERE next_manager=ANY(visited) OR depth>=129
  ) INTO v_cycle;
  IF v_cycle THEN
    RAISE EXCEPTION 'BEXHR_H6D_PRIMARY_CYCLE: reporting loop or 128-step path blocked'
      USING ERRCODE='23514';
  END IF;
  INSERT INTO bexhr_private.h6d_approved_primary_exceptions (
    tenant_id,reporting_line_id,employee_id,manager_employee_id,
    employee_position_id,manager_position_id,
    child_position_link_was_configured,child_parent_position_at_approval,
    reason,approved_by,expires_at
  ) VALUES (
    v_tenant,v_line.id,v_report.id,v_manager.id,
    v_report_position,v_manager_position,
    v_child_link_exists,v_child_parent,
    pg_catalog.btrim(p_reason),auth.uid(),p_expires_at
  ) RETURNING id INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_revoke_primary_exception(p_approval_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid;
  v_changed uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H6D_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant := public.require_current_tenant_administrator();
  UPDATE bexhr_private.h6d_approved_primary_exceptions approval
  SET revoked_at=pg_catalog.now(),revoked_by=auth.uid()
  WHERE approval.id=p_approval_id AND approval.tenant_id=v_tenant
    AND approval.revoked_at IS NULL
  RETURNING id INTO v_changed;
  RETURN v_changed IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_revoke_primary_exception(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_list_primary_exceptions()
 RETURNS TABLE(approval_id uuid, employee_id uuid, manager_employee_id uuid, reporting_line_id uuid, reason text, approved_at timestamp with time zone, approved_by uuid, expires_at timestamp with time zone, revoked_at timestamp with time zone, currently_effective boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H6D_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant := public.require_current_tenant_administrator();
  RETURN QUERY
  SELECT approval.id,approval.employee_id,approval.manager_employee_id,
    approval.reporting_line_id,approval.reason,approval.approved_at,
    approval.approved_by,approval.expires_at,approval.revoked_at,
    (
      approval.revoked_at IS NULL
      AND (approval.expires_at IS NULL OR approval.expires_at>pg_catalog.now())
      AND bexhr_private.h6d_is_approved_current_primary_exception(
        approval.employee_id,approval.manager_employee_id
      )
    ) AS currently_effective
  FROM bexhr_private.h6d_approved_primary_exceptions approval
  WHERE approval.tenant_id=v_tenant
  ORDER BY approval.approved_at DESC,approval.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_list_primary_exceptions() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION bexhr_private.h11_current_primary_authority(p_employee_id uuid, p_manager_employee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_child_position uuid;
  v_child_department_id uuid;
  v_is_configured boolean := false;
  v_primary_count integer := 0;
BEGIN
  IF p_employee_id IS NULL OR p_manager_employee_id IS NULL
     OR p_employee_id = p_manager_employee_id THEN RETURN FALSE; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
  SELECT * INTO v_manager FROM public.employees WHERE id=p_manager_employee_id;
  IF v_employee.id IS NULL OR v_manager.id IS NULL
     OR v_employee.tenant_id IS NULL
     OR v_employee.tenant_id IS DISTINCT FROM v_manager.tenant_id
     OR lower(pg_catalog.btrim(coalesce(v_employee.status,'active'))) <> 'active'
     OR lower(pg_catalog.btrim(coalesce(v_manager.status,'active'))) <> 'active'
     OR lower(pg_catalog.btrim(coalesce(v_manager.system_role,'')))
        NOT IN ('manager','hr','hr_manager') THEN RETURN FALSE; END IF;

  IF NOT EXISTS (
     SELECT 1 FROM public.profiles profile
     WHERE profile.id=v_manager.user_id
       AND profile.tenant_id=v_employee.tenant_id
       AND profile.is_active IS TRUE
       AND lower(pg_catalog.btrim(coalesce(profile.role,'')))
           IN ('manager','hr','hr_manager')
  ) THEN RETURN FALSE; END IF;

  SELECT count(*)::integer INTO v_primary_count
    FROM public.employee_reporting_lines line
   WHERE line.employee_id=v_employee.id
     AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
     AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active';
  IF v_primary_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.employee_reporting_lines line
    WHERE line.employee_id=v_employee.id
      AND line.manager_employee_id=v_manager.id
      AND (line.tenant_id=v_employee.tenant_id OR line.tenant_id IS NULL)
      AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
  ) THEN RETURN FALSE; END IF;

  v_child_position := bexhr_private.p7b_resolve_employee_position_id(v_employee.id);
  IF v_child_position IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy link
      WHERE link.tenant_id=v_employee.tenant_id
        AND link.job_title_id=v_child_position
    ) INTO v_is_configured;
    IF v_is_configured THEN
      RETURN bexhr_private.p7b_configured_primary_match(
          v_employee.id,v_manager.id)
        OR bexhr_private.h6d_is_approved_current_primary_exception(
          v_employee.id,v_manager.id);
    END IF;
    SELECT department_id INTO v_child_department_id
      FROM public.organization_job_titles WHERE id=v_child_position;
    IF v_child_department_id IS NULL THEN RETURN FALSE; END IF;
  ELSE
    -- Missing/ambiguous root may not inherit the departmental role ladder.
    IF nullif(pg_catalog.btrim(coalesce(v_employee.department,'')),'') IS NULL
    THEN RETURN FALSE; END IF;
  END IF;

  RETURN bexhr_private.p7b_legacy_primary_pair_allowed(v_employee.id,v_manager.id)
 OR bexhr_private.p7b_legacy_transition_allowed(v_employee.id,v_manager.id)
 OR bexhr_private.h6d_is_approved_current_primary_exception(v_employee.id,v_manager.id);
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.h11_current_primary_authority(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_assign_primary_exception(p_employee_id uuid, p_manager_employee_id uuid, p_reason text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_manager_profile public.profiles%rowtype;
  v_previous public.employee_reporting_lines%rowtype;
  v_previous_count bigint;
  v_child_position uuid;
  v_manager_position uuid;
  v_department_position uuid;
  v_parent_position uuid;
  v_configured boolean := FALSE;
  v_has_cycle boolean := FALSE;
  v_new_line_id uuid;
  v_approval_id uuid;
  v_context_removed integer;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant := public.require_current_tenant_administrator();
  -- Privileged primary exceptions require the backend-verified HR MFA level.
  IF coalesce(auth.jwt()->>'aal','')<>'aal2' THEN
    RAISE EXCEPTION 'BEXHR_H11A_MFA_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF v_tenant IS NULL OR p_employee_id IS NULL OR p_manager_employee_id IS NULL
     OR p_employee_id=p_manager_employee_id
     OR char_length(pg_catalog.btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
     OR (p_expires_at IS NOT NULL AND p_expires_at<=pg_catalog.now()) THEN
    RAISE EXCEPTION 'BEXHR_H11A_BAD_REQUEST: choose employee/manager, provide a 12-500 character reason and optional future expiry'
      USING ERRCODE='22023';
  END IF;

  -- Serialise exception assignments within this tenant AND with the existing
  -- per-employee H7/R14B trigger lock. Direct ordinary saves remain guarded by
  -- their existing three triggers; this RPC does not bypass those triggers.
  PERFORM pg_catalog.pg_advisory_xact_lock(22117,pg_catalog.hashtext(v_tenant::text));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_employee_id::text)::bigint
  );

  SELECT * INTO v_employee FROM public.employees
   WHERE id=p_employee_id AND tenant_id=v_tenant FOR UPDATE;
  SELECT * INTO v_manager FROM public.employees
   WHERE id=p_manager_employee_id AND tenant_id=v_tenant FOR SHARE;
  IF v_employee.id IS NULL OR v_manager.id IS NULL
     OR lower(pg_catalog.btrim(coalesce(v_employee.status,'active'))) <> 'active'
     OR lower(pg_catalog.btrim(coalesce(v_manager.status,'active'))) <> 'active'
     OR lower(pg_catalog.btrim(coalesce(v_manager.system_role,'')))
        NOT IN ('manager','hr','hr_manager') THEN
    RAISE EXCEPTION 'BEXHR_H11A_TENANT_OR_ROLE_INVALID: both employees must be active; the manager must hold an authorised manager/HR system role'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_manager_profile FROM public.profiles profile
   WHERE profile.id=v_manager.user_id AND profile.tenant_id=v_tenant
     AND profile.is_active IS TRUE
     AND lower(pg_catalog.btrim(coalesce(profile.role,''))) IN ('manager','hr','hr_manager')
   FOR SHARE;
  IF v_manager_profile.id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_MANAGER_LOGIN_INVALID: active linked Manager/HR account required'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO v_previous_count FROM public.employee_reporting_lines line
   WHERE line.employee_id=v_employee.id
     AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
     AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active';
  IF v_previous_count>1 THEN
    RAISE EXCEPTION 'BEXHR_H11A_DUPLICATE_PRIMARY: repair the existing duplicate before approving an exception'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_previous FROM public.employee_reporting_lines line
   WHERE line.employee_id=v_employee.id
     AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
     AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
   FOR UPDATE;
  IF v_previous.id IS NOT NULL
     AND v_previous.manager_employee_id=p_manager_employee_id THEN
    RAISE EXCEPTION 'BEXHR_H11A_ALREADY_PRIMARY: use the existing-line approval RPC if a historical relationship needs approval'
      USING ERRCODE='22023';
  END IF;
  IF v_previous.id IS NOT NULL
     AND v_previous.tenant_id IS NOT NULL
     AND v_previous.tenant_id<>v_tenant THEN
    RAISE EXCEPTION 'BEXHR_H11A_EXISTING_PRIMARY_TENANT_INVALID' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines line
     WHERE line.employee_id=v_employee.id
       AND line.manager_employee_id=v_manager.id
       AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))<>'primary'
       AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_MANAGER_ALREADY_SUPPORTING: remove the active supporting-manager link first'
      USING ERRCODE='23514';
  END IF;

  v_child_position := bexhr_private.p7b_resolve_employee_position_id(v_employee.id);
  v_manager_position := bexhr_private.p7b_resolve_employee_position_id(v_manager.id);
  -- No title text inference, global-catalogue ambiguity or phantom CEO/COO.
  IF v_child_position IS NULL OR v_manager_position IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.organization_job_titles title
       WHERE title.id=v_child_position AND title.tenant_id=v_tenant
         AND lower(pg_catalog.btrim(coalesce(title.status,'active')))='active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.organization_job_titles title
       WHERE title.id=v_manager_position AND title.tenant_id=v_tenant
         AND lower(pg_catalog.btrim(coalesce(title.status,'active')))='active'
    ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_POSITION_UNRESOLVED: both positions must resolve uniquely to active tenant-owned catalog entries'
      USING ERRCODE='23514';
  END IF;
  SELECT department_id INTO v_department_position FROM public.organization_job_titles
   WHERE id=v_child_position;
  SELECT link.reports_to_job_title_id INTO v_parent_position
    FROM public.organization_job_title_hierarchy link
   WHERE link.tenant_id=v_tenant AND link.job_title_id=v_child_position;
  v_configured := FOUND;
  IF v_configured AND v_parent_position IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_ROOT_CANNOT_REPORT' USING ERRCODE='23514';
  END IF;
  IF NOT v_configured AND v_department_position IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_COMPANY_ROOT_MUST_BE_CONFIGURED' USING ERRCODE='23514';
  END IF;
  IF bexhr_private.p7b_configured_primary_match(v_employee.id,v_manager.id)
     OR (NOT v_configured AND v_department_position IS NOT NULL
         AND bexhr_private.p7b_legacy_primary_pair_allowed(
           v_employee.id,v_manager.id)) THEN
    RAISE EXCEPTION 'BEXHR_H11A_EXCEPTION_NOT_REQUIRED: use normal reporting Save for an already permitted manager'
      USING ERRCODE='22023';
  END IF;

  -- No silent reassignment of a pending Leave request or an appraisal whose
  -- reviewer was frozen in an active cycle. Completed PA records are untouched.
  IF EXISTS (
    SELECT 1 FROM public.leave_requests leave_row
    JOIN LATERAL public.hrp_resolve_leave_employee(leave_row.employee_id) resolved ON TRUE
    WHERE resolved.employee_id=v_employee.id AND resolved.tenant_id=v_tenant
      AND lower(pg_catalog.btrim(coalesce(leave_row.status,'')))='pending approval'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_PENDING_LEAVE: resolve the pending Leave before changing the Primary Manager'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pa_employee_appraisals appraisal
    JOIN public.pa_cycles cycle ON cycle.id=appraisal.cycle_id
     AND cycle.tenant_id=appraisal.tenant_id
    WHERE appraisal.employee_id=v_employee.id AND appraisal.tenant_id=v_tenant
      AND lower(pg_catalog.btrim(coalesce(cycle.status,'')))='active'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_ACTIVE_PA: resolve the current-cycle appraisal before reassigning the Primary reviewer'
      USING ERRCODE='23514';
  END IF;

  -- Existing individual goals also carry active-cycle review responsibilities.
  -- Block their silent transfer, even if appraisal snapshots do not yet exist.
  IF EXISTS (
    SELECT 1 FROM public.pa_individual_goals goal
    JOIN public.pa_cycles cycle ON cycle.id=goal.cycle_id
     AND cycle.tenant_id=goal.tenant_id
    WHERE goal.employee_id=v_employee.id AND goal.tenant_id=v_tenant
      AND lower(pg_catalog.btrim(coalesce(cycle.status,'')))='active'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_ACTIVE_PA_GOALS: resolve current-cycle individual goals before exceptional Primary reassignment'
      USING ERRCODE='23514';
  END IF;

  -- Independently check the proposed upward chain with a bounded traversal.
  -- Existing hierarchy trigger checks cycles again on the actual insertion.
  WITH RECURSIVE chain(next_manager,visited,depth) AS (
    SELECT v_manager.id,ARRAY[v_employee.id]::uuid[],1
    UNION ALL
    SELECT line.manager_employee_id,
           chain.visited||chain.next_manager,chain.depth+1
    FROM chain
    JOIN public.employee_reporting_lines line ON line.employee_id=chain.next_manager
      AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
      AND (line.tenant_id IS NULL OR line.tenant_id=v_tenant)
    WHERE chain.depth<129 AND NOT chain.next_manager=ANY(chain.visited)
  )
  SELECT EXISTS (
    SELECT 1 FROM chain
     WHERE next_manager=ANY(visited) OR depth>=129
  ) INTO v_has_cycle;
  IF v_has_cycle THEN
    RAISE EXCEPTION 'BEXHR_H11A_PRIMARY_CYCLE: loop or excessive manager depth blocked'
      USING ERRCODE='23514';
  END IF;

  -- Every write below is part of this ONE database transaction. Revoke any
  -- old approval first (history retained) to satisfy one current exception.
  UPDATE bexhr_private.h6d_approved_primary_exceptions approval
     SET revoked_at=pg_catalog.now(),revoked_by=v_actor
   WHERE approval.tenant_id=v_tenant AND approval.employee_id=v_employee.id
     AND approval.revoked_at IS NULL;

  v_new_line_id := pg_catalog.gen_random_uuid();
  INSERT INTO bexhr_private.h6d_approved_primary_exceptions (
    tenant_id,reporting_line_id,employee_id,manager_employee_id,
    employee_position_id,manager_position_id,
    child_position_link_was_configured,child_parent_position_at_approval,
    reason,approved_by,expires_at
  ) VALUES (
    v_tenant,v_new_line_id,v_employee.id,v_manager.id,
    v_child_position,v_manager_position,v_configured,v_parent_position,
    pg_catalog.btrim(p_reason),v_actor,p_expires_at
  ) RETURNING id INTO v_approval_id;
  INSERT INTO bexhr_private.h11_exception_assignment_context (
    transaction_id,actor_id,tenant_id,employee_id,manager_employee_id,
    proposed_line_id,approval_id
  ) VALUES (
    pg_catalog.pg_current_xact_id(),v_actor,v_tenant,v_employee.id,v_manager.id,
    v_new_line_id,v_approval_id
  );

  IF v_previous.id IS NOT NULL THEN
    UPDATE public.employee_reporting_lines line
       SET status='Inactive',
           notes=concat_ws(E'\n',nullif(pg_catalog.btrim(coalesce(line.notes,'')),''),
             '[BEXHR H11] Previous Primary preserved after an expressly approved exception assignment.'),
           updated_by=v_actor
     WHERE line.id=v_previous.id AND line.employee_id=v_employee.id;
  END IF;
  INSERT INTO public.employee_reporting_lines (
    id,employee_id,tenant_id,manager_employee_id,manager_type,status,notes,
    created_by,updated_by
  ) VALUES (
    v_new_line_id,v_employee.id,v_tenant,v_manager.id,'Primary','Active',
    'Primary Manager assigned by Tenant Administrator under individually approved reporting exception.',
    v_actor,v_actor
  );
  UPDATE public.employees employee
     SET line_manager=coalesce(
           nullif(pg_catalog.btrim(concat_ws(' ',v_manager.first_name,
             v_manager.middle_name,v_manager.last_name)),''),
           nullif(pg_catalog.btrim(coalesce(v_manager.work_email,'')),''),
           v_manager.id::text),
         approver_email=coalesce(
           nullif(pg_catalog.btrim(coalesce(v_manager.work_email,'')),''),
           nullif(pg_catalog.btrim(coalesce(v_manager_profile.email,'')),'')
         )
   WHERE employee.id=v_employee.id AND employee.tenant_id=v_tenant;

  IF (SELECT count(*) FROM public.employee_reporting_lines line
       WHERE line.employee_id=v_employee.id
         AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
         AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active')<>1
     OR NOT EXISTS (
       SELECT 1 FROM public.employee_reporting_lines line
        WHERE line.id=v_new_line_id AND line.employee_id=v_employee.id
          AND line.manager_employee_id=v_manager.id AND line.tenant_id=v_tenant
          AND lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
          AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
     ) THEN
    RAISE EXCEPTION 'BEXHR_H11A_POSTCHECK: intended unique active Primary was not saved'
      USING ERRCODE='23514';
  END IF;
  DELETE FROM bexhr_private.h11_exception_assignment_context context
   WHERE context.transaction_id=pg_catalog.pg_current_xact_id()
     AND context.actor_id=v_actor AND context.approval_id=v_approval_id;
  GET DIAGNOSTICS v_context_removed=ROW_COUNT;
  IF v_context_removed<>1 THEN
    RAISE EXCEPTION 'BEXHR_H11A_CONTEXT_NOT_CLEARED' USING ERRCODE='23514';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'reporting_line_id',v_new_line_id,
    'approval_id',v_approval_id,
    'replaced_reporting_line_id',v_previous.id,
    'expires_at',p_expires_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION bexhr_private.h3b_live_leave_primary_pair(p_report_employee_id uuid, p_primary_manager_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3B_LIVE_PRIMARY_V1
  SELECT p_report_employee_id IS NOT NULL
    AND p_primary_manager_employee_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.employees report
      JOIN public.employees manager
        ON manager.id=p_primary_manager_employee_id
       AND manager.tenant_id=report.tenant_id
      JOIN public.profiles manager_profile
        ON manager_profile.id=manager.user_id
       AND manager_profile.tenant_id=report.tenant_id
       AND manager_profile.is_active IS TRUE
      JOIN public.employee_reporting_lines line
        ON line.employee_id=report.id
       AND line.manager_employee_id=manager.id
       AND (line.tenant_id=report.tenant_id OR line.tenant_id IS NULL)
       AND lower(btrim(coalesce(line.status::text,'active')))='active'
       AND lower(btrim(coalesce(line.manager_type::text,'')))='primary'
      WHERE report.id=p_report_employee_id
        AND report.id<>manager.id
        AND lower(btrim(coalesce(report.status,'active')))='active'
        AND lower(btrim(coalesce(manager.status,'active')))='active'
        AND lower(btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
        AND lower(btrim(coalesce(manager_profile.role,''))) IN ('manager','hr','hr_manager')
        AND bexhr_private.h11_current_primary_authority(
          report.id,manager.id
        )
    );
$function$;
REVOKE ALL ON FUNCTION bexhr_private.h3b_live_leave_primary_pair(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION bexhr_private.h3b_guard_leave_delegation_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_ok boolean := false;
  v_delegate_ok boolean := false;
  v_has_valid_coverage boolean := false;
BEGIN
  -- BEXHR_H3B_DELEGATION_CREATE_GUARD_V1
  SELECT EXISTS (
    SELECT 1 FROM public.employees actor
    JOIN public.profiles profile ON profile.id=actor.user_id
      AND profile.tenant_id=actor.tenant_id
      AND profile.is_active IS TRUE
    WHERE actor.id=NEW.primary_manager_employee_id
      AND actor.tenant_id=NEW.tenant_id
      AND profile.id=auth.uid()
      AND lower(btrim(coalesce(actor.status,'active')))='active'
      AND lower(btrim(coalesce(actor.system_role,''))) IN ('manager','hr','hr_manager')
      AND lower(btrim(coalesce(profile.role,''))) IN ('manager','hr','hr_manager')
  ) INTO v_actor_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.employees delegate
    JOIN public.profiles profile ON profile.id=delegate.user_id
      AND profile.tenant_id=delegate.tenant_id
      AND profile.is_active IS TRUE
    WHERE delegate.id=NEW.delegated_manager_employee_id
      AND delegate.tenant_id=NEW.tenant_id
      AND lower(btrim(coalesce(delegate.status,'active')))='active'
      AND lower(btrim(coalesce(delegate.system_role,''))) IN ('manager','hr','hr_manager')
      AND lower(btrim(coalesce(profile.role,''))) IN ('manager','hr','hr_manager')
  ) INTO v_delegate_ok;
  IF NOT v_actor_ok OR NOT v_delegate_ok THEN
    RAISE EXCEPTION 'BEXHR_H3B_LEAVE_STOP: both managers need active, linked management accounts';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_reporting_lines secondary_line
    JOIN public.employees target
      ON target.id=secondary_line.employee_id
     AND target.tenant_id=NEW.tenant_id
     AND lower(btrim(coalesce(target.status,'active')))='active'
    WHERE secondary_line.manager_employee_id=NEW.delegated_manager_employee_id
      AND (secondary_line.tenant_id=NEW.tenant_id OR secondary_line.tenant_id IS NULL)
      AND lower(btrim(coalesce(secondary_line.status::text,'active')))='active'
      AND lower(btrim(coalesce(secondary_line.manager_type::text,'')))='secondary'
      AND (NEW.scope_type='team' OR NEW.covered_employee_id=target.id)
      AND bexhr_private.h3b_live_leave_primary_pair(
          target.id,NEW.primary_manager_employee_id)
  ) INTO v_has_valid_coverage;
  IF NOT v_has_valid_coverage THEN
    RAISE EXCEPTION 'BEXHR_H3B_LEAVE_STOP: no currently valid shared Primary/Secondary coverage';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.h3b_guard_leave_delegation_insert() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION bexhr_private.enforce_reporting_role_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF lower(btrim(coalesce(NEW.manager_type::text,'')))<>'primary'
     OR lower(btrim(coalesce(NEW.status::text,'active')))<> 'active' THEN
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS NULL OR NEW.manager_employee_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.employees child
        WHERE child.id=NEW.employee_id AND child.tenant_id IS NOT NULL
          AND (NEW.tenant_id IS NULL OR NEW.tenant_id=child.tenant_id)
     ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_PRIMARY_IDENTITY_INVALID: missing or cross-company reporting identity'
      USING ERRCODE='23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(NEW.employee_id::text)::bigint
  );
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines rl
     WHERE rl.employee_id=NEW.employee_id
       AND rl.id IS DISTINCT FROM NEW.id
       AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
       AND lower(btrim(coalesce(rl.status::text,'active')))='active'
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_MULTIPLE_PRIMARY: reassign or deactivate the existing Primary before saving'
      USING ERRCODE='23514';
  END IF;
  IF NOT bexhr_private.is_primary_reporting_relationship_valid(
    NEW.employee_id,NEW.manager_employee_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='BEXHR_REPORTING_LEVEL_INVALID: This Primary Manager does not match the configured hierarchy or permitted transition rules.',
      DETAIL='For departmental positions, configure their reporting chain before assigning a new Primary.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION bexhr_private.resolve_pa_manager_review_route(p_employee_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_primary_count integer := 0;
  v_primary_manager_id uuid;
  v_position_id uuid;
  v_parent_position_id uuid;
  v_position_department_id uuid;
  v_configured boolean := false;
  v_company_scope boolean := false;
  v_route text := 'CONFIGURATION_ERROR';
  v_reason text := 'UNRESOLVED';
BEGIN
  -- BEXHR_P7B_PA_ROUTE_V1: position, not HR/Manager system role, defines order.
  IF p_employee_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_PA_REVIEW_ROUTE_INPUT_REQUIRED: Employee and tenant are required'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_employee
    FROM public.employees e
   WHERE e.id=p_employee_id AND e.tenant_id=p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BEXHR_PA_REVIEW_ROUTE_EMPLOYEE_INVALID: employee was not found in the appraisal tenant'
      USING ERRCODE='23503';
  END IF;
  IF lower(btrim(coalesce(v_employee.status,'active')))<>'active' THEN
    RAISE EXCEPTION 'BEXHR_PA_REVIEW_ROUTE_EMPLOYEE_INACTIVE: only an active employee may receive a new appraisal'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*)::integer, (array_agg(rl.manager_employee_id ORDER BY rl.id))[1]
    INTO v_primary_count, v_primary_manager_id
    FROM public.employee_reporting_lines rl
   WHERE rl.employee_id=v_employee.id
     AND lower(btrim(coalesce(rl.status::text,'active')))='active'
     AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
     AND (rl.tenant_id=v_employee.tenant_id OR rl.tenant_id IS NULL);

  -- Do not grant PA reviewer authority through role, department-name shortcuts,
  -- a Secondary Manager line or an ambiguous/global title match.
  v_position_id := bexhr_private.p7b_resolve_employee_position_id(v_employee.id);
  IF v_position_id IS NOT NULL THEN
    SELECT jt.department_id INTO v_position_department_id
      FROM public.organization_job_titles jt
     WHERE jt.id=v_position_id;
    v_company_scope := v_position_department_id IS NULL;

    SELECT h.reports_to_job_title_id INTO v_parent_position_id
      FROM public.organization_job_title_hierarchy h
     WHERE h.tenant_id=v_employee.tenant_id AND h.job_title_id=v_position_id;
    v_configured := FOUND;
  ELSE
    -- Unresolvable whole-org position is NOT an implicit root.
    v_company_scope := nullif(btrim(coalesce(v_employee.department,'')),'') IS NULL;
  END IF;

  IF v_primary_count>1 THEN
    v_reason := 'MULTIPLE_ACTIVE_PRIMARY_MANAGERS';

  ELSIF v_configured AND v_parent_position_id IS NULL THEN
    -- A configured root is explicit; root cannot have a Primary reviewer.
    IF v_primary_count=0 THEN
      v_route := 'TOP_LEVEL';
      v_reason := 'EXPLICIT_TOP_LEVEL_NO_PRIMARY_MANAGER';
    ELSE
      v_reason := 'TOP_LEVEL_POSITION_HAS_PRIMARY_MANAGER';
    END IF;

  ELSIF v_primary_count=0 THEN
    v_reason := CASE WHEN v_configured
      THEN 'CONFIGURED_PARENT_REQUIRES_PRIMARY_MANAGER'
      ELSE 'PRIMARY_MANAGER_MISSING' END;

  ELSE
    -- Exactly one active Primary; check identity before checking hierarchy.
    SELECT * INTO v_manager
      FROM public.employees m WHERE m.id=v_primary_manager_id;
    IF v_manager.id IS NULL
       OR v_manager.tenant_id IS DISTINCT FROM v_employee.tenant_id
       OR lower(btrim(coalesce(v_manager.status,'active')))<>'active'
       OR v_manager.id=v_employee.id THEN
      v_reason := 'PRIMARY_MANAGER_INVALID';

    ELSIF v_configured THEN
      -- A configured department OR whole-org position uses strict nearest
      -- OCCUPIED configured ancestor, not the historical-line exemption.
      IF bexhr_private.h11_current_primary_authority(
           v_employee.id,v_manager.id
         ) THEN
        v_route := 'PRIMARY_MANAGER';
        v_reason := 'VALID_CONFIGURED_OR_APPROVED_PRIMARY_MANAGER';
      ELSE
        v_reason := 'PRIMARY_MANAGER_HIERARCHY_INVALID';
      END IF;

    ELSIF v_position_id IS NULL THEN
      -- Ordinary departmental employees keep current default PA routing when
      -- the same reporting pair passes the shared CURRENT-authority guard.
      -- A missing company-wide root never inherits default department rules.
      IF bexhr_private.h11_current_primary_authority(
           v_employee.id,v_manager.id) THEN
        v_route := 'PRIMARY_MANAGER';
        v_reason := 'CURRENT_PRIMARY_DEPARTMENT_DEFAULT';
      ELSE
        v_reason := 'PRIMARY_MANAGER_HIERARCHY_INVALID';
      END IF;

    ELSIF v_company_scope THEN
      -- An unconfigured company-wide title is never assumed to be a root.
      v_reason := 'WHOLE_ORGANIZATION_POSITION_NOT_CONFIGURED';

    ELSE
      -- Unconfigured departmental positions retain the existing default
      -- hierarchy under the SAME current-authority guard as PA goals/Leave.
      -- An old incompatible Primary alone cannot grant new review rights.
      IF bexhr_private.h11_current_primary_authority(
           v_employee.id,v_manager.id) THEN
        v_route := 'PRIMARY_MANAGER';
        v_reason := 'CURRENT_PRIMARY_DEPARTMENT_DEFAULT';
      ELSE
        v_reason := 'PRIMARY_MANAGER_HIERARCHY_INVALID';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'route',v_route,
    'reason',v_reason,
    'primaryManagerEmployeeId',CASE WHEN v_route='PRIMARY_MANAGER'
      THEN v_primary_manager_id ELSE NULL END,
    'activePrimaryManagerCount',v_primary_count,
    'wholeOrganization',v_company_scope,
    'positionId',v_position_id,
    'parentPositionId',v_parent_position_id
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.hrp_find_active_leave_delegation(p_leave_employee_id uuid)
 RETURNS TABLE(delegation_id uuid, primary_manager_employee_id uuid, delegated_manager_employee_id uuid, ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3B_ACTING_SECONDARY_V1
  WITH actor AS (
    SELECT account.manager_employee_id, account.tenant_id
    FROM public.hrp_current_manager_employee() account
    JOIN public.profiles actor_profile
      ON actor_profile.id=auth.uid()
     AND actor_profile.tenant_id=account.tenant_id
     AND actor_profile.is_active IS TRUE
     AND lower(btrim(coalesce(actor_profile.role,''))) IN ('manager','hr','hr_manager')
    JOIN public.employees manager
      ON manager.id=account.manager_employee_id
     AND manager.tenant_id=account.tenant_id
     AND manager.user_id=actor_profile.id
     AND lower(btrim(coalesce(manager.status,'active')))='active'
     AND lower(btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
  ),
  target AS (
    SELECT resolved.employee_id,resolved.tenant_id
    FROM public.hrp_resolve_leave_employee(p_leave_employee_id) resolved
    JOIN public.employees employee
      ON employee.id=resolved.employee_id
     AND employee.tenant_id=resolved.tenant_id
     AND lower(btrim(coalesce(employee.status,'active')))='active'
  )
  SELECT delegation.id,delegation.primary_manager_employee_id,
    delegation.delegated_manager_employee_id,delegation.ends_at
  FROM actor
  JOIN target ON target.tenant_id=actor.tenant_id
  JOIN public.manager_leave_delegations delegation
    ON delegation.tenant_id=actor.tenant_id
   AND delegation.delegated_manager_employee_id=actor.manager_employee_id
   AND delegation.status='active'
   AND now() >= delegation.starts_at
   AND now() < delegation.ends_at
   AND (delegation.scope_type='team'
     OR delegation.covered_employee_id=target.employee_id)
  JOIN public.employee_reporting_lines secondary_line
    ON secondary_line.employee_id=target.employee_id
   AND secondary_line.manager_employee_id=actor.manager_employee_id
   AND (secondary_line.tenant_id=actor.tenant_id OR secondary_line.tenant_id IS NULL)
   AND lower(btrim(coalesce(secondary_line.status::text,'active')))='active'
   AND lower(btrim(coalesce(secondary_line.manager_type::text,'')))='secondary'
  WHERE bexhr_private.h3b_live_leave_primary_pair(
    target.employee_id,delegation.primary_manager_employee_id)
  ORDER BY delegation.ends_at ASC,delegation.created_at ASC
  LIMIT 1;
$function$;
CREATE OR REPLACE FUNCTION bex_pa_private.is_manager_of(p_employee uuid, p_primary_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3_PA_TEAM_SCOPE_V1
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.employees manager
      ON manager.id=public.pa_current_employee_id()
     AND manager.tenant_id=actor.tenant_id
    JOIN public.employee_reporting_lines line
      ON line.manager_employee_id=manager.id
    JOIN public.employees report
      ON report.id=line.employee_id
     AND report.tenant_id=actor.tenant_id
    WHERE actor.id=auth.uid()
      AND actor.is_active IS TRUE
      -- Management authority requires an exact linked login, not an email fallback.
      AND manager.user_id=auth.uid()
      AND actor.tenant_id=public.current_authenticated_profile_tenant_id()
      AND lower(btrim(coalesce(actor.role,''))) IN ('manager','hr','hr_manager')
      AND lower(btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
      AND lower(btrim(coalesce(manager.status,'active')))='active'
      AND lower(btrim(coalesce(report.status,'active')))='active'
      AND report.id=p_employee
      AND (line.tenant_id=actor.tenant_id OR line.tenant_id IS NULL)
      AND lower(btrim(coalesce(line.status::text,'active')))='active'
      AND (
        (lower(btrim(coalesce(line.manager_type::text,'')))='primary'
         AND (
           bexhr_private.h11_current_primary_authority(report.id,manager.id)
         ))
        OR
        (p_primary_only IS FALSE
         AND lower(btrim(coalesce(line.manager_type::text,'')))='secondary')
      )
  );
$function$;
CREATE OR REPLACE FUNCTION public.pa_current_user_is_primary_manager_of(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3_PUBLIC_PRIMARY_SCOPE_V1
  SELECT auth.uid() IS NOT NULL
    AND bex_pa_private.is_manager_of(p_employee_id, TRUE);
$function$;
CREATE OR REPLACE FUNCTION public.hrp_is_current_user_authorized_manager_for_leave_employee(p_leave_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3B_DECISION_AUTHORITY_V1
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.hrp_current_manager_employee() actor
    JOIN public.profiles profile
      ON profile.id=auth.uid()
     AND profile.tenant_id=actor.tenant_id
     AND profile.is_active IS TRUE
     AND lower(btrim(coalesce(profile.role,''))) IN ('manager','hr','hr_manager')
    JOIN public.employees manager
      ON manager.id=actor.manager_employee_id
     AND manager.tenant_id=actor.tenant_id
     AND manager.user_id=profile.id
     AND lower(btrim(coalesce(manager.status,'active')))='active'
     AND lower(btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
    JOIN public.hrp_resolve_leave_employee(p_leave_employee_id) target
      ON target.tenant_id=actor.tenant_id
    JOIN public.employees report
      ON report.id=target.employee_id
     AND report.tenant_id=target.tenant_id
     AND lower(btrim(coalesce(report.status,'active')))='active'
    WHERE bexhr_private.h3b_live_leave_primary_pair(report.id,manager.id)
       OR EXISTS (SELECT 1 FROM public.hrp_find_active_leave_delegation(p_leave_employee_id))
  );
$function$;
CREATE OR REPLACE FUNCTION public.get_manager_leave_readiness()
 RETURNS TABLE(request_id uuid, canonical_employee_id uuid, manager_type text, employee_gender text, leave_type_id uuid, eligibility_rule text, has_balance boolean, entitled_days numeric, used_days numeric, remaining_days numeric, can_decide boolean, decision_authority text, delegation_id uuid, delegation_ends_at timestamp with time zone, delegated_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H3B_READINESS_V1
  WITH actor AS (
    SELECT * FROM public.hrp_current_manager_employee()
  ),
  visible AS (
    SELECT lr.id AS request_id,
      target.employee_id AS canonical_employee_id,
      line.manager_type::text AS manager_type,
      employee.gender::text AS employee_gender,
      lr.leave_type_id,
      coalesce(lt.eligibility_rule::text,'all_employees') AS eligibility_rule,
      (balance.id IS NOT NULL) AS has_balance,
      balance.entitled_days::numeric,
      balance.used_days::numeric,
      balance.remaining_days::numeric,
      CASE WHEN lower(btrim(coalesce(line.manager_type::text,'')))='primary'
        THEN 0 ELSE 1 END AS relationship_rank,
      line.effective_date
    FROM actor a
    JOIN public.leave_requests lr ON TRUE
    JOIN LATERAL public.hrp_resolve_leave_employee(lr.employee_id) target
      ON target.tenant_id=a.tenant_id
    JOIN public.employees employee ON employee.id=target.employee_id
    JOIN public.employee_reporting_lines line
      ON line.employee_id=target.employee_id
     AND line.manager_employee_id=a.manager_employee_id
     AND (line.tenant_id=a.tenant_id OR line.tenant_id IS NULL)
     AND lower(btrim(coalesce(line.status::text,'active')))='active'
     AND lower(btrim(coalesce(line.manager_type::text,''))) IN ('primary','secondary')
    JOIN public.leave_types lt ON lt.id=lr.leave_type_id
    LEFT JOIN public.employee_leave_balances balance
      ON balance.employee_id=target.employee_id
     AND balance.leave_type_id=lr.leave_type_id
  ),
  chosen AS (
    SELECT DISTINCT ON (v.request_id) v.*
    FROM visible v
    ORDER BY v.request_id,v.relationship_rank,v.effective_date DESC NULLS LAST
  )
  SELECT c.request_id,c.canonical_employee_id,c.manager_type,
    c.employee_gender,c.leave_type_id,c.eligibility_rule,c.has_balance,
    c.entitled_days,c.used_days,c.remaining_days,
    (allowed.is_authorized AND (
       (lower(btrim(coalesce(c.manager_type,'')))='primary'
          AND bexhr_private.h3b_live_leave_primary_pair(
              c.canonical_employee_id,a.manager_employee_id))
       OR (lower(btrim(coalesce(c.manager_type,'')))='secondary'
          AND delegated.delegation_id IS NOT NULL)
     )) AS can_decide,
    CASE
      WHEN allowed.is_authorized
       AND lower(btrim(coalesce(c.manager_type,'')))='primary'
       AND bexhr_private.h3b_live_leave_primary_pair(
          c.canonical_employee_id,a.manager_employee_id) THEN 'primary'
      WHEN allowed.is_authorized
       AND lower(btrim(coalesce(c.manager_type,'')))='secondary'
       AND delegated.delegation_id IS NOT NULL THEN 'delegated'
      ELSE 'view_only'
    END AS decision_authority,
    delegated.delegation_id,delegated.ends_at,
    coalesce(nullif(btrim(primary_profile.full_name),''),primary_employee.work_email,'')
      AS delegated_by_name
  FROM chosen c
  CROSS JOIN actor a
  CROSS JOIN LATERAL (
    SELECT public.hrp_is_current_user_authorized_manager_for_leave_employee(
      c.canonical_employee_id) AS is_authorized
  ) allowed
  LEFT JOIN LATERAL public.hrp_find_active_leave_delegation(
    c.canonical_employee_id) delegated ON TRUE
  LEFT JOIN public.employees primary_employee
    ON primary_employee.id=delegated.primary_manager_employee_id
  LEFT JOIN public.profiles primary_profile
    ON primary_profile.tenant_id=primary_employee.tenant_id
   AND (primary_profile.id=primary_employee.user_id
        OR (primary_employee.work_email IS NOT NULL
         AND lower(coalesce(primary_profile.email,''))=lower(primary_employee.work_email)));
$function$;
CREATE OR REPLACE FUNCTION bex_pa_private.manages_department(p_department uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- BEXHR_H4_DEPARTMENT_GOAL_ROLE_GATE_V1
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.organization_departments department
      ON department.tenant_id=actor.tenant_id
     AND department.id=p_department
    JOIN public.employees employee
      ON employee.tenant_id=department.tenant_id
     AND lower(btrim(coalesce(employee.department,''))) =
         lower(btrim(coalesce(department.department_name,'')))
    WHERE actor.id=auth.uid()
      AND actor.is_active IS TRUE
      AND actor.tenant_id=public.current_authenticated_profile_tenant_id()
      -- Do not expand department-goal editing to HR Standard or HR Admin
      -- simply because they are Primary managers of individual employees.
      AND lower(btrim(coalesce(actor.role,'')))='manager'
      AND lower(btrim(coalesce(employee.status,'active')))='active'
      AND 1=(SELECT count(*) FROM public.organization_departments other
        WHERE other.tenant_id=department.tenant_id
          AND lower(btrim(coalesce(other.department_name,'')))=
              lower(btrim(coalesce(department.department_name,''))))
      AND bex_pa_private.is_manager_of(employee.id, TRUE)
  );
$function$;

DO $post$ DECLARE n int; t int; h int; leave_good int; pa_good int; spoof int; BEGIN
SELECT count(*),count(distinct tenant_id) INTO n,t FROM bexhr_private.p7b_legacy_primary_transition;
IF n<>8 OR t<>1 THEN RAISE EXCEPTION 'P7B legacy snapshot %/%',n,t; END IF;
SELECT count(*) FILTER(WHERE bexhr_private.h11_current_primary_authority(l.employee_id,l.manager_employee_id)),
count(*) FILTER(WHERE bexhr_private.h3b_live_leave_primary_pair(l.employee_id,l.manager_employee_id)),
count(*) FILTER(WHERE bexhr_private.resolve_pa_manager_review_route(l.employee_id,e.tenant_id)->>'route'='PRIMARY_MANAGER')
INTO h,leave_good,pa_good FROM public.employee_reporting_lines l JOIN public.employees e ON e.id=l.employee_id
WHERE lower(btrim(coalesce(l.manager_type,'')))='primary' AND lower(btrim(coalesce(l.status,'active')) )='active';
IF h<>19 OR leave_good<>19 OR pa_good<>19 THEN RAISE EXCEPTION 'P7B regression H11 %, Leave %, PA %',h,leave_good,pa_good; END IF;
SELECT count(*) INTO spoof FROM bexhr_private.p7b_legacy_primary_transition s WHERE
bexhr_private.h11_current_primary_authority(s.employee_id,gen_random_uuid()) OR
bexhr_private.h11_current_primary_authority(gen_random_uuid(),s.manager_employee_id);
IF spoof<>0 THEN RAISE EXCEPTION 'P7B spoof allowed %',spoof; END IF;
IF has_table_privilege('authenticated','bexhr_private.p7b_legacy_primary_transition','SELECT') OR
has_function_privilege('authenticated','bexhr_private.p7b_legacy_transition_allowed(uuid,uuid)','EXECUTE')
THEN RAISE EXCEPTION 'P7B restricted snapshot exposed'; END IF;
IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL THEN RAISE EXCEPTION 'P7B premature activation';END IF;
END;$post$;