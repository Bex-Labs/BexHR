"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const pa = fs.readFileSync(
  path.join(root, "features", "performance-appraisal", "js", "performance-appraisal.js"),
  "utf8",
);
const context = fs.readFileSync(
  path.join(root, "features", "performance-appraisal", "js", "performance-appraisal-context.js"),
  "utf8",
);
const manager = fs.readFileSync(
  path.join(root, "js", "manager-dashboard.js"),
  "utf8",
);
const migrationDir = path.join(root, "supabase", "migrations");
const migrationFile = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith("_pa_workspace_integrity_closeout.sql"))
  .sort()
  .at(-1);

assert.ok(migrationFile, "PA workspace integrity closeout migration is missing.");
const migration = fs.readFileSync(
  path.join(migrationDir, migrationFile),
  "utf8",
);

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `Missing start: ${start}`);
  assert.ok(b > a, `Missing end: ${end}`);
  return source.slice(a, b);
}

// Canonical integrated-context validator.
const validatorSource = section(
  context,
  "function bexPaIsValidIntegratedContext(context)",
  "window.BexPaIsValidIntegratedContext",
);
const validatorRuntime = {
  BEX_PA_CONTEXT_MAX_AGE_MS: 12 * 60 * 60 * 1000,
};
vm.createContext(validatorRuntime);
vm.runInContext(
  validatorSource + "\nthis.validate = bexPaIsValidIntegratedContext;",
  validatorRuntime,
);
const issuedAt = new Date().toISOString();
assert.strictEqual(
  validatorRuntime.validate({
    source: "bexhr",
    persona: "hr-standard",
    issuedAt,
    employeeId: "employee-1",
    hrStandardCapability: true,
    hrAdminCapability: false,
  }),
  true,
  "Valid HR Standard context must pass canonical validation.",
);
assert.strictEqual(
  validatorRuntime.validate({
    source: "bexhr",
    persona: "hr-standard",
    issuedAt,
    employeeId: "employee-1",
    hrStandardCapability: false,
    hrAdminCapability: false,
  }),
  false,
  "HR Standard context without HR Standard capability must fail closed.",
);
assert.strictEqual(
  validatorRuntime.validate({
    source: "bexhr",
    persona: "hr-standard",
    issuedAt,
    employeeId: "employee-1",
    hrStandardCapability: true,
    hrAdminCapability: true,
  }),
  false,
  "HR Admin context must not masquerade as HR Standard.",
);

// Manager workspace is broader than Manager review authority.
const managerCapabilitySource = section(
  pa,
  "function bexPaHasManagerWorkspaceCapability()",
  "function bexPaGetAvailableEmployees()",
);
const managerRuntime = {
  primary: [],
  secondary: [],
  snapshot: [],
  bexPaGetCurrentManagerEmployeeId: () => "manager-1",
  bexPaGetManagedEmployeeIds: () => managerRuntime.primary,
  bexPaGetSecondaryEmployeeIds: () => managerRuntime.secondary,
  bexPaGetActiveSnapshotOwnedManagerAppraisals: () => managerRuntime.snapshot,
};
vm.createContext(managerRuntime);
vm.runInContext(
  managerCapabilitySource +
    "\nthis.workspace = bexPaHasManagerWorkspaceCapability;" +
    "\nthis.review = bexPaHasManagerReviewVisibilityCapability;",
  managerRuntime,
);
managerRuntime.secondary = ["employee-secondary"];
assert.strictEqual(managerRuntime.workspace(), true, "Secondary Manager must retain Manager goals/progress workspace.");
assert.strictEqual(managerRuntime.review(), false, "Secondary-only Manager must not gain Manager Review authority.");
managerRuntime.secondary = [];
managerRuntime.primary = ["employee-primary"];
assert.strictEqual(managerRuntime.workspace(), true);
assert.strictEqual(managerRuntime.review(), true, "Primary Manager must retain Manager Reviews.");
managerRuntime.primary = [];
managerRuntime.snapshot = [{ employeeId: "employee-transferred" }];
assert.strictEqual(managerRuntime.workspace(), true);
assert.strictEqual(managerRuntime.review(), true, "Snapshotted reviewer must retain Manager Reviews after transfer.");

