const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'js', 'hr-dashboard.js'), 'utf8');
const RULE = 'NTA_2025_2026_V2_ACTUAL_RELIEFS_ONE_OFF';

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert(start >= 0, name + ' start');
  const signature = source.slice(start).match(/\)\s*\{/);
  assert(signature && Number.isInteger(signature.index), name + ' body');
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
  assert.fail('Could not close ' + name);
}

const bandsStart = source.indexOf('const NTA_2025_PAYE_BANDS = [');
const annualStart = source.indexOf('function calculateAnnualPayeFromBands', bandsStart);
const monthlyStart = source.indexOf('function calculateNta2025MonthlyPayeTaxFromComponents', annualStart);
assert(bandsStart >= 0 && annualStart > bandsStart && monthlyStart > annualStart);
const annualBandsAndFn = source.slice(bandsStart, monthlyStart);

const context = {};
vm.createContext(context);
vm.runInContext(
  'const PAYROLL_TAX_RULE_VERSION = "' + RULE + '";\n' +
  annualBandsAndFn + '\n' +
  extractFunction('roundPayrollTaxSnapshotAmount') + '\n' +
  extractFunction('getPayrollTaxSnapshotVersion') + '\n' +
  extractFunction('getPayrollTaxSnapshotMonthlyEligibleDeductions') + '\n' +
  extractFunction('getPayrollTaxSnapshotMonthlyRecurringGross') + '\n' +
  extractFunction('getPayrollTaxSnapshotCurrentPeriodOneOffTaxable') + '\n' +
  extractFunction('calculatePayrollYtdShadowFromHistory') + '\n' +
  'this.runYtd = calculatePayrollYtdShadowFromHistory;',
  context,
);

function makeSnapshot(recurringGross, oneOff, monthlyEligible, paye, extra = {}) {
  return {
    snapshot_version: 3,
    tax_rule_version: RULE,
    paye_adjustment_from_baseline: 0,
    final_saved_paye_tax: paye,
    tax_calculation_basis: {
      monthly_gross_emoluments: recurringGross + oneOff,
      monthly_recurring_gross_emoluments: recurringGross,
      current_period_one_off_taxable_emoluments: oneOff,
      monthly_eligible_deductions: monthlyEligible,
      annual_eligible_deductions: monthlyEligible * 12,
    },
    ...extra,
  };
}

const first = context.runYtd({
  priorRows: [],
  currentPayload: {
    tax_rule_version: RULE,
    gross_pay: 510000,
    tax_calculation_snapshot: makeSnapshot(500000, 10000, 0, 74300),
  },
});
assert.strictEqual(first.status, 'READY_SHADOW');
assert.strictEqual(first.ytdFields.ytd_gross_emoluments, 510000);
assert.strictEqual(first.ytdFields.ytd_eligible_deductions, 0);
assert.strictEqual(first.ytdFields.ytd_taxable_emoluments, 510000);
assert.strictEqual(first.ytdFields.ytd_cumulative_tax, 74300);
assert.strictEqual(first.basis.annualised_recurring_taxable_emoluments, 6000000);
assert.strictEqual(first.basis.cumulative_one_off_taxable_emoluments, 10000);
assert.strictEqual(first.basis.shadow_current_period_paye, 74300);

const second = context.runYtd({
  priorRows: [{
    id: 'nov',
    gross_pay: 510000,
    paye_tax: 74300,
    tax_rule_version: RULE,
    tax_calculation_snapshot: makeSnapshot(500000, 10000, 0, 74300, {
      ytd_calculation: { phase: '2C_B_ACTIVE', status: 'READY_APPLIED', paye_applied_to_payroll: true },
    }),
  }],
  currentPayload: {
    tax_rule_version: RULE,
    gross_pay: 500000,
    tax_calculation_snapshot: makeSnapshot(500000, 0, 0, 72500),
  },
});
assert.strictEqual(second.status, 'READY_SHADOW');
assert.strictEqual(second.ytdFields.ytd_gross_emoluments, 1010000);
assert.strictEqual(second.ytdFields.ytd_cumulative_tax, 146800);
assert.strictEqual(second.basis.cumulative_one_off_taxable_emoluments, 10000);
assert.strictEqual(second.basis.shadow_current_period_paye, 72500);

const oldVersion = context.runYtd({
  priorRows: [{
    id: 'old-v2',
    gross_pay: 500000,
    paye_tax: 50000,
    tax_rule_version: 'NTA_2025_2026_V1',
    tax_calculation_snapshot: { snapshot_version: 2 },
  }],
  currentPayload: {
    tax_rule_version: RULE,
    gross_pay: 500000,
    tax_calculation_snapshot: makeSnapshot(500000, 0, 0, 72500),
  },
});
assert.strictEqual(oldVersion.status, 'DEFERRED_INCOMPLETE_PRIOR_HISTORY');
assert.strictEqual(oldVersion.ytdFields, null);

const currentOverride = context.runYtd({
  priorRows: [],
  currentPayload: {
    tax_rule_version: RULE,
    gross_pay: 500000,
    tax_calculation_snapshot: {
      ...makeSnapshot(500000, 0, 0, 80000),
      paye_adjustment_from_baseline: 7500,
    },
  },
});
assert.strictEqual(currentOverride.status, 'DEFERRED_CURRENT_PAYE_ADJUSTMENT');

console.log('PASS: payroll YTD annualises recurring earnings only and carries one-off earnings once.');
