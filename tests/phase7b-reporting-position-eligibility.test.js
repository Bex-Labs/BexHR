const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname, '..');
const core=require('../js/bexhr-organization-hierarchy.js');
const rules=require('../js/bexhr-reporting-position-eligibility.js');
const hr=fs.readFileSync(path.join(root,'js/hr-dashboard.js'),'utf8');
const html=fs.readFileSync(path.join(root,'hr-dashboard.html'),'utf8');

const tenant='workspace-one';
const position=(id,job_title,department_id=null,tenant_id=tenant)=>({id,job_title,department_id,tenant_id,status:'Active'});
const edge=(job_title_id,reports_to_job_title_id,tenant_id=tenant)=>({job_title_id,reports_to_job_title_id,tenant_id});
const person=(id,job_title,department,system_role='employee',extra={})=>({id,job_title,department,system_role,tenant_id:tenant,status:'Active',work_email:`${id}@example.test`,...extra});
const departments=[{id:'d-training',tenant_id:tenant,department_name:'Training'},{id:'d-sales',tenant_id:tenant,department_name:'Sales'}];
const positions=[position('p-ceo','Managing Director'),position('p-coo','COO'),position('p-head','Training Manager','d-training'),position('p-a','Training Assistant','d-training'),position('p-peer','Sales Director','d-sales')];
const links=[edge('p-ceo',null),edge('p-coo','p-ceo'),edge('p-head','p-coo'),edge('p-a','p-head'),edge('p-peer','p-coo')];
const md=person('md','Managing Director','HQ','manager');
const coo=person('coo','COO','HQ','hr'); // Executive *with HR login role and a department*.
const head=person('head','Training Manager','Training','manager');
const assistant=person('assistant','Training Assistant','Training','employee');
const peer=person('peer','Sales Director','Sales','manager');
const team=[md,coo,head,assistant,peer];
const params=(employee,manager,opts={})=>({tenantId:tenant,employee,manager,
  positions,links,departments,employees:team,loaded:true,hierarchyCore:core,...opts});
const decision=(employee,manager,kind='primary',opts={})=>rules.evaluate({...params(employee,manager,opts),kind});

