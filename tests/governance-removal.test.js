'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationDir = path.join(root, 'supabase', 'migrations');

assert.equal(
  fs.existsSync(path.join(root, 'governance-approval.html')),
  false,
  'Standalone compensation governance page must be removed',
);

assert.equal(
  fs.existsSync(path.join(root, 'js', 'governance-approval.js')),
  false,
  'Standalone compensation governance JavaScript must be removed',
);

for (const historical of [
  '20261030145853_phase45a_executive_governance_foundation.sql',
  '20261030165828_phase45b_compensation_governance_enforcement.sql',
]) {
  assert.ok(
    fs.existsSync(path.join(migrationDir, historical)),
    historical + ' must remain as migration history',
  );
}

const teardowns = fs
  .readdirSync(migrationDir)
  .filter((name) => /^\d+_remove_compensation_governance\.sql$/i.test(name));

assert.equal(teardowns.length, 1, 'Exactly one governance teardown migration must exist');

const sql = fs.readFileSync(path.join(migrationDir, teardowns[0]), 'utf8');

for (const marker of [
  'drop table if exists public.organization_job_title_governance',
  'drop table if exists public.organization_governance_authorities',
  'drop table if exists bexhr_private.compensation_change_approvals',
  'drop function if exists bexhr_private.enforce_compensation_governance_write()',
  'drop function if exists public.request_compensation_governance_approval(',
  'drop function if exists public.governance_get_compensation_requests()',
  'trg_phase45b_govern_payroll_master_write',
  'trg_phase45b_govern_payroll_allowance_write',
  'trg_phase45b_govern_payroll_statutory_write',
  'trg_phase45b_govern_payroll_other_deduction_write',
  'trg_phase45b_govern_payroll_employee_override_write',
  'trg_phase45b_govern_payroll_record_write',
]) {
  assert.ok(sql.includes(marker), marker + ' must be removed by the teardown migration');
}

for (const retained of [
  'phase45b_tenant_scope_payroll_master_records',
  'phase45b_tenant_scope_payroll_allowance_components',
  'phase45b_tenant_scope_payroll_statutory_deductions',
  'phase45b_tenant_scope_payroll_other_deductions',
  'phase45b_tenant_scope_payroll_employee_overrides',
  'phase45b_tenant_scope_payroll_records',
  'bexhr_private.employee_is_in_current_tenant(uuid)',
  'bexhr_private.payroll_master_is_in_current_tenant(uuid)',
  'public.organization_job_title_hierarchy',
]) {
  assert.ok(sql.includes(retained), retained + ' must be explicitly preserved/verified');
}

assert.equal(
  /drop\s+(?:function|policy|table)[\s\S]{0,120}employee_is_in_current_tenant/i.test(sql),
  false,
  'Tenant employee helper must not be dropped',
);

assert.equal(
  /drop\s+(?:function|policy|table)[\s\S]{0,120}payroll_master_is_in_current_tenant/i.test(sql),
  false,
  'Tenant payroll-master helper must not be dropped',
);

assert.equal(
  /drop\s+policy[\s\S]{0,120}phase45b_tenant_scope_/i.test(sql),
  false,
  'Tenant-scope payroll policies must not be dropped',
);

assert.ok(
  fs.existsSync(path.join(root, 'features', 'performance-appraisal', 'js', 'performance-appraisal.js')),
  'PA JavaScript must remain untouched by governance removal',
);


const hrDashboard = fs.readFileSync(
  path.join(root, 'js', 'hr-dashboard.js'),
  'utf8',
);

for (const marker of [
  'hr_get_employee_compensation_governance',
  'request_compensation_governance_approval',
  'BEXHR_GOVERNANCE_',
  'GOVERNANCE_RESTRICTED',
  'compensationGovernanceByEmployeeId',
  'pendingCompensationGovernanceApproval',
  'buildCompensationGovernanceChangeContext',
  'preflightCompensationGovernanceChange',
  'handleCompensationGovernanceWriteFailure',
  'Compensation change blocked',
  'Governance configuration must be resolved before compensation can be changed.',
]) {
  assert.equal(
    hrDashboard.includes(marker),
    false,
    'HR dashboard must not retain Phase 4.5B compensation governance runtime: ' + marker,
  );
}

for (const retained of [
  'payroll_master_records',
  'payroll_records',
  'handlePayrollMasterSave',
  'handleBatchPayrollSubmit',
  'handlePayrollSave',
]) {
  assert.ok(
    hrDashboard.includes(retained),
    'Normal HR/payroll runtime must remain after governance removal: ' + retained,
  );
}

console.log('PASS: compensation governance removal focused regression.');
