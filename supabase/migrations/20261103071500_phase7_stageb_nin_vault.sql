-- BexHR Phase 7 Security Stage B: move NIN out of general employee rows.
-- PRODUCTION WRITE. Run only after current frontend files are patched/deployed.
-- All changes are one transaction; error aborts before COMMIT.
-- This does not modify hierarchy, PA, leave, payroll, Staff Level, or Stage A.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

DO $guard$
BEGIN
  IF to_regclass('public.employees') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regnamespace('bexhr_private') IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: expected Phase 7 schema is absent';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='employees' AND column_name='nin'
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: employees.nin is absent';
  END IF;
  IF to_regclass('bexhr_private.employee_nin_values') IS NOT NULL
     OR to_regprocedure('public.bexhr_p7_nin_read_for_hr(uuid)') IS NOT NULL
     OR to_regprocedure('public.bexhr_p7_nin_last4_for_self()') IS NOT NULL
     OR to_regprocedure('bexhr_private.bexhr_p7_nin_capture()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid='public.employees'::regclass
         AND tgname='bexhr_p7_nin_capture_write'
     ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: Stage B objects already exist; do not re-run';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE nin IS NOT NULL AND btrim(nin) <> ''
      AND (nin !~ '^[0-9]{11}$' OR tenant_id IS NULL OR id IS NULL)
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: invalid or unscoped legacy NIN detected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='employees'
      AND c.relrowsecurity IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: employee RLS must be enabled';
  END IF;
END;
$guard$;

-- Disallow concurrent employee writes across the short transfer window.
LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE;

-- V2: original count is validated against vault immediately after the copy.

-- No SELECT/INSERT/UPDATE/DELETE grants to browser database roles.
-- The schema is not exposed in the Supabase Data API.
CREATE TABLE bexhr_private.employee_nin_values (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employees(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  tenant_id uuid NOT NULL,
  nin text NOT NULL CHECK (nin ~ '^[0-9]{11}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bexhr_p7_nin_tenant_unique UNIQUE (tenant_id, nin)
);
ALTER TABLE bexhr_private.employee_nin_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bexhr_private.employee_nin_values FROM PUBLIC, anon, authenticated;

INSERT INTO bexhr_private.employee_nin_values (employee_id, tenant_id, nin)
SELECT id, tenant_id, btrim(nin)
FROM public.employees
WHERE nin IS NOT NULL AND btrim(nin) <> '';

-- V2: verify the copied source count before erasing the public column.
-- Avoids session-dependent temporary tables that failed in the SQL Editor.
DO $verify_copy$
DECLARE
  v_public_count bigint;
  v_private_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_public_count
  FROM public.employees WHERE nin IS NOT NULL AND btrim(nin) <> '';

  SELECT COUNT(*) INTO v_private_count
  FROM bexhr_private.employee_nin_values;

  IF v_private_count IS DISTINCT FROM v_public_count THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: copied NIN count % differs from source %',
      v_private_count, v_public_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM bexhr_private.employee_nin_values n
    JOIN public.employees e ON e.id = n.employee_id
    WHERE e.tenant_id IS DISTINCT FROM n.tenant_id
       OR btrim(e.nin) IS DISTINCT FROM n.nin
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: copied NIN or tenant mismatch';
  END IF;
END;
$verify_copy$;

-- This UPDATE can refresh employees.updated_at via existing application triggers.
-- Only employees.nin is deliberately changed in the employee row.
UPDATE public.employees SET nin = NULL WHERE nin IS NOT NULL;

-- The legacy unique index stays in place; protected-table uniqueness is now authoritative.
-- A deferred FK allows the secure BEFORE INSERT trigger to move NIN before
-- the parent employee row has been fully inserted.
CREATE FUNCTION bexhr_private.bexhr_p7_nin_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_nin text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND EXISTS (
       SELECT 1 FROM bexhr_private.employee_nin_values n
       WHERE n.employee_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_TENANT_MOVE_BLOCKED: protected NIN requires a controlled transfer'
      USING ERRCODE='42501';
  END IF;

  v_nin := btrim(coalesce(NEW.nin, ''));
  -- A null/blank legacy payload means 'leave protected NIN as-is'.
  IF v_nin <> '' THEN
    IF v_nin !~ '^[0-9]{11}$'
       OR NEW.id IS NULL OR NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'BEXHR_P7_NIN_INVALID: NIN must be exactly eleven digits with a tenant'
        USING ERRCODE='22023';
    END IF;
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id=auth.uid()
        AND p.is_active IS TRUE
        AND p.tenant_id=NEW.tenant_id
        AND lower(btrim(coalesce(p.role,''))) IN ('hr','hr_manager')
    ) THEN
      RAISE EXCEPTION 'BEXHR_P7_NIN_FORBIDDEN: only active HR of the same company may write NIN'
        USING ERRCODE='42501';
    END IF;
    INSERT INTO bexhr_private.employee_nin_values (employee_id, tenant_id, nin)
    VALUES (NEW.id, NEW.tenant_id, v_nin)
    ON CONFLICT (employee_id) DO UPDATE
      SET nin=EXCLUDED.nin,
          tenant_id=EXCLUDED.tenant_id,
          updated_at=now();
  END IF;
  -- A general SELECT of employees (even SELECT *) never returns raw NIN.
  NEW.nin := NULL;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION bexhr_private.bexhr_p7_nin_capture() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bexhr_p7_nin_capture_write
BEFORE INSERT OR UPDATE OF nin, tenant_id ON public.employees
FOR EACH ROW EXECUTE FUNCTION bexhr_private.bexhr_p7_nin_capture();

-- HR-only controlled raw NIN read, with active profile and exact tenant match.
CREATE FUNCTION public.bexhr_p7_nin_read_for_hr(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_nin text;
BEGIN
  IF auth.uid() IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_FORBIDDEN: active HR login required'
      USING ERRCODE='42501';
  END IF;
  SELECT e.tenant_id INTO v_tenant_id
  FROM public.employees e
  JOIN public.profiles p ON p.id=auth.uid()
  WHERE e.id=p_employee_id
    AND p.is_active IS TRUE
    AND e.tenant_id IS NOT NULL
    AND p.tenant_id=e.tenant_id
    AND lower(btrim(coalesce(p.role,''))) IN ('hr','hr_manager');
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_FORBIDDEN: employee is outside HR tenant'
      USING ERRCODE='42501';
  END IF;
  SELECT n.nin INTO v_nin
  FROM bexhr_private.employee_nin_values n
  WHERE n.employee_id=p_employee_id AND n.tenant_id=v_tenant_id;
  RETURN v_nin;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bexhr_p7_nin_read_for_hr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bexhr_p7_nin_read_for_hr(uuid) TO authenticated;

-- Employees get only their own last four digits, never the eleven-digit value.
CREATE FUNCTION public.bexhr_p7_nin_last4_for_self()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT right(n.nin,4)
  FROM bexhr_private.employee_nin_values n
  JOIN public.employees e ON e.id=n.employee_id
      AND e.tenant_id=n.tenant_id
  JOIN public.profiles p ON p.id=auth.uid()
      AND p.tenant_id=e.tenant_id
      AND p.is_active IS TRUE
  WHERE auth.uid() IS NOT NULL
    AND e.user_id=auth.uid()
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.bexhr_p7_nin_last4_for_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bexhr_p7_nin_last4_for_self() TO authenticated;

-- Fail closed and rollback the full transaction if a cutover invariant fails.
DO $verify$
BEGIN
  -- V2: vault/source transfer count verified before clearing employees.nin.
  IF EXISTS (SELECT 1 FROM public.employees WHERE nin IS NOT NULL) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: raw NIN remains in general employees rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bexhr_private.employee_nin_values n
    LEFT JOIN public.employees e ON e.id=n.employee_id
    WHERE e.id IS NULL OR e.tenant_id IS DISTINCT FROM n.tenant_id
  ) THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: employee or tenant mismatch in protected NIN storage';
  END IF;
  IF has_table_privilege('authenticated',
       'bexhr_private.employee_nin_values','SELECT') THEN
    RAISE EXCEPTION 'BEXHR_P7_NIN_STOP: authenticated may select private NIN table';
  END IF;
END;
$verify$;
COMMIT;
