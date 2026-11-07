#!/usr/bin/env node
'use strict';
// Behavioral slices use the actual Phase 7A12 function bodies from this repo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.BEXHR_PHASE7A12_TEST_ROOT || path.resolve(__dirname, '..');
const hr = fs.readFileSync(path.join(root,'js/hr-dashboard.js'),'utf8').replace(/\r\n?/g,'\n');
const manager = fs.readFileSync(path.join(root,'js/manager-dashboard.js'),'utf8').replace(/\r\n?/g,'\n');
const session = fs.readFileSync(path.join(root,'js/session.js'),'utf8').replace(/\r\n?/g,'\n');
const html = fs.readFileSync(path.join(root,'hr-dashboard.html'),'utf8');
function slice(s,a,b) {
  const p=s.indexOf(a);
  const q=s.indexOf(b,p+a.length);
  assert(p>=0 && q>p,`Missing function range ${a} -> ${b}`);
  assert(s.indexOf(a,p+a.length)<0,`Ambiguous start marker: ${a}`);
  return s.slice(p,q);
}
function run(context,code) { vm.runInNewContext(code,context,{timeout:2500}); return context; }
function base(){return {Promise,Date,console:{log(){},warn(){},error(){}},normalizeText:v=>String(v||'').trim().toLowerCase()};}
async function tests(){
  // Active headcount is primary, and history is explanatory. The archive remains.
  assert.match(html,/hr-overview-metric-label">Active employees</);
  assert.match(html,/hr-people-summary-label">Employee Records</);
  assert.match(hr,/state\.dom\.hrOverviewTotalEmployees\.textContent = String\(activeEmployees\.length\)/);
  const counter=slice(hr,'  if (state.dom.hrOverviewTotalEmployees) {','  if (state.dom.hrOverviewPayrollReady) {');
  const context=base();
  context.state={dom:{hrOverviewTotalEmployees:{textContent:''},hrOverviewActiveEmployees:{textContent:''}}};
  context.employees=[{status:'Active'},{status:'Active'},{status:'Active'},{status:'Active'},{status:'Active'},{status:'Exited'}];
  context.activeEmployees=context.employees.filter(x=>x.status==='Active');
  run(context,counter);
  assert.equal(context.state.dom.hrOverviewTotalEmployees.textContent,'5');
  assert.equal(context.state.dom.hrOverviewActiveEmployees.textContent,'6 employee records \u00b7 1 exited');
  
  // Refresh must wait for employees before salary; render both operational and
  // historical tables; duplicate concurrent refreshes must share one read pass.
  const refresh=slice(hr,'let hrLifecycleRefreshPromise = null;','const HR_EMPLOYEE_LIFECYCLE_SYNC_STORAGE_KEY');
  const order=[];const d=base();
  d.state={employees:[]};
  let employeesLoads=0;
  Object.assign(d,{
    loadEmployees:async()=>{employeesLoads++;order.push('employees');await Promise.resolve();d.state.employees=[{id:'e1',status:'Active'}];},
    loadAuthProfilesForLinkage:async()=>{assert.equal(d.state.employees.length,1);order.push('profiles');},
    loadPayrollMasterRecords:async()=>{assert.equal(d.state.employees.length,1);order.push('salary');},
    loadHrPrimaryReportingHierarchy:async()=>{order.push('hierarchy');},
    applyEmployeeSearch:()=>{order.push('list');},
    populatePayrollEmployeeOptions:()=>{order.push('payrollOptions');},
    populatePayrollMasterEmployeeOptions:()=>{order.push('salaryOptions');},
    populateEmployeeBankEmployeeOptions:()=>{order.push('bankOptions');},
    populateAssignedLineManagerOptions:()=>{order.push('managerOptions');},
    renderHrModernOverview:()=>{order.push('overview');},
  });
  run(d,refresh+'\nthis.testRefresh = refreshHrAfterEmployeeLifecycleChange;');
  await Promise.all([d.testRefresh(),d.testRefresh()]);
  assert.equal(employeesLoads,1);
  assert.equal(order[0],'employees');
  assert(order.indexOf('salary')<order.indexOf('hierarchy'));
  assert(order.indexOf('profiles')<order.indexOf('list'));
  assert(order.indexOf('hierarchy')<order.indexOf('list'));
  assert(order.indexOf('list')<order.indexOf('overview'));
  for(const required of ['payrollOptions','salaryOptions','bankOptions','managerOptions']) assert(order.includes(required));

  // Event broadcast is tenant tagged and publishes no payroll/history data.
  const events=[];const localStorage={setItem(key,value){events.push({kind:'storage',key,value})}};
  const b=base();
  b.state={currentProfile:{tenant_id:'t1'}};
  b.CustomEvent=function(name,args){this.type=name;this.detail=args.detail;};
  b.window={dispatchEvent(ev){events.push({kind:'event',event:ev})},localStorage};
  run(b,slice(hr,'const HR_EMPLOYEE_LIFECYCLE_SYNC_STORAGE_KEY =','function getHrEmployeeLifecycleStateSignature'));
  run(b,'publishHrEmployeeLifecycleChange("e1","offboard")');
  const notice=events.find(e=>e.kind==='storage');
  assert.equal(notice.key,'bexhrEmployeeLifecycleSync');
  assert.equal(JSON.parse(notice.value).tenantId,'t1');
  assert.equal(JSON.parse(notice.value).reason,'offboard');
  assert.equal(events.find(e=>e.kind==='event').event.type,'bexhr:employee-lifecycle-changed');

  // Data poll is read-only, active-profile-gated, and reloads only on changes.
  const chk=base();let profileAllowed=true;let newData=[{id:'e1',status:'Active'}];let queryCount=0;let refreshCount=0;
  chk.state={currentUser:{id:'u1'},currentProfile:{tenant_id:'t1'},employees:[{id:'e1',status:'Active'}]};
  chk.document={hidden:false};
  chk.window={SessionManager:{revalidateActiveProfile:async()=>profileAllowed}};
  chk.getSupabaseClient=()=>({from:table=>({select:cols=>({table,cols})})});
  chk.applyCurrentTenantFilter=async query=>{assert.equal(query.table,'employees');assert.equal(query.cols,'id,status');queryCount++;return {data:newData,error:null};};
  chk.refreshHrAfterEmployeeLifecycleChange=async()=>{refreshCount++;};
  run(chk,'let hrLifecycleRefreshPromise = null;\n'+slice(hr,'const HR_EMPLOYEE_LIFECYCLE_SYNC_STORAGE_KEY =','async function submitEmployeeOffboarding() {'));
  // Above includes the broadcast + signature + foreground poll, but the
  // function range ends before submit to avoid evaluating unrelated code.
  await vm.runInNewContext('checkForHrEmployeeLifecycleChanges()',chk,{timeout:2000});
  assert.equal(refreshCount,0);assert.equal(queryCount,1);
  // Time throttle can be reset in this isolated lexical environment.
  vm.runInNewContext('lastHrLifecycleForegroundCheckAt=0',chk);
  newData=[{id:'e1',status:'Exited'}];
  await vm.runInNewContext('checkForHrEmployeeLifecycleChanges()',chk,{timeout:2000});
  assert.equal(refreshCount,1);
  vm.runInNewContext('lastHrLifecycleForegroundCheckAt=0',chk);
  profileAllowed=false;
  await vm.runInNewContext('checkForHrEmployeeLifecycleChanges()',chk,{timeout:2000});
  assert.equal(queryCount,2,'Disabled caller must not poll company data');
  assert.match(hr,/publishHrEmployeeLifecycleChange\(employeeId, "offboard"\)/);
  assert.match(hr,/publishHrEmployeeLifecycleChange\(employeeId, "reactivate"\)/);
  assert.match(hr,/publishHrEmployeeLifecycleChange\(savedEmployeeId, isEditMode/);
  assert.match(hr,/publishHrEmployeeLifecycleChange\("", "batch_employees_created"\)/);
  assert.match(hr,/window\.addEventListener\("storage", \(event\) => \{\s*if \(event\.key !== HR_EMPLOYEE_LIFECYCLE_SYNC_STORAGE_KEY\)/);

  // Phase 7B: executive display depends on the protected self-position RPC,
  // never a guessed CEO/COO string or a signed-in user's application role.
  const status = require('../js/bexhr-manager-organization-status.js');
  assert.doesNotMatch(manager, /getManagerExecutiveDisplayPosition/);
  assert.match(manager, /hierarchyStatusApi\.load\(supabase, currentManagerId\)/);
  assert.match(manager, /String\(state\.currentProfile\?\.tenant_id \|\| ''\)/);
  const claimed = status.presentation({status:'CONFIGURED_ROOT',position_title:'CEO'});
  assert.match(claimed.label, /Top level/);
  assert.match(claimed.decisionAuthority, /Primary Manager/);
  const highest = status.presentation({status:'HIGHEST_OCCUPIED',position_title:'COO'});
  assert.match(highest.label, /Highest active/);
  assert.match(highest.decisionAuthority, /Primary Manager/);
  assert.equal(status.presentation({status:'INVALID',position_title:'CEO'}).label, 'Manager');
  assert.equal((manager.match(/coverageMode = positionDisplay\.label/g)||[]).length,2,
    'Both coverage renderers use protected position status rather than title guesses');

  // Manager Overview (not just Team) refreshes when lifecycle changes.
  const f=base();let active=true;let managerRefreshes=0;
  f.document={hidden:false};
  f.state={dom:{managerTeamSection:{classList:{contains:()=>true}},managerDashboardSection:{classList:{contains:()=>false}}},isTeamAssignmentFocusRefreshInProgress:false,lastTeamAssignmentFocusRefreshAt:0};
  f.window={SessionManager:{revalidateActiveProfile:async()=>active}};
  f.refreshManagerWorkspace=async()=>{managerRefreshes++;};
  run(f,slice(manager,'async function refreshManagerTeamAssignmentsOnFocus(','// BEXHR R-14B LIVE REPORTING HIERARCHY REFRESH')+'\nthis.refreshFocus = refreshManagerTeamAssignmentsOnFocus;');
  await f.refreshFocus(true);
  assert.equal(managerRefreshes,1);
  active=false;
  await f.refreshFocus(true);
  assert.equal(managerRefreshes,1,'inactive manager cannot refresh team');
  assert.match(manager,/event\.key !== "bexhrEmployeeLifecycleSync"/);
  assert.match(manager,/if \(!document\.hidden\) void refreshManagerWorkspaceFromHierarchySync\(\)/);

  // Active session is enforced on page entry AND after the page was opened.
  const guard=base();let profile={id:'u1',role:'manager',is_active:false};const signouts=[];
  guard.requireAuth=async()=>({user:{id:'u1'}});
  guard.readProfileStatus=async()=>({status:"found",profile});
  guard.logoutUser=async reason=>signouts.push(reason);
  guard.roleMatches=()=>true;
  guard.hasRequiredHrMfaAssurance=async()=>true;
  guard.window={location:{pathname:'/manager-dashboard.html'}};
  guard.redirectToRoleDashboard=()=>assert.fail('disabled account must never role-redirect');
  guard.hasManagerWorkspaceAccess=async()=>false;
  run(guard,slice(session,'async function requireRole(expectedRole) {','async function protectPage(expectedRole = null) {')+'\nthis.requireRole = requireRole;');
  assert.equal(await guard.requireRole('manager'),null);
  assert.deepEqual(signouts,['unauthorized']);
  profile={id:'u1',role:'manager',is_active:true};
  assert.equal((await guard.requireRole('manager')).profile.is_active,true);
  const live=base();const eventsLive=[];let freshProfile={id:'u1',is_active:true};let liveFetchCount=0;
  live.getSession=async()=>({user:{id:'u1'}});
  live.readProfileStatus=async()=>{liveFetchCount++;return {status:"found",profile:freshProfile};};
  live.logoutUser=async r=>eventsLive.push(r);
  live.document={hidden:false,addEventListener(){}};
  live.window={addEventListener(){},setInterval(){return 1},clearInterval(){}};
  run(live,slice(session,'let activeProfileLifecycleCheckPromise = null;','function attachSessionRecoveryListeners() {')+'\nthis.checkActive = revalidateActiveProfile;');
  assert.equal(await live.checkActive(),true);
  freshProfile={id:'u1',is_active:false};
  assert.equal(await live.checkActive(),false);
  assert.deepEqual(eventsLive,['unauthorized']);
  assert.equal(liveFetchCount,2);
  assert.match(session,/attachActiveProfileLifecycleChecks\(\);/);
  assert.match(session,/if \(profile\.is_active !== true\) \{\s*await logoutUser\("unauthorized"\)/);
  assert.match(session,/activeProfileLifecycleTimerId = window\.setInterval\(/);
  assert.match(session,/stopActiveProfileLifecycleChecks\(\)/);

  // No backend authorization or appraisal logic changed by the UI patch.
  assert.match(manager,/"get_manager_reporting_line_assignments"/);
  assert.match(manager,/isPrimaryReportingManagerRelationship/);
  assert.match(hr,/saveEmployeeReportingLinesForEmployee\(savedEmployeeId\)/);
  console.log('PASS: Phase 7A12 active headcount and archived records; lifecycle cross-tab/foreground reconciliation; self-position RPC-backed display with no title grants; live inactive-profile lock. Offline mock only.');
}
tests().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
