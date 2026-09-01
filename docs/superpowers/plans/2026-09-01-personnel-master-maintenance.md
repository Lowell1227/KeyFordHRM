# Personnel Master Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver daily HR maintenance for employees, departments, positions, contracts, effective-dated employment changes, and one compact review workbench in one production release.

**Architecture:** Extend the existing employee archive and department review domains instead of replacing `User`. Add a reviewed position directory and effective-date metadata, keep legacy text fields as compatible projections, and expose four focused personnel routes. All writes remain review-first and DingTalk remains identity/login-only.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Vue 3, Element Plus, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-personnel-master-maintenance-design.md`

## Global Constraints

- Work directly on the user-authorized leading `main`; preserve concurrent work and stop if the worktree becomes dirty from another task.
- Roster/HRM data is authoritative; DingTalk organization and address book never write HR organization or employee data.
- Business consistency problems are warnings and do not block draft save or submission; structurally unusable input may be rejected.
- Department deactivation never auto-unassigns employees or promotes child departments.
- Preserve `User` and legacy `position` projections until downstream readers have migrated.
- Submitters cannot approve their own requests.
- Do not physically delete employees, departments, positions, employment records, contracts, or review history.

---

### Task 1: Position directory data model and reviewed API

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260901090000_add_position_directory_and_effective_reviews/migration.sql`
- Create: `api/src/positions/positions.module.ts`
- Create: `api/src/positions/positions.controller.ts`
- Create: `api/src/positions/positions.service.ts`
- Create: `api/src/positions/positions.service.spec.ts`
- Create: `api/src/positions/dto/position.dto.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Produces `Position { id, code, name, jobFamily, isActive }` and nullable `positionId` on `User` and `EmploymentRecord`.
- Produces reviewed endpoints `GET/POST/PATCH/DELETE /positions`, `GET /positions/change-requests`, and approve/reject actions.
- Position writes create pending `PositionChangeRequest`; approval applies the requested change and writes audit logs.

- [ ] **Step 1: Write failing service tests**

```ts
it('submits a position create request without creating the formal position', async () => {
  const result = await service.create({ code: 'HRBP', name: 'HRBP', jobFamily: '人力资源' }, operator);
  expect(result.status).toBe('pending');
  expect(prisma.position.create).not.toHaveBeenCalled();
});

it('prevents the submitter from approving their own position change', async () => {
  await expect(service.approve(requestId, operator)).rejects.toThrow('不能审核自己提交的变更');
});
```

- [ ] **Step 2: Verify the tests fail because the positions module is absent**

Run: `cd api; npm test -- --runInBand src/positions/positions.service.spec.ts`

Expected: FAIL because `PositionsService` and its module do not exist.

- [ ] **Step 3: Add compatible Prisma models and migration**

Create `Position`, `PositionChangeRequest`, and relations. The SQL migration creates positions from distinct non-empty legacy position names, uses deterministic `LEGACY-<hash>` codes, and backfills matching `position_id` values without removing legacy text.

- [ ] **Step 4: Implement the reviewed position service and controller**

Use the same `organization_edit` and `employee_archive_review` capability boundary as department maintenance. Return impact counts and warning strings for duplicate names or active users on deactivation.

- [ ] **Step 5: Verify focused tests and Prisma schema**

Run: `cd api; npx prisma validate --schema prisma/schema.prisma; npm test -- --runInBand src/positions/positions.service.spec.ts`

Expected: Prisma validation succeeds and all position tests pass.

- [ ] **Step 6: Commit the position foundation**

```bash
git add api/prisma api/src/positions api/src/app.module.ts
git commit -m "feat(people): add reviewed position directory"
```

### Task 2: Employee creation, effective dates, warnings, and safe department deactivation

**Files:**
- Modify: `api/src/employee-archives/dto/employee-archive.dto.ts`
- Modify: `api/src/employee-archives/dto/employee-data-review.dto.ts`
- Modify: `api/src/employee-archives/employee-archives.controller.ts`
- Modify: `api/src/employee-archives/employee-archives.service.ts`
- Modify: `api/src/employee-archives/employee-archives.service.spec.ts`
- Modify: `api/src/employee-archives/employee-data-reviews.service.ts`
- Modify: `api/src/employee-archives/employee-data-reviews.service.spec.ts`
- Create: `api/src/employee-archives/employment-timeline.ts`
- Create: `api/src/employee-archives/employment-timeline.spec.ts`
- Modify: `api/src/departments/departments.service.ts`
- Modify: `api/src/departments/departments.service.spec.ts`

**Interfaces:**
- Produces `POST /employee-archives` to create a pending employee request with no formal `User` before approval.
- Employee drafts accept `effectiveFrom`, optional `effectiveTo`, `positionId`, and warning metadata.
- Produces `POST /employee-archives/reviews/reject` for return/rejection with a reason.
- `selectEmploymentAt(records, date)` selects the latest-starting approved interval and reports overlaps.

- [ ] **Step 1: Write failing timeline and employee-creation tests**

```ts
it('selects the later effective record and reports an overlap', () => {
  const result = selectEmploymentAt(overlappingRecords, new Date('2026-09-01'));
  expect(result.current?.id).toBe('later');
  expect(result.warnings).toContain('任职时间重叠');
});

