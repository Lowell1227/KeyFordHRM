# Employee archive maintenance markers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR sees actionable current dossier issues and those issues disappear automatically when actual records are corrected.

**Architecture:** Extend existing archive issue surfaces with current-fact evaluation, using the same evaluator for list, filter and detail. Existing dossier writes remain authoritative. The user's later reversible-checkbox requirement uses one lightweight versioned exemption model plus existing audit, without duplicate employee records or an approval process.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-23-employee-archive-maintenance-markers-design.md

## Global constraints

- Work on codex/archive-maintenance-markers from origin/main e9427df4; preserve unrelated dirty checkout.
- No production data edits or deployment during implementation. Fictional isolated preview only.
- Current records, not old roster comparisons, determine current issues. Confirmed not-applicable and month-only facts do not become missing-date alerts.
- Existing archive-edit/review permissions remain unchanged. Full identity, phone and bank values never appear in issue payloads.
- No blocking saves, no repeated confirmation after successful correction, no automatic date truncation, account changes or performance snapshot writes.

## Review focus

- Combined problems disappear only after all relevant conditions are corrected.
- A manual explanation cannot close a changed record using a stale fingerprint; unrelated edits do not reopen it.
- Resigned, archived and not-applicable dossiers do not acquire inappropriate active-employment alerts.
- Filter totals and pagination include all matching authorized employees, not only the current page.
- Successful save refreshes the marker and field prompts without reintroducing old source warnings.

### Task 1: Current-fact evaluation and issue explanation

Files: create api/src/employee-archives/employee-archive-current-issues.ts and .spec.ts; extend employee-archive-issues.service.ts, controller, dto and service tests.

Interfaces: currentArchiveIssues(user, context) returns existing ArchiveIssue-compatible items with origin=current, stable issue IDs and relevant-fact fingerprints; loadCurrentArchiveIssues(prisma, userIds) batches facts, confirmation exceptions and exemptions. setExemption(userId, issueId, fingerprint, isExempt, expectedVersion, reason, operator) uses existing HR capability gates and a serializable transaction to update the metadata switch and append audit, never employee facts.

- [x] Add failing evaluator tests for missing entry/department, inconsistent regularization, future actual dates, expired recorded contracts, overlap and absent contracts; assert post-edit disappearance.
- [x] Add tests for archived/not-applicable exclusion, inactive contract exclusion, unknown starts, month precision, actual versus planned future dates, sensitive-value redaction, and stable fingerprints.
- [x] Implement evaluator and batch reader; do not generate general optional-profile alerts.
- [x] Add service tests for access denial, stale versions, related-fact reopen and read-only no-op after an issue disappears; implement reversible exemption endpoint with validated optional reason.
- [x] Run focused Jest suites and API build.

### Task 2: Unified list/filter/detail behavior

Files: api/src/users/users.service.ts, dto/user-query.dto.ts, relevant users tests; web/src/api/employee-archives.api.ts, users.api.ts; components/common/EmployeeArchiveIssues.vue; views/admin/UserManageView.vue and archive editor components as required.

Interfaces: needsMaintenance boolean filter uses the same authorized current-fact set before pagination. Existing issue endpoint returns current issues plus applicable legacy request issues. Current issues render current facts and action text without source/current comparison.

- [x] Add failing tests proving list counts, filter totals/pages and detail agree, and ordinary viewers cannot use a private issue filter.
- [x] Integrate batched current issues with list counts and server filtering while preserving existing query scope/export behavior.
- [x] Add real-backend Web tests for “待完善 N项”, current facts, “去补充” field positioning, check/uncheck exemptions, audit details, and re-fetch after a successful save.
- [x] Update PC/mobile list and drawer prompts; clear resolved context after save; keep unresolved partial changes visible.
- [x] Run relevant Web checks and focused Playwright regression.

### Task 3: Isolated preview and review

- [x] Run full API suite for shared query/access changes, API build, Web type check/production build and current-feature browser tests.
- [x] Create fictional dossier cases in hrm_preview only; disable external notifications. Verify HR can edit, reader cannot resolve, employee cannot read private issues.
- [x] Verify actual PC 1440/1024 and mobile 390px paths: problem → edit → save → marker/filter/field prompt disappears; exemptions preserve formal fields. Contract overlap evaluation and related-fact reopen covered by focused tests.
- [x] Whole-branch review, fix substantive findings, record code/technical preview/business acceptance separately.
- [x] Commit only this task after staged-list and diff checks; provide fixed http://localhost:5173 preview and await task-scoped release authorization.

## Execution ledger

- Baseline: managed worktree from e9427df4, branch codex/archive-maintenance-markers. Original dirty main unchanged.
- Ruling: execute inline under the user's direct implementation request; do not ask them to choose internal agent execution mechanics.
- Ruling: evaluation is computed from current facts, so ordinary fixes require no separate “resolved” write. Existing dossier audits trace those edits.
- Ruling: user added reversible exemption checkboxes and optional explanation. A dedicated metadata table, uniquely keyed by employee, issue and relevant-fact fingerprint, stores the switch/version; audit remains append-only. This replaces the originally planned explanation-only audit state and adds a migration requiring isolated deployment checks.
- Red/green: current-fact and reversible-exemption tests passed; users filter and existing issue/UsersService tests passed. Initial real preview browser test failed on the missing marker as expected. Final API 244 suites/4600 tests passed; API/Web builds passed. Desktop/mobile actual-backend paths and separate 1024px paths passed; real HTTP role/version checks passed.
- Review fixes: exempting contract-expired no longer suppresses independent overlap hints; social-only future dates focus the social field; history records business-readable original facts. Canceling an older exemption records its original snapshot even after related dates change. Fresh reviewer verified the regression and reported no remaining findings.
- Broader Web check: 77/104 passed, 27 failed. An isolated HEAD source comparison reproduced exactly the same 27 failures (ESM/CJS import.meta harness, historical expectations); no new failures. These are disclosed existing debt, not marked passing. Real HTTP and desktop/mobile feature tests are separate evidence.
