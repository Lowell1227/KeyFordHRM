# 目标跟进与周期评分闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让绩效周期开放后的范围内员工能够识别并选择真实周期，持续跟进目标，完成月度或整周期复盘，并由直属上级评分后汇总进入既有复核流程。

**Architecture:** `AssessmentTask` 继续作为员工与周期的父任务，`AssessmentPeriod` 作为月度或整周期评分子任务。周期选择由新的任务快照上下文接口提供，不再依赖周期名称正则；期间复盘通过乐观锁、幂等修订和事务写入形成正式结果，最后由独立汇总服务推进父任务。Vue 页面复用现有绩效工作台、目标详情抽屉和期间复盘组件，增加周期上下文、状态化空页面和主管评分工作区。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL、Jest、Vue 3、TypeScript、Element Plus、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-30-goal-tracking-cycle-closure-design.md`

## Global Constraints

- 参与资格只读取周期开放时冻结的 `AssessmentTask`，不重新计算组织范围。
- `workflowVersion = 1` 继续使用原任务级评分，不强制生成或接管期间评分。
- `scoringFrequency = monthly` 使用多个自然月期次；`scoringFrequency = cycle` 使用一个整周期期次。
- 已豁免任务可见但不可制定、跟进或评分，且必须显示豁免原因。
- HR、系统管理员和 `canViewAll` 只读期间评分，不能代替直属上级提交。
- 主管分与自评分差 10 分及以上、主管分低于 60 分只提醒，不阻断提交。
- 月度周期只平均正式完成的有效期次；`no_result` 不计零，未完成期次不提前生成周期分。
- PC 1440px 和手机 390px 均不能横向溢出，手机主操作触点不小于 44px。
- API 或版本冲突不能伪装成“暂无周期”，前端必须保留上下文并提供重试。
- 未经本次明确发布步骤，不单独替换生产组件；API、Web 和迁移必须保留匹配回滚点。

---

### Task 1: 正式复盘进展与员工修订建立可追溯关系

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260830090000_link_progress_to_period_revision/migration.sql`
- Modify: `api/src/tasks/indicator-schema.contract.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`

**Interfaces:**
- Produces: `IndicatorProgressUpdate.periodId: string | null`
- Produces: `IndicatorProgressUpdate.periodReviewRevisionId: string | null`
- Produces: unique relation `(indicatorInstanceId, periodReviewRevisionId)` for formal employee submissions.

- [ ] **Step 1: Write the failing schema and transaction tests**

```ts
expect(schema).toMatch(/periodId\s+String\?/);
expect(schema).toMatch(/periodReviewRevisionId\s+String\?/);
expect(schema).toContain('@@unique([indicatorInstanceId, periodReviewRevisionId])');

expect(tx.indicatorProgressUpdate.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    periodId: period.id,
    periodReviewRevisionId: 'employee-revision-1',
  }),
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- indicator-schema.contract.spec.ts period-reviews.service.spec.ts --runInBand`

Expected: FAIL because the schema fields and formal-revision linkage do not exist.

- [ ] **Step 3: Add nullable relations and a non-destructive migration**

```prisma
periodId               String? @map("period_id") @db.Uuid
periodReviewRevisionId String? @map("period_review_revision_id") @db.Uuid
period                 AssessmentPeriod? @relation(fields: [periodId], references: [id], onDelete: SetNull)
periodReviewRevision   AssessmentPeriodReviewRevision? @relation(fields: [periodReviewRevisionId], references: [id], onDelete: SetNull)

@@unique([indicatorInstanceId, periodReviewRevisionId])
@@index([periodId, createdAt(sort: Desc)])
```

Migration SQL adds the two nullable columns, indexes and `ON DELETE SET NULL` foreign keys without updating historical rows.

- [ ] **Step 4: Create the employee revision before progress rows and link every formal progress row**

In `submitEmployeeReview`, create the employee revision inside the existing transaction, keep its returned `id`, then create each `IndicatorProgressUpdate` with the current period and revision IDs. The existing idempotency lookup remains the first operation so repeated requests return before writing.