it('keeps a manually created employee pending until profile approval', async () => {
  const request = await service.createEmployee(input, operator);
  expect(request.userId).toBeNull();
  expect(request.profileReviewStatus).toBe('pending');
  expect(prisma.user.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and confirm expected failures**

Run: `cd api; npm test -- --runInBand src/employee-archives/employment-timeline.spec.ts src/employee-archives/employee-archives.service.spec.ts`

Expected: FAIL because the timeline selector and employee-create API are missing.

- [ ] **Step 3: Implement warning-only timeline selection and employee submission**

Create pending requests with validated identity fields, but store contract and employment overlaps as warnings. Resolve `positionId` to its compatible name and preserve both values in the proposal.

- [ ] **Step 4: Write failing review and department safety tests**

```ts
it('rejects self approval on employee changes', async () => {
  await expect(service.approveBatch({ requestIds: [requestId], scopes: ['profile'] }, submitter))
    .resolves.toMatchObject({ failed: [{ reason: '不能审核自己提交的变更' }] });
});

it('does not unassign people or promote children when a department is deactivated', async () => {
  await expect(service.approveChange(requestId, reviewer)).rejects.toThrow('请先处理在职人员和下级部门');
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
  expect(prisma.department.updateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Implement review rejection, self-review guard, position linkage, and safe deactivation**

Employee approval creates the formal `User`, profile and employment row in one transaction. Department submission remains allowed with impact warnings, but approval refuses to apply while active people or children remain.

- [ ] **Step 6: Run focused API tests**

Run: `cd api; npm test -- --runInBand src/employee-archives src/departments`

Expected: employee archive, timeline, review, and department suites pass.

- [ ] **Step 7: Commit employee and organization behavior**

```bash
git add api/src/employee-archives api/src/departments
git commit -m "feat(people): add reviewed employee lifecycle changes"
```

### Task 3: Future-effective projection and personnel diagnostics

**Files:**
- Create: `api/src/employee-archives/employee-effective-date.service.ts`
- Create: `api/src/employee-archives/employee-effective-date.service.spec.ts`
- Modify: `api/src/employee-archives/employee-archives.module.ts`
- Modify: `api/src/scheduler/scheduler.service.ts`
- Modify: `api/src/scheduler/scheduler.service.spec.ts`
- Create: `api/src/employee-archives/personnel-diagnostics.service.ts`
- Create: `api/src/employee-archives/personnel-diagnostics.service.spec.ts`
- Modify: `api/src/employee-archives/employee-archives.controller.ts`

**Interfaces:**
- Produces `refreshEffectiveProjections(at: Date)` to project the current employment row onto `User`.
- Scheduler invokes projection refresh in `Asia/Shanghai` without reading DingTalk organization data.
- Produces `GET /employee-archives/diagnostics` with duplicate identity, missing department, position mapping, manager, employment overlap, contract overlap, and resigned-login counts.

- [ ] **Step 1: Write failing projection and diagnostics tests**

```ts
it('projects a future employment only after its effective date', async () => {
  await service.refreshEffectiveProjections(new Date('2026-09-01T00:00:00+08:00'));
  expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { position: 'HRBP' } }));
});

