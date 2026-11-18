# Goal Change Entry and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate HR authorization from goal change applications, show the right workspace entries, and make one submission one business record.

**Architecture:** Keep the existing GoalChangesService task and actor checks. Add a small navigation entitlement query, make submit atomically accept edited content, and reuse the existing record-list shell for HR authorization.

**Tech Stack:** NestJS, Prisma, Vue 3, Element Plus, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-goal-change-entry-flow.md`

## Global Constraints

- No production data write or deployment without a separate release instruction.
- Keep frozen approval actors, prior month results, grant consumption and internal audit.
- Do not widen HR grant authority or goal-map data visibility.

## Review Focus

- A revoked grant with an old request retains a read-only menu entry.
- A user with no grant or related request sees no application menu.
- Concurrent submit with a stale revision does not save partial edits.
- HR grant page actions are checked per cycle, not only by role.
- A participant without goal-management rights can view their map but cannot manage targets.

### Task 1: Atomic submission and concise business history

**Files:** `api/src/goal-changes/goal-changes.dto.ts`, `goal-changes.controller.ts`, `goal-changes.service.ts`, related service/preview tests; `web/src/api/goal-changes.api.ts`, `GoalChangeDetailView.vue`, goal change Playwright tests.

- [x] Add failing tests for edited content submitted in one request, stale revision leaving draft untouched, and old create/save audit rows collapsing after submit.
- [x] Accept optional reason and goals in submit; validate and update within one task-locked transaction and emit one submit audit event.
- [x] Send edited fields in one submit call and render business-only timeline for submitted requests.
- [x] Run focused API and Web checks.

### Task 2: Separate HR grant management

**Files:** `web/src/views/goal-changes/GoalChangeGrantView.vue` (new), `GoalChangeListView.vue`, `web/src/router/routes.ts`, related Playwright tests.

- [x] Add failing tests for an HR-only grant page and no grant controls in the application page.
- [x] Build one responsive grant ledger using existing context/grant/revoke APIs and server permission checks.
- [x] Keep applicant/reviewer page focused on start, review, and history.
- [x] Verify desktop and mobile layout and grant/revoke behavior.

### Task 3: Role-appropriate workspace navigation and goal map

**Files:** `api/src/goal-changes/goal-changes.service.ts`, `goal-changes.controller.ts`, tests; `web/src/components/performance/PerformanceWorkspace.vue`, `TaskListView.vue`, `GoalTrackingView.vue`, `web/src/api/goal-changes.api.ts`, related Playwright tests.

- [x] Add failing tests for open grant, pending/history, no relation, and employee map visibility.
- [x] Add a lightweight read-only entry endpoint and use it for the application menu, retaining history after grant consumption.
- [x] Decouple goal map navigation from objective-management capability.
- [x] Verify role boundaries and all four workspace pages at desktop and mobile widths.

### Task 4: End-to-end verification and handoff

- [x] Run focused Jest, Web type-check/build, and Playwright.
- [x] Run isolated preview employee/manager/HR/department/VP approval flow on PC and mobile.
- [x] Check diff, commit only task files, and provide fixed preview and release boundary.
