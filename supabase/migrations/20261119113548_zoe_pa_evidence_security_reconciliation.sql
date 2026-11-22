-- BexHR | ZOE | post-65 PA evidence security reconciliation (REVIEW CANDIDATE)
-- Source: verified Zoe SQL Editor operations 19 November 2026.
-- Scope: EXISTING ZOE SCHEMA ONLY, not a new baseline; does not recreate the historic 65 migrations.
-- Dual-state: if security bridge already complete, assert unchanged and NO-OP;
-- if exact verified PRE-BRIDGE Zoe schema exists, apply changes atomically.
-- Any unexpected partial/mixed schema aborts; existing evidence and Storage bytes are preserved.
-- Source artifacts: BexHR-ZOE-PA-RESERVATION-BRIDGE-REVIEW-2026-11-19.sql,
-- tenant-boundary policy (Zoe SQL editor), and STEP178 Storage INSERT cutover.
-- REVIEW ONLY until forward-chain sequencing and replay suitability are validated.
-- DO NOT run this file manually in production, and do not run STEP171 in Zoe.

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

DO $bexhr_zoe_post65$
DECLARE
  v_pre boolean;
  v_full boolean;
  v_old_rule text;
  v_rows_before bigint;
  v_objects_before bigint;
  v_trigger pg_trigger%ROWTYPE;
