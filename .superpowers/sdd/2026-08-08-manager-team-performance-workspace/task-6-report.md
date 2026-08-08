# Task 6 Report: Web Contracts and Workspace URL State

## Status

Implemented on `main`.

## Scope Delivered

- Added team-workspace TypeScript contracts, including team task pages and queries, batch review results, visible reference indicators, and indicator visibility fields on task indicators.
- Added the six requested `tasksApi` methods with the server's established paths for team tasks, reference indicators, batch approval/rejection, manager draft saving, and score withdrawal.
- Added the single workspace URL-state module. It validates enum fields, supplies `mine` and `goal-review` defaults, removes empty values, serializes recognized keys in stable order, uses `router.replace`, and avoids no-op route updates.
- Added `expectedUpdatedAt` to final manager-score writes and existing indicator writes. The manager scoring page and the task indicator editor now supply the current task version; existing HTTP lifecycle/scoring callers now read the post-transition version before final submission.
- Kept the existing indicator editor behavior compatible by sending the backend-required default visibility selection (`supervisors` with empty explicit selections). No Task 7 team UI was added.

## Changed Files

- `web/src/types/enums.ts`
- `web/src/types/api.types.ts`
- `web/src/api/tasks.api.ts`
- `web/src/views/task/use-task-workspace-query.ts`
- `web/src/views/manager/ManagerScoringView.vue`
- `web/src/views/task/TaskDetailView.vue`
- `web/src/views/task/components/IndicatorSnapshot.vue`
- `web/e2e/specs/10-team-performance-contract.spec.ts`
- `api/test/suites/03-cycle-lifecycle.e2e-spec.ts`
- `api/test/suites/04-scoring-algorithm.e2e-spec.ts`
- `api/test/suites/08-negative-boundary.e2e-spec.ts`
- `api/test/suites/09-scale-128.e2e-spec.ts`

## TDD Evidence

- Red: the isolated Playwright contract spec failed because `use-task-workspace-query` did not exist.
- Green: the same spec passed all three cases after the module and serializer were implemented.

## Verification

- `web`: `npm run type-check` passed.
- `web`: `npm run build` passed.
- `web`: isolated `npx playwright test e2e/specs/10-team-performance-contract.spec.ts --config playwright.contract.config.ts` passed 3/3. The temporary config was removed after use.
- `api`: `npm run build` passed.
- `api`: `08-negative-boundary.e2e-spec.ts` passed 10/10, including the updated final-score callers.
- `git diff --check` passed.

## Known Test Blockers

- The prescribed web Playwright command runs existing global login setup first and cannot reach the local API at `localhost:3000`; it times out waiting for `/dashboard` before this pure contract spec loads.
- The targeted lifecycle/scoring E2E suites (`03-cycle-lifecycle` and `04-scoring-algorithm`) currently fail before manager scoring. Their role factory leaves HR, manager, department head, and approver without direct managers, which the current launch validation rejects. This is unrelated to Task 6's request bodies; the negative boundary suite passed after the updated token was supplied.
