# Performance Query Filters and Scope Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify cycle, department, and employee filters across seven performance record pages and make cycle participant selection show the exact included people.

**Architecture:** Extend each existing API inside its current permission boundary, add one read-only participant preview endpoint, and share only the stable filter presentation in Web. Keep calibration distributions and approval summaries cycle-wide while filtering their employee lists.

**Tech Stack:** NestJS, Prisma, Vue 3, TypeScript, Element Plus, Jest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-09-performance-query-and-scope-preview-design.md`

## Global Constraints

- Work directly on the leading `main` because the user explicitly authorized it.
- Default to the visible cycle with the newest valid `createdAt`.
- Preserve all existing role, relationship, data-scope, scoring, workflow, and notification behavior.
- Do not add a database migration.
- Verify desktop and 390px mobile layouts.
- Release API and Web only after focused tests and production builds pass; retain rollback images.

---

### Task 1: Shared filter presentation and latest-cycle rule

**Files:**
- Create: `web/src/components/common/PerformanceRecordFilters.vue`
- Modify: `web/src/utils/performance-cycle.ts`
- Test: `web/e2e/specs/51-performance-query-filters.spec.ts`

**Interfaces:**
- Produces: `orderPerformanceCyclesByCreatedAt(cycles: AssessmentCycle[]): AssessmentCycle[]`.
- Produces: a component with `v-model:cycle-id`, `v-model:dept-id`, `v-model:keyword`, `cycles`, `departments`, `loading`, `extra` slot, and `search`/`reset` events.

- [ ] **Step 1: Write the failing browser test**

Assert the filter order `绩效周期计划 → 部门 → 员工姓名/工号`, the latest-created default, query/reset behavior, and responsive wrapping at 390px.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --prefix web run test:e2e -- --config playwright.config.ts web/e2e/specs/51-performance-query-filters.spec.ts`

Expected: FAIL because the shared filters and latest-created default do not exist.

- [ ] **Step 3: Implement the shared component and ordering helper**

Use the exact public ordering function:

```ts
export function orderPerformanceCyclesByCreatedAt(cycles: AssessmentCycle[]): AssessmentCycle[]
```

Sort valid timestamps descending and preserve original order for equal or absent timestamps. Render the three labeled controls, optional extra slot, and `查询`/`重置` buttons.

- [ ] **Step 4: Run the focused browser test**

Expected: the shared component assertions pass after page integrations in Task 3.

### Task 2: Server-side performance record filters