BEGIN
  IF to_regclass('public.pa_progress_evidence') IS NULL
     OR to_regclass('public.pa_progress_updates') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('public.current_authenticated_profile_tenant_id()') IS NULL
     OR to_regprocedure('public.pa_current_employee_id()') IS NULL
     OR to_regprocedure('bex_pa_private.validate_progress_evidence_manifest()') IS NULL
     OR (SELECT relrowsecurity FROM pg_class
         WHERE oid='public.pa_progress_evidence'::regclass) IS DISTINCT FROM TRUE
     OR (SELECT relrowsecurity FROM pg_class
         WHERE oid='storage.objects'::regclass) IS DISTINCT FROM TRUE
     OR (SELECT public FROM storage.buckets
         WHERE id='pa-progress-evidence') IS DISTINCT FROM FALSE
  THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_PREREQUISITES_DIFFER';
  END IF;

  SELECT * INTO v_trigger FROM pg_trigger
    WHERE tgrelid='public.pa_progress_evidence'::regclass
      AND tgname='bexhr_pa_evidence_manifest_guard'
      AND NOT tgisinternal;
  IF NOT FOUND OR v_trigger.tgtype <> 7
    OR v_trigger.tgfoid IS DISTINCT FROM
       to_regprocedure('bex_pa_private.validate_progress_evidence_manifest()')
  THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_MANIFEST_TRIGGER_DIFFER';
  END IF;

  -- REPLAY COMPLETE: make no changes to already-secured Zoe. Verify the
  -- complete bundle, never assume that merely finding status proves parity.
  SELECT
    to_regprocedure('public.bexhr_pa_evidence_finalize(uuid)') IS NOT NULL
    AND to_regprocedure('bex_pa_private.bexhr_pa_pending_delete_guard()') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid='public.pa_progress_evidence'::regclass
        AND tgname='bexhr_pa_pending_delete_guard'
        AND NOT tgisinternal)
    AND (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.pa_progress_evidence'::regclass
        AND attname IN ('status','expires_at','finalized_at')
        AND attnum>0 AND NOT attisdropped)=3
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='pa_progress_evidence')=4
    AND EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='pa_progress_evidence'
        AND policyname='bexhr_pa_evidence_tenant_boundary'
        AND cmd='ALL' AND permissive='RESTRICTIVE')
    AND EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='pa_progress_evidence'
        AND policyname='bexhr_pa_evidence_cancel_own_pending'
        AND cmd='DELETE')
    AND EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname='bexhr_pa_storage_delete_own_pending'
        AND cmd='DELETE')
    AND EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname='BexHR PA evidence employee uploads own active progress'
        AND cmd='INSERT' AND with_check LIKE '%expires_at%'
        AND with_check LIKE '%pending%'
        AND with_check LIKE '%storage_path%')
    AND NOT has_table_privilege('anon','public.pa_progress_evidence','SELECT')
    AND NOT has_function_privilege('anon',to_regprocedure('public.bexhr_pa_evidence_finalize(uuid)'),'EXECUTE')
    AND has_function_privilege('authenticated',to_regprocedure('public.bexhr_pa_evidence_finalize(uuid)'),'EXECUTE')
    AND NOT has_table_privilege('authenticated','public.pa_progress_evidence','UPDATE')
    AND has_table_privilege('authenticated','public.pa_progress_evidence','DELETE')
  INTO v_full;

  IF coalesce(v_full,false) THEN
    RAISE NOTICE 'ZOE_POST65_ALREADY_APPLIED_VERIFIED_NOOP';
    RETURN;
  END IF;

  -- PRE-BRIDGE: only the precisely observed original schema is eligible.
  SELECT
    (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.pa_progress_evidence'::regclass
        AND attnum>0 AND NOT attisdropped)=12
    AND (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.pa_progress_evidence'::regclass
        AND attname IN ('status','expires_at','finalized_at')
        AND attnum>0 AND NOT attisdropped)=0
    AND to_regprocedure('public.bexhr_pa_evidence_finalize(uuid)') IS NULL
    AND to_regprocedure('bex_pa_private.bexhr_pa_pending_delete_guard()') IS NULL
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='pa_progress_evidence')=2
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='pa_progress_evidence'
        AND policyname IN (
          'BexHR PA employee registers own active progress evidence',
          'BexHR PA evidence read via authorised progress'))=2
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND cmd IN ('INSERT','ALL'))=3
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND cmd IN ('INSERT','ALL') AND cmd='INSERT'
        AND roles=ARRAY['authenticated']::name[]
        AND policyname IN (
          'Authenticated users can upload profile images',
          'HR can upload employee documents to storage',
          'BexHR PA evidence employee uploads own active progress'))=3
    AND NOT has_table_privilege('anon','public.pa_progress_evidence','SELECT')
    AND NOT has_table_privilege('authenticated','public.pa_progress_evidence','UPDATE')
  INTO v_pre;
  IF NOT coalesce(v_pre,false) THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_UNRECOGNISED_PARTIAL_STATE';
  END IF;

  SELECT with_check INTO v_old_rule FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='BexHR PA evidence employee uploads own active progress'
      AND cmd='INSERT';
  IF v_old_rule IS NULL
     OR position('pa-progress-evidence' IN v_old_rule)=0
     OR position('owner_id' IN v_old_rule)=0
     OR position('pa_progress_updates' IN v_old_rule)=0
     OR position('expires_at' IN v_old_rule)>0
  THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_STORAGE_POLICY_DIFFER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pa_progress_evidence e
    LEFT JOIN storage.objects o
      ON o.bucket_id='pa-progress-evidence' AND o.name=e.storage_path
    WHERE o.id IS NULL OR o.owner_id IS DISTINCT FROM e.uploaded_by::text
  ) THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_EXISTING_EVIDENCE_MISMATCH';
  END IF;

  SELECT count(*) INTO v_rows_before FROM public.pa_progress_evidence;
  SELECT count(*) INTO v_objects_before FROM storage.objects
    WHERE bucket_id='pa-progress-evidence';

  EXECUTE $bexhr_tenant$
    CREATE POLICY bexhr_pa_evidence_tenant_boundary
    ON public.pa_progress_evidence AS RESTRICTIVE FOR ALL TO authenticated
    USING (auth.uid() IS NOT NULL
      AND tenant_id=public.current_authenticated_profile_tenant_id())
    WITH CHECK (auth.uid() IS NOT NULL
      AND tenant_id=public.current_authenticated_profile_tenant_id()
      AND employee_id=public.pa_current_employee_id()
      AND uploaded_by=auth.uid())
  $bexhr_tenant$;

  -- Zoe approved bridge DDL 1.
  EXECUTE $bexhr_sql_1$
