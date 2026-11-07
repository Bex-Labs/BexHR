// BexHR Phase 7B unit/contract fixtures (Node built-in test runner).
// Run after guarded installer: node tests/phase7b-hierarchy-regression.test.js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const hr=fs.readFileSync(path.join(root,'js/hr-dashboard.js'),'utf8');
const manager=fs.readFileSync(path.join(root,'js/manager-dashboard.js'),'utf8');
const pa=fs.readFileSync(path.join(root,'features/performance-appraisal/js/performance-appraisal.js'),'utf8');

const a=hr.indexOf('const HR_REPORTING_MANAGER_ELIGIBLE_ROLES');
const b=hr.indexOf('function getHrPrimaryReportingDescendantIds(',a);
assert.ok(a>=0 && b>a,'HR reporting predicate region exists');
const normalizeText=(v)=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');

function createContext(occupants, titles, hierarchy,loaded=true){
  const state={
    currentProfile:{tenant_id:'tenant-A'},
    organizationJobTitles:titles,
    organizationJobTitleHierarchy:hierarchy,
    organizationPositionHierarchyLoaded:loaded,
    employees:occupants,
  };
  const ctx=vm.createContext({
    state,Set,
    normalizeText,
    isHrWholeOrganizationEmployee:e=>Boolean(e?.wholeOrg),
    isHrManagerInEmployeeDepartment:(m,e)=>m?.tenant_id===e?.tenant_id && m?.id!==e?.id &&
      (m.wholeOrg || m.hrAdmin || normalizeText(m.department)===normalizeText(e.department)),
    formatEmployeeAccessRoleLabel:e=>e?.hrAdmin?'HR Admin':'HR Standard',
    getOrganizationJobTitleRecordById:id=>titles.find(x=>String(x.id)===String(id))||null,
    getOrganizationPositionHierarchyRecord:id=>hierarchy.find(x=>String(x.job_title_id)===String(id))||null,
  });
  vm.runInContext(hr.slice(a,b),ctx);
  return {
    ctx,state,
    primary:(m,e)=>vm.runInContext('canHrPrimaryReportingManagerSitImmediatelyAboveEmployee(m,e)',Object.assign(ctx,{m,e})),
    secondary:(m,e)=>vm.runInContext('canHrReportingManagerSitAboveEmployee(m,e)',Object.assign(ctx,{m,e})),
  };
}
const person=(id,title,wholeOrg,system_role='manager',tenant_id='tenant-A')=>({
  id,job_title:title,wholeOrg,system_role,tenant_id,status:'active',
  work_email:id+'@example.invalid',department:wholeOrg?'':'Operations',
});
const position=(id,title,tenant_id='tenant-A')=>({id,job_title:title,tenant_id,status:'active',department_id:null});
const edge=(id,parent,tenant_id='tenant-A')=>({job_title_id:id,reports_to_job_title_id:parent,tenant_id});

function fixture(){
  const ceo=person('ceo','CEO',true);
  const coo=person('coo','COO',true);
  const manager=person('manager','Operations Manager',false);
  const hrAdmin={...person('hr-admin','HR Admin',false,'hr'),hrAdmin:true};
  return {ceo,coo,manager,hrAdmin,positions:[position('p-ceo','CEO'),position('p-coo','COO')],
    edges:[edge('p-ceo',null),edge('p-coo','p-ceo')]};
}

