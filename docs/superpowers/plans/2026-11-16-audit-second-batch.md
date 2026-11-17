# Audit Second Batch Implementation Plan

> For agentic workers: use subagent-driven-development for disjoint modules and test-driven-development for each confirmed defect. No commits, production deployment or real personnel data changes.

**Goal:** Close remaining confirmed audit defects 6, 7, 10-13 and 15-17; leave department merge (9) deferred under the user's earlier decision.

**Architecture:** Preserve the modular monolith, existing data authority, workflow gates, permissions and snapshot semantics. No schema migration or batch data repair is planned.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue/Element Plus, Node tests, Jest, Playwright, Bash/Docker Compose.

**Spec:** User-approved audit and expert review from this chat, followed by "continue subsequent fixes". The original findings are summarized in task scopes below; first-batch evidence is in docs/acceptance/2026-11-16-audit-first-batch.md.

## Baseline And Global Constraints

- Main and live origin/main: 5956d9d3f824386a18c76c5eda0a189eb1f217ba. Production API/Web: 622fb8cbacf8d99114df5b4912acf441e2458726. All existing containers running on inspection.
- Preserve all first-batch changes plus earlier archive/reference copy fixes and docs/project-memory.md. No unrelated staging, reverting or generated-file churn.
- Preview remains http://localhost:5173, with real isolated backend and fictional data. External notifications/calendar disabled. Only controller updates the preview backend after workers finish.
- Keep current arrival confirmation, reentry identity reuse, departure timing and current authorization rules. No guessing job family, company mappings or personnel values.
- Old scoring must use persisted IndicatorType, not name substrings. No automatic recalculation of existing grades.
- Department merge (9) remains deferred: no implementation of effective-date or future-assignment rules.
- Strict validation once on final source; focused tests while iterating. Retain separate API, integration, real-page and human acceptance evidence.

## Tasks And Ownership

- [x] Main: reproduce and fix 6 in api/src/tasks/scoring.service.ts and its tests. Ordinary KPI names containing bonus/penalty/veto terms must not change their explicit type; explicit special types still calculate correctly.
- [x] Lifecycle worker: reproduce and fix 7/12 in employee-onboarding.service.ts and employee-effective-date.service.ts plus narrowly associated review application code/tests if necessary. A historical reentry revised to current onboarding must regain arrival confirmation; existing snapshots must not change when a position catalog entry is renamed. Keep genuinely historical exempt records and explicit new assignments working.
- [x] Talent worker: reproduce and fix 13 in talents.service.ts and focused tests. A stale editor cannot overwrite lifecycle-linked hired state; use existing transaction/version conventions and retain ability to edit allowed fields after reload. Coordinate with lifecycle worker before touching onboarding/effective files.
- [x] UI worker: reproduce and fix 15 in web/src/components/common/FileUpload.vue and new targeted tests. Parent model replacements, delete/upload/delete ordering, clear/unmount and delayed upload callbacks must not drop or resurrect entries. Keep component contract and upload permissions.
- [x] Main: reproduce and fix 16 in period-reviews.service.ts and tests. Idempotent replay must match period, stage/action, actor and submitted content; a conflicting reuse is rejected, never a false success. Preserve original first-batch reopen-scope patch.
- [x] Operations worker: reproduce and fix 10/11/17 in deploy/scripts/backup.sh, deploy/scripts/restore.sh and scripts/update-prod.sh with isolated harness tests. Backup failure must not report success or purge old backups; restore needs preflight and fail-fast separated commands; release rejects dirty/unverified source, pins revision and scopes services. Never execute deployment or restore against production.
- [x] Independent review of scoped diffs, strict final API/Web validation and isolated integration/page regressions. Evidence limitations and the separate concurrent-approval conflict are retained in the acceptance record.
- [x] Update fixed preview; publish acceptance record and short user instructions, without commit or production release.

## Review Focus

1. Revision of historical onboarding must recompute, not trust a stale exemption; approval must not silently activate a current employee before HR arrival confirmation.
2. Position rename must not rewrite current or historical assignment names; newly selected positions must still adopt current catalog values.
3. Concurrent talent/onboarding updates must serialize or detect conflicts, without converting them to false success or 500.
4. Idempotency must deny a different actor/action/payload while retaining exact retry after successful submission and preventing duplicate logs.
5. Script test doubles are not restore proof; actual disposable-database verification must be separately labeled, with production untouched.

## Progress

2026-11-16: Reviewed AGENTS.md, project memory, current dirty baseline and original 17-finding audit. First batch 1-5/8/14 remains uncommitted and preview-only. Department merge explicitly deferred. Root-cause and failing-regression work starts now.

2026-11-16: Scoring regression failed 11 cases before the fix (80 incorrectly became -40), then all 31 cases passed. Review replay regression failed 18 boundary cases plus 3 concurrent duplicate-key cases before the fix; the final focused scoring/review run passed 102 tests. Real-backend integration and independent review remain pending.

2026-11-16: All scoped implementations complete. API build passed. Full API run: 167 suites, 2840 tests, one outdated projection fixture failed; it was strengthened to call the real approval implementation and check external-change rejection. The changed 60-case suite then passed without another service change; remaining full-run results are retained. Web type-check, build and 238 Node tests passed; operations harness 46/46 passed. Preview updated with production container IDs unchanged. Real integration, page checks and independent review are in progress.

2026-11-16 final: Independent review found and verified fixes for partial-review resumption after position rename, and Nginx resolution after API-only release. Position fix passed 6 related suites/277 tests and all 44 archive suites/737 tests; reviewer separately passed 19 targeted cases. Final API build passed, preview refreshed, final lifecycle HTTP 3/3 passed. Web final Node suite 241/241, real attachment PC/mobile 4/4, scoring/idempotency HTTP 6/6, talent concurrency three final rounds passed. Personnel PC/mobile first run 9/10 encountered one Serializable P2034 under concurrent fixture writes; the unchanged failed scenario passed serial retry, but concurrency/error-message risk remains explicitly open. Operations final harness and guards 55/55, disposable PostgreSQL backup/corrupt-rejection/restore/cleanup checks passed. Preview and public production health JSON are ok; production image revisions/container IDs/start times unchanged. Acceptance record: docs/acceptance/2026-11-16-audit-second-batch.md. No staging, commit or release.
