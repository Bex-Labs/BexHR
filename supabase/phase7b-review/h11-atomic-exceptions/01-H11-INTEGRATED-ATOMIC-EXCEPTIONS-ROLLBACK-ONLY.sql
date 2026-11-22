-- BEXHR H11 SYSTEM-WIDE INTEGRATION: SOURCE CANDIDATE v1
-- READ-ONLY OUTPUT: REVIEW / ISOLATED NONPRODUCTION REHEARSAL ONLY.
-- DO NOT EXECUTE ON PRODUCTION. DO NOT REMOVE FINAL ROLLBACK.
-- Source: user-uploaded 145-file local snapshot + pinned H8 v8 legacy-pair candidate.
-- This is NOT a release migration; no production change is approved.

-- BEXHR PHASE 7B - FULL CHAIN TRANSACTIONAL REHEARSAL (REVIEW ONLY)
-- NO PRODUCTION FORWARD. The entire stage chain uses ONE transaction;
-- every temporary function change is undone by the final ROLLBACK.
-- This script does not insert/update/delete application data or auto-realign
-- any employee, leave decision, or PA reviewer snapshot.
-- Run the ENTIRE script in ONE Supabase SQL Editor execution.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $p7b_combined_baseline$
DECLARE v_snapshot jsonb;
BEGIN
  IF to_regclass('public.employee_reporting_lines') IS NULL
     OR to_regclass('public.manager_leave_delegations') IS NULL
     OR to_regclass('public.pa_employee_appraisals') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: required baseline tables not found';
  END IF;
  SELECT jsonb_build_object(
    'employees', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employees row_record),
    'profiles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.profiles row_record),
    'reporting', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employee_reporting_lines row_record),
    'organization_titles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.organization_job_titles row_record),
    'position_links', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.organization_job_title_hierarchy row_record),
    'pa_cycles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_cycles row_record),
    'pa_employee_appraisals', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_employee_appraisals row_record),
    'pa_manager_appraisals', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_manager_appraisals row_record),
    'leave_requests', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.leave_requests row_record),
    'leave_delegations', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.manager_leave_delegations row_record),
    'leave_balances', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employee_leave_balances row_record)
  ) INTO v_snapshot;
  PERFORM set_config('bexhr.p7b_combined_baseline', v_snapshot::text, true);
END;
$p7b_combined_baseline$;

-- ========================================================================
-- STAGED COMPONENT 10-DEPARTMENT | source SHA-256 caf336b01d8e9455b2dafc35f65c13e6ed68f0cd4e138d7d2836f1e181e06f78
-- This is a review-only copy WITHOUT its original BEGIN/COMMIT wrapper.
-- ========================================================================
-- BexHR Phase 7B: tenant-scoped position hierarchy, departmental extension.
-- REVIEW DRAFT. NOT APPROVED FOR PRODUCTION EXECUTION.
-- Execute ONLY after reviewing the rollback rehearsal and coordinating
-- HR/Manager/Employee/Leave/PA and capability activation.
-- Idempotence policy: fail closed if this new backend is already present.
-- No employee role, employee reporting line, leave, payroll or PA data is changed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $p7b_preflight$
BEGIN
  IF to_regclass('public.organization_job_titles') IS NULL
     OR to_regclass('public.organization_departments') IS NULL
     OR to_regclass('public.organization_job_title_hierarchy') IS NULL
     OR to_regprocedure('public.require_current_tenant_administrator()') IS NULL
     OR to_regprocedure('public.hr_tenant_admin_save_organization_job_title(uuid,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.hr_tenant_admin_save_organization_job_title_hierarchy(uuid,uuid)') IS NULL
     OR to_regprocedure('public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)') IS NULL
     OR to_regprocedure('bexhr_private.enforce_organization_job_title_hierarchy_integrity()') IS NULL
     OR to_regprocedure('bexhr_private.guard_organization_job_title_hierarchy_source()') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: R12C/Phase4A prerequisites are missing';
  END IF;
  IF to_regprocedure('public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: Phase7B backend already installed; do not repeat';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.organization_job_title_hierarchy'::regclass
      AND tgname = 'bexhr_enforce_organization_job_title_hierarchy_integrity'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.organization_job_titles'::regclass
      AND tgname = 'bexhr_guard_organization_job_title_hierarchy_source'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: existing hierarchy integrity triggers are missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_job_title_hierarchy'::regclass) THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: hierarchy RLS is not enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'INSERT')
     OR has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'DELETE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: browser role has direct hierarchy write privileges';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organization_job_title_hierarchy h
    LEFT JOIN public.organization_job_titles child ON child.id=h.job_title_id
    LEFT JOIN public.organization_job_titles parent ON parent.id=h.reports_to_job_title_id
    WHERE child.id IS NULL
       OR (child.tenant_id IS NOT NULL AND child.tenant_id <> h.tenant_id)
       OR (child.department_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.organization_departments d
         WHERE d.id=child.department_id AND d.tenant_id=h.tenant_id))
       OR (h.reports_to_job_title_id IS NOT NULL AND (
           parent.id IS NULL OR
           (parent.tenant_id IS NOT NULL AND parent.tenant_id <> h.tenant_id) OR
           (parent.department_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.organization_departments d
             WHERE d.id=parent.department_id AND d.tenant_id=h.tenant_id))))
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: existing links contain orphan or cross-tenant positions';
  END IF;
END;
$p7b_preflight$;

-- H2 INTEGRITY: one explicitly configured organisational root per tenant.
-- Never choose a root or rewrite an existing tenant's positions automatically.
-- The partial unique index is enforced for ALL writers, even service_role,
-- and serialises competing attempts; a UI-only root check is insufficient.
DO $h2_single_root_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.bexhr_h2_single_root_per_tenant_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_H2_STOP: one-root index already exists; do not repeat';
  END IF;
  IF EXISTS (
    SELECT h.tenant_id
      FROM public.organization_job_title_hierarchy h
     WHERE h.reports_to_job_title_id IS NULL
     GROUP BY h.tenant_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'BEXHR_H2_STOP: multiple roots exist; fix through reviewed company setup before migration'
      USING ERRCODE='23514';
  END IF;
END;
$h2_single_root_preflight$;

CREATE UNIQUE INDEX bexhr_h2_single_root_per_tenant_idx
  ON public.organization_job_title_hierarchy (tenant_id)
  WHERE reports_to_job_title_id IS NULL;

-- Keep the established table, FK, tenant RLS, audit trail and trigger names.
-- Only broaden valid position scope from company-wide to department OR company-wide.
CREATE OR REPLACE FUNCTION bexhr_private.enforce_organization_job_title_hierarchy_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_cycle_found boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.job_title_id IS DISTINCT FROM OLD.job_title_id THEN
      RAISE EXCEPTION 'BEXHR_POSITION_HIERARCHY_IDENTITY_LOCK: hierarchy identity cannot change'
        USING ERRCODE='23514';
    END IF;
    NEW.updated_at := now();
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by, OLD.updated_by);
  ELSE
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
    NEW.updated_by := coalesce(NEW.updated_by, auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_job_titles p
    WHERE p.id=NEW.job_title_id
      AND lower(btrim(coalesce(p.status,'')))='active'
      AND (p.tenant_id=NEW.tenant_id OR p.tenant_id IS NULL)
      AND (p.department_id IS NULL OR EXISTS (
        SELECT 1 FROM public.organization_departments d
        WHERE d.id=p.department_id AND d.tenant_id=NEW.tenant_id
          AND lower(btrim(coalesce(d.status,'active')))='active'
      ))
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_CHILD_INVALID: child position unavailable to this company'
      USING ERRCODE='23514';
  END IF;

  IF NEW.reports_to_job_title_id IS NOT NULL THEN
    IF NEW.reports_to_job_title_id=NEW.job_title_id THEN
      RAISE EXCEPTION 'BEXHR_P7B_SELF_REFERENCE: position cannot report to itself'
        USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_job_titles p
      WHERE p.id=NEW.reports_to_job_title_id
        AND lower(btrim(coalesce(p.status,'')))='active'
        AND (p.tenant_id=NEW.tenant_id OR p.tenant_id IS NULL)
        AND (p.department_id IS NULL OR EXISTS (
          SELECT 1 FROM public.organization_departments d
          WHERE d.id=p.department_id AND d.tenant_id=NEW.tenant_id
            AND lower(btrim(coalesce(d.status,'active')))='active'
        ))
    ) THEN
      RAISE EXCEPTION 'BEXHR_P7B_PARENT_INVALID: parent unavailable to this company'
        USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
      WHERE h.tenant_id=NEW.tenant_id AND h.job_title_id=NEW.reports_to_job_title_id
    ) THEN
      RAISE EXCEPTION 'BEXHR_P7B_PARENT_NOT_CONFIGURED: configure the parent first'
        USING ERRCODE='23514';
    END IF;

    SELECT EXISTS (
      WITH RECURSIVE parent_chain(job_title_id) AS (
        SELECT NEW.reports_to_job_title_id
        UNION
        SELECT h.reports_to_job_title_id
        FROM public.organization_job_title_hierarchy h
        JOIN parent_chain chain ON chain.job_title_id=h.job_title_id
        WHERE h.tenant_id=NEW.tenant_id AND h.reports_to_job_title_id IS NOT NULL
      ) SELECT 1 FROM parent_chain WHERE job_title_id=NEW.job_title_id
    ) INTO v_cycle_found;
    IF v_cycle_found THEN
      RAISE EXCEPTION 'BEXHR_P7B_POSITION_CYCLE: reporting loop blocked'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.enforce_organization_job_title_hierarchy_integrity()
  FROM PUBLIC, anon, authenticated;

-- Critical fix: the original Phase4A source guard treats any department title
-- as invalid when used in a hierarchy. Preserve immutability of in-use scope,
-- but allow a position that was already departmental to remain departmental.
CREATE OR REPLACE FUNCTION bexhr_private.guard_organization_job_title_hierarchy_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
      WHERE h.job_title_id=OLD.id OR h.reports_to_job_title_id=OLD.id
    ) THEN
      RAISE EXCEPTION 'BEXHR_P7B_POSITION_IN_USE: remove links before deleting a job title'
        USING ERRCODE='23503';
    END IF;
    RETURN OLD;
  END IF;

  IF (
       NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR lower(btrim(coalesce(NEW.status,''))) <> 'active'
     ) AND EXISTS (
       SELECT 1 FROM public.organization_job_title_hierarchy h
       WHERE h.job_title_id=OLD.id OR h.reports_to_job_title_id=OLD.id
     ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_IN_USE: unlink/reassign before changing active scope or tenant'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.guard_organization_job_title_hierarchy_source()
  FROM PUBLIC, anon, authenticated;

-- Preserve original HR-only authorisation and function signature.
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_save_organization_job_title_hierarchy(
  p_job_title_id uuid, p_reports_to_job_title_id uuid DEFAULT NULL
)
RETURNS public.organization_job_title_hierarchy
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result public.organization_job_title_hierarchy%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant_id := public.require_current_tenant_administrator();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tenant_id::text)::bigint);
  IF p_job_title_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_job_titles p
    WHERE p.id=p_job_title_id
      AND lower(btrim(coalesce(p.status,'')))='active'
      AND (p.tenant_id=v_tenant_id OR p.tenant_id IS NULL)
      AND (p.department_id IS NULL OR EXISTS (
        SELECT 1 FROM public.organization_departments d
        WHERE d.id=p.department_id AND d.tenant_id=v_tenant_id
          AND lower(btrim(coalesce(d.status,'active')))='active'
      ))
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_INVALID: active position required in this company'
      USING ERRCODE='23514';
  END IF;
  IF p_reports_to_job_title_id IS NOT NULL THEN
    IF p_reports_to_job_title_id=p_job_title_id THEN
      RAISE EXCEPTION 'BEXHR_P7B_SELF_REFERENCE' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
      WHERE h.tenant_id=v_tenant_id AND h.job_title_id=p_reports_to_job_title_id
    ) THEN
      RAISE EXCEPTION 'BEXHR_P7B_PARENT_NOT_CONFIGURED' USING ERRCODE='23514';
    END IF;
  END IF;
  INSERT INTO public.organization_job_title_hierarchy (
    tenant_id, job_title_id, reports_to_job_title_id, created_by, updated_by
  ) VALUES (
    v_tenant_id, p_job_title_id, p_reports_to_job_title_id, auth.uid(), auth.uid()
  ) ON CONFLICT ON CONSTRAINT organization_job_title_hierarchy_tenant_job_unique
  DO UPDATE SET reports_to_job_title_id=excluded.reports_to_job_title_id,
                updated_by=auth.uid(), updated_at=now()
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_save_organization_job_title_hierarchy(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_save_organization_job_title_hierarchy(uuid,uuid)
  TO authenticated, service_role;

-- Existing HR-only delete path gets the same per-company serialization.
CREATE OR REPLACE FUNCTION public.hr_tenant_admin_delete_organization_job_title_hierarchy(p_job_title_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant_id := public.require_current_tenant_administrator();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tenant_id::text)::bigint);
  IF p_job_title_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_job_title_hierarchy h
    WHERE h.tenant_id=v_tenant_id AND h.reports_to_job_title_id=p_job_title_id
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_HAS_CHILDREN: reassign children first'
      USING ERRCODE='23503';
  END IF;
  DELETE FROM public.organization_job_title_hierarchy h
  WHERE h.tenant_id=v_tenant_id AND h.job_title_id=p_job_title_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BEXHR_P7B_POSITION_LINK_MISSING' USING ERRCODE='P0002';
  END IF;
  RETURN TRUE;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_delete_organization_job_title_hierarchy(uuid)
  TO authenticated, service_role;

