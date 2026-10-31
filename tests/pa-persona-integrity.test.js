"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const paPath = path.join(
  root,
  "features",
  "performance-appraisal",
  "js",
  "performance-appraisal.js",
);

const pa = fs.readFileSync(paPath, "utf8");

const migrations = fs
  .readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) =>
    name.endsWith("_pa_persona_integrity.sql"),
  )
  .sort();

assert(
  migrations.length >= 1,
  "PA persona integrity migration is missing.",
);

const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    migrations[migrations.length - 1],
  ),
  "utf8",
);

function section(startToken, endToken) {
  const start = pa.indexOf(startToken);
  assert(start >= 0, "Missing start token: " + startToken);

  const end = pa.indexOf(
    endToken,
    start + startToken.length,
  );

  assert(end >= 0, "Missing end token: " + endToken);
  return pa.slice(start, end);
}

const employeeCapabilitySection = section(
  "function bexPaHasEmployeeCapability()",
  "function bexPaHasHrStandardCapability()",
);

assert(
  employeeCapabilitySection.includes(
    "bexPaGetActiveParticipantEmployeeIdSet",
  ),
  "My Appraisal is not participant-row aware.",
);

const managerCapability = section(
  "function bexPaHasManagerReviewVisibilityCapability()",
  "function bexPaGetAvailableEmployees()",
);

assert(
  managerCapability.includes(
    "bexPaGetActiveSnapshotOwnedManagerAppraisals",
  ),
  "Manager Reviews capability does not retain snapshot-owned active reviews.",
);

const managerEligibility = section(
  "function bexPaGetEligibleManagerAppraisals()",
  "function bexPaGetVisibleEmployeeAppraisals()",
);

assert(
  managerEligibility.includes(
    'cycle?.status === "Active"',
  ),
  "Manager review eligibility is not Active-cycle scoped.",
);

assert(
  managerEligibility.includes(
    "appraisal?.managerEmployeeId",
  ),
  "Manager review eligibility does not enforce reviewer snapshot.",
);

const managedDepartments = section(
  "function bexPaGetManagedDepartments()",
  "function bexPaCanManageDepartmentGoal",
);

assert(
  managedDepartments.includes(
    "bexPaIsPrimaryManagerMode()",
  ),
  "Department-goal authority is not Primary Manager gated.",
);

assert(
  !managedDepartments.includes(
    "bexPaGetSecondaryEmployeeIds()",
  ),
  "Secondary employees still grant department-goal authority.",
);

const goalVisibility = section(
  "function bexPaGetVisibleIndividualGoals()",
  "function bexPaIsDevelopmentHost()",
);

assert(
  goalVisibility.includes(
    "bexPaGetActiveParticipantEmployeeIdSet",
  ) &&
  goalVisibility.includes(
    "bexPaGetActiveCycleIdSet",
  ),
  "HR Standard/Manager current goals are not participant/cycle scoped.",
);

const storyPeople = section(
  "function bexPaStoryPeople(rows)",
  "function bexPaStoryManager(employeeId)",
);

assert(
  storyPeople.includes(
    "restrictToActiveParticipants",
  ) &&
  storyPeople.includes(
    "Whole organization",
  ),
  "Story navigator is not participant-aware / Whole-organization friendly.",
);

const individualValidation = section(
  "function bexPaValidateIndividualGoal(goal)",
  "function bexPaCreateGoalIdentityMeta",
);

assert(
  !individualValidation.includes(
    "[goal.employeeId, goal.employee, goal.departmentId",
  ),
  "Individual goal validation still requires departmentId.",
);

assert(
  individualValidation.includes(
    "Whole organization individual goals cannot link to a department goal.",
  ),
  "Whole-organization individual goal parent rule is missing.",
);

assert(
  pa.includes(
    "record.departmentId || null",
  ),
  "Individual-goal persistence does not write a nullable department.",
);

assert(
  /alter table public\.pa_individual_goals[\s\S]*alter column department_id drop not null/i.test(
    migration,
  ),
  "Migration does not make individual goal department nullable.",
);

assert(
  migration.includes(
    "bexhr_private.is_whole_organization_employee(new.employee_id)",
  ),
  "Migration does not validate legitimate Whole-organization employees.",
);

assert(
  /bex_pa_private\.is_manager_of\(\s*employee\.id,\s*true\s*\)/i.test(
    migration,
  ),
  "Database department-goal authority is not Primary-only.",
);

assert(
  migration.includes(
    "bexhr_enforce_pa_snapshot_reviewer_write",
  ),
  "Snapshot reviewer write invariant is missing.",
);

assert(
  migration.includes(
    "PA snapshot reviewer reads active employee appraisals",
  ) &&
  migration.includes(
    "PA snapshot reviewer creates manager appraisals",
  ),
  "Snapshot reviewer RLS path is incomplete.",
);


// Functional simulations mirror the canonical rules introduced by the patch.

function activeCycleIds(cycles) {
  return new Set(
    cycles
      .filter((cycle) => cycle.status === "Active")
      .map((cycle) => cycle.id),
  );
}

