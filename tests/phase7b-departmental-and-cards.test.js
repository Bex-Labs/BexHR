"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const js=read('js/hr-dashboard.js');
const css=read('css/phase7b-compact-setup.css');
const html=read('hr-dashboard.html');

test('department reporting enables only after explicit server capability',()=>{
 assert.match(js,/supabase\.rpc\("bexhr_p7b_structure_capabilities"\)/);
 assert.match(js,/!reportingCapabilitiesResponse\?\.error/);
 assert.match(js,/capabilities\?\.department_positions === true/);
 assert.match(js,/capabilities\?\.atomic_position_save === true/);
 assert.match(js,/state\.p7bDepartmentReportingEnabled = false/);
});
test('department title creation uses one atomic authenticated server RPC when ready',()=>{
 assert.match(js,/hr_tenant_admin_save_position_with_reporting/);
 assert.match(js,/p_reports_to_job_title_id: selectedParentId/);
 assert.match(js,/p_configure_reporting: requiresPositionLink/);
 assert.match(js,/if \(!state.p7bDepartmentReportingEnabled && requiresPositionLink\)/);
});
test('departmental parent options are restricted to configured tenant positions',()=>{
 assert.match(js,/function getActiveOrganizationJobTitles\(\)/);
 assert.match(js,/rowTenant === currentTenant/);
 assert.match(js,/!descendants\.has\(candidateId\)/);
 assert.match(js,/getOrganizationPositionHierarchyRecord\(candidateId\)/);
 assert.match(js,/getActiveWholeOrganizationJobTitles\(\)/);
});
test('one screen, no redundant editor, no implicit roots',()=>{
 assert.equal((html.match(/id="organizationJobTitleForm"/g)||[]).length,1);
 assert.doesNotMatch(html,/id="organizationPositionHierarchyForm"/);
 assert.doesNotMatch(html,/id="organizationJobTitleQuickEdit"/);
 assert.match(js,/ORGANIZATION_POSITION_HIERARCHY_TOP_LEVEL_VALUE/);
 assert.match(js,/const parentSelected = Boolean/);
});
test('job title records use original shared BexHR record and button styling',()=>{
 assert.doesNotMatch(css, /#hrSetupSection #organizationJobTitlesTableWrapper/);
 assert.match(css, /#bexhrOrganizationSetupGuide\.bexhr-setup-compact/);
 assert.match(js, /<td class=\\"text-center\\" data-label=\\"Actions/);
 assert.match(js, /d-inline-flex align-items-center gap-2/);
 assert.doesNotMatch(js, /justify-content-end gap-2 flex-nowrap/);
 assert.match(html, /<th class="text-center">Actions<\/th>/);
});
test('pure organisation model resolves department parents across scopes without role ladders',()=>{
 const {createModel}=require('../js/bexhr-organization-hierarchy.js');
 const tenant='TENANT_A';
 const positions=[
  {id:'CEO',tenant_id:tenant,job_title:'Director',department_id:null,status:'Active'},
  {id:'COO',tenant_id:tenant,job_title:'Operations Head',department_id:null,status:'Active'},
  {id:'TRN',tenant_id:tenant,job_title:'Training Manager',department_id:'dept-training',status:'Active'},
  {id:'SUP',tenant_id:tenant,job_title:'Training Supervisor',department_id:'dept-training',status:'Active'},
 ];
 const links=[
  {tenant_id:tenant,job_title_id:'CEO',reports_to_job_title_id:null},
  {tenant_id:tenant,job_title_id:'COO',reports_to_job_title_id:'CEO'},
  {tenant_id:tenant,job_title_id:'TRN',reports_to_job_title_id:'COO'},
  {tenant_id:tenant,job_title_id:'SUP',reports_to_job_title_id:'TRN'},
 ];
 const employees=[
  {id:'head',tenant_id:tenant,job_title:'Operations Head',department:'HQ',system_role:'hr',status:'Active'},
  {id:'training',tenant_id:tenant,job_title:'Training Manager',department:'Training',system_role:'manager',status:'Active'},
  {id:'supervisor',tenant_id:tenant,job_title:'Training Supervisor',department:'Training',system_role:'employee',status:'Active'},
 ];
 const departments=[{id:'dept-training',tenant_id:tenant,department_name:'Training'}];
 const model=createModel({tenantId:tenant,positions,links,employees,departments});
 assert.equal(model.nearestOccupiedAncestor('training').occupants[0].id,'head');
 assert.equal(model.primaryPositionEligibility('supervisor','training').code,'ELIGIBLE');
 assert.equal(model.primaryPositionEligibility('supervisor','head').code,'WRONG_PARENT_POSITION');
 assert.equal(model.nearestOccupiedAncestor('head').code,'HIGHEST_OCCUPIED');
});
