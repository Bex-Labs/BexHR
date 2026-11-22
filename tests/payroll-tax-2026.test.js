const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const sourcePath = path.join(repo, 'js', 'hr-dashboard.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

assert.ok(source.includes('{ limit: 13000000, rate: 0.21 }'), '21% NTA band must be next NGN 13,000,000.');
assert.ok(source.includes('{ limit: 25000000, rate: 0.23 }'), '23% NTA band must be next NGN 25,000,000.');
assert.ok(!source.includes('{ limit: 12000000, rate: 0.21 }'), 'Old NGN 12,000,000 21% band must be absent.');
assert.ok(!source.includes('{ limit: 16000000, rate: 0.23 }'), 'Old NGN 16,000,000 23% band must be absent.');

const taxStart = source.indexOf('const NTA_2025_PAYE_BANDS = [');
const taxEnd = source.indexOf('// PAYROLL TAX DEDUCTION CALCULATION - STEP 1\n// Calculates monthly PAYE', taxStart);
assert.ok(taxStart >= 0 && taxEnd > taxStart, 'Annual PAYE calculator block was not found.');

const context = {};
vm.runInNewContext(source.slice(taxStart, taxEnd) + '\nthis.__tax = { calculateAnnualPayeFromBands };', context);
const annual = context.__tax.calculateAnnualPayeFromBands;
const approx = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - Number(expected)) <= 0.01, `${label}: expected ${expected}, got ${actual}`);

approx(annual(800000), 0, 'NGN 800k');
approx(annual(3000000), 330000, 'NGN 3m');
approx(annual(12000000), 1950000, 'NGN 12m');
approx(annual(25000000), 4680000, 'NGN 25m');
approx(annual(50000000), 10430000, 'NGN 50m');
approx(annual(60000000), 12930000, 'NGN 60m');

// The corrected constant is shared: normal/manual payroll, batch payroll and
// the Alpatech batch template all call the same PAYE calculator.
assert.ok(source.includes('function calculateRegularPayeTax()'), 'Manual payroll PAYE path is missing.');
assert.ok(source.includes('function calculateBatchStatutoryDeductionAmount(record = {}, context = {})'), 'Batch payroll PAYE path is missing.');
assert.ok(source.includes('function buildBatchPayrollTemplateRow(employee = {})'), 'Alpatech batch template path is missing.');
assert.ok((source.match(/calculateNta2025MonthlyPayeTaxFromComponents/g) || []).length >= 4, 'Shared PAYE calculator is not used across expected payroll paths.');

console.log('PASS: 2026 NTA PAYE bands system-wide regression.');