- [ ] **Step 5: Generate Prisma types and run the focused tests**

Run: `npm run prisma:generate && npm test -- indicator-schema.contract.spec.ts period-reviews.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations/20260830090000_link_progress_to_period_revision/migration.sql api/src/tasks/indicator-schema.contract.spec.ts api/src/period-reviews/period-reviews.service.spec.ts api/src/period-reviews/period-reviews.service.ts
git commit -m "feat(performance): link period reviews to progress history"
```

### Task 2: 提供任务快照驱动的目标跟进周期上下文

**Files:**
- Create: `api/src/cycles/dto/tracking-context-query.dto.ts`
- Create: `api/src/cycles/tracking-context.types.ts`
- Modify: `api/src/cycles/cycles.controller.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.controller.spec.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`

**Interfaces:**
- Produces: `CyclesService.findTrackingContexts(ownerId: string, viewer: AuthUser): Promise<PerformanceCycleContext[]>`
- Produces: `GET /cycles/tracking-contexts?ownerId=<uuid>`.
- Produces: `findMine()` cycles with `personalTask` separate from team-visible tasks.

- [ ] **Step 1: Write failing service tests for self, direct-manager viewing, exemptions and duplicate names**

```ts
await expect(service.findTrackingContexts('unrelated-id', viewer))
  .rejects.toMatchObject({ status: 403 });
expect(result.map((item) => item.task.participantDisposition))
  .toEqual(['active', 'cycle_exempt']);
expect(result[0].periods[0]).toMatchObject({ periodType: 'month', status: 'self_eval' });
```

Also assert the query has `status: { notIn: ['draft', 'scheduled', 'launch_blocked'] }` and `tasks: { some: { employeeId: ownerId } }`, without name or cycle-type filters.

- [ ] **Step 2: Run the cycle tests and verify they fail**

Run: `npm test -- cycles.controller.spec.ts cycles.service.spec.ts --runInBand`

Expected: FAIL because the route and method do not exist.

- [ ] **Step 3: Define the DTO and response contract**

```ts
export class TrackingContextQueryDto {
  @IsUUID('4') ownerId!: string;
}

export interface PerformanceCycleContext {
  id: string;
  name: string;
  type: CycleType;
  startDate: Date;
  endDate: Date;
  openedAt: Date;
  scoringFrequency: ScoringFrequency;
  task: { id: string; status: TaskStatus; isExempt: boolean; exemptReason: string | null; participantDisposition: ParticipantDisposition };
  periods: PerformancePeriodContext[];
}
```

- [ ] **Step 4: Implement owner authorization and the snapshot query**

Allow `ownerId === viewer.id`; otherwise load the viewer's `directManagerId` and allow only that owner. Query the owner's task, include ordered periods, and sort contexts by actionable/current/exempt/ended/future priority followed by dates, `openedAt` and ID.

- [ ] **Step 5: Separate the viewer's personal task in `findMine()`**

Return `personalTask` from `employeeId = viewer.id`; keep team visibility in a separate `visibleTasks` summary. Do not use `take: 1` across mixed employee/manager responsibilities.

- [ ] **Step 6: Add the controller route before `@Get(':id')` and rerun tests**

```ts
@Get('tracking-contexts')
findTrackingContexts(@Query() query: TrackingContextQueryDto, @CurrentUser() viewer: AuthUser) {
  return this.cyclesService.findTrackingContexts(query.ownerId, viewer);
}
```

Run: `npm test -- cycles.controller.spec.ts cycles.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/cycles
git commit -m "feat(cycles): expose employee tracking contexts"
```

### Task 3: 打通主管期间草稿、退回和正式评分

