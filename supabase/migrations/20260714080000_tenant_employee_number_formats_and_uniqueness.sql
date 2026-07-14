-- =============================================================
-- SYSTEM-WIDE TENANT EMPLOYEE NUMBER UPGRADE
-- =============================================================
-- Supports:
-- 1. Organisation-specific employee-number formats.
-- 2. Serial and concurrency-safe automatic generation.
-- 3. Manual employee numbers.
-- 4. Counter advancement when a matching manual number is entered.
-- 5. Duplicate protection within each organisation.
-- 6. The same employee number being used by different organisations.
--
-- Confirmed Alpatech format:
-- AENL/0001, AENL/0002, ... AENL/1001
--
-- Existing gaps are intentionally not reused.
-- =============================================================
-- =============================================================
-- STEP 1
-- Extend the existing per-company sequence table so every
-- organisation can have its own prefix, separator and padding.
-- =============================================================
ALTER TABLE
  public.company_employee_sequences
ALTER COLUMN
  last_number TYPE BIGINT;

ALTER TABLE
  public.company_employee_sequences
ADD
  COLUMN IF NOT EXISTS number_prefix TEXT NOT NULL DEFAULT 'P',
ADD
  COLUMN IF NOT EXISTS number_separator TEXT NOT NULL DEFAULT '',
ADD
  COLUMN IF NOT EXISTS number_padding INTEGER NOT NULL DEFAULT 0;

-- Add a safe padding constraint without duplicating it if this
-- migration is inspected or reapplied in a repair environment.
DO $ $ BEGIN IF NOT EXISTS (
  SELECT
    1
  FROM
    pg_constraint
  WHERE
    conname = 'company_employee_sequences_number_padding_check'
    AND conrelid = 'public.company_employee_sequences' :: regclass
) THEN
ALTER TABLE
  public.company_employee_sequences
ADD
  CONSTRAINT company_employee_sequences_number_padding_check CHECK (
    number_padding BETWEEN 0
    AND 20
  );

END IF;

END;

$ $;

COMMENT ON COLUMN public.company_employee_sequences.number_prefix IS 'Organisation-controlled text placed before the serial number, for example P or AENL.';

COMMENT ON COLUMN public.company_employee_sequences.number_separator IS 'Optional separator placed between the prefix and serial number, for example / or -.';

COMMENT ON COLUMN public.company_employee_sequences.number_padding IS 'Minimum serial-number width. For example, padding 4 formats 1 as 0001.';

-- =============================================================
-- STEP 2
-- Synchronise normal P-number organisations with their highest
-- existing P serial.
--
-- This does not change organisations already using a separately
-- configured custom format.
-- =============================================================
WITH tenant_p_maximums AS (
  SELECT
    e.tenant_id,
    MAX(
      SUBSTRING(
        UPPER(BTRIM(e.employee_number))
        FROM
          '^P([0-9]+)$'
      ) :: BIGINT
    ) AS highest_number
  FROM
    public.employees e
  WHERE
    e.tenant_id IS NOT NULL
    AND UPPER(BTRIM(COALESCE(e.employee_number, ''))) ~ '^P[0-9]+$'
  GROUP BY
    e.tenant_id
)
INSERT INTO
  public.company_employee_sequences (
    tenant_id,
    last_number,
    number_prefix,
    number_separator,
    number_padding,
    updated_at
  )
SELECT
  tenant_id,
  highest_number,
  'P',
  '',
  0,
  NOW()
FROM
  tenant_p_maximums ON CONFLICT (tenant_id) DO
UPDATE
SET
  last_number = GREATEST(
    public.company_employee_sequences.last_number,
    EXCLUDED.last_number
  ),
  updated_at = NOW()
WHERE
  public.company_employee_sequences.number_prefix = 'P'
  AND public.company_employee_sequences.number_separator = ''
  AND public.company_employee_sequences.number_padding = 0;

-- =============================================================
-- STEP 3
-- Configure Alpatech using its confirmed real-world format.
--
-- Existing highest Employee ID:
-- AENL/1001
--
-- Therefore the next automatically generated Employee ID will be:
-- AENL/1002
-- =============================================================
WITH alpatech_sequence AS (
  SELECT
    t.id AS tenant_id,
    COALESCE(
      MAX(
        SUBSTRING(
          UPPER(BTRIM(e.employee_number))
          FROM
            '^AENL/([0-9]+)$'
        ) :: BIGINT
      ) FILTER (
        WHERE
          UPPER(BTRIM(COALESCE(e.employee_number, ''))) ~ '^AENL/[0-9]+$'
      ),
      0
    ) AS highest_number
  FROM
    public.tenants t
    LEFT JOIN public.employees e ON e.tenant_id = t.id
  WHERE
    UPPER(BTRIM(COALESCE(t.tenant_code, ''))) = 'ALP'
    OR LOWER(BTRIM(COALESCE(t.company_name, ''))) LIKE '%alpatech%'
  GROUP BY
    t.id
)
INSERT INTO
  public.company_employee_sequences (
    tenant_id,
    last_number,
    number_prefix,
    number_separator,
    number_padding,
    updated_at
  )
