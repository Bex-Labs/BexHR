'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname,'..','sql');
const read = name => fs.readFileSync(path.join(dir,name),'utf8');
const forward = read('02-REPORTING-VALIDATOR-FORWARD-DO-NOT-RUN.sql');
const rehearsal = read('01-REPORTING-VALIDATOR-REHEARSAL-ROLLBACK.sql');
const preflight = read('00-READONLY-PREFLIGHT.sql');
const postcheck = read('03-POSTCHECK-READONLY.sql');

test('forward is explicitly not approved for production',()=> assert.match(forward,/DO NOT APPLY TO PRODUCTION/));
test('rehearsal and forward only differ by warning and final transaction marker',()=> {
  const norm = s => s.replace(/-- (?:REVIEW-ONLY FORWARD DRAFT\. DO NOT APPLY TO PRODUCTION\.|ROLLBACK REHEARSAL: run in ONE Supabase SQL Editor execution, never persists\.)/,'-- HEADER')
    .replace(/(?:COMMIT|ROLLBACK);\s*$/,'END;');
  assert.equal(norm(rehearsal),norm(forward));
});
test('rehearsal is one transaction and always ends rollback',()=> {
  assert.match(rehearsal,/^BEGIN;/m);assert.match(rehearsal,/ROLLBACK;\s*$/);
  assert.equal((rehearsal.match(/^BEGIN;/gm)||[]).length,1);
  assert.doesNotMatch(rehearsal,/^COMMIT;/m);
});
test('forward commits one transaction',()=> {assert.match(forward,/^BEGIN;/m);assert.match(forward,/COMMIT;\s*$/);});
test('read only audits have no DDL or writes',()=> {
  for(const sql of [preflight,postcheck]) {
    const body=sql.replace(/^--.*$/gm,'').trim();
    assert.match(body,/^SELECT\b/i);
    assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|TRUNCATE|CREATE FUNCTION|CREATE TABLE|ALTER TABLE|DROP TABLE|GRANT EXECUTE|REVOKE ALL)\b/i);
  }
});
test('strong preflight requires current R14B integrity and reconciliation triggers',()=> {
  for(const name of ['bexhr_enforce_reporting_role_integrity','bexhr_reconcile_reporting_after_employee_position_change',
    'bexhr_reconcile_reporting_after_profile_authority_change','get_employee_leave_primary_manager_readiness','pa_current_user_is_primary_manager_of'])
    assert.ok(forward.includes(name),name);
});
test('cannot double-install private resolver',()=> assert.match(forward,/validator already installed; do not run twice/));
test('hard invalid existing reporting identities stop the migration',()=> {
  assert.match(forward,/hard identity or tenant-integrity error/);
  assert.match(forward,/manager\.tenant_id IS DISTINCT FROM child\.tenant_id/);
  assert.match(forward,/rl\.employee_id=rl\.manager_employee_id/);
});
test('existing duplicate primaries stop the migration',()=>assert.match(forward,/multiple active Primary lines detected/));
test('position lookup is tenant scoped and active',()=> {
  assert.match(forward,/jt\.tenant_id=v_employee\.tenant_id OR jt\.tenant_id IS NULL/);
  assert.match(forward,/d\.tenant_id=v_employee\.tenant_id/);
  assert.match(forward,/coalesce\(jt\.status,'active'\)/);
});
test('employee department takes precedence over whole company scope',()=> {
  assert.match(forward,/bool_or\(exact_department\) OVER/);
  assert.match(forward,/has_department_match AND exact_department/);
  assert.match(forward,/NOT has_department_match AND department_id IS NULL/);
});
test('tenant catalog preference is not null for global records',()=> {
  assert.match(forward,/bool_or\(coalesce\(tenant_id=v_employee\.tenant_id,FALSE\)\)/);
});
test('unresolved or ambiguous positions fail closed',()=> {
  assert.match(forward,/array_length\(v_ids,1\),0\)<>1 THEN RETURN NULL/);
});
test('configured Primary requires management authority and nearest occupied ancestor',()=> {
  const configured=forward.split('CREATE FUNCTION bexhr_private.p7b_configured_primary_match')[1].split('REVOKE ALL ON FUNCTION')[0];
  assert.match(configured,/FOR v_step IN 1\.\.128 LOOP/);
  assert.match(configured,/v_parent = ANY\(v_visited\)/);
  assert.match(configured,/RETURN v_manager_position=v_parent/);
  assert.doesNotMatch(configured,/is_hr_admin_employee|'ceo'|'coo'/i);
});
test('when parent is vacant climb to next configured ancestor',()=> {
  assert.match(forward,/SELECT h\.reports_to_job_title_id INTO v_parent[\s\S]*WHERE h\.tenant_id=v_tenant AND h\.job_title_id=v_parent/);
});
test('no unconfigured, corrupt or cyclic position chain can be treated as root',()=> {
  assert.match(forward,/IF v_parent IS NULL OR v_parent = ANY\(v_visited\) THEN RETURN FALSE/);
  assert.match(forward,/IF NOT EXISTS \([\s\S]*?h\.job_title_id=v_parent/);
});
test('only identical active Primary assignment can be preserved',()=> {
  assert.match(forward,/v_active_primary_count=1 AND EXISTS/);
  assert.match(forward,/rl\.manager_employee_id=p_manager_employee_id/);
  assert.match(forward,/rl\.manager_type::text,''\)\)\)='primary'/);
  assert.match(forward,/rl\.tenant_id=v_tenant OR rl\.tenant_id IS NULL/);
});
test('cross tenant, inactive and self-reporting excluded before any preservation',()=> {
  const func=forward.split('CREATE OR REPLACE FUNCTION bexhr_private.is_primary_reporting_relationship_valid')[1].split('REVOKE ALL ON FUNCTION')[0];
  for(const s of ['p_employee_id=p_manager_employee_id','tenant_id IS DISTINCT FROM v_manager.tenant_id',"v_manager.status,'active'"])
    assert.ok(func.includes(s),s);
  assert.ok(func.indexOf('SELECT count(*) INTO v_active_primary_count')>func.indexOf('p_employee_id=p_manager_employee_id'));
});
test('new configured child must use strict position parent decision',()=>assert.match(forward,/RETURN bexhr_private\.p7b_configured_primary_match/));
test('unconfigured company wide title cannot fall back to role ladder',()=>assert.match(forward,/IF v_scope_department IS NULL THEN RETURN FALSE/));
test('department backend activated means no new unconfigured assignments',()=>assert.match(forward,/to_regprocedure\('public\.bexhr_p7b_structure_capabilities\(\)'\) IS NOT NULL THEN\s*RETURN FALSE/));
test('prior role ladder fallback is limited to pre-capability unconfigured new departmental lines',()=> {
  assert.match(forward,/p7b_legacy_primary_pair_allowed/);
  assert.ok(forward.lastIndexOf('RETURN bexhr_private.p7b_legacy_primary_pair_allowed')>forward.lastIndexOf('bexhr_p7b_structure_capabilities()'));
});
test('new Primary uniqueness is enforced atomically without altering Secondary',()=> {
  const trigger=forward.split('CREATE OR REPLACE FUNCTION bexhr_private.enforce_reporting_role_integrity()')[1].split('REVOKE ALL ON FUNCTION')[0];
  assert.match(trigger,/pg_advisory_xact_lock/);
  assert.match(trigger,/rl\.id IS DISTINCT FROM NEW\.id/);
  assert.match(trigger,/BEXHR_P7B_MULTIPLE_PRIMARY/);
  assert.match(trigger,/manager_type::text,''\)\)\)<>'primary'/);
});
test('no anonymous or browser privilege broadened',()=> {
  assert.doesNotMatch(forward,/^[ \t]*GRANT[ \t]+/im);
  for(const name of ['p7b_resolve_employee_position_id','p7b_configured_primary_match','p7b_legacy_primary_pair_allowed','enforce_reporting_role_integrity','is_primary_reporting_relationship_valid'])
    assert.match(forward,new RegExp('REVOKE ALL ON FUNCTION bexhr_private\\.'+name+'\\([\\s\\S]*?FROM PUBLIC, anon, authenticated'));
});
test('preservation postcheck aborts if any historical active Primary becomes invalid',()=>assert.match(forward,/IF v_accepted<>v_total THEN/));
test('does not modify existing reporting, employee, PA or leave records',()=> {
  assert.doesNotMatch(forward,/\b(?:UPDATE|DELETE FROM|INSERT INTO|TRUNCATE|ALTER TABLE|DROP TABLE|DROP TRIGGER)\s+public\./i);
  assert.doesNotMatch(forward,/CREATE\s+(?:TABLE|INDEX|TRIGGER)\b/i);
});
test('does not activate departmental capability',()=> {
  assert.doesNotMatch(forward,/CREATE\s+(?:OR REPLACE\s+)?FUNCTION public\.bexhr_p7b_structure_capabilities/);
});
