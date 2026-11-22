-- BexHR Platform Admin Reset Workspace
-- Correct tenant hierarchy deletion order.
-- Preserve authentication, PA preflight, employees and audit records.
-- This migration updates the RPC; it does not reset any company.

DO $migration$
DECLARE
    v_original text;
    v_updated text;

    v_target constant text :=
        'delete from public.organization_job_titles';

    v_replacement constant text := $cleanup$
delete from public.organization_job_title_hierarchy
    where tenant_id = v_tenant_id;

    get diagnostics v_rows = row_count;

    v_counts := v_counts ||
        jsonb_build_object(
            'organization_job_title_hierarchy',
            v_rows
        );

    delete from public.organization_job_titles$cleanup$;

BEGIN

    SELECT pg_get_functiondef(
        'public.admin_reset_tenant_workspace(uuid)'::regprocedure
    )
    INTO v_original;

    IF v_original IS NULL THEN
        RAISE EXCEPTION 'STOP: Reset Workspace RPC missing.';
    END IF;

    IF (
        length(v_original) -
        length(replace(v_original, v_target, ''))
    ) <> length(v_target) THEN
        RAISE EXCEPTION
            'STOP: Unexpected Reset Workspace function structure.';
    END IF;

    v_updated := replace(
        v_original,
        v_target,
        v_replacement
    );

    EXECUTE v_updated;

END;
$migration$;