SELECT
  tenant_id,
  highest_number,
  'AENL',
  '/',
  4,
  NOW()
FROM
  alpatech_sequence ON CONFLICT (tenant_id) DO
UPDATE
SET
  last_number = GREATEST(
    public.company_employee_sequences.last_number,
    EXCLUDED.last_number
  ),
  number_prefix = EXCLUDED.number_prefix,
  number_separator = EXCLUDED.number_separator,
  number_padding = EXCLUDED.number_padding,
  updated_at = NOW();

-- =============================================================
-- STEP 4
-- Replace the global Employee Number uniqueness rule.
--
-- Old behaviour:
-- A number used by Company A could block Company B.
--
-- New behaviour:
-- Same organisation + same normalised Employee Number = blocked.
-- Different organisations + same Employee Number = allowed.
--
-- Spaces and letter casing are ignored:
-- AENL/0001, aenl/0001 and " AENL/0001 " are duplicates.
-- =============================================================
DROP INDEX IF EXISTS public.uq_employees_employee_number_normalised;

DROP INDEX IF EXISTS public.uq_employees_tenant_employee_number_normalised;

CREATE UNIQUE INDEX uq_employees_tenant_employee_number_normalised ON public.employees (
  COALESCE(
    tenant_id,
    '00000000-0000-0000-0000-000000000000' :: UUID
  ),
  UPPER(BTRIM(employee_number))
)
WHERE
  NULLIF(BTRIM(employee_number), '') IS NOT NULL;

-- =============================================================
-- STEP 5
-- Replace the automatic generator.
--
-- It reads the current organisation's saved format rather than
-- always returning P1, P2, P3.
--
-- The sequence row is locked during generation so simultaneous
-- HR users cannot receive the same number.
--
-- Existing numbers are checked before returning a candidate.
-- =============================================================
CREATE
OR REPLACE FUNCTION public.get_next_employee_number(p_tenant_id UUID) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $ $ DECLARE v_caller_tenant_id UUID;

v_next_number BIGINT;

v_number_prefix TEXT;

v_number_separator TEXT;

v_number_padding INTEGER;

v_candidate TEXT;

BEGIN IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'get_next_employee_number: p_tenant_id must not be NULL';

END IF;

-- EMPLOYEE NUMBER TENANT SECURITY - STEP 1
-- Resolve the signed-in user's company from the authenticated profile.
SELECT
  p.tenant_id INTO v_caller_tenant_id
FROM
  public.profiles p
WHERE
  p.id = auth.uid();

-- A user may generate numbers only for their own company.
-- This prevents one authenticated tenant from advancing or reading
-- another tenant's Employee Number sequence.
IF auth.uid() IS NULL
OR v_caller_tenant_id IS NULL
OR v_caller_tenant_id IS DISTINCT
FROM
  p_tenant_id THEN RAISE EXCEPTION 'get_next_employee_number: tenant access denied' USING ERRCODE = '42501';

END IF;

-- Create a default P-number configuration for a new organisation
-- that has not yet received a custom format.
INSERT INTO
  public.company_employee_sequences (
    tenant_id,
    last_number,
    number_prefix,
    number_separator,
    number_padding,
    updated_at
  )
VALUES
  (
    p_tenant_id,
    0,
    'P',
    '',
    0,
    NOW()
  ) ON CONFLICT (tenant_id) DO NOTHING;

-- Lock this organisation's sequence until one unique number has
-- been selected and its counter has been updated.
SELECT
  last_number,
  number_prefix,
  number_separator,
  number_padding INTO v_next_number,
  v_number_prefix,
  v_number_separator,
  v_number_padding
FROM
  public.company_employee_sequences
WHERE
  tenant_id = p_tenant_id FOR
UPDATE
;

LOOP v_next_number := v_next_number + 1;

