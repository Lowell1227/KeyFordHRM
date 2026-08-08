# Task 8 Report: Compact Goal Review and Visibility Workspace

## Status

Implemented and verified on `main`.

## Scope Delivered

- Added a shared compact indicator disclosure list. Rows are collapsed by default, expand independently, support icon-only expand/collapse-all commands, keep stable grid tracks, and show a persistent weight total.
- Invalid and rejected indicators automatically expand, receive focus, and scroll into view. Non-100% weight blocks approval and opens the first invalid row.
- Added all seven visibility scopes. Custom visibility supports simultaneous department and employee multi-selects, normalized unique IDs, and explicit selected counts.
- Added a scoped reference panel with aligned objectives from `TaskDetail`, task flow history, and an employee-target picker backed only by `tasksApi.findReferenceIndicators` with cycle and employee scope.
- Added the single-employee goal review workspace with editable indicator details, versioned save/approve/reject events, required rejection reason, loading/error states, and stale-save response protection.
- Reused Task 7's complete outcome path for single approve/reject: success, partial/total failure, HTTP error messaging, refresh, and failed-row retention remain one implementation.
- Adapted employee indicator drafting/reviewing to the same disclosure primitive. Task-level rejection records place the latest reason on and focus the first relevant indicator because the current flow record contract does not carry an indicator ID.
- Kept the operational layout quiet and responsive: no nested cards, no decorative gradients, radii remain at or below 8px, and the indicator breakpoint responds to its actual container width.
- Task 9 manager evaluation editing and route migration were not implemented.

## Changed Files

- `web/src/views/task/components/PerformanceIndicatorList.vue`
- `web/src/views/task/components/IndicatorVisibilityEditor.vue`
- `web/src/views/task/components/PerformanceReferencePanel.vue`
- `web/src/views/task/components/GoalReviewWorkspace.vue`
- `web/src/views/task/components/IndicatorSnapshot.vue`
- `web/src/views/task/components/TeamMemberRail.vue`
- `web/src/views/task/TaskListView.vue`
- `web/e2e/specs/10-team-performance-contract.spec.ts`

## TDD Evidence

- RED: the prescribed `--grep "goal review"` run failed 7 new cases because the compact workspace, disclosure rows, weight validation, responsive grids, and employee rejection position did not exist.
- GREEN: the focused run passed 8/8 after implementing the Task 8 workspace, including the pre-existing team-list goal-review match.
- RED/GREEN: an original-resolution desktop inspection exposed internal row clipping despite no document overflow. A new row-fit assertion failed, then passed after the list switched from a viewport breakpoint to a named container query.
- RED/GREEN: a delayed save for employee A overwrote employee B after selection changed. The deterministic regression failed first, then passed after the save response was guarded by the current workspace context and selected task.

## Verification

- `web`: `npm run test:contracts` passed 28/28, including contract type-checking and mocked browser coverage without API or login dependency.
- `web`: `npm run type-check` passed.
- `web`: `npm run build` passed with 2,573 modules transformed.
- Responsive contracts passed at 1440x900 and 390x844 with stable row columns, no internal row overflow, and document overflow at or below 8px.
- The build retains the repository's existing third-party pure-annotation notices and chunk-size warning; Task 8 adds no build error.

## Visual Acceptance

- Desktop 1440x900: `task-8-desktop.png`
- Mobile 390x844: `task-8-mobile.png`

Both captures were produced from deterministic mocked manager data and inspected at original resolution. The desktop image confirms the compact list and reference panel fit their actual columns without clipping. The mobile image confirms a single focused detail surface, readable visibility/status rows, stable icon commands, and no horizontal overlap.

## Self-Review

- Confirmed reference loading always supplies both `cycleId` and `ownerId` and does not call an objective-list endpoint.
- Confirmed save, approve, and reject carry the current task version; stale save responses cannot replace a newer selected member.
- Confirmed single review failures reuse Task 7 failed-selection retention and never produce a zero-success message.
- Confirmed no Task 9 evaluation form, manager-score editing, withdrawal, or route redirect was added.
