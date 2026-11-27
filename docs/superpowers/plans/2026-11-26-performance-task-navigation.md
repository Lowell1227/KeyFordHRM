# Performance Task Navigation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this small, approved Web-only change. Preserve the existing worktree and unrelated edits.

**Goal:** Make the five performance task entries predictable without changing the existing performance todo workspace.

**Architecture:** One presentation-only navigation component above the original task and goal-change pages. Keep the original routes, query parameters, authorization predicates, performance secondary menu, stage panels, and all write actions.

**Tech Stack:** Vue 3, Vue Router, Element Plus, existing preview NestJS backend.

**Spec:** User approved the lightweight navigation proposal in this chat on 2026-11-26: 我的计划→我的目标，待我审核→目标审核，目标台账/绩效待办/目标变更 unchanged; keep 绩效待办 exactly as the existing third-level menu and workflow. Preview now, release after the evening Docker migration.

## Constraints and Approaches

- Chosen: fixed view navigation with clear labels and existing role gates; no API, permission, data, workflow, or route redesign.
- Deferred: splitting the module into new menus/workflows; this would add learning and migration costs during business trial.
- The active goal-change page can identify itself; entry into it from other pages still uses the original eligibility check. No additional business API calls for navigation.
- Do not edit `PerformanceWorkspace.vue` or the personal/team stage panels. Remove duplicate goal shortcut rows, not the original third-level function menu.
- Mobile must expose all authorized entries without document overflow. Keep label text stable while review count updates.
- No staging, commits, pushes, Docker migration, or production deployment in this preview task.

## Review Focus

- Ordinary employees must not gain the ledger entry; direct legacy URLs retain the original denial handling.
- Goal-change eligibility remains the existing verified entry check, not a role-name guess.
- Unknown/failed goal-review counts must not look like zero or change menu labels.
- A direct URL, refresh, and browser back must identify the actual view.
- Original personal/team stage controls and protected secondary navigation remain unchanged.

## Task 1: Fixed Navigation and Naming

- [x] Add focused unit/real-preview tests and observe the expected failure before implementation.
- [x] Create `web/src/components/performance/PerformanceTaskNavigation.vue`, with pure props and existing link targets.
- [x] Integrate into `TaskListView.vue` and `GoalChangeListView.vue`; keep original workspace subtrees and route guards.
- [x] Rename the goal list titles and corresponding dashboard shortcuts consistently.
- [x] Pass focused Node tests and real preview PC/mobile navigation, back/refresh, role restrictions, and original todo structure checks.

## Task 2: Final Verification and Preview Handoff

- [x] Check 1440x900, 1024x768, and 390x844 screenshots and overflow.
- [x] Run Web type-check/build once for final source; preserve existing backend test evidence because no backend changes.
- [x] Confirm protected component hash unchanged; review only this increment and record limitations.
- [x] Update project acceptance/memory, give fixed preview, and retain the evening-release boundary.

## Execution Notes

- Presentation tests first reproduced the missing fixed entry row. Rapid real navigation then exposed an existing late initialization race: `GoalPlanList` always replaced the current URL, cancelling pending navigation to the next module. A focused unit test reproduced the redundant replacement; skip it only when the normalized query is unchanged. Explicit changed-filter URL synchronization remains covered.
- Real PC/mobile navigation: 8 cases passed; a further 2 targeted slow-module/late-options checks confirmed both delays were actually applied. Node navigation, original protected menu, filtering, recovery, and lifecycle tests: 56/56 passed.
- The protected `PerformanceWorkspace.vue` SHA-256 remains `DB621A124C4EF4B60CB935ADB5757B65129DD701A1BB4BC65436C1436F4D0D04` before and after. No backend, route registration, stage handler, permission, or business data changes in this increment.
- One cleanup test initially lacked the newly imported `canMonitorGoals` dependency seam and tried to load browser HTTP code under CommonJS. Added that single seam; all original cleanup assertions remain intact.
- Final `npm run build` (vue-tsc + Vite, Node heap 1280MB) passed; existing VueUse annotation and large-chunk warnings remain. Retained the generated declaration for the new navigation component and removed only the unrelated generated `ElStatistic` line. No production change or commit.