**Files:**
- Create: `api/src/period-reviews/dto/save-manager-period-review-draft.dto.ts`
- Create: `api/src/period-reviews/dto/return-manager-period-review.dto.ts`
- Create: `api/src/period-reviews/dto/submit-manager-period-review.dto.ts`
- Create: `api/src/period-reviews/period-review-labels.ts`
- Modify: `api/src/period-reviews/period-reviews.controller.ts`
- Modify: `api/src/period-reviews/period-review.types.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/scheduler/scheduler.service.ts`
- Modify: `api/src/scheduler/scheduler.service.spec.ts`

**Interfaces:**
- Produces: `saveManagerDraft(periodId, dto, viewer)`.
- Produces: `returnManagerReview(periodId, dto, viewer)`.
- Produces: `submitManagerReview(periodId, dto, viewer)`.
- Produces routes `PUT manager-draft`, `POST manager-return`, `POST manager-submit`.

- [ ] **Step 1: Write failing tests for exact manager permissions, due-date fallback, validation, return and idempotency**

```ts
await expect(service.submitManagerReview(period.id, dto, hrViewer))
  .rejects.toMatchObject({ status: 403 });
expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'self_eval', employeeSubmittedAt: null }),
}));
expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ stage: 'manager' }),
}));
```

Cover employee-submitted scoring, employee-unsubmitted scoring after `selfEvalDueAt`, pre-due rejection, missing manager score, score outside 0–100, stale `draftVersion`, repeated idempotency key and completed lock.

Add a scheduler assertion that a due `self_eval` period moves once to `manager_scoring` without inventing `employeeSubmittedAt`, while the employee remains able to补交 until manager formal submission.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- period-reviews.service.spec.ts --runInBand`

Expected: FAIL because manager actions do not exist.

- [ ] **Step 3: Implement validated DTOs**

```ts
export class ManagerPeriodReviewItemDto {
  @IsUUID('4') indicatorVersionItemId!: string;
  @IsNumber() @Min(0) @Max(100) managerScore!: number;
  @IsOptional() @IsString() @MaxLength(3000) managerComment?: string | null;
}
```

Every action includes `expectedVersion`; return and submit also include a UUID `idempotencyKey`.

- [ ] **Step 4: Implement manager edit guards and draft/return transactions**

Require `period.managerId === viewer.id`. Draft and submit are allowed only in `manager_scoring` when the employee has submitted or `now >= selfEvalDueAt`. Return increments `draftVersion`, clears `employeeSubmittedAt`, changes status to `self_eval`, preserves formal revisions, and writes flow/audit records.

- [ ] **Step 5: Advance overdue employee periods idempotently**

Extend the existing scheduler tick with a conditional `updateMany` from `self_eval` to `manager_scoring` where `selfEvalDueAt <= now`, `managerSubmittedAt = null`, and the status is still `self_eval`. Do not set `employeeSubmittedAt`; the existing employee edit guard continues to allow补交 until manager submission.

- [ ] **Step 6: Implement manager formal submit transaction and generic labels**

Upsert all manager scores/comments, compute the weighted period score from the frozen version items, create `stage = manager` revision, set `managerSubmittedAt`, `lockedAt`, `managerScoreTotal`, `status = completed`, then invoke the aggregation service from Task 4. Use `periodType` to produce `YYYY年M月复盘与评分` or `整周期复盘与评分`; remove hard-coded “月度复盘” from errors, audit and notifications.

- [ ] **Step 7: Add routes and pass focused tests**

Run: `npm test -- period-reviews.service.spec.ts scheduler.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api/src/period-reviews api/src/scheduler/scheduler.service.ts api/src/scheduler/scheduler.service.spec.ts
git commit -m "feat(performance): complete manager period scoring"
```

### Task 4: 汇总有效期次并推进父任务到既有复核流程

**Files:**
- Create: `api/src/period-reviews/period-aggregation.service.ts`
- Create: `api/src/period-reviews/period-aggregation.service.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.module.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/tasks/tasks.module.ts`

**Interfaces:**
- Produces: `PeriodAggregationService.refreshTask(taskId: string, tx: Prisma.TransactionClient, actorId: string): Promise<PeriodAggregationResult>`.
- Consumes: existing `ScoringService.calcRawGrade()` and `FlowService.transitionTx()`.

- [ ] **Step 1: Write failing aggregation tests**

```ts
expect(result).toMatchObject({ complete: true, score: 85, targetStatus: 'dept_review' });
expect(tx.gradeResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
  create: expect.objectContaining({ calculatedScore: 85 }),
}));
```

Cover monthly equal-weight mean, `no_result` exclusion, missing period leaves parent in `manager_scoring`, single cycle-period score, at-least-one-valid requirement, direct-manager-is-dept-head route to `hr_calibration`, and repeated refresh not advancing again.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- period-aggregation.service.spec.ts --runInBand`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement deterministic aggregation**

