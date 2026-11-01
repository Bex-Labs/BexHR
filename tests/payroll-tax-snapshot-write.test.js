const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const dashboardPath = path.join(repo, 'js', 'hr-dashboard.js');
const migrationPath = path.join(
  repo,
  'supabase',
  'migrations',
  '20261101111120_payroll_tax_ytd_foundation.sql',
);

const source = fs.readFileSync(dashboardPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

assert(source.includes('PAYROLL TAX HISTORY SNAPSHOT - PHASE 2B'));
assert(source.includes('PAYROLL TAX HISTORY SNAPSHOT - PHASE 2B2'));
assert(source.includes('const PAYROLL_TAX_RULE_VERSION = "NTA_2025_2026_V1";'));
assert(source.includes('function buildPayrollTaxSnapshotFieldsFromPayrollValues({'));
assert(source.includes('returnDetails = false'));
assert(source.includes('if (returnDetails) {'));
assert(source.includes('annualEligibleDeductions'));

assert(source.includes('snapshot_version: 2'));
assert(!source.includes('snapshot_version: 1'));
assert(source.includes('actual_saved_employee_pension'));
assert(source.includes('tax_calculation_basis'));
assert(source.includes('monthly_gross_emoluments'));
assert(source.includes('annual_gross_emoluments'));
assert(source.includes('annual_reliefs_used'));
assert(source.includes('annual_eligible_deductions'));
assert(source.includes('annual_chargeable_income'));
assert(source.includes('annual_calculated_tax'));
assert(source.includes('monthly_calculated_tax'));
assert(source.includes('relief_values_are_tax_calculation_inputs: true'));
assert(source.includes('actual_saved_employee_pension_is_recorded_separately: true'));
assert(source.includes('ytd_calculation_deferred_to_phase_2c: true'));

assert(source.includes('payrollModel: preparedRow.payroll_model || "REGULAR"'));
assert(source.includes('payrollModel: getSelectedPayrollModel()'));
assert(source.includes('existingPayrollRecord.tax_calculation_snapshot ?? null'));
assert(source.includes('existingPayrollRecord.ytd_cumulative_tax ?? null'));

[
  'ytd_gross_emoluments: null',
  'ytd_eligible_deductions: null',
  'ytd_taxable_emoluments: null',
  'ytd_cumulative_tax: null',
].forEach((marker) => assert(source.includes(marker), marker));

assert(source.includes('{ limit: 800000, rate: 0 }'));
assert(source.includes('{ limit: 2200000, rate: 0.15 }'));
assert(source.includes('{ limit: 9000000, rate: 0.18 }'));
assert(source.includes('{ limit: 13000000, rate: 0.21 }'));
assert(source.includes('{ limit: 25000000, rate: 0.23 }'));
assert(source.includes('{ limit: Infinity, rate: 0.25 }'));
assert(!source.includes('{ limit: 12000000, rate: 0.21 }'));
assert(!source.includes('{ limit: 16000000, rate: 0.23 }'));

[
  'tax_rule_version',
  'tax_calculation_snapshot',
  'ytd_gross_emoluments',
  'ytd_eligible_deductions',
  'ytd_taxable_emoluments',
  'ytd_cumulative_tax',
].forEach((column) => assert(migration.includes(column), column));

assert(!/update\s+public\.payroll_records/i.test(migration));
assert(!/update\s+payroll_records/i.test(migration));

// Execute only the isolated tax/helper section. This proves the live Nov-2026
// example remains NGN 31,451 while the v2 snapshot records the exact basis.
const taxStart = source.indexOf('const NTA_2025_PAYE_BANDS = [');
const taxEnd = source.indexOf('function calculatePayrollGrossPay() {', taxStart);
assert(taxStart >= 0 && taxEnd > taxStart, 'Could not isolate tax helper section');

const isolatedTaxSource = source.slice(taxStart, taxEnd) + '\n' +
  'globalThis.__snapshotTest = {' +
  ' calculateNta2025MonthlyPayeTaxFromComponents,' +
  ' buildPayrollTaxSnapshotFieldsFromPayrollValues' +
  ' };';

const context = {};
vm.createContext(context);
vm.runInContext(isolatedTaxSource, context);

const helpers = context.__snapshotTest;
assert(helpers, 'Isolated tax helpers were not exported');

const components = {
  basicPay: 150000,
  housingAllowance: 30000,
  transportAllowance: 30000,
  utilityAllowance: 30000,
  otherAllowance: 60000,
  medicalAllowance: 0,
  bonus: 0,
  overtime: 0,
  logisticsAllowance: 0,
  dataAirtimeAllowance: 0,
};

const numericPaye = helpers.calculateNta2025MonthlyPayeTaxFromComponents(components);
assert.strictEqual(numericPaye, 31451);

const details = helpers.calculateNta2025MonthlyPayeTaxFromComponents({
  ...components,
  returnDetails: true,
});

assert.strictEqual(details.monthlyGross, 300000);
assert.strictEqual(details.annualGross, 3600000);
assert.strictEqual(details.annualPension, 201600);
assert.strictEqual(details.annualNhf, 45000);
assert.strictEqual(details.annualNhis, 90000);
assert.strictEqual(details.annualRentRelief, 0);
assert.strictEqual(details.annualEligibleDeductions, 336600);
assert.strictEqual(details.annualChargeableIncome, 3263400);
assert.strictEqual(details.annualPayeTax, 377412);
assert.strictEqual(details.monthlyPayeTax, 31451);

const snapshotFields = helpers.buildPayrollTaxSnapshotFieldsFromPayrollValues({
  payrollModel: 'REGULAR',
  payDate: '2026-11-30',
  ...components,
  grossPay: 300000,
  employeePension: 0,
  payeTax: 31451,
});

const snapshot = snapshotFields.tax_calculation_snapshot;
assert.strictEqual(snapshot.snapshot_version, 2);
assert.strictEqual(snapshot.actual_saved_employee_pension, 0);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.pension, 201600);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.nhf, 45000);
assert.strictEqual(snapshot.tax_calculation_basis.annual_reliefs_used.nhis, 90000);
assert.strictEqual(snapshot.tax_calculation_basis.annual_eligible_deductions, 336600);
assert.strictEqual(snapshot.tax_calculation_basis.annual_chargeable_income, 3263400);
assert.strictEqual(snapshot.tax_calculation_basis.annual_calculated_tax, 377412);
assert.strictEqual(snapshot.tax_calculation_basis.monthly_calculated_tax, 31451);
assert.strictEqual(snapshot.final_saved_paye_tax, 31451);
assert.strictEqual(snapshotFields.ytd_gross_emoluments, null);
assert.strictEqual(snapshotFields.ytd_eligible_deductions, null);
assert.strictEqual(snapshotFields.ytd_taxable_emoluments, null);
assert.strictEqual(snapshotFields.ytd_cumulative_tax, null);

console.log('PASS: payroll tax snapshot write + completeness regression.');
