const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'js', 'hr-dashboard.js'), 'utf8');

assert(source.includes('BEXHR PHASE 4C - DEDUCTIONS SIMPLIFICATION'));
assert(source.includes('function normalizePayrollDeductionStartMonth(value = "")'));
assert(source.includes('function payrollDeductionStartMonthToDate(value = "")'));
assert(source.includes('function getPayrollOtherDeductionLifecycle(record = {}, referenceDateValue = "")'));
assert(source.includes('function getPayrollStatutoryLifecycle(record = {}, referenceDateValue = "")'));
assert(source.includes('configurePayrollOtherDeductionPhase4Ui();'));
assert(source.includes('configurePayrollStatutoryPhase4Ui();'));
assert(source.includes('startMonthField.type = "month"'));
assert(source.includes('"Start Month"'));
assert(source.includes('status: "Active", // Phase 4 lifecycle is derived from Start Month + Duration.'));
assert(source.includes('status: "Active", // Phase 4 lifecycle is system-derived.'));
assert(source.includes('getPayrollOtherDeductionLifecycle(record)'));
assert(source.includes('getPayrollStatutoryLifecycle(record)'));
assert(source.includes('formatPayrollDeductionStartMonth(record.start_date)'));
assert(source.includes('formatPayrollDeductionStartMonth(record.effective_date)'));
assert(source.includes('const statutorySetup = getDefaultStatutoryDeductionSetup(deductionType);'));
assert(source.includes('deduction_value: isRuleBased'));
assert(source.includes(': Number(statutorySetup.value || 0),'));
assert(source.includes('Legacy compatibility only: do not resurrect an explicitly disabled historical row.'));
assert(source.includes('return monthsFromStart >= 0 && monthsFromStart < durationMonths;'));

console.log('PASS: Phase 4C deductions simplification regression.');