```ts
const valid = periods.filter((p) => p.status === 'completed' && p.managerScoreTotal != null);
const unfinished = periods.some((p) => !['completed', 'no_result'].includes(p.status));
if (unfinished || valid.length === 0) return { complete: false, score: null, targetStatus: null };
const score = Number((valid.reduce((sum, p) => sum + p.managerScoreTotal!.toNumber(), 0) / valid.length).toFixed(2));
```

Upsert `GradeResult`, clear stale calibration fields, use the existing grade mapping, and transition only while the parent is still `manager_scoring`.

- [ ] **Step 4: Wire the service into the manager-submit transaction and pass tests**

Run: `npm test -- period-aggregation.service.spec.ts period-reviews.service.spec.ts tasks.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/period-reviews api/src/tasks/tasks.module.ts
git commit -m "feat(performance): aggregate period scores into task results"
```

### Task 5: Web 周期上下文、唯一标签和状态化空页面

**Files:**
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/api/cycles.api.ts`
- Modify: `web/src/views/objectives/goal-tracking.ts`
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`
- Modify: `web/e2e/specs/13-cycle-first-performance-context.spec.ts`

**Interfaces:**
- Produces: `PerformanceCycleContext` Web type.
- Produces: `cyclesApi.findTrackingContexts(ownerId)`.
- Produces: `formatTrackingContextLabel(context, compact)`.

- [ ] **Step 1: Add failing contract tests for all formal cycle types and duplicate names**

Assert that the model source no longer contains `parseGoalTrackingQuarter` or a quarterly name regex, and that mocked monthly, quarterly, semiannual, annual and custom contexts are all rendered. Assert duplicate names include dates, scoring mode and participation status.

- [ ] **Step 2: Run and verify failure**

Run: `npx playwright test --config playwright.contract.config.ts e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts`

Expected: FAIL because the page still calls `/cycles` and filters quarterly names.

- [ ] **Step 3: Replace cycle-list loading with owner-specific contexts**

`selectPerson()` must clear the previous contexts, call `findTrackingContexts(id)`, select the route cycle only if present, then load tracking. Keep request serials so a slower prior person request cannot overwrite the latest selection.

- [ ] **Step 4: Implement unique labels and explicit empty states**

```ts
return `${ctx.name}｜${dateRange}｜${ctx.scoringFrequency === 'monthly' ? '每月复盘' : '整周期评分'}｜${ctx.task.isExempt ? '已豁免' : '正常参与'}｜开放 ${openedAt}`;
```

Render distinct states for no opened task, exempt with reason, `indicator_drafting`, `indicator_reviewing`, `indicator_confirming`, and missing formal version. Cycle/API errors retain the person context and show a local retry button.

- [ ] **Step 5: Pass focused Web contracts and type-check**

Run: `npm run type-check && npx playwright test --config playwright.contract.config.ts e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/types/api.types.ts web/src/api/cycles.api.ts web/src/views/objectives web/e2e/specs/12-goal-tracking-model.spec.ts web/e2e/specs/13-cycle-first-performance-context.spec.ts
git commit -m "feat(web): drive goal tracking from task cycle contexts"
```

### Task 6: 实现视觉稿中的 PC 与手机目标跟进体验

