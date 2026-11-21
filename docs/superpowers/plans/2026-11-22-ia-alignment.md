# IA-ALIGN-01 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development; preserve unrelated WIP. Checkboxes track verified deliverables.

**Goal:** Align menus and capability descriptions with current HRM business boundaries, without changing backend authorization or workflows.

**Architecture:** Keep existing Vue Router URLs and source-domain APIs. Recruitment becomes a functional module; planning is an admin-only separate read-only page. System overview reads existing notification settings without writes.

**Tech Stack:** Vue 3, Vue Router, Element Plus, TypeScript, Node tests, Playwright and existing isolated preview backend.

**Spec:** User-authorized delegated requirement IA-ALIGN-01, 2026-11-22. Frozen boundaries summarized below.

## Global Constraints

- No `api/src/**`, `api/prisma/**`, Compose or environment-config edits. No production release, real business data edits, notifications, calendar invitations, model calls or salary operations.
- Preserve all existing IDs, API writes, recruitment/personnel/performance state machines, audit, public shares and deep links. Product version remains 0.9.1.
- Recruitment: talent, actual existing interview queue, hiring confirmation / onboarding handoff; no new dashboard or generic workflow. Personnel owns arrival, employee/archive/contract/employment and probation/conversion.
- Performance groups: 绩效任务 / 绩效运营 / 绩效分析 / 绩效设置. Global dashboard is 全局工作台. 人事基础资料 is explicit.
- Recruitment planning and compensation planning only system-admin; planning does not grant business authority. System-admin does not gain hiring-confirm authority.
- User confirmed keeping existing shared archive/recruitment backend capabilities this round; independent personnel/recruitment HR permissions are deferred, not simulated by menus.
- Preserve the dirty original checkout and main worktree, including the uncommitted talent-delete feature. Source origin/main=8aede43e, production API/Web=92e6e809; latter only differs from source by release documentation.

## Review Focus

- Hiring-confirm-only and interview-only users must not receive talent-wide access; links remain usable.
- Default recruitment landing must be an accessible real page, not planning or forbidden confirmation.
- Older notification/detail/legacy links must retain object/query/hash and active navigation.
- Notification unavailable / disabled / enabled / load-error must remain distinct; unavailable combines platform deployment switch and credential availability, not credential absence alone.
- 390px module rail must stay horizontally reachable; active/collapsed navigation survives refresh without page overflow.

## Task 1: Navigation And Copy

**Files:** `web/src/router/navigation.ts`, `navigation.types.ts`, `routes.ts`; recruitment landing/planning views; dashboard, task return text; compensation planning copy.

- [x] Add failing Node route/menu matrix assertions (11 role/capability combinations, real defaults and legacy paths).
- [x] Reuse existing guards for URL authorization; add navigation-only audience for interview queue if needed. Move talent/hiring to recruitment, conversion to people, organize performance groups, admin planning.
- [x] Redirect `/recruitment` to first accessible real recruitment route while retaining query/hash. No API permission expansion.
- [x] Update global dashboard and narrow contextual labels; compact read-only planning boundaries (DingTalk owns OA/attendance/expense; future read-only final-result synchronization is not implemented).
- [x] Run focused Node matrix and independent review.

## Task 2: System Status

**Files:** `web/src/views/system/SystemOverviewView.vue`, focused Node tests.

- [x] Add tests for notification enabled, business disabled, platform unavailable, failed/malformed reads and late response.
- [x] Reuse `cyclesApi.getDingtalkNotificationSettings()` GET only. Split station notifications, DingTalk work notifications, todo, calendar; state human-resource references partial and recruitment functioning vs unstarted scope.
- [x] Verify targeted tests; no settings write or invented calendar runtime status.

## Task 3: Compatibility And Delivery

**Files:** legacy menu tests under `web/e2e/specs/`, new `web/e2e/preview/ia-alignment.spec.ts`, acceptance record and project memory.

- [x] Converge obsolete menu expectations without weakening role/API boundaries.
- [x] Use existing isolated backend, fictional role fixtures and real HTTP/page requests for matrix, old URLs, public share and personnel handoff; separately label synthetic notification-read states.
- [x] Check 1440 / 1024 / 390, default landing, collapse/reload, active state, horizontal reachability; type-check and production build once final sources stabilize. No API full-suite rerun for Web-only scope.
- [ ] Commit only task files on isolated branch and report hash; final bounded review, fixed preview and evidence are complete. Do not merge/push main or publish without explicit scope.

## Decisions / Status

- 2026-11-22: Created managed worktree `ia-align-20261122`, branch `codex/ia-align-20261122`; other worktrees unchanged.
- 2026-11-22: Existing archive edit/review are shared recruitment capabilities. User explicitly confirmed retaining them for this menu-only task.
