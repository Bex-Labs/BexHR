-- BexHR R35 Step143
-- H12 anonymous EXECUTE restriction.
-- Verified source: Step142.
-- Isolated staging correction already accepted.
-- NOT DEPLOYED. Release remains HOLD.
-- BEXHR STEP142
-- H12 ANONYMOUS EXECUTE REVOCATION
-- No application authorization is granted by this correction.

DO $h12_acl$
DECLARE
    n text;
    f oid;
BEGIN
    FOREACH n IN ARRAY ARRAY['bexhr_h12_has_hr_standard_workspace_access','bexhr_h12_hr_standard_directory','bexhr_h12_hr_standard_processed_leave','bexhr_h12_hr_standard_reporting_summary','bexhr_h12_native_hr_employee_roster','bexhr_h12_native_hr_profile_linkage','bexhr_h12_workspace_entitlements']::text[]
    LOOP
        f := to_regprocedure(format('public.%I()', n));

        IF f IS NULL
           OR has_function_privilege('authenticated',f,'EXECUTE') IS NOT TRUE
           OR has_function_privilege('service_role',f,'EXECUTE') IS NOT TRUE
        THEN
            RAISE EXCEPTION 'H12 ACL prerequisite failed: %', n;
        END IF;

        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon',
            n
        );

        IF has_function_privilege('anon',f,'EXECUTE') IS NOT FALSE
           OR has_function_privilege('authenticated',f,'EXECUTE') IS NOT TRUE
           OR has_function_privilege('service_role',f,'EXECUTE') IS NOT TRUE
        THEN
            RAISE EXCEPTION 'H12 ACL verification failed: %', n;
        END IF;
    END LOOP;
END;
$h12_acl$;
