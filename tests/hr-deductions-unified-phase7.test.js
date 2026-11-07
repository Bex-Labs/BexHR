'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.BEXHR_PHASE7A8_TEST_ROOT || path.resolve(__dirname, '..');
const load = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const html = load('hr-dashboard.html');
const ui = load('js/hr-deductions-unified-phase7.js');
const css = load('css/hr-deductions-unified-phase7.css');
const core = load('js/hr-dashboard.js');

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Both original data-entry paths must remain; nothing is merged in storage.
for (const id of [
  'payrollStatutoryCreateForm',
  'payrollOtherDeductionCreateForm',
  'payrollStatutoryCardCollapse',
  'payrollOtherDeductionCardCollapse',
  'payrollStatutoryRecordsTableBody',
  'payrollOtherDeductionRecordsTableBody',
  'savePayrollStatutoryBtn',
  'savePayrollOtherDeductionBtn',
  'togglePayrollStatutoryCardBtn',
  'togglePayrollOtherDeductionCardBtn',
]) {
  assert.equal(occurrences(html, 'id="' + id + '"'), 1, 'original DOM ID changed: ' + id);
}

assert.equal(occurrences(html, 'css/hr-deductions-unified-phase7.css'), 1);
assert.equal(occurrences(html, 'js/hr-deductions-unified-phase7.js'), 1);
assert(html.indexOf('js/hr-dashboard.js') < html.indexOf('js/hr-deductions-unified-phase7.js'));
assert.equal(occurrences(html, 'js/bexhr-ten-record-scroll.js'), 1,
  'existing shared scrolling module must be retained');

// The existing core already moves the Other Deductions panel under statutory.
// This UI adapter must build on that feature, never duplicate or replace it.
assert(html.includes('<option value="EMPLOYEE" selected>Employee Specific</option>'), 'expected ordinary statutory source value changed');
assert(ui.includes("setOptionLabel('payrollStatutoryConfigSource', 'EMPLOYEE',"), 'friendly statutory option must preserve original EMPLOYEE value');
assert(core.includes('function mergePayrollDeductionSetupCards()'));
assert(core.includes('statutoryPanel.appendChild(otherPanel)'));
assert(core.includes('configurePayrollStatutoryPhase4Ui()'));
assert(core.includes('getDefaultStatutoryDeductionSetup('));
assert(core.includes('syncPayrollStatutoryDefaultFromDeductionType()'));
assert(core.includes('handlePayrollStatutorySave()'));
assert(core.includes('handlePayrollOtherDeductionSave()'));

// New UI controls should be categories, not duplicate submit workflows.
assert(ui.includes("const ROOT_ID = 'bexhrUnifiedDeductionsWorkspace'"));
assert(ui.includes("role', 'tablist'"));
assert(ui.includes("role', 'tabpanel'"));
assert(ui.includes('aria-selected'));
assert(ui.includes('ArrowLeft'));
assert(ui.includes('ArrowRight'));
assert(ui.includes('Home'));
assert(ui.includes('End'));
assert(ui.includes('statutory.contains(other)'));
assert(ui.includes('for (const child of originalChildren) pane.appendChild(child)'));
assert(ui.includes("selectCategory('statutory', false)"));
assert(ui.includes('hideLegacyTechnicalFields()'));

// The original form values and payroll methods must stay live even when hidden.
for (const id of [
  'payrollStatutoryCalculationMethod',
  'payrollStatutoryDeductionValue',
  'payrollStatutoryStatus',
  'payrollOtherDeductionStatus',
]) {
  assert(ui.includes("'" + id + "'"), 'hidden technical field not preserved: ' + id);
}
assert(!ui.includes('removeAttribute("required")'));
assert(!ui.includes('field.disabled = true'));
assert(!/\.rpc\s*\(|supabase\.from\s*\(/.test(ui), 'presentation module must not query/write Supabase');

// Plain-language explanation must distinguish employee and employer amounts.
for (const text of [
  'PAYE (income tax)',
  'there is no flat tax percentage',
  'Employee pension',
  'Employer pension',
  'company cost',
  'NHF (housing fund)',
  'Rule based means BexHR calculates',
  'Fixed amount means a specific amount',
]) {
  assert(ui.toLowerCase().includes(text.toLowerCase()), 'missing guidance: ' + text);
}
assert(css.includes('.bexhr-deductions-tab:focus-visible'));
assert(css.includes('.bexhr-deductions-pane[hidden]'));
assert(css.includes('@media (max-width: 680px)'));

// Without the core merge, fail closed. Do not create duplicate cards/forms.
let readyHandler = null;
const document = {
  readyState: 'loading',
  addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') readyHandler = fn; },
  getElementById: () => null,
  body: null,
};
vm.runInNewContext(ui, { document, MutationObserver: undefined, console, setTimeout: () => 0 });
assert.equal(typeof readyHandler, 'function');
assert.doesNotThrow(() => readyHandler());

console.log('PASS: Phase 7A8 unified deductions: one category at a time; old forms/handlers kept; calculations auto-explained; no payroll/backend changes.');
