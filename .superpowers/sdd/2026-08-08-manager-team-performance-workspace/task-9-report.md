# Task 9 Report: Manager Evaluation Workspace and Compatibility Redirect

## Status

Implemented and verified on `main`.

## Scope Delivered

- Added a selected-member manager evaluation workspace under `/tasks?scope=team&stage=manager-eval`.
- Reused the Task 8 compact indicator disclosure. Collapsed rows show indicator name, weight, employee self-evaluation summary, and manager evaluation status.
- Expanded rows show target and actual evidence, employee score/comment, editable manager score/comment, and add/remove extra-score rows.
- Extra-score reasons are required. Validation expands the affected indicator and focuses the exact invalid field.
- Added the unframed employee summary and manager summary comparison with strengths, improvements, development plan, existing attachment upload, and backend total/grade display.
- Draft save carries `expectedUpdatedAt`, keeps `manager_scoring`, reloads the authoritative task version, and preserves newer local edits while acknowledging the returned version.
- Final submit requires every manager score, confirms once, locks editing while pending, submits the current acknowledged version, and reloads read-only detail.
- Withdrawal appears only for the assigned manager on submitted `dept_review` or `hr_calibration` tasks with `managerScoredAt`. The server remains authoritative; success restores editable saved values and blocked withdrawal displays the server reason.
- Added loading, retry, inline operation feedback, success/warning/error messages, stale load/mutation protection, and an unsaved-change guard for selected-member and route query changes.
- Replaced `/manager/scoring` with a compatibility redirect that preserves query deep links while forcing `scope=team&stage=manager-eval`.
- Moved the sidebar team entry to the canonical query and made personal/team `/tasks` active states query-aware.
- Removed `ManagerScoringView.vue` after source references were eliminated.
- No Task 10 migration or broad business acceptance work was started.

## Changed Files

- `web/src/views/task/components/ManagerEvaluationWorkspace.vue`
- `web/src/views/task/components/PerformanceIndicatorList.vue`
- `web/src/views/task/TaskListView.vue`
- `web/src/components/layout/AppSidebar.vue`
- `web/src/router/index.ts`
- `web/src/views/manager/ManagerScoringView.vue` (deleted)
- `web/e2e/specs/10-team-performance-contract.spec.ts`
- `.superpowers/sdd/2026-08-08-manager-team-performance-workspace/task-9-report.md`

## TDD Evidence

- RED: the first focused manager-evaluation run timed out waiting for `indicator-toggle-ind-1` because no manager evaluation workspace existed.
- GREEN: 12 focused manager evaluation and redirect cases passed after implementation.
- RED/GREEN: an empty extra-score reason initially lost field focus to the shared disclosure row; the regression passed after validation waited for disclosure focus before focusing the exact field.
- RED/GREEN: the canonical sidebar redirect test showed the team menu was not active because active state compared raw paths; query-aware task menu matching fixed it.
- RED/GREEN: a delayed final submit left score, comment, and summary controls editable; the form now locks during the final transition and the race regression passes.
- Draft race coverage proves a delayed save acknowledges the new server version without replacing a newer same-task local draft, and the next save sends the acknowledged timestamp.

## Verification

- `web`: `npm run test:contracts` passed contract type-checking and Playwright `56/56` without API or login servers.
- `web`: `npm run type-check` passed.
- `web`: `npm run build` passed with 2,574 modules transformed.
- Focused responsive contracts passed at `1440x900` and `390x844`, including stable comparison geometry, row-fit checks, and document overflow at or below 8px.
- `git diff --check` passed; the repository's existing line-ending notices remain informational.
- The production build retains the existing third-party pure-annotation notices and chunk-size warning; Task 9 adds no build error.

## Visual Acceptance

- Desktop evaluation: `task-9-desktop.png`
- Desktop summary: `task-9-desktop-summary.png`
- Mobile evaluation: `task-9-mobile.png`
- Mobile summary: `task-9-mobile-summary.png`

All captures use deterministic mocked manager data and were inspected at original resolution. Desktop keeps employee and manager evaluation columns aligned; mobile stacks them without horizontal overlap. The summary remains unframed, with employee content and manager inputs separated by rules instead of nested cards.

## Self-Review

- Confirmed draft, submit, and withdrawal requests all use the current task `updatedAt`.
- Confirmed only the assigned manager can edit or withdraw; other roles and statuses render read-only controls.
- Confirmed final submit disables mutable controls while pending, and stale responses cannot update another employee session.
- Confirmed blocked withdrawal keeps the current read-only detail and exposes the backend reason once globally and inline.
- Confirmed the redirect preserves `cycleId`, `taskId`, and other query keys, and source code no longer imports or links to the obsolete view.
- Confirmed no front-end total or grade recalculation was introduced; displayed results remain backend-owned.

## Fix Round 1

- Added a shared dirty-draft guard for same-route task changes and route exits, plus a `beforeunload` handler that only prevents refresh or close while unsaved changes exist.
- Draft requests now preserve explicit clear operations: `managerScore: null` clears a score, while empty comments and summary text clear their persisted values. Final submission validation is unchanged.
- Draft save and withdrawal now return the transaction-claimed `updatedAt`. If the follow-up detail refresh fails after a successful mutation, the workspace retains the acknowledged version and status, reports a warning, and allows the next write without a stale-version conflict.
- Verification: API focused tests `60/60`; web contracts `61/61`; API build, web type-check, web production build, and `git diff --check` passed.
