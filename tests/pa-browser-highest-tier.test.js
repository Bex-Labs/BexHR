
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function normalize(text) {
  return text.replace(/\r\n?/g, "\n");
}

function extractBetween(source, start, end) {
  const startIndex = source.indexOf(start);

  assert.notStrictEqual(
    startIndex,
    -1,
    "Missing start token: " + start,
  );

  const endIndex = source.indexOf(
    end,
    startIndex,
  );

  assert.notStrictEqual(
    endIndex,
    -1,
    "Missing end token: " + end,
  );

  return source.slice(startIndex, endIndex);
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


// ----------------------------------------------------------
// UNIT: highest-tier participation snapshot.
// ----------------------------------------------------------

const exclusionSource = extractBetween(
  pa,
  "function bexPaIsEmployeeExcludedFromActiveCycleSnapshot(",
  "function bexPaIsCurrentEmployeeExcludedFromActiveCycle(",
);

const exclusionContext = {};

vm.runInNewContext(
  exclusionSource +
  "\nthis.resolveExclusion = " +
  "bexPaIsEmployeeExcludedFromActiveCycleSnapshot;",
  exclusionContext,
);

const resolveExclusion =
  exclusionContext.resolveExclusion;

assert.strictEqual(
  resolveExclusion([], "emp-1"),
  false,
);

assert.strictEqual(
  resolveExclusion(
    [{
      status: "Draft",
      payload: {
        participationSnapshot: {
          excludedEmployeeIds: ["emp-1"],
        },
      },
    }],
    "emp-1",
  ),
  false,
  "Draft cycles must not suppress My Appraisal",
);

assert.strictEqual(
  resolveExclusion(
    [{
      status: "Active",
      payload: {
        participationSnapshot: {
          excludedEmployeeIds: ["emp-1"],
        },
      },
    }],
    "emp-1",
  ),
  true,
  "Excluded active-cycle employee must lose My Appraisal",
);

assert.strictEqual(
  resolveExclusion(
    [{
      status: "Active",
      payload: {
        participationSnapshot: {
          excludedEmployeeIds: ["emp-2"],
        },
      },
    }],
    "emp-1",
  ),
  false,
  "Eligible employee must retain My Appraisal",
);


// ----------------------------------------------------------
// FUNCTIONAL SIMULATION: activation double-click.
// ----------------------------------------------------------

const busySource = extractBetween(
  pa,
  "let bexPaActivationInFlight = false;",
  "function bexPaOpenActivationDialog(cycleId) {",
);

const activationSource = extractBetween(
  pa,
  "async function bexPaActivateCycle() {",
  "function bexPaHandleCycleTableAction(event) {",
);

let rpcCount = 0;
let releaseRpc;

const pendingRpc = new Promise((resolve) => {
  releaseRpc = resolve;
});

const context = {
  console,
  Promise,

  bexPaState: {
    activatingCycleId: "cycle-qa",
    cycles: [{
      id: "cycle-qa",
      name: "QA Cycle",
      status: "Draft",
    }],
  },

  bexPaElements: {
    confirmActivateCycleButton: {
      dataset: {},
      textContent: "Activate Cycle",
      disabled: false,
      setAttribute() {},
    },

    activateCycleDialog: {
      close() {},
    },

    announcement: {
      textContent: "",
    },
  },

  bexPaCanManageAppraisalCycles() {
    return true;
  },

  bexPaValidateCycle() {
    return "";
  },

  bexPaIsIntegratedPersistenceContext() {
    return true;
  },

  bexPaPersistence: {
    mode: "remote",
    ready: true,
  },

  bexPaHydrateRemoteState: async function () {
    context.bexPaState.cycles[0].status =
      "Active";
  },

  bexPaRenderCycles() {},
  bexPaRenderEmployeeAppraisals() {},

  window: {
    supabaseClient: {
      rpc() {
        rpcCount += 1;

        return pendingRpc.then(() => ({
          error: null,
        }));
      },
    },
  },
};

vm.createContext(context);

vm.runInContext(
  busySource +
  "\n" +
  activationSource +
  "\nthis.activate = bexPaActivateCycle;" +
  "\nthis.getBusy = () => bexPaActivationInFlight;",
  context,
);

const first = context.activate();
const second = context.activate();

assert.strictEqual(
  rpcCount,
  1,
  "Rapid double-click must create exactly one activation RPC",
);

assert.strictEqual(
  context.getBusy(),
  true,
  "Activation must remain in-flight while RPC is pending",
);

assert.strictEqual(
  context
    .bexPaElements
    .confirmActivateCycleButton
    .disabled,
  true,
  "Activation button must be disabled while RPC is pending",
);

releaseRpc();

Promise.all([first, second])
  .then(() => {
    assert.strictEqual(
      rpcCount,
      1,
      "Activation must complete with one RPC only",
    );

    assert.strictEqual(
      context.getBusy(),
      false,
      "Activation busy state must release",
    );

    assert.strictEqual(
      context
        .bexPaElements
        .confirmActivateCycleButton
        .disabled,
      false,
      "Activation button must re-enable after completion",
    );

    // ------------------------------------------------------
    // Structural chooser regression.
    // ------------------------------------------------------

    assert.ok(
      hr.includes(
        "isCurrentHrEmployeeExcludedFromActivePaCycle",
      ),
    );

    const hrEmployeeGuard =
      hr.match(
        /if\s*\(\s*!employeeExcludedFromActivePaCycle\s*\)\s*\{([\s\S]*?)\n\s*\}/,
      );

    assert.ok(
      hrEmployeeGuard &&
        hrEmployeeGuard[1].includes(
          "actions.append(employeeButton);",
        ),
      "HR chooser must keep My Appraisal inside the exclusion guard",
    );

    assert.ok(
      manager.includes(
        "isCurrentManagerExcludedFromActivePaCycle",
      ),
    );

    const managerEmployeeGuard =
      manager.match(
        /if\s*\(\s*!employeeExcludedFromActivePaCycle\s*\)\s*\{([\s\S]*?)\n\s*\}/,
      );

    assert.ok(
      managerEmployeeGuard &&
        managerEmployeeGuard[1].includes(
          "workspaceGrid.append(employeeButton);",
        ),
      "Manager chooser must keep My Appraisal inside the exclusion guard",
    );

    assert.ok(
      manager.includes(
        "await showManagerPerformanceAppraisalChooser();",
      ),
      "Manager chooser must await PA participation lookup",
    );

    console.log(
      "PASS: PA browser unit and functionality QA.",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