test('CEO explicit root has neither Primary nor Secondary candidates',()=>{
 const f=fixture();const c=createContext([f.ceo,f.coo],f.positions,f.edges);
 assert.equal(c.primary(f.coo,f.ceo),false);
 assert.equal(c.secondary(f.coo,f.ceo),false);
});
test('COO has exactly CEO as occupied Primary parent; not COO peer',()=>{
 const f=fixture();const otherCoo=person('coo2','COO',true);
 const c=createContext([f.ceo,f.coo,otherCoo],f.positions,f.edges);
 assert.equal(c.primary(f.ceo,f.coo),true);
 assert.equal(c.primary(otherCoo,f.coo),false);
 assert.equal(c.secondary(f.ceo,f.coo),true);
});
test('HR Admin falls back to nearest lowest occupied executive',()=>{
 const f=fixture();const all=createContext([f.ceo,f.coo,f.hrAdmin],f.positions,f.edges);
 assert.equal(all.primary(f.coo,f.hrAdmin),true);
 assert.equal(all.primary(f.ceo,f.hrAdmin),false);
 const vacantCoo=createContext([f.ceo,f.hrAdmin],f.positions,f.edges);
 assert.equal(vacantCoo.primary(f.ceo,f.hrAdmin),true);
 const vacantBoth=createContext([f.hrAdmin],f.positions,f.edges);
 assert.equal(vacantBoth.primary(f.ceo,f.hrAdmin),false);
});
test('CEO vacant: COO is acting highest occupied and cannot report',()=>{
 const f=fixture();const c=createContext([f.coo,f.hrAdmin],f.positions,f.edges);
 assert.equal(c.primary(f.ceo,f.coo),false);
 assert.equal(c.secondary(f.ceo,f.coo),false);
 assert.equal(c.primary(f.coo,f.hrAdmin),true);
});
test('arbitrary custom Managing Director root cannot report to COO',()=>{
 const f=fixture();const md=person('md','Managing Director',true);
 const director=person('director','Executive Director',true);
 const titles=[...f.positions,position('p-md','Managing Director'),position('p-director','Executive Director')];
 const edges=[...f.edges,edge('p-md',null),edge('p-director','p-md')];
 const c=createContext([md,director,f.coo],titles,edges);
 assert.equal(c.primary(f.coo,md),false);
 assert.equal(c.secondary(f.coo,md),false);
 assert.equal(c.primary(md,director),true);
});
test('vacant intermediate position is skipped to nearest occupied ancestor',()=>{
 const f=fixture();const exec=person('exec','Executive Director',true);
 const positions=[...f.positions,position('p-exec','Executive Director')];
 const edges=[...f.edges,edge('p-exec','p-coo')];
 const c=createContext([f.ceo,exec],positions,edges);
 assert.equal(c.primary(f.ceo,exec),true);
});
test('ambiguous or unloaded tenant hierarchy fails closed',()=>{
 const f=fixture();const a=createContext([f.ceo,f.coo],f.positions,f.edges,false);
 assert.equal(a.primary(f.ceo,f.coo),false);
 const b=createContext([f.ceo,f.coo],[...f.positions,position('p-coo2','COO')],f.edges);
 assert.equal(b.primary(f.ceo,f.coo),false);
});
test('cross-tenant organization manager is never a candidate',()=>{
 const f=fixture();const other={...f.ceo,tenant_id:'tenant-B'};
 const c=createContext([other,f.coo],f.positions,f.edges);
 assert.equal(c.primary(other,f.coo),false);
});
test('modal does not trust a stale/manipulated Primary dropdown value',()=>{
 const start=hr.indexOf('async function assignHrPrimaryManagerFromModal()');
 const end=hr.indexOf('async function removeHrPrimaryManagerFromModal(',start);
 assert.ok(start>=0 && end>start);
 const fn=hr.slice(start,end);
 assert.match(fn,/!canHrPrimaryReportingManagerSitImmediatelyAboveEmployee\(manager, employee\)/);
});
test('Secondary modal rechecks descendant and position candidate list',()=>{
 const start=hr.indexOf('async function addHrSupportingManagerFromModal()');
 const end=hr.indexOf('async function removeHrSupportingManagerFromModal(',start);
 assert.ok(start>=0 && end>start);
 assert.match(hr.slice(start,end),/getHrReportingManagerCandidatesForEmployee\(employee,/);
});
test('HR/Manager chooser and PA agree with multiple Active cycles',()=>{
 for(const code of [hr,manager]){
   assert.match(code,/return activeCycles\.every\(\(cycle\) => \{/);
   assert.ok(!code.includes('participationAwareCycles.every('));
 }
 const start=pa.indexOf('function bexPaIsEmployeeExcludedFromActiveCycleSnapshot(');
 const end=pa.indexOf('function bexPaIsCurrentEmployeeExcludedFromActiveCycle(',start);
 assert.ok(start>=0 && end>start);
 const ctx=vm.createContext({});
 vm.runInContext(pa.slice(start,end),ctx);
 const snapshots=[
   {status:'Active',payload:{participationSnapshot:{excludedEmployeeIds:['e1']}}},
   {status:'Active',payload:{participationSnapshot:{excludedEmployeeIds:[]}}},
 ];
 ctx.cycles=snapshots;
 assert.equal(vm.runInContext("bexPaIsEmployeeExcludedFromActiveCycleSnapshot(cycles,'e1')",ctx),false);
 snapshots[1].payload.participationSnapshot.excludedEmployeeIds=['e1'];
 assert.equal(vm.runInContext("bexPaIsEmployeeExcludedFromActiveCycleSnapshot(cycles,'e1')",ctx),true);
 snapshots[1].payload.participationSnapshot=null;
 assert.equal(vm.runInContext("bexPaIsEmployeeExcludedFromActiveCycleSnapshot(cycles,'e1')",ctx),false);
});
