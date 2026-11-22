const fs = require('fs');
const path = require('path');
const assert = require('assert');

const repo = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'hr-dashboard.html'), 'utf8').replace(/\r\n?/g, '\n');
const source = fs.readFileSync(path.join(repo, 'js', 'hr-dashboard.js'), 'utf8').replace(/\r\n?/g, '\n');
const invite = fs.readFileSync(path.join(repo, 'supabase', 'functions', 'invite-employee-login', 'index.ts'), 'utf8').replace(/\r\n?/g, '\n');
const migration = fs.readFileSync(path.join(repo, 'supabase', 'migrations', '20261101190500_phase7_lean_offboarding.sql'), 'utf8').replace(/\r\n?/g, '\n');

function extractFunction(text, name) {
  const marker = 'function ' + name + '(';
  const start = text.indexOf(marker);
  assert(start >= 0, 'Missing function: ' + name);
  const open = text.indexOf('{', start + marker.length);
  let depth = 0;
  let state = 'code';
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1] || '';
    if (state === 'line') { if (ch === '\n') state = 'code'; continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { state = 'code'; i += 1; } continue; }
    if (state === 'single') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === "'") state = 'code'; continue; }
    if (state === 'double') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') state = 'code'; continue; }
    if (state === 'template') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '\x60') state = 'code'; continue; }
    if (ch === '/' && next === '/') { state = 'line'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block'; i += 1; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '\x60') { state = 'template'; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  assert.fail('Could not close function: ' + name);
}

assert(!html.includes('id="employmentStatus"'), 'Default Status must be removed from normal employee form');
assert(!html.includes('id="exitDate"'), 'Exit Date must be removed from normal employee form');
assert(html.includes('id="hrEmployeeOffboardingModal"'));
assert(html.includes('id="hrEmployeeOffboardingReason"'));
assert(html.includes('id="hrEmployeeOffboardingLastWorkingDay"'));
assert(html.includes('id="hrEmployeeOffboardingNote"'));

const payloadFn = extractFunction(source, 'buildEmployeePayload');
assert(payloadFn.includes('const lifecycleStatus = state.currentEditingEmployee'));
assert(payloadFn.includes('exit_date: lifecycleExitDate'));
assert(payloadFn.includes('status: lifecycleStatus'));
assert(!payloadFn.includes('employmentStatus'));
assert(!payloadFn.includes('state.dom.exitDate'));

const csvTemplateFn = extractFunction(source, 'downloadBatchEmployeeCsvImportTemplate');
assert(!csvTemplateFn.includes('"Exit Date"'));
assert(!csvTemplateFn.includes('"Status"'));
const csvRowFn = extractFunction(source, 'buildBatchEmployeePreparedRowFromCsv');
assert(csvRowFn.includes('const status = "Active"'));
assert(csvRowFn.includes('exit_date: null'));

assert(source.includes('window.hrOffboardEmployee'));
assert(source.includes('window.hrReactivateEmployee'));
assert(source.includes('.rpc("hr_offboard_employee"'));
assert(source.includes('.rpc("hr_reactivate_employee"'));
assert(source.includes('label: "Login Disabled"'));
assert(source.includes('Last Working Day'));

const paEmployeesFn = extractFunction(source, 'getHrPerformanceAppraisalAvailableEmployees');
assert(paEmployeesFn.includes('normalizeText(employee.status || "active") === "active"'));

const payrollOptionsFn = extractFunction(source, 'populatePayrollEmployeeOptions');
assert(payrollOptionsFn.includes('normalizeText(employee.status || "active") === "active"'));
assert(payrollOptionsFn.includes('historical payroll record'));
const salaryOptionsFn = extractFunction(source, 'populatePayrollMasterEmployeeOptions');
assert(salaryOptionsFn.includes('normalizeText(employee.status || "active") === "active"'));
assert(salaryOptionsFn.includes('historical Salary Setup'));

const conflictFn = extractFunction(source, 'findPayrollMasterEffectiveDateConflict');
assert(conflictFn.includes('record.payroll_status'));
assert(conflictFn.includes('!== "active"'));

assert(invite.includes('This employee is offboarded. Use Reactivate Employee before sending a login invite.'));
assert(invite.indexOf('targetEmployeeQuery') < invite.indexOf('inviteUserByEmail(workEmail'));
assert(invite.includes('const callerTenantId = cleanText(callerProfile.tenant_id)'));
assert(invite.includes('const tenantId = callerTenantId'));
assert(invite.includes('Employee login invite cannot cross company workspaces.'));
assert(invite.includes('An existing login belongs to another company workspace.'));
assert(invite.includes('.eq("tenant_id", tenantId)'));

for (const marker of [
  'create table public.employee_lifecycle_events',
  'public.hr_offboard_employee',
  'public.hr_reactivate_employee',
  'BEXHR_OFFBOARD_ACTIVE_DIRECT_REPORTS',
  "lower(trim(coalesce(reporting_line.manager_type::text, ''))) = 'primary'",
  "child.status, 'active'))) = 'active'",
  "status = 'Exited'",
  "status = 'Active'",
  'is_active = false',
  'is_active = true',
  "payroll_status = 'Inactive'",
  'salary_restored',
  'reporting_managers_restored',
  'BEXHR_PAYROLL_EMPLOYEE_INACTIVE',
  'BEXHR_SALARY_SETUP_EMPLOYEE_INACTIVE',
  'BEXHR_OFFBOARD_LOGIN_DISABLED',
]) {
  assert(migration.includes(marker), 'Missing Phase 7 migration marker: ' + marker);
}

// Direct-report protection must be a scoped, active-Primary query, not a label-only marker.
const directReportGuardSql = migration.slice(
  migration.indexOf('select string_agg('),
  migration.indexOf('if v_direct_report_names is not null then'),
);
for (const required of [
  'reporting_line.manager_employee_id = v_employee.id',
  'child.tenant_id = v_tenant_id',
  "child.status, 'active'",
  "reporting_line.manager_type::text, ''",
  "reporting_line.status::text, 'active'",
]) {
  assert(directReportGuardSql.includes(required), 'Active Primary direct-report check lacks: ' + required);
}

assert(!/delete\s+from\s+public\.(payroll_records|payroll_master_records|employee_reporting_lines|employees)/i.test(migration), 'Phase 7 must preserve operational history');
assert(!/update\s+public\.payroll_records/i.test(migration), 'Phase 7 must not rewrite historical payroll rows');

const reactivateStart = migration.indexOf('create or replace function public.hr_reactivate_employee');
const reactivateEnd = migration.indexOf('comment on function public.hr_reactivate_employee', reactivateStart);
const reactivateSql = migration.slice(reactivateStart, reactivateEnd);
assert(!/payroll_status\s*=\s*'Active'/i.test(reactivateSql), 'Reactivation must not restore old Salary Setup');
assert(!/reporting_line[\s\S]{0,200}status\s*=\s*'Active'/i.test(reactivateSql), 'Reactivation must not restore old reporting managers');

console.log('PASS: Phase 7 lean offboarding lifecycle, payroll exclusion, login disable, and reactivation safety regression.');