test('explicit configured root has no Primary or Secondary manager',()=>{
  for(const kind of ['primary','secondary']) {
    assert.equal(decision(md,coo,kind).allowed,false);
    assert.equal(decision(md,coo,kind).reason,'TOP_LEVEL_HAS_NO_MANAGERS');
  }
});
test('HR-role COO with HQ department is eligible parent of departmental head',()=>{
  const d=decision(head,coo);
  assert.equal(d.mode,'configured');assert.equal(d.allowed,true);
});
test('departmental Assistant follows immediate occupied parent, not hardcoded role tier',()=>{
  assert.equal(decision(assistant,head).allowed,true);
  assert.equal(decision(assistant,coo).allowed,false);
  assert.equal(decision(assistant,peer).allowed,false);
});
test('secondary manager may be configured higher ancestor but never a sibling or descendant',()=>{
  assert.equal(decision(assistant,coo,'secondary').allowed,true);
  assert.equal(decision(assistant,md,'secondary').allowed,true);
  assert.equal(decision(assistant,peer,'secondary').allowed,false);
  assert.equal(decision(head,assistant,'secondary').allowed,false);
});
test('vacant parent skips to nearest occupied ancestor for Primary',()=>{
  const withoutHead=team.filter(p=>p.id!=='head');
  const d=decision(assistant,coo,'primary',{employees:withoutHead});
  assert.equal(d.allowed,true);
  assert.equal(decision(assistant,md,'primary',{employees:withoutHead}).allowed,false);
});
test('occupied CEO above COO only Primary for COO; no CEO makes COO highest active',()=>{
  assert.equal(decision(coo,md).allowed,true);
  const withoutCEO=team.filter(p=>p.id!=='md');
  assert.equal(decision(coo,md,'primary',{employees:withoutCEO}).allowed,false);
});
test('department sibling is not an ancestor even if the manager has HR Admin permission',()=>{
  const siblingHr={...peer,system_role:'hr',hr_access_level:'admin'};
  assert.equal(decision(assistant,siblingHr,'primary').allowed,false);
});
test('same-company strict isolation prevents cross-company manager and position links',()=>{
  assert.equal(decision(assistant,{...head,tenant_id:'other'}).mode,'blocked');
  const tampered=links.map(l=>l.job_title_id==='p-a'?{...l,tenant_id:'other'}:l);
  assert.equal(decision(assistant,head,'primary',{links:tampered}).allowed,false);
});
test('partial, cyclic, ambiguous and missing hierarchy data fail closed',()=>{
  assert.equal(decision(assistant,head,'primary',{links:links.filter(l=>l.job_title_id!=='p-head')}).allowed,false);
  assert.equal(decision(assistant,head,'primary',{links:[...links.filter(l=>l.job_title_id!=='p-ceo'),edge('p-ceo','p-a')]}).allowed,false);
  assert.equal(decision(assistant,head,'primary',{positions:[...positions,position('p-duplicate','Training Assistant','d-training')]}).allowed,false);
  assert.equal(decision(assistant,head,'primary',{loaded:false}).mode,'blocked');
});
test('unconfigured departmental positions keep the default role route after backend activation',()=>{
  const oldLinks=links.filter(l=>l.job_title_id!=='p-a');
  assert.equal(decision(assistant,head,'primary',{links:oldLinks}).mode,'legacy');
  assert.equal(decision(assistant,head,'primary',{links:oldLinks,departmentReportingEnabled:true}).mode,'legacy');
  assert.equal(decision(coo,md,'primary',{links:links.filter(l=>l.job_title_id!=='p-coo'),departmentReportingEnabled:true}).mode,'blocked');
  assert.equal(decision(assistant,head,'primary',{links:oldLinks,departmentReportingEnabled:true,
      positions:[...positions,position('p-ambiguous','Training Assistant','d-training')]}).mode,'blocked');
  assert.equal(decision(assistant,head,'primary',{links:oldLinks,departmentReportingEnabled:true,
      employee:{...assistant,organization_job_title_id:'invalid'}}).mode,'blocked');
});
test('existing role and Supabase write guards stay independent of structural eligibility',()=>{
  const start=hr.indexOf('function getHrConfiguredReportingEligibility(');
  const end=hr.indexOf('function getHrPrimaryReportingDescendantIds(',start);
  assert.ok(start>0 && end>start);
  const ctx=vm.createContext({
    state:{currentProfile:{tenant_id:tenant},employees:team,organizationJobTitles:positions,
      organizationJobTitleHierarchy:links,organizationDepartments:departments,
      organizationPositionHierarchyLoaded:true,p7bDepartmentReportingEnabled:false},
    BexHROrganizationHierarchy:core,BexHRReportingPositionEligibility:rules,
    normalizeText:v=>String(v||'').trim().toLowerCase(),
    formatEmployeeAccessRoleLabel:e=>e.hr_access_level==='admin'?'HR Admin':'HR Standard',
    isHrWholeOrganizationEmployee:e=>!e?.department_id && ['COO','Managing Director'].includes(e?.job_title),
    getOrganizationJobTitleRecordById:id=>positions.find(p=>p.id===id),
    getOrganizationPositionHierarchyRecord:id=>links.find(l=>l.job_title_id===id),
  });
  vm.runInContext(hr.slice(start,end),ctx);
  ctx.head=head;ctx.coo=coo;ctx.assistant=assistant;ctx.employeeWithoutManagerRole={...head,system_role:'employee'};
  assert.equal(vm.runInContext('canHrPrimaryReportingManagerSitImmediatelyAboveEmployee(coo,head)',ctx),true);
  assert.equal(vm.runInContext('isHrReportingManagerCandidate(coo,head)',ctx),true);
  assert.equal(vm.runInContext('canHrPrimaryReportingManagerSitImmediatelyAboveEmployee(employeeWithoutManagerRole,assistant)',ctx),false);
  assert.equal(vm.runInContext('canHrReportingManagerSitAboveEmployee(coo,assistant)',ctx),true);
});
test('single shared eligibility gate feeds both edit and reporting-line modal, with original approval protection',()=>{
  assert.match(hr,/getHrReportingManagerCandidatesForEmployee\(\s*targetEmployee,/);
  assert.match(hr,/!canHrPrimaryReportingManagerSitImmediatelyAboveEmployee\(manager, employee\)/);
  assert.match(hr,/getHrReportingManagerCandidatesForEmployee\(employee,\s*\{\s*primaryOnly: false/);
  assert.match(hr,/isHrPrimaryManagerHierarchySafe\(/);
  assert.match(hr,/hasHrReportingManagerRole\(manager\)/);
  assert.match(html,/bexhr-organization-hierarchy\.js[\s\S]*bexhr-reporting-position-eligibility\.js[\s\S]*hr-dashboard\.js/);
});
