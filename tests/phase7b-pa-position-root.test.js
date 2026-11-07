'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname, '..');
globalThis.BexHROrganizationHierarchy=require(path.join(root,'js/bexhr-organization-hierarchy.js'));
const {isExplicitRoot}=require(path.join(root,'js/bexhr-pa-position-root.js'));

const T='tenant-A';
const q=(employee, overrides={})=>({
 tenantId:T,loaded:true,person:employee,
 positions:[
  {id:'root',job_title:'General Director',department_id:null,status:'Active'},
  {id:'coo',job_title:'Chief Operations Officer',department_id:null,status:'Active'},
  {id:'dept-head',job_title:'Training Manager',department_id:'dept-training',status:'Active'},
  {id:'dept-trainer',job_title:'Training Officer',department_id:'dept-training',status:'Active'},
 ],
 links:[
  {job_title_id:'root',reports_to_job_title_id:null},
  {job_title_id:'coo',reports_to_job_title_id:'root'},
  {job_title_id:'dept-head',reports_to_job_title_id:'coo'},
  {job_title_id:'dept-trainer',reports_to_job_title_id:'dept-head'},
 ],
 departments:[{id:'dept-training',department_name:'Training'}],
 ...overrides,
});
const person=(id,title,dept='',deptId='')=>({id,jobTitle:title,department:dept,departmentId:deptId});

test('custom named executive at configured root is recognised with HQ department and HR application role',()=>{
 assert.equal(isExplicitRoot(q({...person('e1','General Director','HQ'),system_role:'hr'})),true);
});
test('COO with HR role and configured director parent is not root',()=>{
 assert.equal(isExplicitRoot(q({...person('coo1','Chief Operations Officer','HQ'),system_role:'hr'})),false);
});
test('an active departmental head cannot become a top-level marker',()=>{
 assert.equal(isExplicitRoot(q(person('h','Training Manager','Training','dept-training'))),false);
});
test('same title in a department and whole-company must be disambiguated by department',()=>{
 const config=q(person('dept','General Director','Training','dept-training'));
 config.positions.push({id:'dept-director',job_title:'General Director',department_id:'dept-training',status:'Active'});
 config.links.push({job_title_id:'dept-director',reports_to_job_title_id:'coo'});
 assert.equal(isExplicitRoot(config),false);
 config.person=person('root-person','General Director','HQ');
 assert.equal(isExplicitRoot(config),false,'unknown scoped title with duplicate departmental title fails closed');
 config.person={...person('root-person','General Director','HQ'),organizationJobTitleId:'root'};
 assert.equal(isExplicitRoot(config),true,'explicit position ID resolves ambiguity');
});
test('duplicate same-title whole-company positions remain ambiguous without ID',()=>{
 const config=q(person('e1','General Director','HQ'));
 config.positions.push({id:'other-root',job_title:'General Director',department_id:null,status:'Active'});
 config.links.push({job_title_id:'other-root',reports_to_job_title_id:'coo'});
 assert.equal(isExplicitRoot(config),false);
});
test('missing or unconfigured root link fails closed',()=>{
 const config=q(person('e1','General Director','HQ'));
 config.links=config.links.filter(x=>x.job_title_id!=='root');
 assert.equal(isExplicitRoot(config),false);
});
test('a cyclic position hierarchy fails closed',()=>{
 const config=q(person('e1','General Director','HQ'));
 config.links[0].reports_to_job_title_id='coo';
 assert.equal(isExplicitRoot(config),false);
});
test('loading, rejected positions, rejected hierarchy and absent tenant never infer a top level',()=>{
 const config=q(person('e1','General Director','HQ'));
 for(const modify of [{loaded:false},{positionsError:true},{hierarchyError:true},{tenantId:''},
   {person:{...config.person,tenant_id:'tenant-B'}},{person:null},
   {links:[]},{positions:[]},{departments:null}]){
  assert.equal(isExplicitRoot({...config,...modify}),false,JSON.stringify(modify));
 }
});
test('unknown cross-tenant parent link cannot define hierarchy',()=>{
 const config=q(person('e1','General Director','HQ'));
 config.links=[...config.links,{tenant_id:'tenant-B',job_title_id:'some',reports_to_job_title_id:null}];
 assert.equal(isExplicitRoot(config),true,'other tenant links are isolated');
 config.positions[0].tenant_id='tenant-B';
 assert.equal(isExplicitRoot(config),false,'a foreign-tenant position is not eligible');
});
test('PA includes the browser helper before the PA application JS, and route snapshots remain untouched',()=>{
 const html=fs.readFileSync(path.join(root,'features/performance-appraisal/performance-appraisal.html'),'utf8');
 const script=fs.readFileSync(path.join(root,'features/performance-appraisal/js/performance-appraisal.js'),'utf8');
 const a=html.indexOf('bexhr-organization-hierarchy.js');
 const b=html.indexOf('bexhr-pa-position-root.js');
 const c=html.indexOf('src="js/performance-appraisal.js');
 assert.ok(a>=0 && b>a && c>b);
 assert.match(script,/BexHRPaPositionRoot/);
 assert.match(script,/hierarchyError =/);
 assert.match(script,/results\[2\]\.status === "rejected"/);
 assert.match(script,/managerReviewRoute/);
 assert.match(script,/BEX_PA_MANAGER_REVIEW_ROUTES/);
 assert.doesNotMatch(script,/function bexPaIsConfiguredTopLevelEmployee\([\s\S]{0,350}bexPaGetWholeOrganizationPosition/);
});
