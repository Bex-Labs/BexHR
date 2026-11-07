"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=process.cwd();
const html=fs.readFileSync(path.join(root,"hr-dashboard.html"),"utf8");
const js=fs.readFileSync(path.join(root,"js/hr-dashboard.js"),"utf8");
const form=html.match(/<form id="organizationJobTitleForm"[\s\S]*?<\/form>/)?.[0];

// P7B surgical UI regression: no change to CSS files is required.
test("one simple form and no redundant position picker",()=>{
 assert.ok(form);
 assert.equal((html.match(/id="organizationJobTitleForm"/g)||[]).length,1);
 assert.doesNotMatch(html,/id="organizationJobTitleQuickEdit"|id="newOrganizationJobTitleBtn"/);
 assert.doesNotMatch(js,/populateOrganizationJobTitleQuickEditOptions/);
 assert.match(form,/id="organizationJobTitleReportsTo"/);
});
test("fields are label-aligned and explanations are optional",()=>{
 assert.match(form,/class="row g-3 align-items-start"/);
 assert.doesNotMatch(form,/align-items-end/);
 assert.match(html,/<summary class="fw-semibold">How reporting works<\/summary>/);
 assert.doesNotMatch(form,/department structures when their database rules are ready/);
 const at=id=>form.indexOf(`id="${id}"`);
 assert.ok(at('organizationJobTitleScope') < at('organizationJobTitleDepartmentId'));
 assert.ok(at('organizationJobTitleName') < at('organizationJobTitleStatus'));
 assert.ok(at('organizationJobTitleStatus') < at('organizationJobTitleReportsTo'));
});
test("department field is hidden for whole organisation without changing authority",()=>{
 assert.match(js,/departmentField\?\.classList\.toggle\("d-none", isWholeOrganization\)/);
 assert.match(js,/departmentSelect\.disabled = isWholeOrganization/);
 assert.match(js,/departmentSelect\.required = !isWholeOrganization/);
});
test("record actions match the original Department Records button alignment",()=>{
 const src=js.match(/function renderOrganizationJobTitlesTable\(\) {[\s\S]*?\n}\n\n\/\/ BEXHR PHASE 4A-2/)?.[0];
 assert.ok(src);
 assert.match(src,/text-center/);
 assert.match(src,/d-inline-flex align-items-center gap-2/);
 assert.doesNotMatch(src,/justify-content-end gap-2 flex-nowrap/);
 assert.match(src,/aria-label=\\\"Edit title and reporting/);
 assert.match(src,/aria-label=\\\"Delete job title/);
 assert.match(html,/<th class="text-center">Actions<\/th>/);
});
