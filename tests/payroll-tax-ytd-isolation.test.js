const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'js', 'hr-dashboard.js'), 'utf8');

assert(source.includes('PAYROLL TAX YTD ISOLATION - PHASE 3'));
assert(source.includes('const currentTenantEmployeeIds = getCurrentTenantEmployeeIdSet();'));
assert(source.includes('!currentTenantEmployeeIds.has(employeeId)'));
assert(source.includes('Payroll YTD tenant safety: selected employee is outside the current company workspace.'));
assert(source.includes('.eq("employee_id", employeeId)'));
assert(source.includes('const crossStaffRow = priorRows.find((row) => {'));
assert(source.includes('Payroll YTD staff safety: prior payroll history returned a different employee.'));
assert(source.includes('baseBatchPayload.map((payload) => applyPayrollYtdToNewPayload(payload))'));
assert(source.includes('payrollPayload = await applyPayrollYtdToNewPayload(payrollPayload)'));

const activeStart = source.indexOf('async function applyPayrollYtdToNewPayload(payload = {})');
assert(activeStart >= 0);
const tenantGuard = source.indexOf('const currentTenantEmployeeIds = getCurrentTenantEmployeeIdSet();', activeStart);
const tenantReject = source.indexOf('!currentTenantEmployeeIds.has(employeeId)', activeStart);
const taxYear = source.indexOf('const taxYear = Number(payDate.slice(0, 4));', activeStart);
const historyQuery = source.indexOf('.from("payroll_records")', taxYear);
const staffFilter = source.indexOf('.eq("employee_id", employeeId)', historyQuery);
const crossStaffGuard = source.indexOf('const crossStaffRow = priorRows.find((row) => {', historyQuery);
const ytdCalculation = source.indexOf('const ytdResult = calculatePayrollYtdShadowFromHistory({', crossStaffGuard);

assert(tenantGuard > activeStart);
assert(tenantReject > tenantGuard);
assert(taxYear > tenantReject);
assert(historyQuery > taxYear);
assert(staffFilter > historyQuery);
assert(crossStaffGuard > staffFilter);
assert(ytdCalculation > crossStaffGuard);

console.log('PASS: payroll YTD tenant + staff isolation regression.');
