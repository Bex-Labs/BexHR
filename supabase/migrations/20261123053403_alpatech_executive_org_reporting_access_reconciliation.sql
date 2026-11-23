-- Alpatech tenant-data reconciliation; existing reporting and people retained.
DO $reconcile$
DECLARE
  v_tenant uuid := 'b5b9ff68-00a2-47c8-85a4-6b573037589e';
  v_ceo_position uuid := '2ef60349-3213-4a5b-8e92-9543f5dcd060';
  v_coo_position uuid := '84be7601-3377-48a5-bc97-4426866af71a';
  v_ceo_employee uuid := 'ee762548-9161-48a2-853f-79275d919da9';
  v_coo_employee uuid := '17d2f5b0-f629-4e9e-82a3-bd3c9d682dd9';
  v_ceo_user uuid := '83f1a621-a011-4746-9cb6-33d3aad188a7';
  v_coo_user uuid := '1b3ce144-8793-491a-918a-bcdc83d6b9a9';
  v_existing_line_ids uuid[];
BEGIN
  IF (SELECT count(*) FROM public.tenants WHERE id=v_tenant AND tenant_code='ALP' AND status='Active') <> 1 THEN
    RAISE EXCEPTION 'STOP: tenant mismatch';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO v_existing_line_ids FROM public.employee_reporting_lines
   WHERE tenant_id=v_tenant AND lower(btrim(status))='active';
  IF coalesce(cardinality(v_existing_line_ids),0) <> 15 THEN RAISE EXCEPTION 'STOP: active reporting changed before correction'; END IF;
  IF (SELECT count(*) FROM public.organization_job_title_hierarchy WHERE tenant_id=v_tenant) <> 0 THEN
    RAISE EXCEPTION 'STOP: Alpatech hierarchy already configured';
  END IF;
  IF (SELECT count(*) FROM public.organization_job_titles WHERE tenant_id=v_tenant AND department_id IS NOT NULL AND id IN(v_ceo_position,v_coo_position)) <> 2 THEN
    RAISE EXCEPTION 'STOP: executive titles already moved or mismatch';
  END IF;
  IF (SELECT count(*) FROM public.employees WHERE tenant_id=v_tenant AND id IN (v_ceo_employee,v_coo_employee) AND department='HQ' AND system_role='hr') <> 2 THEN
    RAISE EXCEPTION 'STOP: executive employee state differs';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE tenant_id=v_tenant AND id IN(v_ceo_user,v_coo_user) AND role='hr' AND hr_access_level='standard') <> 2 THEN
    RAISE EXCEPTION 'STOP: executive profile state differs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.employee_reporting_lines WHERE tenant_id=v_tenant AND employee_id IN(v_coo_employee,v_ceo_employee) AND lower(status)='active' AND lower(manager_type)='primary') THEN
    RAISE EXCEPTION 'STOP: executive has existing primary reporting';
  END IF;

  UPDATE public.organization_job_titles SET department_id=NULL, updated_at=now()
   WHERE tenant_id=v_tenant AND id IN(v_ceo_position,v_coo_position);

  INSERT INTO public.organization_job_title_hierarchy(tenant_id,job_title_id,reports_to_job_title_id)
   VALUES (v_tenant,v_ceo_position,NULL),(v_tenant,v_coo_position,v_ceo_position);

  UPDATE public.profiles SET role='manager',hr_access_level='standard'
   WHERE tenant_id=v_tenant AND id IN(v_ceo_user,v_coo_user);

  UPDATE public.employees SET department=NULL,system_role='manager',line_manager=NULL,approver_email=NULL
   WHERE tenant_id=v_tenant AND id IN(v_ceo_employee,v_coo_employee);

  INSERT INTO public.employee_reporting_lines(tenant_id,employee_id,manager_employee_id,manager_type,status,effective_date,notes)
   VALUES(v_tenant,v_coo_employee,v_ceo_employee,'Primary','Active',current_date,'Alpatech executive organization reconciliation: COO reports to CEO.');

  IF (SELECT count(*) FROM public.employees WHERE tenant_id=v_tenant) <> 18 THEN
    RAISE EXCEPTION 'STOP: employee count changed';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE tenant_id=v_tenant AND role='hr' AND hr_access_level='tenant_admin') <> 1 THEN
    RAISE EXCEPTION 'STOP: HR Admin changed';
  END IF;
  IF (SELECT count(*) FROM public.organization_job_title_hierarchy WHERE tenant_id=v_tenant) <> 2 THEN
    RAISE EXCEPTION 'STOP: expected CEO and COO hierarchy missing';
  END IF;
  IF (SELECT count(*) FROM public.employee_reporting_lines WHERE tenant_id=v_tenant AND lower(status)='active') <> 16 THEN
    RAISE EXCEPTION 'STOP: reporting count changed unexpectedly';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_existing_line_ids) preserved(id) WHERE NOT EXISTS
   (SELECT 1 FROM public.employee_reporting_lines r WHERE r.id=preserved.id AND r.tenant_id=v_tenant AND lower(r.status)='active')) THEN
    RAISE EXCEPTION 'STOP: original reporting line deactivated';
  END IF;
  IF (SELECT bexhr_private.resolve_pa_manager_review_route(v_ceo_employee,v_tenant)->>'route') <> 'TOP_LEVEL' THEN
    RAISE EXCEPTION 'STOP: CEO not recognized as top-level';
  END IF;
  IF (SELECT bexhr_private.resolve_pa_manager_review_route(v_coo_employee,v_tenant)->>'route') <> 'PRIMARY_MANAGER' THEN
    RAISE EXCEPTION 'STOP: COO manager review not valid';
  END IF;
END
$reconcile$;
