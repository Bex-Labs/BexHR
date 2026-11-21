SET LOCAL lock_timeout='3s';
DO $pre$ DECLARE h int; lv int; pa int; BEGIN
 IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL THEN RAISE EXCEPTION 'P7B_STOP already active';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.manager_leave_delegations'::regclass AND tgname='bexhr_h3b_guard_leave_delegation_insert' AND tgenabled='O')
 THEN RAISE EXCEPTION 'P7B_STOP leave guard absent';END IF;
 SELECT count(*) FILTER(WHERE bexhr_private.h11_current_primary_authority(l.employee_id,l.manager_employee_id)),
 count(*) FILTER(WHERE bexhr_private.h3b_live_leave_primary_pair(l.employee_id,l.manager_employee_id)),
 count(*) FILTER(WHERE bexhr_private.resolve_pa_manager_review_route(l.employee_id,e.tenant_id)->>'route'='PRIMARY_MANAGER')
 INTO h,lv,pa FROM public.employee_reporting_lines l JOIN public.employees e ON e.id=l.employee_id
 WHERE lower(btrim(coalesce(l.manager_type,'')))='primary' AND lower(btrim(coalesce(l.status,'active')) )='active';
 IF h<>19 OR lv<>19 OR pa<>19 THEN RAISE EXCEPTION 'P7B_STOP authority %/%/%',h,lv,pa;END IF;
 IF (SELECT count(*) FROM bexhr_private.p7b_legacy_primary_transition)<>8 THEN RAISE EXCEPTION 'P7B_STOP legacy snapshot drift';END IF;
 END;$pre$;
CREATE FUNCTION public.bexhr_p7b_structure_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SET search_path=''
AS $feature$
 SELECT pg_catalog.jsonb_build_object('department_positions',true,'atomic_position_save',true,'schema_version',1);
$feature$;
REVOKE ALL ON FUNCTION public.bexhr_p7b_structure_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bexhr_p7b_structure_capabilities() TO authenticated,service_role;
DO $post$
BEGIN
 IF public.bexhr_p7b_structure_capabilities() IS DISTINCT FROM
 pg_catalog.jsonb_build_object('department_positions',true,'atomic_position_save',true,'schema_version',1)
 THEN RAISE EXCEPTION 'P7B_STOP feature flags invalid';END IF;
 IF has_function_privilege('anon','public.bexhr_p7b_structure_capabilities()','EXECUTE') OR
 NOT has_function_privilege('authenticated','public.bexhr_p7b_structure_capabilities()','EXECUTE')
 THEN RAISE EXCEPTION 'P7B_STOP capability access invalid';END IF;
END;$post$;