const fs = require("fs");
const assert = require("assert");

const html = fs
  .readFileSync(
    "features/performance-appraisal/performance-appraisal.html",
    "utf8",
  )
  .replace(/\r\n?/g, "\n");

assert.ok(
  /id="bexPaOverviewOperations"[\s\S]{0,180}grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(html),
  "PA operation cards must use one full-width column",
);

assert.strictEqual(
  (
    html.match(
      /aria-labelledby="bexPaOverviewPriorityTitle"/g,
    ) || []
  ).length,
  1,
  "Priority attention panel must remain singular",
);

assert.strictEqual(
  (
    html.match(
      /aria-labelledby="bexPaOverviewActiveCycleTitle"/g,
    ) || []
  ).length,
  1,
  "Active cycle panel must remain singular",
);

assert.strictEqual(
  (
    html.match(
      /style="align-self:\s*start;"/g,
    ) || []
  ).length,
  0,
  "Old side-by-side self-alignment workaround must be removed",
);

console.log(
  "PASS: PA overview stacked layout unit/functionality QA.",
);
