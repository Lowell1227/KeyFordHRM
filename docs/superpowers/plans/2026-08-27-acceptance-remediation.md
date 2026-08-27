# Acceptance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the twelve accepted HRM issues across authentication, people data, permissions, organization editing, cycle planning, and employee goal setting.

**Architecture:** Extend the existing Prisma/NestJS/Vue modular monolith without replacing stable identifiers or historical records. Reuse `EmployeeDataChangeRequest` for reviewed archive writes, add explicit HR capabilities for granular authorization, and decouple new cycle tasks from template snapshots while preserving old task history.

**Tech Stack:** PostgreSQL, Prisma 5, NestJS 10, Jest, Vue 3, Element Plus, Pinia, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-acceptance-remediation-design.md`

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Preserve HRM roster authority and DingTalk login-only boundary.
- Do not delete historical template, indicator, task, employment, contract, or audit data.
- Write a focused failing test before each production behavior and watch the expected failure once.
- Run one consolidated focused verification and build after implementation; do not loop the full suite.
- Release API and Web together with rollback images and the newest live production baseline.

---

### Task 1: Password login and forced first change

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260827230000_add_password_change_and_hr_capabilities/migration.sql`
- Create: `api/src/auth/password-policy.ts`
- Create: `api/src/auth/password-policy.spec.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`
- Create: `api/src/auth/dto/change-password.dto.ts`
- Modify: `api/src/auth/auth.controller.ts`
- Modify: `api/src/users/users.service.ts`
- Modify: `api/src/users/dto/set-password.dto.ts`
- Modify: `web/src/views/auth/LoginView.vue`
- Create: `web/src/views/auth/ChangePasswordView.vue`
- Modify: `web/src/router/routes.ts`
- Modify: `web/src/router/index.ts`
- Modify: `web/src/stores/auth.store.ts`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Produce: `isValidEmployeePassword(value: string): boolean` matching `/^\d{4,6}$/` and excluding `0000` for employee-chosen passwords.
- Produce: `POST /auth/change-password { password, confirmPassword }` clearing `mustChangePassword`.
- Produce: password login response field `passwordChangeRequired`; DingTalk response always returns false.

- [ ] Add tests proving invalid lengths/non-digits/`0000` fail, valid 4–6 digits pass, and local login marks the limited session while DingTalk does not.
- [ ] Run `npm test -- password-policy.spec.ts auth.service.spec.ts --runInBand` in `api` and confirm failure because the policy and response flag do not exist.
- [ ] Add the schema, migration, API endpoint, login response, Web redirect, two-field change form, and one-click admin reset.
- [ ] Re-run the same focused specs and confirm they pass.

