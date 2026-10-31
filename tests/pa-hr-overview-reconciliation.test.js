
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

const pa =
  normalize(
    fs.readFileSync(
      "features/performance-appraisal/js/performance-appraisal.js",
      "utf8",
    ),
  );

const hr =
  normalize(
    fs.readFileSync(
      "js/hr-dashboard.js",
      "utf8",
    ),
  );

const hrHtml =
  normalize(
    fs.readFileSync(
      "hr-dashboard.html",
      "utf8",
    ),
  );


// ----------------------------------------------------------
// PA: both HR workload branches must use active cycles.
// ----------------------------------------------------------

const activeAwaiting =
  pa.match(
    /const awaitingHrCount\s*=\s*\n\s*activeVisibleEmployeeAppraisals\.filter\(/g,
  ) || [];

assert.strictEqual(
  activeAwaiting.length,
  2,
  "HR Standard and HR Admin must both restrict Awaiting HR workload to active cycles",
);

assert.ok(
  pa.includes(
    "const activePriorityCycleIds =",
  ),
  "Priority Attention must define active cycle scope",
);

assert.ok(
  pa.includes(
    "activePriorityCycleIds.has(",
  ),
  "Priority Attention must exclude inactive/historical cycles",
);


// ----------------------------------------------------------
// HR: run the actual position-scope helpers.
// ----------------------------------------------------------

const helperSource =
  extract(
    hr,
    "function isHrWholeOrganizationJobTitleValue(",
    "function populateEmployeeDepartmentOptionsFromOrganizationSetup(",
  );

const context = {
  state: {
    organizationJobTitles: [],
  },

  HR_WHOLE_ORGANIZATION_DEPARTMENT_VALUE:
    "__whole_organization__",

  normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  },
};

vm.createContext(context);

vm.runInContext(
  helperSource +
    "\nthis.isWholeEmployee = isHrWholeOrganizationEmployee;" +
    "\nthis.departmentSelection = getEmployeeDepartmentSelectionValue;",
  context,
);


// Generic organization-wide title.
// Deliberately give the employee stale department text.
context.state.organizationJobTitles = [
  {
    id: "position-1",
    job_title: "Group President",
    department_id: null,
    status: "Active",
    tenant_id: "tenant-1",
  },
];

const wholeEmployee = {
  id: "employee-1",
  job_title: "Group President",
  department: "Human Resources",
  tenant_id: "tenant-1",
};

assert.strictEqual(
  context.isWholeEmployee(
    wholeEmployee,
  ),
  true,
  "Configured whole-organization Job Title must override stale employee department text",
);

assert.strictEqual(
  context.departmentSelection(
    wholeEmployee,
  ),
  "__whole_organization__",
  "Edit mode must select Whole organization for a configured whole-org employee",
);


// Department-scoped employee stays departmental.
context.state.organizationJobTitles = [
  {
    id: "position-2",
    job_title: "HR Officer",
    department_id: "department-1",
    status: "Active",
    tenant_id: "tenant-1",
  },
];

assert.strictEqual(
  context.isWholeEmployee({
    job_title: "HR Officer",
    department: "Human Resources",
    tenant_id: "tenant-1",
  }),
  false,
);

assert.strictEqual(
  context.departmentSelection({
    job_title: "HR Officer",
    department: "Human Resources",
    tenant_id: "tenant-1",
  }),
  "Human Resources",
);


// Same active title in both scopes must fail closed.
context.state.organizationJobTitles = [
  {
    id: "whole-duplicate",
    job_title: "Regional Director",
    department_id: null,
    status: "Active",
    tenant_id: "tenant-1",
  },
  {
    id: "department-duplicate",
    job_title: "Regional Director",
    department_id: "department-1",
    status: "Active",
    tenant_id: "tenant-1",
  },
];

assert.strictEqual(
  context.isWholeEmployee({
    job_title: "Regional Director",
    department: "",
    tenant_id: "tenant-1",
  }),
  false,
  "Ambiguous cross-scope Job Title must fail closed",
);


// ----------------------------------------------------------
// HR Overview structural semantics.
// ----------------------------------------------------------

assert.ok(
  hr.includes(
    '? "Whole organization"',
  ),
  "HR Overview must display configured whole-org employees as Whole organization",
);

assert.ok(
  hr.includes(
    ': rawDepartment ||\n            "Unassigned"',
  ),
  "Unassigned must remain only as a genuine fallback",
);

assert.ok(
  hr.includes(
    'department === "Whole organization"\n            ? "WO"',
  ),
  "Whole organization row must use WO marker",
);

assert.ok(
  hr.includes(
    "const hasOrganizationPlacement =",
  ),
  "Missing-information logic must recognise valid whole-org placement",
);

assert.ok(
  hr.includes(
    "organizational placement",
  ),
  "Missing-information wording must not require a department specifically",
);

assert.ok(
  hrHtml.includes(
    "Organization snapshot",
  ),
  "HR Overview section must be named Organization snapshot",
);

assert.ok(
  !hrHtml.includes(
    ">Department snapshot<",
  ),
);

console.log(
  "PASS: PA + HR Overview reconciliation unit/functionality QA.",
);
