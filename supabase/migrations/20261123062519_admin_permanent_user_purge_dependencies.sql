-- BexHR Platform Admin permanent user deletion: dependency-safe employee purge.
-- Existing Platform Admin checks and service-role-only RPC privileges remain intact.
-- Operational employee history is archived under the private schema before removal.
-- Other employees' appraisal records are never deleted to release a reviewer FK.
-- Evidence with Storage objects requires a separate safe-clear workflow.

CREATE TABLE IF NOT EXISTS bexhr_private.deleted_employee_lifecycle_archive (
  source_event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  former_employee_id uuid NOT NULL,
  action text NOT NULL,
  reason text,
  last_working_day date,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by uuid,
  event_created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON bexhr_private.deleted_employee_lifecycle_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON bexhr_private.deleted_employee_lifecycle_archive TO service_role;

CREATE TABLE IF NOT EXISTS bexhr_private.deleted_employee_decision_audit_archive (
  source_audit_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  former_employee_id uuid NOT NULL,
  original_record jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON bexhr_private.deleted_employee_decision_audit_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON bexhr_private.deleted_employee_decision_audit_archive TO service_role;

CREATE OR REPLACE FUNCTION bexhr_private.admin_purge_employee_dependencies(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $cleanup$
DECLARE
  v_tenant_id uuid;
  v_auth_id uuid;
  v_expected integer := 0;
  v_archived integer := 0;
  v_lifecycle_deleted integer := 0;
  v_decision_audit_expected integer := 0;
  v_decision_audit_archived integer := 0;
  v_related_pa_deleted integer := 0;
  v_leave_deleted integer := 0;
BEGIN
  SELECT e.tenant_id, e.user_id INTO v_tenant_id, v_auth_id
    FROM public.employees e WHERE e.id = p_employee_id FOR UPDATE;
  IF v_tenant_id IS NULL OR v_auth_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_EMPLOYEE_NOT_LINKED: The selected employee needs a valid tenant and login.';
  END IF;

  -- Never destroy another employee's historical reviewer snapshots.
  IF EXISTS (
    SELECT 1 FROM public.pa_employee_appraisals a
    WHERE a.manager_employee_id = p_employee_id AND a.employee_id <> p_employee_id
  ) OR EXISTS (
    SELECT 1 FROM public.pa_manager_appraisals a
    WHERE a.manager_employee_id = p_employee_id AND a.employee_id <> p_employee_id
  ) THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_PA_REVIEWER_IN_USE: Historical appraisals still reference this person as reviewer. Preserve those records and resolve their retention before permanent deletion.';
  END IF;

  -- Storage deletion is a separate external action, not transactional with SQL.
  -- Refuse to orphan stored appraisal evidence or remove a file prematurely.
  IF EXISTS (
    SELECT 1 FROM public.pa_progress_evidence pe
    WHERE pe.employee_id = p_employee_id
       OR pe.progress_update_id IN (
         SELECT pu.id FROM public.pa_progress_updates pu WHERE pu.employee_id = p_employee_id
       )
  ) THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_PA_EVIDENCE_PRESENT: Appraisal files require safe Storage reconciliation before permanent deletion.';
  END IF;

  -- Do not strand somebody else's leave approval by deleting their manager.
  IF EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.manager_id = v_auth_id AND lr.employee_id <> v_auth_id
      AND lower(btrim(coalesce(lr.status, ''))) IN ('pending approval', 'pending', 'submitted')
  ) THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_PENDING_LEAVE_IN_USE: Resolve pending leave approvals assigned to this manager before permanent deletion.';
  END IF;

  -- Preserve manager-decision audit records before the original RPC's
  -- restricted-FK cleanup removes them. Other staff history remains separate.
  SELECT count(*) INTO v_decision_audit_expected
    FROM public.manager_leave_decision_authority_audit a
   WHERE a.target_employee_id = p_employee_id
      OR a.actor_manager_employee_id = p_employee_id
      OR a.primary_manager_employee_id = p_employee_id
      OR a.leave_request_id IN (
        SELECT lr.id FROM public.leave_requests lr WHERE lr.employee_id = v_auth_id
      );
  INSERT INTO bexhr_private.deleted_employee_decision_audit_archive (
    source_audit_id, tenant_id, former_employee_id, original_record
  )
  SELECT a.id, a.tenant_id, p_employee_id, to_jsonb(a)
    FROM public.manager_leave_decision_authority_audit a
   WHERE a.target_employee_id = p_employee_id
      OR a.actor_manager_employee_id = p_employee_id
      OR a.primary_manager_employee_id = p_employee_id
      OR a.leave_request_id IN (
        SELECT lr.id FROM public.leave_requests lr WHERE lr.employee_id = v_auth_id
      );
  GET DIAGNOSTICS v_decision_audit_archived = ROW_COUNT;
  IF v_decision_audit_archived <> v_decision_audit_expected THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_AUDIT_ARCHIVE_MISMATCH: Manager audit history was not fully archived.';
  END IF;

  DELETE FROM public.manager_leave_decision_authority_audit a
   WHERE a.target_employee_id = p_employee_id
      OR a.actor_manager_employee_id = p_employee_id
      OR a.primary_manager_employee_id = p_employee_id
      OR a.leave_request_id IN (
        SELECT lr.id FROM public.leave_requests lr WHERE lr.employee_id = v_auth_id
      );

  -- Keep an access-restricted lifecycle record without a live employee FK.
  SELECT count(*) INTO v_expected FROM public.employee_lifecycle_events
   WHERE tenant_id = v_tenant_id AND employee_id = p_employee_id;

  INSERT INTO bexhr_private.deleted_employee_lifecycle_archive (
    source_event_id, tenant_id, former_employee_id, action, reason,
    last_working_day, note, metadata, recorded_by, event_created_at
  )
  SELECT id, tenant_id, employee_id, action, reason, last_working_day,
         note, metadata, created_by, created_at
    FROM public.employee_lifecycle_events
   WHERE tenant_id = v_tenant_id AND employee_id = p_employee_id;
  GET DIAGNOSTICS v_archived = ROW_COUNT;
  IF v_archived <> v_expected THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_ARCHIVE_COUNT_MISMATCH: Lifecycle history was not fully archived.';
  END IF;

  DELETE FROM public.employee_lifecycle_events
   WHERE tenant_id = v_tenant_id AND employee_id = p_employee_id;
  GET DIAGNOSTICS v_lifecycle_deleted = ROW_COUNT;
  IF v_lifecycle_deleted <> v_archived THEN
    RAISE EXCEPTION 'BEXHR_ADMIN_PURGE_LIFECYCLE_COUNT_MISMATCH: Lifecycle archive and cleanup do not match.';
  END IF;

  -- Personal appraisal children first; never delete another employee's PA.
  DELETE FROM public.pa_employee_acknowledgements WHERE employee_id = p_employee_id;
  DELETE FROM public.pa_hr_finalisations WHERE employee_id = p_employee_id;
  DELETE FROM public.pa_manager_appraisals WHERE employee_id = p_employee_id;
  DELETE FROM public.pa_self_appraisals WHERE employee_id = p_employee_id;
  DELETE FROM public.pa_employee_appraisals WHERE employee_id = p_employee_id;
  GET DIAGNOSTICS v_related_pa_deleted = ROW_COUNT;

  -- Goal progress references the individual goal through a restrictive FK.
  DELETE FROM public.pa_progress_updates WHERE employee_id = p_employee_id;
  DELETE FROM public.pa_individual_goals WHERE employee_id = p_employee_id;

  -- Leave employee_id and manager_id reference Auth, not employees.
  -- Existing decision audits for the target have already been removed by the
  -- original purge; clear any remaining audits referencing the leave IDs.
  DELETE FROM public.manager_leave_decision_authority_audit a
   WHERE a.leave_request_id IN (
     SELECT lr.id FROM public.leave_requests lr WHERE lr.employee_id = v_auth_id
   );
  DELETE FROM public.leave_requests WHERE employee_id = v_auth_id;
  GET DIAGNOSTICS v_leave_deleted = ROW_COUNT;

  -- Keep colleagues' approved history while releasing the Auth FK.
  -- Historical decision names and audit timestamps remain intact.
  UPDATE public.leave_requests SET manager_id = NULL
   WHERE manager_id = v_auth_id AND employee_id <> v_auth_id;

  RETURN jsonb_build_object(
    'lifecycleArchived', v_archived,
    'managerDecisionAuditArchived', v_decision_audit_archived,
    'lifecycleRemovedFromActiveTable', v_lifecycle_deleted,
    'employeeAppraisalsRemoved', v_related_pa_deleted,
    'employeeLeaveRequestsRemoved', v_leave_deleted
  );
END;
$cleanup$;

REVOKE ALL ON FUNCTION bexhr_private.admin_purge_employee_dependencies(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bexhr_private.admin_purge_employee_dependencies(uuid)
  TO service_role;

-- Retain the existing RPC and service-role permission contract exactly.
-- Insert dependency cleanup before the original manager-audit purge.
DO $patch$
DECLARE
  v_original text;
  v_updated text;
  v_target constant text := 'delete from public.manager_leave_decision_authority_audit';
  v_replacement constant text :=
    'perform bexhr_private.admin_purge_employee_dependencies(p_employee_id);'
    || chr(10) || '  delete from public.manager_leave_decision_authority_audit';
BEGIN
  SELECT pg_get_functiondef('public.admin_force_purge_employee(uuid)'::regprocedure)
    INTO v_original;
  IF v_original IS NULL THEN
    RAISE EXCEPTION 'STOP: admin_force_purge_employee is missing.';
  END IF;
  IF (length(v_original) - length(replace(v_original, v_target, ''))) <> length(v_target)
     OR position('bexhr_private.admin_purge_employee_dependencies' IN v_original) > 0 THEN
    RAISE EXCEPTION 'STOP: Unexpected or already patched permanent-delete RPC.';
  END IF;
  v_updated := replace(v_original, v_target, v_replacement);
  EXECUTE v_updated;
END;
$patch$;

REVOKE ALL ON FUNCTION public.admin_force_purge_employee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_purge_employee(uuid) TO service_role;