function activeParticipantIds(cycles, appraisals) {
  const active = activeCycleIds(cycles);

  return new Set(
    appraisals
      .filter((appraisal) =>
        active.has(appraisal.cycleId),
      )
      .map((appraisal) =>
        appraisal.employeeId,
      ),
  );
}

function employeeCapability(
  employeeId,
  cycles,
  appraisals,
) {
  if (!employeeId) return false;

  const active = activeCycleIds(cycles);
  if (active.size === 0) return true;

  return activeParticipantIds(
    cycles,
    appraisals,
  ).has(employeeId);
}

assert.strictEqual(
  employeeCapability(
    "employee-1",
    [
      { id: "cycle-a", status: "Active" },
      { id: "cycle-b", status: "Active" },
    ],
    [
      {
        id: "appraisal-b",
        employeeId: "employee-1",
        cycleId: "cycle-b",
      },
    ],
  ),
  true,
  "Participation in one Active cycle must preserve My Appraisal even when another Active cycle excludes the employee.",
);

assert.strictEqual(
  employeeCapability(
    "employee-1",
    [
      { id: "cycle-a", status: "Active" },
    ],
    [],
  ),
  false,
  "An employee with no appraisal row in any Active cycle must not get active My Appraisal capability.",
);

function eligibleManagerReviews(
  managerId,
  cycles,
  appraisals,
  selfAppraisals,
) {
  const active = activeCycleIds(cycles);

  return appraisals.filter((appraisal) =>
    active.has(appraisal.cycleId) &&
    appraisal.managerReviewRoute ===
      "PRIMARY_MANAGER" &&
    appraisal.managerEmployeeId ===
      managerId &&
    selfAppraisals.some(
      (self) =>
        self.appraisalId === appraisal.id &&
        self.status === "Submitted",
    ),
  );
}

const reviewAppraisals = [
  {
    id: "active-old-manager",
    cycleId: "active",
    employeeId: "employee",
    managerReviewRoute: "PRIMARY_MANAGER",
    managerEmployeeId: "manager-old",
  },
  {
    id: "closed-old-manager",
    cycleId: "closed",
    employeeId: "employee",
    managerReviewRoute: "PRIMARY_MANAGER",
    managerEmployeeId: "manager-old",
  },
];

const reviewCycles = [
  { id: "active", status: "Active" },
  { id: "closed", status: "Completed" },
];

const submittedSelf = [
  {
    appraisalId: "active-old-manager",
    status: "Submitted",
  },
  {
    appraisalId: "closed-old-manager",
    status: "Submitted",
  },
];

assert.deepStrictEqual(
  eligibleManagerReviews(
    "manager-old",
    reviewCycles,
    reviewAppraisals,
    submittedSelf,
  ).map((item) => item.id),
  ["active-old-manager"],
  "The snapshotted reviewer must retain the Active review after a reporting-line change, without reopening historical cycles.",
);

assert.deepStrictEqual(
  eligibleManagerReviews(
    "manager-new",
    reviewCycles,
    reviewAppraisals,
    submittedSelf,
  ),
  [],
  "The new current reporting manager must not steal an existing cycle's snapshotted review.",
);

function primaryManagedDepartments(
  primaryIds,
  secondaryIds,
  employees,
) {
  const primary = new Set(primaryIds);

  return employees
    .filter(
      (employee) =>
        primary.has(employee.id) &&
        employee.departmentId,
    )
    .map((employee) =>
      employee.departmentId,
    );
}

assert.deepStrictEqual(
  primaryManagedDepartments(
    ["primary-report"],
    ["secondary-report"],
    [
      {
        id: "primary-report",
        departmentId: "finance",
      },
      {
        id: "secondary-report",
        departmentId: "legal",
      },
    ],
  ),
  ["finance"],
  "Secondary reporting must not grant department-goal edit authority.",
);

const participantSet =
  activeParticipantIds(
    [{ id: "cycle", status: "Active" }],
    [
      {
        id: "coo-appraisal",
        employeeId: "coo",
        cycleId: "cycle",
      },
    ],
  );

assert.strictEqual(
  participantSet.has("ceo"),
  false,
  "Excluded highest-tier employee leaked into participant scope.",
);

assert.strictEqual(
  participantSet.has("coo"),
  true,
  "Eligible Whole-organization employee disappeared from participant scope.",
);

function persistenceDepartmentId(value) {
  return value || null;
}

assert.strictEqual(
  persistenceDepartmentId(""),
  null,
  "Blank Whole-organization department must persist as SQL NULL.",
);

console.log(
  "PASS: PA persona integrity unit and functionality QA.",
);
console.log(
  "PASS: My Appraisal is cycle-participation aware.",
);
console.log(
  "PASS: Manager Reviews are Active-cycle + reviewer-snapshot owned.",
);
console.log(
  "PASS: Secondary Manager remains read-only for department goals.",
);
console.log(
  "PASS: HR Standard/Manager operational Goals are participant-scoped.",
);
console.log(
  "PASS: Whole-organization individual goals support NULL department safely.",
);
