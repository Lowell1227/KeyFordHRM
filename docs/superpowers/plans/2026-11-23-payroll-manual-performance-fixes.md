# Payroll Manual Performance and Source Fixes

> **For agentic workers:** Use superpowers:executing-plans or bounded parallel workers. Preserve concurrent changes; no production changes.

**Goal:** Repair the confirmed source defects and support reviewed, manually entered monthly performance wages without requiring performance publication.

**Architecture:** Extend the existing versioned payroll rule JSON with a manual monthly amount map. Reuse HR entry, direct-manager parameter review, salary calculation, batch approvals, immutable actual payments and protected export. No new tables, parallel approval engine or automatic grants.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus.

**Spec:** User decisions on 2026-11-23: manual performance wage amount; HR entry and manager review; investigate real attendance; repair confirmed defects. The existing formal-readiness ledger remains authoritative for unconfirmed financial parameters.

## Boundaries

- Explicit manual amounts, including explicit zero; missing is not zero.
- No automatic performance reading or proration in manual mode. Fixed salary calendar calculation is unchanged.
- Manual/automatic modes cannot mix within one employee/month; retain existing automatic history and future configuration.
- Approved unpaid sources are rechecked before export/payment. Paid facts remain immutable and corrections require a new approval.
- Real attendance investigation is read-only, no real wages or personal data copied into preview, no DingTalk permission changes.
- Production remains disabled and unchanged. Source version stays 0.9.2.

## Tasks

- [x] Add failing policy/capture tests for manual monthly amounts, blanks/zero, invalid money, mid-month employment and mode conflicts.
- [x] Implement `sourceKind: manual`, employee-keyed `manualAmounts`, scope validation and frozen manual source evidence, reusing reviewed rule versions.
- [x] Repair approved-unpaid automatic/manual source freshness at detail/export/payment; test paid and canceled exclusions.
- [x] Repair formal cycle metadata options with subject authorization, monthly filtering and preview fixture isolation.
- [x] Add compact manual amount editing, preserve automatic configurations and cover PC/mobile real-backend usage.
- [x] Verify current DingTalk attendance capability without changing external configuration; report actual access blockers separately.
- [x] Run final strict API suite/build, Web checks and relevant real-PG/HTTP/Playwright checks once stable; independent review.
- [x] Update acceptance/readiness evidence and deliver fixed preview. Commit/push only own files after checking; no deployment; Git receipt governs synchronization status.

## Review Focus

- Monthly manual amount is applied once, not once per day or multiplied by attendance ratio.
- Missing values and incompatible modes block, rather than silently paying zero.
- Foreign-subject employee keys cannot leak or enter a rule snapshot.
- An employee already paid is not made stale by later source changes; unpaid arrangements cannot use superseded approved input.
- Existing performance scoring, publication and salary authorization remain unchanged.

## Verification Ledger

- Initial focused tests observed six intended failures; manual capture/policy then passed. Manual publication and employee scope gates each had observed RED cases before implementation.
- New real-backend Playwright desktop/mobile flows passed (39.9s/35.9s), including manager return/resubmit, named amounts, net calculation, independent approvals and encrypted download; no actual payment.
- Real HTTP/PG manual scenario passed six groups, including approved-source revision blocking and canceled-unpaid recovery, with paid facts zero.
- First strict API run: 239/241 suites passed; two newly added guards were intentionally still RED. Their implementation then passed the relevant four suites/249 tests. Remaining unchanged full-run results are reusable; final payroll modules will cover independent-review changes.
- Independent review found automatic-to-manual mapping changes, missing frozen dependencies and legacy already-paid performance false holds. These were repaired before final delivery, without a second mechanical full-project run.
- Extra Web legacy interface tests exposed stale expectations; update them to current controls without removing assertions. New real-backend evidence is separate from substituted HTTP evidence.
- Real DingTalk token succeeded; attendance minimum-page probe blocked with 88/60020. No person data was read and no external configuration changed.
- Final review fixes are covered by targeted payroll checks; last two malformed-source RED cases then passed with deductions/helper 2 suites/138 tests. Prior unchanged passing suites are reused explicitly rather than rerunning the whole repository.
- Legacy Web response tests were repaired with stronger field/request/currency assertions: 20/20 passed, no skips; remaining 50 unchanged module cases retain their passing evidence.
