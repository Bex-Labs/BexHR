'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.BEXHR_PHASE7A9_TEST_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'hr-dashboard.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'js/hr-payroll-clarity-phase7.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/hr-payroll-clarity-phase7.css'), 'utf8');

function once(fragment) { assert.equal(html.split(fragment).length - 1, 1, 'Expected a single HTML marker: ' + fragment); }

for (const id of [
  'payrollEmployeeOverrideCreateForm', 'payrollEmployeeOverrideMasterRecordId',
  'payrollEmployeeOverrideEffectiveDate', 'payrollEmployeeOverrideElement',
  'payrollEmployeeOverrideValue', 'payrollEmployeeOverrideReason',
  'payrollOtherDeductionCreateForm', 'payrollStatutoryCreateForm',
  'payrollAllowanceCreateForm', 'payrollAllowanceType',
  'savePayrollEmployeeOverrideBtn', 'bexhrPayrollAdjustmentTypeHelp',
  'bexhrPayrollAllowanceTypeHelp'
]) once('id="' + id + '"');

for (const tag of [
  'css/hr-payroll-clarity-phase7.css', 'js/hr-payroll-clarity-phase7.js',
  'Need a lasting change?', 'Finalised historical payroll is not changed',
  'Other (built-in 20% salary share)', 'Adds to pay:',
  'Reduces take-home pay:', 'Review the selected month'
]) assert(html.includes(tag), 'Missing user-friendly guidance: ' + tag);

assert(html.includes('BEXHR_PHASE5_ADJUSTMENT_V1'), 'existing adjustment marker lost');
assert(html.includes('payrollEmployeeOverrideRuleSnapshot'), 'existing adjustment hidden input lost');
assert(html.includes('id="payrollAllowanceMasterRecordId"'), 'allowance setup form altered');
assert(!/supabase|fetch\s*\(|\.rpc\s*\(/i.test(code), 'Guidance-only script must not call backend');
assert(!/\.value\s*=|\.disabled\s*=|\.readOnly\s*=/.test(code), 'Guidance script must not mutate payroll form fields');
assert(!/submit|click\s*\(/i.test(code), 'Guidance must not submit forms or click buttons');
assert(css.includes('bexhr-payroll-clarity-guide'), 'missing shared help styling');

function field(initial='') {
  const handlers = {};
  return {
    value: initial,
    textContent: '',
    dataset: {},
    addEventListener(event, handler) { (handlers[event] ||= []).push(handler); },
    fire(event) { for (const handler of handlers[event] || []) handler(); }
  };
}
const adjustment = field('');
const adjustmentHelp = field();
const allowance = field('');
const allowanceHelp = field();
const nodes = {
  payrollEmployeeOverrideElement: adjustment,
  bexhrPayrollAdjustmentTypeHelp: adjustmentHelp,
  payrollAllowanceType: allowance,
  bexhrPayrollAllowanceTypeHelp: allowanceHelp
};
const document = { readyState: 'complete', getElementById(id) { return nodes[id] || null; } };
vm.runInNewContext(code, { document }, { filename: 'hr-payroll-clarity-phase7.js' });

for(const [value, term] of [
  ['BONUS', 'one-time bonus'], ['OVERTIME','overtime'],
  ['OTHER_ALLOWANCE','another approved earning'], ['OTHER','Subtracts']
]) {
  adjustment.value = value;
  adjustment.fire('change');
  assert(adjustmentHelp.textContent.includes(term), 'Incorrect adjustment explanation: ' + value);
  assert.equal(adjustment.value, value, 'Help changed adjustment selection');
}
allowance.value = 'Other'; allowance.fire('change');
assert(allowanceHelp.textContent.includes('built-in 20%'), 'Other salary split not explained');
allowance.value = 'Bonus'; allowance.fire('change');
assert(allowanceHelp.textContent.includes('one month'), 'Recurring bonus not distinguished from one-off');
allowance.value = 'Medical'; allowance.fire('change');
assert(allowanceHelp.textContent.includes('separately approved'), 'Extra allowance not distinguished');
assert.equal(adjustment.dataset.bexhrPayrollClarityBound,'true');
assert.equal(allowance.dataset.bexhrPayrollClarityBound,'true');

console.log('PASS: Phase 7A9 plain-language payroll: tax/salary/allowance vs one-off guidance, dynamic signed effects, unchanged forms and handlers.');
