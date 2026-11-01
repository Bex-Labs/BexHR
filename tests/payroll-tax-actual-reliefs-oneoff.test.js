const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const js = fs.readFileSync('js/hr-dashboard.js', 'utf8');
const html = fs.readFileSync('hr-dashboard.html', 'utf8');

function extractFunction(source, functionName) {
  const marker = 'function ' + functionName + '(';
  const start = source.indexOf(marker);
  assert(start >= 0, 'Function missing: ' + functionName);
  const signature = source.slice(start).match(/\)\s*\{/);
  assert(signature && Number.isInteger(signature.index));
  const open = start + signature.index + signature[0].lastIndexOf('{');
  let depth = 0;
  let state = 'code';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (state === 'line') { if (ch === '\n') state = 'code'; continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { state = 'code'; i += 1; } continue; }
    if (state === 'single') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === "'") state = 'code'; continue; }
    if (state === 'double') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') state = 'code'; continue; }
    if (state === 'template') { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '\x60') state = 'code'; continue; }
    if (ch === '/' && next === '/') { state = 'line'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block'; i += 1; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '\x60') { state = 'template'; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  assert.fail('Could not close function: ' + functionName);
}

assert(js.includes('label: "Payroll Adjustments"'), 'Payroll Rules tab still uses legacy Overrides wording');
assert(!js.includes('label: "Employee Overrides"'), 'Employee Overrides tab remains visible');
assert(!html.includes('Allowances &amp; overrides'), 'Setup summary still uses overrides wording');
assert(html.includes('Allowances &amp; adjustments'), 'Setup summary adjustment wording missing');
assert(js.includes('Payroll Adjustments Read Only'), 'Read-only adjustment wording missing');

const bandsStart = js.indexOf('const NTA_2025_PAYE_BANDS = [');
const annualStart = js.indexOf('function calculateAnnualPayeFromBands', bandsStart);
const monthlyStart = js.indexOf('function calculateNta2025MonthlyPayeTaxFromComponents', annualStart);
assert(bandsStart >= 0 && annualStart > bandsStart && monthlyStart > annualStart);
const context = {};
vm.createContext(context);
vm.runInContext(
  js.slice(bandsStart, monthlyStart) + '\n' +
  extractFunction(js, 'calculateNta2025MonthlyPayeTaxFromComponents') + '\n' +
  'this.calc = calculateNta2025MonthlyPayeTaxFromComponents;',
  context,
);

const noRelief = context.calc({
  basicPay: 500000,
  otherAllowance: 10000,
  oneOffOtherAllowance: 10000,
  returnDetails: true,
});
assert.strictEqual(noRelief.monthlyGross, 510000);
assert.strictEqual(noRelief.monthlyRecurringGross, 500000);
assert.strictEqual(noRelief.currentPeriodOneOffGross, 10000);
assert.strictEqual(noRelief.annualRecurringGross, 6000000);
assert.strictEqual(noRelief.annualGross, 6010000, 'One-off earning was multiplied by 12');
assert.strictEqual(noRelief.annualEligibleDeductions, 0, 'Unconfigured relief was invented');
assert.strictEqual(noRelief.monthlyPayeTax, 74300);

const actualReliefs = context.calc({
  basicPay: 500000,
  monthlyPensionContribution: 40000,
  monthlyNhfContribution: 5000,
  monthlyHealthContribution: 0,
  returnDetails: true,
});
assert.strictEqual(actualReliefs.annualPension, 480000);
assert.strictEqual(actualReliefs.annualNhf, 60000);
assert.strictEqual(actualReliefs.annualHealth, 0);
assert.strictEqual(actualReliefs.annualEligibleDeductions, 540000);
assert.strictEqual(actualReliefs.monthlyPayeTax, 64400);

const regularFn = extractFunction(js, 'calculateRegularPayeTax');
assert(regularFn.includes('getCurrentPayrollAdjustmentAmounts()'));
assert(regularFn.includes('getCurrentPayrollActualTaxReliefContributions()'));
assert(regularFn.includes('oneOffBonus: adjustmentAmounts.bonus'));
assert(regularFn.includes('oneOffOvertime: adjustmentAmounts.overtime'));
assert(regularFn.includes('oneOffOtherAllowance: adjustmentAmounts.otherEarning'));

const batchTotalsFn = extractFunction(js, 'calculateBatchStatutoryDeductionTotals');
assert(batchTotalsFn.includes('let payeTax = calculateNta2025MonthlyPayeTaxFromComponents'));
assert(batchTotalsFn.includes('monthlyPensionContribution: employeePension'));
assert(batchTotalsFn.includes('monthlyNhfContribution: nhfContribution'));
assert(batchTotalsFn.includes('monthlyHealthContribution: healthContribution'));

const statutoryBaseFn = extractFunction(js, 'getStatutoryDeductionBaseAmount');
assert(statutoryBaseFn.includes('state.dom.payrollBasicPay'), 'NHF relief base does not use the actual visible Basic Pay');

console.log('PASS: actual tax reliefs, one-off earnings, and Payroll Adjustments wording reconciled.');