ALTER TABLE public.pa_progress_evidence
  ADD COLUMN status text NOT NULL DEFAULT 'ready',
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN finalized_at timestamptz
  $bexhr_sql_1$;

  -- Zoe approved bridge DDL 2.
  EXECUTE $bexhr_sql_2$
ALTER TABLE public.pa_progress_evidence
  ALTER COLUMN status SET DEFAULT 'pending'
  $bexhr_sql_2$;

  -- Zoe approved bridge DDL 3.
  EXECUTE $bexhr_sql_3$
ALTER TABLE public.pa_progress_evidence
  ADD CONSTRAINT bexhr_pa_evidence_lifecycle_check CHECK (
    (status='pending' AND expires_at IS NOT NULL AND finalized_at IS NULL)
    OR (status='ready' AND expires_at IS NULL)
  )
  $bexhr_sql_3$;

  -- Zoe approved bridge DDL 4.
  EXECUTE $bexhr_sql_4$
-- Existing guard is BEFORE INSERT only (verified above). Replace its body
-- without dropping the trigger. For legacy clients the object already exists;
-- for reservation-first clients the file will be uploaded afterward.
CREATE OR REPLACE FUNCTION bex_pa_private.validate_progress_evidence_manifest()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $bexhr_guard$
DECLARE
  v_owner text;
  v_found boolean := false;
BEGIN
  IF TG_OP <> 'INSERT'
     OR auth.uid() IS NULL
     OR NEW.uploaded_by IS DISTINCT FROM auth.uid()
     OR NEW.tenant_id IS DISTINCT FROM public.current_authenticated_profile_tenant_id()
     OR NEW.employee_id IS DISTINCT FROM public.pa_current_employee_id()
  THEN
    RAISE EXCEPTION 'PA evidence registration denied'
      USING ERRCODE='42501';
  END IF;

  SELECT o.owner_id INTO v_owner
  FROM storage.objects o
  WHERE o.bucket_id='pa-progress-evidence'
    AND o.name=NEW.storage_path;
  v_found := FOUND;
  IF v_found AND v_owner IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'PA evidence Storage owner mismatch'
      USING ERRCODE='42501';
  END IF;

  NEW.created_at := now();
  IF v_found THEN
    -- Legacy upload-first flow: file owner verified, record is ready.
    NEW.status := 'ready';
    NEW.expires_at := NULL;
    NEW.finalized_at := now();
  ELSE
    -- New flow: reserve before uploading the object.
    NEW.status := 'pending';
    NEW.expires_at := now() + interval '30 minutes';
    NEW.finalized_at := NULL;
  END IF;
  RETURN NEW;
END;
$bexhr_guard$
  $bexhr_sql_4$;

  -- Zoe approved bridge DDL 5.
  EXECUTE $bexhr_sql_5$
REVOKE ALL ON FUNCTION bex_pa_private.validate_progress_evidence_manifest()
  FROM PUBLIC, anon, authenticated
  $bexhr_sql_5$;

  -- Zoe approved bridge DDL 6.
  EXECUTE $bexhr_sql_6$