-- All-or-nothing HR Admin save: position title and reporting link in one
-- PostgreSQL transaction, including deactivation/unlink. No partial saves.
CREATE FUNCTION public.hr_tenant_admin_save_position_with_reporting(
  p_job_title_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_job_title text DEFAULT NULL,
  p_status text DEFAULT 'Active',
  p_notes text DEFAULT NULL,
  p_reports_to_job_title_id uuid DEFAULT NULL,
  p_configure_reporting boolean DEFAULT TRUE
)
RETURNS public.organization_job_titles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result public.organization_job_titles%rowtype;
  v_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_AUTH_REQUIRED' USING ERRCODE='42501';
  END IF;
  v_tenant_id := public.require_current_tenant_administrator();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tenant_id::text)::bigint);
  IF lower(btrim(coalesce(p_status,''))) NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'BEXHR_P7B_BAD_STATUS' USING ERRCODE='22023';
  END IF;
  v_active := lower(btrim(p_status))='active';
  IF v_active AND p_configure_reporting IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BEXHR_P7B_REPORTING_REQUIRED: choose a parent or explicitly Top level'
      USING ERRCODE='23514';
  END IF;
  IF NOT v_active AND p_reports_to_job_title_id IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_INACTIVE_PARENT_NOT_ALLOWED' USING ERRCODE='23514';
  END IF;
  IF NOT v_active AND p_job_title_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_job_title_hierarchy h
    WHERE h.tenant_id=v_tenant_id AND h.job_title_id=p_job_title_id
  ) THEN
    -- If this position has children, removal fails and everything rolls back.
    PERFORM public.hr_tenant_admin_delete_organization_job_title_hierarchy(p_job_title_id);
  END IF;

  v_result := public.hr_tenant_admin_save_organization_job_title(
    p_job_title_id, p_department_id, p_job_title, p_status, p_notes
  );
  IF v_active THEN
    PERFORM public.hr_tenant_admin_save_organization_job_title_hierarchy(
      v_result.id, p_reports_to_job_title_id
    );
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)
  TO authenticated;
COMMENT ON FUNCTION public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)
  IS 'HR Admin-only single-transaction job title + position hierarchy save; does not modify employee reporting lines.';

-- Frontend opt-in capability, intentionally harmless by itself.
-- Do not deploy this flag before PA/Manager/Employee/Leave integration is ready.
CREATE FUNCTION public.bexhr_p7b_structure_capabilities()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'department_positions', true,
    'atomic_position_save', true,
    'schema_version', 1
  );
$function$;
REVOKE ALL ON FUNCTION public.bexhr_p7b_structure_capabilities()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bexhr_p7b_structure_capabilities()
  TO authenticated;

