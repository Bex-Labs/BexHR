const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

const js = fs.readFileSync("js/hr-dashboard.js", "utf8");
const html = fs.readFileSync("hr-dashboard.html", "utf8");

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

function getNearestOpeningDivTagForId(id) {
  const marker = `id="${id}"`;
  const index = html.indexOf(marker);
  assert(index >= 0, `Missing HTML control: ${id}`);
  const start = html.lastIndexOf("<div", index);
  const end = html.indexOf(">", start);
  assert(start >= 0 && end > start, `Missing wrapper for: ${id}`);
  return html.slice(start, end + 1);
}

function assertNormalCreateCompatFieldHidden(id) {
  const wrapper = getNearestOpeningDivTagForId(id);
  assert(wrapper.includes("phase6-payroll-compat-field"), `${id} is not a Phase 6 compatibility field`);
  assert(wrapper.includes("d-none"), `${id} is visible in normal Run Payroll`);
}

assert(html.includes('id="payrollFormTitle">Run Payroll</h2>'), "Run Payroll title missing");
assert(html.includes('id="phase6PayrollPreviewPanel"'), "Phase 6 Payroll Preview missing");
assert(html.includes('<span id="savePayrollBtnText">Finalise Payroll</span>'), "Finalise Payroll action missing");

for (const id of [
  "payrollPayDate",
  "payrollEmployeeGroup",
  "payrollModel",
  "payrollStatus",
  "payrollIsFinalised",
]) {
  assertNormalCreateCompatFieldHidden(id);
}

const batchPayDateWrapper = getNearestOpeningDivTagForId("batchPayrollPayDate");
assert(batchPayDateWrapper.includes("d-none"), "Batch Pay Date is visible instead of derived");

const compatFn = extractFunction(js, "setPhase6PayrollCompatibilityVisibility");
assert(compatFn.includes('.phase6-payroll-compat-field, .phase6-payroll-reference'), "Phase 6 compatibility selector missing");
assert(compatFn.includes('element.classList.toggle("d-none", !isVisible)'), "Phase 6 compatibility toggle missing");

const editFn = extractFunction(js, "startPayrollEdit");
assert(editFn.includes("setPhase6PayrollCompatibilityVisibility(true);"), "Historical edit does not reveal compatibility fields");
assert(editFn.includes("payrollIsFinalised.checked = Boolean(payrollRecord.is_finalised)"), "Historical finalisation state is not restored");

const resetFn = extractFunction(js, "resetPayrollForm");
assert(resetFn.includes("setPhase6PayrollCompatibilityVisibility(false);"), "Normal create mode does not hide compatibility fields");
assert(resetFn.includes("payrollIsFinalised.checked = true"), "Create reset does not restore derived finalisation default");

const buildPayloadFn = extractFunction(js, "buildPayrollPayload");
assert(buildPayloadFn.includes("const shouldFinalise = isEditMode"), "Create/edit finalisation split missing");
assert(buildPayloadFn.includes(": true;"), "Normal create does not derive finalised=true");
assert(buildPayloadFn.includes('status: isEditMode'), "Historical status compatibility missing");
assert(buildPayloadFn.includes(': "Authorised"'), "Normal create status is not derived as Authorised");
assert(buildPayloadFn.includes("is_finalised: shouldFinalise"), "Derived finalisation is not saved");

const batchPayloadFn = extractFunction(js, "buildBatchPayrollRecordPayload");
assert(batchPayloadFn.includes('status: "Authorised"'), "Batch payroll status is not derived");
assert(batchPayloadFn.includes("is_finalised: true"), "Batch payroll is not automatically finalised");
assert(batchPayloadFn.includes("isCurrentTenantAlpatechWorkspace() ? 0.5 : null"), "Batch Basic split is not tenant-fenced");
assert(batchPayloadFn.includes("isCurrentTenantAlpatechWorkspace() ? 0.2 : null"), "Batch Other Allowance split is not tenant-fenced");

const nextCycle = vm.runInNewContext(
  `(${extractFunction(js, "getNextPhase6PayrollCycle")})`,
  { String, Number, Date },
);
assert.strictEqual(nextCycle("Nov 2026"), "Dec 2026", "November does not advance to December");
assert.strictEqual(nextCycle("Dec 2026"), "Jan 2027", "December does not roll into January");
assert.strictEqual(nextCycle("bad period"), "", "Invalid pay period should not advance");

const singleState = {
  dom: {
    payrollPayCycle: { value: "Nov 2026" },
    payrollPayDate: { value: "" },
  },
};
const updateSinglePayDate = vm.runInNewContext(
  `(${extractFunction(js, "updatePayDateFromPayCycle")})`,
  {
    String,
    Number,
    Date,
    state: singleState,
    updatePayrollSubmitButtonState: () => {},
  },
);
updateSinglePayDate();
assert.strictEqual(singleState.dom.payrollPayDate.value, "2026-11-30", "Single payroll month-end Pay Date is wrong");
singleState.dom.payrollPayCycle.value = "Feb 2028";
updateSinglePayDate();
assert.strictEqual(singleState.dom.payrollPayDate.value, "2028-02-29", "Single payroll leap-year Pay Date is wrong");

