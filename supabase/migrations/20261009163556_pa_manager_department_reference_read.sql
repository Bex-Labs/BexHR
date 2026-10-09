BEGIN;

CREATE POLICY "PA managers read managed department references"
ON public.organization_departments
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_authenticated_profile_tenant_id()
    AND bex_pa_private.manages_department(id)
);

COMMIT;
