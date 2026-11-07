'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=process.cwd();
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const html=read('hr-dashboard.html');
const hr=read('js/hr-dashboard.js');
const guide=read('js/bexhr-organization-setup-guide.js');
const css=read('css/phase7b-compact-setup.css');
const {evaluate}=require(path.join(repo,'js/bexhr-organization-setup-guide.js'));

test('compact banner has exactly one CTA and one progress element',()=>{
 assert.match(guide,/banner\.append\(copy, footer\)/);
 assert.match(guide,/className = 'bexhr-setup-compact'/);
 assert.match(guide,/textContent = 'Continue organisation setup'/);
 assert.match(guide,/bexhr-setup-compact-progress/);
 assert.doesNotMatch(guide,/Your progress is saved automatically when you save each record/);
 assert.match(css,/max-width: 640px/);
});
test('setup reminder is admin only and disappears on completion',()=>{
 assert.equal(evaluate({canMaintain:false,loaded:true}).show,false);
 assert.equal(evaluate({canMaintain:true,loaded:true,activeDepartments:1,activeTitles:1,activeLinks:1,unconfiguredPositions:0}).show,false);
 assert.equal(evaluate({canMaintain:true,loaded:true,activeDepartments:1,activeTitles:1,activeLinks:0,unconfiguredPositions:1}).show,true);
});
test('department titles do not create impossible company-wide setup requirement',()=>{
 assert.match(hr,/const wholeOrganizationPositions = activePositions\.filter/);
 assert.match(hr,/state.p7bDepartmentReportingEnabled/);
 assert.match(hr,/activePositions : wholeOrganizationPositions/);
 assert.match(hr,/!String\(row\.department_id \|\| ''\)\.trim\(\)/);
});
test('reports-to is in the job title form, not a second required page',()=>{
 const form=html.match(/<form id="organizationJobTitleForm"[\s\S]*?<\/form>/)?.[0];
 assert.ok(form);
 assert.match(form,/id="organizationJobTitleReportsTo"/);
 assert.match(form,/id="saveOrganizationJobTitleBtn"/);
 assert.doesNotMatch(html,/id="organizationLegacyHierarchyDetails"/);
 assert.doesNotMatch(html,/id="organizationPositionHierarchyForm"/);
 assert.doesNotMatch(html,/id="organizationJobTitleQuickEdit"/);
 assert.doesNotMatch(html,/id="newOrganizationJobTitleBtn"/);
 assert.match(html,/<th>Reports to<\/th>/);
});
test('new root is a deliberate selection; no blind default',()=>{
 assert.match(hr,/\['', 'Choose reporting position'\]/);
 assert.match(hr,/\[ORGANIZATION_POSITION_HIERARCHY_TOP_LEVEL_VALUE, 'Top level \(no parent\)'\]/);
 assert.match(hr,/const previouslySelected = String\(select\.dataset\.editingPositionId/);
 assert.match(hr,/parentSelected/);
 assert.match(hr,/!requiresParent \|\| parentSelected/);
});
test('only existing configured whole-organisation parents are selectable',()=>{
 assert.match(hr,/getActiveWholeOrganizationJobTitles\(\)\.filter|getActiveWholeOrganizationJobTitles\(\)\)\.filter/);
 assert.match(hr,/getOrganizationPositionHierarchyRecord\(candidateId\)/);
 assert.match(hr,/!descendants\.has\(candidateId\)/);
 assert.match(hr,/rowTenant === currentTenant/);
});
test('job-title save then hierarchy save never claims full success on partial failure',()=>{
 assert.match(hr,/hr_tenant_admin_save_organization_job_title_hierarchy/);
 assert.match(hr,/if \(hierarchyResponse\.error\)/);
 assert.match(hr,/The job title was saved, but its reporting link was not/);
 assert.match(hr,/startOrganizationJobTitleEdit\(savedRecord\.id\)/);
 assert.match(hr,/if \(!state.p7bDepartmentReportingEnabled && requiresPositionLink\)/);
 assert.match(hr,/hr_tenant_admin_save_position_with_reporting/);
});
