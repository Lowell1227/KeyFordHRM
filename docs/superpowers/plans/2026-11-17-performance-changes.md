# Performance Changes Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Do not commit or publish without controller authorization.

**Goal:** Deliver approved goal-change grants and the nine-stage improvement workflow in isolated preview.

**Architecture:** Extend the existing NestJS modules, transactional audit logs, frozen task actors and indicator versions. Preserve V2 plans and existing submitted period results.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue3, Element Plus, Playwright.

**Spec:** docs/superpowers/specs/2026-11-17-performance-changes-design.md

## Global Constraints

- No production writes or release. No real employee fixtures, external notifications or calendar invitations.
- Preserve concurrent changes. Only task files; no unrelated refactor or version bump.
- HR shared approval excludes system_admin/canViewAll without explicit HR capability.

## Review Focus

- A stale page must not overwrite a later draft or submit another record.
- Two HR reviewers cannot advance a shared node twice.
- Existing V2 plans must retain their original flow.
- Unauthorized and missing/inactive actors must not receive new write access.
- A month submitted during amendment review must not be overwritten at activation.

## Tasks

- [x] 1. Improvement backend: add failing tests for V3 stage order, HR pool, stale revision, legacy compatibility and exact-manager initiation; implement minimal DTO/service/schema changes; run module tests.
- [x] 2. Improvement frontend: regress route/write races; add revision payloads and V3 labels/actions, explicit query failures; type-check and targeted UI tests.
- [x] 3. Goal changes: add grant/request models, unique ongoing process and transaction claims; use frozen original review chain and new indicator versions; test authorization, return/resubmit/revoke and protected months.
- [x] 4. Goal-change page: HR grant management, my/team requests, original/new comparison and routed detail, using shared business page components; PC/mobile tests.
- [x] 5. Final verification: one full API suite, API/Web build/type checks, real isolated migration and role workflows, targeted PC/mobile; independent review; record remaining risk and deliver preview, no production release.

## Execution Ledger

- 2026-11-17: User approved HR shared queue. Active main clean at start (d379af1b); protected original checkout left untouched. Implement in existing active checkout following established main preference. No business data migration for V2.
- User additionally approved adding/removing entire targets. Removed indicator instances now retire instead of deleting; existing current-goal readers/writers exclude retired goals, historical period snapshots remain linked.
- Improvement backend worker finished: 4 suites / 87 tests and no-emit check passed. Goal-change initial rules/access tests: 2 suites / 11 passed. Current-goal retirement worker: 33 suites / 550 plus scheduler/final-grade/history 7 suites / 136 passed; final result evidence filter under review. These are targeted technical checks, not real role/page acceptance.
- Current production observed API/Web da619e69, local main/origin/main d379af1b. No production change by this task. Migration and preview pending; no commit or publication performed.
- Strict baseline API run completed once: 186 suites / 3183 tests passed. Independent review found two submit/activation race paths; added month claims bound to loaded revision and indicator version (2 suites / 75 pass), and legacy self-evaluation plus actual-value version claims/completeness checks (5 suites / 131 pass). These focused post-review changes are not covered by the preceding baseline full-run claim.
- Preview refreshed after review fixes, API npm build and migration included; launcher confirmed production container IDs unchanged. Web production build/type-check passed (existing chunk-size/PURE annotation warnings only). Real HTTP/DB and PC/mobile page acceptance delegated to Planck, still running/pending; do not report complete until actual output.
- Permanent fictional sample prepared idempotently by scripts/prepare-performance-changes-preview.cjs using existing eight preview identities; cycle “目标变更验收（虚构数据）”, employee “测试·张辰”. No authorization grant pre-created: user can exercise HR opening step. Completed-month snapshots retained for comparison.
- Real DB run caught the legacy final-score CHECK only accepting workflow_version=2. Added separate 20261117183000 migration (old applied SQL left unchanged) permitting V3 0..100 while retaining V1 1..10. Preview now has 70 applied migrations; production unchanged.
- Final independent review found unknown-network-result recovery incorrectly treating another tab's higher revision as our success. Removed blind synchronization, retained inputs and required explicit reconciliation; 3 regressions red before fix, PIP batch 47/47 green. Mobile overview single-column fix: 390px targeted layout 1/1 green. Technical revision count removed from goal header, dedicated Playwright red then green.
- Real isolated acceptance completed in groups: HTTP/DB 4 scenarios passed; actual UI 4 scenarios passed (goal changes and PIP, each desktop/mobile), all workflow transitions through page controls. No claim of one single all-green run: failed script timestamp assertions and Element Plus selector targeting were corrected; unchanged passed groups reused. Owned temporary actors verified 0; permanent demonstration preserved.
- Team-only layout entry has focused mocked coverage; actual manager entry exercised the normal workbench navigation. External DingTalk delivery and high-volume performance untested. All code remains uncommitted and undeployed; human business acceptance pending.
