'use strict';
// BexHR P7B integration regression: server denial cannot be bypassed
// through old manager reporting-line availability.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sessionSrc = fs.readFileSync(path.join(root,'js/session.js'),'utf8');
const sql = fs.readFileSync(path.join(root,'supabase/phase7b-review/combined-gate/01-P7B-COMBINED-REHEARSAL-ROLLBACK.sql'),'utf8');
const markers = [
  'async function hasManagerWorkspaceAccess(profile = {})',
  'function getCurrentWorkspaceKey()',
];
const a = sessionSrc.indexOf(markers[0]);
const b = sessionSrc.indexOf(markers[1], a + markers[0].length);
assert.ok(a !== -1 && b>a, 'Session entitlement function anchors missing');
const code = sessionSrc.slice(a,b);
const asFunction = (rpc) => new Function('getSupabaseClient', 'console', code + '\nreturn hasManagerWorkspaceAccess;')(() => ({rpc}), { warn(){} });
const hr = { role:'hr' };
function track(map) {
  const calls=[];
  return { calls, rpc: async name => {calls.push(name); if (map[name] instanceof Error) throw map[name]; return map[name]; } };
}

test('explicit new-RPC denial never falls back to legacy team', async () => {
 const r=track({bexhr_p7b_workspace_access:{data:{can_enter_manager:false},error:null},get_manager_reporting_line_assignments:{data:[{id:'active'}],error:null}});
 assert.equal(await asFunction(r.rpc)(hr),false);
 assert.deepEqual(r.calls,['bexhr_p7b_workspace_access']);
});
test('valid typed entitlement grants manager access', async () => {
 const r=track({bexhr_p7b_workspace_access:{data:{can_enter_manager:true},error:null}});
 assert.equal(await asFunction(r.rpc)(hr),true);
 assert.deepEqual(r.calls,['bexhr_p7b_workspace_access']);
});
test('malformed/stale entitlement response never falls back', async () => {
 for(const data of [null,[],{can_enter_manager:'true'}, {can_enter_manager:1}]) {
   const r=track({bexhr_p7b_workspace_access:{data,error:null},get_manager_reporting_line_assignments:{data:[{id:'legacy'}],error:null}});
   assert.equal(await asFunction(r.rpc)(hr),false);
   assert.equal(r.calls.length,1);
 }
});
test('timeout, permission error and uncaught exception deny (not legacy)', async () => {
 for(const issue of [{code:'42501'}, {code:'PGRST116'}, new Error('offline')]) {
   const r=track({bexhr_p7b_workspace_access:issue instanceof Error ? issue:{data:null,error:issue},get_manager_reporting_line_assignments:{data:[{id:'legacy'}],error:null}});
   assert.equal(await asFunction(r.rpc)(hr),false);
   assert.equal(r.calls.length,1);
 }
});
test('pre-rollout missing-RPC signal alone permits protected legacy team read', async () => {
 for(const code of ['PGRST202','42883']) {
   const r=track({bexhr_p7b_workspace_access:{data:null,error:{code}},get_manager_reporting_line_assignments:{data:[{id:'legacy'}],error:null}});
   assert.equal(await asFunction(r.rpc)(hr),true);
   assert.equal(r.calls.length,2);
 }
});
test('pre-rollout fallback still denies missing team or failed legacy RPC', async () => {
 for(const secondary of [{data:[],error:null}, {data:[{id:'legacy'}],error:{code:'42501'}}]) {
   const r=track({bexhr_p7b_workspace_access:{data:null,error:{code:'PGRST202'}},get_manager_reporting_line_assignments:secondary});
   assert.equal(await asFunction(r.rpc)(hr),false);
 }
});
test('non-HR profile cannot inherit executive team fallback', async () => {
 const r=track({bexhr_p7b_workspace_access:{data:{can_enter_manager:true},error:null}});
 assert.equal(await asFunction(r.rpc)({role:'employee'}),false);
 assert.deepEqual(r.calls,[]);
});
test('hard guard retains actual AAL2 check after entitlement', () => {
 assert.match(sessionSrc, /await hasRequiredHrMfaAssurance\(profile\)/);
 assert.match(sessionSrc, /data\?\.currentLevel === "aal2"/);
 assert.match(sessionSrc, /code !== "PGRST202" && code !== "42883"/);
});
test('combined SQL stages run in order and cannot persist changes', () => {
 assert.ok(sql.startsWith('-- BEXHR PHASE 7B'));
 assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ;/);
 assert.ok(sql.trimEnd().endsWith('ROLLBACK;'));
 assert.doesNotMatch(sql,/^\s*COMMIT\s*;/im);
 const names=['STAGED COMPONENT 10-DEPARTMENT','STAGED COMPONENT 20-REPORTING','STAGED COMPONENT 30-PA-REVIEWER','STAGED COMPONENT 40-PA-HIGHEST-V2','STAGED COMPONENT 50-LEAVE-EXEC'];
 const offsets=names.map(n=>sql.indexOf(n));
 assert.ok(offsets.every(n=>n!==-1)&&offsets.every((n,i)=>i===0||n>offsets[i-1]));
 assert.match(sql,/BEXHR_P7B_PA_HQ_OCCUPANCY_V1/);
 assert.match(sql,/BEXHR_P7B_COMBINED_STOP: unexpected application record change/);
});
test('integrated files preserve original UI and delegation authority guards', () => {
 const manager=fs.readFileSync(path.join(root,'js/manager-dashboard.js'),'utf8');
 const helper=fs.readFileSync(path.join(root,'js/bexhr-leave-authority.js'),'utf8');
 assert.match(manager,/confirmFreshManagerLeaveAuthority\(request\)/);
 assert.match(manager,/"hrp_apply_leave_decision_once"/);
 assert.match(manager,/get_manager_leave_readiness/);
 assert.match(helper,/decisionAuthority/);
});
