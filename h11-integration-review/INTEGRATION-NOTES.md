# H11 candidate integration — 8 November 2026

**State:** Staging verified, candidate not pushed or deployed. Feature branch base: `feat/hr-workspace-ux-redesign`, commit `d7477204c1ca574bfd479b5135c25356f773932b`.

## Passed in dedicated staging

- HR Admin lands in HR; access to authorised Manager workspace remains available.
- Reporting Structure: Departments / Job Titles / Reporting Lines; any job title may be a reporting **child**, while ordinary employee-only positions cannot supervise.
- Cross-department Operations Associate -> HR Standard Primary assignment **saves**.
- PA route exactly matches saved Primary; Leave Primary and pending decision visibility includes HR Standard; previous Manager loses access.
- Staging payroll red permission banner cleared and user visually confirmed it; payroll tenant RLS retained, anon denied.
- Scrolling over records user-confirmed in HR; script also present on other dashboards and PA, but full browser test there not yet confirmed.

## Safety / critical outstanding

1. **The Phase 7B coordinated backend currently exists in staging but is NOT represented by a complete forward migration in the feature branch.** The supplied SQL-review files assume this backend has already been deployed. Do not silently turn the old rollback rehearsal into a migration, or run its incomplete standalone component.
2. Three SQL review files: reporting validator, HR-role Primary Leave check, payroll view permission. Do not execute against production without authorisation, migration ordering and security review.
3. Pilot SQL tests were routing and RLS checks, NOT live PA-cycle or Leave-request transactions. Complete one focused smoke check before client rollout.
4. Do NOT copy the staging `js/app.js` or `js/supabase-client.js` wholesale; staging carries its own Supabase URL. Candidate installer ports only two verified changes into the repository's own app.js.
5. DO NOT commit/push candidate without comparing against any other local changes not present in base Git commit. The review branch is deliberately isolated.
6. HR banner display was corrected, and the frontend files were syntax-checked; there is no broad acceptance guarantee for Platform Admin / employee / PA wheel scrolling until exercised.

## Work order

1. Inspect candidate diff in the new isolated worktree; review the UI scripts + targeted app/session/HR code.
2. Assemble and review the missing coordinated Phase 7B forward migration from the staging rehearsal sources; ensure full dependency chain/ordering.
3. Move the three reviewed SQL follow-ups into the migration sequence once dependencies are ready.
4. Commit and integrate approved candidate changes into `feat/hr-workspace-ux-redesign`, keeping the original dirty repository untouched.
5. One targeted branch smoke check: reporting dropdowns, Primary Manager Edit/Shortcut, PA/Leave routing, dashboard scrolling, payroll banner, and actual PA/Leave transactions.
6. Close H11, then H12 and the 10 reserved issues. No unrelated redesign or large test matrix.

**Original production database ID is protected and must not be accessed or queried.** Dedicated staging: `rymzqlrfprdvdzzuqiwf` only.

## 8 Nov safety review - consolidated

- New `RUN-H11-REVIEW.ps1` generates `04-H11-P7B-FORWARD-REVIEW-ONLY.sql`
  from the exact pinned Git rehearsal, after `Apply-H11-Candidate.ps1`.
- This is a **review draft only**, deliberately outside `supabase/migrations/`.
- **Do not apply `01-reporting-validator.sql` on top of the coordinated H11 chain**:
  it declares `STABLE`, while the integrated atomic exception validator explicitly
  requires `VOLATILE`. The rehearsal's final validator already delegates correctly.
- `02` Leave and `03` payroll corrections are embedded inside the transaction,
  before its `COMMIT`. Original rollback rehearsal is unmodified.
- Staging contains the Phase 7B validator, but a read-only query did not find
  `bexhr_private.h3b_live_leave_primary_pair(uuid,uuid)`; do not treat staging
  as proving the entire H11 exception/PA/Leave chain is deployed.
- GitHub integration write attempt returned HTTP 403 (`Resource not accessible by
  integration`). No remote branch was created. All files must be reviewed locally.
- The main Windows repository and production Supabase project are untouched.
