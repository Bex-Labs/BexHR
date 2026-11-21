CREATE OR REPLACE FUNCTION public.hr_tenant_admin_save_position_with_reporting(p_job_title_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_job_title text DEFAULT NULL::text, p_status text DEFAULT 'Active'::text, p_notes text DEFAULT NULL::text, p_reports_to_job_title_id uuid DEFAULT NULL::uuid, p_configure_reporting boolean DEFAULT true)
 RETURNS organization_job_titles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE
    v_tenant_id uuid;
    v_result public.organization_job_titles%rowtype;
    v_status text;
    v_capabilities jsonb;

BEGIN

    -- Require authenticated HR Admin.

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION
            'BEXHR_STAGE13_AUTH_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    v_tenant_id :=
        public.require_current_tenant_administrator();

    -- ======================================
    -- PHASE 7B ACTIVATION GATE
    -- ======================================

    -- This function must not perform any
    -- application writes before verified
    -- Phase 7B activation.

    IF to_regprocedure(
        'public.bexhr_p7b_structure_capabilities()'
    ) IS NULL THEN

        RAISE EXCEPTION
            'BEXHR_STAGE13_HELD: Atomic position saving is not activated.'
            USING ERRCODE = '23514';

    END IF;

    EXECUTE
        'SELECT public.bexhr_p7b_structure_capabilities()'
    INTO v_capabilities;

    IF v_capabilities->>'department_positions'
           IS DISTINCT FROM 'true'

    OR v_capabilities->>'atomic_position_save'
           IS DISTINCT FROM 'true' THEN

        RAISE EXCEPTION
            'BEXHR_STAGE13_HELD: Verified departmental reporting capability unavailable.'
            USING ERRCODE = '23514';

    END IF;

    -- ======================================
    -- COMPANY TRANSACTION PROTECTION
    -- ======================================

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(v_tenant_id::text)::bigint
    );

    -- ======================================
    -- VALIDATE POSITION STATUS
    -- ======================================

    v_status :=
        LOWER(TRIM(COALESCE(p_status, '')));

    IF v_status NOT IN ('active', 'inactive') THEN

        RAISE EXCEPTION
            'BEXHR_STAGE13_BAD_STATUS: Active or Inactive required.'
            USING ERRCODE = '22023';

    END IF;

    -- Active positions can be saved before their reporting is configured.
    -- The unconfigured state is never silently converted into a root position.
    -- A parent choice is only valid when explicit reporting configuration is requested.
    IF v_status = 'active'
       AND p_configure_reporting IS DISTINCT FROM TRUE
       AND p_reports_to_job_title_id IS NOT NULL
    THEN
        RAISE EXCEPTION
            'BEXHR_STAGE13_PARENT_REQUIRES_CONFIGURATION'
            USING ERRCODE = '23514';
    END IF;

    -- Inactive positions cannot retain
    -- a proposed reporting parent.

    IF v_status = 'inactive'
       AND p_reports_to_job_title_id IS NOT NULL
    THEN

        RAISE EXCEPTION
            'BEXHR_STAGE13_INACTIVE_PARENT_NOT_ALLOWED'
            USING ERRCODE = '23514';

    END IF;

    -- ======================================
    -- PROTECTED DEACTIVATION
    -- ======================================

    -- Existing child relationships must be
    -- reassigned before removing a parent.
    --
    -- Any failure rolls back the transaction.

    IF v_status = 'inactive'
       AND p_job_title_id IS NOT NULL
       AND EXISTS (

           SELECT 1
           FROM public.organization_job_title_hierarchy h

           WHERE h.tenant_id = v_tenant_id
             AND h.job_title_id = p_job_title_id

       )
    THEN

        PERFORM
            public.hr_tenant_admin_delete_organization_job_title_hierarchy(
                p_job_title_id
            );

    END IF;

    -- ======================================
    -- SAVE JOB POSITION
    -- ======================================

    -- Existing protected function enforces
    -- company ownership and department scope.

    v_result :=
        public.hr_tenant_admin_save_organization_job_title(

            p_job_title_id,
            p_department_id,
            p_job_title,
            p_status,
            p_notes

        );

    -- ======================================
    -- SAVE REPORTING RELATIONSHIP
    -- ======================================

    -- Both saves belong to the same transaction.
    -- Failure here rolls back the title save.

    IF v_status = 'active' AND p_configure_reporting IS TRUE THEN

        PERFORM
            public.hr_tenant_admin_save_organization_job_title_hierarchy(

                v_result.id,
                p_reports_to_job_title_id

            );

    END IF;

    RETURN v_result;

END;

$function$
;
DO $verify$ BEGIN
 IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NULL THEN
  RAISE EXCEPTION 'P7B activation capability missing'; END IF;
 IF (SELECT count(*) FROM public.employee_reporting_lines WHERE lower(btrim(coalesce(manager_type,'')))='primary' AND lower(btrim(coalesce(status,'active')) )='active')<>19 THEN
  RAISE EXCEPTION 'Unexpected reporting lines'; END IF;
 IF (SELECT count(*) FROM bexhr_private.p7b_legacy_primary_transition)<>8 THEN RAISE EXCEPTION 'Legacy snapshot drift'; END IF;
END; $verify$;