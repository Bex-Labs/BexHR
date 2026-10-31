-- BEXHR PHASE 4.5B - COMPENSATION GOVERNANCE ENFORCEMENT
--
-- Purpose:
--   Enforce Phase 4.5A executive-compensation governance at the database layer
--   without removing governance-restricted employees from payroll execution.
--
-- Design:
--   1. STANDARD_HR employees continue through existing HR/payroll workflows.
--   2. GOVERNANCE_RESTRICTED compensation-source INSERT/UPDATE operations require
--      an exact, unconsumed approval created by an independent governance authority.
--   3. GOVERNANCE_RESTRICTED payroll_records INSERTs and compensation-changing
--      UPDATEs require an exact approved payroll snapshot before HR executes them.
--   4. Operational payroll-record updates that do not change the protected payroll
--      snapshot remain available to the existing HR workflow.
--   5. Direct browser DELETE of governance-restricted compensation/payroll rows is
--      denied. Existing privileged lifecycle/reset routines remain able to delete
--      through their SECURITY DEFINER paths.
--   6. No title names (CEO/COO/etc.) are hardcoded. Phase 4.5A remains the source
--      of truth through resolve_employee_compensation_governance().

-- ---------------------------------------------------------------------------
-- PREFLIGHT
-- ---------------------------------------------------------------------------

do $preflight$
begin
  if to_regprocedure('bexhr_private.resolve_employee_compensation_governance(uuid,uuid)') is null then
    raise exception 'Phase 4.5B preflight failed: Phase 4.5A governance resolver is missing.';
  end if;

  if to_regprocedure('bexhr_private.current_user_has_governance_authority(uuid,text)') is null then
    raise exception 'Phase 4.5B preflight failed: Phase 4.5A governance authority checker is missing.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- APPROVAL LEDGER
-- ---------------------------------------------------------------------------

create table bexhr_private.compensation_change_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_type text not null,
  operation text not null,
  target_record_id uuid,
  approved_snapshot jsonb not null,
  approval_reference text not null,
  notes text,
  decision_notes text,
  status text not null default 'REQUESTED',
  requested_by uuid,
  requested_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  consumed_by uuid,
  consumed_at timestamptz,
  consumed_target_record_id uuid,
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phase45b_comp_change_approval_target_check
    check (
      target_type in (
        'PAYROLL_MASTER_RECORD',
        'PAYROLL_ALLOWANCE_COMPONENT',
        'PAYROLL_STATUTORY_DEDUCTION',
        'PAYROLL_OTHER_DEDUCTION',
        'PAYROLL_EMPLOYEE_OVERRIDE',
        'PAYROLL_RECORD'
      )
    ),
  constraint phase45b_comp_change_approval_operation_check
    check (operation in ('INSERT', 'UPDATE')),
  constraint phase45b_comp_change_approval_status_check
    check (status in ('REQUESTED', 'APPROVED', 'CONSUMED', 'REJECTED', 'REVOKED')),
  constraint phase45b_comp_change_approval_reference_check
    check (nullif(trim(approval_reference), '') is not null),
  constraint phase45b_comp_change_approval_snapshot_check
    check (jsonb_typeof(approved_snapshot) = 'object'),
  constraint phase45b_comp_change_approval_update_target_check
    check (
      (operation = 'INSERT' and target_record_id is null)
      or
      (operation = 'UPDATE' and target_record_id is not null)
    )
);

comment on table bexhr_private.compensation_change_approvals is
'Private governance request/approval ledger for restricted compensation-source changes and restricted payroll snapshots. Direct browser table access is denied.';

create index phase45b_comp_change_approval_lookup_idx
on bexhr_private.compensation_change_approvals (
  tenant_id,
  employee_id,
  target_type,
  operation,
  status,
  approved_at
);

create index phase45b_comp_change_approval_target_record_idx
on bexhr_private.compensation_change_approvals (target_record_id)
where target_record_id is not null;

