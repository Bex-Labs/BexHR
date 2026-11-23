-- System-wide PA manager readiness guard.
-- Leave submission already has a hierarchy-valid Primary Manager trigger.
-- Existing appraisal records/history and cycle creation remain untouched.

CREATE OR REPLACE FUNCTION bexhr_private.require_pa_employee_manager_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $guard$
DECLARE
  v_route jsonb;
  v_kind text;
BEGIN
  IF NEW.employee_id IS NULL OR NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='BEXHR_PA_EMPLOYEE_ID_REQUIRED: The employee and company must be identified.';
  END IF;

  v_route := bexhr_private.resolve_pa_manager_review_route(NEW.employee_id,NEW.tenant_id);
  v_kind := coalesce(v_route->>'route','CONFIGURATION_ERROR');

  -- Only a hierarchy-valid Primary Manager or an explicitly configured
  -- top-level position may enter a new employee PA action.
  IF v_kind NOT IN ('PRIMARY_MANAGER','TOP_LEVEL') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='BEXHR_PA_PRIMARY_MANAGER_REQUIRED: Performance appraisal actions are locked until HR assigns an active, hierarchy-valid Primary Manager.',
      DETAIL='Existing appraisal history is preserved. HR must correct the employee reporting line or hierarchy; access resumes automatically once eligible.';
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS bexhr_pa_require_manager_self ON public.pa_self_appraisals;
CREATE TRIGGER bexhr_pa_require_manager_self
BEFORE INSERT OR UPDATE OF employee_id,tenant_id,appraisal_id,status,payload
ON public.pa_self_appraisals
FOR EACH ROW EXECUTE FUNCTION bexhr_private.require_pa_employee_manager_readiness();

DROP TRIGGER IF EXISTS bexhr_pa_require_manager_progress ON public.pa_progress_updates;
CREATE TRIGGER bexhr_pa_require_manager_progress
BEFORE INSERT OR UPDATE OF employee_id,tenant_id,cycle_id,status,payload
ON public.pa_progress_updates
FOR EACH ROW EXECUTE FUNCTION bexhr_private.require_pa_employee_manager_readiness();

CREATE OR REPLACE FUNCTION public.bexhr_pa_my_manager_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $readiness$
DECLARE
  v_user_id uuid := auth.uid();
  v_employee_id uuid;
  v_tenant_id uuid;
  v_route jsonb;
  v_ready boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authenticated employee access required.';
  END IF;

  SELECT e.id,e.tenant_id
    INTO v_employee_id,v_tenant_id
    FROM public.employees e
    JOIN public.profiles p ON p.id=v_user_id AND p.tenant_id=e.tenant_id AND p.is_active IS TRUE
   WHERE e.user_id=v_user_id
     AND lower(btrim(coalesce(e.status,'active')))='active'
   ORDER BY e.created_at DESC
   LIMIT 1;

  IF v_employee_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active company employee record required.';
  END IF;

  v_route := bexhr_private.resolve_pa_manager_review_route(v_employee_id,v_tenant_id);
  v_ready := coalesce(v_route->>'route','') IN ('PRIMARY_MANAGER','TOP_LEVEL');

  RETURN jsonb_build_object(
    'ready',v_ready,
    'isTopLevel',(v_route->>'route'='TOP_LEVEL'),
    'route',v_route->>'route',
    'reason',v_route->>'reason',
    'message',CASE WHEN v_ready THEN NULL ELSE
      'Manager Assignment Required: Leave requests and new performance appraisal actions are locked until HR assigns an active reporting manager and corrects any reporting hierarchy issue.' END
  );
END;
$readiness$;

REVOKE ALL ON FUNCTION public.bexhr_pa_my_manager_readiness() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bexhr_pa_my_manager_readiness() TO authenticated;
