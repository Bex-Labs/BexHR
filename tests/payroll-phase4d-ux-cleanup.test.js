const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "hr-dashboard.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

assert(source.includes("PHASE 4D PAYROLL RULES UX CLEANUP"), "Phase 4D marker missing.");
assert(source.includes('displayText.textContent = "Select start month";'), "human Start Month display text missing.");
assert(source.includes('opacity: 0;'), "native month editor is not permanently hidden.");
assert(source.includes('field.showPicker();'), "native month picker bridge missing.");
assert(source.includes('formatPayrollSetupMonthForDisplay(value);'), "Month Year display sync missing.");
assert(!source.includes('::-webkit-datetime-edit'), "legacy browser-internal month styling still exists.");
assert(source.includes('state.dom.payrollAllowanceEffectiveDate'), "Allowance Start Month field missing.");
assert(source.includes('state.dom.payrollStatutoryEffectiveDate'), "Statutory Start Month field missing.");
assert(source.includes('state.dom.payrollOtherDeductionStartDate'), "Other Deduction Start Month field missing.");
assert(source.includes('hidePhase4TechnicalFormField(state.dom.payrollOtherDeductionReferenceNumber);'), "Reference Number is not hidden from normal UX.");
assert(source.includes('hidePhase4TechnicalFormField(state.dom.payrollStatutoryConfigSource);'), "Configuration Source is not hidden from normal UX.");
assert(!source.match(/<span class="hr-deduction-record-label">Reference(?: number)?<\/span>/i), "Reference Number still renders on deduction cards.");
assert(!source.match(/<span class="hr-deduction-record-label">Configuration source<\/span>/i), "Configuration Source still renders on statutory cards.");
assert(source.includes('monthsFromStart >= 0 && monthsFromStart < durationMonths'), "Recurring deduction month-duration engine changed or missing.");
assert(source.includes('getDefaultStatutoryDeductionSetup'), "BexHR statutory default engine missing.");

console.log("PASS: Phase 4D payroll rules UX cleanup regression.");
