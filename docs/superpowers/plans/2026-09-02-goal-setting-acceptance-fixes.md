# Goal-Setting Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task by task.

**Goal:** Complete ACC-004 through ACC-013 for the goal-setting workflow, remove ambiguous/redundant UI, restore the returned-goal edit loop, and release the verified result from `main`.

**Architecture:** Keep task lifecycle authority in the API, derive display state from the current task plus the latest effective workflow event, and keep visibility/alignment permission checks server-side. Reuse the existing Vue task components and add focused helpers/tests instead of introducing a second status model.

**Tech Stack:** NestJS, Prisma, Vue 3, TypeScript, Element Plus, Vitest/Jest, Playwright.

**Spec:** `docs/acceptance/2026-08-29-production-acceptance-issues.md` ACC-004 through ACC-013.

## Constraints

- Work directly on `main`; preserve the existing acceptance-record edit.
- Do not change ACC-001 through ACC-003 or broaden data permissions.
- Draft goal weights may be blank/incomplete; submission requires exactly 100%.
- Returned goals are editable; resubmitted goals are read-only while awaiting manager review.
- Employee withdrawal is allowed only before the manager saves any review change.
- Whole-task return reasons appear once above the indicator table.
- Validate desktop and mobile layouts before release.

### Task 1: Lock the lifecycle rules with failing tests

**Files:**
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

1. Add API tests for employee withdrawal before/after manager review-save.
2. Add UI assertions for returned, resubmitted, and workbench period labels.
3. Run the focused tests and confirm they fail for the missing behavior.

### Task 2: Implement the employee return/resubmit/withdraw lifecycle

**Files:**
- Create: `api/src/tasks/dto/withdraw-indicators.dto.ts`
- Modify: `api/src/tasks/tasks.controller.ts`
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `web/src/api/tasks.api.ts`
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Create: `web/src/views/task/indicator-workflow-state.ts`

1. Add the optimistic-lock withdrawal endpoint.
2. Deny withdrawal after the manager has saved a review change.
3. Derive active return state from current task status and the latest effective event.
4. Render the return reason once and expose the correct employee/manager actions.
5. Run focused API and UI tests.

### Task 3: Simplify the goal editor and alignment selector

**Files:**
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Modify: `web/src/views/task/components/PerformanceIndicatorList.vue`
- Modify: `web/e2e/specs/29-goal-setting-responsive.spec.ts`
- Modify: `web/e2e/specs/31-indicator-visibility-and-map.spec.ts`

1. Return alignment candidates grouped by person, always including the performance manager.
2. Merge the two alignment entry points into one “添加对齐” action.
3. Show person avatar/name even when no visible goals exist.
4. Default new indicator weight to blank and retain only the footer total.
5. Remove the redundant indicator count and duplicate primary actions.

### Task 4: Compact visibility and page-level controls

**Files:**
- Modify: `web/src/views/task/components/IndicatorVisibilityEditor.vue`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/e2e/specs/29-goal-setting-responsive.spec.ts`

1. Replace tag stacking with a one-line selected-count trigger and grouped popup.
2. Move the compact/full mode switch beside “参考信息”.
3. Move the task status tag beside the employee name.
4. Verify desktop and mobile overflow and operations.

### Task 5: Unify workbench wording and actions

**Files:**
- Modify: relevant goal-tracking/workbench Vue components found by label search
- Modify: focused Playwright specs

1. Map missing goals to “待目标制定” or “待目标确认”.
2. Reserve “未开放” for goals ready but the follow-up period not open.
3. Use “待填写” after opening and before submission.
4. Keep one top-right “开始制定” action and make the body a status-only empty state.

### Task 6: Verify, commit, push, and deploy

1. Run focused API tests, focused Playwright desktop/mobile tests, type/build checks, and review the diff.
2. Commit only the accepted changes and the existing acceptance record on `main`.
3. Fetch/reconcile `origin/main`, push without force, and deploy with the repository’s production procedure.
4. Verify the production health route and the real online goal-setting behavior.