v_candidate := COALESCE(v_number_prefix, '') || COALESCE(v_number_separator, '') || CASE
  WHEN COALESCE(v_number_padding, 0) > 0 THEN LPAD(
    v_next_number :: TEXT,
    GREATEST(
      v_number_padding,
      CHAR_LENGTH(v_next_number :: TEXT)
    ),
    '0'
  )
  ELSE v_next_number :: TEXT
END;

-- Never return an Employee Number already used inside this
-- organisation, even if an older counter was behind.
EXIT
WHEN NOT EXISTS (
  SELECT
    1
  FROM
    public.employees e
  WHERE
    e.tenant_id = p_tenant_id
    AND UPPER(BTRIM(COALESCE(e.employee_number, ''))) = UPPER(BTRIM(v_candidate))
);

END LOOP;

UPDATE
  public.company_employee_sequences
SET
  last_number = v_next_number,
  updated_at = NOW()
WHERE
  tenant_id = p_tenant_id;

RETURN v_candidate;

END;

$ $;

COMMENT ON FUNCTION public.get_next_employee_number(UUID) IS 'Generates the next serial Employee Number using the current organisation format. It is tenant-scoped, concurrency-safe and skips existing numbers.';

-- EMPLOYEE NUMBER TENANT SECURITY - STEP 2
-- PostgreSQL functions can inherit PUBLIC execution privileges by default.
-- Remove that broad permission, then allow signed-in users only.
REVOKE ALL ON FUNCTION public.get_next_employee_number(UUID)
FROM
  PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_next_employee_number(UUID) TO authenticated;

-- =============================================================
-- STEP 6
-- Keep the automatic counter aligned with valid manually entered
-- Employee Numbers.
--
-- Example:
-- Current Alpatech counter: AENL/1001
-- HR manually enters:       AENL/1200
-- Next automatic number:    AENL/1201
--
-- A manual number using a different format remains valid, but it
-- does not incorrectly alter the configured automatic sequence.
-- =============================================================
CREATE
OR REPLACE FUNCTION public.sync_company_employee_sequence_from_employee_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $ $ DECLARE v_clean_employee_number TEXT;

v_number_prefix TEXT;

v_number_separator TEXT;

v_expected_start TEXT;

v_numeric_part TEXT;

v_manual_number BIGINT;

BEGIN IF NEW.tenant_id IS NULL
OR NULLIF(BTRIM(COALESCE(NEW.employee_number, '')), '') IS NULL THEN RETURN NEW;

END IF;

-- Ensure the organisation has a sequence configuration.
INSERT INTO
  public.company_employee_sequences (
    tenant_id,
    last_number,
    number_prefix,
    number_separator,
    number_padding,
    updated_at
  )
VALUES
  (
    NEW.tenant_id,
    0,
    'P',
    '',
    0,
    NOW()
  ) ON CONFLICT (tenant_id) DO NOTHING;

SELECT
  number_prefix,
  number_separator INTO v_number_prefix,
  v_number_separator
FROM
  public.company_employee_sequences
WHERE
  tenant_id = NEW.tenant_id FOR
UPDATE
;

v_clean_employee_number := BTRIM(NEW.employee_number);

v_expected_start := COALESCE(v_number_prefix, '') || COALESCE(v_number_separator, '');

-- Only advance the serial counter when the manual number matches
-- the organisation's configured automatic format.
IF UPPER(
  LEFT(
    v_clean_employee_number,
    CHAR_LENGTH(v_expected_start)
  )
) = UPPER(v_expected_start) THEN v_numeric_part := SUBSTRING(
  v_clean_employee_number
  FROM
    CHAR_LENGTH(v_expected_start) + 1
);

IF v_numeric_part ~ '^[0-9]+$' THEN v_manual_number := v_numeric_part :: BIGINT;

UPDATE
  public.company_employee_sequences
SET
  last_number = GREATEST(last_number, v_manual_number),
  updated_at = NOW()
WHERE
  tenant_id = NEW.tenant_id;

END IF;

END IF;

RETURN NEW;

END;

$ $;

DROP TRIGGER IF EXISTS trg_sync_company_employee_sequence_from_employee_number ON public.employees;

CREATE TRIGGER trg_sync_company_employee_sequence_from_employee_number
AFTER
INSERT
  OR
UPDATE
  OF tenant_id,
  employee_number ON public.employees FOR EACH ROW EXECUTE FUNCTION public.sync_company_employee_sequence_from_employee_number();

COMMENT ON FUNCTION public.sync_company_employee_sequence_from_employee_number() IS 'Moves an organisation employee-number counter forward when HR manually saves a higher number that matches the configured format.';