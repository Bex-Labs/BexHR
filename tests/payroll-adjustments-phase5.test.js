const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

const js = fs.readFileSync("js/hr-dashboard.js", "utf8");
const html = fs.readFileSync("hr-dashboard.html", "utf8");
const css = fs.readFileSync("css/styles.css", "utf8");

function extractFunction(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Function missing: ${functionName}`);
  const signatureMatch = source.slice(start).match(/\)\s*\{/);
  assert(signatureMatch && Number.isInteger(signatureMatch.index), `Function body missing: ${functionName}`);
  const open = start + signatureMatch.index + signatureMatch[0].lastIndexOf("{");

  let depth = 0;
  let state = "code";
  let escaped = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || "";

    if (state === "line-comment") {
      if (ch === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 1;
      }
      continue;
    }
    if (state === "single") {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "'") state = "code";
      continue;
    }
    if (state === "double") {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') state = "code";
      continue;
    }
    if (state === "template") {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "`") state = "code";
      continue;
    }

    if (ch === "/" && next === "/") {
      state = "line-comment";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block-comment";
      i += 1;
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    if (ch === '"') {
      state = "double";
      continue;
    }
    if (ch === "`") {
      state = "template";
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  assert.fail(`Could not close function: ${functionName}`);
}

assert(js.includes('BEXHR_PHASE5_ADJUSTMENT_V1'), "Phase 5 adjustment marker missing");
assert(html.includes("Adjustment Type"), "Adjustment Type field missing");
assert(html.includes("Pay Period"), "Pay Period field missing");
assert(html.includes("Create Adjustment"), "Adjustment create button missing");
assert(html.includes("Select pay period"), "Pay Period placeholder missing");
assert(!html.includes("Advanced Employee Payroll Exceptions"), "Legacy Overrides title still visible");
assert(!html.includes("No employee override records found yet."), "Legacy override empty state still visible");
assert(!html.includes("Search by employee, element, method, status..."), "Legacy override search placeholder still visible");
assert(css.includes('content: "One-off payroll";'), "One-off payroll kicker missing");
assert(!css.includes('content: "Exception governance";'), "Legacy Exception governance kicker remains");

const optionsFn = extractFunction(js, "populatePayrollEmployeeOverrideElementOptions");
for (const allowed of ["BONUS", "OVERTIME", "OTHER_ALLOWANCE", "OTHER"]) {
  assert(optionsFn.includes(allowed), `Allowed Adjustment type missing: ${allowed}`);
}
for (const forbidden of ["BASIC_SALARY", "PAYE", "EMPLOYEE_PENSION", "EMPLOYER_PENSION", "NHF"]) {
  assert(!optionsFn.includes(forbidden), `Forbidden Adjustment type exposed: ${forbidden}`);
}

const marker = "BEXHR_PHASE5_ADJUSTMENT_V1";
const allowedSet = new Set(["BONUS", "OVERTIME", "OTHER_ALLOWANCE", "OTHER"]);
const isAdjustment = vm.runInNewContext(
  `(${extractFunction(js, "isPayrollEmployeeAdjustmentRecord")})`,
  {
    String,
    BEXHR_PHASE5_ADJUSTMENT_MARKER: marker,
    BEXHR_PHASE5_ADJUSTMENT_ELEMENTS: allowedSet,
  },
);

const parseDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const time = Date.parse(/T/.test(raw) ? raw : `${raw}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
};

const isActive = vm.runInNewContext(
  `(${extractFunction(js, "isPayrollEmployeeOverrideActiveForDate")})`,
  {
    String,
    Number,
    isPayrollEmployeeAdjustmentRecord: isAdjustment,
    normalizeText: (value) => String(value || "").trim().toLowerCase(),
    parsePayrollEffectiveDateToTime: parseDate,
  },
);

const bounds = vm.runInNewContext(
  `(${extractFunction(js, "getPayrollAdjustmentPeriodBounds")})`,
  { String, Number, Date },
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(bounds("2026-11"))),
  { startDate: "2026-11-01", endDate: "2026-11-30" },
  "November adjustment bounds are wrong",
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(bounds("2028-02"))),
  { startDate: "2028-02-01", endDate: "2028-02-29" },
  "Leap-year adjustment bounds are wrong",
);

const novemberAdjustment = {
  notes: marker,
  override_element: "BONUS",
  override_method: "FIXED_AMOUNT",
  override_value: 10000,
  effective_date: "2026-11-01",
  end_date: "2026-11-30",
  status: "Active",
};

assert.strictEqual(isAdjustment(novemberAdjustment), true, "Valid adjustment rejected");
assert.strictEqual(isActive(novemberAdjustment, "2026-11-15"), true, "November adjustment is not active in November");
assert.strictEqual(isActive(novemberAdjustment, "2026-12-01"), false, "November adjustment leaked into December");
assert.strictEqual(
  isActive({ ...novemberAdjustment, notes: "legacy override" }, "2026-11-15"),
  false,
  "Legacy override still applies to payroll",
);
assert.strictEqual(
  isActive({ ...novemberAdjustment, override_element: "BASIC_SALARY" }, "2026-11-15"),
  false,
  "Basic Salary can still act as a Phase 5 Adjustment",
);

const manualFn = extractFunction(js, "recalculatePayrollFormTotals");
const manualEarn = manualFn.indexOf("applyActivePayrollEmployeeEarningAdjustmentsToPayrollForm();");
const manualPaye = manualFn.indexOf("refreshRegularPayrollBaselineDeductionsFromCurrentValues();");
const manualStatutory = manualFn.indexOf("applyActivePayrollStatutoryDeductionsToPayrollForm();");
const manualDed = manualFn.indexOf("applyActivePayrollEmployeeDeductionAdjustmentsToPayrollForm();");
assert(manualEarn >= 0 && manualEarn < manualPaye, "Manual earning adjustments must enter before PAYE baseline calculation");
assert(manualDed > manualStatutory, "Manual deduction adjustments must enter after statutory deductions");

const batchFn = extractFunction(js, "buildBatchPayrollPreparedRow");
assert(batchFn.indexOf("getPayrollEmployeeAdjustmentAmountsForMaster(") < batchFn.indexOf("calculateBatchStatutoryDeductionTotals("), "Run Payroll adjustments must be loaded before statutory calculation");
assert(batchFn.includes("adjustmentAmounts.otherEarning"), "Run Payroll other earning adjustment missing");
assert(batchFn.includes("adjustmentAmounts.otherDeduction"), "Run Payroll other deduction adjustment missing");

const csvFn = extractFunction(js, "buildBatchPayrollPreparedRowFromCsv");
const csvAdjustment = csvFn.indexOf("getPayrollEmployeeAdjustmentAmountsForMaster(");
const csvStatutory = csvFn.indexOf("calculateBatchStatutoryDeductionTotals(");
assert(csvAdjustment >= 0 && csvAdjustment < csvStatutory, "CSV adjustments must be loaded before statutory calculation");
assert(csvFn.includes("adjustmentAmounts.otherEarning"), "CSV other earning adjustment missing");
assert(csvFn.includes("adjustmentAmounts.bonus"), "CSV bonus adjustment missing");
assert(csvFn.includes("adjustmentAmounts.overtime"), "CSV overtime adjustment missing");
assert(csvFn.includes("statutoryTotals.otherDeductions + adjustmentAmounts.otherDeduction"), "CSV other deduction adjustment missing");
assert(!csvFn.includes("return applyActivePayrollEmployeeOverridesToBatchPreparedRow("), "CSV still uses the old post-tax adjustment pass");
assert(csvFn.includes("employee_override_applied: adjustmentAmounts.totalCount > 0"), "CSV adjustment audit flag missing");

const editFn = extractFunction(js, "startPayrollEmployeeOverrideEdit");
assert(editFn.includes("isPayrollEmployeeAdjustmentRecord(record)"), "Edit mode does not reject legacy overrides");
assert(editFn.includes("slice(0, 7)"), "Edit mode does not convert stored dates back to YYYY-MM");
assert(editFn.includes("Update Adjustment"), "Edit mode still uses Override wording");

assert(js.includes("function bindPayrollAdjustmentPayPeriodControl"), "Pay Period binder missing");
assert(js.includes("field.showPicker();"), "Pay Period showPicker bridge missing");
assert(js.includes("bindPayrollAdjustmentPayPeriodControl();"), "Pay Period binder is not initialised");

console.log("PASS: Phase 5 payroll adjustments behavioral regression.");
