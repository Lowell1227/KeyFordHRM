# Dynamic Business Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic performance business identities without breaking current accounts, historical tasks, routes, or login sessions, and make `canViewAll` strictly read-only for final performance approval.

**Architecture:** Compute additive `businessCapabilities` in the API from live organization relations plus historical task assignments, return them from login and `/auth/me`, and let the web application prefer these capabilities while retaining a legacy-role fallback only when the new payload is absent. Keep write authorization in the domain service and require exact task ownership.

**Tech Stack:** NestJS, Prisma, Jest, Vue 3, Pinia, TypeScript, Vue Router, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-dynamic-business-permissions-design.md`

## Global Constraints

- Do not change roster, DingTalk organization, employee archive, organization hierarchy, or historical task ownership.
- Do not add a database migration.
- Keep current `sysRole`, JWT, API routes, and old-session fallback during the compatibility phase.
- `canViewAll` may widen reads only; it must never satisfy a final-approval write check.
- Implement each behavior test-first and preserve unrelated primary-worktree files.
- Deploy API and Web together, verify production role/action behavior, and retain previous images for rollback.

---

### Task 1: Centralize dynamic business capabilities

**Files:**
- Create: `api/src/auth/business-capabilities.service.ts`
- Create: `api/src/auth/business-capabilities.service.spec.ts`
- Modify: `api/src/auth/auth.module.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Cover current direct reports, department leadership, effective approval scope, assigned historical tasks, cycle HR ownership, and `canViewAll` as view-only.

- [ ] **Step 2: Verify RED**

Run the focused Jest specs and confirm failure because the capability service and login payload do not exist.

- [ ] **Step 3: Implement the capability service**

Use active organization relations and nonterminal historical task assignments. Return boolean capabilities plus nonzero identity labels/counts; do not infer business-write identity from legacy manager/VP roles.

- [ ] **Step 4: Attach capabilities to login and `/auth/me`**

Inject the service into `AuthService`, register it in `AuthModule`, and add additive response fields without changing JWT claims.

- [ ] **Step 5: Verify GREEN**

Run the focused auth and capability specs.

### Task 2: Make final approval writes ownership-based

**Files:**
- Modify: `api/src/approval/approval.controller.ts`
- Modify: `api/src/approval/approval.controller.spec.ts`
- Modify: `api/src/approval/approval.service.ts`
- Modify: `api/src/approval/approval.service.spec.ts`

- [ ] **Step 1: Write failing authorization tests**

Assert that a dynamically assigned employee can reach the controller, while `canViewAll` can list all tasks but cannot approve or reject a task assigned to another user.

- [ ] **Step 2: Verify RED**

Run the focused approval specs and confirm failures at the fixed role gate and write bypass.

- [ ] **Step 3: Implement strict task ownership**

Remove the controller's fixed VP/chairman class gate. Preserve read filtering, but require `approverId === currentUser.id` for every approval mutation regardless of system role or `canViewAll`.

- [ ] **Step 4: Verify GREEN**

Run the focused approval specs.

### Task 3: Drive web entries from dynamic capabilities

**Files:**
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/types/navigation.types.ts`
- Modify: `web/src/stores/auth.store.ts`
- Modify: `web/src/router/routes.ts`
- Modify: `web/src/router/index.ts`
- Modify: `web/src/utils/navigation.ts`
- Modify: `web/e2e/specs/11-navigation-entrypoints.spec.ts`

- [ ] **Step 1: Write failing navigation contracts**

Cover an employee with approval capability, an employee with team capability, a legacy VP without the new payload, and a VP whose explicit new capability is false.

- [ ] **Step 2: Verify RED**

Run the focused Playwright import-contract spec.

- [ ] **Step 3: Implement typed capability-aware access**

Add optional capability payload types, prefer capability values when present, keep role fallback only when the payload is absent, and reuse the same route-access helper in navigation and the router guard.

- [ ] **Step 4: Verify GREEN**

Run the focused navigation spec and web type-check.

### Task 4: Show all current business identities

**Files:**
- Modify: the existing app header/account component discovered in the web layout
- Test: add the smallest existing layout or contract spec that proves identity labels render

- [ ] **Step 1: Write the failing visible-outcome test**

Assert that an account with multiple identities displays each returned identity label without changing its base system-role label.

- [ ] **Step 2: Verify RED**

Run the focused web test.

- [ ] **Step 3: Implement compact identity display**

Render nonzero `businessCapabilities.identities` in the account dropdown/header with clear Chinese labels and counts; omit the section when no identities exist.

- [ ] **Step 4: Verify GREEN**

Run the focused test and inspect the real page at desktop and narrow widths.

### Task 5: Regression, review, release, and production acceptance

**Files:**
- Verify all changed files.
- Modify release metadata only if required by the existing deployment workflow.

- [ ] **Step 1: Run complete verification**

Run API tests, Web type-check/build, targeted Playwright contracts, `git diff --check`, and a sensitive-string scan.

- [ ] **Step 2: Review compatibility and authorization diff**

Confirm no schema/roster/history change, no role-derived approval write path, no `canViewAll` mutation bypass, and no unrelated files.

- [ ] **Step 3: Commit and push**

Fast-forward the reviewed branch into current `main`, push `origin/main`, and record the commit hash.

- [ ] **Step 4: Deploy with rollback prepared**

Back up production data as required by the existing release process, tag current API/Web images, build and deploy immutable images for the new commit, and keep the prior images available.

- [ ] **Step 5: Validate production**

Verify health, login, capability payload, dynamic menu visibility, exact-owner approval behavior, and that a read-all account cannot mutate another approver's task. Report the production URL and rollback target.
