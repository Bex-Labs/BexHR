'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createModel} = require('../js/bexhr-organization-hierarchy.js');
const tenant = 'company-A';
const other = 'company-B';
const positions = [
  {id:'chief',tenant_id:tenant,job_title:'Managing Director',status:'Active',department_id:null},
  {id:'ops',tenant_id:tenant,job_title:'COO',status:'Active',department_id:null},
  {id:'training',tenant_id:tenant,job_title:'Training Manager',department_id:'dept-training',status:'Active'},
  {id:'instructor',tenant_id:tenant,job_title:'Instructor',department_id:'dept-training',status:'Active'},
  {id:'bad-other',tenant_id:other,job_title:'Instructor',status:'Active'},
];
const departments=[{id:'dept-training',tenant_id:tenant,department_name:'Training'}];
const links = [
  {tenant_id:tenant,job_title_id:'chief',reports_to_job_title_id:null},
  {tenant_id:tenant,job_title_id:'ops',reports_to_job_title_id:'chief'},
  {tenant_id:tenant,job_title_id:'training',reports_to_job_title_id:'ops'},
  {tenant_id:tenant,job_title_id:'instructor',reports_to_job_title_id:'training'},
];
const employees = [
  {id:'md',tenant_id:tenant,job_title:'Managing Director',department:'HQ',system_role:'hr',status:'Active'},
  {id:'coo',tenant_id:tenant,job_title:'COO',department:'HQ',system_role:'hr',status:'Active'},
  {id:'manager',tenant_id:tenant,job_title:'Training Manager',department:'Training',system_role:'employee',status:'Active'},
  {id:'trainer',tenant_id:tenant,job_title:'Instructor',department:'Training',system_role:'employee',status:'Active'},
  {id:'outsider',tenant_id:other,job_title:'COO',status:'Active'},
];
const model=(changes={})=>createModel({tenantId:tenant,positions,links,employees,departments,...changes});
test('executives can have HR roles and HQ departments without losing position identity',()=>{
  assert.equal(model().resolvePosition(employees[1]).position.id,'ops');
  assert.equal(model().resolvePosition(employees[0]).position.id,'chief');
  assert.equal(model().nearestOccupiedAncestor('md').code,'CONFIGURED_ROOT');
});
test('configured parent (not title alphabet or role ladder) drives structural eligibility',()=>{
  assert.equal(model().primaryPositionEligibility('coo','md').code,'ELIGIBLE');
  assert.equal(model().primaryPositionEligibility('manager','coo').code,'ELIGIBLE');
  assert.equal(model().primaryPositionEligibility('trainer','manager').code,'ELIGIBLE');
  assert.equal(model().primaryPositionEligibility('trainer','coo').code,'WRONG_PARENT_POSITION');
  assert.equal(model().primaryPositionEligibility('md','coo').code,'CONFIGURED_ROOT');
});
test('vacant ancestors are skipped while the configured structure stays unchanged',()=>{
  const m=model({employees:employees.filter(e=>e.id!=='coo')});
  assert.equal(m.nearestOccupiedAncestor('manager').position.id,'chief');
  assert.equal(m.primaryPositionEligibility('manager','md').code,'ELIGIBLE');
});
test('vacant root causes COO to be highest occupied, not COO becoming a configured root',()=>{
  const m=model({employees:employees.filter(e=>e.id!=='md')});
  assert.equal(m.nearestOccupiedAncestor('coo').code,'HIGHEST_OCCUPIED');
  assert.equal(m.nearestOccupiedAncestor('manager').position.id,'ops');
});
test('cross-company staff never become managers even with matching titles',()=>{
  assert.equal(model().primaryPositionEligibility('trainer','outsider').code,'OUTSIDE_TENANT_OR_INACTIVE');
  assert.equal(model().issues.length,0);
});
test('cross-company position links are never used',()=>{
  const m=model({links:links.filter(x=>x.job_title_id!=='training').concat({tenant_id:other,job_title_id:'training',reports_to_job_title_id:'ops'})});
  assert.equal(m.nearestOccupiedAncestor('trainer').code,'ANCESTOR_NOT_CONFIGURED');
});
test('cyclic position configuration is rejected',()=>{
  const m=model({links:links.map(x=>x.job_title_id==='chief'?{...x,reports_to_job_title_id:'instructor'}:x)});
  assert.ok(m.issues.some(i=>i.code==='POSITION_CYCLE'));
  assert.equal(m.nearestOccupiedAncestor('coo').code,'POSITION_CYCLE');
});
test('partial configuration fails closed rather than treating a missing link as top-level',()=>{
  const m=model({links:links.filter(x=>x.job_title_id!=='instructor')});
  assert.equal(m.nearestOccupiedAncestor('trainer').code,'POSITION_NOT_CONFIGURED');
});
test('direct position ID can disambiguate a reused title',()=>{
  const p={...employees[3],organization_job_title_id:'instructor',job_title:'random'};
  assert.equal(model().resolvePosition(p).position.id,'instructor');
});
test('reporting-line audit leaves data unchanged and identifies invalid historical rows',()=>{
  const lines=[{tenant_id:tenant,employee_id:'trainer',manager_employee_id:'coo',manager_type:'primary',status:'Active'},
  {tenant_id:tenant,employee_id:'trainer',manager_employee_id:'manager',manager_type:'primary',status:'Active'}];
  const findings=model().inspectPrimaryLines(lines);
  assert.ok(findings.some(x=>x.code==='MULTIPLE_PRIMARY'));
  assert.ok(findings.some(x=>x.reason==='WRONG_PARENT_POSITION'));
  assert.equal(lines.length,2);
});
test('missing tenant fails closed',()=>assert.throws(()=>createModel({positions}),/Tenant ID required/));
