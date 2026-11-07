'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bundle = path.resolve(__dirname,'..');
const page = (p) => fs.readFileSync(path.join(bundle,p),'utf8');
const code = (p) => fs.readFileSync(path.join(bundle,p),'utf8');
test('all four personas load the same tenant-aware hierarchy model before their app JS',()=>{
 for (const [p,main,src] of [
   ['hr-dashboard.html','js/hr-dashboard.js','js/bexhr-organization-hierarchy.js'],
   ['manager-dashboard.html','js/manager-dashboard.js','js/bexhr-organization-hierarchy.js'],
   ['employee-dashboard.html','js/employee-dashboard.js?v=14d','js/bexhr-organization-hierarchy.js'],
   ['features/performance-appraisal/performance-appraisal.html','js/performance-appraisal-context.js','../../js/bexhr-organization-hierarchy.js'],
 ]) {
  const html=page(p);
  assert.equal(html.split(src).length-1,1,p+' loads core once');
  assert.ok(html.indexOf(src)<html.indexOf(main),p+' loads core first');
 }
});
test('HR setup refresh emits database-backed progress and never persists a browser completion flag',()=>{
 const hr=code('js/hr-dashboard.js');
 assert.match(hr,/bexhr:organization-setup-updated/);
 assert.match(hr,/canCurrentUserMaintainOrganizationSetupData\(\)/);
 const guide=fs.readFileSync(path.join(bundle,'js/bexhr-organization-setup-guide.js'),'utf8');
 assert.ok(!/\.localStorage\b/.test(guide));
 assert.match(guide,/Continue organisation setup/);
});
test('single job-title editor keeps parent reporting and authenticated save flows',()=>{
 const html=page('hr-dashboard.html');
 const hr=code('js/hr-dashboard.js');
 assert.match(html,/<h3[^>]*>Job Titles<\/h3>/);
 assert.match(html,/id="organizationJobTitleForm"/);
 assert.match(html,/id="organizationJobTitleReportsTo"/);
 assert.match(html,/id="organizationJobTitlesTableBody"/);
 assert.match(html,/id="saveOrganizationJobTitleBtn"/);
 assert.match(html,/id="removeOrganizationJobTitleLinkBtn"/);
 // The old second reporting form was deliberately consolidated into the editor.
 assert.doesNotMatch(html,/id="organizationPositionHierarchyForm"/);
 assert.match(hr,/state\.dom\.organizationJobTitleForm\?\.addEventListener\("submit"/);
 assert.match(hr,/hr_tenant_admin_save_organization_job_title_hierarchy/);
});
