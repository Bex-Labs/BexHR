const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'js', 'hr-dashboard.js'), 'utf8');

assert(source.includes('BEXHR PHASE 4B-R - ALLOWANCE SIMPLIFICATION'));
assert(source.includes('function normalizePayrollAllowanceStartMonth(value = "")'));
assert(source.includes('function payrollAllowanceStartMonthToEffectiveDate(value = "")'));
assert(source.includes('function configurePayrollAllowancePhase4Ui()'));
assert(source.includes('startMonthField.type = "month"'));
assert(source.includes('setPayrollAllowancePhase4Label(typeField, "Additional Allowance Type")'));
assert(source.includes('setPayrollAllowancePhase4Label(startMonthField, "Start Month")'));
assert(source.includes('statusField.hidden = true'));
assert(source.includes('statusField.value = "Active"'));
assert(source.includes('isPayrollStructuralAllowanceType(option.value, option.textContent)'));
assert(source.includes('Basic, Housing, Transport and Utility are salary-structure components, not additional allowances.'));
assert(source.includes('payrollAllowanceStartMonthToEffectiveDate('));
assert(source.includes('allowance_status: "Active"'));
assert(source.includes('>Start month</span>'));
assert(source.includes('escapeHtml(allowanceStartMonth)'));
assert(source.includes('normalizePayrollAllowanceStartMonth(record.effective_date)'));
assert(!source.includes('issues.push("Select the allowance status.")'));

console.log('PASS: Phase 4B allowance simplification regression.');
