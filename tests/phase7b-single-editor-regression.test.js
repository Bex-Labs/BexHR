'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(process.cwd(),'hr-dashboard.html'),'utf8');
const js=fs.readFileSync(path.join(process.cwd(),'js/hr-dashboard.js'),'utf8');
const css=fs.readFileSync(path.join(process.cwd(),'css/phase7b-compact-setup.css'),'utf8');
test('one visible editor manages new and existing job titles and reporting',()=>{
 assert.equal((html.match(/id="organizationJobTitleForm"/g)||[]).length,1);
 assert.equal((html.match(/id="organizationJobTitleReportsTo"/g)||[]).length,1);
 assert.doesNotMatch(html,/id="organizationJobTitleQuickEdit"/);
 assert.doesNotMatch(html,/id="newOrganizationJobTitleBtn"/);
 assert.match(html,/id="removeOrganizationJobTitleLinkBtn"/);
 assert.doesNotMatch(html,/id="organizationPositionHierarchyForm"/);
 assert.doesNotMatch(html,/id="organizationLegacyHierarchyDetails"/);
});
test('position row has exactly five columns and matching headings',()=>{
 const header=html.match(/id="organizationJobTitlesTableWrapper"[\s\S]*?<thead>([\s\S]*?)<\/thead>/)?.[1];
 assert.ok(header);
 const cols=[...header.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(x=>x[1]);
 assert.deepEqual(cols,['Job Title','Department / Scope','Reports to','Status','Actions']);
 const source=js.match(/function renderOrganizationJobTitlesTable\(\) {[\s\S]*?\n}\n\n\/\/ BEXHR PHASE 4A-2/)?.[0];
 assert.ok(source);
 assert.doesNotMatch(source,/formatDate\(jobTitle.updated_at/);
 for(const label of ['Job title','Department / Scope','Reports to','Status','Actions']){
   assert.ok(source.includes('data-label=\\\"'+label),`Missing label: ${label}`);
 }
});
test('row Edit is the only edit entrypoint and uses the create form',()=>{
 assert.match(js,/window.hrEditOrganizationJobTitleRecord/);
 assert.match(js,/function startOrganizationJobTitleEdit\(jobTitleId\)/);
 assert.match(js,/organizationJobTitleForm\?\.scrollIntoView/);
 assert.match(js,/hr_tenant_admin_save_organization_job_title_hierarchy/);
 assert.doesNotMatch(js,/populateOrganizationJobTitleQuickEditOptions/);
 assert.doesNotMatch(html,/id="organizationPositionHierarchyForm"/);
});
test('shared original record styling with preserved accessible column labels',()=>{
 assert.doesNotMatch(css, /#hrSetupSection #organizationJobTitlesTableWrapper/);
 assert.match(js, /data-label=\\"Department \/ Scope/);
 assert.match(js, /data-label=\\"Reports to/);
 assert.match(js, /data-label=\\"Status/);
 assert.match(js, /data-label=\\"Actions/);
 assert.match(html, /<th class="text-center">Actions<\/th>/);
});
