-- BexHR PR30: preserve referenced profile audit before Supabase Auth removal.
-- The employee purge has already run before this service-role-only RPC.
-- Retain original grant/deduction attribution in a private, non-FK archive.
CREATE TABLE IF NOT EXISTS bexhr_private.deleted_user_reference_archive (
  source_table text NOT NULL,
  source_row_id text NOT NULL,
  former_profile_id uuid NOT NULL,
  reference_kind text NOT NULL,
  original_record jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_row_id, former_profile_id, reference_kind)
);
REVOKE ALL ON bexhr_private.deleted_user_reference_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON bexhr_private.deleted_user_reference_archive TO service_role;

CREATE OR REPLACE FUNCTION public.admin_prepare_auth_user_delete(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $prepare$
DECLARE
  v_role text;
  v_grants integer := 0;
  v_other_grants integer := 0;
  v_deductions integer := 0;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_DELETE_PROFILE_REQUIRED';
  END IF;
  SELECT lower(btrim(p.role)) INTO v_role
    FROM public.profiles p WHERE p.id=p_profile_id FOR UPDATE;
  IF NOT FOUND OR v_role='admin' THEN
    RAISE EXCEPTION 'BEXHR_DELETE_PROFILE_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id=p_profile_id) THEN
    RAISE EXCEPTION 'BEXHR_DELETE_EMPLOYEE_STILL_LINKED';
  END IF;
  -- Take an advisory lock keyed to the identity so retries do not collide.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_profile_id::text)::bigint);

  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'bexhr_private.h12_hr_standard_workspace_grants',
         g.tenant_id::text || ':' || g.profile_id::text,
         p_profile_id,
         CASE WHEN g.profile_id=p_profile_id THEN 'grant_recipient' ELSE 'grant_actor' END,
         to_jsonb(g)
    FROM bexhr_private.h12_hr_standard_workspace_grants g
   WHERE g.profile_id=p_profile_id OR g.granted_by=p_profile_id
  ON CONFLICT DO NOTHING;

  DELETE FROM bexhr_private.h12_hr_standard_workspace_grants
   WHERE profile_id=p_profile_id;
  GET DIAGNOSTICS v_grants=ROW_COUNT;
  -- Other employees' grants remain. Only their deleted actor FK is cleared.
  UPDATE bexhr_private.h12_hr_standard_workspace_grants
     SET granted_by=NULL WHERE granted_by=p_profile_id;
  GET DIAGNOSTICS v_other_grants=ROW_COUNT;

  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'public.payroll_other_deductions',d.id::text,p_profile_id,
         CASE WHEN d.created_by=p_profile_id AND d.updated_by=p_profile_id
              THEN 'created_and_updated_by'
              WHEN d.created_by=p_profile_id THEN 'created_by' ELSE 'updated_by' END,
         to_jsonb(d)
    FROM public.payroll_other_deductions d
   WHERE d.created_by=p_profile_id OR d.updated_by=p_profile_id
  ON CONFLICT DO NOTHING;

  UPDATE public.payroll_other_deductions
     SET created_by=CASE WHEN created_by=p_profile_id THEN NULL ELSE created_by END,
         updated_by=CASE WHEN updated_by=p_profile_id THEN NULL ELSE updated_by END
   WHERE created_by=p_profile_id OR updated_by=p_profile_id;
  GET DIAGNOSTICS v_deductions=ROW_COUNT;

  -- Other Auth FKs (besides profiles) also need a durable attribution record.
  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'public.email_delivery_logs',e.id::text,p_profile_id,'created_by',to_jsonb(e)
    FROM public.email_delivery_logs e WHERE e.created_by=p_profile_id
  ON CONFLICT DO NOTHING;
  UPDATE public.email_delivery_logs SET created_by=NULL WHERE created_by=p_profile_id;

  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'public.email_integration_test_recipients',e.id::text,p_profile_id,'created_by',to_jsonb(e)
    FROM public.email_integration_test_recipients e WHERE e.created_by=p_profile_id
  ON CONFLICT DO NOTHING;
  UPDATE public.email_integration_test_recipients SET created_by=NULL WHERE created_by=p_profile_id;

  -- Keep pending profile-correction requests actionable for HR. An unresolved
  -- request cannot be silently removed with the departing user's Auth record.
  IF EXISTS (
    SELECT 1 FROM public.employee_profile_correction_requests c
     WHERE c.requested_by=p_profile_id
       AND lower(btrim(coalesce(c.status,''))) IN ('pending','pending review','submitted','open','in review')
  ) THEN
    RAISE EXCEPTION 'BEXHR_DELETE_PENDING_PROFILE_CORRECTION: Resolve the pending employee profile request before deleting the login.';
  END IF;
  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'public.employee_profile_correction_requests',c.id::text,p_profile_id,
         CASE WHEN c.requested_by=p_profile_id THEN 'requested_by' ELSE 'reviewed_by' END,to_jsonb(c)
    FROM public.employee_profile_correction_requests c
   WHERE c.requested_by=p_profile_id OR c.reviewed_by=p_profile_id
  ON CONFLICT DO NOTHING;
  UPDATE public.employee_profile_correction_requests SET reviewed_by=NULL
   WHERE reviewed_by=p_profile_id AND requested_by<>p_profile_id;
  -- Requests created by the deleted Auth account will cascade on Auth removal;
  -- the complete original record is retained in the private archive above.

  -- Preserve colleagues' leave decisions. Pending approvals assigned to a
  -- departing login must be reassigned before deletion, not silently erased.
  IF EXISTS (
    SELECT 1 FROM public.leave_requests lr
     WHERE lr.manager_id=p_profile_id AND lr.employee_id<>p_profile_id
       AND lower(btrim(coalesce(lr.status,''))) IN ('pending approval','pending','submitted')
  ) THEN
    RAISE EXCEPTION 'BEXHR_DELETE_PENDING_LEAVE_APPROVAL: Resolve pending leave approval before removing its manager.';
  END IF;
  INSERT INTO bexhr_private.deleted_user_reference_archive
   (source_table,source_row_id,former_profile_id,reference_kind,original_record)
  SELECT 'public.leave_requests',lr.id::text,p_profile_id,
         CASE WHEN lr.employee_id=p_profile_id THEN 'employee_id' ELSE 'manager_id' END,
         to_jsonb(lr)
    FROM public.leave_requests lr
   WHERE lr.employee_id=p_profile_id OR lr.manager_id=p_profile_id
  ON CONFLICT DO NOTHING;
  UPDATE public.leave_requests SET manager_id=NULL
   WHERE manager_id=p_profile_id AND employee_id<>p_profile_id;

  RETURN jsonb_build_object('ready',true,'grantsRemoved',v_grants,
    'actorReferencesCleared',v_other_grants,'deductionReferencesCleared',v_deductions);