-- Browser has no direct UPDATE privilege. The definer verifies actual Storage
-- object owner, MIME and size, then finalizes the reserved slot atomically.
CREATE FUNCTION public.bexhr_pa_evidence_finalize(p_evidence_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $bexhr_finalize$
DECLARE
  v public.pa_progress_evidence%ROWTYPE;
  v_meta jsonb;
  v_owner text;
BEGIN
  IF auth.uid() IS NULL OR p_evidence_id IS NULL THEN
    RAISE EXCEPTION 'PA evidence finalize denied' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v FROM public.pa_progress_evidence
  WHERE id=p_evidence_id FOR UPDATE;
  IF NOT FOUND
     OR v.status <> 'pending'
     OR v.expires_at IS NULL OR v.expires_at <= now()
     OR v.uploaded_by IS DISTINCT FROM auth.uid()
     OR v.tenant_id IS DISTINCT FROM public.current_authenticated_profile_tenant_id()
     OR v.employee_id IS DISTINCT FROM public.pa_current_employee_id()
  THEN
    RAISE EXCEPTION 'PA evidence reservation expired or forbidden'
      USING ERRCODE='42501';
  END IF;

  -- Recheck the active goal/cycle at finalization, not only reservation.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pa_progress_updates pu
    JOIN public.pa_individual_goals g
      ON g.id=pu.individual_goal_id AND g.tenant_id=pu.tenant_id
       AND g.employee_id=pu.employee_id
    JOIN public.pa_cycles c
      ON c.id=g.cycle_id AND c.tenant_id=g.tenant_id
    WHERE pu.id=v.progress_update_id AND pu.tenant_id=v.tenant_id
      AND pu.employee_id=v.employee_id
      AND pu.individual_goal_id=v.individual_goal_id
      AND lower(btrim(c.status))='active'
      AND NOT EXISTS (
        SELECT 1 FROM public.pa_employee_appraisals a
        JOIN public.pa_hr_finalisations h
          ON h.appraisal_id=a.id AND h.tenant_id=a.tenant_id
        WHERE a.tenant_id=pu.tenant_id AND a.employee_id=pu.employee_id
          AND a.cycle_id=g.cycle_id
          AND lower(btrim(h.status))='finalised'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pa_employee_appraisals a
        JOIN public.pa_employee_acknowledgements ack
          ON ack.appraisal_id=a.id AND ack.tenant_id=a.tenant_id
        WHERE a.tenant_id=pu.tenant_id AND a.employee_id=pu.employee_id
          AND a.cycle_id=g.cycle_id
          AND lower(btrim(ack.status))='acknowledged'
      )
  ) THEN
    RAISE EXCEPTION 'PA evidence parent, active cycle or finalization mismatch'
      USING ERRCODE='23514';
  END IF;

  SELECT o.owner_id, o.metadata INTO v_owner, v_meta
  FROM storage.objects o
  WHERE o.bucket_id='pa-progress-evidence' AND o.name=v.storage_path;
  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid()::text
     OR v_meta->>'mimetype' IS DISTINCT FROM v.content_type
     OR coalesce(v_meta->>'size','') !~ '^[0-9]{1,9}$'
     OR (v_meta->>'size')::bigint IS DISTINCT FROM v.size_bytes
  THEN
    RAISE EXCEPTION 'PA evidence Storage MIME, size or owner mismatch'
      USING ERRCODE='23514';
  END IF;

  UPDATE public.pa_progress_evidence
  SET status='ready', expires_at=NULL, finalized_at=now()
  WHERE id=p_evidence_id;
  RETURN TRUE;
END;
$bexhr_finalize$
  $bexhr_sql_6$;

  -- Zoe approved bridge DDL 7.
  EXECUTE $bexhr_sql_7$
REVOKE ALL ON FUNCTION public.bexhr_pa_evidence_finalize(uuid)
  FROM PUBLIC, anon
  $bexhr_sql_7$;

  -- Zoe approved bridge DDL 8.
  EXECUTE $bexhr_sql_8$
GRANT EXECUTE ON FUNCTION public.bexhr_pa_evidence_finalize(uuid)
  TO authenticated
  $bexhr_sql_8$;

  -- Zoe approved bridge DDL 9.
  EXECUTE $bexhr_sql_9$
