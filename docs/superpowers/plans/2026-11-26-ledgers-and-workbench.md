# Ledger Lifecycle And Precise Workbench Implementation Plan

> **For agentic workers:** Use risk-based TDD and disjoint implementation ownership. Do not deploy production or alter real records. Keep this checklist current.

**Goal:** Make existing work discoverable by its actual handler, add auditable termination and logical removal to performance records, and present consistent collapsible dashboard sections.

**Architecture:** Keep existing NestJS domain services, Vue workflow lists, frozen performance relationships and payroll subject permissions. Dashboard summaries project original domain state and deep-link to original records; they are not a second workflow. Lifecycle metadata must protect both reads and writes and retain effective business facts.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest and Playwright.

**Spec:** User-approved requirements in this chat on 2026-11-26, summarized below. This plan does not authorize production deployment; preview is required and publishing remains deferred until the Docker migration.

## Baseline And Constraints

- Current checkout: `codex/performance-response-fix-20261126`, clean at `0eb8b3a9`; includes pending 0.9.3 response fixes.
- Fresh remote main/local main: `8c9551e6`; production API/Web: `4bb2a4cf` (read-only container check).
- Reuse this worktree; do not modify other worktrees, main, production, DingTalk, real permissions or real employee/payroll records.
- Preserve the shared preview's fictional payroll/recruitment records and external-side-effect isolation. Inspect mounts and resources before updating it; do not reset or reseed unrelated data.
- Product terminology: `目标台账`, not `全员目标台账`; all-person filtering requires appropriate data scope.
- Keep goals, goal changes, improvement plans and confirmation in their own existing lists. No universal super-ledger or microservice.
- Logical deletion removes from normal listings, not historical/audit evidence. No implicit rollback of active goal versions, confirmation employment or published results.
- Termination is not approval, exemption, a zero score, resignation or a change to prior payroll/performance facts.
- New management capabilities are explicit/configurable; do not grant them to actual accounts. Historical detail remains constrained by original viewing rights.

## Review Focus

- A stale browser or concurrent reviewer must not write after termination/deletion; test actual transactional guards.
- Offboarding acts only on unfinished records for the departing employment; reentry and other employees' tasks are preserved. Historical backfill requires a separate approved checklist.
- An employee leaving as a reviewer causes a handover issue, not termination of other people's plans or silent frozen-role changes.
- Unknown counts remain unknown and retryable; collapsed sections must not hide failures as zero.
- Recruitment handoff must not disclose resumes or grant personnel/recruitment mutation rights; payroll summaries remain subject- and current-step-specific.

## Task 1: Repair Confirmed Todo Gaps

**Files:** `api/src/talent-pool/talent-workbench*`, recruitment-demand readers; `web/src/views/dashboard/DashboardTaskEntries.vue`, `web/src/views/task/TaskListView.vue`, `web/src/views/talent/TalentInterviewView.vue`, focused specs.

- [x] Reproduce owner-only accepted-candidate handoff, missing recruitment-demand review entries, processing links without pending filters, incomplete count-error feedback and desktop/mobile interview status divergence.
- [x] Implement narrow handoff/review projections and exact source links without broadening candidate/resume permissions or independent approval rules.
- [x] Implement pending navigation and explicit unknown/error/retry states, preserving existing visible refresh and dirty-input protections.
- [x] Sort follow-up samples by overdue/today/future before taking the sample; keep authoritative totals and list scope.
- [x] Run focused API and component/navigation regressions.

## Task 2: Add Lifecycle Management To Existing Domains

**Files:** Prisma schema and one additive migration; scoped lifecycle service/controller; goal-plan/change, task/period, improvement and confirmation services; permission registries and original Vue list/detail views.

**Interface contract:** A shared typed mutation endpoint identifies `task`, `goal_change`, `improvement_plan` or `confirmation`, requires an expected version and nonempty reason, and independently authorizes termination/logical removal. Existing detail/list projections expose lifecycle state, operation eligibility and read-only history without bypassing original data scope. Exact contract is recorded with implementation before frontend wiring.

- [x] Write failing authorization, completed/effective protection, version/race, history and pending-removal tests.
- [x] Add lifecycle metadata and audit while preserving original business states and effective snapshots. Only ended records may be logically removed; already-effective records may move to history but cannot be undone.
- [x] Protect all affected mutation entry points, pending queries, period operations, notifications and exports from stale actionable state.
- [x] Connect actual resignation effectiveness to unfinished matching employment records; do not batch-clean historical production data. Show handover issues for unavailable reviewers rather than silently replacing them.
- [x] Add original-list filters/actions and mandatory-reason confirmations. Preserve current draft/unsaved protection and mobile detail behavior.
- [x] Verify repeat actions, concurrency, permission revocation, reentry isolation and no rollback of business results using isolated PostgreSQL/HTTP.

