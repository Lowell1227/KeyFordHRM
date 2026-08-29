# Cycle Creation Acceptance Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver ACC-001 as one focused round: compact the monthly scoring schedule, remove redundant exception/default controls, and let new workflow-v2 plans enter the HR administrator review pool without selecting a reviewer during creation.

**Architecture:** Keep the existing cycle and schedule data model. New workflow-v2 cycles leave nullable `reviewerId` empty until an HR administrator reviews; existing cycles with an assigned reviewer retain their assignment. The Web removes reviewer selection and renders the existing schedules as a compact desktop grid with a mobile card fallback.

**Tech Stack:** Vue 3, Element Plus, Playwright contract tests, NestJS, Prisma, Jest.

**Spec:** `docs/acceptance/2026-08-29-production-acceptance-issues.md`

## Global Constraints

- Do not publish production in this task; publication still requires a separate explicit user instruction.
- Preserve historical cycles and any existing non-null `reviewerId` assignment.
- Do not grant Fang Yuan or other cycle editors broader employee archive visibility.
- Keep warnings inline and non-blocking; keep schedule ordering blockers unchanged.
- Keep `取消 / 保存草稿 / 下一步` behavior unchanged.

---

### Task 1: HR Administrator Review Pool

**Files:**
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/src/views/admin/components/CycleCompactTable.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`

**Interfaces:**
- Consumes: nullable `AssessmentCycle.reviewerId` already defined by Prisma.
- Produces: workflow-v2 create requests omit `reviewerId`; an HR administrator review atomically writes `reviewerId = user.id`.

- [x] **Step 1: Write failing API tests for unassigned creation and pool claim**

Add service tests equivalent to:

```ts
it('leaves a new workflow-v2 plan unassigned for the HR administrator review pool', async () => {
  await service.create(quarterlyCycle({ workflowVersion: 2 }), creator);
  const data = prisma.assessmentCycle.create.mock.calls[0][0].data;
  expect(data).not.toHaveProperty('reviewer');
});

it('lets an HR administrator claim and review an unassigned plan', async () => {
  prisma.assessmentCycle.findUnique
    .mockResolvedValueOnce(storedDraft({ reviewerId: null, reviewStatus: 'pending', reviewedAt: null }))
    .mockResolvedValueOnce(storedDraft({ reviewerId: reviewer.id, reviewStatus: 'approved', planVersion: 4 }));
  await service.review('cycle-1', { action: 'approve', expectedPlanVersion: 3 }, reviewer);
  expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ reviewerId: reviewer.id, reviewStatus: 'approved' }),
  }));
});
```

- [x] **Step 2: Run the API tests and confirm RED**

Run: `npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: the workflow-v2 create test finds an automatic reviewer connection, and the pool review test receives `仅本周期审核人可以审核`.

- [x] **Step 3: Implement nullable workflow-v2 reviewer assignment and safe pool claiming**

In `CyclesService.create`, resolve and connect a reviewer only for workflow-v1 creation. In `CyclesService.review`, authorize an unassigned plan only for `SysRole.hr`, preserve the existing assigned-reviewer rule, include the current reviewer in the compare-and-swap filter, and set `reviewerId` to the actual reviewer in the update.

```ts
const reviewerId = workflowVersion === 1
  ? await this.resolveReviewerId(dto.reviewerId)
  : null;

...(reviewerId && { reviewer: { connect: { id: reviewerId } } }),
```

- [x] **Step 4: Run the API tests and confirm GREEN**

Run: `npm test -- --runInBand src/cycles/cycles.service.spec.ts`

Expected: all `CyclesService` tests pass, including existing system-administrator rejection and assigned-reviewer compatibility.

- [x] **Step 5: Write failing Web tests for reviewer removal and pool visibility**

Update the focused Playwright contract so it asserts:

```ts
await expect(page.getByLabel('审核人')).toHaveCount(0);
expect(createBodies.at(-1)).not.toHaveProperty('reviewerId');

const pendingCycle = { ...integratedCycle, reviewerId: undefined, reviewer: null, reviewStatus: 'pending' };
await expect(page.getByRole('button', { name: '审核', exact: true })).toBeVisible();
```

- [x] **Step 6: Run the focused Web cases and confirm RED**

Run: `npx playwright test e2e/specs/25-cycle-scoring-plan.spec.ts --config playwright.contract.config.ts --grep "review pool|omits reviewer"`

Expected: the create form still shows the reviewer selector and an unassigned plan has no review action.

- [x] **Step 7: Implement the Web review-pool presentation**

Remove `UserSelect`, `createForm.reviewerId`, its validation rule, form field, edit hydration, and create payload. Add `canReviewCyclePlan` for HR administrators and pass it to `CycleCompactTable`; show review when the plan is unassigned or assigned to the current HR administrator. Render `HR 管理员审核池` instead of an empty reviewer name in the workspace.

- [x] **Step 8: Run the focused Web cases and confirm GREEN**

