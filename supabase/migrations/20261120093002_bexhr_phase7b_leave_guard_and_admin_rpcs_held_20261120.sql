SET LOCAL lock_timeout='3s';
DO $pre$ BEGIN
 IF to_regprocedure('bexhr_private.h3b_guard_leave_delegation_insert()') IS NULL
 OR to_regprocedure('bexhr_private.h11_current_primary_authority(uuid,uuid)') IS NULL
 OR to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL
 THEN RAISE EXCEPTION 'P7B_STOP backend not in held-ready state'; END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.manager_leave_delegations'::regclass AND NOT t.tgisinternal AND t.tgname='bexhr_h3b_guard_leave_delegation_insert')
 THEN RAISE EXCEPTION 'P7B_STOP leave guard trigger already exists'; END IF;
END;$pre$;
CREATE TRIGGER bexhr_h3b_guard_leave_delegation_insert
BEFORE INSERT ON public.manager_leave_delegations
FOR EACH ROW EXECUTE FUNCTION bexhr_private.h3b_guard_leave_delegation_insert();
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_revoke_primary_exception(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_list_primary_exceptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz) TO authenticated;
DO $post$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_trigger t WHERE t.tgrelid='public.manager_leave_delegations'::regclass AND NOT t.tgisinternal AND t.tgname='bexhr_h3b_guard_leave_delegation_insert' AND t.tgenabled='O';
 IF n<>1 THEN RAISE EXCEPTION 'P7B_STOP leave guard missing'; END IF;
 IF has_function_privilege('anon','public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','public.hr_tenant_admin_list_primary_exceptions()','EXECUTE')
 OR has_function_privilege('anon','public.hr_tenant_admin_revoke_primary_exception(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'P7B_STOP anonymous privilege'; END IF;
 IF NOT has_function_privilege('authenticated','public.hr_tenant_admin_assign_primary_exception(uuid,uuid,text,timestamptz)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.hr_tenant_admin_approve_primary_exception(uuid,text,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'P7B_STOP authenticated RPC unavailable';END IF;
 IF to_regprocedure('public.bexhr_p7b_structure_capabilities()') IS NOT NULL THEN RAISE EXCEPTION 'P7B_STOP prematurely active'; END IF;
END;$post$;