create unique index phase45b_comp_change_approval_single_active_snapshot_idx
on bexhr_private.compensation_change_approvals (
  tenant_id,
  employee_id,
  target_type,
  operation,
  coalesce(target_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
  md5(approved_snapshot::text)
)
where status = 'APPROVED';

create unique index phase45b_comp_change_request_single_pending_snapshot_idx
on bexhr_private.compensation_change_approvals (
  tenant_id,
  employee_id,
  target_type,
  operation,
  coalesce(target_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
  md5(approved_snapshot::text)
)
where status = 'REQUESTED';

alter table bexhr_private.compensation_change_approvals
  enable row level security;

alter table bexhr_private.compensation_change_approvals
  force row level security;

revoke all
on table bexhr_private.compensation_change_approvals
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PRIVATE SNAPSHOT CANONICALISATION
-- ---------------------------------------------------------------------------

create or replace function bexhr_private.compensation_change_snapshot(
  p_target_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_target text := upper(trim(coalesce(p_target_type, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_PAYLOAD_INVALID: Compensation approval payload must be a JSON object.';
  end if;

  if v_target = 'PAYROLL_MASTER_RECORD' then
    return jsonb_build_object(
      'employee_id', coalesce(v_payload -> 'employee_id', 'null'::jsonb),
      'grade', coalesce(v_payload -> 'grade', 'null'::jsonb),
      'basic_salary', case when v_payload ? 'basic_salary' then v_payload -> 'basic_salary' else to_jsonb(0::numeric) end,
      'salary_effective_date', coalesce(v_payload -> 'salary_effective_date', 'null'::jsonb),
      'pay_cycle', coalesce(v_payload -> 'pay_cycle', 'null'::jsonb),
      'payroll_status', case when v_payload ? 'payroll_status' then v_payload -> 'payroll_status' else to_jsonb('Active'::text) end,
      'payroll_grade_level', coalesce(v_payload -> 'payroll_grade_level', 'null'::jsonb),
      'payroll_grade_level_id', coalesce(v_payload -> 'payroll_grade_level_id', 'null'::jsonb)
    );
  end if;

  if v_target = 'PAYROLL_ALLOWANCE_COMPONENT' then
    return jsonb_build_object(
      'payroll_master_record_id', coalesce(v_payload -> 'payroll_master_record_id', 'null'::jsonb),
      'allowance_type', coalesce(v_payload -> 'allowance_type', 'null'::jsonb),
      'allowance_amount', case when v_payload ? 'allowance_amount' then v_payload -> 'allowance_amount' else to_jsonb(0::numeric) end,
      'effective_date', coalesce(v_payload -> 'effective_date', 'null'::jsonb),
      'allowance_status', case when v_payload ? 'allowance_status' then v_payload -> 'allowance_status' else to_jsonb('Active'::text) end
    );
  end if;

  if v_target = 'PAYROLL_STATUTORY_DEDUCTION' then
    return jsonb_build_object(
      'payroll_master_record_id', coalesce(v_payload -> 'payroll_master_record_id', 'null'::jsonb),
      'deduction_type', coalesce(v_payload -> 'deduction_type', 'null'::jsonb),
      'calculation_method', case when v_payload ? 'calculation_method' then v_payload -> 'calculation_method' else to_jsonb('RULE_BASED'::text) end,
      'deduction_value', case when v_payload ? 'deduction_value' then v_payload -> 'deduction_value' else to_jsonb(0::numeric) end,
      'effective_date', coalesce(v_payload -> 'effective_date', 'null'::jsonb),
      'config_source', case when v_payload ? 'config_source' then v_payload -> 'config_source' else to_jsonb('EMPLOYEE'::text) end,
      'inherited_grade', coalesce(v_payload -> 'inherited_grade', 'null'::jsonb),
      'inherited_rule_name', coalesce(v_payload -> 'inherited_rule_name', 'null'::jsonb),
      'deduction_status', case when v_payload ? 'deduction_status' then v_payload -> 'deduction_status' else to_jsonb('Active'::text) end,
      'payroll_grade_level_id', coalesce(v_payload -> 'payroll_grade_level_id', 'null'::jsonb),
      'payroll_grade_level_snapshot', coalesce(v_payload -> 'payroll_grade_level_snapshot', 'null'::jsonb),
      'configuration_source', case when v_payload ? 'configuration_source' then v_payload -> 'configuration_source' else to_jsonb('EMPLOYEE'::text) end,
      'status', case when v_payload ? 'status' then v_payload -> 'status' else to_jsonb('Active'::text) end
    );
  end if;

  if v_target = 'PAYROLL_OTHER_DEDUCTION' then
    return jsonb_build_object(
      'payroll_master_record_id', coalesce(v_payload -> 'payroll_master_record_id', 'null'::jsonb),
      'deduction_type', coalesce(v_payload -> 'deduction_type', 'null'::jsonb),
      'deduction_amount', coalesce(v_payload -> 'deduction_amount', 'null'::jsonb),
      'duration_months', coalesce(v_payload -> 'duration_months', 'null'::jsonb),
      'total_deduction_amount', coalesce(v_payload -> 'total_deduction_amount', 'null'::jsonb),
      'start_date', coalesce(v_payload -> 'start_date', 'null'::jsonb),
      'reference_number', coalesce(v_payload -> 'reference_number', 'null'::jsonb),
      'status', case when v_payload ? 'status' then v_payload -> 'status' else to_jsonb('Active'::text) end
    );
  end if;

  if v_target = 'PAYROLL_EMPLOYEE_OVERRIDE' then
    return jsonb_build_object(
      'payroll_master_record_id', coalesce(v_payload -> 'payroll_master_record_id', 'null'::jsonb),
      'employee_id', coalesce(v_payload -> 'employee_id', 'null'::jsonb),
      'override_category', coalesce(v_payload -> 'override_category', 'null'::jsonb),
      'override_element', coalesce(v_payload -> 'override_element', 'null'::jsonb),
      'override_method', coalesce(v_payload -> 'override_method', 'null'::jsonb),
      'original_value_snapshot', coalesce(v_payload -> 'original_value_snapshot', 'null'::jsonb),
      'override_value', coalesce(v_payload -> 'override_value', 'null'::jsonb),
      'override_rule_snapshot', coalesce(v_payload -> 'override_rule_snapshot', 'null'::jsonb),
      'effective_date', coalesce(v_payload -> 'effective_date', 'null'::jsonb),
      'end_date', coalesce(v_payload -> 'end_date', 'null'::jsonb),
      'approval_reference', coalesce(v_payload -> 'approval_reference', 'null'::jsonb),
      'reason', coalesce(v_payload -> 'reason', 'null'::jsonb),
      'status', case when v_payload ? 'status' then v_payload -> 'status' else to_jsonb('Active'::text) end
    );
  end if;

  if v_target = 'PAYROLL_RECORD' then
    return jsonb_build_object(
      'employee_id', coalesce(v_payload -> 'employee_id', 'null'::jsonb),
      'pay_cycle', coalesce(v_payload -> 'pay_cycle', 'null'::jsonb),
      'pay_date', coalesce(v_payload -> 'pay_date', 'null'::jsonb),
      'employee_group', coalesce(v_payload -> 'employee_group', 'null'::jsonb),
      'currency', case when v_payload ? 'currency' then v_payload -> 'currency' else to_jsonb('GBP'::text) end,
      'base_salary', coalesce(v_payload -> 'base_salary', 'null'::jsonb),
      'basic_pay', case when v_payload ? 'basic_pay' then v_payload -> 'basic_pay' else to_jsonb(0::numeric) end,
      'housing_allowance', coalesce(v_payload -> 'housing_allowance', 'null'::jsonb),
      'transport_allowance', coalesce(v_payload -> 'transport_allowance', 'null'::jsonb),
      'utility_allowance', coalesce(v_payload -> 'utility_allowance', 'null'::jsonb),
      'medical_allowance', coalesce(v_payload -> 'medical_allowance', 'null'::jsonb),
      'other_allowance', coalesce(v_payload -> 'other_allowance', 'null'::jsonb),
      'bonus', coalesce(v_payload -> 'bonus', 'null'::jsonb),
      'overtime', coalesce(v_payload -> 'overtime', 'null'::jsonb),
      'logistics_allowance', coalesce(v_payload -> 'logistics_allowance', 'null'::jsonb),
      'data_airtime_allowance', coalesce(v_payload -> 'data_airtime_allowance', 'null'::jsonb),
      'gross_pay', case when v_payload ? 'gross_pay' then v_payload -> 'gross_pay' else to_jsonb(0::numeric) end,
      'tax_deduction', case when v_payload ? 'tax_deduction' then v_payload -> 'tax_deduction' else to_jsonb(0::numeric) end,
      'pension_deduction', case when v_payload ? 'pension_deduction' then v_payload -> 'pension_deduction' else to_jsonb(0::numeric) end,
      'paye_tax', coalesce(v_payload -> 'paye_tax', 'null'::jsonb),
      'wht_tax', coalesce(v_payload -> 'wht_tax', 'null'::jsonb),
      'employee_pension', coalesce(v_payload -> 'employee_pension', 'null'::jsonb),
      'employer_pension', coalesce(v_payload -> 'employer_pension', 'null'::jsonb),
      'other_deductions', case when v_payload ? 'other_deductions' then v_payload -> 'other_deductions' else to_jsonb(0::numeric) end,
      'total_deductions', case when v_payload ? 'total_deductions' then v_payload -> 'total_deductions' else to_jsonb(0::numeric) end,
      'net_pay', case when v_payload ? 'net_pay' then v_payload -> 'net_pay' else to_jsonb(0::numeric) end,
      'payroll_model', coalesce(v_payload -> 'payroll_model', 'null'::jsonb),
      'payroll_model_version', coalesce(v_payload -> 'payroll_model_version', 'null'::jsonb),
      'structure_variant', coalesce(v_payload -> 'structure_variant', 'null'::jsonb),
      'increment_percent', coalesce(v_payload -> 'increment_percent', 'null'::jsonb),
      'increment_amount', coalesce(v_payload -> 'increment_amount', 'null'::jsonb),
      'merit_increment', coalesce(v_payload -> 'merit_increment', 'null'::jsonb),
      'new_base_salary', coalesce(v_payload -> 'new_base_salary', 'null'::jsonb),
      'basic_percent', coalesce(v_payload -> 'basic_percent', 'null'::jsonb),
      'housing_percent', coalesce(v_payload -> 'housing_percent', 'null'::jsonb),
      'transport_percent', coalesce(v_payload -> 'transport_percent', 'null'::jsonb),
      'utility_percent', coalesce(v_payload -> 'utility_percent', 'null'::jsonb),
      'other_allowance_percent', coalesce(v_payload -> 'other_allowance_percent', 'null'::jsonb),
      'meal_subsidy_percent', coalesce(v_payload -> 'meal_subsidy_percent', 'null'::jsonb),
      'medical_support_percent', coalesce(v_payload -> 'medical_support_percent', 'null'::jsonb),
      'taxable_income', coalesce(v_payload -> 'taxable_income', 'null'::jsonb),
      'non_taxable_income', coalesce(v_payload -> 'non_taxable_income', 'null'::jsonb),
      'bht', coalesce(v_payload -> 'bht', 'null'::jsonb),
      'monthly_salary_plus_logistics', coalesce(v_payload -> 'monthly_salary_plus_logistics', 'null'::jsonb),
      'employer_wht', coalesce(v_payload -> 'employer_wht', 'null'::jsonb),
      'logistics_support', coalesce(v_payload -> 'logistics_support', 'null'::jsonb),
      'meal_subsidy', coalesce(v_payload -> 'meal_subsidy', 'null'::jsonb),
      'medical_support', coalesce(v_payload -> 'medical_support', 'null'::jsonb),
      'temporary_staff_flat_pay', coalesce(v_payload -> 'temporary_staff_flat_pay', 'null'::jsonb)
    );
  end if;

  raise exception using
    errcode = '22023',
    message = 'BEXHR_GOVERNANCE_TARGET_INVALID: Unsupported compensation approval target.';
end;
$function$;

revoke all
on function bexhr_private.compensation_change_snapshot(text, jsonb)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PRIVATE RESOLUTION / TENANT HELPERS
-- ---------------------------------------------------------------------------

create or replace function bexhr_private.employee_is_in_current_tenant(
  p_employee_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_tenant_id uuid;
begin
  if auth.uid() is null or p_employee_id is null then
    return false;
  end if;

  v_actor_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_actor_tenant_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.tenant_id = v_actor_tenant_id
  );
end;
$function$;

revoke all
on function bexhr_private.employee_is_in_current_tenant(uuid)
from public, anon, authenticated, service_role;

grant execute
on function bexhr_private.employee_is_in_current_tenant(uuid)
to authenticated;

create or replace function bexhr_private.payroll_master_is_in_current_tenant(
  p_payroll_master_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
begin
  if p_payroll_master_record_id is null then
    return false;
  end if;

  select master.employee_id
  into v_employee_id
  from public.payroll_master_records master
  where master.id = p_payroll_master_record_id;

  if not found then
    return false;
  end if;

  return bexhr_private.employee_is_in_current_tenant(v_employee_id);
end;
$function$;

revoke all
on function bexhr_private.payroll_master_is_in_current_tenant(uuid)
from public, anon, authenticated, service_role;

grant execute
on function bexhr_private.payroll_master_is_in_current_tenant(uuid)
to authenticated;

create or replace function bexhr_private.employee_compensation_is_standard(
  p_employee_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_resolution jsonb;
begin
  select employee.tenant_id
  into v_tenant_id
  from public.employees employee
  where employee.id = p_employee_id;

  if not found or v_tenant_id is null then
    return false;
  end if;

  if auth.uid() is not null
     and public.current_authenticated_profile_tenant_id() is distinct from v_tenant_id then
    return false;
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    p_employee_id,
    v_tenant_id
  );

  return coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR') = 'STANDARD_HR';
end;
$function$;

revoke all
on function bexhr_private.employee_compensation_is_standard(uuid)
from public, anon, authenticated, service_role;

grant execute
on function bexhr_private.employee_compensation_is_standard(uuid)
to authenticated;

create or replace function bexhr_private.payroll_master_compensation_is_standard(
  p_payroll_master_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
begin
  select master.employee_id
  into v_employee_id
  from public.payroll_master_records master
  where master.id = p_payroll_master_record_id;

  if not found then
    return false;
  end if;

  return bexhr_private.employee_compensation_is_standard(v_employee_id);
end;
$function$;

revoke all
on function bexhr_private.payroll_master_compensation_is_standard(uuid)
from public, anon, authenticated, service_role;

grant execute
on function bexhr_private.payroll_master_compensation_is_standard(uuid)
to authenticated;

create or replace function bexhr_private.require_restricted_compensation_executor(
  p_tenant_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_EXECUTION_AUTH_REQUIRED: Restricted compensation execution requires an authenticated HR/Payroll user.';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.tenant_id = p_tenant_id
      and coalesce(profile.is_active, false) is true
      and lower(trim(coalesce(profile.role, ''))) in (
        'hr',
        'hr_manager',
        'payroll',
        'payroll_manager'
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_EXECUTION_ROLE_REQUIRED: Only active HR/Payroll users may execute an independently approved restricted compensation change.';
  end if;
end;
$function$;

revoke all
on function bexhr_private.require_restricted_compensation_executor(uuid)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PRIVATE APPROVAL CONSUMPTION
-- ---------------------------------------------------------------------------

create or replace function bexhr_private.consume_compensation_change_approval(
  p_employee_id uuid,
  p_target_type text,
  p_operation text,
  p_target_record_id uuid,
  p_consumed_target_record_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_resolution jsonb;
  v_control text;
  v_snapshot jsonb;
  v_approval_id uuid;
begin
  select employee.tenant_id
  into v_tenant_id
  from public.employees employee
  where employee.id = p_employee_id;

  if not found or v_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_EMPLOYEE_INVALID: Employee was not found.';
  end if;

  if auth.uid() is not null
     and public.current_authenticated_profile_tenant_id() is distinct from v_tenant_id then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_TENANT_MISMATCH: Compensation changes must remain inside the signed-in tenant.';
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    p_employee_id,
    v_tenant_id
  );

  v_control := coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR');

  if v_control = 'STANDARD_HR' then
    return null;
  end if;

  if v_control <> 'GOVERNANCE_RESTRICTED' then
    raise exception using
      errcode = '23514',
      message = format(
        'BEXHR_GOVERNANCE_CONFIGURATION_ERROR: Compensation mutation blocked because governance resolution returned %s (%s).',
        v_control,
        coalesce(v_resolution ->> 'reason', 'UNRESOLVED')
      );
  end if;

  perform bexhr_private.require_restricted_compensation_executor(v_tenant_id);

  v_snapshot := bexhr_private.compensation_change_snapshot(
    p_target_type,
    p_payload
  );

  select approval.id
  into v_approval_id
  from bexhr_private.compensation_change_approvals approval
  where approval.tenant_id = v_tenant_id
    and approval.employee_id = p_employee_id
    and approval.target_type = upper(trim(coalesce(p_target_type, '')))
    and approval.operation = upper(trim(coalesce(p_operation, '')))
    and approval.status = 'APPROVED'
    and approval.target_record_id is not distinct from p_target_record_id
    and approval.approved_snapshot = v_snapshot
    and approval.approved_by is not null
    and approval.approved_by is distinct from auth.uid()
  order by approval.approved_at, approval.id
  limit 1
  for update skip locked;

  if v_approval_id is null then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_RESTRICTED: Exact independent governance approval is required before this restricted compensation change can be executed.';
  end if;

  update bexhr_private.compensation_change_approvals approval
  set
    status = 'CONSUMED',
    consumed_by = auth.uid(),
    consumed_at = now(),
    consumed_target_record_id = p_consumed_target_record_id,
    updated_at = now()
  where approval.id = v_approval_id
    and approval.status = 'APPROVED';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'BEXHR_GOVERNANCE_APPROVAL_ALREADY_USED: The matching governance approval was consumed by another transaction.';
  end if;

  return v_approval_id;
end;
$function$;

revoke all
on function bexhr_private.consume_compensation_change_approval(uuid, text, text, uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GOVERNANCE AUTHORITY APPROVAL RPC
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- HR / PAYROLL GOVERNANCE REQUEST QUEUE
-- ---------------------------------------------------------------------------

create or replace function public.request_compensation_governance_approval(
  p_employee_id uuid,
  p_target_type text,
  p_operation text,
  p_target_record_id uuid,
  p_payload jsonb,
  p_request_reference text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_target text := upper(trim(coalesce(p_target_type, '')));
  v_operation text := upper(trim(coalesce(p_operation, '')));
  v_resolution jsonb;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing_payload jsonb;
  v_target_employee_id uuid;
  v_master_id uuid;
  v_snapshot jsonb;
  v_existing bexhr_private.compensation_change_approvals%rowtype;
  v_saved bexhr_private.compensation_change_approvals%rowtype;
  v_created_new boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception 'Tenant context is required.' using errcode = '42501';
  end if;

  perform bexhr_private.require_restricted_compensation_executor(v_tenant_id);

  if v_target not in (
    'PAYROLL_MASTER_RECORD',
    'PAYROLL_ALLOWANCE_COMPONENT',
    'PAYROLL_STATUTORY_DEDUCTION',
    'PAYROLL_OTHER_DEDUCTION',
    'PAYROLL_EMPLOYEE_OVERRIDE',
    'PAYROLL_RECORD'
  ) then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_TARGET_INVALID: Unsupported compensation approval target.';
  end if;

  if v_operation not in ('INSERT', 'UPDATE') then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_OPERATION_INVALID: Compensation requests support INSERT or UPDATE only.';
  end if;

  if nullif(trim(coalesce(p_request_reference, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_APPROVAL_REFERENCE_REQUIRED: Request reference is required.';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.tenant_id = v_tenant_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_EMPLOYEE_INVALID: Employee was not found in the requester tenant.';
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    p_employee_id,
    v_tenant_id
  );

  if coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR') <> 'GOVERNANCE_RESTRICTED' then
    raise exception using
      errcode = '23514',
      message = format(
        'BEXHR_GOVERNANCE_APPROVAL_NOT_APPLICABLE: Employee is not governance-restricted (%s / %s).',
        coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR'),
        coalesce(v_resolution ->> 'reason', 'UNRESOLVED')
      );
  end if;

  if v_operation = 'INSERT' and p_target_record_id is not null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_INSERT_TARGET_INVALID: INSERT requests must not specify an existing target record.';
  end if;

  if v_operation = 'UPDATE' and p_target_record_id is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_UPDATE_TARGET_REQUIRED: UPDATE requests require a target record.';
  end if;

  if v_operation = 'UPDATE' then
    if v_target = 'PAYROLL_MASTER_RECORD' then
      select to_jsonb(master), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_master_records master
      join public.employees employee on employee.id = master.employee_id
      where master.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    elsif v_target = 'PAYROLL_ALLOWANCE_COMPONENT' then
      select to_jsonb(component), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_allowance_components component
      join public.payroll_master_records master on master.id = component.payroll_master_record_id
      join public.employees employee on employee.id = master.employee_id
      where component.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    elsif v_target = 'PAYROLL_STATUTORY_DEDUCTION' then
      select to_jsonb(deduction), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_statutory_deductions deduction
      join public.payroll_master_records master on master.id = deduction.payroll_master_record_id
      join public.employees employee on employee.id = master.employee_id
      where deduction.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    elsif v_target = 'PAYROLL_OTHER_DEDUCTION' then
      select to_jsonb(deduction), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_other_deductions deduction
      join public.payroll_master_records master on master.id = deduction.payroll_master_record_id
      join public.employees employee on employee.id = master.employee_id
      where deduction.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    elsif v_target = 'PAYROLL_EMPLOYEE_OVERRIDE' then
      select to_jsonb(override_row), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_employee_overrides override_row
      join public.payroll_master_records master on master.id = override_row.payroll_master_record_id
      join public.employees employee on employee.id = master.employee_id
      where override_row.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    elsif v_target = 'PAYROLL_RECORD' then
      select to_jsonb(payroll), payroll.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_records payroll
      join public.employees employee on employee.id = payroll.employee_id
      where payroll.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    end if;

    if v_existing_payload is null then
      raise exception using
        errcode = '23503',
        message = 'BEXHR_GOVERNANCE_TARGET_NOT_FOUND: Compensation request target was not found in the tenant.';
    end if;

    if v_target_employee_id is distinct from p_employee_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_GOVERNANCE_TARGET_EMPLOYEE_MISMATCH: Request target does not belong to the selected restricted employee.';
    end if;

    v_payload := v_existing_payload || v_payload;
  end if;

  if v_target in ('PAYROLL_MASTER_RECORD', 'PAYROLL_RECORD') then
    v_target_employee_id := nullif(trim(coalesce(v_payload ->> 'employee_id', '')), '')::uuid;
  else
    v_master_id := nullif(trim(coalesce(v_payload ->> 'payroll_master_record_id', '')), '')::uuid;

    select master.employee_id
    into v_target_employee_id
    from public.payroll_master_records master
    join public.employees employee on employee.id = master.employee_id
    where master.id = v_master_id
      and employee.tenant_id = v_tenant_id;
  end if;

  if v_target_employee_id is null then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_TARGET_LINK_INVALID: Proposed compensation payload does not resolve to an employee in the requester tenant.';
  end if;

  if v_target_employee_id is distinct from p_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_TARGET_EMPLOYEE_MISMATCH: Proposed compensation payload does not belong to the selected restricted employee.';
  end if;

  if v_target = 'PAYROLL_EMPLOYEE_OVERRIDE'
     and nullif(trim(coalesce(v_payload ->> 'employee_id', '')), '') is not null
     and nullif(trim(v_payload ->> 'employee_id'), '')::uuid is distinct from p_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_OVERRIDE_EMPLOYEE_MISMATCH: Employee override employee_id must match its Payroll Master employee.';
  end if;

  v_snapshot := bexhr_private.compensation_change_snapshot(v_target, v_payload);

  select approval.*
  into v_existing
  from bexhr_private.compensation_change_approvals approval
  where approval.tenant_id = v_tenant_id
    and approval.employee_id = p_employee_id
    and approval.target_type = v_target
    and approval.operation = v_operation
    and approval.target_record_id is not distinct from p_target_record_id
    and approval.approved_snapshot = v_snapshot
    and approval.status in ('REQUESTED', 'APPROVED')
  order by case when approval.status = 'APPROVED' then 0 else 1 end,
           approval.created_at,
           approval.id
  limit 1;

  if found then
    return jsonb_build_object(
      'requestId', v_existing.id,
      'employeeId', v_existing.employee_id,
      'targetType', v_existing.target_type,
      'operation', v_existing.operation,
      'targetRecordId', v_existing.target_record_id,
      'requestReference', v_existing.approval_reference,
      'status', v_existing.status,
      'requestedAt', v_existing.requested_at,
      'approvedAt', v_existing.approved_at,
      'createdNew', false
    );
  end if;

  begin
    insert into bexhr_private.compensation_change_approvals (
      tenant_id,
      employee_id,
      target_type,
      operation,
      target_record_id,
      approved_snapshot,
      approval_reference,
      notes,
      status,
      requested_by,
      requested_at,
      created_at,
      updated_at
    )
    values (
      v_tenant_id,
      p_employee_id,
      v_target,
      v_operation,
      p_target_record_id,
      v_snapshot,
      trim(p_request_reference),
      nullif(trim(coalesce(p_notes, '')), ''),
      'REQUESTED',
      auth.uid(),
      now(),
      now(),
      now()
    )
    returning * into v_saved;
    v_created_new := true;
  exception when unique_violation then
    v_created_new := false;
    select approval.*
    into v_saved
    from bexhr_private.compensation_change_approvals approval
    where approval.tenant_id = v_tenant_id
      and approval.employee_id = p_employee_id
      and approval.target_type = v_target
      and approval.operation = v_operation
      and approval.target_record_id is not distinct from p_target_record_id
      and approval.approved_snapshot = v_snapshot
      and approval.status in ('REQUESTED', 'APPROVED')
    order by case when approval.status = 'APPROVED' then 0 else 1 end,
             approval.created_at,
             approval.id
    limit 1;
  end;

  return jsonb_build_object(
    'requestId', v_saved.id,
    'employeeId', v_saved.employee_id,
    'targetType', v_saved.target_type,
    'operation', v_saved.operation,
    'targetRecordId', v_saved.target_record_id,
    'requestReference', v_saved.approval_reference,
    'status', v_saved.status,
    'requestedAt', v_saved.requested_at,
    'approvedAt', v_saved.approved_at,
    'createdNew', v_created_new
  );
end;
$function$;

revoke all
on function public.request_compensation_governance_approval(uuid, text, text, uuid, jsonb, text, text)
from public, anon, authenticated, service_role;

grant execute
on function public.request_compensation_governance_approval(uuid, text, text, uuid, jsonb, text, text)
to authenticated;

create or replace function public.governance_get_compensation_requests()
returns table (
  request_id uuid,
  employee_id uuid,
  employee_number text,
  employee_name text,
  employee_email text,
  target_type text,
  operation text,
  target_record_id uuid,
  requested_snapshot jsonb,
  request_reference text,
  request_notes text,
  requested_by uuid,
  requester_name text,
  requester_email text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null
     or not bexhr_private.current_user_has_governance_authority(
       v_tenant_id,
       'EXECUTIVE_COMPENSATION'
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority may review compensation requests.';
  end if;

  return query
  select
    approval.id,
    approval.employee_id,
    employee.employee_number,
    concat_ws(' ', employee.first_name, employee.last_name),
    employee.work_email,
    approval.target_type,
    approval.operation,
    approval.target_record_id,
    approval.approved_snapshot,
    approval.approval_reference,
    approval.notes,
    approval.requested_by,
    requester.full_name,
    requester.email,
    approval.requested_at
  from bexhr_private.compensation_change_approvals approval
  join public.employees employee
    on employee.id = approval.employee_id
   and employee.tenant_id = approval.tenant_id
  left join public.profiles requester
    on requester.id = approval.requested_by
   and requester.tenant_id = approval.tenant_id
  where approval.tenant_id = v_tenant_id
    and approval.status = 'REQUESTED'
  order by approval.requested_at, approval.id;
end;
$function$;

revoke all
on function public.governance_get_compensation_requests()
from public, anon, authenticated, service_role;

grant execute
on function public.governance_get_compensation_requests()
to authenticated;

create or replace function public.governance_approve_compensation_request(
  p_request_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_request bexhr_private.compensation_change_approvals%rowtype;
  v_resolution jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null
     or not bexhr_private.current_user_has_governance_authority(
       v_tenant_id,
       'EXECUTIVE_COMPENSATION'
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority may approve restricted compensation.';
  end if;

  select approval.*
  into v_request
  from bexhr_private.compensation_change_approvals approval
  where approval.id = p_request_id
    and approval.tenant_id = v_tenant_id
    and approval.status = 'REQUESTED'
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_REQUEST_NOT_FOUND: Pending compensation request was not found in this tenant.';
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    v_request.employee_id,
    v_tenant_id
  );

  if coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR') <> 'GOVERNANCE_RESTRICTED' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_CONFIGURATION_ERROR: Compensation request can no longer be approved because governance is no longer restricted and valid.';
  end if;

  update bexhr_private.compensation_change_approvals approval
  set
    status = 'APPROVED',
    approved_by = auth.uid(),
    approved_at = now(),
    decision_notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_at = now()
  where approval.id = v_request.id
    and approval.status = 'REQUESTED'
  returning * into v_request;

  return jsonb_build_object(
    'approvalId', v_request.id,
    'employeeId', v_request.employee_id,
    'targetType', v_request.target_type,
    'operation', v_request.operation,
    'targetRecordId', v_request.target_record_id,
    'approvalReference', v_request.approval_reference,
    'status', v_request.status,
    'approvedAt', v_request.approved_at
  );
end;
$function$;

revoke all
on function public.governance_approve_compensation_request(uuid, text)
from public, anon, authenticated, service_role;

grant execute
on function public.governance_approve_compensation_request(uuid, text)
to authenticated;

create or replace function public.governance_reject_compensation_request(
  p_request_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_REJECTION_REASON_REQUIRED: A rejection reason is required.';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null
     or not bexhr_private.current_user_has_governance_authority(
       v_tenant_id,
       'EXECUTIVE_COMPENSATION'
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority may reject compensation requests.';
  end if;

  update bexhr_private.compensation_change_approvals approval
  set
    status = 'REJECTED',
    rejected_by = auth.uid(),
    rejected_at = now(),
    rejection_reason = trim(p_reason),
    updated_at = now()
  where approval.id = p_request_id
    and approval.tenant_id = v_tenant_id
    and approval.status = 'REQUESTED';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all
on function public.governance_reject_compensation_request(uuid, text)
from public, anon, authenticated, service_role;

grant execute
on function public.governance_reject_compensation_request(uuid, text)
to authenticated;

create or replace function public.governance_approve_compensation_change(
  p_employee_id uuid,
  p_target_type text,
  p_operation text,
  p_target_record_id uuid,
  p_payload jsonb,
  p_approval_reference text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_target text := upper(trim(coalesce(p_target_type, '')));
  v_operation text := upper(trim(coalesce(p_operation, '')));
  v_resolution jsonb;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing_payload jsonb;
  v_target_employee_id uuid;
  v_master_id uuid;
  v_snapshot jsonb;
  v_saved bexhr_private.compensation_change_approvals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null then
    raise exception 'Tenant context is required.' using errcode = '42501';
  end if;

  if not bexhr_private.current_user_has_governance_authority(
    v_tenant_id,
    'EXECUTIVE_COMPENSATION'
  ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority may approve restricted compensation.';
  end if;

  if v_target not in (
    'PAYROLL_MASTER_RECORD',
    'PAYROLL_ALLOWANCE_COMPONENT',
    'PAYROLL_STATUTORY_DEDUCTION',
    'PAYROLL_OTHER_DEDUCTION',
    'PAYROLL_EMPLOYEE_OVERRIDE',
    'PAYROLL_RECORD'
  ) then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_TARGET_INVALID: Unsupported compensation approval target.';
  end if;

  if v_operation not in ('INSERT', 'UPDATE') then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_OPERATION_INVALID: Compensation approvals support INSERT or UPDATE only.';
  end if;

  if nullif(trim(coalesce(p_approval_reference, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_APPROVAL_REFERENCE_REQUIRED: Approval reference is required.';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.tenant_id = v_tenant_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_EMPLOYEE_INVALID: Employee was not found in the governance authority tenant.';
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    p_employee_id,
    v_tenant_id
  );

  if coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR') <> 'GOVERNANCE_RESTRICTED' then
    raise exception using
      errcode = '23514',
      message = format(
        'BEXHR_GOVERNANCE_APPROVAL_NOT_APPLICABLE: Employee is not governance-restricted (%s / %s).',
        coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR'),
        coalesce(v_resolution ->> 'reason', 'UNRESOLVED')
      );
  end if;

  if v_operation = 'INSERT' and p_target_record_id is not null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_INSERT_TARGET_INVALID: INSERT approvals must not specify an existing target record.';
  end if;

  if v_operation = 'UPDATE' and p_target_record_id is null then
    raise exception using
      errcode = '22023',
      message = 'BEXHR_GOVERNANCE_UPDATE_TARGET_REQUIRED: UPDATE approvals require a target record.';
  end if;

  if v_operation = 'UPDATE' then
    if v_target = 'PAYROLL_MASTER_RECORD' then
      select to_jsonb(master), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_master_records master
      join public.employees employee
        on employee.id = master.employee_id
      where master.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;

    elsif v_target = 'PAYROLL_ALLOWANCE_COMPONENT' then
      select to_jsonb(component), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_allowance_components component
      join public.payroll_master_records master
        on master.id = component.payroll_master_record_id
      join public.employees employee
        on employee.id = master.employee_id
      where component.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;

    elsif v_target = 'PAYROLL_STATUTORY_DEDUCTION' then
      select to_jsonb(deduction), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_statutory_deductions deduction
      join public.payroll_master_records master
        on master.id = deduction.payroll_master_record_id
      join public.employees employee
        on employee.id = master.employee_id
      where deduction.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;

    elsif v_target = 'PAYROLL_OTHER_DEDUCTION' then
      select to_jsonb(deduction), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_other_deductions deduction
      join public.payroll_master_records master
        on master.id = deduction.payroll_master_record_id
      join public.employees employee
        on employee.id = master.employee_id
      where deduction.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;

    elsif v_target = 'PAYROLL_EMPLOYEE_OVERRIDE' then
      select to_jsonb(override_row), master.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_employee_overrides override_row
      join public.payroll_master_records master
        on master.id = override_row.payroll_master_record_id
      join public.employees employee
        on employee.id = master.employee_id
      where override_row.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;

    elsif v_target = 'PAYROLL_RECORD' then
      select to_jsonb(payroll), payroll.employee_id
      into v_existing_payload, v_target_employee_id
      from public.payroll_records payroll
      join public.employees employee
        on employee.id = payroll.employee_id
      where payroll.id = p_target_record_id
        and employee.tenant_id = v_tenant_id;
    end if;

    if v_existing_payload is null then
      raise exception using
        errcode = '23503',
        message = 'BEXHR_GOVERNANCE_TARGET_NOT_FOUND: Compensation approval target was not found in the tenant.';
    end if;

    if v_target_employee_id is distinct from p_employee_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_GOVERNANCE_TARGET_EMPLOYEE_MISMATCH: Approval target does not belong to the selected restricted employee.';
    end if;

    -- Treat UPDATE payloads as patches. Governance approves the resulting
    -- complete business state, not just the sparse fields sent by the client.
    v_payload := v_existing_payload || v_payload;
  end if;

  -- Resolve the employee again from the proposed final linkage. This rejects
  -- attempts to approve a row that is moved to another employee/master.
  if v_target in ('PAYROLL_MASTER_RECORD', 'PAYROLL_RECORD') then
    v_target_employee_id := nullif(
      trim(coalesce(v_payload ->> 'employee_id', '')),
      ''
    )::uuid;
  else
    v_master_id := nullif(
      trim(coalesce(v_payload ->> 'payroll_master_record_id', '')),
      ''
    )::uuid;

    select master.employee_id
    into v_target_employee_id
    from public.payroll_master_records master
    join public.employees employee
      on employee.id = master.employee_id
    where master.id = v_master_id
      and employee.tenant_id = v_tenant_id;
  end if;

  if v_target_employee_id is null then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_TARGET_LINK_INVALID: Proposed compensation payload does not resolve to an employee in the governance tenant.';
  end if;

  if v_target_employee_id is distinct from p_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_TARGET_EMPLOYEE_MISMATCH: Proposed compensation payload does not belong to the selected restricted employee.';
  end if;

  if v_target = 'PAYROLL_EMPLOYEE_OVERRIDE'
     and nullif(trim(coalesce(v_payload ->> 'employee_id', '')), '') is not null
     and nullif(trim(v_payload ->> 'employee_id'), '')::uuid is distinct from p_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_OVERRIDE_EMPLOYEE_MISMATCH: Employee override employee_id must match its Payroll Master employee.';
  end if;

  v_snapshot := bexhr_private.compensation_change_snapshot(
    v_target,
    v_payload
  );

  insert into bexhr_private.compensation_change_approvals (
    tenant_id,
    employee_id,
    target_type,
    operation,
    target_record_id,
    approved_snapshot,
    approval_reference,
    notes,
    status,
    requested_by,
    requested_at,
    approved_by,
    approved_at,
    created_at,
    updated_at
  )
  values (
    v_tenant_id,
    p_employee_id,
    v_target,
    v_operation,
    p_target_record_id,
    v_snapshot,
    trim(p_approval_reference),
    nullif(trim(coalesce(p_notes, '')), ''),
    'APPROVED',
    null,
    null,
    auth.uid(),
    now(),
    now(),
    now()
  )
  returning * into v_saved;

  return jsonb_build_object(
    'approvalId', v_saved.id,
    'employeeId', v_saved.employee_id,
    'targetType', v_saved.target_type,
    'operation', v_saved.operation,
    'targetRecordId', v_saved.target_record_id,
    'approvalReference', v_saved.approval_reference,
    'status', v_saved.status,
    'approvedAt', v_saved.approved_at
  );
end;
$function$;

-- Legacy direct approval entry point is intentionally not exposed to browser roles.
-- Phase 4.5B requires HR/Payroll to create a REQUESTED queue item first, then an
-- independent governance authority approves that exact request through the queue RPC.
revoke all
on function public.governance_approve_compensation_change(uuid, text, text, uuid, jsonb, text, text)
from public, anon, authenticated, service_role;

create or replace function public.governance_revoke_compensation_approval(
  p_approval_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_tenant_id := public.current_authenticated_profile_tenant_id();

  if v_tenant_id is null
     or not bexhr_private.current_user_has_governance_authority(
       v_tenant_id,
       'EXECUTIVE_COMPENSATION'
     ) then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_AUTHORITY_REQUIRED: Only an active independent executive compensation governance authority may revoke an approval.';
  end if;

  update bexhr_private.compensation_change_approvals approval
  set
    status = 'REVOKED',
    revoked_by = auth.uid(),
    revoked_at = now(),
    revocation_reason = nullif(trim(coalesce(p_reason, '')), ''),
    updated_at = now()
  where approval.id = p_approval_id
    and approval.tenant_id = v_tenant_id
    and approval.status = 'APPROVED';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all
on function public.governance_revoke_compensation_approval(uuid, text)
from public, anon, authenticated, service_role;

grant execute
on function public.governance_revoke_compensation_approval(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- DATABASE WRITE GUARD
-- ---------------------------------------------------------------------------

create or replace function bexhr_private.enforce_compensation_governance_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target text;
  v_employee_id uuid;
  v_master_id uuid;
  v_tenant_id uuid;
  v_resolution jsonb;
  v_control text;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_match_record_id uuid;
  v_consumed_record_id uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_TRIGGER_SCOPE_INVALID: Governance write guard attached outside public schema.';
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_PAYROLL_ROW_ID_IMMUTABLE: Payroll and compensation row identifiers cannot be changed in place.';
  end if;

  if tg_table_name = 'payroll_master_records' then
    v_target := 'PAYROLL_MASTER_RECORD';

    if tg_op = 'UPDATE' and old.employee_id is distinct from new.employee_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_MASTER_EMPLOYEE_IMMUTABLE: Payroll Master employee linkage cannot be changed in place.';
    end if;

    v_employee_id := new.employee_id;

  elsif tg_table_name = 'payroll_allowance_components' then
    v_target := 'PAYROLL_ALLOWANCE_COMPONENT';

    if tg_op = 'UPDATE'
       and old.payroll_master_record_id is distinct from new.payroll_master_record_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_MASTER_LINK_IMMUTABLE: Allowance Payroll Master linkage cannot be changed in place.';
    end if;

    v_master_id := new.payroll_master_record_id;

  elsif tg_table_name = 'payroll_statutory_deductions' then
    v_target := 'PAYROLL_STATUTORY_DEDUCTION';

    if tg_op = 'UPDATE'
       and old.payroll_master_record_id is distinct from new.payroll_master_record_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_MASTER_LINK_IMMUTABLE: Statutory deduction Payroll Master linkage cannot be changed in place.';
    end if;

    v_master_id := new.payroll_master_record_id;

  elsif tg_table_name = 'payroll_other_deductions' then
    v_target := 'PAYROLL_OTHER_DEDUCTION';

    if tg_op = 'UPDATE'
       and old.payroll_master_record_id is distinct from new.payroll_master_record_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_MASTER_LINK_IMMUTABLE: Other deduction Payroll Master linkage cannot be changed in place.';
    end if;

    v_master_id := new.payroll_master_record_id;

  elsif tg_table_name = 'payroll_employee_overrides' then
    v_target := 'PAYROLL_EMPLOYEE_OVERRIDE';

    if tg_op = 'UPDATE'
       and old.payroll_master_record_id is distinct from new.payroll_master_record_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_MASTER_LINK_IMMUTABLE: Employee override Payroll Master linkage cannot be changed in place.';
    end if;

    v_master_id := new.payroll_master_record_id;

  elsif tg_table_name = 'payroll_records' then
    v_target := 'PAYROLL_RECORD';

    if tg_op = 'UPDATE' and old.employee_id is distinct from new.employee_id then
      raise exception using
        errcode = '23514',
        message = 'BEXHR_PAYROLL_RECORD_EMPLOYEE_IMMUTABLE: Payroll Record employee linkage cannot be changed in place.';
    end if;

    v_employee_id := new.employee_id;

  else
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_TRIGGER_TARGET_INVALID: Unsupported table attached to compensation governance trigger.';
  end if;

  if v_employee_id is null then
    select master.employee_id
    into v_employee_id
    from public.payroll_master_records master
    where master.id = v_master_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'BEXHR_GOVERNANCE_PAYROLL_MASTER_INVALID: Payroll Master record was not found.';
    end if;
  end if;

  select employee.tenant_id
  into v_tenant_id
  from public.employees employee
  where employee.id = v_employee_id;

  if not found or v_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = 'BEXHR_GOVERNANCE_EMPLOYEE_INVALID: Compensation target employee was not found.';
  end if;

  if auth.uid() is not null
     and public.current_authenticated_profile_tenant_id() is distinct from v_tenant_id then
    raise exception using
      errcode = '42501',
      message = 'BEXHR_GOVERNANCE_TENANT_MISMATCH: Compensation changes must remain inside the signed-in tenant.';
  end if;

  if tg_table_name = 'payroll_employee_overrides'
     and new.employee_id is not null
     and new.employee_id is distinct from v_employee_id then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_OVERRIDE_EMPLOYEE_MISMATCH: Employee override employee_id must match its Payroll Master employee.';
  end if;

  v_resolution := bexhr_private.resolve_employee_compensation_governance(
    v_employee_id,
    v_tenant_id
  );

  v_control := coalesce(v_resolution ->> 'control', 'CONFIGURATION_ERROR');

  if v_control = 'CONFIGURATION_ERROR' then
    raise exception using
      errcode = '23514',
      message = format(
        'BEXHR_GOVERNANCE_CONFIGURATION_ERROR: Compensation mutation blocked because governance configuration is unresolved (%s).',
        coalesce(v_resolution ->> 'reason', 'UNRESOLVED')
      );
  end if;

  if v_control = 'STANDARD_HR' then
    return new;
  end if;

  if v_control <> 'GOVERNANCE_RESTRICTED' then
    raise exception using
      errcode = '23514',
      message = 'BEXHR_GOVERNANCE_CONFIGURATION_ERROR: Compensation mutation blocked because governance control is invalid.';
  end if;

  if tg_op = 'UPDATE' then
    v_old_snapshot := bexhr_private.compensation_change_snapshot(
      v_target,
      to_jsonb(old)
    );

    v_new_snapshot := bexhr_private.compensation_change_snapshot(
      v_target,
      to_jsonb(new)
    );

    if v_old_snapshot = v_new_snapshot then
      return new;
    end if;

    v_match_record_id := old.id;
    v_consumed_record_id := old.id;
  else
    v_match_record_id := null;
    v_consumed_record_id := new.id;
  end if;

  perform bexhr_private.consume_compensation_change_approval(
    v_employee_id,
    v_target,
    tg_op,
    v_match_record_id,
    v_consumed_record_id,
    to_jsonb(new)
  );

  return new;
end;
$function$;

revoke all
on function bexhr_private.enforce_compensation_governance_write()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- WRITE-GUARD TRIGGERS
-- ---------------------------------------------------------------------------

drop trigger if exists trg_phase45b_govern_payroll_master_write
on public.payroll_master_records;

create trigger trg_phase45b_govern_payroll_master_write
before insert or update
on public.payroll_master_records
for each row
execute function bexhr_private.enforce_compensation_governance_write();

drop trigger if exists trg_phase45b_govern_payroll_allowance_write
on public.payroll_allowance_components;

create trigger trg_phase45b_govern_payroll_allowance_write
before insert or update
on public.payroll_allowance_components
for each row
execute function bexhr_private.enforce_compensation_governance_write();

drop trigger if exists trg_phase45b_govern_payroll_statutory_write
on public.payroll_statutory_deductions;

create trigger trg_phase45b_govern_payroll_statutory_write
before insert or update
on public.payroll_statutory_deductions
for each row
execute function bexhr_private.enforce_compensation_governance_write();

drop trigger if exists trg_phase45b_govern_payroll_other_deduction_write
on public.payroll_other_deductions;

create trigger trg_phase45b_govern_payroll_other_deduction_write
before insert or update
on public.payroll_other_deductions
for each row
execute function bexhr_private.enforce_compensation_governance_write();

drop trigger if exists trg_phase45b_govern_payroll_employee_override_write
on public.payroll_employee_overrides;

create trigger trg_phase45b_govern_payroll_employee_override_write
before insert or update
on public.payroll_employee_overrides
for each row
execute function bexhr_private.enforce_compensation_governance_write();

drop trigger if exists trg_phase45b_govern_payroll_record_write
on public.payroll_records;

create trigger trg_phase45b_govern_payroll_record_write
before insert or update
on public.payroll_records
for each row
execute function bexhr_private.enforce_compensation_governance_write();

-- ---------------------------------------------------------------------------
-- TENANT-SCOPE RLS GUARDS
--
-- Existing permissive policies continue to decide which HR/Payroll/employee
-- roles may use each table. These restrictive policies only add the missing
-- tenant boundary, so they cannot grant access on their own.
-- ---------------------------------------------------------------------------

alter table public.payroll_master_records enable row level security;
alter table public.payroll_allowance_components enable row level security;
alter table public.payroll_statutory_deductions enable row level security;
alter table public.payroll_other_deductions enable row level security;
alter table public.payroll_employee_overrides enable row level security;
alter table public.payroll_records enable row level security;

drop policy if exists phase45b_tenant_scope_payroll_master_records
on public.payroll_master_records;

create policy phase45b_tenant_scope_payroll_master_records
on public.payroll_master_records
as restrictive
for all
to authenticated
using (
  bexhr_private.employee_is_in_current_tenant(employee_id)
)
with check (
  bexhr_private.employee_is_in_current_tenant(employee_id)
);

drop policy if exists phase45b_tenant_scope_payroll_allowance_components
on public.payroll_allowance_components;

create policy phase45b_tenant_scope_payroll_allowance_components
on public.payroll_allowance_components
as restrictive
for all
to authenticated
using (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
)
with check (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
);

drop policy if exists phase45b_tenant_scope_payroll_statutory_deductions
on public.payroll_statutory_deductions;

create policy phase45b_tenant_scope_payroll_statutory_deductions
on public.payroll_statutory_deductions
as restrictive
for all
to authenticated
using (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
)
with check (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
);

drop policy if exists phase45b_tenant_scope_payroll_other_deductions
on public.payroll_other_deductions;

create policy phase45b_tenant_scope_payroll_other_deductions
on public.payroll_other_deductions
as restrictive
for all
to authenticated
using (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
)
with check (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
);

drop policy if exists phase45b_tenant_scope_payroll_employee_overrides
on public.payroll_employee_overrides;

create policy phase45b_tenant_scope_payroll_employee_overrides
on public.payroll_employee_overrides
as restrictive
for all
to authenticated
using (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
)
with check (
  bexhr_private.payroll_master_is_in_current_tenant(payroll_master_record_id)
);

drop policy if exists phase45b_tenant_scope_payroll_records
on public.payroll_records;

create policy phase45b_tenant_scope_payroll_records
on public.payroll_records
as restrictive
for all
to authenticated
using (
  bexhr_private.employee_is_in_current_tenant(employee_id)
)
with check (
  bexhr_private.employee_is_in_current_tenant(employee_id)
);

-- ---------------------------------------------------------------------------
-- RESTRICTED DELETE GUARDS
--
-- SECURITY DEFINER lifecycle/reset routines bypass RLS, so tenant resets and
-- employee purge operations remain possible. Browser users cannot directly
-- delete governance-restricted compensation rows.
-- ---------------------------------------------------------------------------

drop policy if exists phase45b_restrict_payroll_master_delete
on public.payroll_master_records;

create policy phase45b_restrict_payroll_master_delete
on public.payroll_master_records
as restrictive
for delete
to authenticated
using (
  bexhr_private.employee_compensation_is_standard(employee_id)
);

drop policy if exists phase45b_restrict_payroll_allowance_delete
on public.payroll_allowance_components;

create policy phase45b_restrict_payroll_allowance_delete
on public.payroll_allowance_components
as restrictive
for delete
to authenticated
using (
  bexhr_private.payroll_master_compensation_is_standard(payroll_master_record_id)
);

drop policy if exists phase45b_restrict_payroll_statutory_delete
on public.payroll_statutory_deductions;

create policy phase45b_restrict_payroll_statutory_delete
on public.payroll_statutory_deductions
as restrictive
for delete
to authenticated
using (
  bexhr_private.payroll_master_compensation_is_standard(payroll_master_record_id)
);

drop policy if exists phase45b_restrict_payroll_other_deduction_delete
on public.payroll_other_deductions;

create policy phase45b_restrict_payroll_other_deduction_delete
on public.payroll_other_deductions
as restrictive
for delete
to authenticated
using (
  bexhr_private.payroll_master_compensation_is_standard(payroll_master_record_id)
);

drop policy if exists phase45b_restrict_payroll_employee_override_delete
on public.payroll_employee_overrides;

create policy phase45b_restrict_payroll_employee_override_delete
on public.payroll_employee_overrides
as restrictive
for delete
to authenticated
using (
  bexhr_private.payroll_master_compensation_is_standard(payroll_master_record_id)
);

drop policy if exists phase45b_restrict_payroll_record_delete
on public.payroll_records;

create policy phase45b_restrict_payroll_record_delete
on public.payroll_records
as restrictive
for delete
to authenticated
using (
  bexhr_private.employee_compensation_is_standard(employee_id)
);

-- ---------------------------------------------------------------------------
-- GRANT HYGIENE
-- ---------------------------------------------------------------------------

revoke all
on table public.payroll_master_records,
         public.payroll_allowance_components,
         public.payroll_statutory_deductions,
         public.payroll_other_deductions,
         public.payroll_employee_overrides,
         public.payroll_records
from anon;

revoke truncate, trigger, references
on table public.payroll_master_records,
         public.payroll_allowance_components,
         public.payroll_statutory_deductions,
         public.payroll_other_deductions,
         public.payroll_employee_overrides,
         public.payroll_records
from authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------

do $verification$
declare
  v_missing text;
  v_trigger_count integer;
  v_policy_count integer;
  v_target_rls_count integer;
  v_bad_grant_count integer;
  v_ledger_direct_grant_count integer;
  v_approval_rls boolean;
  v_approval_force_rls boolean;
begin
  if to_regprocedure('bexhr_private.resolve_employee_compensation_governance(uuid,uuid)') is null then
    raise exception 'Phase 4.5B verification failed: Phase 4.5A governance resolver is missing.';
  end if;

  if to_regprocedure('bexhr_private.current_user_has_governance_authority(uuid,text)') is null then
    raise exception 'Phase 4.5B verification failed: Phase 4.5A governance authority checker is missing.';
  end if;

  select string_agg(target.table_name, ', ' order by target.table_name)
  into v_missing
  from (
    values
      ('payroll_master_records'),
      ('payroll_allowance_components'),
      ('payroll_statutory_deductions'),
      ('payroll_other_deductions'),
      ('payroll_employee_overrides'),
      ('payroll_records')
  ) as target(table_name)
  where to_regclass(format('public.%I', target.table_name)) is null;

  if v_missing is not null then
    raise exception 'Phase 4.5B verification failed: required payroll tables are missing: %', v_missing;
  end if;

  select table_class.relrowsecurity, table_class.relforcerowsecurity
  into v_approval_rls, v_approval_force_rls
  from pg_class table_class
  join pg_namespace table_schema
    on table_schema.oid = table_class.relnamespace
  where table_schema.nspname = 'bexhr_private'
    and table_class.relname = 'compensation_change_approvals';

  if coalesce(v_approval_rls, false) is not true
     or coalesce(v_approval_force_rls, false) is not true then
    raise exception 'Phase 4.5B verification failed: approval ledger must have RLS enabled and forced.';
  end if;

  select count(*)
  into v_ledger_direct_grant_count
  from information_schema.role_table_grants grant_record
  where grant_record.table_schema = 'bexhr_private'
    and grant_record.table_name = 'compensation_change_approvals'
    and grant_record.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');

  if v_ledger_direct_grant_count <> 0 then
    raise exception 'Phase 4.5B verification failed: approval ledger has direct browser table grants.';
  end if;

  select count(*)
  into v_target_rls_count
  from pg_class table_class
  join pg_namespace table_schema
    on table_schema.oid = table_class.relnamespace
  where table_schema.nspname = 'public'
    and table_class.relname in (
      'payroll_master_records',
      'payroll_allowance_components',
      'payroll_statutory_deductions',
      'payroll_other_deductions',
      'payroll_employee_overrides',
      'payroll_records'
    )
    and table_class.relrowsecurity is true;

  if v_target_rls_count <> 6 then
    raise exception 'Phase 4.5B verification failed: expected RLS on all 6 payroll targets, found %.', v_target_rls_count;
  end if;

  select count(*)
  into v_trigger_count
  from pg_trigger trigger_record
  join pg_class trigger_table
    on trigger_table.oid = trigger_record.tgrelid
  join pg_namespace trigger_schema
    on trigger_schema.oid = trigger_table.relnamespace
  where trigger_schema.nspname = 'public'
    and trigger_record.tgisinternal is false
    and trigger_record.tgname in (
      'trg_phase45b_govern_payroll_master_write',
      'trg_phase45b_govern_payroll_allowance_write',
      'trg_phase45b_govern_payroll_statutory_write',
      'trg_phase45b_govern_payroll_other_deduction_write',
      'trg_phase45b_govern_payroll_employee_override_write',
      'trg_phase45b_govern_payroll_record_write'
    );

  if v_trigger_count <> 6 then
    raise exception 'Phase 4.5B verification failed: expected 6 governance write triggers, found %.', v_trigger_count;
  end if;

  select count(*)
  into v_policy_count
  from pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.policyname in (
      'phase45b_tenant_scope_payroll_master_records',
      'phase45b_tenant_scope_payroll_allowance_components',
      'phase45b_tenant_scope_payroll_statutory_deductions',
      'phase45b_tenant_scope_payroll_other_deductions',
      'phase45b_tenant_scope_payroll_employee_overrides',
      'phase45b_tenant_scope_payroll_records',
      'phase45b_restrict_payroll_master_delete',
      'phase45b_restrict_payroll_allowance_delete',
      'phase45b_restrict_payroll_statutory_delete',
      'phase45b_restrict_payroll_other_deduction_delete',
      'phase45b_restrict_payroll_employee_override_delete',
      'phase45b_restrict_payroll_record_delete'
    )
    and policy_record.permissive = 'RESTRICTIVE';

  if v_policy_count <> 12 then
    raise exception 'Phase 4.5B verification failed: expected 12 restrictive Phase 4.5B policies, found %.', v_policy_count;
  end if;

  select count(*)
  into v_bad_grant_count
  from information_schema.role_table_grants grant_record
  where grant_record.table_schema = 'public'
    and grant_record.table_name in (
      'payroll_master_records',
      'payroll_allowance_components',
      'payroll_statutory_deductions',
      'payroll_other_deductions',
      'payroll_employee_overrides',
      'payroll_records'
    )
    and (
      grant_record.grantee = 'anon'
      or (
        grant_record.grantee = 'authenticated'
        and grant_record.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
      )
    );

  if v_bad_grant_count <> 0 then
    raise exception 'Phase 4.5B verification failed: payroll grant hygiene still exposes forbidden anon/authenticated privileges.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'bexhr_private.employee_is_in_current_tenant(uuid)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'bexhr_private.payroll_master_is_in_current_tenant(uuid)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'bexhr_private.employee_compensation_is_standard(uuid)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'bexhr_private.payroll_master_compensation_is_standard(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: authenticated role cannot execute one or more RLS helper functions.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.request_compensation_governance_approval(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  )
  or has_function_privilege(
    'anon',
    'public.request_compensation_governance_approval(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'public.request_compensation_governance_approval(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: compensation request RPC execute grants are incorrect.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.governance_get_compensation_requests()',
    'EXECUTE'
  )
  or has_function_privilege(
    'anon',
    'public.governance_get_compensation_requests()',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'public.governance_get_compensation_requests()',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: governance request queue RPC execute grants are incorrect.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.governance_approve_compensation_request(uuid,text)',
    'EXECUTE'
  )
  or has_function_privilege(
    'anon',
    'public.governance_approve_compensation_request(uuid,text)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'public.governance_approve_compensation_request(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: governance request approval RPC execute grants are incorrect.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.governance_reject_compensation_request(uuid,text)',
    'EXECUTE'
  )
  or has_function_privilege(
    'anon',
    'public.governance_reject_compensation_request(uuid,text)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'authenticated',
    'public.governance_reject_compensation_request(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: governance request rejection RPC execute grants are incorrect.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.governance_approve_compensation_change(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: service_role has direct execute on governance approval RPC.';
  end if;

  if has_function_privilege(
    'anon',
    'public.governance_approve_compensation_change(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: anon can execute governance approval RPC.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.governance_approve_compensation_change(uuid,text,text,uuid,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: authenticated role can bypass the governance request queue through the legacy direct approval RPC.';
  end if;

  if has_function_privilege(
    'service_role',
    'public.governance_revoke_compensation_approval(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: service_role has direct execute on governance revoke RPC.';
  end if;

  if has_function_privilege(
    'anon',
    'public.governance_revoke_compensation_approval(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: anon can execute governance revoke RPC.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.governance_revoke_compensation_approval(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Phase 4.5B verification failed: authenticated governance authority cannot execute revoke RPC.';
  end if;
end;
$verification$;