**Files:**
- Create: `web/src/views/objectives/GoalTrackingSummaryStrip.vue`
- Create: `web/src/views/objectives/GoalTrackingPeriodTabs.vue`
- Modify: `web/src/views/objectives/GoalTrackingView.vue`
- Modify: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Modify: `web/src/views/objectives/GoalTrackingDetailDrawer.vue`
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`
- Create: `web/e2e/specs/29-goal-tracking-responsive.spec.ts`

**Interfaces:**
- Produces summary inputs `{ progress: number; totalWeight: number; pendingReview: AssessmentPeriodSummary | null }`.
- Produces events `openReview(periodId)` and `openIndicator(indicatorId)`.

- [ ] **Step 1: Write failing 1440px and 390px layout tests**

```ts
await page.setViewportSize({ width: 390, height: 844 });
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
await expect(page.getByRole('button', { name: '填写本月复盘' })).toBeVisible();
await expect(page.getByTestId('goal-tracking-summary')).toContainText('本期进度');
```

- [ ] **Step 2: Run and verify failure**

Run: `npx playwright test --config playwright.contract.config.ts e2e/specs/29-goal-tracking-responsive.spec.ts`

Expected: FAIL because summary, period tabs and mobile sticky actions do not exist.

- [ ] **Step 3: Build the approved hierarchy**

Desktop: person/cycle header, period tabs, summary strip, objective cards and an adjacent progress-history surface. Mobile: vertical person/cycle header, scrollable period tabs, summary, single-column objective cards and fixed bottom actions. Keep existing detail drawer for full edit/history; the panel preview is read-only.

- [ ] **Step 4: Wire navigation to period review and indicator update**

`填写本月复盘` routes to the task detail using `taskId`, `stage=self-eval` and `periodId`. `更新进展` opens the existing indicator drawer. Exempt and pre-confirmation states hide both actions.

- [ ] **Step 5: Pass layout and model tests**

Run: `npm run type-check && npx playwright test --config playwright.contract.config.ts e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/29-goal-tracking-responsive.spec.ts`

Expected: PASS at 1440px and 390px with no horizontal overflow.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/objectives web/e2e/specs/12-goal-tracking-model.spec.ts web/e2e/specs/29-goal-tracking-responsive.spec.ts
git commit -m "feat(web): redesign responsive goal tracking workspace"
```

### Task 7: 员工通用期次文案与主管评分工作区

