#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.BEXHR_PHASE7A10_TEST_ROOT || path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261101190500_phase7_lean_offboarding.sql'), 'utf8').replace(/\r\n?/g,'\n');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/invite-employee-login/index.ts'), 'utf8').replace(/\r\n?/g,'\n');
const html = fs.readFileSync(path.join(root, 'hr-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/hr-dashboard.js'), 'utf8');

function block(from,to) {
  const a=sql.indexOf(from);
  const b=sql.indexOf(to,a+from.length);
  assert(a>=0 && b>a, `Missing unique boundary: ${from}`);
  assert(sql.indexOf(from,a+from.length)<0, `Duplicate boundary: ${from}`);
  return sql.slice(a,b);
}
for(const marker of [
  'create table public.employee_lifecycle_events',
  'create or replace function public.hr_offboard_employee(',
  'create or replace function public.hr_reactivate_employee(',
  'BEXHR_OFFBOARD_ACTIVE_DIRECT_REPORTS',
  'BEXHR_OFFBOARD_LOGIN_DISABLED',
  'BEXHR_SALARY_SETUP_EMPLOYEE_INACTIVE',
  'BEXHR_PAYROLL_EMPLOYEE_INACTIVE',
  'public.current_authenticated_profile_tenant_id()',
  "status = 'Exited'", "status = 'Active'",
]) assert(sql.includes(marker),'Existing offboarding contract changed: '+marker);
assert(!/delete\s+from\s+public\.(employees|payroll_records|payroll_master_records|employee_reporting_lines)/i.test(sql),'History was deleted');
assert(!/update\s+public\.payroll_records/i.test(sql),'Historical payroll touched');

const r = block('create or replace function public.hr_reactivate_employee(', 'comment on function public.hr_reactivate_employee');
assert(r.includes("lower(trim(coalesce(v_employee.status, ''))) <> 'exited'"),'Reactivation must require Exited');
assert(r.includes("v_latest_lifecycle_action") && r.includes("<> 'offboard'"),'Reactivation must require latest Offboard event');
assert(r.includes("hr_access_level = 'standard'"),'Reactivation must not auto-grant company admin');
assert(!r.includes("then 'tenant_admin'"),'Reactivation silently restores company admin');
assert(!/payroll_status\s*=\s*'Active'/.test(r),'Salary Setup restored on reactivation');
assert(!/reporting_line[\s\S]{0,200}status\s*=\s*'Active'/.test(r),'Reporting managers restored on reactivation');
assert(r.includes("'salary_restored', false"));
assert(r.includes("'reporting_managers_restored', false"));

const peopleGuard = block('create or replace function bexhr_private.phase7_current_people_tenant()', 'revoke all on function bexhr_private.phase7_current_people_tenant()');
assert(peopleGuard.includes('v_profile.role'),'Lifecycle authorization must use trusted profile role');
assert(peopleGuard.includes('coalesce(profile.is_active, false) is true'),'Caller must be active');

const tenant = block('create or replace function bexhr_private.phase7_active_caller_in_tenant(', 'revoke all on function bexhr_private.phase7_active_caller_in_tenant');
assert(tenant.includes('profile.id = auth.uid()'));
assert(tenant.includes('coalesce(profile.is_active, false) is true'));
assert(tenant.includes('profile.tenant_id = p_tenant_id'));
assert(!tenant.includes('user_metadata') && !tenant.includes('auth.jwt()'));
assert(tenant.includes("('admin', 'system_admin')"),'Existing platform admin carve-out removed');
const reporting = block('create or replace function bexhr_private.phase7_active_caller_in_reporting_tenant(', 'revoke all on function bexhr_private.phase7_active_caller_in_reporting_tenant');
assert(reporting.includes('employee.id = p_employee_id'));
assert(reporting.includes('employee.tenant_id = p_reporting_tenant_id'));
assert(reporting.includes('phase7_active_caller_in_tenant(employee.tenant_id)'));

for(const [name,table,predicate] of [
 ['phase7_active_tenant_employees','employees','phase7_active_caller_in_tenant(tenant_id)'],
 ['phase7_active_tenant_reporting_lines','employee_reporting_lines','phase7_active_caller_in_reporting_tenant(employee_id, tenant_id)'],
 ['phase7_active_profile_updates','profiles','phase7_caller_profile_active()'],
]){
  const reg = new RegExp(`create policy\\s+${name}\\s+on public\\.${table}\\s+as restrictive\\s+for (all|update)\\s+to authenticated\\s+using\\s*\\([\\s\\S]*?\\)\\s+with check\\s*\\([\\s\\S]*?\\);`,'i');
  const match=sql.match(reg);
  assert(match,'Missing RESTRICTIVE active/tenant policy WITH CHECK: '+name);
  assert(match[0].includes(predicate),'Policy does not validate expected scope: '+name);
}

const direct = block('create or replace function bexhr_private.phase7_block_direct_lifecycle_edits()', 'revoke all on function bexhr_private.phase7_block_direct_lifecycle_edits');
assert(direct.includes('security invoker'));
assert(direct.includes("current_user in ('authenticated', 'anon')"));
assert(direct.includes("new.exit_date is distinct from old.exit_date"));
assert(direct.includes('new.user_id is distinct from old.user_id'));
assert(direct.includes('new.tenant_id is distinct from old.tenant_id'));
assert(direct.includes('new.work_email'));
assert(sql.includes('create trigger bexhr_phase7_block_direct_lifecycle_edits'));

// Existing Phase 4.5B payroll restrictive policies remain prerequisites (not replacements).
for(const policy of ['phase45b_tenant_scope_payroll_records','phase45b_tenant_scope_payroll_master_records'])
 assert(sql.includes(policy),'Existing restrictive payroll guard preflight omitted: '+policy);
assert(!/drop policy[^;]*phase45b_/i.test(sql),'Protected payroll guard modified');
assert(edge.includes('This employee is offboarded. Use Reactivate Employee before sending a login invite.'));
assert(edge.includes('const tenantId = callerTenantId'));
assert(edge.includes('An existing login belongs to another company workspace.'));
assert(html.includes('hrEmployeeOffboardingModal') && js.includes('.rpc("hr_offboard_employee"'));
console.log('PASS: Phase 7A10 predeploy RLS and lifecycle guard integrity; preserved payroll/Edge/UI contract (static only; no database deployed).');
