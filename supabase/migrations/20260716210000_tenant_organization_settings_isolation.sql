-- ============================================================
-- BEXHR TENANT ORGANIZATION SETTINGS ISOLATION
-- ============================================================
-- Converts organization_settings from one global singleton row
-- into one tenant-owned singleton row per company.
--
-- Current live legacy state:
-- - exactly one row;
-- - organization_name identifies Alpatech;
-- - no tenant_id column;
-- - global UNIQUE(singleton_key);
-- - RLS permits every HR user to read/update the same row.
--
-- Safety:
-- - the migration refuses to guess when the legacy row or
--   Alpatech tenant cannot be identified uniquely;
-- - no cross-tenant copy is created;
-- - one row per tenant is enforced by a unique index;
-- - RLS checks both role and the signed-in profile tenant_id.
-- ============================================================

BEGIN;

ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS tenant_id UUID;

DO $$
DECLARE
  v_unowned_count INTEGER;
  v_non_alpatech_unowned_count INTEGER;
  v_alpatech_tenant_count INTEGER;
  v_alpatech_tenant_id UUID;
BEGIN
  SELECT COUNT(*)
  INTO v_unowned_count
  FROM public.organization_settings
  WHERE tenant_id IS NULL;

  IF v_unowned_count > 0 THEN
    SELECT COUNT(*)
    INTO v_non_alpatech_unowned_count
    FROM public.organization_settings
    WHERE tenant_id IS NULL
      AND LOWER(COALESCE(organization_name, '')) NOT LIKE '%alpatech%';

    IF v_unowned_count <> 1 OR v_non_alpatech_unowned_count <> 0 THEN
      RAISE EXCEPTION
        'Tenant isolation stopped: expected exactly one unowned Alpatech organization_settings row, found % unowned row(s) and % non-Alpatech unowned row(s).',
        v_unowned_count,
        v_non_alpatech_unowned_count;
    END IF;

    SELECT COUNT(*)
    INTO v_alpatech_tenant_count
    FROM public.tenants
    WHERE LOWER(COALESCE(company_name, '')) LIKE '%alpatech%'
       OR LOWER(COALESCE(tenant_code, '')) LIKE '%alpatech%';

    IF v_alpatech_tenant_count <> 1 THEN
      RAISE EXCEPTION
        'Tenant isolation stopped: expected exactly one Alpatech tenant, found %.',
        v_alpatech_tenant_count;
    END IF;

    SELECT id
    INTO v_alpatech_tenant_id
    FROM public.tenants
    WHERE LOWER(COALESCE(company_name, '')) LIKE '%alpatech%'
       OR LOWER(COALESCE(tenant_code, '')) LIKE '%alpatech%'
    LIMIT 1;

    IF v_alpatech_tenant_id IS NULL THEN
      RAISE EXCEPTION
        'Tenant isolation stopped: the Alpatech tenant ID could not be resolved.';
    END IF;

    UPDATE public.organization_settings
    SET tenant_id = v_alpatech_tenant_id
    WHERE tenant_id IS NULL;
  END IF;
END;
$$;

ALTER TABLE public.organization_settings
DROP CONSTRAINT IF EXISTS organization_settings_singleton_key_unique;

DROP INDEX IF EXISTS public.organization_settings_singleton_key_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_settings_tenant_id_fkey'
      AND conrelid = 'public.organization_settings'::regclass
  ) THEN
    ALTER TABLE public.organization_settings
    ADD CONSTRAINT organization_settings_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE public.organization_settings
ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organization_settings_tenant_singleton_unique
ON public.organization_settings (tenant_id, singleton_key);

CREATE INDEX IF NOT EXISTS organization_settings_tenant_id_idx
ON public.organization_settings (tenant_id);

DROP POLICY IF EXISTS "HR can create organization settings"
ON public.organization_settings;

DROP POLICY IF EXISTS "HR can read organization settings"
ON public.organization_settings;

DROP POLICY IF EXISTS "HR can update organization settings"
ON public.organization_settings;

CREATE POLICY "Tenant HR can create organization settings"
ON public.organization_settings
FOR INSERT
TO authenticated
WITH CHECK (
  singleton_key = TRUE
  AND tenant_id = (
    SELECT profiles.tenant_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND LOWER(COALESCE(profiles.role, '')) IN ('hr', 'hr_manager')
  )
);

CREATE POLICY "Tenant HR can read organization settings"
ON public.organization_settings
FOR SELECT
TO authenticated
USING (
  tenant_id = (
    SELECT profiles.tenant_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND LOWER(COALESCE(profiles.role, '')) IN ('hr', 'hr_manager')
  )
);

CREATE POLICY "Tenant HR can update organization settings"
ON public.organization_settings
FOR UPDATE
TO authenticated
USING (
  tenant_id = (
    SELECT profiles.tenant_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND LOWER(COALESCE(profiles.role, '')) IN ('hr', 'hr_manager')
  )
)
WITH CHECK (
  singleton_key = TRUE
  AND tenant_id = (
    SELECT profiles.tenant_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND LOWER(COALESCE(profiles.role, '')) IN ('hr', 'hr_manager')
  )
);

COMMENT ON COLUMN public.organization_settings.tenant_id IS
  'Company tenant that owns this organization settings singleton row.';

DO $$
DECLARE
  v_null_tenant_count INTEGER;
  v_duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_null_tenant_count
  FROM public.organization_settings
  WHERE tenant_id IS NULL;

  SELECT COUNT(*)
  INTO v_duplicate_count
  FROM (
    SELECT tenant_id, singleton_key
    FROM public.organization_settings
    GROUP BY tenant_id, singleton_key
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_null_tenant_count <> 0 THEN
    RAISE EXCEPTION
      'Tenant isolation validation failed: % organization_settings row(s) still have no tenant_id.',
      v_null_tenant_count;
  END IF;

  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION
      'Tenant isolation validation failed: % duplicate tenant singleton group(s) remain.',
      v_duplicate_count;
  END IF;
END;
$$;

COMMIT;