END;
$prepare$;
REVOKE ALL ON FUNCTION public.admin_prepare_auth_user_delete(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_auth_user_delete(uuid) TO service_role;

-- A candidate must never create a loop in the current employee-level graph.
CREATE OR REPLACE FUNCTION bexhr_private.auto_primary_would_cycle(p_child uuid,p_manager uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $cycle$
WITH RECURSIVE chain AS (
  SELECT p_manager AS employee_id, ARRAY[p_manager]::uuid[] AS visited, FALSE AS cyclic
  UNION ALL
  SELECT rl.manager_employee_id,chain.visited || rl.manager_employee_id,
         rl.manager_employee_id=ANY(chain.visited)
    FROM chain
    JOIN public.employee_reporting_lines rl ON rl.employee_id=chain.employee_id
   WHERE NOT chain.cyclic
     AND cardinality(chain.visited)<128
     AND lower(btrim(coalesce(rl.manager_type,'')))='primary'
     AND lower(btrim(coalesce(rl.status,'active')))='active'
)
SELECT p_child=p_manager OR EXISTS(SELECT 1 FROM chain WHERE employee_id=p_child OR cyclic);
$cycle$;
REVOKE ALL ON FUNCTION bexhr_private.auto_primary_would_cycle(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

-- Auto-populate only unassigned employee Primary Managers after an HR Admin
-- configures a valid position hierarchy. Never choose between multiple staff.
CREATE OR REPLACE FUNCTION bexhr_private.assign_unambiguous_primary_managers(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $assign$
DECLARE
  v_child record;
  v_manager_id uuid;
  v_candidate_count integer;
  v_assigned integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant_id::text)::bigint);
  FOR v_child IN
    SELECT e.id
      FROM public.employees e
     WHERE e.tenant_id=p_tenant_id
       AND lower(btrim(coalesce(e.status,'active')))='active'
       AND EXISTS (
         SELECT 1 FROM public.organization_job_title_hierarchy h
          WHERE h.tenant_id=p_tenant_id
            AND h.job_title_id=bexhr_private.p7b_resolve_employee_position_id(e.id)
            AND h.reports_to_job_title_id IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.employee_reporting_lines rl
          WHERE rl.employee_id=e.id
            AND lower(btrim(coalesce(rl.manager_type,'')))='primary'
            AND lower(btrim(coalesce(rl.status,'active')))='active'
       )
     ORDER BY e.id
  LOOP
    v_manager_id := NULL;
    v_candidate_count := 0;
    SELECT count(*),(array_agg(m.id ORDER BY m.id))[1] INTO v_candidate_count,v_manager_id
      FROM public.employees m
      JOIN public.profiles p ON p.id=m.user_id
       AND p.tenant_id=p_tenant_id
       AND p.is_active IS TRUE
       AND lower(btrim(p.role)) IN ('manager','hr','hr_manager')
     WHERE m.tenant_id=p_tenant_id
       AND m.id<>v_child.id
       AND lower(btrim(coalesce(m.status,'active')))='active'
       AND lower(btrim(coalesce(m.system_role,''))) IN ('manager','hr','hr_manager')
       AND bexhr_private.p7b_configured_primary_match(v_child.id,m.id)
       AND bexhr_private.is_valid_primary_reporting_pair(v_child.id,m.id)
       AND NOT bexhr_private.auto_primary_would_cycle(v_child.id,m.id);

    IF v_candidate_count=1 AND v_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_lines
        (tenant_id,employee_id,manager_employee_id,manager_type,status,effective_date,
         notes,created_by,updated_by)
      VALUES (p_tenant_id,v_child.id,v_manager_id,'Primary','Active',current_date,
        '[BexHR] Assigned automatically from the uniquely eligible configured reporting hierarchy.',
        auth.uid(),auth.uid());
      v_assigned := v_assigned+1;
    END IF;
  END LOOP;
  RETURN v_assigned;
END;
$assign$;
REVOKE ALL ON FUNCTION bexhr_private.assign_unambiguous_primary_managers(uuid)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION bexhr_private.auto_primary_after_hierarchy_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $auto$
BEGIN
  PERFORM bexhr_private.assign_unambiguous_primary_managers(NEW.tenant_id);
  RETURN NEW;
END;
$auto$;
DROP TRIGGER IF EXISTS bexhr_auto_primary_after_hierarchy_change
 ON public.organization_job_title_hierarchy;
CREATE TRIGGER bexhr_auto_primary_after_hierarchy_change
 AFTER INSERT OR UPDATE OF reports_to_job_title_id
 ON public.organization_job_title_hierarchy
 FOR EACH ROW EXECUTE FUNCTION bexhr_private.auto_primary_after_hierarchy_change();

-- Employees can be hired/moved after their position chain was configured.
-- Reconcile at that point too, without touching existing active Primaries.
CREATE OR REPLACE FUNCTION bexhr_private.auto_primary_after_employee_position_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $auto$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM bexhr_private.assign_unambiguous_primary_managers(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$auto$;
DROP TRIGGER IF EXISTS bexhr_auto_primary_after_employee_position_change
 ON public.employees;
CREATE TRIGGER bexhr_auto_primary_after_employee_position_change
 AFTER INSERT OR UPDATE OF job_title,department,status,system_role,user_id
 ON public.employees
 FOR EACH ROW EXECUTE FUNCTION bexhr_private.auto_primary_after_employee_position_change();

-- When an existing staff member gains an eligible active login role, assign
-- any still-missing unambiguous Primary lines without changing other lines.
CREATE OR REPLACE FUNCTION bexhr_private.auto_primary_after_profile_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $auto$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM bexhr_private.assign_unambiguous_primary_managers(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$auto$;
DROP TRIGGER IF EXISTS bexhr_auto_primary_after_profile_change ON public.profiles;
CREATE TRIGGER bexhr_auto_primary_after_profile_change
 AFTER INSERT OR UPDATE OF role,is_active,tenant_id
 ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION bexhr_private.auto_primary_after_profile_change();

-- One targeted catch-up for existing configured tenants: fill only unassigned,
-- unambiguous Primary relationships. No existing Primary/Secondary rows change.
DO $backfill$
DECLARE
  v_tenant uuid;
  v_count integer;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT h.tenant_id FROM public.organization_job_title_hierarchy h
  LOOP
    v_count := bexhr_private.assign_unambiguous_primary_managers(v_tenant);
    IF v_count > 0 THEN
      RAISE NOTICE 'BexHR safe Primary backfill tenant %, assignments %', v_tenant, v_count;
    END IF;
  END LOOP;
END;
$backfill$;
