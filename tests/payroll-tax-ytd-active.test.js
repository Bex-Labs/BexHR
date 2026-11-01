const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const dashboardPath = path.join(repo, 'js', 'hr-dashboard.js');
const source = fs.readFileSync(dashboardPath, 'utf8');

assert(source.includes('PAYROLL TAX YTD ENGINE - PHASE 2C-B'));
assert(source.includes('function applyPayrollYtdResultToPayload(payload = {}, ytdResult = {})'));
assert(source.includes('async function applyPayrollYtdToNewPayload(payload = {})'));
assert(source.includes('status: "READY_APPLIED"'));
assert(source.includes('phase: "2C_B_ACTIVE"'));
assert(source.includes('paye_applied_to_payroll: true'));
assert(source.includes('paye_tax: appliedCurrentPeriodPaye'));
assert(source.includes('total_deductions: totalDeductions'));
assert(source.includes('net_pay: netPay'));
assert(source.includes('final_saved_paye_tax: appliedCurrentPeriodPaye'));
assert(source.includes('baseBatchPayload.map((payload) => applyPayrollYtdToNewPayload(payload))'));
assert(source.includes('payrollPayload = await applyPayrollYtdToNewPayload(payrollPayload)'));
assert(!source.includes('applyPayrollYtdShadowToNewPayload'));

function extractFunction(name, nextNeedle) {
  const start = source.indexOf('function ' + name);
  assert(start >= 0, name + ' start');
  const end = source.indexOf(nextNeedle, start);
  assert(end > start, name + ' end');
  return source.slice(start, end);
}

const roundFn = extractFunction(
  'roundPayrollTaxSnapshotAmount(value)',
  'function buildPayrollTaxSnapshotFieldsFromPayrollValues',
);
const activeFn = extractFunction(
  'applyPayrollYtdResultToPayload(payload = {}, ytdResult = {})',
  'async function applyPayrollYtdToNewPayload',
);

const context = {};
vm.createContext(context);
vm.runInContext(
  roundFn + '\n' + activeFn + '\nthis.applyResult = applyPayrollYtdResultToPayload;',
  context,
);

const basePayload = {
  paye_tax: 100000,
  total_deductions: 140000,
  net_pay: 660000,
  logistics_allowance: 0,
  data_airtime_allowance: 0,
  monthly_salary_plus_logistics: null,
  tax_calculation_snapshot: {
    snapshot_version: 2,
    baseline_calculated_paye_tax: 100000,
    final_saved_paye_tax: 100000,
    paye_adjustment_from_baseline: 0,
    assumptions: {
      ytd_calculation_deferred_to_phase_2c: true,
    },
  },
};

const ready = context.applyResult(basePayload, {
  status: 'READY_SHADOW',
  ytdFields: {
    ytd_gross_emoluments: 1600000,
    ytd_eligible_deductions: 149600,
    ytd_taxable_emoluments: 1450400,
    ytd_cumulative_tax: 250000,
  },
  basis: {
    prior_period_count: 1,
    period_count: 2,
    prior_tax_withheld: 100000,
    shadow_current_period_paye: 150000,
  },
});

assert.strictEqual(ready.paye_tax, 150000);
assert.strictEqual(ready.total_deductions, 190000);
assert.strictEqual(ready.net_pay, 610000);
assert.strictEqual(ready.ytd_gross_emoluments, 1600000);
assert.strictEqual(ready.ytd_cumulative_tax, 250000);
assert.strictEqual(ready.tax_calculation_snapshot.final_saved_paye_tax, 150000);
assert.strictEqual(ready.tax_calculation_snapshot.paye_adjustment_from_baseline, 50000);
assert.strictEqual(ready.tax_calculation_snapshot.ytd_calculation.status, 'READY_APPLIED');
assert.strictEqual(ready.tax_calculation_snapshot.ytd_calculation.paye_applied_to_payroll, true);
assert.strictEqual(ready.tax_calculation_snapshot.ytd_calculation.applied_current_period_paye, 150000);
assert.strictEqual(ready.tax_calculation_snapshot.ytd_calculation.paye_change_from_pre_ytd_payload, 50000);

const logisticsPayload = {
  ...basePayload,
  net_pay: 700000,
  logistics_allowance: 50000,
  data_airtime_allowance: 10000,
  monthly_salary_plus_logistics: 690000,
};
const logisticsReady = context.applyResult(logisticsPayload, {
  status: 'READY_SHADOW',
  ytdFields: {
    ytd_gross_emoluments: 1,
    ytd_eligible_deductions: 1,
    ytd_taxable_emoluments: 1,
    ytd_cumulative_tax: 1,
  },
  basis: {
    shadow_current_period_paye: 120000,
  },
});
assert.strictEqual(logisticsReady.net_pay, 680000);
assert.strictEqual(logisticsReady.monthly_salary_plus_logistics, 670000);

const deferred = context.applyResult(basePayload, {
  status: 'DEFERRED_INCOMPLETE_PRIOR_HISTORY',
  ytdFields: null,
});
assert.strictEqual(deferred.paye_tax, 100000);
assert.strictEqual(deferred.total_deductions, 140000);
assert.strictEqual(deferred.net_pay, 660000);
assert.strictEqual(deferred.ytd_gross_emoluments, null);
assert.strictEqual(deferred.tax_calculation_snapshot.ytd_calculation.paye_applied_to_payroll, false);

console.log('PASS: payroll YTD active PAYE application regression.');