-- Allow cleanup only for the caller's unfinalized reservations. Never delete
-- Storage metadata using SQL; clients must call the Storage API first.
CREATE FUNCTION bex_pa_private.bexhr_pa_pending_delete_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $bexhr_del$
BEGIN
  IF OLD.status <> 'pending' OR EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id='pa-progress-evidence' AND o.name=OLD.storage_path
  ) THEN
    RAISE EXCEPTION 'PA evidence: delete Storage object first or record is ready'
      USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END;
$bexhr_del$
  $bexhr_sql_9$;

  -- Zoe approved bridge DDL 10.
  EXECUTE $bexhr_sql_10$
REVOKE ALL ON FUNCTION bex_pa_private.bexhr_pa_pending_delete_guard()
  FROM PUBLIC, anon, authenticated
  $bexhr_sql_10$;

  -- Zoe approved bridge DDL 11.
  EXECUTE $bexhr_sql_11$
CREATE TRIGGER bexhr_pa_pending_delete_guard
BEFORE DELETE ON public.pa_progress_evidence
FOR EACH ROW EXECUTE FUNCTION bex_pa_private.bexhr_pa_pending_delete_guard()
  $bexhr_sql_11$;

  -- Zoe approved bridge DDL 12.
  EXECUTE $bexhr_sql_12$
GRANT DELETE ON public.pa_progress_evidence TO authenticated
  $bexhr_sql_12$;

  -- Zoe approved bridge DDL 13.
  EXECUTE $bexhr_sql_13$
CREATE POLICY bexhr_pa_evidence_cancel_own_pending
ON public.pa_progress_evidence FOR DELETE TO authenticated
USING (
  status='pending' AND uploaded_by=auth.uid()
  AND employee_id=public.pa_current_employee_id()
  AND tenant_id=public.current_authenticated_profile_tenant_id()
)
  $bexhr_sql_13$;

  -- Zoe approved bridge DDL 14.
  EXECUTE $bexhr_sql_14$
CREATE POLICY bexhr_pa_storage_delete_own_pending
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='pa-progress-evidence'
  AND owner_id=auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.pa_progress_evidence e
    WHERE e.storage_path=name AND e.status='pending'
      AND e.uploaded_by=auth.uid()
      AND e.employee_id=public.pa_current_employee_id()
      AND e.tenant_id=public.current_authenticated_profile_tenant_id()
  )
)
  $bexhr_sql_14$;

  -- Tighten the verified original Storage INSERT policy: preserve every
  -- prior predicate and add the reservation requirement (STEP178).
  EXECUTE format(
    $bexhr_storage_cutover$
    ALTER POLICY %I ON storage.objects WITH CHECK (
      (%s)
      AND EXISTS (
        SELECT 1 FROM public.pa_progress_evidence e
        WHERE e.storage_path=objects.name
          AND e.status='pending' AND e.expires_at>now()
          AND e.uploaded_by=auth.uid()
          AND e.tenant_id=public.current_authenticated_profile_tenant_id()
          AND e.employee_id=public.pa_current_employee_id()
      )
    )
    $bexhr_storage_cutover$,
    'BexHR PA evidence employee uploads own active progress',
    v_old_rule
  );

  IF (SELECT count(*) FROM public.pa_progress_evidence) <> v_rows_before
     OR (SELECT count(*) FROM storage.objects
         WHERE bucket_id='pa-progress-evidence') <> v_objects_before
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname='public'
           AND tablename='pa_progress_evidence')<>4
     OR to_regprocedure('public.bexhr_pa_evidence_finalize(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies
         WHERE schemaname='storage' AND tablename='objects'
           AND policyname='BexHR PA evidence employee uploads own active progress'
           AND with_check LIKE '%expires_at%'
           AND with_check LIKE '%storage_path%')
  THEN
    RAISE EXCEPTION 'STOP|ZOE_POST65_REPLAY_VERIFICATION_FAILED';
  END IF;
  RAISE NOTICE 'ZOE_POST65_SECURITY_APPLIED_AND_DATA_PRESERVED';
END;
$bexhr_zoe_post65$;
COMMIT;