DO $p7b_verify$
BEGIN
  IF has_table_privilege('authenticated','public.organization_job_title_hierarchy','INSERT')
     OR has_table_privilege('authenticated','public.organization_job_title_hierarchy','UPDATE')
     OR has_table_privilege('authenticated','public.organization_job_title_hierarchy','DELETE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: authenticated has unsafe hierarchy table writes';
  END IF;
  IF has_function_privilege('anon',
       'public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: anonymous can invoke protected position save';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: HR Admin save is not callable through authenticated RPC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_job_title_hierarchy h
    WHERE h.reports_to_job_title_id=h.job_title_id
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_STOP: existing self-reporting positions';
  END IF;
  IF pg_catalog.to_regclass('public.bexhr_h2_single_root_per_tenant_idx') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H2_STOP: database single-root unique index absent';
  END IF;
END;
$p7b_verify$;

-- ========================================================================
-- STAGED COMPONENT 20-REPORTING | source SHA-256 581d8e512aca7e91363ab870d521db25a8352a824d773afabc9eb36d7e7a4974
-- This is a review-only copy WITHOUT its original BEGIN/COMMIT wrapper.
-- ========================================================================
-- BexHR Phase 7B: transitional Primary reporting position validator.
-- REVIEW-ONLY FORWARD DRAFT. DO NOT APPLY TO PRODUCTION.
-- No data updates, employee reassignment, PA rewrite, trigger removal,
-- hierarchy capability activation or role/privilege broadening.
-- Requires existing R-14B trigger/leave functions and Phase4A hierarchy table.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $p7b_preflight$
BEGIN
  IF to_regclass('public.employees') IS NULL
     OR to_regclass('public.employee_reporting_lines') IS NULL
     OR to_regclass('public.organization_job_titles') IS NULL
     OR to_regclass('public.organization_departments') IS NULL
     OR to_regclass('public.organization_job_title_hierarchy') IS NULL
     OR to_regprocedure('bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.is_whole_organization_employee(uuid)') IS NULL
     OR to_regprocedure('bexhr_private.is_hr_admin_employee(uuid)') IS NULL
     OR to_regprocedure('bexhr_private.enforce_reporting_role_integrity()') IS NULL
     OR to_regprocedure('bexhr_private.reconcile_employee_primary_reporting_lines(uuid)') IS NULL
     OR to_regprocedure('public.get_employee_leave_primary_manager_readiness()') IS NULL
     OR to_regprocedure('public.pa_current_user_is_primary_manager_of(uuid)') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: base hierarchy, R14B, PA or leave prerequisites missing';
  END IF;
  IF to_regprocedure('bexhr_private.p7b_resolve_employee_position_id(uuid)') IS NOT NULL
     OR to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('bexhr_private.p7b_legacy_primary_pair_allowed(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: validator already installed; do not run twice';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='public.employee_reporting_lines'::regclass
      AND tgname='bexhr_enforce_reporting_role_integrity' AND NOT tgisinternal AND tgenabled<>'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='public.employees'::regclass
      AND tgname='bexhr_reconcile_reporting_after_employee_position_change' AND NOT tgisinternal AND tgenabled<>'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
      AND tgname='bexhr_reconcile_reporting_after_profile_authority_change' AND NOT tgisinternal AND tgenabled<>'D'
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: expected R14B integrity/reconciliation triggers missing or disabled';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.employee_reporting_lines rl
      JOIN public.employees child ON child.id=rl.employee_id
      LEFT JOIN public.employees manager ON manager.id=rl.manager_employee_id
     WHERE lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
       AND lower(btrim(coalesce(rl.status::text,'active')))='active'
       AND (manager.id IS NULL OR manager.tenant_id IS DISTINCT FROM child.tenant_id
         OR (rl.tenant_id IS NOT NULL AND rl.tenant_id<>child.tenant_id)
         OR rl.employee_id=rl.manager_employee_id
         OR lower(btrim(coalesce(child.status,'active')))<>'active'
         OR lower(btrim(coalesce(manager.status,'active')))<>'active')
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: active Primary line has a hard identity or tenant-integrity error';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines rl
      WHERE lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
        AND lower(btrim(coalesce(rl.status::text,'active')))='active'
      GROUP BY rl.employee_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: multiple active Primary lines detected';
  END IF;
END;
$p7b_preflight$;

-- Position IDs are resolved by (tenant, active title, matching department).
-- Exact department-specific match wins; otherwise use a whole-company title.
-- Tenant title wins over globally catalogued title, with ambiguity failing closed.
-- No CEO/COO/HR Admin title or blank-HQ assumption is used here.
CREATE FUNCTION bexhr_private.p7b_resolve_employee_position_id(p_employee_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_ids uuid[];
BEGIN
  IF p_employee_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
  IF v_employee.id IS NULL OR v_employee.tenant_id IS NULL
     OR nullif(btrim(coalesce(v_employee.job_title,'')),'') IS NULL
     OR lower(btrim(coalesce(v_employee.status,'active')))<>'active' THEN
    RETURN NULL;
  END IF;

  WITH candidates AS (
    SELECT jt.id, jt.tenant_id, jt.department_id,
           (jt.department_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.organization_departments d
              WHERE d.id=jt.department_id AND d.tenant_id=v_employee.tenant_id
                AND lower(btrim(coalesce(d.status,'active')))='active'
                AND lower(btrim(regexp_replace(coalesce(d.department_name,''),'[[:space:]]+',' ','g')))
                   =lower(btrim(regexp_replace(coalesce(v_employee.department,''),'[[:space:]]+',' ','g')))
           )) AS exact_department
      FROM public.organization_job_titles jt
     WHERE (jt.tenant_id=v_employee.tenant_id OR jt.tenant_id IS NULL)
       AND lower(btrim(coalesce(jt.status,'active')))='active'
       AND lower(btrim(regexp_replace(coalesce(jt.job_title,''),'[[:space:]]+',' ','g')))
          =lower(btrim(regexp_replace(v_employee.job_title,'[[:space:]]+',' ','g')))
       AND (jt.department_id IS NULL OR EXISTS (
             SELECT 1 FROM public.organization_departments d
              WHERE d.id=jt.department_id AND d.tenant_id=v_employee.tenant_id
                AND lower(btrim(coalesce(d.status,'active')))='active'
           ))
  ), scoped AS (
    SELECT *, bool_or(exact_department) OVER () AS has_department_match
      FROM candidates
  ), candidates_in_scope AS (
    SELECT * FROM scoped
     WHERE (has_department_match AND exact_department)
        OR (NOT has_department_match AND department_id IS NULL)
  ), preferred AS (
    SELECT *, bool_or(coalesce(tenant_id=v_employee.tenant_id,FALSE)) OVER () AS tenant_owned_exists
      FROM candidates_in_scope
  )
  SELECT array_agg(id) INTO v_ids FROM preferred
   WHERE NOT tenant_owned_exists OR tenant_id=v_employee.tenant_id;

  IF coalesce(array_length(v_ids,1),0)<>1 THEN RETURN NULL; END IF;
  RETURN v_ids[1];
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.p7b_resolve_employee_position_id(uuid)
  FROM PUBLIC, anon, authenticated;

-- Strict configured Primary eligibility: nearest OCCUPIED ancestor position.
-- A vacant parent is skipped. Missing/cyclic hierarchy or ambiguous titles fail closed.
-- This helper is also useful for a future non-mutating reporting-line audit.
CREATE FUNCTION bexhr_private.p7b_configured_primary_match(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_tenant uuid;
  v_child_position uuid;
  v_manager_position uuid;
  v_parent uuid;
  v_visited uuid[];
  v_step integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.employees WHERE id=p_employee_id;
  IF v_tenant IS NULL THEN RETURN FALSE; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees m WHERE m.id=p_manager_employee_id AND m.tenant_id=v_tenant
      AND lower(btrim(coalesce(m.status,'active')))='active'
      -- H2: a fancy position title must never grant an Employee-role user
      -- management authority. HR Standard/Admin can manage assigned reports.
      AND lower(btrim(coalesce(m.system_role,''))) IN ('manager','hr','hr_manager')
  ) THEN RETURN FALSE; END IF;
  v_child_position := bexhr_private.p7b_resolve_employee_position_id(p_employee_id);
  v_manager_position := bexhr_private.p7b_resolve_employee_position_id(p_manager_employee_id);
  IF v_child_position IS NULL OR v_manager_position IS NULL THEN RETURN FALSE; END IF;
  SELECT reports_to_job_title_id INTO v_parent
    FROM public.organization_job_title_hierarchy
   WHERE tenant_id=v_tenant AND job_title_id=v_child_position;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  v_visited := ARRAY[v_child_position];

  FOR v_step IN 1..128 LOOP
    IF v_parent IS NULL OR v_parent = ANY(v_visited) THEN RETURN FALSE; END IF;
    -- The chain must be explicitly configured, even if this ancestor is vacant.
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
       WHERE h.tenant_id=v_tenant AND h.job_title_id=v_parent
    ) THEN RETURN FALSE; END IF;
    v_visited := array_append(v_visited,v_parent);

    -- The first ancestor with active employees is the ONLY Primary level.
    IF EXISTS (
      SELECT 1 FROM public.employees occupant
       WHERE occupant.tenant_id=v_tenant
         AND lower(btrim(coalesce(occupant.status,'active')))='active'
         AND bexhr_private.p7b_resolve_employee_position_id(occupant.id)=v_parent
    ) THEN
      RETURN v_manager_position=v_parent;
    END IF;
    SELECT h.reports_to_job_title_id INTO v_parent
      FROM public.organization_job_title_hierarchy h
     WHERE h.tenant_id=v_tenant AND h.job_title_id=v_parent;
    IF NOT FOUND THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN FALSE; -- Unusually long/corrupt position chains fail closed.
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.p7b_configured_primary_match(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Identical fallback to the existing R14B role rule, used only for NEW lines
-- before the department capability is activated (and only if the child has
-- no configured departmental link). Already-active lines use preservation below.
CREATE FUNCTION bexhr_private.p7b_legacy_primary_pair_allowed(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_employee_role text;
  v_manager_role text;
  v_employee_whole boolean;
  v_manager_whole boolean;
  v_employee_admin boolean;
  v_manager_admin boolean;
BEGIN
  SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
  SELECT * INTO v_manager FROM public.employees WHERE id=p_manager_employee_id;
  IF v_employee.id IS NULL OR v_manager.id IS NULL
     OR v_employee.tenant_id IS DISTINCT FROM v_manager.tenant_id
     OR lower(btrim(coalesce(v_employee.status,'active')))<>'active'
     OR lower(btrim(coalesce(v_manager.status,'active')))<>'active' THEN
    RETURN FALSE;
  END IF;
  v_employee_role := lower(btrim(coalesce(v_employee.system_role,'')));
  v_manager_role := lower(btrim(coalesce(v_manager.system_role,'')));
  v_employee_whole := bexhr_private.is_whole_organization_employee(v_employee.id);
  v_manager_whole := bexhr_private.is_whole_organization_employee(v_manager.id);
  v_employee_admin := bexhr_private.is_hr_admin_employee(v_employee.id);
  v_manager_admin := bexhr_private.is_hr_admin_employee(v_manager.id);
  IF v_manager_whole AND v_manager_role='manager' THEN
    RETURN v_employee_admin OR (v_employee_whole AND v_employee_role='manager');
  END IF;
  IF v_manager_admin THEN
    RETURN NOT v_employee_whole AND NOT v_employee_admin
       AND v_employee_role IN ('hr','hr_manager','manager');
  END IF;
  IF v_manager_role='manager' AND NOT v_manager_whole THEN
    RETURN NOT v_employee_whole
       AND v_employee_role NOT IN ('hr','hr_manager','manager')
       AND nullif(lower(btrim(coalesce(v_manager.department,''))),'') IS NOT NULL
       AND lower(btrim(coalesce(v_manager.department,'')))
          =lower(btrim(coalesce(v_employee.department,'')));
  END IF;
  RETURN FALSE;
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.p7b_legacy_primary_pair_allowed(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Preserve SAME active Primary assignments; never silently reconcile/deactivate
-- the eight historical role-rule conflicts or invalidate an active PA cycle.
-- NEW/changed/reactivated assignments have NO such exemption and must pass the
-- configured hierarchy (or the existing R14B rule while backend is disabled).
CREATE OR REPLACE FUNCTION bexhr_private.is_primary_reporting_relationship_valid(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_child_position uuid;
  v_scope_department uuid;
  v_tenant uuid;
  v_active_primary_count bigint;
BEGIN
  IF p_employee_id IS NULL OR p_manager_employee_id IS NULL
     OR p_employee_id=p_manager_employee_id THEN RETURN FALSE; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
  SELECT * INTO v_manager FROM public.employees WHERE id=p_manager_employee_id;
  IF v_employee.id IS NULL OR v_manager.id IS NULL
     OR v_employee.tenant_id IS NULL
     OR v_employee.tenant_id IS DISTINCT FROM v_manager.tenant_id
     OR lower(btrim(coalesce(v_employee.status,'active')))<>'active'
     OR lower(btrim(coalesce(v_manager.status,'active')))<>'active' THEN
    RETURN FALSE;
  END IF;
  v_tenant := v_employee.tenant_id;

  SELECT count(*) INTO v_active_primary_count
    FROM public.employee_reporting_lines rl
   WHERE rl.employee_id=p_employee_id
     AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
     AND lower(btrim(coalesce(rl.status::text,'active')))='active'
     AND (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL);

  IF v_active_primary_count=1 AND EXISTS (
    SELECT 1 FROM public.employee_reporting_lines rl
     WHERE rl.employee_id=p_employee_id
       AND rl.manager_employee_id=p_manager_employee_id
       AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
       AND lower(btrim(coalesce(rl.status::text,'active')))='active'
       AND (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL)
  ) THEN
    RETURN TRUE;
  END IF;

  -- Any new Primary assignment must be validated against its configured parent.
  v_child_position := bexhr_private.p7b_resolve_employee_position_id(p_employee_id);
  IF v_child_position IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
       WHERE h.tenant_id=v_tenant AND h.job_title_id=v_child_position
    ) THEN
      RETURN bexhr_private.p7b_configured_primary_match(
        p_employee_id,p_manager_employee_id
      );
    END IF;
    SELECT jt.department_id INTO v_scope_department
      FROM public.organization_job_titles jt WHERE jt.id=v_child_position;
    -- Whole-company titles never silently acquire a role-tier fallback.
    IF v_scope_department IS NULL THEN RETURN FALSE; END IF;
  END IF;

  -- H11 DEFAULT-COMPATIBILITY: installing the position editor must never
  -- invalidate the company's still-unconfigured departmental default.
  -- NEW unconfigured lines must pass the prior R14B role rule. Configured
  -- lines above use strict ancestry; company-wide positions never fall back.
  RETURN bexhr_private.p7b_legacy_primary_pair_allowed(
    p_employee_id,p_manager_employee_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep the existing reporting trigger and its name, but ensure one active
-- Primary per employee. An advisory transaction lock serialises concurrent
-- assignments for the same employee. Secondary remains unaffected here.
CREATE OR REPLACE FUNCTION bexhr_private.enforce_reporting_role_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
REVOKE ALL ON FUNCTION bexhr_private.enforce_reporting_role_integrity()
  FROM PUBLIC, anon, authenticated;

-- The existing attached trigger uses this revised function automatically.
-- Existing R14B employee/profile reconciliation triggers, leave readiness
-- and PA RLS functions keep their definitions and consult the new validator.
-- No existing reporting line, leave request or PA snapshot is updated here.
DO $p7b_postcheck$
DECLARE
  v_total bigint;
  v_accepted bigint;
BEGIN
  SELECT count(*), count(*) FILTER (
    WHERE bexhr_private.is_primary_reporting_relationship_valid(
      rl.employee_id,rl.manager_employee_id
    )
  ) INTO v_total,v_accepted
  FROM public.employee_reporting_lines rl
  WHERE lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
    AND lower(btrim(coalesce(rl.status::text,'active')))='active';
  IF v_accepted<>v_total THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: existing active Primary lines would be rejected (% of %)',v_accepted,v_total;
  END IF;
  IF has_function_privilege('authenticated',
       'bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'bexhr_private.p7b_configured_primary_match(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_VALIDATOR_STOP: private function execution leaked to browser roles';
  END IF;
END;
$p7b_postcheck$;

-- ========================================================================
-- H11 ADDITIONS: legacy-trigger reconciliation, explicit exception approval,
-- and shared current Primary authority used in PA and Leave.
-- ========================================================================
-- EXTRACT FROM PINNED v8 SUCCESSFUL SYNTHETIC REGRESSION.
-- DEPENDS ON H8 NEW VALIDATOR IN SAME TRANSACTION. NOT STANDALONE.
-- DO NOT EXECUTE AS A FORWARD MIGRATION.

-- H8_LIVE_PAIR_COMPATIBILITY_CANDIDATE_V2 (TEST TRANSACTION ONLY).
-- This keeps all THREE enforcement triggers enabled, changes no privileges,
-- and harmonizes the older pair validator with the P7B configured-position
-- validator. It is NOT part of the pinned original H8 SQL and is NOT DEPLOYED.
DO $h8_pair_preflight$
BEGIN
  IF to_regprocedure('bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'H8_PAIR_HOLD: required old/new validators missing';
  END IF;
  IF position('is_whole_organization_manager' IN pg_get_functiondef(
       'bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'H8_PAIR_HOLD: unexpected legacy validator version';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid='public.employee_reporting_lines'::regclass
         AND tgname IN ('bexhr_enforce_reporting_hierarchy_integrity',
                        'bexhr_enforce_reporting_pair_integrity',
                        'bexhr_enforce_reporting_role_integrity')
         AND NOT tgisinternal AND tgenabled='O')<>3 THEN
    RAISE EXCEPTION 'H8_PAIR_HOLD: expected three enabled reporting triggers missing';
  END IF;
  IF has_function_privilege('anon',
       'bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'H8_PAIR_HOLD: legacy private helper exposed to browser role';
  END IF;
END;
$h8_pair_preflight$;

-- Keep the existing trigger and signature, consolidate the decision rule.
-- Same DEFINER/STABLE contract as original legacy helper; no trigger disabled.
CREATE OR REPLACE FUNCTION bexhr_private.is_valid_primary_reporting_pair(
  p_employee_id uuid, p_manager_employee_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $h8_candidate_pair$
  SELECT bexhr_private.is_primary_reporting_relationship_valid(
    p_employee_id, p_manager_employee_id
  );
$h8_candidate_pair$;

REVOKE ALL ON FUNCTION bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)
FROM PUBLIC, anon, authenticated;

DO $h8_pair_postflight$
BEGIN
  IF has_function_privilege('anon',
       'bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)','EXECUTE')
     OR (SELECT count(*) FROM pg_trigger
       WHERE tgrelid='public.employee_reporting_lines'::regclass
         AND tgname IN ('bexhr_enforce_reporting_hierarchy_integrity',
                        'bexhr_enforce_reporting_pair_integrity',
                        'bexhr_enforce_reporting_role_integrity')
         AND NOT tgisinternal AND tgenabled='O')<>3 THEN
    RAISE EXCEPTION 'H8_PAIR_HOLD: role security or trigger postflight failed';
  END IF;
END;
$h8_pair_postflight$;



-- H11 INTEGRATED H6D EXPLICIT EXCEPTIONS; review source in supabase/phase7b-review.
-- BEXHR H6D: EXPLICIT PRIMARY REPORTING EXCEPTION APPROVALS.
-- REVIEW-ONLY FORWARD DRAFT. DO NOT RUN ON PRODUCTION.
-- DEPLOY ORDER: Phase7B position backend + H2 reporting validator -> H6D -> H3 PA -> H3B Leave -> H4.
-- No existing employee, reporting, PA, leave, payroll or historical snapshot rows are updated.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $h6d_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.employees') IS NULL
    OR pg_catalog.to_regclass('public.profiles') IS NULL
    OR pg_catalog.to_regclass('public.employee_reporting_lines') IS NULL
    OR pg_catalog.to_regclass('public.organization_job_titles') IS NULL
    OR pg_catalog.to_regclass('public.organization_job_title_hierarchy') IS NULL
    OR pg_catalog.to_regprocedure('public.require_current_tenant_administrator()') IS NULL
    OR pg_catalog.to_regprocedure('bexhr_private.p7b_resolve_employee_position_id(uuid)') IS NULL
    OR pg_catalog.to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: Phase7B/H2 position capability and tenant admin guard must be deployed first';
  END IF;
  IF pg_catalog.to_regclass('bexhr_private.h6d_approved_primary_exceptions') IS NOT NULL
    OR pg_catalog.to_regprocedure('bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.hr_tenant_admin_revoke_primary_exception(uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.hr_tenant_admin_list_primary_exceptions()') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: exception capability already exists; do not deploy twice';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines line
    JOIN public.employees report ON report.id=line.employee_id
    LEFT JOIN public.employees manager ON manager.id=line.manager_employee_id
    WHERE lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
      AND (manager.id IS NULL OR report.tenant_id IS NULL
        OR report.tenant_id IS DISTINCT FROM manager.tenant_id
        OR (line.tenant_id IS NOT NULL AND line.tenant_id<>report.tenant_id)
        OR report.id=manager.id)
  ) THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: identity/tenant invalid for existing active Primary; correct before rehearsal';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_reporting_lines line
    WHERE lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
      AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
    GROUP BY line.employee_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: duplicate active Primary assignments';
  END IF;
END;
$h6d_preflight$;

-- Private ledger: rows are individual, deliberate, HR-Admin-approved exceptions.
-- Never turn all older Primary rows into authorisation grants automatically.
-- No DELETE: a revoked row stays as an audit record. No FK ON DELETE CASCADE;
-- replacing a reporting line changes its ID and automatically invalidates the old approval.
CREATE TABLE bexhr_private.h6d_approved_primary_exceptions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reporting_line_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  manager_employee_id uuid NOT NULL,
  employee_position_id uuid NOT NULL,
  manager_position_id uuid NOT NULL,
  child_position_link_was_configured boolean NOT NULL,
  child_parent_position_at_approval uuid,
  reason text NOT NULL CHECK (
    char_length(pg_catalog.btrim(reason)) BETWEEN 12 AND 500
  ),
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  CONSTRAINT h6d_expiry_after_approval CHECK (
    expires_at IS NULL OR expires_at > approved_at
  ),
  CONSTRAINT h6d_parent_snapshot_consistent CHECK (
    child_position_link_was_configured OR child_parent_position_at_approval IS NULL
  ),
  CONSTRAINT h6d_revocation_together CHECK (
    (revoked_by IS NULL) = (revoked_at IS NULL)
  )
);
CREATE UNIQUE INDEX h6d_one_unrevoked_exception_per_employee
  ON bexhr_private.h6d_approved_primary_exceptions(tenant_id,employee_id)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX h6d_one_unrevoked_exception_per_line
  ON bexhr_private.h6d_approved_primary_exceptions(tenant_id,reporting_line_id)
  WHERE revoked_at IS NULL;
CREATE INDEX h6d_exception_reporting_lookup
  ON bexhr_private.h6d_approved_primary_exceptions(
    tenant_id,employee_id,manager_employee_id,reporting_line_id
  );
ALTER TABLE bexhr_private.h6d_approved_primary_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bexhr_private.h6d_approved_primary_exceptions FROM PUBLIC, anon, authenticated;

-- Current approval is never inferred from an old relationship alone. It must
-- still match the exact active line ID, positions, tenant, manager login/role,
-- active employee statuses, one-Primary rule and optional expiry.
-- Only private server-side functions can call this; browser roles are revoked.
CREATE FUNCTION bexhr_private.h6d_is_approved_current_primary_exception(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h6d_check$
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
$h6d_check$;
REVOKE ALL ON FUNCTION bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Exactly one affected Primary relationship can be approved per RPC call.
-- Approval DOES change which current Primary manager may decide PA/Leave once
-- held H3/H3B gates are deployed, so it is a privileged and auditable action.
-- The administrator must provide a reason; default is no expiry for enduring
-- individually approved exceptions. An optional expiry gives temporary scope.
CREATE FUNCTION public.hr_tenant_admin_approve_primary_exception(
  p_reporting_line_id uuid, p_reason text, p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $h6d_approve$
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
$h6d_approve$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)
  TO authenticated;

-- Revocation leaves the old row for audit, invalidating authority immediately.
CREATE FUNCTION public.hr_tenant_admin_revoke_primary_exception(p_approval_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $h6d_revoke$
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
$h6d_revoke$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_revoke_primary_exception(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_revoke_primary_exception(uuid)
  TO authenticated;

-- Tenant-scoped review UI uses this RPC; private table remains unreadable.
CREATE FUNCTION public.hr_tenant_admin_list_primary_exceptions()
RETURNS TABLE (
  approval_id uuid, employee_id uuid, manager_employee_id uuid,
  reporting_line_id uuid, reason text, approved_at timestamptz,
  approved_by uuid, expires_at timestamptz, revoked_at timestamptz,
  currently_effective boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $h6d_list$
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
$h6d_list$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_list_primary_exceptions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_list_primary_exceptions()
  TO authenticated;

-- No existing reporting rows, employee details, approvals, PA, Leave or payroll
-- data are migrated. The ledger starts empty and therefore grants nothing.
DO $h6d_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid='bexhr_private.h6d_approved_primary_exceptions'::regclass
      AND c.relrowsecurity
  ) OR pg_catalog.has_table_privilege('authenticated',
      'bexhr_private.h6d_approved_primary_exceptions','INSERT')
    OR pg_catalog.has_table_privilege('authenticated',
      'bexhr_private.h6d_approved_primary_exceptions','UPDATE')
    OR pg_catalog.has_table_privilege('authenticated',
      'bexhr_private.h6d_approved_primary_exceptions','SELECT')
    OR pg_catalog.has_table_privilege('anon',
      'bexhr_private.h6d_approved_primary_exceptions','SELECT')
    OR pg_catalog.has_function_privilege('authenticated',
      'bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon',
      'public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',
      'public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',
      'public.hr_tenant_admin_revoke_primary_exception(uuid)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon',
      'public.hr_tenant_admin_list_primary_exceptions()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',
      'public.hr_tenant_admin_list_primary_exceptions()','EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: expected private ledger and guarded RPC privileges failed';
  END IF;
  IF EXISTS (SELECT 1 FROM bexhr_private.h6d_approved_primary_exceptions) THEN
    RAISE EXCEPTION 'BEXHR_H6D_STOP: ledger must begin empty';
  END IF;
END;
$h6d_postflight$;


-- H11: one CURRENT Primary authority predicate for PA, Leave and reviewer routes.
-- Saved historical lines remain stored, but alone are NOT a grant to decide.
-- Unconfigured departmental lines may use the existing R14B default authority;
-- configured positions require nearest occupied ancestry or explicit H6D approval.
-- This checks real same-tenant active login linkage, and does not expand HR roles.
CREATE FUNCTION bexhr_private.h11_current_primary_authority(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $h11_authority$
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

  RETURN bexhr_private.p7b_legacy_primary_pair_allowed(
       v_employee.id,v_manager.id)
    OR bexhr_private.h6d_is_approved_current_primary_exception(
       v_employee.id,v_manager.id);
END;
$h11_authority$;
REVOKE ALL ON FUNCTION bexhr_private.h11_current_primary_authority(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- ========================================================================
-- H11-A: ATOMIC, TENANT-ADMIN-APPROVED NEW PRIMARY EXCEPTION ASSIGNMENT
-- REVIEW-ONLY. This component belongs AFTER H6D ledger and H11 authority
-- helper in the full H11 rollback transaction, BEFORE PA / Leave integration.
-- No data edits are performed by this migration component. The privileged
-- RPC, once individually approved for deployment, performs an atomic write.
-- ========================================================================
DO $h11a_preflight$
BEGIN
  IF to_regclass('bexhr_private.h6d_approved_primary_exceptions') IS NULL
     OR to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.p7b_legacy_primary_pair_allowed(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)') IS NULL
     OR to_regprocedure('public.hrp_resolve_leave_employee(uuid)') IS NULL
     OR to_regclass('public.pa_cycles') IS NULL
     OR to_regclass('public.pa_employee_appraisals') IS NULL
     OR to_regclass('public.pa_individual_goals') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_HOLD: previous H11/H6D/PA/Leave prerequisites absent';
  END IF;
  IF to_regclass('bexhr_private.h11_exception_assignment_context') IS NOT NULL
     OR to_regprocedure('public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)') IS NOT NULL
     OR to_regprocedure('bexhr_private.h11_exception_write_context_valid(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_H11A_HOLD: atomic exception workflow already installed';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid='public.employee_reporting_lines'::regclass
        AND tgname IN ('bexhr_enforce_reporting_hierarchy_integrity',
                       'bexhr_enforce_reporting_pair_integrity',
                       'bexhr_enforce_reporting_role_integrity')
        AND NOT tgisinternal AND tgenabled='O')<>3 THEN
    RAISE EXCEPTION 'BEXHR_H11A_HOLD: three reporting integrity triggers required';
  END IF;
END;
$h11a_preflight$;

-- This is not an approval. It is an ephemeral, private, transaction-bound
-- context visible only while the single protected approval-and-assign RPC
-- is executing. Its row is deleted before the RPC returns successfully.
-- It cannot be forged by setting a browser-side PostgreSQL session variable.
CREATE TABLE bexhr_private.h11_exception_assignment_context (
  transaction_id xid8 PRIMARY KEY,
  actor_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  manager_employee_id uuid NOT NULL,
  proposed_line_id uuid NOT NULL,
  approval_id uuid NOT NULL
);
ALTER TABLE bexhr_private.h11_exception_assignment_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bexhr_private.h11_exception_assignment_context
  FROM PUBLIC, anon, authenticated;

-- Unlike ordinary STABLE reporting predicates, this temporary write check
-- MUST be VOLATILE: the ledger and transaction token are inserted earlier
-- in the same authenticated RPC call. A STABLE snapshot would miss them.
CREATE FUNCTION bexhr_private.h11_exception_write_context_valid(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $h11a_write_check$
DECLARE
  v_xid xid8;
BEGIN
  IF p_employee_id IS NULL OR p_manager_employee_id IS NULL
     OR p_employee_id=p_manager_employee_id OR auth.uid() IS NULL
     OR coalesce(auth.jwt()->>'aal','')<>'aal2' THEN RETURN FALSE; END IF;
  v_xid := pg_catalog.pg_current_xact_id_if_assigned();
  IF v_xid IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM bexhr_private.h11_exception_assignment_context context
    JOIN bexhr_private.h6d_approved_primary_exceptions approval
      ON approval.id=context.approval_id
     AND approval.tenant_id=context.tenant_id
     AND approval.employee_id=context.employee_id
     AND approval.manager_employee_id=context.manager_employee_id
     AND approval.reporting_line_id=context.proposed_line_id
     AND approval.approved_by=context.actor_id
     AND approval.revoked_at IS NULL
     AND (approval.expires_at IS NULL OR approval.expires_at>pg_catalog.now())
    JOIN public.employees employee
      ON employee.id=context.employee_id AND employee.tenant_id=context.tenant_id
     AND lower(pg_catalog.btrim(coalesce(employee.status,'active')))='active'
    JOIN public.employees manager
      ON manager.id=context.manager_employee_id AND manager.tenant_id=context.tenant_id
     AND lower(pg_catalog.btrim(coalesce(manager.status,'active')))='active'
     AND lower(pg_catalog.btrim(coalesce(manager.system_role,''))) IN ('manager','hr','hr_manager')
    JOIN public.profiles manager_profile
      ON manager_profile.id=manager.user_id
     AND manager_profile.tenant_id=context.tenant_id
     AND manager_profile.is_active IS TRUE
     AND lower(pg_catalog.btrim(coalesce(manager_profile.role,''))) IN ('manager','hr','hr_manager')
    WHERE context.transaction_id=v_xid
      AND context.actor_id=auth.uid()
      AND context.employee_id=p_employee_id
      AND context.manager_employee_id=p_manager_employee_id
      AND approval.employee_position_id=
        bexhr_private.p7b_resolve_employee_position_id(employee.id)
      AND approval.manager_position_id=
        bexhr_private.p7b_resolve_employee_position_id(manager.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_job_title_hierarchy h
         WHERE h.tenant_id=context.tenant_id
           AND h.job_title_id=approval.employee_position_id
           AND h.reports_to_job_title_id IS NULL
      )
      AND (
        (approval.child_position_link_was_configured AND EXISTS (
          SELECT 1 FROM public.organization_job_title_hierarchy link
           WHERE link.tenant_id=context.tenant_id
             AND link.job_title_id=approval.employee_position_id
             AND link.reports_to_job_title_id IS NOT DISTINCT FROM
                 approval.child_parent_position_at_approval
        ))
        OR (NOT approval.child_position_link_was_configured AND NOT EXISTS (
          SELECT 1 FROM public.organization_job_title_hierarchy link
           WHERE link.tenant_id=context.tenant_id
             AND link.job_title_id=approval.employee_position_id
        ))
      )
  );
END;
$h11a_write_check$;
REVOKE ALL ON FUNCTION bexhr_private.h11_exception_write_context_valid(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Rebind the existing validators, preserving the old same-line grandfathering
-- and department-unconfigured default. ONLY a validated one-transaction
-- context permits an explicitly approved, newly assigned out-of-chain pair.
-- VOLATILE is required to observe writes earlier in the same RPC statement.
-- H11A_PRIMARY_VALIDATOR_ATOMIC_CONTEXT_V1
CREATE OR REPLACE FUNCTION bexhr_private.is_primary_reporting_relationship_valid(
  p_employee_id uuid, p_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_employee public.employees%rowtype;
  v_manager public.employees%rowtype;
  v_child_position uuid;
  v_scope_department uuid;
  v_tenant uuid;
  v_active_primary_count bigint;
BEGIN
  IF p_employee_id IS NULL OR p_manager_employee_id IS NULL
     OR p_employee_id=p_manager_employee_id THEN RETURN FALSE; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
  SELECT * INTO v_manager FROM public.employees WHERE id=p_manager_employee_id;
  IF v_employee.id IS NULL OR v_manager.id IS NULL
     OR v_employee.tenant_id IS NULL
     OR v_employee.tenant_id IS DISTINCT FROM v_manager.tenant_id
     OR lower(btrim(coalesce(v_employee.status,'active')))<>'active'
     OR lower(btrim(coalesce(v_manager.status,'active')))<>'active' THEN
    RETURN FALSE;
  END IF;
  v_tenant := v_employee.tenant_id;

  SELECT count(*) INTO v_active_primary_count
    FROM public.employee_reporting_lines rl
   WHERE rl.employee_id=p_employee_id
     AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
     AND lower(btrim(coalesce(rl.status::text,'active')))='active'
     AND (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL);

  IF v_active_primary_count=1 AND EXISTS (
    SELECT 1 FROM public.employee_reporting_lines rl
     WHERE rl.employee_id=p_employee_id
       AND rl.manager_employee_id=p_manager_employee_id
       AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
       AND lower(btrim(coalesce(rl.status::text,'active')))='active'
       AND (rl.tenant_id=v_tenant OR rl.tenant_id IS NULL)
  ) THEN
    RETURN TRUE;
  END IF;

  -- Any new Primary assignment must be validated against its configured parent.
  v_child_position := bexhr_private.p7b_resolve_employee_position_id(p_employee_id);
  IF v_child_position IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_job_title_hierarchy h
       WHERE h.tenant_id=v_tenant AND h.job_title_id=v_child_position
    ) THEN
      RETURN bexhr_private.p7b_configured_primary_match(
        p_employee_id,p_manager_employee_id
      ) OR bexhr_private.h11_exception_write_context_valid(
        p_employee_id,p_manager_employee_id
      );
    END IF;
    SELECT jt.department_id INTO v_scope_department
      FROM public.organization_job_titles jt WHERE jt.id=v_child_position;
    -- Whole-company titles never silently acquire a role-tier fallback.
    IF v_scope_department IS NULL THEN RETURN FALSE; END IF;
  END IF;

  -- H11 DEFAULT-COMPATIBILITY: installing the position editor must never
  -- invalidate the company's still-unconfigured departmental default.
  -- NEW unconfigured lines must pass the prior R14B role rule. Configured
  -- lines above use strict ancestry; company-wide positions never fall back.
  RETURN bexhr_private.p7b_legacy_primary_pair_allowed(
    p_employee_id,p_manager_employee_id
  ) OR bexhr_private.h11_exception_write_context_valid(
    p_employee_id,p_manager_employee_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION bexhr_private.is_primary_reporting_relationship_valid(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Existing pair trigger delegates to the same VOLATILE validator. The
-- three pre-existing triggers remain enabled and are not replaced.
CREATE OR REPLACE FUNCTION bexhr_private.is_valid_primary_reporting_pair(
  p_employee_id uuid, p_manager_employee_id uuid
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $h11a_pair$
  SELECT bexhr_private.is_primary_reporting_relationship_valid(
    p_employee_id,p_manager_employee_id
  );
$h11a_pair$;
REVOKE ALL ON FUNCTION bexhr_private.is_valid_primary_reporting_pair(uuid,uuid)
  FROM PUBLIC, anon, authenticated;


-- One privileged operation: approve AND create a NEW active Primary line.
-- It never mutates PA/Leave or overwrites the old reporting-line identity.
-- Existing line, if any, is marked Inactive. The old row remains as history.
-- On any error all changes (including the private approval) roll back.
CREATE FUNCTION public.hr_tenant_admin_assign_primary_exception(
  p_employee_id uuid,
  p_manager_employee_id uuid,
  p_reason text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $h11a_assign$
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
$h11a_assign$;
REVOKE ALL ON FUNCTION public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)
  TO authenticated;
COMMENT ON FUNCTION public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)
  IS 'HR Tenant Admin AAL2 only: atomic reasoned exception approval plus append-only Primary assignment; blocks active PA and pending Leave; guarded by three existing reporting triggers.';

DO $h11a_postflight$
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid='bexhr_private.h11_exception_assignment_context'::regclass)
     OR has_table_privilege('authenticated',
        'bexhr_private.h11_exception_assignment_context','SELECT')
     OR has_table_privilege('authenticated',
        'bexhr_private.h11_exception_assignment_context','INSERT')
     OR has_table_privilege('anon',
        'bexhr_private.h11_exception_assignment_context','SELECT')
     OR has_function_privilege('authenticated',
        'bexhr_private.h11_exception_write_context_valid(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon',
        'public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
        'public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)','EXECUTE')
     OR EXISTS (SELECT 1 FROM bexhr_private.h11_exception_assignment_context)
     OR (SELECT count(*) FROM pg_trigger
          WHERE tgrelid='public.employee_reporting_lines'::regclass
            AND tgname IN ('bexhr_enforce_reporting_hierarchy_integrity',
                           'bexhr_enforce_reporting_pair_integrity',
                           'bexhr_enforce_reporting_role_integrity')
            AND NOT tgisinternal AND tgenabled='O')<>3 THEN
    RAISE EXCEPTION 'BEXHR_H11A_POSTFLIGHT: privilege, token or trigger guard failed';
  END IF;
END;
$h11a_postflight$;

-- ========================================================================
-- STAGED COMPONENT 30-PA-REVIEWER | source SHA-256 0fafdaeddcca3b499e8573b896dcf1571abb45577c432c10ff9b3d25f2644aa4
-- This is a review-only copy WITHOUT its original BEGIN/COMMIT wrapper.
-- ========================================================================
-- BEXHR PHASE 7B: position-aware reviewer resolution for FUTURE PA appraisals.
-- FORWARD SQL: NOT APPROVED FOR PRODUCTION. Requires coordinated release.
-- Review only. Do not execute before reporting-validator forward is installed.
-- No existing PA or employee rows are rewritten by this DDL.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $p7b_pa_preflight$
DECLARE v_oid oid;
BEGIN
  IF to_regclass('public.pa_employee_appraisals') IS NULL
     OR to_regclass('public.pa_cycles') IS NULL
     OR to_regclass('public.employee_reporting_lines') IS NULL
     OR to_regclass('public.organization_job_title_hierarchy') IS NULL
     OR to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)') IS NULL
     OR to_regprocedure('bexhr_private.enforce_pa_manager_review_route()') IS NULL
     OR to_regprocedure('bexhr_private.p7b_resolve_employee_position_id(uuid)') IS NULL
     OR to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_ROUTE_STOP: required PA snapshot or P7B reporting-validator function is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid='public.pa_employee_appraisals'::regclass
       AND tgname='bexhr_enforce_pa_manager_review_route'
       AND NOT tgisinternal AND tgenabled<>'D'
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_ROUTE_STOP: reviewer snapshot trigger is missing or disabled';
  END IF;
  v_oid := to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)');
  IF position('BEXHR_P7B_PA_ROUTE_V1' IN pg_get_functiondef(v_oid))>0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_ROUTE_STOP: this reviewer resolver is already installed';
  END IF;
END;
$p7b_pa_preflight$;

-- BEXHR_P7B_PA_ROUTE_V1
-- Resolve NEW appraisal review routes only. The existing PA INSERT trigger
-- snapshots manager_employee_id and route; its UPDATE branch stays untouched.
-- The current active cycle's saved reviewer and route never change.
CREATE OR REPLACE FUNCTION bexhr_private.resolve_pa_manager_review_route(
  p_employee_id uuid, p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
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

REVOKE ALL ON FUNCTION bexhr_private.resolve_pa_manager_review_route(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

DO $p7b_pa_postcheck$
DECLARE v_oid oid;
BEGIN
  v_oid := to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)');
  IF v_oid IS NULL
     OR position('BEXHR_P7B_PA_ROUTE_V1' IN pg_get_functiondef(v_oid))=0
     OR has_function_privilege('anon',v_oid,'EXECUTE')
     OR has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_ROUTE_STOP: reviewer function postcheck or private EXECUTE safeguard failed';
  END IF;
  -- Run through future resolver without writing to active PA reviewer snapshots.
  IF EXISTS (
    SELECT 1 FROM public.employees e
    CROSS JOIN LATERAL (
      SELECT bexhr_private.resolve_pa_manager_review_route(e.id,e.tenant_id) AS route_payload
    ) r
    WHERE e.tenant_id IS NOT NULL
      AND lower(btrim(coalesce(e.status,'active')))='active'
      AND coalesce(r.route_payload->>'route','') NOT IN (
        'PRIMARY_MANAGER','TOP_LEVEL','CONFIGURATION_ERROR'
      )
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_ROUTE_STOP: invalid reviewer-route value for an active employee';
  END IF;
END;
$p7b_pa_postcheck$;


-- ========================================================================
-- STAGED COMPONENT 40-PA-HIGHEST-V2 | source SHA-256 49e58764253a0530643b1dde15611b8d9be83355b56943af8d14fdb1c47dba5c
-- This is a review-only copy WITHOUT its original BEGIN/COMMIT wrapper.
-- ========================================================================
-- BEXHR P7B PA HIGHEST-TIER REHEARSAL CORRECTION V2
-- Fix: use stable executable pa_activate_cycle anchor instead of a comment.
-- Failed V1 transaction made no persistent database changes.
-- PHASE 7B PA HIGHEST ACTIVE TIER - FORWARD NOT APPROVED
-- THIS IS A REVIEW ARTIFACT, NOT A PRODUCTION MIGRATION.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- BEXHR P7B PA Highest-Occupied-Tier: HQ department and executive-role neutrality.
-- NOT APPROVED FOR PRODUCTION - coordinated release only.
-- The existing pa_activate_cycle(text) definition is inspected and modified only
-- if the known three department-null predicates and unique anchor are present.
-- No employee, reporting line, PA appraisal, reviewer snapshot or cycle is updated.
DO $p7b_pa_tier_preflight$
DECLARE v_activation oid; v_reviewer oid; v_src text; v_count integer;
BEGIN
  v_activation := to_regprocedure('public.pa_activate_cycle(text)');
  v_reviewer := to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)');
  IF v_activation IS NULL OR v_reviewer IS NULL
     OR to_regclass('public.organization_job_titles') IS NULL
     OR to_regclass('public.organization_departments') IS NULL
     OR to_regclass('public.organization_job_title_hierarchy') IS NULL
     OR to_regclass('public.pa_employee_appraisals') IS NULL
     OR to_regclass('public.pa_cycles') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: missing original PA or position structure';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_activation AND p.prosecdef IS FALSE
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: activation must remain SECURITY INVOKER';
  END IF;
  v_src := pg_get_functiondef(v_activation);
  IF position('BEXHR_P7B_PA_HQ_OCCUPANCY_V1' in v_src)>0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: HQ occupancy correction already installed';
  END IF;
  IF position('EXCLUDE_HIGHEST_ACTIVE_TIER' in v_src)=0
     OR position('BEXHR_PA_UNCONFIGURED_WHOLE_ORG_POSITION' in v_src)=0
     OR position('highestPositionIds' in v_src)=0
     OR position('HR_ADMIN_FALLBACK' in v_src)=0
     OR position('pa_employee_appraisals' in v_src)=0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: unexpected PA activation version; do not patch';
  END IF;
  IF position('BEXHR_P7B_PA_ROUTE_V1' in pg_get_functiondef(v_reviewer))=0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: Phase 7B reviewer routing not yet installed in this transaction';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.pa_employee_appraisals'::regclass
      AND t.tgname='bexhr_enforce_pa_manager_review_route'
      AND t.tgenabled<>'D' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: reviewer snapshot trigger missing or disabled';
  END IF;
END;
$p7b_pa_tier_preflight$;

DO $p7b_pa_tier_patch$
DECLARE
  v_source text;
  v_patched text;
  v_find text := $old$nullif(trim(coalesce(employee.department, '')), '') is null$old$;
  v_replace text := $new$NOT EXISTS (
        -- BEXHR_P7B_PA_HQ_OCCUPANCY_V1: active employee's department
        -- does not disqualify an explicitly company-wide job-title position.
        -- A matching active departmental title makes that position ambiguous.
        SELECT 1
        FROM public.organization_departments assigned_department
        JOIN public.organization_job_titles departmental_title
          ON departmental_title.department_id = assigned_department.id
         AND lower(btrim(coalesce(departmental_title.status,'active')))='active'
         AND (departmental_title.tenant_id=employee.tenant_id
              OR departmental_title.tenant_id IS NULL)
         AND lower(btrim(regexp_replace(coalesce(departmental_title.job_title,''),'[[:space:]]+',' ','g')))
             = lower(btrim(regexp_replace(coalesce(employee.job_title,''),'[[:space:]]+',' ','g')))
        WHERE assigned_department.tenant_id=employee.tenant_id
          AND lower(btrim(coalesce(assigned_department.status,'active')))='active'
          AND lower(btrim(coalesce(assigned_department.department_name,'')))
              = lower(btrim(coalesce(employee.department,'')))
      )$new$;
  -- Anchor on an executable expression, not a comment: live versions can
  -- remove/reword the STRUCTURE COMPLETENESS GUARD comment.
  v_anchor text := $anchor$v_template_snapshot := jsonb_build_object($anchor$;
  v_guard text := $guard$  -- BEXHR_P7B_PA_SCOPE_AMBIGUITY_GUARD: never guess a position scope.
  IF EXISTS (
    SELECT 1
    FROM public.employees employee
    JOIN public.organization_job_titles company_title
      ON company_title.department_id IS NULL
     AND lower(btrim(coalesce(company_title.status,'active')))='active'
     AND (company_title.tenant_id=v_tenant_id OR company_title.tenant_id IS NULL)
     AND lower(btrim(regexp_replace(coalesce(company_title.job_title,''),'[[:space:]]+',' ','g')))
         = lower(btrim(regexp_replace(coalesce(employee.job_title,''),'[[:space:]]+',' ','g')))
    JOIN public.organization_departments assigned_department
      ON assigned_department.tenant_id=v_tenant_id
     AND lower(btrim(coalesce(assigned_department.status,'active')))='active'
     AND lower(btrim(coalesce(assigned_department.department_name,'')))
         = lower(btrim(coalesce(employee.department,'')))
    JOIN public.organization_job_titles departmental_title
      ON departmental_title.department_id=assigned_department.id
     AND lower(btrim(coalesce(departmental_title.status,'active')))='active'
     AND (departmental_title.tenant_id=v_tenant_id OR departmental_title.tenant_id IS NULL)
     AND lower(btrim(regexp_replace(coalesce(departmental_title.job_title,''),'[[:space:]]+',' ','g')))
         = lower(btrim(regexp_replace(coalesce(employee.job_title,''),'[[:space:]]+',' ','g')))
    WHERE employee.tenant_id=v_tenant_id
      AND lower(btrim(coalesce(employee.status,'active')))='active'
  ) THEN
    RAISE EXCEPTION USING errcode='23514',
      message='BEXHR_P7B_PA_SCOPE_AMBIGUOUS: An employee job title matches both an active company-wide and a departmental position. Resolve the position identity before activating the PA cycle.';
  END IF;

$guard$;
BEGIN
  v_source := pg_get_functiondef('public.pa_activate_cycle(text)'::regprocedure);
  IF (length(v_source)-length(replace(v_source,v_find,'')))/length(v_find) <> 3 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: expected exactly 3 original whole-organization department predicates';
  END IF;
  IF (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: expected exactly one PA template snapshot assignment; activation version differs';
  END IF;
  v_patched := replace(v_source,v_find,v_replace);
  v_patched := replace(v_patched,v_anchor,v_guard||v_anchor);
  IF (length(v_patched)-length(replace(v_patched,'BEXHR_P7B_PA_HQ_OCCUPANCY_V1','')))
        / length('BEXHR_P7B_PA_HQ_OCCUPANCY_V1') <> 3
     OR position('BEXHR_P7B_PA_SCOPE_AMBIGUITY_GUARD' in v_patched)=0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: source transformation failed its integrity check';
  END IF;
  EXECUTE v_patched;
END;
$p7b_pa_tier_patch$;

DO $p7b_pa_tier_postcheck$
DECLARE v_oid oid; v_source text;
BEGIN
  v_oid := to_regprocedure('public.pa_activate_cycle(text)');
  v_source := pg_get_functiondef(v_oid);
  IF position('BEXHR_P7B_PA_HQ_OCCUPANCY_V1' in v_source)=0
     OR position('BEXHR_P7B_PA_SCOPE_AMBIGUITY_GUARD' in v_source)=0
     OR (length(v_source)-length(replace(v_source,
           $old$nullif(trim(coalesce(employee.department, '')), '') is null$old$,''))) > 0
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid AND p.prosecdef IS FALSE)
     OR has_function_privilege('anon',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_PA_TIER_STOP: patched PA activation or privileges failed postcheck';
  END IF;
  -- Existing active cycle, reviewer IDs and payloads are NEVER modified.
  -- The active-cycle snapshot trigger and other PA guards stay untouched.
END;
$p7b_pa_tier_postcheck$;


-- ========================================================================
-- STAGED COMPONENT 50-LEAVE-EXEC | source SHA-256 7e93c5f7c5f859a4a738c9dabc3ed49d9fe1b0a996fc547e8271abefe9e32a1a
-- This is a review-only copy WITHOUT its original BEGIN/COMMIT wrapper.
-- ========================================================================
-- BEXHR PHASE 7B - FORWARD DRAFT - DO NOT RUN IN PRODUCTION
-- NOT APPROVED. Coordinated release must include hierarchy, validator, PA and app JS.
-- Transactional DDL rehearsal; no employee assignments, leave decisions,
-- delegation records, PA snapshots, roles, payroll, or tenants are changed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $p7b_leave_preflight$
DECLARE
  v_definition text;
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.employee_reporting_lines') IS NULL
     OR to_regclass('public.organization_job_titles') IS NULL
     OR to_regclass('public.organization_departments') IS NULL
     OR to_regclass('public.organization_job_title_hierarchy') IS NULL
     OR to_regclass('public.manager_leave_delegations') IS NULL
     OR to_regclass('public.manager_leave_decision_authority_audit') IS NULL
     OR to_regclass('public.leave_requests') IS NULL
     OR to_regprocedure('public.hrp_find_active_leave_delegation(uuid)') IS NULL
     OR to_regprocedure('public.hrp_current_manager_employee()') IS NULL
     OR to_regprocedure('public.hrp_resolve_leave_employee(uuid)') IS NULL
     OR to_regprocedure('public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)') IS NULL
     OR to_regprocedure('public.hrp_apply_leave_decision_once(uuid,text,text)') IS NULL
     OR to_regprocedure('public.current_authenticated_profile_tenant_id()') IS NULL
     OR to_regprocedure('public.get_manager_leave_readiness()') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: prerequisites not installed';
  END IF;
  IF to_regprocedure('public.bexhr_p7b_workspace_access()') IS NOT NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: workspace access RPC is already installed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid='public.manager_leave_delegations'::regclass AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: delegation RLS must be enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.manager_leave_delegations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.manager_leave_delegations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.manager_leave_delegations', 'DELETE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: unexpected direct browser delegation write grant';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(
    to_regprocedure('public.hrp_apply_leave_decision_once(uuid,text,text)')
  )) INTO v_definition;
  IF position('hrp_is_current_user_authorized_manager_for_leave_employee' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: decision RPC has lost delegated-authority guard';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(
    to_regprocedure('public.hrp_find_active_leave_delegation(uuid)')
  )) INTO v_definition;
  IF position('manager_leave_delegations' IN v_definition) = 0
     OR position('employee_reporting_lines' IN v_definition) = 0
     OR position('hrp_resolve_leave_employee' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_STOP: unexpected existing delegation resolver version';
  END IF;
END;
$p7b_leave_preflight$;

-- Do not change the atomic leave-decision RPC or delegate creation permissions.
-- A delegation remains valid only if BOTH managers and the target are active,
-- tenant-owned employees, with active matching Primary/Secondary assignments.
-- Revoked, future-start, expired, transferred or orphaned grants fail closed.
CREATE OR REPLACE FUNCTION public.hrp_find_active_leave_delegation(
  p_leave_employee_id uuid
)
RETURNS TABLE (
  delegation_id uuid,
  primary_manager_employee_id uuid,
  delegated_manager_employee_id uuid,
  ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $bexhr_p7b_delegation$
  WITH actor AS (
    SELECT employee.manager_employee_id, employee.tenant_id
    FROM public.hrp_current_manager_employee() employee
    JOIN public.employees actual
      ON actual.id = employee.manager_employee_id
     AND actual.tenant_id = employee.tenant_id
     AND lower(btrim(coalesce(actual.status, 'active'))) = 'active'
  ),
  target AS (
    SELECT resolved.employee_id, resolved.tenant_id
    FROM public.hrp_resolve_leave_employee(p_leave_employee_id) resolved
    JOIN public.employees employee
      ON employee.id = resolved.employee_id
     AND employee.tenant_id = resolved.tenant_id
     AND lower(btrim(coalesce(employee.status, 'active'))) = 'active'
  )
  SELECT
    delegation.id,
    delegation.primary_manager_employee_id,
    delegation.delegated_manager_employee_id,
    delegation.ends_at
  FROM actor
  JOIN target ON target.tenant_id = actor.tenant_id
  JOIN public.manager_leave_delegations delegation
    ON delegation.tenant_id = actor.tenant_id
   AND delegation.delegated_manager_employee_id = actor.manager_employee_id
   AND delegation.status = 'active'
   AND now() >= delegation.starts_at
   AND now() < delegation.ends_at
   AND (
     delegation.scope_type = 'team'
     OR delegation.covered_employee_id = target.employee_id
   )
  JOIN public.employees primary_employee
    ON primary_employee.id = delegation.primary_manager_employee_id
   AND primary_employee.tenant_id = actor.tenant_id
   AND lower(btrim(coalesce(primary_employee.status, 'active'))) = 'active'
  JOIN public.employee_reporting_lines primary_line
    ON primary_line.employee_id = target.employee_id
   AND primary_line.manager_employee_id = delegation.primary_manager_employee_id
   AND lower(btrim(coalesce(primary_line.status, 'active'))) = 'active'
   AND lower(btrim(coalesce(primary_line.manager_type::text, ''))) = 'primary'
   AND (primary_line.tenant_id IS NULL OR primary_line.tenant_id = actor.tenant_id)
  JOIN public.employee_reporting_lines secondary_line
    ON secondary_line.employee_id = target.employee_id
   AND secondary_line.manager_employee_id = actor.manager_employee_id
   AND lower(btrim(coalesce(secondary_line.status, 'active'))) = 'active'
   AND lower(btrim(coalesce(secondary_line.manager_type::text, ''))) = 'secondary'
   AND (secondary_line.tenant_id IS NULL OR secondary_line.tenant_id = actor.tenant_id)
  ORDER BY delegation.ends_at ASC, delegation.created_at ASC
  LIMIT 1;
$bexhr_p7b_delegation$;

-- Retain the existing RPC invocation contract; no extra role is granted.
REVOKE ALL ON FUNCTION public.hrp_find_active_leave_delegation(uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrp_find_active_leave_delegation(uuid)
  TO authenticated;

-- HR profiles can enter the Manager workspace only for existing Primary/Secondary
-- assignments OR a UNIQUE configured whole-organisation position. This is a
-- read-only entitlement. It never grants a reporting line, HR role, leave decision,
-- delegation, or PA reviewer authority. For HR, AAL2 remains mandatory.
CREATE FUNCTION public.bexhr_p7b_workspace_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $bexhr_p7b_workspace$
DECLARE
  v_profile public.profiles%rowtype;
  v_employee public.employees%rowtype;
  v_role text;
  v_match_count integer := 0;
  v_employee_id uuid;
  v_has_team boolean := false;
  v_has_position boolean := false;
  v_title_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', '');
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = auth.uid()
    AND profile.tenant_id IS NOT NULL
    AND coalesce(profile.is_active, false);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', '');
  END IF;

  v_role := lower(btrim(coalesce(v_profile.role, '')));
  IF v_role = 'manager' THEN
    RETURN jsonb_build_object('can_enter_manager', true, 'preferred_workspace', 'manager');
  END IF;
  IF v_role <> 'hr' THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', '');
  END IF;
  -- H11: HR Admin / inactive or nonstandard HR must never inherit the
  -- executive Manager/HR switch from a position title or assigned reports.
  IF lower(pg_catalog.btrim(coalesce(v_profile.hr_access_level,''))) <> 'standard' THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', 'hr');
  END IF;
  IF coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', 'hr');
  END IF;

  -- Prefer an explicit auth-user link. Legacy email fallback is permitted only
  -- when it identifies exactly one active employee in the SAME tenant.
  SELECT count(*)::integer, (array_agg(employee.id))[1]
  INTO v_match_count, v_employee_id
  FROM public.employees employee
  WHERE employee.user_id = v_profile.id
    AND employee.tenant_id = v_profile.tenant_id
    AND lower(btrim(coalesce(employee.status, 'active'))) = 'active';

  IF v_match_count = 0 AND nullif(btrim(coalesce(v_profile.email, '')), '') IS NOT NULL THEN
    SELECT count(*)::integer, (array_agg(employee.id))[1]
    INTO v_match_count, v_employee_id
    FROM public.employees employee
    WHERE employee.tenant_id = v_profile.tenant_id
      AND lower(btrim(coalesce(employee.work_email, ''))) = lower(btrim(v_profile.email))
      AND lower(btrim(coalesce(employee.status, 'active'))) = 'active';
  END IF;

  IF v_match_count <> 1 OR v_employee_id IS NULL THEN
    RETURN jsonb_build_object('can_enter_manager', false, 'preferred_workspace', 'hr');
  END IF;

  SELECT employee.* INTO v_employee
  FROM public.employees employee
  WHERE employee.id = v_employee_id
    AND employee.tenant_id = v_profile.tenant_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.employee_reporting_lines line
    JOIN public.employees target
      ON target.id = line.employee_id
     AND target.tenant_id = v_profile.tenant_id
     AND lower(btrim(coalesce(target.status, 'active'))) = 'active'
    WHERE line.manager_employee_id = v_employee.id
      AND line.employee_id <> v_employee.id
      AND (line.tenant_id IS NULL OR line.tenant_id = v_profile.tenant_id)
      AND lower(btrim(coalesce(line.status, 'active'))) = 'active'
      AND lower(btrim(coalesce(line.manager_type::text, ''))) IN ('primary','secondary')
  ) INTO v_has_team;

  -- Company-wide position identity is derived from a tenant configuration
  -- row, never from the literal title CEO/COO or an empty HQ department.
  SELECT count(DISTINCT hierarchy.job_title_id)::integer
  INTO v_title_count
  FROM public.organization_job_title_hierarchy hierarchy
  JOIN public.organization_job_titles position
    ON position.id = hierarchy.job_title_id
  WHERE hierarchy.tenant_id = v_profile.tenant_id
    AND position.department_id IS NULL
    AND (position.tenant_id = v_profile.tenant_id OR position.tenant_id IS NULL)
    AND lower(btrim(coalesce(position.status, 'active'))) = 'active'
    AND nullif(btrim(coalesce(v_employee.job_title, '')), '') IS NOT NULL
    AND lower(btrim(position.job_title)) = lower(btrim(v_employee.job_title));

  v_has_position := v_title_count = 1;

  -- A same-title position in the employee's actual department is ambiguous;
  -- department-specific identity wins, so no executive access is inferred.
  IF v_has_position AND EXISTS (
    SELECT 1
    FROM public.organization_job_titles dept_title
    JOIN public.organization_departments department
      ON department.id = dept_title.department_id
    WHERE (dept_title.tenant_id = v_profile.tenant_id OR dept_title.tenant_id IS NULL)
      AND department.tenant_id = v_profile.tenant_id
      AND lower(btrim(coalesce(dept_title.status, 'active'))) = 'active'
      AND lower(btrim(dept_title.job_title)) = lower(btrim(v_employee.job_title))
      AND lower(btrim(department.department_name)) = lower(btrim(coalesce(v_employee.department, '')))
  ) THEN
    v_has_position := false;
  END IF;

  RETURN jsonb_build_object(
    'can_enter_manager', (v_has_team OR v_has_position),
    'preferred_workspace', CASE WHEN v_has_position THEN 'manager' ELSE 'hr' END
  );
END;
$bexhr_p7b_workspace$;

-- Explicit revoke is essential for a SECURITY DEFINER public RPC.
REVOKE ALL ON FUNCTION public.bexhr_p7b_workspace_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bexhr_p7b_workspace_access() TO authenticated;

DO $p7b_leave_postcheck$
DECLARE
  v_access_oid oid;
  v_delegation_oid oid;
  v_definition text;
BEGIN
  v_access_oid := to_regprocedure('public.bexhr_p7b_workspace_access()');
  v_delegation_oid := to_regprocedure('public.hrp_find_active_leave_delegation(uuid)');
  IF v_access_oid IS NULL OR v_delegation_oid IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_VERIFY: staged functions are missing';
  END IF;
  IF has_function_privilege('anon', v_access_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_access_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_delegation_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_VERIFY: unexpected browser execution grants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_access_oid AND prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_delegation_oid AND prosecdef
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_VERIFY: security definer contract changed';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(v_delegation_oid)) INTO v_definition;
  IF position('primary_employee' IN v_definition)=0
     OR position('secondary_line' IN v_definition)=0
     OR position('now() < delegation.ends_at' IN v_definition)=0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_VERIFY: delegation active/expiry guard missing';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(v_access_oid)) INTO v_definition;
  IF position('aal2' IN v_definition)=0
     OR position('organization_job_title_hierarchy' IN v_definition)=0
     OR position('can_enter_manager' IN v_definition)=0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_LEAVE_VERIFY: position-based workspace entitlement missing';
  END IF;
  -- No INSERT/UPDATE/DELETE is executed on employee lines, leave, delegation
  -- audit, PA or any existing application record. All DDL above is temporary.
END;
$p7b_leave_postcheck$;

-- ========================================================================
-- FINAL GATE: CHECK ALL COMPONENTS ARE CO-RESIDENT IN THIS TRANSACTION.

-- H11 INTEGRATED H3 PA INDIVIDUAL GOAL AUTHORITY; review source in supabase/phase7b-review.
-- BEXHR H3 PA TEAM AUTHORITY: REVIEW DRAFT ONLY - DO NOT RUN ON PRODUCTION.
-- Coordinates AFTER Phase 7B departmental/reporting-validator, PA reviewer route,
-- and existing PA persona integrity. Changes authorization functions only.
-- Does NOT edit PA cycles, reviewer snapshots, reporting lines, employees, or policies.
-- Historical active-cycle reviewer snapshots keep their own separate authority.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $h3_preflight$
DECLARE
  v_existing oid;
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.employees') IS NULL
    OR to_regclass('public.employee_reporting_lines') IS NULL
    OR to_regclass('public.pa_individual_goals') IS NULL
    OR to_regclass('public.pa_cycles') IS NULL
    OR to_regprocedure('public.pa_current_employee_id()') IS NULL
    OR to_regprocedure('public.current_authenticated_profile_tenant_id()') IS NULL
    OR to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)') IS NULL
    OR to_regprocedure('public.pa_current_user_is_primary_manager_of(uuid)') IS NULL
    OR to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL
    OR to_regprocedure('bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)') IS NULL
    OR to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NULL
    OR to_regprocedure('bexhr_private.p7b_resolve_employee_position_id(uuid)') IS NULL
    OR to_regprocedure('bex_pa_private.current_user_owns_active_pa_review(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: missing H2 position validator or existing PA persona/snapshot dependency';
  END IF;

  v_existing := to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)');
  IF position('BEXHR_H3_PA_TEAM_SCOPE_V1' IN pg_get_functiondef(v_existing)) > 0 THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: PA team authority already installed, do not repeat';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pa_individual_goals'
      AND policyname='PA primary managers create individual goals'
      AND cmd='INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pa_individual_goals'
      AND policyname='PA primary managers update individual goals'
      AND cmd='UPDATE'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: expected PA goal RLS policies are missing';
  END IF;

  -- Existing active-cycle goals must not unexpectedly lose editable authority.
  -- A same-pair grandfathered Primary may remain stored, but it cannot become
  -- valid current approval authority without a configured position chain.
  IF EXISTS (
    SELECT 1
    FROM public.pa_individual_goals g
    JOIN public.pa_cycles c ON c.id=g.cycle_id AND c.tenant_id=g.tenant_id
    JOIN public.employee_reporting_lines rl ON rl.employee_id=g.employee_id
      AND (rl.tenant_id=g.tenant_id OR rl.tenant_id IS NULL)
    WHERE lower(btrim(coalesce(c.status,'')))='active'
      AND lower(btrim(coalesce(rl.status::text,'active')))='active'
      AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
      AND NOT (
        bexhr_private.h11_current_primary_authority(
          g.employee_id,rl.manager_employee_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: active PA goal has a Primary whose CURRENT position chain is not configured; review impact before release';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pa_individual_goals g
    JOIN public.pa_cycles c ON c.id=g.cycle_id AND c.tenant_id=g.tenant_id
    JOIN public.employee_reporting_lines rl ON rl.employee_id=g.employee_id
    JOIN public.employees manager ON manager.id=rl.manager_employee_id
      AND manager.tenant_id=g.tenant_id
    WHERE lower(btrim(coalesce(c.status,'')))='active'
      AND lower(btrim(coalesce(rl.status::text,'active')))='active'
      AND lower(btrim(coalesce(rl.manager_type::text,'')))='primary'
      AND manager.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: active PA goal has an unlinked Primary manager login; link account before release';
  END IF;
END;
$h3_preflight$;

-- The PA helper is invoked by existing Primary-goal RLS and the goal validator,
-- and (for secondary read visibility) by existing read-only RLS. It is NOT a
-- general HR-admin grant. The caller needs an active same-tenant profile,
-- an active manager-capable employee record AND a live reporting assignment.
-- H2 historical same-pair preservation alone NEVER grants PA writes.
-- H6D exceptions grant current authority only through explicit HR-Admin approval,
-- matched active line ID, unchanged positions, tenant, manager role/account and expiry.
CREATE OR REPLACE FUNCTION bex_pa_private.is_manager_of(
  p_employee uuid, p_primary_only boolean DEFAULT FALSE
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3_manager$
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
$h3_manager$;

-- The older public PA policy helper otherwise keeps accepting grandfathered
-- Primary rows from the role-ladder era. Reuse the same strict private scope.
-- PA snapshot-reviewer functions/policies are deliberately NOT replaced.
CREATE OR REPLACE FUNCTION public.pa_current_user_is_primary_manager_of(
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3_primary$
  -- BEXHR_H3_PUBLIC_PRIMARY_SCOPE_V1
  SELECT auth.uid() IS NOT NULL
    AND bex_pa_private.is_manager_of(p_employee_id, TRUE);
$h3_primary$;

-- Keep the PRE-EXISTING authenticated execution contract for these helpers.
-- No new roles, PA policies, grants on tables, or exposed private schema.
REVOKE ALL ON FUNCTION bex_pa_private.is_manager_of(uuid,boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pa_current_user_is_primary_manager_of(uuid)
  FROM PUBLIC, anon;

DO $h3_postflight$
DECLARE
  v_private oid;
  v_public oid;
BEGIN
  v_private := to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)');
  v_public := to_regprocedure('public.pa_current_user_is_primary_manager_of(uuid)');
  IF v_private IS NULL OR v_public IS NULL
    OR position('BEXHR_H3_PA_TEAM_SCOPE_V1' IN pg_get_functiondef(v_private))=0
    OR position('BEXHR_H3_PUBLIC_PRIMARY_SCOPE_V1' IN pg_get_functiondef(v_public))=0
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid=v_private AND prosecdef IS TRUE
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid=v_public AND prosecdef IS TRUE
    )
    OR has_function_privilege('anon',v_private,'EXECUTE')
    OR has_function_privilege('anon',v_public,'EXECUTE')
    OR NOT has_function_privilege('authenticated',v_private,'EXECUTE')
    OR NOT has_function_privilege('authenticated',v_public,'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_H3_STOP: PA scope functions or existing execution grants failed postflight';
  END IF;
END;
$h3_postflight$;


-- H11 INTEGRATED H3B LEAVE/DELEGATION AUTHORITY; review source in supabase/phase7b-review.
-- BexHR H3B - LEAVE / SECONDARY DELEGATION AUTHORITY - REVIEW ONLY.
-- Requires deployed Phase 7B position/reporting validator + leave-executive,
-- and the already deployed Phase 7 offboarding RPC.
-- This is not a production instruction. Do not run the forward file yet.
-- No employee, leave request, delegation, PA, payroll or offboarding row is written.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $h3b_preflight$
DECLARE
  v_definition text;
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL
    OR pg_catalog.to_regclass('public.employees') IS NULL
    OR pg_catalog.to_regclass('public.employee_reporting_lines') IS NULL
    OR pg_catalog.to_regclass('public.manager_leave_delegations') IS NULL
    OR pg_catalog.to_regclass('public.leave_requests') IS NULL
    OR pg_catalog.to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.bexhr_p7b_workspace_access()') IS NULL
    OR pg_catalog.to_regprocedure('public.hrp_current_manager_employee()') IS NULL
    OR pg_catalog.to_regprocedure('public.hrp_resolve_leave_employee(uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.hrp_find_active_leave_delegation(uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.get_manager_leave_readiness()') IS NULL
    OR pg_catalog.to_regprocedure('public.create_manager_leave_delegation(uuid,text,uuid,timestamptz,timestamptz,text)') IS NULL
    OR pg_catalog.to_regprocedure('public.hrp_apply_leave_decision_once(uuid,text,text)') IS NULL
    OR pg_catalog.to_regprocedure('public.hr_offboard_employee(uuid,text,date,text)') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: missing deployed H2 / leave-executive / offboarding prerequisites';
  END IF;
  IF pg_catalog.to_regprocedure('bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('bexhr_private.h3b_guard_leave_delegation_insert()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgname='h3b_guard_leave_delegation_insert' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: this authority hardening is already installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid='public.manager_leave_delegations'::regclass AND c.relrowsecurity)
    OR pg_catalog.has_table_privilege('authenticated','public.manager_leave_delegations','INSERT')
    OR pg_catalog.has_table_privilege('authenticated','public.manager_leave_delegations','UPDATE')
    OR pg_catalog.has_table_privilege('authenticated','public.manager_leave_delegations','DELETE') THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: delegation table must have RLS and no direct browser writes';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(
    'public.hrp_apply_leave_decision_once(uuid,text,text)'::regprocedure))
    INTO v_definition;
  IF position('hrp_is_current_user_authorized_manager_for_leave_employee' IN v_definition)=0 THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: atomic leave decision RPC no longer calls the delegated authority guard';
  END IF;
  SELECT lower(pg_catalog.pg_get_functiondef(
    'public.get_manager_leave_readiness()'::regprocedure)) INTO v_definition;
  IF position('decision_authority' IN v_definition)=0
    OR position('hrp_find_active_leave_delegation' IN v_definition)=0 THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: leave readiness result is not the reviewed delegation-aware version';
  END IF;
  -- Explicit preflight: do not silently reauthorise or strand currently pending
  -- leave decisions with a stale Primary link. HR must repair affected lines.
  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    JOIN LATERAL public.hrp_resolve_leave_employee(lr.employee_id) target ON TRUE
    JOIN public.employee_reporting_lines line ON line.employee_id=target.employee_id
      AND (line.tenant_id IS NULL OR line.tenant_id=target.tenant_id)
    WHERE lower(btrim(coalesce(lr.status,'')))='pending approval'
      AND lower(btrim(coalesce(line.status::text,'active')))='active'
      AND lower(btrim(coalesce(line.manager_type::text,'')))='primary'
      AND NOT (
        bexhr_private.h11_current_primary_authority(
          target.employee_id,line.manager_employee_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: pending leave has a stale Primary position assignment; review before changing decision authority';
  END IF;
  -- Also halt when pending requests have a Primary who can no longer act:
  -- status, system role, active linked profile or tenant mismatch.
  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    JOIN LATERAL public.hrp_resolve_leave_employee(lr.employee_id) target ON TRUE
    JOIN public.employee_reporting_lines line ON line.employee_id=target.employee_id
     AND (line.tenant_id IS NULL OR line.tenant_id=target.tenant_id)
    LEFT JOIN public.employees manager ON manager.id=line.manager_employee_id
      AND manager.tenant_id=target.tenant_id
    LEFT JOIN public.profiles linked ON linked.id=manager.user_id
      AND linked.tenant_id=target.tenant_id
    WHERE lower(btrim(coalesce(lr.status,'')))='pending approval'
      AND lower(btrim(coalesce(line.status::text,'active')))='active'
      AND lower(btrim(coalesce(line.manager_type::text,'')))='primary'
      AND (manager.id IS NULL
        OR lower(btrim(coalesce(manager.status,'active'))) <> 'active'
        OR lower(btrim(coalesce(manager.system_role,''))) NOT IN ('manager','hr','hr_manager')
        OR linked.id IS NULL OR linked.is_active IS NOT TRUE
        OR lower(btrim(coalesce(linked.role,''))) NOT IN ('manager','hr','hr_manager'))
  ) THEN
    RAISE EXCEPTION 'BEXHR_H3B_STOP: pending leave has an inactive, unlinked or non-manager Primary; repair before release';
  END IF;
END;
$h3b_preflight$;

-- This helper verifies the CURRENT configured reporting ancestry, active
-- tenant-matched employees, active linked management account and one live
-- Primary line. A merely preserved legacy pair does NOT approve leave;
-- only strict configured ancestry or a currently valid, separately HR-Admin-
-- approved H6D exception can confer current decision authority.
CREATE OR REPLACE FUNCTION bexhr_private.h3b_live_leave_primary_pair(
  p_report_employee_id uuid,
  p_primary_manager_employee_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3b_pair$
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
$h3b_pair$;
REVOKE ALL ON FUNCTION bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- An acting Secondary must be an active, login-linked manager-capable account
-- in the same tenant; the delegating Primary must still be the STRICT current
-- Primary for the target, not a grandfathered/stale saved reporting row.
CREATE OR REPLACE FUNCTION public.hrp_find_active_leave_delegation(
  p_leave_employee_id uuid
)
RETURNS TABLE (
  delegation_id uuid,
  primary_manager_employee_id uuid,
  delegated_manager_employee_id uuid,
  ends_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3b_delegated$
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
$h3b_delegated$;
REVOKE ALL ON FUNCTION public.hrp_find_active_leave_delegation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hrp_find_active_leave_delegation(uuid) TO authenticated;

-- The existing transactional leave decision RPC calls this function; replace
-- only its authority predicate, not balance/idempotency/history/decision code.
CREATE OR REPLACE FUNCTION public.hrp_is_current_user_authorized_manager_for_leave_employee(
  p_leave_employee_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3b_authorized$
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
$h3b_authorized$;
REVOKE ALL ON FUNCTION public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)
  TO authenticated;

-- Preserve the existing readiness return contract for the manager UI. It now
-- shows 'view_only' for stale Primary rows, inactive/unlinked users, expired
-- delegations and unrelated team members. A visible request is not a grant.
CREATE OR REPLACE FUNCTION public.get_manager_leave_readiness()
RETURNS TABLE (
  request_id uuid,
  canonical_employee_id uuid,
  manager_type text,
  employee_gender text,
  leave_type_id uuid,
  eligibility_rule text,
  has_balance boolean,
  entitled_days numeric,
  used_days numeric,
  remaining_days numeric,
  can_decide boolean,
  decision_authority text,
  delegation_id uuid,
  delegation_ends_at timestamptz,
  delegated_by_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h3b_readiness$
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
$h3b_readiness$;
REVOKE ALL ON FUNCTION public.get_manager_leave_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_leave_readiness() TO authenticated;

-- Stop newly created delegations that have no CURRENT matching position chain.
-- Existing grants and decision history are retained; decision-time checks use
-- the current hierarchy on every invocation. The owner RPC remains unchanged.
CREATE OR REPLACE FUNCTION bexhr_private.h3b_guard_leave_delegation_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $h3b_guard$
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
$h3b_guard$;
REVOKE ALL ON FUNCTION bexhr_private.h3b_guard_leave_delegation_insert()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER h3b_guard_leave_delegation_insert
  BEFORE INSERT ON public.manager_leave_delegations
  FOR EACH ROW EXECUTE FUNCTION bexhr_private.h3b_guard_leave_delegation_insert();

DO $h3b_postflight$
DECLARE
  v_pair oid := pg_catalog.to_regprocedure('bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)');
  v_guard oid := pg_catalog.to_regprocedure('bexhr_private.h3b_guard_leave_delegation_insert()');
  v_delegated oid := pg_catalog.to_regprocedure('public.hrp_find_active_leave_delegation(uuid)');
  v_decide oid := pg_catalog.to_regprocedure('public.hrp_is_current_user_authorized_manager_for_leave_employee(uuid)');
  v_readiness oid := pg_catalog.to_regprocedure('public.get_manager_leave_readiness()');
BEGIN
  IF v_pair IS NULL OR v_guard IS NULL OR v_delegated IS NULL
     OR v_decide IS NULL OR v_readiness IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H3B_VERIFY: expected authority helpers are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgname='h3b_guard_leave_delegation_insert'
      AND t.tgrelid='public.manager_leave_delegations'::regclass
      AND t.tgenabled='O' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'BEXHR_H3B_VERIFY: delegation insert guard is missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon',v_pair,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',v_pair,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_guard,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_delegated,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_decide,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_readiness,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',v_delegated,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',v_decide,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',v_readiness,'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_H3B_VERIFY: unexpected function privilege';
  END IF;
  IF NOT coalesce((SELECT count(*)=5 AND bool_and(p.prosecdef)
      FROM pg_catalog.pg_proc p
      WHERE p.oid IN (v_pair,v_guard,v_delegated,v_decide,v_readiness)),FALSE) THEN
    RAISE EXCEPTION 'BEXHR_H3B_VERIFY: missing security definer contract';
  END IF;
  IF position('BEXHR_H3B_READINESS_V1' IN
    pg_catalog.pg_get_functiondef(v_readiness))=0 OR
     position('BEXHR_H3B_DECISION_AUTHORITY_V1' IN
    pg_catalog.pg_get_functiondef(v_decide))=0 OR
     position('BEXHR_H3B_ACTING_SECONDARY_V1' IN
    pg_catalog.pg_get_functiondef(v_delegated))=0 THEN
    RAISE EXCEPTION 'BEXHR_H3B_VERIFY: reviewed leave functions not installed';
  END IF;
END;
$h3b_postflight$;


-- H11 INTEGRATED H4 DEPARTMENT GOAL WRITE SCOPE; review source in supabase/phase7b-review.
-- BEXHR H4: PA DEPARTMENT GOAL SCOPE HARDENING. DO NOT RUN ON PRODUCTION.
-- Apply only AFTER coordinated H2 + H3 PA + H3B Leave backend activation
-- and verified real-session RLS tests. This does NOT alter stored PA goals.
-- Policy: HR Standard with Primary reports may write their reports' INDIVIDUAL
-- goals through H3, but does NOT thereby gain department-goal write authority.
-- Department goal write retains the earlier explicit Manager-role requirement;
-- potential future department-head ownership is a SEPARATE policy decision.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $h4_preflight$
DECLARE v_def text;
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.employees') IS NULL
     OR pg_catalog.to_regclass('public.organization_departments') IS NULL
     OR pg_catalog.to_regclass('public.pa_department_goals') IS NULL
     OR pg_catalog.to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('bex_pa_private.manages_department(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('bexhr_private.p7b_configured_primary_match(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)') IS NULL THEN
     RAISE EXCEPTION 'BEXHR_H4_STOP: H2/H3/H3B or PA department dependencies missing';
  END IF;
  v_def := pg_catalog.pg_get_functiondef('bex_pa_private.is_manager_of(uuid,boolean)'::regprocedure);
  IF position('BEXHR_H3_PA_TEAM_SCOPE_V1' IN v_def)=0 THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: reviewed H3 PA Primary helper is not deployed';
  END IF;
  v_def := pg_catalog.pg_get_functiondef('bex_pa_private.manages_department(uuid)'::regprocedure);
  IF position('BEXHR_H4_DEPARTMENT_GOAL_ROLE_GATE_V1' IN v_def)>0 THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: already installed; do not reapply';
  END IF;
  IF position('is_manager_of(' IN lower(v_def))=0
     OR position('true' IN lower(v_def))=0 THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: existing department-goal helper is not Primary-only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
     WHERE oid='public.pa_department_goals'::regclass) THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: department goals RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='pa_department_goals'
      AND cmd IN ('INSERT','UPDATE','ALL')
      AND policyname NOT IN ('PA managers create department goals',
                            'PA managers update department goals')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='pa_department_goals'
      AND policyname='PA managers create department goals' AND cmd='INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='pa_department_goals'
      AND policyname='PA managers update department goals' AND cmd='UPDATE'
  ) THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: unexpected department-goal write policies; inspect first';
  END IF;
END;
$h4_preflight$;

CREATE OR REPLACE FUNCTION bex_pa_private.manages_department(p_department uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $h4_department$
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
$h4_department$;

REVOKE ALL ON FUNCTION bex_pa_private.manages_department(uuid)
  FROM PUBLIC, anon;

DO $h4_postflight$
DECLARE v_helper oid;
BEGIN
  v_helper := pg_catalog.to_regprocedure('bex_pa_private.manages_department(uuid)');
  IF v_helper IS NULL
     OR position('BEXHR_H4_DEPARTMENT_GOAL_ROLE_GATE_V1' IN
          pg_catalog.pg_get_functiondef(v_helper))=0
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
        WHERE oid=v_helper AND prosecdef IS TRUE)
     OR pg_catalog.has_function_privilege('anon',v_helper,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',v_helper,'EXECUTE') THEN
    RAISE EXCEPTION 'BEXHR_H4_STOP: department-goal helper scope/privileges failed postflight';
  END IF;
END;
$h4_postflight$;


-- H11 EXTRA VERIFY: all CURRENT authority paths use the same private helper.
DO $h11_systemwide_contract_verify$
DECLARE
  v_pair integer;
BEGIN
  IF to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NULL
    OR to_regprocedure('bexhr_private.h6d_is_approved_current_primary_exception(uuid,uuid)') IS NULL
    OR to_regprocedure('bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)') IS NULL
    OR to_regprocedure('bex_pa_private.is_manager_of(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_H11_STOP: missing common current-authority dependency';
  END IF;
  IF position('h11_current_primary_authority' IN pg_catalog.pg_get_functiondef(
       'bex_pa_private.is_manager_of(uuid,boolean)'::regprocedure)) = 0
    OR position('h11_current_primary_authority' IN pg_catalog.pg_get_functiondef(
       'bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)'::regprocedure)) = 0
    OR position('h11_current_primary_authority' IN pg_catalog.pg_get_functiondef(
       'bexhr_private.resolve_pa_manager_review_route(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'BEXHR_H11_STOP: PA/Leave/current reviewer paths disagree';
  END IF;
  IF has_function_privilege('anon',
      'bexhr_private.h11_current_primary_authority(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
      'bexhr_private.h11_current_primary_authority(uuid,uuid)','EXECUTE')
     OR has_table_privilege('authenticated',
      'bexhr_private.h6d_approved_primary_exceptions','INSERT') THEN
    RAISE EXCEPTION 'BEXHR_H11_STOP: private authority leaked to browser role';
  END IF;
  SELECT count(*)::integer INTO v_pair
    FROM public.employee_reporting_lines line
   WHERE lower(pg_catalog.btrim(coalesce(line.manager_type::text,'')))='primary'
     AND lower(pg_catalog.btrim(coalesce(line.status::text,'active')))='active'
     AND bexhr_private.is_valid_primary_reporting_pair(
           line.employee_id,line.manager_employee_id)
       IS DISTINCT FROM bexhr_private.is_primary_reporting_relationship_valid(
           line.employee_id,line.manager_employee_id);
  IF v_pair<>0 THEN
    RAISE EXCEPTION 'BEXHR_H11_STOP: old and new reporting-pair validators differ';
  END IF;
END;
$h11_systemwide_contract_verify$;

-- Compare records against the baseline before the final ROLLBACK.
-- ========================================================================
DO $p7b_combined_final$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_total bigint;
  v_valid bigint;
BEGIN
  v_before := nullif(current_setting('bexhr.p7b_combined_baseline', true), '')::jsonb;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: initial record fingerprints are unavailable';
  END IF;
  SELECT jsonb_build_object(
    'employees', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employees row_record),
    'profiles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.profiles row_record),
    'reporting', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employee_reporting_lines row_record),
    'organization_titles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.organization_job_titles row_record),
    'position_links', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.organization_job_title_hierarchy row_record),
    'pa_cycles', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_cycles row_record),
    'pa_employee_appraisals', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_employee_appraisals row_record),
    'pa_manager_appraisals', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.pa_manager_appraisals row_record),
    'leave_requests', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.leave_requests row_record),
    'leave_delegations', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.manager_leave_delegations row_record),
    'leave_balances', (SELECT md5(coalesce(string_agg(md5(to_jsonb(row_record)::text), '|' ORDER BY row_record.id::text), '')) FROM public.employee_leave_balances row_record)
  ) INTO v_after;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: unexpected application record change while staging database functions';
  END IF;

  IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NULL
     OR to_regprocedure('public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)') IS NULL
     OR to_regprocedure('bexhr_private.p7b_resolve_employee_position_id(uuid)') IS NULL
     OR to_regprocedure('bexhr_private.resolve_pa_manager_review_route(uuid,uuid)') IS NULL
     OR to_regprocedure('public.bexhr_p7b_workspace_access()') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: a staged capability/function is missing';
  END IF;

  IF position('BEXHR_P7B_PA_HQ_OCCUPANCY_V1' IN
      pg_get_functiondef('public.pa_activate_cycle(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: PA active-tier patch was not applied';
  END IF;

  IF has_function_privilege('anon', 'public.bexhr_p7b_workspace_access()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.hr_tenant_admin_save_position_with_reporting(uuid,uuid,text,text,text,uuid,boolean)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'INSERT')
     OR has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.organization_job_title_hierarchy', 'DELETE') THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: unexpected browser grants';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE
    bexhr_private.is_primary_reporting_relationship_valid(
      reporting.employee_id, reporting.manager_employee_id))
  INTO v_total,v_valid
  FROM public.employee_reporting_lines reporting
  WHERE lower(btrim(coalesce(reporting.manager_type::text,'')))='primary'
    AND lower(btrim(coalesce(reporting.status::text,'active')))='active';
  IF v_total<>v_valid THEN
    RAISE EXCEPTION 'BEXHR_P7B_COMBINED_STOP: staged validator rejects % of % current Primary lines', v_total-v_valid, v_total;
  END IF;
END;
$p7b_combined_final$;

-- FINAL STATEMENT - NOTHING ABOVE PERMANENTLY CHANGES SUPABASE.
ROLLBACK;