### Task 2: Granular HR roles and permissions

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/src/auth/hr-capabilities.ts`
- Create: `api/src/auth/hr-capabilities.spec.ts`
- Modify: `api/src/common/types/auth.types.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/users/users.service.ts`
- Modify: `api/src/users/dto/update-user-settings.dto.ts`
- Modify: `web/src/types/enums.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/src/router/routes.ts`

**Interfaces:**
- Produce: `HrCapability = 'employee_archive_edit' | 'employee_archive_review' | 'organization_edit' | 'cycle_plan_edit' | 'cycle_plan_review'`.
- Produce: `hasHrCapability(subject, capability): boolean`, with `hr` and `system_admin` granting all and `hr_user` reading its explicit list.
- Produce: additive `hrCapabilities` in login, `/auth/me`, and user settings payloads.

- [ ] Add table-driven tests for HR administrator, system administrator, ordinary HR with one grant, and unauthorized employee.
- [ ] Run the focused capability spec and confirm it fails because `hr_user` and grants do not exist.
- [ ] Add the enum/grant field, migration backfill for named HR users, API authorization helper, settings editor, route capability checks, and user-visible labels.
- [ ] Re-run the capability and affected auth/user specs.

### Task 3: Full employee archive review workflow, organization editing, and roster template

**Files:**
- Modify: `api/src/employee-archives/dto/employee-archive.dto.ts`
- Modify: `api/src/employee-archives/employee-archives.controller.ts`
- Modify: `api/src/employee-archives/employee-archives.service.ts`
- Modify: `api/src/employee-archives/employee-archives.service.spec.ts`
- Modify: `api/src/employee-archives/employee-data-reviews.service.ts`
- Modify: `api/src/departments/departments.controller.ts`
- Modify: `api/src/departments/departments.service.ts`
- Modify: `api/src/departments/departments.service.spec.ts`
- Create: `api/src/departments/dto/update-department-structure.dto.ts`
- Modify: `api/src/employee-archives/employee-roster.excel.ts`
- Modify: `web/src/api/employee-archives.api.ts`
- Modify: `web/src/api/departments.api.ts`
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Produce: `PATCH /employee-archives/:id/draft` accepting grouped `employee`, `profile`, `currentEmployment`, and `contracts` values and returning an `EmployeeDataChangeRequest`.
- Produce: `PATCH /departments/:id/structure { name, parentId }` and reject cycles/self-descendant moves.
- Produce: `GET /employee-archives/imports/template` returning the fixed xlsx workbook.

- [ ] Add archive tests proving submission leaves formal data unchanged and approval applies profile/current employment/contracts; add department tests proving descendant paths update and cycles are rejected.
- [ ] Run the two focused specs and confirm expected missing-endpoint/service failures.
- [ ] Implement grouped DTO validation, pending draft merge, reviewed application, capability checks, partitioned editor, masked sensitive inputs, organization rename/long-press drag, and template download.
- [ ] Re-run focused archive/department specs.

### Task 4: Cycle creator, reviewer, monthly follow-up, and template decoupling

**Files:**
- Modify: `api/prisma/schema.prisma`
- Modify: the `20260827230000` migration SQL
- Modify: `api/src/cycles/dto/create-cycle.dto.ts`
- Modify: `api/src/cycles/cycles.controller.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `api/src/cycles/launch.service.ts`
- Modify: `api/src/cycles/launch.service.spec.ts`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/src/api/cycles.api.ts`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Produce cycle fields `reviewerId`, `reviewStatus`, `reviewedAt`, `reviewComment`, and `monthlyFollowUpRequired`.
- Produce `POST /cycles/:id/review { action: 'approve' | 'reject', comment? }`.
- Make `AssessmentTask.snapshotId` nullable and launch new tasks with `snapshotId: null` and no initial indicator instances.

- [ ] Add create/review tests and a launch test proving an approved cycle without templates creates participant tasks with null snapshots.
- [ ] Run focused cycle/launch specs and confirm failure on the current HR-owner/template blockers.
- [ ] Implement capability authorization, automatic creator/reviewer, review gate, monthly flag, nullable snapshots, and template-free launch/preflight copy.
- [ ] Re-run focused cycle/launch specs.

### Task 5: Navigation cleanup and simple employee goal editor

**Files:**
- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Create: `web/src/views/task/simple-goal-draft.ts`
- Create: `web/src/views/task/simple-goal-draft.contract.ts`
- Modify: `api/src/tasks/dto/set-indicators.dto.ts`
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`

**Interfaces:**
- Produce: `validateSimpleGoalDraft(items)` returning duplicate names and total weight overflow without requiring exactly 100%.
- Preserve `SetIndicatorsDto.action` but treat both employee buttons as draft saves; “save and add next” is a Web continuation after successful save.

- [ ] Add tests for trimmed duplicate names, 100% boundary, and over-100 rejection; add route contract coverage for probation navigation and absent indicator library entry.
- [ ] Run focused API and Web contract tests and confirm current exact-100/template/library behavior fails.
- [ ] Remove indicator/template reference loading from employee edit mode, render only four fields and two save actions, remove indicator route/navigation, move probation/confirmation routes to performance, and append “人” to cycle funnel counts.
- [ ] Re-run focused task and route contracts.

### Task 6: Consolidated verification, commit, release, and acceptance

**Files:** all changed files only.

- [ ] Run one consolidated API focused Jest command covering auth, users, archive, departments, cycles, launch, and tasks.
- [ ] Run `npm run type-check` and `npm run build` in `web`, `npm run build` in `api`, `npx prisma validate`, and `git diff --check`.
- [ ] Review schema migration targets and query production read-only for unique named HR matches before applying migration.
- [ ] Commit the reviewed changes on `main`, push `origin/main`, and record the commit hash.
- [ ] Back up production, record current API/Web image IDs and Git heads, build candidate images, deploy the intended API/Web only, and keep rollback tags.
- [ ] Verify external home/health, password flow, named HR permissions, archive review, organization edit, template download, cycle review/template-free launch, and simple goal save behavior.
