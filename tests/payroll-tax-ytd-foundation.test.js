const fs = require('fs');
const assert = require('assert');

const migrationPath = "supabase/migrations/20261101111120_payroll_tax_ytd_foundation.sql";
const sql = fs.readFileSync(migrationPath, 'utf8');

for (const column of [
  'tax_rule_version',
  'tax_calculation_snapshot',
  'ytd_gross_emoluments',
  'ytd_eligible_deductions',
  'ytd_taxable_emoluments',
  'ytd_cumulative_tax',
]) {
  assert(sql.includes(column), 'Missing payroll YTD tax column: ' + column);
}

assert(
  !/update\s+public\.payroll_records/i.test(sql),
  'YTD foundation must not fabricate values by backfilling legacy payroll rows.',
);
assert(
  !/delete\s+from\s+public\.payroll_records/i.test(sql),
  'YTD foundation must never delete payroll history.',
);
assert(
  !/alter\s+table\s+public\.(pa_|employee_reporting_lines|organization_job_title)/i.test(sql),
  'YTD foundation must remain outside PA and hierarchy scope.',
);
assert(
  !/create\s+policy|drop\s+policy/i.test(sql),
  'YTD foundation must not disturb existing payroll RLS policies.',
);

console.log('PASS: payroll tax YTD schema foundation regression.');
