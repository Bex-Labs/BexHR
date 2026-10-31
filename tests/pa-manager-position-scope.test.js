
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function normalize(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n");
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

const migrationName =
  fs.readdirSync(
    "supabase/migrations",
  )
    .filter((name) =>
      name.endsWith(
        "_pa_manager_position_scope_rpc.sql",
      ),
    )
    .sort()
    .at(-1);

assert.ok(
  migrationName,
  "Manager position-scope migration is missing",
);

const migration = normalize(
  fs.readFileSync(
    "supabase/migrations/" +
      migrationName,
    "utf8",
  ),
);

assert.ok(
  pa.includes(
    '.rpc("pa_get_my_position_scope")',
  ),
  "PA must use protected manager scope RPC",
);

assert.ok(
  pa.includes(
    "currentManagerPositionScope",
  ),
);

assert.ok(
  migration.includes(
    "security definer",
  ),
);

assert.ok(
  migration.includes(
    "set search_path = ''",
  ),
);

assert.ok(
  migration.includes(
    "from anon",
  ),
);

assert.ok(
  migration.includes(
    "to authenticated",
  ),
);

// Functional regression:
// positions can be unavailable to a manager,
// but authoritative RPC scope must still label correctly.
const functions = extract(
  pa,
  "function bexPaManagerIdentity(id) {",
  "function bexPaFilterGoalRows(rows, filters) {",
);

const context = {
  bexPaGoalDirectory: {
    positions: [],
    currentManagerJobTitle:
      "Regional Director",
    currentManagerPositionScope:
      "organization",
    currentManagerPositionAmbiguous:
      false,
  },

  bexPaGetIntegratedContext() {
    return {
      managerEmployeeId:
        "manager-1",
      managerDisplayName:
        "Example Manager",
      managerAvailableEmployees: [],
      availableEmployees: [],
      hrAvailableEmployees: [],
      secondaryEmployees: [],
    };
  },
};

vm.createContext(context);

vm.runInContext(
  functions +
    "\nthis.label = bexPaManagerLabel;",
  context,
);

assert.strictEqual(
  context.label("manager-1"),
  "Example Manager (Whole organization)",
  "RPC-resolved organization scope must label current manager even when the Job Title catalogue is unavailable",
);

context.bexPaGoalDirectory
  .currentManagerPositionScope =
  "department";

assert.strictEqual(
  context.label("manager-1"),
  "Example Manager",
  "Department-scoped manager must not receive Whole organization label",
);

console.log(
  "PASS: PA manager position-scope RPC unit and functionality QA.",
);