it('reports overlapping employments without modifying them', async () => {
  const result = await diagnostics.run();
  expect(result.employmentOverlaps.count).toBe(1);
  expect(prisma.employmentRecord.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify both tests fail for missing services**

Run: `cd api; npm test -- --runInBand src/employee-archives/employee-effective-date.service.spec.ts src/employee-archives/personnel-diagnostics.service.spec.ts`

Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement projection refresh, scheduler wiring, and read-only diagnostics**

Projection selects the latest-starting interval covering the supplied date. Diagnostics only reads and aggregates; it never merges, closes, deactivates, or deletes data.

- [ ] **Step 4: Run focused scheduler and archive tests**

Run: `cd api; npm test -- --runInBand src/employee-archives src/scheduler`

Expected: all focused suites pass.

- [ ] **Step 5: Commit effective-date processing**

```bash
git add api/src/employee-archives api/src/scheduler
git commit -m "feat(people): activate effective-dated employment records"
```

### Task 4: Four personnel routes and daily maintenance UI

**Files:**
- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/src/views/admin/components/DepartmentEditDrawer.vue`
- Create: `web/src/views/admin/components/EmployeeCreateDrawer.vue`
- Create: `web/src/views/admin/PositionDirectoryView.vue`
- Create: `web/src/api/positions.api.ts`
- Modify: `web/src/api/employee-archives.api.ts`
- Modify: `web/src/api/departments.api.ts`
- Modify: `web/src/types/api.types.ts`
- Create: `web/e2e/specs/32-personnel-master-maintenance.spec.ts`

**Interfaces:**
- Routes are `/users`, `/organization`, `/positions`, and `/personnel-change-reviews` with matching personnel navigation labels.
- `UserManageView` accepts `mode: 'employees' | 'organization'` so each route shows one clear task without nested page tabs.
- `EmployeeCreateDrawer` submits a pending employee request; `PositionDirectoryView` submits reviewed position changes.

- [ ] **Step 1: Add failing route and interaction contract tests**

```ts
test('personnel navigation exposes four independent entries', async ({ page }) => {
  await expect(page.getByRole('link', { name: '员工档案' })).toBeVisible();
  await expect(page.getByRole('link', { name: '组织架构' })).toBeVisible();
  await expect(page.getByRole('link', { name: '岗位目录' })).toBeVisible();
  await expect(page.getByRole('link', { name: '人事变更审核' })).toBeVisible();
});
```

- [ ] **Step 2: Verify the browser contract fails on missing routes/buttons**

Run: `cd web; npx playwright test --config playwright.contract.config.ts e2e/specs/32-personnel-master-maintenance.spec.ts`

Expected: FAIL because organization/position routes and add actions are absent.

- [ ] **Step 3: Implement APIs, routes, drawers, and clear page modes**

Employee page exposes “新增员工” and moves roster import under “批量操作”. Organization page exposes “新增一级部门” and “新增下级部门”; all user-facing “删除部门” copy becomes “停用部门”. Position page provides table, filters, add/edit/deactivate actions and impact display.

- [ ] **Step 4: Run focused browser contracts and type-check**

Run: `cd web; npm run type-check; npx playwright test --config playwright.contract.config.ts e2e/specs/32-personnel-master-maintenance.spec.ts`

Expected: type-check and focused browser contract pass.

- [ ] **Step 5: Commit daily-maintenance UI**

```bash
git add web/src web/e2e/specs/32-personnel-master-maintenance.spec.ts
git commit -m "feat(people): add daily personnel maintenance workspace"
```

### Task 5: Compact unified review workbench

**Files:**
- Modify: `web/src/views/admin/PersonnelReviewView.vue`
- Modify: `web/src/views/admin/components/PersonnelPendingReviews.vue`
- Modify: `web/src/api/employee-archives.api.ts`
- Modify: `web/src/api/departments.api.ts`
- Modify: `web/src/api/positions.api.ts`
- Modify: `web/e2e/specs/23-employee-data-review.spec.ts`
- Modify: `web/e2e/specs/32-personnel-master-maintenance.spec.ts`

**Interfaces:**
- One compact list combines employee, organization, position, and contract categories.
- Rows expose title/data/actions; details and explanations appear in a drawer or question-mark tooltip.
- Employee and position reviews support return; safe pending items support batch approval.

- [ ] **Step 1: Write failing review-layout tests**

```ts
test('review page keeps explanations behind help and shows one compact queue', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '人事变更审核' })).toBeVisible();
  await expect(page.getByText('集中审核普通 HR 提交')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '审核规则说明' })).toBeVisible();
  await expect(page.getByText(/全部 \d+/)).toBeVisible();
});
```

- [ ] **Step 2: Verify the existing explanatory layout fails the new test**

Run: `cd web; npx playwright test --config playwright.contract.config.ts e2e/specs/23-employee-data-review.spec.ts e2e/specs/32-personnel-master-maintenance.spec.ts`

Expected: FAIL because the current page shows repeated explanatory paragraphs and separate large category panels.

- [ ] **Step 3: Implement compact filters, unified rows, help tooltip, details drawer, and batch actions**

Keep risk text short in the row and use a line-broken tooltip for the full rule. Preserve accessible names and mobile stacking.

- [ ] **Step 4: Run review contracts and production build**

Run: `cd web; npm run type-check; npx playwright test --config playwright.contract.config.ts e2e/specs/23-employee-data-review.spec.ts e2e/specs/32-personnel-master-maintenance.spec.ts; npm run build`

Expected: type-check, both focused contract suites, and production build pass.

- [ ] **Step 5: Commit review simplification**

```bash
git add web/src/views/admin web/src/api web/e2e/specs
git commit -m "feat(people): simplify unified personnel review"
```

### Task 6: Migration verification, release, and production acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-personnel-master-maintenance-design.md` only if implementation evidence requires a factual correction
- Modify: `docs/superpowers/plans/2026-09-01-personnel-master-maintenance.md` to check completed steps

