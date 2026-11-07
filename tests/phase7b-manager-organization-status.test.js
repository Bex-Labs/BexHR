'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../js/bexhr-manager-organization-status.js');
const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'js/manager-dashboard.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'manager-dashboard.html'), 'utf8');
const sqlPath = path.join(root, 'sql/01-manager-self-position-ROLLBACK.sql');
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : null;
const get = (status, title = 'Managing Director') => api.presentation({status, position_title: title});

test('custom organisation root is recognised, no title assumptions', () => {
  const result = get('CONFIGURED_ROOT');
  assert.equal(result.label, 'Managing Director - Top level');
  assert.match(result.description, /configured top-level/);
  assert.match(result.decisionAuthority, /Primary Manager/);
});
test('occupied COO with vacant CEO shows highest active not configured root', () => {
  const result = get('HIGHEST_OCCUPIED', 'COO');
  assert.match(result.label, /Highest active/);
  assert.match(result.description, /may be vacant/);
  assert.doesNotMatch(result.description, /configured top-level/);
});
test('organisation-wide HR role with HQ department is not excluded by display code', () => {
  assert.doesNotMatch(manager, /getManagerExecutiveDisplayPosition/);
  assert.doesNotMatch(manager, /\["ceo", "chief executive officer"\]/);
  assert.match(manager, /only a server-scoped self-position summary can identify/);
});
test('configured executive with parent and no reports is not misclassified as top level', () => {
  const result = get('HAS_OCCUPIED_PARENT', 'Country Director');
  assert.match(result.label, /No direct reports/);
  assert.doesNotMatch(result.label, /Top level/);
});
test('unconfigured hierarchy asks HR admin and grants no authority', () => {
  const result = get('SETUP_NEEDED', 'CFO');
  assert.equal(result.label, 'Reporting setup needed');
  assert.match(result.description, /HR administrator/);
  assert.match(result.decisionAuthority, /Primary Manager/);
});
test('missing, malformed or overly long data falls back safely', () => {
  assert.equal(api.presentation(null).label, 'Manager');
  assert.equal(get('NOT_A_REAL_STATUS').label, 'Manager');
  assert.equal(get('CONFIGURED_ROOT', 'x'.repeat(101)).label, 'Manager');
  assert.ok(!get('CONFIGURED_ROOT', '\n COO\t').label.includes('\n'));
});
test('loading calls self-only tenant-scoped RPC with current employee ID', async () => {
  let called = 0;
  const client = {rpc: async (name,args) => {
    called++;
    assert.equal(name, 'bexhr_p7b_my_organization_position');
    assert.deepEqual(args, {p_employee_id: 'employee-id'});
    return {data: {status: 'CONFIGURED_ROOT', position_title: 'CEO'}, error: null};
  }};
  const result = await api.load(client,'employee-id');
  assert.deepEqual(result, {status: 'CONFIGURED_ROOT', position_title: 'CEO'});
  assert.equal(called,1);
});
test('RPC errors, unavailable extension and invalid responses do not sign out', async () => {
  assert.equal(await api.load({rpc: async()=>({error:{code:'PGRST202'},data:null})},'one'),null);
  assert.equal(await api.load({rpc: async()=>{throw Error('network');}},'one'),null);
  assert.equal(await api.load({},'one'),null);
  assert.equal(await api.load({rpc: async()=>({data:{status:'HACK',position_title:'CEO'}})},'one'),null);
  assert.equal(await api.load({rpc: async()=>({data:{status:'CONFIGURED_ROOT',position_title:'CEO'}})},''),null);
});
test('manager script reads status only after matching logged-in manager', () => {
  assert.match(manager, /const managerEmployeeRecord = await loadCurrentManagerEmployeeRecord/);
  assert.match(manager, /state\.currentOrganizationPositionSummary = null;/);
  assert.match(manager, /hierarchyStatusApi\.load\(supabase, currentManagerId\)/);
  assert.match(manager, /Promise\.race/);
  assert.match(manager, /state\.currentProfile\?\.tenant_id/);
  assert.match(manager, /getManagerOrganizationPositionPresentation\(\)/);
});
test('both coverage render paths now display same shared status', () => {
  assert.equal((manager.match(/const positionDisplay = getManagerOrganizationPositionPresentation\(\)/g)||[]).length,3);
  assert.equal((manager.match(/coverageMode = positionDisplay\.label/g)||[]).length,2);
  assert.match(manager,/renderManagerCoverageModeFromReportingLines\(reportingLineByEmployeeId\);/);
});
test('helper is loaded between hierarchy core and manager dashboard',()=>{
  const a=html.indexOf('js/bexhr-organization-hierarchy.js');
  const b=html.indexOf('js/bexhr-manager-organization-status.js');
  const c=html.indexOf('js/manager-dashboard.js');
  assert.ok(a>0&&b>a&&c>b);
});
if (sql === null) {
  // This is a real outstanding backend coverage item, not a passing SQL test.
  // Do not invent SQL or interpret this TODO as Stage 5 acceptance.
  test.todo('self-only position RPC SQL contract: source artifact is not yet in repo (sql/01-manager-self-position-ROLLBACK.sql)');
} else {
  test('SQL is a self-only read-only RPC, no generic access and fully rolled back',()=>{
    assert.match(sql,/SECURITY DEFINER/);
    assert.match(sql,/p\.is_active IS TRUE/);
    assert.match(sql,/e\.tenant_id = v_tenant_id/);
    assert.match(sql,/e\.user_id = v_auth_id/);
    assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/);
    assert.match(sql,/GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated;/);
    assert.match(sql,/ROLLBACK;\s*$/);
    assert.ok(!/\b(UPDATE|DELETE|INSERT INTO)\s+public\.(employees|employee_reporting_lines)/i.test(sql));
  });
}
