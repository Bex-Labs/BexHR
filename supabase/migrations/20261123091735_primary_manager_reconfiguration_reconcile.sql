-- PR30: reconcile employee Primary Managers only after the FINAL committed
-- hierarchy has been checked, not during intermediate position updates.
-- Preserve a current valid or formally approved exceptional Primary.
-- Never guess between multiple candidates or erase Leave/PA history.
CREATE OR REPLACE FUNCTION bexhr_private.assign_unambiguous_primary_managers(p_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $assign$
DECLARE
  v_child record;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_manager uuid;
  v_candidate_count integer;
  v_candidate uuid;
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant_id::text)::bigint);

  FOR v_child IN
    SELECT e.id FROM public.employees e
     WHERE e.tenant_id=p_tenant_id
       AND lower(btrim(coalesce(e.status,'active')))='active'
       AND EXISTS (
         SELECT 1 FROM public.organization_job_title_hierarchy h
          WHERE h.tenant_id=p_tenant_id
            AND h.job_title_id=bexhr_private.p7b_resolve_employee_position_id(e.id)
            AND h.reports_to_job_title_id IS NOT NULL
       )
     ORDER BY e.id
  LOOP
    SELECT count(*),(array_agg(rl.id ORDER BY rl.id))[1],
           (array_agg(rl.manager_employee_id ORDER BY rl.id))[1]
      INTO v_existing_count,v_existing_id,v_existing_manager
      FROM public.employee_reporting_lines rl
     WHERE rl.employee_id=v_child.id
       AND lower(btrim(coalesce(rl.manager_type,'')))='primary'
       AND lower(btrim(coalesce(rl.status,'active')))='active';

    -- Multiple active primaries must be reviewed by HR, never auto-rewritten.
    IF v_existing_count>1 THEN CONTINUE; END IF;

    -- The shared current-authority check includes formally approved exceptions.
    IF v_existing_count=1 AND
       bexhr_private.h11_current_primary_authority(v_child.id,v_existing_manager)
    THEN CONTINUE; END IF;

    SELECT count(*),(array_agg(m.id ORDER BY m.id))[1]
      INTO v_candidate_count,v_candidate
      FROM public.employees m
      JOIN public.profiles p ON p.id=m.user_id
        AND p.tenant_id=p_tenant_id AND p.is_active IS TRUE
        AND lower(btrim(coalesce(p.role,''))) IN ('manager','hr','hr_manager')
     WHERE m.tenant_id=p_tenant_id
       AND m.id<>v_child.id
       AND lower(btrim(coalesce(m.status,'active')))='active'
       AND lower(btrim(coalesce(m.system_role,''))) IN ('manager','hr','hr_manager')
       AND bexhr_private.p7b_configured_primary_match(v_child.id,m.id)
       AND bexhr_private.is_valid_primary_reporting_pair(v_child.id,m.id)
       AND NOT bexhr_private.auto_primary_would_cycle(v_child.id,m.id);

    -- Vacant / ambiguous hierarchy: no automatic replacement.
    -- Existing invalid lines remain visible for HR resolution.
    IF v_candidate_count<>1 OR v_candidate IS NULL THEN CONTINUE; END IF;
    IF v_existing_count=1 AND v_existing_manager=v_candidate THEN CONTINUE; END IF;

    IF v_existing_count=1 THEN
      UPDATE public.employee_reporting_lines rl
         SET status='Inactive',
             notes=concat_ws(' | ',nullif(rl.notes,''),
               '[BexHR] Primary superseded after approved hierarchy save; reporting history retained.'),
             updated_by=auth.uid()
       WHERE rl.id=v_existing_id AND rl.employee_id=v_child.id
         AND lower(btrim(coalesce(rl.status,'active')))='active';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BEXHR_PRIMARY_RECONCILIATION_CONCURRENT_CHANGE';
      END IF;
    END IF;

    INSERT INTO public.employee_reporting_lines
      (tenant_id,employee_id,manager_employee_id,manager_type,status,
       effective_date,notes,created_by,updated_by)
    VALUES (p_tenant_id,v_child.id,v_candidate,'Primary','Active',current_date,
      '[BexHR] Auto-assigned from uniquely eligible final hierarchy.',
      auth.uid(),auth.uid());
    v_count := v_count+1;
  END LOOP;
  RETURN v_count;
END;
$assign$;
REVOKE ALL ON FUNCTION bexhr_private.assign_unambiguous_primary_managers(uuid)
  FROM PUBLIC,anon,authenticated;

-- The original immediate hierarchy trigger ran during an incomplete graph.
-- A deferred constraint trigger uses the final validated transaction graph.
-- It works on first configuration, reconfiguration, and hierarchy deletes.
CREATE OR REPLACE FUNCTION bexhr_private.auto_primary_after_hierarchy_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $after$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  PERFORM bexhr_private.assign_unambiguous_primary_managers(v_tenant);
  RETURN NULL;
END;
$after$;
DROP TRIGGER IF EXISTS bexhr_auto_primary_after_hierarchy_change
  ON public.organization_job_title_hierarchy;
CREATE CONSTRAINT TRIGGER bexhr_auto_primary_after_hierarchy_change
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_job_title_hierarchy
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION bexhr_private.auto_primary_after_hierarchy_change();

-- Existing employee/profile change triggers still call this same function.
-- No blanket backfill here: do not silently reassign unrelated companies
-- on migration installation. Reconciliation runs on each future saved change.