**Interfaces:**
- Produces a pushed `main`, rollback database/image references, deployed API/Web revisions, and external acceptance evidence.

- [ ] **Step 1: Run complete proportional verification**

Run:

```powershell
cd api
npx prisma validate --schema prisma/schema.prisma
npm test -- --runInBand src/positions src/employee-archives src/departments src/scheduler
npm run build
cd ../web
npm run type-check
npx playwright test --config playwright.contract.config.ts e2e/specs/23-employee-data-review.spec.ts e2e/specs/32-personnel-master-maintenance.spec.ts
npm run build
```

Expected: every command exits 0 with no new warnings attributable to this change.

- [ ] **Step 2: Inspect migration SQL and dry-run diagnostics against a production clone or approved local copy**

Expected: legacy employees remain one row each, existing position text remains present, position links are populated where deterministic, and diagnostics perform no writes.

- [ ] **Step 3: Verify clean leading main and push**

Run: `git status --short --branch; git fetch origin --prune; git push origin main; git ls-remote origin refs/heads/main`

Expected: worktree clean and local/remote `main` hashes match.

- [ ] **Step 4: Back up production and deploy the formal compose stack**

Tag current API/Web images for rollback, create a timestamped PostgreSQL backup, deploy the migration, then recreate only the API and Web services from the pushed revision. Keep PostgreSQL, Redis, and MinIO data services intact.

- [ ] **Step 5: Verify production behavior**

Check local/external home and `/api/v1/health`, production image revision labels, controlled test login, the four personnel routes, a non-destructive employee-create draft, compact review queue, and confirmation that DingTalk organization sync remains disabled.

- [ ] **Step 6: Record final evidence**

Report deployed revision, backup/rollback references, passed checks, any pre-existing unrelated failures, and whether test quick login was disabled after acceptance.
