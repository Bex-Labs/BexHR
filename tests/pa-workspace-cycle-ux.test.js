
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function normalize(text) {
  return text.replace(/\r\n?/g, "\n");
}

function extract(source, start, end) {
  const a = source.indexOf(start);

  assert.notStrictEqual(
    a,
    -1,
    "Missing start token: " + start,
  );

  const b = source.indexOf(
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

const pa = normalize(
  fs.readFileSync(
    "features/performance-appraisal/js/performance-appraisal.js",
    "utf8",
  ),
);

const hr = normalize(
  fs.readFileSync(
    "js/hr-dashboard.js",
    "utf8",
  ),
);

const manager = normalize(
  fs.readFileSync(
    "js/manager-dashboard.js",
    "utf8",
  ),
);

(async () => {

  // Existing activation guard must survive untouched.
  assert.ok(
    pa.includes(
      "let bexPaActivationInFlight = false;",
    ),
  );

  assert.ok(
    pa.includes(
      "if (bexPaActivationInFlight)",
    ),
  );


  // Friendly department language.
  const departmentHelper =
    extract(
      pa,
      "function bexPaFriendlyDepartmentLabel(value) {",
      "function bexPaFilterGoalRows(rows, filters) {",
    );

  const departmentContext = {};

  vm.runInNewContext(
    departmentHelper +
      "\nthis.label = bexPaFriendlyDepartmentLabel;",
    departmentContext,
  );

  assert.strictEqual(
    departmentContext.label("--"),
    "Whole organization",
  );

  assert.strictEqual(
    departmentContext.label("N/A"),
    "Whole organization",
  );

  assert.strictEqual(
    departmentContext.label(""),
    "Department not assigned",
  );

  assert.strictEqual(
    departmentContext.label("Finance"),
    "Finance",
  );


  // Single workspace must bypass chooser.
  assert.ok(
    hr.includes(
      "availableWorkspaceButtons.length === 1",
    ),
    "HR single workspace must direct-open",
  );

  assert.ok(
    manager.includes(
      "availableWorkspaceButtons.length === 1",
    ),
    "Manager single workspace must direct-open",
  );

  assert.ok(
    pa.includes(
      'grid.classList.add("is-balanced")',
    ),
    "PA multi-workspace chooser must balance 2 and 4 options",
  );


  // Cycle create functional simulation.
  const cycleSource =
    extract(
      pa,
      "const bexPaPendingCycleIds = new Set();",
      "let bexPaActivationInFlight = false;",
    );

  let releasePersistence;
  let persistCount = 0;
  let renderCount = 0;
  let hideCount = 0;

  const pendingPersistence =
    new Promise((resolve) => {
      releasePersistence = resolve;
    });

  const context = {
    console,
    Date,

    bexPaState: {
      cycles: [],
      editingCycleId: null,
    },

    bexPaElements: {
      cycleName: {
        value: "QA Draft Cycle",
      },

      cycleTemplate: {
        value: "template-1",
      },

      cycleStartDate: {
        value: "2026-11-01",
      },

      cycleEndDate: {
        value: "2026-12-31",
      },

      goalDeadline: {
        value: "2026-11-15",
      },

      employeeReviewDeadline: {
        value: "2026-12-01",
      },

      managerReviewDeadline: {
        value: "2026-12-10",
      },

      hrReviewDeadline: {
        value: "2026-12-20",
      },

      cycleSubmitButton: {
        disabled: false,
        textContent: "Create Cycle",
        setAttribute() {},
      },

      announcement: {
        textContent: "",
      },
    },

    bexPaClearCycleError() {},

    bexPaCanManageAppraisalCycles() {
      return true;
    },

    bexPaValidateCycle() {
      return "";
    },

    bexPaShowCycleError(message) {
      throw new Error(message);
    },

    bexPaPersistDatasetMutation() {
      persistCount += 1;
      return pendingPersistence;
    },

    bexPaSaveCycles() {},

    bexPaIsIntegratedPersistenceContext() {
      return false;
    },

    bexPaHydrateRemoteState: async function () {},

    bexPaRenderCycles() {
      renderCount += 1;
    },

    bexPaPopulateOrganisationGoalCycles() {},
    bexPaRenderOperationalReport() {},

    bexPaHideCycleForm() {
      hideCount += 1;
    },
  };

  vm.createContext(context);

  vm.runInContext(
    cycleSource +
      "\nthis.submitCycle = bexPaHandleCycleSubmit;" +
      "\nthis.pendingCount = () => bexPaPendingCycleIds.size;" +
      "\nthis.saveBusy = () => bexPaCycleSaveInFlight;",
    context,
  );

  const first =
    context.submitCycle({
      preventDefault() {},
    });

  const second =
    context.submitCycle({
      preventDefault() {},
    });

  assert.strictEqual(
    persistCount,
    1,
    "Rapid Create double-submit must persist once",
  );

  assert.strictEqual(
    context.bexPaState.cycles.length,
    1,
    "One browser cycle must be created",
  );

  assert.strictEqual(
    context.pendingCount(),
    1,
    "Cycle must remain pending while persistence runs",
  );

  assert.strictEqual(
    context.saveBusy(),
    true,
  );

  assert.strictEqual(
    renderCount,
    1,
    "Cycle must render before persistence completes",
  );

  assert.strictEqual(
    context.bexPaElements
      .cycleSubmitButton
      .disabled,
    true,
  );

  assert.strictEqual(
    context.bexPaElements
      .cycleSubmitButton
      .textContent,
    "Creating...",
  );

  assert.strictEqual(
    hideCount,
    0,
    "Form must remain open while persistence is pending",
  );

  releasePersistence();

  await Promise.all([
    first,
    second,
  ]);

  assert.strictEqual(
    persistCount,
    1,
  );

  assert.strictEqual(
    context.pendingCount(),
    0,
  );

  assert.strictEqual(
    context.saveBusy(),
    false,
  );

  assert.strictEqual(
    context.bexPaElements
      .cycleSubmitButton
      .disabled,
    false,
  );

  assert.ok(
    renderCount >= 2,
    "Cycle must rerender after persistence succeeds",
  );

  assert.strictEqual(
    hideCount,
    1,
    "Form closes only after persistence succeeds",
  );

  assert.ok(
    context.bexPaElements
      .announcement
      .textContent
      .includes("successfully as Draft"),
  );

  console.log(
    "PASS: PA UX/cycle unit and functionality QA.",
  );

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