**Files:**
- Create: `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`
- Create: `web/src/views/task/components/period-review-labels.ts`
- Modify: `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`
- Modify: `web/src/views/task/components/MonthlyReviewReferencePanel.vue`
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/src/api/period-reviews.api.ts`
- Modify: `web/src/types/api.types.ts`
- Create: `web/e2e/specs/30-period-review-closure.spec.ts`

**Interfaces:**
- Produces: manager API bodies `SaveManagerPeriodReviewDraftBody`, `ReturnManagerPeriodReviewBody`, `SubmitManagerPeriodReviewBody`.
- Produces: `periodReviewTitle(periodType, periodKey)`.

- [ ] **Step 1: Write failing employee/manager and responsive tests**

Cover `month` title `2026年8月复盘与评分`, `cycle` title `整周期复盘与评分`, manager-only controls, HR read-only view, warning-only score differences, return, submit, stale 409, and 390px sticky actions.

- [ ] **Step 2: Run and verify failure**

Run: `npx playwright test --config playwright.contract.config.ts e2e/specs/30-period-review-closure.spec.ts`

Expected: FAIL because manager endpoints and workspace do not exist and copy is monthly-only.

- [ ] **Step 3: Add Web API methods and shared period labels**

```ts
saveManagerDraft(id, body) { return http.put(`/assessment-periods/${id}/manager-draft`, body); }
returnManagerReview(id, body) { return http.post(`/assessment-periods/${id}/manager-return`, body); }
submitManagerReview(id, body) { return http.post(`/assessment-periods/${id}/manager-submit`, body); }
```

- [ ] **Step 4: Generalize the employee workspace**

Replace visible “本月/月度” copy with labels based on `periodType`; month keeps month-specific prompts, cycle uses “本周期”. Preserve bottom-of-field validation and sticky mobile actions.

- [ ] **Step 5: Build manager scoring cards**

Each card shows frozen goal, employee material, self-score, manager score and optional comment. Differences of at least 10 and scores below 60 render amber guidance only. The action bar provides `保存草稿`, `退回员工`, and `提交评分`; only the exact period manager can use it.

- [ ] **Step 6: Select the requested or actionable period in `TaskDetailView`**

Respect `route.query.periodId`; otherwise choose the earliest actionable employee period for self-eval and earliest actionable manager period for manager-eval. Do not label cycle periods as monthly.

- [ ] **Step 7: Pass focused Web tests**

Run: `npm run type-check && npx playwright test --config playwright.contract.config.ts e2e/specs/30-period-review-closure.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/views/task web/src/api/period-reviews.api.ts web/src/types/api.types.ts web/e2e/specs/30-period-review-closure.spec.ts
git commit -m "feat(web): add employee and manager period review workspaces"
```

### Task 8: 回归、真实角色验收、合入 main、远端同步与生产发布

**Files:**
- Modify only if assertions expose a product defect: focused files from Tasks 1–7.
- Record evidence in the final delivery report; do not commit secrets or local auth-state files.

**Interfaces:**
- Consumes all prior tasks.
- Produces a clean, pushed `main` and matching production API/Web/migration revision.

- [ ] **Step 1: Run the focused API suite and builds**

Run from `api`:

```bash
npm test -- cycles.controller.spec.ts cycles.service.spec.ts indicator-schema.contract.spec.ts period-reviews.service.spec.ts period-aggregation.service.spec.ts tasks.service.spec.ts objectives.service.spec.ts scheduler.service.spec.ts --runInBand
npm run build
```

Expected: all focused tests and build PASS.

- [ ] **Step 2: Run focused Web contracts, type-check and build**

Run from `web`:

```bash
npm run type-check
npx playwright test --config playwright.contract.config.ts e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/13-cycle-first-performance-context.spec.ts e2e/specs/29-goal-tracking-responsive.spec.ts e2e/specs/30-period-review-closure.spec.ts
npm run build
```

Expected: all focused contracts and build PASS.

- [ ] **Step 3: Run controlled real-role acceptance**

Use controlled employee, exact manager and HR accounts to verify monthly mode, cycle mode, duplicate-name active/exempt contexts, unauthorized direct URL, employee-unsubmitted manager scoring after due, repeat idempotency and stale-version conflict. Verify both 1440px and 390px without storing credentials in Git.

- [ ] **Step 4: Rebase the delivery commits onto the newest local and remote main**

Fetch/prune, inspect both main worktree and remote heads, preserve unrelated dirty files, then linearize the feature commits onto the newest `origin/main`. Resolve only overlapping feature files and rerun Steps 1–2 after any resolution.

- [ ] **Step 5: Fast-forward main and push**

Verify `git merge-base --is-ancestor origin/main main`, feature work is fully reachable from main, no unmerged functional branch contains newer commits, and `git diff origin/main..main` contains only this delivery plus already-approved main changes. Push `main` normally; never force-push.

- [ ] **Step 6: Create rollback evidence and deploy migration, API and Web as one matched release**

Record current production Git heads, image IDs, Compose project/workdirs and database migration state. Build candidate images from the newest main, run candidate smoke checks, apply `prisma migrate deploy`, then replace API and Web with the repository production Compose configuration.

- [ ] **Step 7: Verify live behavior and rollback readiness**

Check local and external home routes, API health, container image IDs, applied migration, target-tracking period selection, employee review, manager scoring and downstream task state. If any material check fails, restore the recorded matching API/Web image pair and database-compatible state before reporting.

- [ ] **Step 8: Final repository audit**

Confirm local `main`, `origin/main` and deployed revision match; `git status` has no delivery residue; any remaining branches are either merged or explicitly unrelated. Report commit IDs, test counts, live verification and remaining business risks.