## Task 3: Consistent Dashboard Sections

**Files:** dashboard components, small shared collapse primitive, scoped personnel/payroll summaries and focused specs.

- [x] Project existing personnel pending/attention and payroll current-handler tasks with accurate subject/month/request/batch deep links; do not use unrestricted approval totals.
- [x] Group into performance, recruitment, personnel and payroll sections with consistent header/count/refresh/collapse/error/row styles.
- [x] Default nonempty sections open and empty sections collapsed; remember expansion per user only. New work updates count without forcing expansion. Never store sensitive record payloads in collapse preferences.
- [x] Keep actionable work distinct from attention/cleanup; no mixed global total. Surface failed sections even when collapsed.
- [x] Verify 1440x900, 1024x768 and 390x844, including exact navigation, zero/error, fold persistence/account switch and terminated work removal.

## Task 4: Integration, Evidence And Preview

- [x] Review combined changes and run strict full API suite/build once after contracts stabilize, plus directly affected database integration tests.
- [x] Run Web type-check/build and real-backend PC/mobile Playwright; do not claim mocks as full workflow acceptance.
- [x] Update only the existing isolated preview as safely possible, retaining existing fictional examples and disabling external effects.
- [x] Prepare fictional examples for termination/history and different-role handoff/review; leave useful unconsumed records for the user.
- [x] Deliver issue-to-fix table, commands/results, limitations, fixed preview links and short steps. Distinguish implementation, commit, deployment and business acceptance.
- [x] Keep production unchanged. Record any external resource/preview limitation honestly instead of silently testing or deploying against production.

## Execution Notes

- 2026-11-26: User approved implementation in the order above and requires preview before any evening release. No code changes or tests are yet claimed by this initial plan.
- Task 1 backend: five focused suites / 140 tests passed after observing failing reproductions. Added `onboarding_handoff`, `demand_review`, `demand_returned` and a paginated handoff reader. Demand list supports `workQueue=review|returned`. Frontend exact-link/tab integration is still in progress.
- Parent focused red-green: pending team navigation and shared overdue interview label; eight existing refresh protections plus new navigation test remain green (nine total including interview helper). Collapse primitive has three behavioral tests covering defaults, account-local choices and collapsed errors. These are component/unit evidence, not real-backend page acceptance.
- New operations projection backend: 27 pure focused tests passed. Approval/calibration task-specific drawer links are being completed; no HTTP/browser claim yet.
- Preview inspection: current API still binds an obsolete worktree path; Web is an immutable local Vite image without a dependency volume. Current workspace has no preview secret file. Added an explicit `--reuse-verified-preview` recovery path that requires the running isolated environment, `hrm_preview` ownership and fictional marker, retains keys/data, and does not infer production ownership. Ten launcher guard tests passed; recovery has NOT been executed yet.
- Four implementation workers use disjoint source ownership in this shared checkout. Parent owns dashboard, TaskList count feedback, interview label, capability UI, preview tooling, integration tests and final verification. No commits, production changes or real data/permission writes.
- Integration: Web typecheck/build passed before the final audit-display addition; final component suite 27/27 and real-backend desktop/mobile 4/4 passed. The initially failing strict locator and loading-state timing were corrected without dropping business assertions.
- Real PostgreSQL contracts 6/6 passed, including normal root/child creation, post-termination fences, fresh ongoing uniqueness with duplicate refusal, exact-employment offboarding/reentry/reviewer isolation, repeat audit safety, queued writes and queued capability revocation.
- Independent review found ongoing partial indexes and confirmation draft employment binding/history exclusions. Indexes were corrected and verified in PostgreSQL; confirmation service/spec corrections are being finalized. A trigger's polymorphic record field access was found by actual inserts and corrected before delivery. No production migration has run.
- The unreleased migration was refreshed only in the guarded fictional preview and dedicated test database, including its development checksum. Their other data was retained; there is no production migration-history rewrite. Both databases are development resources.
- Final consolidation: 299 API suites / 5999 distinct tests passed after scoped fixture rechecks; full API TypeScript (including tests), final Linux API build and Web production type/build passed. 57 Web focused tests, 27 component tests, six real lifecycle PC/mobile tests and four real recruitment handoff/queue tests passed. A final employee-view recheck also verifies waiting work says View Progress rather than a misleading confirmation command; results are not double counted.
- Late integration fixes: retained terminated personal tasks/own confirmation waiting items are excluded before deletion; completed logical removal preserves official reporting and existing payroll result references. Confirmed by direct red-green regressions and real role HTTP/UI. Historical role compatibility is documented rather than silently withdrawn.
- Final preview and evidence handoff: `docs/acceptance/2026-11-26-ledgers-workbench-preview.md`. Product/business signoff remains pending, all source remains uncommitted in this branch, production remains 4bb2a4cf. No publish or Docker migration was attempted.