Run the same Playwright command from Step 6 and require all selected cases to pass.

- [x] **Step 9: Commit the review-pool behavior**

Run `git add api/src/cycles/cycles.service.ts api/src/cycles/cycles.service.spec.ts web/src/views/admin/CycleManageView.vue web/src/views/admin/components/CycleCompactTable.vue web/src/views/admin/components/CycleWorkspaceShell.vue web/e2e/specs/25-cycle-scoring-plan.spec.ts` followed by `git commit -m "fix(cycles): route new plans to HR review pool"`.

### Task 2: Compact Scoring Schedule and Remove Redundant Controls

**Files:**
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`
- Modify: `web/e2e/fixtures/CycleScoringPlanHarness.vue`
- Modify: `web/src/views/admin/components/CycleMonthlyScheduleEditor.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`

**Interfaces:**
- Consumes: existing `update:schedules`, `restore-one`, and `restore-all` events.
- Produces: direct date edits mark a row as adjusted; restore actions appear only for adjusted rows; the removed `apply-unified` event has no replacement.

- [x] **Step 1: Write the failing compact-layout and action tests**

Replace the old explicit/unified-control test with assertions equivalent to:

```ts
await expect(page.getByTestId('cycle-schedule-column-header')).toBeVisible();
await expect(page.getByTestId('cycle-apply-unified')).toHaveCount(0);
await expect(page.getByTestId('cycle-preserve-exceptions')).toHaveCount(0);
await expect(firstRow.getByTestId('cycle-special-month-button')).toHaveCount(0);
await expect(firstRow.getByTestId('cycle-restore-one')).toHaveCount(0);

await firstRow.getByTestId('manager-due-at').locator('input').fill('2027-01-08 18:00');
await firstRow.getByTestId('manager-due-at').locator('input').press('Tab');
await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveText('已调整');
await expect(firstRow.getByTestId('cycle-restore-one')).toHaveText('恢复本月默认');
await expect(page.getByTestId('cycle-restore-all')).toHaveText('全部恢复默认');
```

- [x] **Step 2: Run the editor case and confirm RED**

Run: `npx playwright test e2e/specs/25-cycle-scoring-plan.spec.ts --config playwright.contract.config.ts --grep "compact scoring schedule"`

Expected: the compact column header is absent and the redundant controls remain visible.

- [x] **Step 3: Implement the compact responsive editor**

Use one desktop grid header with columns `月份 / 自评开放时间 / 员工计划完成时间 / 主管计划完成时间 / 操作`. Render every schedule as one grid row; show mobile-only field labels below `768px`. Change the exception badge to `已调整`, show `恢复本月默认` only for adjusted rows, and show `全部恢复默认` only when at least one row is adjusted. Remove `preserveExceptions`, `apply-unified`, the special-month button, their harness output, and the unused parent handler.

- [x] **Step 4: Run the editor case and confirm GREEN**

Run the same Playwright command from Step 2 and require it to pass.

- [x] **Step 5: Commit the compact scoring editor**

Run `git add web/src/views/admin/components/CycleMonthlyScheduleEditor.vue web/src/views/admin/CycleManageView.vue web/e2e/fixtures/CycleScoringPlanHarness.vue web/e2e/specs/25-cycle-scoring-plan.spec.ts` followed by `git commit -m "fix(cycles): compact scoring plan editor"`.

### Task 3: Focused Regression, Build, and Acceptance Record

**Files:**
- Modify: `docs/acceptance/2026-08-29-production-acceptance-issues.md`

**Interfaces:**
- Consumes: completed API/Web behavior from Tasks 1 and 2.
- Produces: a truthful acceptance record with verification evidence and production status `未发布`.

- [x] **Step 1: Run focused API and Web regression**

Run:

```powershell
Set-Location api
npm test -- --runInBand src/cycles/cycles.service.spec.ts src/cycles/launch.service.spec.ts
Set-Location ..\web
npx playwright test e2e/specs/25-cycle-scoring-plan.spec.ts e2e/specs/14-cycle-management-compact.spec.ts --config playwright.contract.config.ts
```

Expected: zero failed Jest and Playwright cases.

- [x] **Step 2: Build both affected applications**

Run `npm run build` in `api` and `web`.

Expected: both commands exit 0.

- [x] **Step 3: Inspect the actual diff and run whitespace validation**

Run `git diff --check` and `git diff --stat`, then inspect `git diff` for unrelated changes and reviewer-history regressions.

- [x] **Step 4: Update the acceptance record**

Change ACC-001 status to `已完成开发，待用户验收，未发布`, list the exact focused test/build evidence, and keep production publication explicitly pending.

- [x] **Step 5: Commit verification records**

Run `git add docs/acceptance/2026-08-29-production-acceptance-issues.md docs/superpowers/plans/2026-08-29-cycle-creation-acceptance-round.md` followed by `git commit -m "docs(cycles): record ACC-001 verification"`.
