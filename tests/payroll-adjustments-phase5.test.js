const fs = require('fs');
const assert = require('assert');
const js = fs.readFileSync('js/hr-dashboard.js', 'utf8');
const html = fs.readFileSync('hr-dashboard.html', 'utf8');

assert(js.includes('BEXHR_PHASE5_ADJUSTMENT_V1'), 'Phase 5 adjustment marker missing');
assert(js.includes('function isPayrollEmployeeAdjustmentRecord'), 'Adjustment discriminator missing');
assert(js.includes('function getPayrollEmployeeAdjustmentAmountsForMaster'), 'Adjustment totals helper missing');
assert(js.includes('applyActivePayrollEmployeeEarningAdjustmentsToPayrollForm();'), 'Earning adjustment ordering missing');
assert(js.includes('applyActivePayrollEmployeeDeductionAdjustmentsToPayrollForm();'), 'Deduction adjustment ordering missing');
assert(js.includes('const otherAllowance = (newBaseSalary * 0.2) + adjustmentAmounts.otherEarning;'), 'Batch other earning integration missing');
assert(js.includes('const otherDeductions = statutoryTotals.otherDeductions + adjustmentAmounts.otherDeduction;'), 'Batch deduction integration missing');
assert(html.includes('Adjustment Type'), 'Adjustment Type field missing');
assert(html.includes('Pay Period'), 'Pay Period field missing');
assert(html.includes('Create Adjustment'), 'Adjustment create button missing');
assert(html.includes('Select pay period'), 'Pay Period display placeholder missing');
assert(!html.includes('Approval Reference'), 'Approval Reference still visible');
assert(!html.includes('Rule Snapshot'), 'Rule Snapshot still visible');
assert(!html.includes('Advanced Employee Payroll Exceptions'), 'Advanced Overrides title still visible');
console.log('PASS: Phase 5 payroll adjustments focused regression.');


// Phase 5B control wiring regression.
assert(js.includes('function bindPayrollAdjustmentPayPeriodControl'), 'Pay Period control binder missing');
assert(js.includes('field.showPicker();'), 'Pay Period showPicker bridge missing');
assert(js.includes('populatePayrollEmployeeOverrideElementOptions();'), 'Adjustment Type initial population missing');
assert(js.includes('bindPayrollAdjustmentPayPeriodControl();'), 'Pay Period binder is not initialised from workspace refresh');
