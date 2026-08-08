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

## Review Remediation (2026-08-09)

### Fixed Review Findings

- `GoalReviewWorkspace` is now a named inline-size container. At effective widths of 1024px and below, the reference panel moves above the indicator workspace before the indicator grid can collapse or overlap.
- Weight totals are rounded to the same displayed hundredths used by the UI and approval requires exactly `100.00%`. Both `99.99%` and `100.01%` are invalid, expand the first indicator, and focus its row.
- Save events now carry an operation token and draft revision. The component accepts a response only for its current task session, latest operation, and unchanged draft revision; the parent separately checks request identity, selected task, workspace context, and operation token before applying the returned version or success state.
- Single approve and reject use request identities scoped to the selected task. Moving from Ada to Grace invalidates the pending single action, while Task 7 batch execution and failed-row retention remain unchanged.
- Indicator disclosure triggers now expose explicit `aria-expanded`, matching `aria-controls`, stable region IDs, and labelled `role="region"` content. The shared employee `IndicatorSnapshot` receives the same semantics through `PerformanceIndicatorList`.
- Reference tabs now implement `tablist`, `tab`, and persistent `tabpanel` relationships with `aria-selected`, `aria-controls`, `aria-labelledby`, roving `tabindex`, and Left/Right/Home/End keyboard navigation.

### Regression Evidence

- RED: 7 of the initial 8 focused review tests failed: `90.00%` was not formatted to hundredths, `99.99%` opened approval, delayed single approve/reject updated Grace with Ada's outcome, A-to-B-to-A replaced newer A edits, and 970px/1024px retained the side-by-side layout. The existing floating-point path happened to reject `100.01%`, and the new exact-hundredths contract keeps that boundary deterministic.
- RED: the accessibility regression confirmed the tooltip trigger removed the collapsed `aria-expanded` state from the rendered button.
- GREEN: 10 focused responsive, weight, race, and accessibility tests passed, including a same-task delayed save that reaches the component draft-revision guard.
- GREEN: `npm run test:contracts` passed 36/36. The pre-existing partial, total, and HTTP batch-failure tests still retain failed selections and never report zero success.
- GREEN: `npm run type-check` passed.
- GREEN: `npm run build` passed with 2,574 modules transformed. Existing third-party pure-annotation and chunk-size warnings remain unchanged.

### Updated Visual Evidence

- Desktop viewport 1440x900: `task-8-desktop.png`
- Mobile viewport 390x844: `task-8-mobile.png`
- Effective workspace width 970px at a 1800x1100 viewport: `task-8-container-970.png`
- Effective workspace width 1024px at a 1800x1100 viewport: `task-8-container-1024.png`

All four images were captured at original resolution from deterministic mocked data and inspected without scaling. The 970px and 1024px tests also use center-point `elementFromPoint` hit testing, open the visibility selector, execute expand-all, and toggle an individual disclosure.

### Task 10 Local Database Blocker

- The Compose services are running and PostgreSQL reports healthy, but `docker compose exec -T api npx prisma migrate status` reports three unapplied migrations: `20260628000001_add_target_value_text`, `20260808000001_add_indicator_visibility_alignment`, and `20260808000002_make_task_version_round_trippable`.
- Host-side Prisma does not automatically load the repository-root `.env`; after loading its existing `DATABASE_URL` into the process without printing it, the host still cannot reach the Compose-only `postgres:5432` service address.
- Task 10's real API workflow is therefore blocked until an authorized backend/database owner applies the pending migrations through the supported environment. This remediation did not run `migrate deploy`, change database roles, publish the database port, or bypass backend permissions.

### Remediation Self-Review

- Confirmed all changes stay within Task 8 goal review, shared disclosure, reference panel, parent request handling, deterministic contracts, and this report.
- Confirmed parent list versions and success/error UI update only for the matching save identity.
- Confirmed single-action invalidation is separate from batch busy state, preserving Task 7 batch behavior.
- Confirmed no Task 9 manager evaluation form or route behavior was implemented.

## Second Review Remediation (2026-08-09)

### Fixed Review Findings

- Delayed save handling now separates server-version acknowledgement from draft replacement. The latest response for a task always advances the workspace and parent optimistic-lock baseline, while a replacement of indicator fields still requires the original task session and unchanged draft revision.
- Save ordering is scoped per task in both the workspace and parent view. A response from an older operation cannot regress a newer acknowledged timestamp, including A-to-B-to-A navigation and same-task edits made while a request is pending.
- Employee indicator submission now uses the shared `normalizeDisplayedWeightTotal` contract. Displayed totals of `99.99%` and `100.01%` both block submission, expand the first indicator, and focus its disclosure row.
- Goal review editing is now limited to non-exempt tasks whose actual detail status is `indicator_reviewing`. Completed, exempted, not-started, and other task statuses render the same indicator disclosure as read-only detail without save, approve, reject, or visibility-editing controls.

### Regression Evidence

- RED: delayed A-to-B-to-A and same-task save tests showed the next save still sent the pre-save `updatedAt`; the newer local fields were already protected but the committed server version was discarded.
- RED: an employee `99.99%` floating composition submitted successfully under the prior raw tolerance check.
- RED: completed, exempted, pending, and manager-scoring detail fixtures still exposed review actions and editable fields.
- GREEN: 10 focused race, parent-baseline, status, and floating-weight browser regressions passed.
- GREEN: `npm run test:contracts` passed 44/44, including the existing Task 7 partial/total/HTTP batch retention cases and the prior responsive/accessibility contracts.
- GREEN: `npm run type-check` passed.
- GREEN: `npm run build` passed with 2,574 modules transformed. The existing third-party pure-annotation and chunk-size warnings remain unchanged.

### Visual And Scope Review

- No layout CSS or geometry changed in this remediation, so the four original-resolution Task 8 captures remain current. The 970px/1024px hit-testing and desktop/mobile geometry regressions pass in the full contract suite.
- Self-review confirmed the parent list timestamp can advance without replacing newer workspace fields, the next editor save and parent batch action both use the acknowledged version, and only the latest operation for that task may apply it.
- The Task 10 local database blocker documented above remains unchanged. No migration command, permission bypass, schema change, Task 9 form, or manager-evaluation route work was performed.