// HR Standard and Manager cannot use the company hierarchy traversal step.
const storyPolicySource = section(
  pa,
  "function bexPaStoryUsesManagerStep(includePeople = true)",
  "function bexPaBuildWorkspaceFilters(",
);
const storyRuntime = {
  hrAdmin: false,
  bexPaIsHrAdminMode: () => storyRuntime.hrAdmin,
};
vm.createContext(storyRuntime);
vm.runInContext(
  storyPolicySource + "\nthis.usesManager = bexPaStoryUsesManagerStep;",
  storyRuntime,
);
assert.strictEqual(storyRuntime.usesManager(true), false, "Non-HR-Admin PA stories must bypass company reporting-manager traversal.");
storyRuntime.hrAdmin = true;
assert.strictEqual(storyRuntime.usesManager(true), true, "HR Admin keeps company-wide manager traversal.");
assert.strictEqual(storyRuntime.usesManager(false), false, "Department-goal navigation must not invent a manager step.");

assert.ok(
  pa.includes("bexPaGetManagerVisibleDepartments"),
  "Manager visible department scope helper is missing.",
);
assert.ok(
  pa.includes("...bexPaGetSecondaryEmployeeIds()"),
  "Secondary Manager read-only department visibility is missing.",
);
assert.ok(
  pa.includes("if (!bexPaIsPrimaryManagerMode())"),
  "Department-goal writes are not explicitly Primary-only.",
);
assert.ok(
  !pa.includes('.replace(/s+/g, " ")'),
  "Whole-organization literal-s normalization defect remains.",
);
assert.ok(
  pa.includes('.replace(/\\s+/g, " ")'),
  "Whole-organization whitespace normalization is missing.",
);
assert.ok(
  manager.includes('title: "Manager PA Workspace"'),
  "Manager dashboard still promises Manager Reviews to Secondary-only scope.",
);

// Database contract: read-only HR Standard goals/progress + status-only appraisal RPC.
assert.ok(
  migration.includes("bex_pa_private.current_user_is_hr_standard"),
  "Standard HR database authorization helper is missing.",
);
assert.ok(
  migration.includes('PA HR Standard reads active participant individual goals') &&
    migration.includes('PA HR Standard reads active participant progress'),
  "Standard HR current participant goal/progress policies are incomplete.",
);
assert.ok(
  migration.includes("pa_get_hr_standard_operational_appraisal_snapshot") &&
    migration.includes("bex_pa_private.hr_standard_operational_appraisal_snapshot"),
  "Standard HR operational appraisal snapshot RPC/helper is missing.",
);
assert.ok(
  migration.includes("security invoker") &&
    migration.includes("security definer"),
  "Public/private snapshot security modes are incomplete.",
);
assert.ok(
  migration.includes("from public, anon, authenticated") &&
    migration.includes("to authenticated"),
  "Operational snapshot RPC execute privileges are not explicit.",
);
const rpcResult = section(
  migration,
  "returns table (",
  ")\nlanguage plpgsql",
).toLowerCase();
for (const forbidden of ["payload", "comment", "response", "rating", "score"]) {
  assert.ok(
    !rpcResult.includes(forbidden),
    `Operational snapshot return shape exposes forbidden field: ${forbidden}`,
  );
}
assert.ok(
  !/for\s+(insert|update|delete|all)\s+to\s+authenticated[\s\S]*hr standard/i.test(migration),
  "Migration must not grant Standard HR write authority.",
);

assert.ok(
  /document\.body\.dataset\.bexPaLoadState\s*=\s*"error"/.test(pa),
  "Integrated PA hydration must fail closed visibly.",
);

console.log("PASS: PA workspace integrity closeout functional QA.");
console.log("PASS: HR Standard has data-minimized operational visibility without hierarchy traversal.");
console.log("PASS: Secondary Manager keeps goals/progress visibility without Manager Review authority.");
console.log("PASS: Primary and snapshotted reviewers retain Manager Reviews.");
console.log("PASS: Whole-organization normalization and fail-closed loading guards are present.");