**Files:**
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/interviews/dto/interview-query.dto.ts`
- Modify: `api/src/interviews/interviews.service.ts`
- Modify: `api/src/improvement-plans/dto/improvement-plan-query.dto.ts`
- Modify: `api/src/improvement-plans/improvement-plans.service.ts`
- Modify: `api/src/calibration/calibration.controller.ts`
- Create: `api/src/calibration/dto/calibration-query.dto.ts`
- Modify: `api/src/calibration/calibration.service.ts`
- Modify: `api/src/approval/approval.controller.ts`
- Create: `api/src/approval/dto/approval-list-query.dto.ts`
- Modify: `api/src/approval/approval.service.ts`
- Modify: `api/src/publish/dto/publication-records-query.dto.ts`
- Modify: `api/src/publish/publish.service.ts`
- Modify: `api/src/appeals/appeals.service.ts`
- Test: existing service specs in each module plus `api/src/tasks/department-review-list.spec.ts`

**Interfaces:**
- Consumes: optional `cycleId`, `deptId`, `keyword`, page-specific status, and pagination.
- Produces: filtered lists whose employee keyword matches either `name` or `employeeNo` without changing authorization predicates.

- [ ] **Step 1: Add failing API tests**

Each test passes a department plus an employee-number fragment and asserts the Prisma `where` retains its original permission scope while adding the requested predicates.

- [ ] **Step 2: Run the related specs and verify RED**

Run the Jest specs for tasks, interviews, improvement plans, calibration, approval, publish, and appeals.

Expected: FAIL where DTOs or services currently ignore the fields or only search the employee name.

- [ ] **Step 3: Implement the minimal filters**

Trim blank keywords. Combine name/employee-number matching with department and cycle predicates. For calibration, keep summary calculations on all authorized cycle tasks and filter only returned `items`.

- [ ] **Step 4: Re-run related API specs**

Expected: PASS with original permission assertions intact.

### Task 3: Integrate seven performance pages

**Files:**
- Modify: `web/src/views/task/DepartmentReviewListView.vue`
- Modify: `web/src/views/calibration/CalibrationView.vue`
- Modify: `web/src/views/approval/ApprovalView.vue`
- Modify: `web/src/views/publish/PublishView.vue`
- Modify: `web/src/views/appeals/AppealsView.vue`
- Modify: `web/src/views/interview/InterviewListView.vue`
- Modify: `web/src/views/improvement-plans/ImprovementPlanListView.vue`
- Modify: `web/src/api/calibration.api.ts`
- Modify: `web/src/api/approval.api.ts`
- Modify: `web/src/api/publication.api.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/types/interview.types.ts`
- Test: `web/e2e/specs/51-performance-query-filters.spec.ts`

**Interfaces:**
- Consumes: `PerformanceRecordFilters` and each page's existing cycle/department APIs.
- Produces: identical control order, latest-created initial cycle, page reset on search, and preserved page-specific status/summary behavior.

- [ ] **Step 1: Extend failing page scenarios for all seven routes**

Mock complete cycle, department, and list responses. Assert request query strings include the selected cycle, department, and employee keyword.

- [ ] **Step 2: Verify the new page scenarios fail**

Run the focused Playwright spec and confirm missing controls/parameters are the reason.

- [ ] **Step 3: Integrate the shared component page by page**

Load visible cycles and active departments, select the latest-created cycle, keep existing status controls in the `extra` slot, reset pagination before loading, and preserve bottom `ListPagination`.

- [ ] **Step 4: Run the focused page tests at desktop and 390px**

Expected: PASS with no body-level horizontal overflow.

### Task 4: Exact participant preview and single-line entry

**Files:**
- Create: `api/src/cycles/dto/participant-preview.dto.ts`
- Modify: `api/src/cycles/cycles.controller.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.module.ts` only if the endpoint requires a new provider
- Modify: `web/src/api/cycles.api.ts`
- Modify: `web/src/views/admin/components/CycleParticipantScopePicker.vue`
- Modify: `web/e2e/specs/17-cycle-launch-entry-ux.spec.ts`
- Test: `api/src/cycles/participant-candidates.spec.ts` or a new adjacent participant-preview spec

**Interfaces:**
- Produces: `POST /cycles/participant-preview` accepting `scope`, `departmentIds`, `userIds`, `excludedDepartmentIds`, `excludedUserIds`, `keyword`, `page`, and `pageSize`.
- Produces: `{ total, page, pageSize, departmentCount, items: CycleParticipantCandidate[] }`.

- [ ] **Step 1: Add failing preview API and picker tests**

Assert active employee filtering, selected-department OR explicit-user inclusion, explicit exclusions, minimal projection, exact total, a single visible entry button, and actual names in the preview.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because the preview endpoint and single-row picker do not exist.

- [ ] **Step 3: Implement preview API**

Reuse the participant candidate eligibility predicate: non-deleted employee accounts, non-assessor-only, active/probation status. Apply selected scope and exclusions before keyword and pagination.

- [ ] **Step 4: Implement picker layout**

Replace the two buttons with a single summary row and `查看与调整`. Add a preview panel that refreshes from the draft selection, displays name, employee number, department, and position, and uses cards on mobile.

- [ ] **Step 5: Re-run participant API and cycle entry tests**

Expected: PASS for PC and 390px scenarios.

### Task 5: Verification, review, commit, push, and release

**Files:**
- Modify only test fixtures or declarations generated by the verified build when they are tracked and belong to this change.

**Interfaces:**
- Produces: one reviewed main commit, matching `origin/main`, API/Web production images labeled with that revision, and retained rollback references.

- [ ] **Step 1: Run fresh verification**

Run related API Jest specs, `npm --prefix api run build`, `npm --prefix web run type-check`, `npm --prefix web run build`, and focused Playwright specs.

- [ ] **Step 2: Review the complete diff**

Check filtering predicates, permission preservation, stale request handling, mobile overflow, unrelated worktree changes, and generated artifacts.

- [ ] **Step 3: Commit and push only task files**

Run `git diff --cached --check`, verify the staged file list, commit, push `main`, and confirm `HEAD == origin/main`.

- [ ] **Step 4: Build and smoke-test candidate API/Web images**

Verify API health, Web Nginx/proxy behavior, query endpoints with controlled requests, and responsive browser behavior before production replacement.

- [ ] **Step 5: Preserve rollback images and replace only API/Web**

Use the formal `.env`, both Compose files, and `kayford-deploy`; do not recreate PostgreSQL, Redis, or MinIO.

- [ ] **Step 6: Verify production**

Confirm external home and health, API/Web revisions, test-login disabled, service container continuity, and the requested page behavior. Record any remaining real-role acceptance limitation separately.
