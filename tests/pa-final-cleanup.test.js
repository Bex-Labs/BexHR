"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pa = fs.readFileSync(path.join(root, "features", "performance-appraisal", "js", "performance-appraisal.js"), "utf8");
const html = fs.readFileSync(path.join(root, "features", "performance-appraisal", "performance-appraisal.html"), "utf8");
const docs = fs.readFileSync(path.join(root, "features", "performance-appraisal", "docs", "DATA-MODEL.md"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261101064500_pa_final_cleanup.sql"), "utf8");

new Function(pa);

for (const id of [
  "bexPaOrganisationGoalOwner",
  "bexPaDeliverableOwner",
  "bexPaDepartmentGoalOwner",
]) {
  assert.equal(html.includes(id), false, id + " must be removed from the current PA form UI");
}

for (const marker of [
  "organisationGoalOwner",
  "deliverableOwner",
  "departmentGoalOwner",
  "bexPaPopulatePositionOwners",
]) {
  assert.equal(pa.includes(marker), false, marker + " must no longer drive current PA forms");
}

assert.equal(pa.includes('bexPaCreateGoalIdentityMeta(\n        "Owner"'), false, "Current goal cards must not display an empty Responsible owner field");
assert.ok(pa.includes("function bexPaShowSingleActiveCycleMessage"), "Browser single-Active guard must exist");
assert.ok(pa.includes("BEXHR_PA_SINGLE_ACTIVE_CYCLE"), "Browser must handle the database single-Active marker");
assert.ok(migration.includes("bexhr_enforce_pa_single_active_cycle"), "Database single-Active trigger must exist");
assert.ok(migration.includes("pg_advisory_xact_lock"), "Activation attempts must be serialized");
assert.equal(/update\s+public\.pa_cycles/i.test(migration), false, "Migration must not rewrite existing Active cycle rows");
assert.ok(pa.includes('.from("organization_job_title_hierarchy")'), "HR Admin story must read configured position hierarchy");
assert.ok(pa.includes('"__top_level"'), "Configured top-level story sentinel must exist");
assert.ok(pa.includes('"Whole organization"'), "Whole organization label must remain explicit");
assert.ok(
  pa.includes("function bexPaDisplayDepartmentLabel"),
  "PA must centralize employee department display resolution",
);
assert.equal(
  pa.includes("Unknown department"),
  false,
  "PA must not expose Unknown department anywhere",
);
assert.equal(
  (pa.match(/Department not recorded/g) || []).length,
  1,
  "PA must keep Department not recorded only as the canonical genuine-missing fallback",
);

assert.ok(
  pa.includes("BEX_PA_GLOBAL_BUTTON_FEEDBACK_BOOTSTRAP"),
  "Immediate button feedback must boot globally for every PA workspace",
);
assert.ok(
  /bexPaGoalRowDepartmentLabel\(\s*linkedIndividualGoal/.test(pa),
  "Department display must reuse the persisted Individual Goal row when available",
);
assert.ok(
  pa.includes("bexPaStoryDepartmentLabel(person)"),
  "Department display must reuse hierarchy-aware person resolution",
);
assert.ok(
  pa.includes("function bexPaInstallImmediateButtonFeedback"),
  "PA must install system-wide immediate button feedback",
);
assert.ok(
  html.includes('id="bexPaImmediateButtonFeedbackStyle"'),
  "PA must include the immediate button feedback style",
);
assert.ok(
  html.includes("bex-pa-action-pressed"),
  "PA button feedback style must respond to the shared pressed state",
);

assert.ok(docs.includes("current goal creation does not require a separate Responsible owner field"), "PA data-model note must match simplified forms");

assert.ok(pa.includes("BEX_PA_DATE_INHERITANCE_V1"), "PA date inheritance refinement marker must exist");
assert.ok(pa.includes("bexPaApplyOrganisationGoalDateInheritance"), "Organisation Goal dates must inherit from the appraisal cycle");
assert.ok(pa.includes("bexPaApplyDeliverableDateInheritance"), "Deliverable dates must inherit from the Organisation Goal");
assert.ok(pa.includes("bexPaApplyDepartmentGoalDateInheritance"), "Department Goal dates must inherit from the Organisation Goal");
assert.ok(pa.includes("bexPaApplyIndividualGoalDateInheritance"), "Individual Goal dates must inherit from the nearest parent");
assert.ok(pa.includes('.filter((managerId) => managerId !== "__top_level")'), "Top-level employees must not be exposed as a manager-assigned Individual Goal navigation bucket");

console.log("PASS: PA final cleanup focused regression.");
