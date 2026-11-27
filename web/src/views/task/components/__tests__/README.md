# Lifecycle Frontend Handoff

Scope: frontend only, shared `codex/performance-response-fix-20261126` worktree, 2026-11-26. No API/schema edits, commits, deployment, Docker operations, production grants or real data changes by this worker.

## Changed Paths

- `web/src/api/performance-lifecycle.api.ts` (new typed endpoint/policy helpers)
- `web/src/api/goal-plans.api.ts`
- `web/src/api/goal-changes.api.ts`
- `web/src/types/api.types.ts` (three HrCapability members; additive optional lifecycle metadata/query fields)
- `web/src/views/task/components/PerformanceLifecycleActions.vue` (new shared secondary confirmation)
- `web/src/views/task/components/GoalPlanList.vue`
- `web/src/views/task/components/GoalMonitorDetail.vue`
- `web/src/views/task/TaskDetailView.vue` (additional ownership explicitly granted)
- `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue` (optional readOnly prop)
- `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue` (optional readOnly prop)
- `web/src/views/goal-changes/GoalChangeListView.vue`
- `web/src/views/goal-changes/GoalChangeDetailView.vue`
- `web/src/views/improvement-plans/ImprovementPlanListView.vue`
- `web/src/views/improvement-plans/ImprovementPlanDetailView.vue`
- `web/src/views/confirmation/ConfirmationManageView.vue`
- `web/src/views/confirmation/ConfirmationDetailView.vue`
- `web/src/views/confirmation/ConfirmationMineView.vue`
- `web/e2e/specs/67-goal-five-step.spec.ts` (two renamed-label assertions only)
- `web/src/views/task/components/__tests__/performance-lifecycle.harness.html`
- `web/src/views/task/components/__tests__/performance-lifecycle.harness.ts`
- `web/src/views/task/components/__tests__/performance-lifecycle.ui.spec.ts`
- `web/src/views/task/components/__tests__/playwright.lifecycle.config.ts`
- `web/src/views/task/components/__tests__/playwright.lifecycle-regression.config.ts`
- `web/src/views/task/components/__tests__/lifecycle-policy.test.cjs`
- This README.

Dashboard, TaskList, routes/navigation and global capability UI remain parent-owned. Their concurrent edits are not included in this worker's scope.

## Behavior And Contract

- Uses actual backend kinds `task`, `goal_change`, `improvement_plan`, `confirmation`.
- GET `/performance-lifecycle/:kind/:id` refreshes authorization/evidence; POST `terminate`/`delete` sends only `expectedUpdatedAt`, `expectedLifecycleVersion`, trimmed nonempty `reason` (max 1000).
- Buttons trust API `allowedActions`; no business-status guess decides termination/deletion eligibility. Completed/effective snapshots remain unchanged.
- Lifecycle metadata remains separate from original business status and actions. Original participant history uses the original APIs/scopes, without requiring a global history capability. All-person metadata read requires the explicit lifecycle-view policy.
- `canMonitorGoals` recognizes non-assessor HR_user + `performance_lifecycle_view`, known HR without systemPermission, and the original combined performance authority.
- Confirmation management chooses `findAll` for original managers or lifecycle metadata readers, `findAssigned` for related approvers. Warnings remain original confirmation management only. Internal meeting/salary/approval remain original-role/API-controlled.
- Lists retain their original scopes, status filters, pagination and detail routes. Terminated/deleted details are read-only; actual task period editors receive readOnly without hiding their existing content.
- Lifecycle confirmations require a reason, refresh evidence before mutation, retain reasons on conflict/denial, block uncertain retries until recheck, and protect unsaved goal-change/improvement edits.

## Verification Actually Executed

Commands below run from `web`.

1. Initial focused Playwright RED: missing lifecycle filter and task termination action (2 failing tests, expected missing UI).
2. First focused GREEN: 15/15, then 20/20 after required-reason, 403 revocation, dirty-input, snapshot and 1440/1024/390 coverage. These preceded the final TaskDetail/history-policy additions.
3. Additional RED: ended confirmation still exposed meeting-date backfill; fixed and included in the 20/20 GREEN.
4. Additional RED: original participant history hidden; terminated TaskDetail still exposed goal submit; fixed. Subsequent focused run 23/24 passed. The remaining assertion incorrectly counted a read-only reference-search input as a business editor; narrowed to `.performance-detail__main`, not yet rerun.
5. Additional RED: ended employee-owned confirmation draft still offered Continue Filling; fixed alongside Mine history filter, not yet rerun.
6. Original domain Playwright regression: **86/87 passed** (28 confirmation 11/11, 67 goals 23/23, 68 changes 41/41, 52 improvement 11/12). Sole failure: `52-improvement-plan-workflow.spec.ts:98`, Dashboard improvement workbench link absent; new Dashboard summary encountered old `{}` mock and showed NaN. Parent notified; no Dashboard assertion weakened or files edited here. Earlier aborted regression used a mismatched hardcoded baseURL in spec 68; final regression config aligns PLAYWRIGHT_BASE_URL and port 4196.
7. Lightweight policy RED: global lifecycle-ledger policy absent. Implemented, then **3/3 GREEN** with `node --test src/views/task/components/__tests__/lifecycle-policy.test.cjs`, exit 0. Tests cover participant/global separation, goal monitor capabilities, and business-action preservation only while active.
8. Initial Web type-check reported parallel `TalentInterviewView.vue` DefaultRow error and this test's unsupported `.at` call. The `.at` call was fixed. Parent owns the interview issue and final serialized type-check. No final type-check/build success is claimed.
9. Scoped `git diff --check` passed. All self-started Playwright/Vite processes exited. No new browser/build run after parent's low-RAM serialization instruction.

## Parent's Serialized Final Checks

```powershell
node --test src/views/task/components/__tests__/lifecycle-policy.test.cjs
npx playwright test --config src/views/task/components/__tests__/playwright.lifecycle.config.ts --timeout 25000
npx playwright test --config playwright.lifecycle-regression.config.ts --timeout 20000
```

Current focused component suite contains **26 cases**, including latest Mine history and lifecycle-only confirmation metadata masking cases. Its final 26-case run is pending the parent's serialized browser slot; do not quote prior 20/20 as final-source verification.

Harness uses only fictional data with intercepted HTTP on an owned loopback Vite port (4196), not the shared 5173 product preview. These are component/contract checks, not real backend, database authorization, production or business acceptance. Parent owns final real-backend role flows, full API/build and preview integration.

## Parent Integration Update

The worker chronology above is retained as historical evidence, not the current result. Parent fixed invalid-count handling without weakening the original workbench assertion; its single failed regression now passes. The latest component suite is **27/27**, adding original authorized audit timeline display. Real isolated backend desktop/mobile lifecycle/fold/navigation tests are **4/4** (`e2e/preview/ledgers-workbench.spec.ts`). Final consolidated API/build and recruitment handoff evidence are recorded in `docs/acceptance/2026-11-26-ledgers-workbench-preview.md`, not inferred from this mocked harness.
