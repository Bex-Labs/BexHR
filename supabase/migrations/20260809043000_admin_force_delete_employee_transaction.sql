-- BexHR Admin Force Delete Employee - v1.0.0
--
-- Purpose:
--   Provide the Platform Admin delete workflow with one atomic database purge.
--
-- Safety:
--   - This function is NOT available to normal authenticated users.
--   - It is intended to be called only by the service-role Edge Function
--     after the existing Platform Admin, target-user, and email checks pass.
--   - Existing foreign keys remain unchanged.
--   - If any delete fails, PostgreSQL rolls back the whole RPC call.

begin;

create or replace function public.admin_force_purge_employee(
  p_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_employee_number text;
  v_work_email text;
  v_tenant_id uuid;

  v_audit_deleted integer := 0;
  v_delegations_deleted integer := 0;
  v_reporting_lines_deleted integer := 0;
  v_payslip_logs_deleted integer := 0;
  v_payroll_overrides_deleted integer := 0;
  v_payroll_records_deleted integer := 0;
  v_payroll_master_deleted integer := 0;
  v_employee_deleted integer := 0;
begin
  if p_employee_id is null then
    raise exception 'Employee ID is required.';
  end if;

  -- Capture the identity values before deletion so the caller can confirm
  -- which employee was removed and that reusable values have been released.
  select
    employee_number,
    work_email,
    tenant_id
  into
    v_employee_number,
    v_work_email,
    v_tenant_id
  from public.employees
  where id = p_employee_id;

  if not found then
    raise exception 'Employee record was not found.';
  end if;


  -- -------------------------------------------------------
  -- 1. Manager decision audit.
  --
  -- This must be removed before manager_leave_delegations
  -- because delegation_id uses ON DELETE RESTRICT.
  -- -------------------------------------------------------
  delete from public.manager_leave_decision_authority_audit
  where target_employee_id = p_employee_id
     or actor_manager_employee_id = p_employee_id
     or primary_manager_employee_id = p_employee_id;

  get diagnostics v_audit_deleted = row_count;


  -- -------------------------------------------------------
  -- 2. Manager leave delegations.
  --
  -- All employee relationships currently use ON DELETE
  -- RESTRICT, so Platform Admin force-delete explicitly
  -- removes these records.
  -- -------------------------------------------------------
  delete from public.manager_leave_delegations
  where primary_manager_employee_id = p_employee_id
     or delegated_manager_employee_id = p_employee_id
     or covered_employee_id = p_employee_id;

  get diagnostics v_delegations_deleted = row_count;


  -- -------------------------------------------------------
  -- 3. Reporting relationships.
  --
  -- Remove both the employee and manager sides.
  -- -------------------------------------------------------
  delete from public.employee_reporting_lines
  where employee_id = p_employee_id
     or manager_employee_id = p_employee_id;

  get diagnostics v_reporting_lines_deleted = row_count;


  -- -------------------------------------------------------
  -- 4. Known payroll/history dependencies.
  -- -------------------------------------------------------
  delete from public.payslip_email_logs
  where employee_id = p_employee_id;

  get diagnostics v_payslip_logs_deleted = row_count;


  delete from public.payroll_employee_overrides
  where employee_id = p_employee_id;

  get diagnostics v_payroll_overrides_deleted = row_count;


  delete from public.payroll_records
  where employee_id = p_employee_id;

  get diagnostics v_payroll_records_deleted = row_count;


  delete from public.payroll_master_records
  where employee_id = p_employee_id;

  get diagnostics v_payroll_master_deleted = row_count;


  -- -------------------------------------------------------
  -- 5. Employee.
  --
  -- Any remaining restricted foreign key will cause this
  -- DELETE to fail. Because this is one RPC transaction,
  -- every deletion above is then rolled back automatically.
  -- -------------------------------------------------------
  delete from public.employees
  where id = p_employee_id;

  get diagnostics v_employee_deleted = row_count;

  if v_employee_deleted <> 1 then
    raise exception 'Employee deletion did not remove exactly one record.';
  end if;


  return jsonb_build_object(
    'success', true,
    'employeeId', p_employee_id,
    'employeeNumber', v_employee_number,
    'workEmail', v_work_email,
    'tenantId', v_tenant_id,
    'deleted', jsonb_build_object(
      'managerDecisionAudit', v_audit_deleted,
      'managerLeaveDelegations', v_delegations_deleted,
      'reportingLines', v_reporting_lines_deleted,
      'payslipEmailLogs', v_payslip_logs_deleted,
      'payrollEmployeeOverrides', v_payroll_overrides_deleted,
      'payrollRecords', v_payroll_records_deleted,
      'payrollMasterRecords', v_payroll_master_deleted,
      'employees', v_employee_deleted
    )
  );
end;
$function$;


-- Do not expose this destructive RPC to browser users.
revoke all
on function public.admin_force_purge_employee(uuid)
from public, anon, authenticated;

-- The delete-company-user Edge Function uses the service-role client.
grant execute
on function public.admin_force_purge_employee(uuid)
to service_role;

commit;