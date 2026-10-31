
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

function normalize(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n");
}

function extract(source, start, end) {
  const a =
    source.indexOf(start);

  assert.notStrictEqual(
    a,
    -1,
    "Missing start token: " + start,
  );

  const b =
    source.indexOf(
      end,
      a,
    );

  assert.notStrictEqual(
    b,
    -1,
    "Missing end token: " + end,
  );

  return source.slice(a, b);
}

const hr =
  normalize(
    fs.readFileSync(
      "js/hr-dashboard.js",
      "utf8",
    ),
  );

const pa =
  normalize(
    fs.readFileSync(
      "features/performance-appraisal/js/performance-appraisal.js",
      "utf8",
    ),
  );


// ----------------------------------------------------------
// Structural: broad HR scope must no longer come from
// managerContext.allEmployees.
// ----------------------------------------------------------

assert.strictEqual(
  hr.includes(
    "managerContext.allEmployees",
  ),
  false,
  "HR operational scope must not be sourced from reporting-manager context",
);

assert.ok(
  hr.includes(
    "const hrOperationalEmployees =",
  ),
);

assert.ok(
  hr.includes(
    "hrOperationalEmployeeIds:",
  ),
);

assert.ok(
  pa.includes(
    "context.hrOperationalEmployees",
  ),
);


// ----------------------------------------------------------
// Functional: run actual PA scope selector.
// ----------------------------------------------------------

const selectorSource =
  extract(
    pa,
    "function bexPaGetAvailableEmployees() {",
    "function bexPaGetAvailableDepartments() {",
  );

const runtime = {
  activeMode:
    "primary-manager",

  context: {
    availableEmployees: [
      {
        id: "legacy-1",
        name: "Legacy",
      },
    ],

    managerAvailableEmployees: [
      {
        id: "managed-1",
        name: "Actual Direct Report",
        department: "Operations",
        departmentId: "dept-1",
        jobTitle: "Officer",
      },
    ],

    hrOperationalEmployees: [
      {
        id: "employee-1",
        name: "Employee One",
        department: "Human Resources",
        departmentId: "dept-hr",
        jobTitle: "HR Officer",
      },
      {
        id: "employee-2",
        name: "Employee Two",
        department: "Operations",
        departmentId: "dept-ops",
        jobTitle: "Officer",
      },
      {
        id: "executive-1",
        name: "Executive",
        department: "",
        departmentId: "",
        jobTitle: "Group President",
      },
    ],

    hrAvailableEmployees: [
      {
        id: "old-session",
        name: "Old Session",
      },
    ],
  },
};

runtime.bexPaGetIntegratedContext =
  () => runtime.context;

runtime.bexPaGetActiveMode =
  () => runtime.activeMode;

vm.createContext(runtime);

vm.runInContext(
  selectorSource +
    "\nthis.getAvailableEmployees = bexPaGetAvailableEmployees;",
  runtime,
);

const managerEmployees =
  runtime.getAvailableEmployees();

assert.deepStrictEqual(
  Array.from(
    managerEmployees,
    (employee) => employee.id,
  ),
  ["managed-1"],
  "Manager Reviews must remain reporting-scoped",
);


runtime.activeMode =
  "hr-standard";

const hrStandardEmployees =
  runtime.getAvailableEmployees();

assert.deepStrictEqual(
  Array.from(
    hrStandardEmployees,
    (employee) => employee.id,
  ),
  [
    "employee-1",
    "employee-2",
    "executive-1",
  ],
  "HR Standard must use broad HR operational scope, not manager reports",
);


runtime.activeMode =
  "hr-admin";

const hrAdminEmployees =
  runtime.getAvailableEmployees();

assert.deepStrictEqual(
  Array.from(
    hrAdminEmployees,
    (employee) => employee.id,
  ),
  [
    "employee-1",
    "employee-2",
    "executive-1",
  ],
  "HR Admin must use company PA operational scope",
);


// ----------------------------------------------------------
// Structural: appraisal visibility preserves ownership split.
// ----------------------------------------------------------

const visibilitySource =
  extract(
    pa,
    "function bexPaGetVisibleEmployeeAppraisals() {",
    "function bexPaHasSavedDraft(",
  );

assert.ok(
  visibilitySource.includes(
    'if (activeMode === "hr-standard")',
  ),
);

assert.ok(
  visibilitySource.includes(
    "bexPaGetAvailableEmployees()",
  ),
  "HR Standard visibility must use HR operational employees",
);

assert.ok(
  visibilitySource.includes(
    'if (activeMode === "primary-manager")',
  ),
);

assert.ok(
  visibilitySource.includes(
    "...bexPaGetManagedEmployeeIds()",
  ),
  "Manager visibility must still depend on reporting ownership",
);

assert.ok(
  visibilitySource.includes(
    "...bexPaGetSecondaryEmployeeIds()",
  ),
  "Secondary visibility must stay distinct from HR operational scope",
);

console.log(
  "PASS: HR PA operational/reporting scope unit and functionality QA.",
);
