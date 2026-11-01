const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const dashboardPath = path.join(repo, 'js', 'hr-dashboard.js');
const migrationPath = path.join(repo, 'supabase', 'migrations', '20261101111120_payroll_tax_ytd_foundation.sql');
const source = fs.readFileSync(dashboardPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

assert(source.includes('const PAYROLL_TAX_RULE_VERSION = "NTA_2025_2026_V2_ACTUAL_RELIEFS_ONE_OFF";'));
assert(source.includes('snapshot_version: 3'));
assert(source.includes('actual_relief_contributions_only: true'));
assert(source.includes('one_off_earnings_annualised: false'));
assert(source.includes('monthly_recurring_gross_emoluments'));
assert(source.includes('current_period_one_off_taxable_emoluments'));
assert(source.includes('monthly_eligible_deductions'));

for (const column of [
  'tax_rule_version',
  'tax_calculation_snapshot',
  'ytd_gross_emoluments',
  'ytd_eligible_deductions',
  'ytd_taxable_emoluments',
  'ytd_cumulative_tax',
]) {
  assert(migration.includes(column), column);
}
assert(!/update\s+public\.payroll_records/i.test(migration));

const taxStart = source.indexOf('const NTA_2025_PAYE_BANDS = [');
const taxEnd = source.indexOf('function calculatePayrollGrossPay() {', taxStart);
assert(taxStart >= 0 && taxEnd > taxStart, 'Could not isolate tax helper section');
const context = {};
vm.createContext(context);
vm.runInContext(
  source.slice(taxStart, taxEnd) + '\nthis.__snapshotTest = {' +
    ' calculateNta2025MonthlyPayeTaxFromComponents,' +
    ' buildPayrollTaxSnapshotFieldsFromPayrollValues' +
    ' };',
  context,
);
const helpers = context.__snapshotTest;

const details = helpers.calculateNta2025MonthlyPayeTaxFromComponents({
  basicPay: 500000,
  otherAllowance: 10000,
  oneOffOtherAllowance: 10000,
  monthlyPensionContribution: 0,
  monthlyNhfContribution: 0,
  monthlyHealthContribution: 0,
  returnDetails: true,
});
assert.strictEqual(details.monthlyGross, 510000);
assert.strictEqual(details.monthlyRecurringGross, 500000);
assert.strictEqual(details.currentPeriodOneOffGross, 10000);
assert.strictEqual(details.annualRecurringGross, 6000000);
assert.strictEqual(details.annualGross, 6010000);
assert.strictEqual(details.annualEligibleDeductions, 0);
assert.strictEqual(details.monthlyPayeTax, 74300);

const snapshotFields = helpers.buildPayrollTaxSnapshotFieldsFromPayrollValues({
  payrollModel: 'REGULAR',
  payDate: '2026-11-30',
  basicPay: 500000,
  otherAllowance: 10000,
  oneOffOtherAllowance: 10000,
  grossPay: 510000,
  employeePension: 0,
  monthlyPensionContribution: 0,
  monthlyNhfContribution: 0,
  monthlyHealthContribution: 0,
  payeTax: 74300,
});
const snapshot = snapshotFields.tax_calculation_snapshot;
assert.strictEqual(snapshot.snapshot_version, 3);
assert.strictEqual(snapshot.tax_rule_version, 'NTA_2025_2026_V2_ACTUAL_RELIEFS_ONE_OFF');
assert.strictEqual(snapshot.tax_calculation_basis.monthly_gross_emoluments, 510000);
assert.strictEqual(snapshot.tax_calculation_basis.monthly_recurring_gross_emoluments, 500000);
assert.strictEqual(snapshot.tax_calculation_basis.current_period_one_off_taxable_emoluments, 10000);
assert.strictEqual(snapshot.tax_calculation_basis.annual_recurring_gross_emoluments, 6000000);
assert.strictEqual(snapshot.tax_calculation_basis.annual_gross_emoluments, 6010000);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.pension, 0);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.nhf, 0);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.health, 0);
assert.strictEqual(snapshot.tax_calculation_basis.monthly_calculated_tax, 74300);
assert.strictEqual(snapshot.final_saved_paye_tax, 74300);
assert.strictEqual(snapshotFields.ytd_gross_emoluments, null);

console.log('PASS: payroll tax snapshot uses actual reliefs and non-annualised one-off earnings.');
