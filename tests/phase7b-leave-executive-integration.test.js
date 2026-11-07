'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const authority = require(path.join(root, 'js/bexhr-leave-authority.js'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const now = Date.UTC(2026, 10, 4, 10);
const primary = {
  managerRelationshipLabel: 'Primary Manager',
  canDecideLeaveRequest: true,
  decisionAuthority: 'primary',
};
const delegated = {
  managerRelationshipLabel: 'Secondary Manager',
  canDecideLeaveRequest: true,
  decisionAuthority: 'delegated',
  activeDelegationId: 'valid-grant',
  delegationEndsAt: new Date(now + 60000).toISOString(),
};

test('Primary authority requires a positive protected readiness result', () => {
  assert.equal(authority.canDecide(primary, now), true);
  assert.equal(authority.canDecide({ ...primary, canDecideLeaveRequest: false }, now), false);
});
test('secondary without delegation is read-only regardless of role or label', () => {
  assert.equal(authority.canDecide({ ...delegated, decisionAuthority: 'view_only' }, now), false);
  assert.equal(authority.canDecide({ ...delegated, activeDelegationId: null }, now), false);
});
test('delegated secondary can decide only before server-returned expiry', () => {
  assert.equal(authority.canDecide(delegated, now), true);
  assert.equal(authority.canDecide(delegated, now + 60000), false);
  assert.equal(authority.canDecide({ ...delegated, delegationEndsAt: 'bad' }, now), false);
});
test('executive names and HR Admin do not grant leave decision authority', () => {
  assert.equal(authority.canDecide({ ...primary, canDecideLeaveRequest: false, job_title: 'COO', system_role: 'hr' }, now), false);
  assert.equal(authority.canDecide({ ...primary, decisionAuthority: 'delegated' }, now), false);
  assert.equal(authority.canDecide({ ...delegated, managerRelationshipLabel: 'Primary Manager' }, now), false);
});
test('missing readiness is closed, not guessed from a Primary label', () => {
  assert.equal(authority.fromReadiness(null), null);
  const stale = authority.fromReadiness({ manager_type: 'primary', can_decide: false });
  assert.equal(authority.canDecide(stale, now), false);
});
test('readiness conversion preserves only typed server approval and own employee ID', () => {
  const state = authority.fromReadiness({
    manager_type: 'secondary', can_decide: true, decision_authority: 'delegated',
    delegation_id: 'valid-grant', delegation_ends_at: delegated.delegationEndsAt,
    canonical_employee_id: 'employee-123',
  });
  assert.equal(state.employeeRecordId, 'employee-123');
  assert.equal(authority.canDecide(state, now), true);
  assert.equal(authority.canDecide({ ...state, canDecideLeaveRequest: 'true' }, now), false);
});
test('independent delegation writes report mixed success, never claim atomicity', async () => {
  const called = [];
  const result = await authority.createIndividually(['a', 'b', 'a', 'c'], async id => {
    called.push(id);
    if (id === 'b') throw Error('Already granted');
  });
  assert.deepEqual(called, ['a','b','c']);
  assert.deepEqual(result.succeeded, ['a','c']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].message, 'Already granted');
});
test('leave decision UI requires fresh request authority on every decision', () => {
  const src = read('js/manager-dashboard.js');
  assert.match(src, /return window\.BexHRLeaveAuthority\?\.canDecide\(request\) === true/);
  assert.match(src, /async function confirmFreshManagerLeaveAuthority/);
  assert.match(src, /await confirmFreshManagerLeaveAuthority\(request\)/);
  assert.match(src, /"get_manager_leave_readiness"/);
  assert.match(src, /await persistLeaveDecision\(request\.id, status, comment\)/);
  assert.doesNotMatch(src, /isPrimaryReportingManagerRelationship\(request\.managerRelationshipLabel\) \|\|\s*request\.canDecideLeaveRequest/);
});
test('new modal authority check cannot replace database decision transaction', () => {
  const src = read('js/manager-dashboard.js');
  assert.match(src, /"hrp_apply_leave_decision_once"/);
  assert.match(src, /"create_manager_leave_delegation"/);
  assert.match(src, /"revoke_manager_leave_delegation"/);
});
test('delegation creation does not silently lose partial successes', () => {
  const src = read('js/manager-dashboard.js');
  assert.match(src, /createIndividually\(/);
  assert.match(src, /result\.succeeded\.length/);
  assert.match(src, /result\.failed\.length/);
  assert.match(src, /showManagerLeaveDelegationNotice\(result\.succeeded\.length \? "warning" : "danger"/);
});
test('manager helper loads before manager-dashboard, leaving CSS untouched', () => {
  const html = read('manager-dashboard.html');
  const helper = html.indexOf('<script src="js/bexhr-leave-authority.js"></script>');
  const app = html.indexOf('<script src="js/manager-dashboard.js"></script>');
  assert.ok(helper > 0 && app > helper);
});
test('HR/Manager session access is server-authorized with legacy fallback only while RPC absent', () => {
  const src = read('js/session.js');
  assert.match(src, /rpc\("bexhr_p7b_workspace_access"\)/);
  assert.match(src, /typeof data\.can_enter_manager === "boolean"/);
  assert.match(src, /return data\.can_enter_manager === true/);
  assert.match(src, /get_manager_reporting_line_assignments/);
  assert.match(src, /hasRequiredHrMfaAssurance\(profile\)/);
});
test('login keeps protected payroll deep link above preferred executive landing', () => {
  const src = read('js/app.js');
  assert.match(src, /BEXHR_P7B_EXECUTIVE_DEFAULT_LANDING/);
  assert.match(src, /safeRedirect \|\| preferredLanding \|\|/);
  assert.match(src, /data\?\.preferred_workspace === 'manager'/);
  assert.match(src, /async function finishSuccessfulLoginRedirect/);
});
test('rehearsal rolls back; SQL does not rewrite employees, PA, balances or reporting lines', () => {
  const sql = read('supabase/phase7b-review/leave-executive/01-LEAVE-EXEC-REHEARSAL-ROLLBACK.sql');
  assert.match(sql, /^-- BEXHR PHASE 7B/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|INSERT INTO|UPDATE public\.employees|UPDATE public\.employee_reporting_lines)\s+(?:FROM\s+)?public\.(?:employees|leave_requests|employee_reporting_lines|pa_employee_appraisals|manager_leave_delegations)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.hrp_find_active_leave_delegation/);
  assert.match(sql, /CREATE FUNCTION public\.bexhr_p7b_workspace_access/);
});
test('delegation authorization checks tenant, active primary, active secondary and expiry', () => {
  const sql = read('supabase/phase7b-review/leave-executive/01-LEAVE-EXEC-REHEARSAL-ROLLBACK.sql');
  for (const term of [
    'target.tenant_id = actor.tenant_id',
    'primary_employee.tenant_id = actor.tenant_id',
    'delegation.status = \'active\'',
    'now() < delegation.ends_at',
    "'primary'",
    "'secondary'",
    'secondary_line.manager_employee_id = actor.manager_employee_id',
  ]) assert.ok(sql.includes(term), 'missing '+term);
});
test('workspace entitlement is role- and tenant-bound, MFA checked and title-agnostic', () => {
  const sql = read('supabase/phase7b-review/leave-executive/01-LEAVE-EXEC-REHEARSAL-ROLLBACK.sql');
  for (const term of ["profile.id = auth.uid()", "profile.tenant_id IS NOT NULL", "'aal2'", "'manager'", "'hr'", 'v_title_count = 1', 'organization_job_title_hierarchy'])
    assert.ok(sql.includes(term), 'missing '+term);
  assert.doesNotMatch(sql.toLowerCase(), /(?:job_title\s*=\s*'ceo'|job_title\s*=\s*'coo')/);
});
test('privileged RPC stays callable by authenticated users only', () => {
  const sql = read('supabase/phase7b-review/leave-executive/01-LEAVE-EXEC-REHEARSAL-ROLLBACK.sql');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.bexhr_p7b_workspace_access\(\) FROM public, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bexhr_p7b_workspace_access\(\) TO authenticated;/);
  assert.match(sql, /SET search_path = ''/);
});
test('forward SQL retains a firm release warning', () => {
  const s = read('supabase/phase7b-review/leave-executive/02-LEAVE-EXEC-FORWARD-DO-NOT-RUN.sql');
  assert.match(s, /^-- BEXHR PHASE 7B - FORWARD DRAFT - DO NOT RUN IN PRODUCTION/);
  assert.match(s, /COMMIT;\s*$/);
});

test('coverage messaging distinguishes delegated Secondary approval from Primary only', () => {
  const src = read('js/manager-dashboard.js');
  assert.match(src, /Secondary requests require an active temporary delegation/);
  assert.match(src, /Primary or actively delegated requests/);
  assert.doesNotMatch(src, /Decision rights apply only to employees assigned to you as Primary Manager/);
  assert.doesNotMatch(src, /Submission remains Primary-Manager-only/);
});
