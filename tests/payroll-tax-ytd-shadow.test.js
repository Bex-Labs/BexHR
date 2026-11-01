const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const dashboardPath = path.join(repo, 'js', 'hr-dashboard.js');
const source = fs.readFileSync(dashboardPath, 'utf8');

assert(source.includes('PAYROLL TAX YTD ENGINE - PHASE 2C-A'));
assert(source.includes('PAYROLL TAX YTD ENGINE - PHASE 2C-B'));
assert(source.includes('function calculatePayrollYtdShadowFromHistory({'));
assert(source.includes('DEFERRED_CURRENT_PAYE_ADJUSTMENT'));
assert(source.includes('DEFERRED_INCOMPLETE_PRIOR_HISTORY'));
assert(source.includes('DEFERRED_PRIOR_PAYE_ADJUSTMENT'));
assert(source.includes('READY_SHADOW'));

function extractFunction(name, nextNeedle) {
  const start = source.indexOf('function ' + name);
  assert(start >= 0, name + ' start');
  const end = source.indexOf(nextNeedle, start);
  assert(end > start, name + ' end');
  return source.slice(start, end);
}

const annualBandsStart = source.indexOf('const NTA_2025_PAYE_BANDS = [');
const annualFnStart = source.indexOf('function calculateAnnualPayeFromBands', annualBandsStart);
const monthlyFnStart = source.indexOf('function calculateNta2025MonthlyPayeTaxFromComponents', annualFnStart);
assert(annualBandsStart >= 0 && annualFnStart > annualBandsStart && monthlyFnStart > annualFnStart);

const annualBandsAndFn = source.slice(annualBandsStart, monthlyFnStart);
const roundFn = extractFunction(
  'roundPayrollTaxSnapshotAmount(value)',
  'function buildPayrollTaxSnapshotFieldsFromPayrollValues',
);
const versionFn = extractFunction(
  'getPayrollTaxSnapshotVersion(snapshot = null)',
  'function getPayrollTaxSnapshotMonthlyEligibleDeductions',
);
const monthlyEligibleFn = extractFunction(
  'getPayrollTaxSnapshotMonthlyEligibleDeductions(snapshot = null)',
  'function calculatePayrollYtdShadowFromHistory',
);
const ytdFn = extractFunction(
  'calculatePayrollYtdShadowFromHistory({',
  'function applyPayrollYtdResultToPayload',
);

const context = {};
vm.createContext(context);
vm.runInContext(
  'const PAYROLL_TAX_RULE_VERSION = "NTA_2025_2026_V1";\n' +
    annualBandsAndFn + '\n' + roundFn + '\n' + versionFn + '\n' +
    monthlyEligibleFn + '\n' + ytdFn +
    '\nthis.runYtd = calculatePayrollYtdShadowFromHistory;',
  context,
);

function makeSnapshot(monthlyGross, annualEligible, paye, extra = {}) {
  return {
    snapshot_version: 2,
    tax_rule_version: 'NTA_2025_2026_V1',
    paye_adjustment_from_baseline: 0,
    final_saved_paye_tax: paye,
    tax_calculation_basis: {
      monthly_gross_emoluments: monthlyGross,
      annual_eligible_deductions: annualEligible,
    },
    ...extra,
  };
}

const first = context.runYtd({
  priorRows: [],
  currentPayload: {
    tax_rule_version: 'NTA_2025_2026_V1',
    gross_pay: 800000,
    tax_calculation_snapshot: makeSnapshot(800000, 897600, 113036),
  },
});
assert.strictEqual(first.status, 'READY_SHADOW');
assert.strictEqual(first.ytdFields.ytd_gross_emoluments, 800000);
assert.strictEqual(first.ytdFields.ytd_eligible_deductions, 74800);
assert.strictEqual(first.ytdFields.ytd_taxable_emoluments, 725200);
assert.strictEqual(first.ytdFields.ytd_cumulative_tax, 113036);
assert.strictEqual(first.basis.shadow_current_period_paye, 113036);

const legacy = context.runYtd({
  priorRows: [
    {
      id: 'legacy-row',
      gross_pay: 500000,
      paye_tax: 50000,
      tax_rule_version: null,
      tax_calculation_snapshot: null,
    },
  ],
  currentPayload: {
    tax_rule_version: 'NTA_2025_2026_V1',
    gross_pay: 800000,
    tax_calculation_snapshot: makeSnapshot(800000, 897600, 113036),
  },
});
assert.strictEqual(legacy.status, 'DEFERRED_INCOMPLETE_PRIOR_HISTORY');
assert.strictEqual(legacy.ytdFields, null);

const currentOverride = context.runYtd({
  priorRows: [],
  currentPayload: {
    tax_rule_version: 'NTA_2025_2026_V1',
    gross_pay: 800000,
    tax_calculation_snapshot: {
      ...makeSnapshot(800000, 897600, 120000),
      paye_adjustment_from_baseline: 6964,
    },
  },
});
assert.strictEqual(currentOverride.status, 'DEFERRED_CURRENT_PAYE_ADJUSTMENT');

const priorManualOverride = context.runYtd({
  priorRows: [
    {
      id: 'manual-adjustment',
      gross_pay: 800000,
      paye_tax: 120000,
      tax_rule_version: 'NTA_2025_2026_V1',
      tax_calculation_snapshot: {
        ...makeSnapshot(800000, 897600, 120000),
        paye_adjustment_from_baseline: 6964,
      },
    },
  ],
  currentPayload: {
    tax_rule_version: 'NTA_2025_2026_V1',
    gross_pay: 800000,
    tax_calculation_snapshot: makeSnapshot(800000, 897600, 113036),
  },
});
assert.strictEqual(priorManualOverride.status, 'DEFERRED_PRIOR_PAYE_ADJUSTMENT');

const priorAppliedYtd = context.runYtd({
  priorRows: [
    {
      id: 'verified-ytd-row',
      gross_pay: 800000,
      paye_tax: 120000,
      tax_rule_version: 'NTA_2025_2026_V1',
      tax_calculation_snapshot: {
        ...makeSnapshot(800000, 897600, 120000),
        paye_adjustment_from_baseline: 6964,
        ytd_calculation: {
          phase: '2C_B_ACTIVE',
          status: 'READY_APPLIED',
          paye_applied_to_payroll: true,
        },
      },
    },
  ],
  currentPayload: {
    tax_rule_version: 'NTA_2025_2026_V1',
    gross_pay: 800000,
    tax_calculation_snapshot: makeSnapshot(800000, 897600, 113036),
  },
});
assert.strictEqual(priorAppliedYtd.status, 'READY_SHADOW');

console.log('PASS: payroll YTD engine + safety deferral regression.');