const batchState = {
  dom: {
    batchPayrollPayCycle: { value: "Dec 2026" },
    batchPayrollPayDate: { value: "" },
  },
};
const updateBatchPayDate = vm.runInNewContext(
  `(${extractFunction(js, "updateBatchPayDateFromPayCycle")})`,
  {
    String,
    Number,
    Date,
    state: batchState,
    updateSubmitBatchPayrollButtonState: () => {},
  },
);
updateBatchPayDate();
assert.strictEqual(batchState.dom.batchPayrollPayDate.value, "2026-12-31", "Batch payroll month-end Pay Date is wrong");

const populateSinglePeriodsFn = extractFunction(js, "populatePayrollPayCycleOptions");
const populateBatchPeriodsFn = extractFunction(js, "populateBatchPayrollPayCycleOptions");
for (const fn of [populateSinglePeriodsFn, populateBatchPeriodsFn]) {
  assert(fn.includes("const yearsToShow = [currentYear, currentYear + 1];"), "Pay Period options do not include next year");
}

const duplicateFn = extractFunction(js, "getExistingBatchPayrollRecordsForPeriod");
assert(duplicateFn.includes("getCurrentTenantEmployeeIdSet()"), "Duplicate guard is not tenant-fenced");
assert(duplicateFn.includes('.eq("pay_cycle", cleanPayCycle)'), "Duplicate guard does not match Pay Period");
assert(duplicateFn.includes('.in("employee_id", cleanEmployeeIds)'), "Duplicate guard does not match selected employees");

const batchSubmitFn = extractFunction(js, "handleBatchPayrollSubmit");
const batchDuplicateIndex = batchSubmitFn.indexOf("getExistingBatchPayrollRecordsForPeriod(payCycle, readyEmployeeIds)");
const batchInsertIndex = batchSubmitFn.indexOf('.insert(batchPayload)');
assert(batchDuplicateIndex >= 0 && batchInsertIndex > batchDuplicateIndex, "Batch duplicate guard must run before insert");
assert(batchSubmitFn.includes("advancePhase6RunPayrollPeriod(payCycle);"), "Batch payroll does not advance to the next Pay Period");

const singleSaveFn = extractFunction(js, "handlePayrollSave");
const singleDuplicateIndex = singleSaveFn.indexOf("getExistingBatchPayrollRecordsForPeriod(");
const singlePayloadIndex = singleSaveFn.indexOf("payrollPayload = buildPayrollPayload();");
assert(singleDuplicateIndex >= 0 && singlePayloadIndex > singleDuplicateIndex, "Single duplicate guard must run before payload creation/insert");
assert(singleSaveFn.includes("advancePhase6RunPayrollPeriod(completedPayCycle);"), "Single payroll does not advance to the next Pay Period");
assert(singleSaveFn.includes('.update(payrollPayload)'), "Historical edit no longer updates the existing payroll row");
assert(singleSaveFn.includes('.eq("id", editingId)'), "Historical edit is not pinned to the existing payroll record id");
assert(singleSaveFn.includes("existingPayrollRecord.tax_rule_version ?? null"), "Historical tax rule snapshot is not preserved on edit");
assert(singleSaveFn.includes("existingPayrollRecord.tax_calculation_snapshot ?? null"), "Historical tax calculation snapshot is not preserved on edit");

const genericFn = extractFunction(js, "applyGenericTenantGrossPayDerivedFields");
assert(genericFn.includes("isCurrentTenantAlpatechWorkspace()"), "Generic payroll path is not fenced away from Alpatech");
assert(genericFn.includes("setNumericFieldValue(state.dom.payrollBasicPay, monthlyGrossSalary)"), "Generic tenant does not use Monthly Gross Salary directly");
assert(genericFn.includes("setNumericFieldValue(state.dom.payrollHousingAllowance, 0)"), "Generic tenant still inherits Housing split");
assert(genericFn.includes("setNumericFieldValue(state.dom.payrollTransportAllowance, 0)"), "Generic tenant still inherits Transport split");
assert(genericFn.includes("setNumericFieldValue(state.dom.payrollUtilityAllowance, 0)"), "Generic tenant still inherits Utility split");

const regularFieldsFn = extractFunction(js, "buildRegularPayrollModelFields");
assert(regularFieldsFn.includes("const usesAlpatechStructuredSplit = isCurrentTenantAlpatechWorkspace();"), "Regular payload split is not tenant-fenced");
assert(regularFieldsFn.includes(": null,"), "Generic regular payload does not null tenant-specific split metadata");

console.log("PASS: Phase 6 Run Payroll final freeze regression.");
