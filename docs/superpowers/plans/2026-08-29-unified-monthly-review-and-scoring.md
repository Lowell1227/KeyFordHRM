# 月度复盘与评分一体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在复用已上线评分频率和月度排期底座的前提下，把强制月度跟进与月度正式评分合并为一项可在 PC 和手机端快速完成的月度复盘任务，并形成可追溯的员工自评、主管评分和周期汇总结果。

**Architecture:** 保留 `AssessmentTask` 作为员工与周期的总任务、`AssessmentPeriod` 作为月度或整周期期次，新增期次指标工作记录和正式提交修订。新建 `period-reviews` 业务模块负责期次详情、草稿、员工提交、主管评分、退回、幂等和权限；现有 `TasksService` 只负责总任务与指标确认，`SchedulerService` 负责按期次时间开放节点。Web 使用同一 API 数据模型，PC 渲染表格、手机渲染逐项卡片。

**Tech Stack:** NestJS 10、Prisma 5/PostgreSQL、Jest、Vue 3、TypeScript、Element Plus、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-29-unified-monthly-review-and-scoring-design.md`

## Global Constraints

- 复用已上线的 `workflowVersion = 2`、`scoringFrequency`、`CyclePeriodSchedule`、`AssessmentPeriod` 和 2027 法定工作日日历，不重复实现阶段 1。
- `workflowVersion = 1` 周期继续走现有周期级自评与主管评分接口，不能改变历史行为。
- 月度周期固定按月复盘，自定义周期固定按整个周期评分；季度、半年度和年度默认按月且允许关闭。
- 新页面只显示“每月复盘并评分”一个配置；`monthlyFollowUpRequired` 仅作兼容字段并由 `scoringFrequency` 派生。
- 员工必填完成度、进展状态和自评分；实际完成值、说明和附件选填。
- 主管每项评分必填，主管说明始终选填；分差达到 10 分或主管分低于 60 分只提醒、不拦截。
- 员工提交和主管提交必须事务化、幂等且保留正式修订，草稿不能写正式进展历史。
- PC 使用“主工作区 + 参考信息”双栏和单目标紧凑卡片，手机使用单栏卡片与底部固定操作栏；两端共用服务端草稿。
- 直属上级只取 `User.directManagerId` 已固化到期次的 `managerId`，不读取花名册或钉钉组织关系。
- 完整闭环通过 API、Prisma、类型检查和 PC/手机 Playwright 验收前，不发布生产。
- 生产发布必须再次获得用户明确指令，并包含数据库备份、镜像回滚标记和真实角色验收。

---

## File Structure

### Database and backend domain

- Modify `api/prisma/schema.prisma`: 为 `AssessmentPeriod` 增加期次时间、提交时间、总分和草稿版本；新增期次指标工作记录和正式修订模型。
- Create `api/prisma/migrations/20260829140000_add_period_review_execution/migration.sql`: 新表、索引、外键及既有期次时间回填。
- Modify `api/src/cycles/launch.service.ts`: 发起时把周期排期的开放与截止时间复制到员工期次。
- Create `api/src/tasks/indicator-version.service.ts`: 目标确认时激活 V1 指标版本、复制版本项并绑定全部未开放期次。
- Create `api/src/period-reviews/period-reviews.module.ts`: 期次复盘模块装配。
- Create `api/src/period-reviews/period-reviews.controller.ts`: 期次详情、草稿、提交和退回接口。
- Create `api/src/period-reviews/period-reviews.service.ts`: 权限、状态、乐观锁、事务、评分和周期汇总。
- Create `api/src/period-reviews/period-review.types.ts`: API 返回类型和内部期次上下文。
- Create `api/src/period-reviews/dto/*.dto.ts`: 员工和主管草稿、正式提交、退回请求校验。
- Modify `api/src/tasks/scoring.service.ts`: 提取可复用于期次版本项的纯评分函数。
- Modify `api/src/scheduler/scheduler.service.ts`: 按期次开放员工复盘、到期开放主管评分和发送单一待办。
- Modify `api/src/tasks/tasks.service.ts`: 指标确认接入 V1 激活，并在任务详情返回期次摘要。
- Modify `api/src/tasks/team-tasks.service.ts`: 团队待办使用当前期次动作和截止时间。

### Web

- Modify `web/src/views/admin/components/CycleScoringSettings.vue`: 两个评分频率按钮改为一个“每月复盘并评分”开关。
- Modify `web/src/views/admin/CycleManageView.vue`: 删除独立月度跟进表单项并派生兼容字段。
- Modify `web/src/views/admin/components/CycleWorkspaceShell.vue`: 周期摘要统一显示月度复盘模式。
- Create `web/src/api/period-reviews.api.ts`: 期次复盘 API 客户端。
- Modify `web/src/types/api.types.ts`: 期次摘要、详情、草稿和提交请求类型。
- Modify `web/src/types/enums.ts`: 期次状态与月度动作联合类型。
- Create `web/src/views/task/composables/use-period-review-draft.ts`: 自动保存、防抖、冲突和未同步状态。
- Create `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`: PC 表格、手机卡片员工复盘。
- Create `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`: PC 表格、手机卡片主管评分。
- Modify `web/src/views/task/TaskDetailView.vue`: v2 期次员工入口与月份选择器。
- Modify `web/src/views/task/TaskListView.vue`: 团队期次主管入口、提交并处理下一人。

### Tests

- Modify `api/src/cycles/cycles.service.spec.ts` and `web/e2e/specs/25-cycle-scoring-plan.spec.ts`: 单开关与旧字段兼容。
- Create `api/src/tasks/indicator-version.service.spec.ts`: V1 激活与期次绑定。
- Create `api/src/period-reviews/period-reviews.service.spec.ts`: 草稿、提交、退回、并发、幂等和汇总。
- Modify `api/src/scheduler/scheduler.service.spec.ts`: 期次开放与逾期流程。
- Create `api/test/suites/13-performance-workflow-v2-monthly-review.e2e-spec.ts`: 三个月完整 API 闭环。
- Create `web/e2e/specs/28-monthly-review-responsive.spec.ts`: PC 与手机员工/主管交互。

---

### Task 1: Replace Two Cycle Controls With One Monthly Review Switch

**Files:**
- Modify: `api/src/cycles/cycles.service.ts:55-110, 250-345`
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `web/src/views/admin/components/CycleScoringSettings.vue`
- Modify: `web/src/views/admin/CycleManageView.vue:1108-1142, 1850-1925`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue:68-150`
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`

**Interfaces:**
- Consumes: existing `ScoringFrequency = 'monthly' | 'cycle'` and `normalizeScoringFrequency()`.
- Produces: a single UI switch whose value maps to `scoringFrequency`; v2 `monthlyFollowUpRequired` is always `scoringFrequency === 'monthly'`.

- [ ] **Step 1: Add failing API tests for the derived compatibility flag**

Add cases to `cycles.service.spec.ts`:

```ts
it('derives the v2 compatibility follow-up flag from monthly scoring', async () => {
  scheduleService.normalizeAndValidate.mockReturnValue(monthlyPlan);
  await service.create({ ...validDto, workflowVersion: 2, scoringFrequency: 'monthly', monthlyFollowUpRequired: false }, editor);
  expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ scoringFrequency: 'monthly', monthlyFollowUpRequired: true }),
  }));
});

it('does not let the legacy follow-up flag turn cycle scoring into monthly scoring', async () => {
  scheduleService.normalizeAndValidate.mockReturnValue(cyclePlan);
  await service.create({ ...validDto, workflowVersion: 2, scoringFrequency: 'cycle', monthlyFollowUpRequired: true }, editor);
  expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ scoringFrequency: 'cycle', monthlyFollowUpRequired: false }),
  }));
});

it('preserves the independent historical flags after a cycle has left draft', async () => {
  prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle({
    status: 'approved', workflowVersion: 2, scoringFrequency: 'cycle', monthlyFollowUpRequired: true,
  }));
  await service.update('cycle-1', { name: '只改名称' }, editor);
  expect(prisma.assessmentCycle.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.not.objectContaining({ monthlyFollowUpRequired: expect.anything() }),
  }));
});
```

- [ ] **Step 2: Run the focused API spec and verify the old independent flag fails**

Run:

```powershell
cd api
npm test -- --runInBand src/cycles/cycles.service.spec.ts
```

Expected: the two new expectations fail because `monthlyFollowUpRequired` still follows the request body.

- [ ] **Step 3: Derive the flag in create and update paths**

Add a private helper in `CyclesService` and use it in both `create()` and `update()`:

```ts
private monthlyReviewEnabled(type: CycleType, frequency: ScoringFrequency): boolean {
  if (type === CycleType.monthly) return true;
  if (type === CycleType.custom || type === CycleType.probation) return false;
  return frequency === ScoringFrequency.monthly;
}

const nextMonthlyFollowUpRequired = workflowVersion === 2
  ? this.monthlyReviewEnabled(nextType, nextScoringFrequency)
  : dto.monthlyFollowUpRequired ?? cycle.monthlyFollowUpRequired;
```

Keep `monthlyFollowUpRequired` in DTOs for older clients; do not use it as a second v2 decision. Apply the derivation only on create and editable draft updates. If a cycle is approved, active or later, preserve both persisted fields exactly and continue rejecting scoring-plan changes through the existing lifecycle guard.

- [ ] **Step 4: Replace the frequency radio group and remove the follow-up form row**

Update `CycleScoringSettings.vue` to emit frequency from one switch:

```vue
<el-switch
  data-testid="cycle-monthly-review-switch"
  :model-value="scoringFrequency === 'monthly'"
  active-text="每月复盘并评分"
  inactive-text="周期结束统一评分"
  :disabled="!canChooseFrequency"
  @change="emit('update:scoringFrequency', $event ? 'monthly' : 'cycle')"
/>
```

Remove the `label="月度跟进"` form item from `CycleManageView.vue`. In `buildCreateBody()` set:

```ts
body.monthlyFollowUpRequired = body.scoringFrequency === 'monthly';
```

Update cycle summaries to say `每月复盘并评分` or `周期结束统一评分`.

- [ ] **Step 5: Update the Playwright contract**

Replace separate-frequency/follow-up expectations with:

```ts
await page.getByTestId('cycle-monthly-review-switch').click();
await page.getByRole('button', { name: '下一步' }).click();
expect(createBodies.at(-1)).toMatchObject({
  scoringFrequency: 'cycle',
  monthlyFollowUpRequired: false,
});
await expect(page.getByText('月度跟进')).toHaveCount(0);
```

Also cover fixed monthly and fixed custom cycle behavior.

- [ ] **Step 6: Run focused verification**

Run:

```powershell
cd api
npm test -- --runInBand src/cycles/cycles.service.spec.ts
cd ..\web
npx playwright test --config playwright.contract.config.ts e2e/specs/25-cycle-scoring-plan.spec.ts
npm run type-check
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git add api/src/cycles web/src/views/admin web/e2e/specs/25-cycle-scoring-plan.spec.ts
git commit -m "feat(cycles): unify monthly review configuration"
```

---

### Task 2: Add Period Review Persistence and Copy Schedule Times at Launch

**Files:**
- Modify: `api/prisma/schema.prisma:127-142, 1037-1105`
- Create: `api/prisma/migrations/20260829140000_add_period_review_execution/migration.sql`
- Modify: `api/src/tasks/indicator-schema.contract.spec.ts`
- Modify: `api/src/cycles/launch.service.ts:549-562`
- Modify: `api/src/cycles/launch.service.spec.ts:800-875`

**Interfaces:**
- Consumes: `AssessmentPeriod`, `IndicatorVersionItem`, and launch `CyclePeriodSchedule` values from phase 1.
- Produces: `AssessmentPeriodIndicatorReview`, `AssessmentPeriodReviewRevision`, timing fields, totals, submission timestamps, and integer `draftVersion` for later services.

- [ ] **Step 1: Write failing schema and launch tests**

Add contract assertions:

```ts
expect(schema).toContain('model AssessmentPeriodIndicatorReview');
expect(schema).toContain('model AssessmentPeriodReviewRevision');
expect(schema).toContain('@@unique([periodId, indicatorVersionItemId])');
expect(schema).toContain('draftVersion');
expect(schema).toContain('selfEvalOpenAt');
```

Extend the v2 launch test:

```ts
expect(tx.assessmentPeriod.createMany).toHaveBeenCalledWith({
  data: expect.arrayContaining([
    expect.objectContaining({
      periodKey: '2027-01',
      selfEvalOpenAt: periodSchedules[0].selfEvalOpenAt,
      selfEvalDueAt: periodSchedules[0].selfEvalDueAt,
      managerDueAt: periodSchedules[0].managerDueAt,
    }),
  ]),
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
cd api
npm test -- --runInBand src/tasks/indicator-schema.contract.spec.ts src/cycles/launch.service.spec.ts
```

Expected: schema assertions and launch timing expectations fail.

- [ ] **Step 3: Add the Prisma models**

Add this enum and fields, preserving existing names:

```prisma
enum AssessmentPeriodRevisionStage {
  employee
  manager

  @@map("assessment_period_revision_stage")
}

model AssessmentPeriod {
  // existing identifiers and period boundary fields stay unchanged
  selfEvalOpenAt     DateTime  @map("self_eval_open_at") @db.Timestamptz(6)
  selfEvalDueAt      DateTime  @map("self_eval_due_at") @db.Timestamptz(6)
  managerDueAt       DateTime  @map("manager_due_at") @db.Timestamptz(6)
  employeeSubmittedAt DateTime? @map("employee_submitted_at") @db.Timestamptz(6)
  managerSubmittedAt DateTime? @map("manager_submitted_at") @db.Timestamptz(6)
  selfScoreTotal     Decimal?  @map("self_score_total") @db.Decimal(8, 2)
  managerScoreTotal  Decimal?  @map("manager_score_total") @db.Decimal(8, 2)
  summaryComment     String?   @map("summary_comment") @db.Text
  draftVersion       Int       @default(0) @map("draft_version")
  indicatorReviews   AssessmentPeriodIndicatorReview[]
  revisions          AssessmentPeriodReviewRevision[]
}

model AssessmentPeriodIndicatorReview {
  id                     String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  periodId               String   @map("period_id") @db.Uuid
  indicatorVersionItemId String   @map("indicator_version_item_id") @db.Uuid
  progress               Int?     @db.SmallInt
  healthStatus           IndicatorProgressHealth? @map("health_status")
  actualValueText        String?  @map("actual_value_text") @db.VarChar(200)
  employeeComment        String?  @map("employee_comment") @db.Text
  problemReason          String?  @map("problem_reason") @db.Text
  nextMonthPlan          String?  @map("next_month_plan") @db.Text
  supportNeeded          String?  @map("support_needed") @db.Text
  employeeAttachments    Json     @default("[]") @map("employee_attachments") @db.JsonB
  selfScore              Decimal? @map("self_score") @db.Decimal(6, 2)
  managerScore           Decimal? @map("manager_score") @db.Decimal(6, 2)
  managerComment         String?  @map("manager_comment") @db.Text
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  period              AssessmentPeriod   @relation(fields: [periodId], references: [id], onDelete: Cascade)
  indicatorVersionItem IndicatorVersionItem @relation(fields: [indicatorVersionItemId], references: [id], onDelete: Restrict)

  @@unique([periodId, indicatorVersionItemId])
  @@index([periodId])
  @@map("assessment_period_indicator_reviews")
}

model AssessmentPeriodReviewRevision {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  periodId       String   @map("period_id") @db.Uuid
  stage          AssessmentPeriodRevisionStage
  revision       Int
  snapshot       Json     @db.JsonB
  idempotencyKey String   @unique @map("idempotency_key") @db.VarChar(64)
  createdById    String   @map("created_by_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  period   AssessmentPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  createdBy User             @relation("PeriodReviewRevisionCreator", fields: [createdById], references: [id], onDelete: Restrict)

  @@unique([periodId, stage, revision])
  @@index([periodId, stage])
  @@map("assessment_period_review_revisions")
}
```

Add the corresponding back-relations to `User` and `IndicatorVersionItem`.

- [ ] **Step 4: Create the additive migration with safe timing backfill**

Generate a create-only migration, then ensure its timing section follows this order:

```sql
ALTER TABLE "assessment_periods"
  ADD COLUMN "self_eval_open_at" TIMESTAMPTZ(6),
  ADD COLUMN "self_eval_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "manager_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "employee_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "manager_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "self_score_total" DECIMAL(8,2),
  ADD COLUMN "manager_score_total" DECIMAL(8,2),
  ADD COLUMN "summary_comment" TEXT,
  ADD COLUMN "draft_version" INTEGER NOT NULL DEFAULT 0;

UPDATE "assessment_periods" ap
SET "self_eval_open_at" = cps."self_eval_open_at",
    "self_eval_due_at" = cps."self_eval_due_at",
    "manager_due_at" = cps."manager_due_at"
FROM "assessment_tasks" task
JOIN "cycle_period_schedules" cps
  ON cps."cycle_id" = task."cycle_id"
WHERE ap."task_id" = task."id"
  AND ap."period_key" = cps."period_key";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "assessment_periods"
    WHERE "self_eval_open_at" IS NULL OR "self_eval_due_at" IS NULL OR "manager_due_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'assessment period timing backfill incomplete';
  END IF;
END $$;

ALTER TABLE "assessment_periods"
  ALTER COLUMN "self_eval_open_at" SET NOT NULL,
  ALTER COLUMN "self_eval_due_at" SET NOT NULL,
  ALTER COLUMN "manager_due_at" SET NOT NULL;
```

The same migration creates the enum, two tables, unique indexes and restrictive foreign keys shown in the Prisma schema.

- [ ] **Step 5: Copy schedule timestamps during v2 launch**

Extend the existing `assessmentPeriod.createMany()` mapping:

```ts
selfEvalOpenAt: schedule.selfEvalOpenAt,
selfEvalDueAt: schedule.selfEvalDueAt,
managerDueAt: schedule.managerDueAt,
```

- [ ] **Step 6: Validate schema and tests**

```powershell
cd api
npx prisma format
npx prisma validate
npm run prisma:generate
npm test -- --runInBand src/tasks/indicator-schema.contract.spec.ts src/cycles/launch.service.spec.ts
```

Expected: Prisma validation and both specs pass.

- [ ] **Step 7: Commit**

```powershell
git add api/prisma api/src/tasks/indicator-schema.contract.spec.ts api/src/cycles/launch.service.ts api/src/cycles/launch.service.spec.ts
git commit -m "feat(performance): add period review persistence"
```

---

### Task 3: Activate the Confirmed V1 Indicator Version

**Files:**
- Create: `api/src/tasks/indicator-version.service.ts`
- Create: `api/src/tasks/indicator-version.service.spec.ts`
- Modify: `api/src/tasks/tasks.module.ts`
- Modify: `api/src/tasks/tasks.service.ts:429-502`
- Modify: `api/src/tasks/tasks.service.spec.ts:1390-1532`

**Interfaces:**
- Consumes: draft `IndicatorVersion` shell created at launch and confirmed `IndicatorInstance` rows.
- Produces: `IndicatorVersionService.activateConfirmedV1(tx, taskId, actorId): Promise<string>` returning the active version ID; every unopened period receives that ID.

- [ ] **Step 1: Write the failing service spec**

```ts
it('copies confirmed indicators into V1 and binds every unopened period', async () => {
  tx.indicatorVersion.findFirst.mockResolvedValue({ id: 'version-1', status: 'draft', version: 1 });
  tx.indicatorInstance.findMany.mockResolvedValue([makeIndicator({ id: 'indicator-1', name: '签约额' })]);

  await service.activateConfirmedV1(tx, 'task-1', 'employee-1');

  expect(tx.indicatorVersionItem.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
    indicatorVersionId: 'version-1',
    sourceInstanceId: 'indicator-1',
    name: '签约额',
  })] });
  expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith({
    where: { taskId: 'task-1', status: 'unopened' },
    data: { indicatorVersionId: 'version-1' },
  });
  expect(tx.indicatorVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'version-1', status: 'draft' },
    data: expect.objectContaining({ status: 'active' }),
  }));
});
```

- [ ] **Step 2: Run and verify the missing service failure**

```powershell
cd api
npm test -- --runInBand src/tasks/indicator-version.service.spec.ts
```

Expected: Jest fails because `IndicatorVersionService` does not exist.

- [ ] **Step 3: Implement the focused service**

Create this public contract:

```ts
@Injectable()
export class IndicatorVersionService {
  async activateConfirmedV1(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorId: string,
  ): Promise<string> {
    const version = await tx.indicatorVersion.findFirst({ where: { taskId, version: 1 } });
    if (!version) throw new ConflictException('未找到待激活的指标版本 V1');
    if (version.status === 'active') return version.id;

    const indicators = await tx.indicatorInstance.findMany({
      where: { taskId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (indicators.length === 0) throw new ConflictException('没有可冻结的考核指标');

    const claimed = await tx.indicatorVersion.updateMany({
      where: { id: version.id, status: 'draft' },
      data: { status: 'active', activatedAt: new Date(), createdById: actorId },
    });
    if (claimed.count !== 1) throw new ConflictException('指标版本状态已变化，请刷新后重试');

    await tx.indicatorVersionItem.createMany({
      data: indicators.map((item) => ({
        indicatorVersionId: version.id,
        sourceInstanceId: item.id,
        name: item.name,
        description: item.description,
        scoringStandard: item.scoringStandard,
        targetValue: item.targetValue,
        targetValueText: item.targetValueText,
        unit: item.unit,
        weight: item.weight,
        indicatorType: item.indicatorType,
        dimensionName: item.dimensionName,
        dimensionWeight: item.dimensionWeight,
        sortOrder: item.sortOrder,
      })),
    });
    await tx.assessmentPeriod.updateMany({
      where: { taskId, status: 'unopened' },
      data: { indicatorVersionId: version.id },
    });
    return version.id;
  }
}
```

- [ ] **Step 4: Call the service inside goal confirmation**

Register the provider in `TasksModule`. Inject it into `TasksService` and call it after the task claim but before `flowService.transitionTx()`:

```ts
if (task.cycle.workflowVersion === 2) {
  await this.indicatorVersionService.activateConfirmedV1(tx, task.id, viewer.id);
}
```

Ensure `getTaskOrThrow()` selects the cycle workflow version used by this branch.

- [ ] **Step 5: Run focused tests**

```powershell
cd api
npm test -- --runInBand src/tasks/indicator-version.service.spec.ts src/tasks/tasks.service.spec.ts
```

Expected: V1 activation, repeated confirmation protection and legacy confirmation tests pass.

- [ ] **Step 6: Commit**

```powershell
git add api/src/tasks
git commit -m "feat(performance): activate confirmed indicator version"
```

---

### Task 4: Build Period Review Detail and Employee Draft APIs

**Files:**
- Create: `api/src/period-reviews/period-review.types.ts`
- Create: `api/src/period-reviews/dto/save-employee-period-review-draft.dto.ts`
- Create: `api/src/period-reviews/period-reviews.service.ts`
- Create: `api/src/period-reviews/period-reviews.service.spec.ts`
- Create: `api/src/period-reviews/period-reviews.controller.ts`
- Create: `api/src/period-reviews/period-reviews.module.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: active `IndicatorVersion`, `IndicatorVersionItem`, current `AssessmentPeriod`, and authenticated `AuthUser`.
- Produces:
  - `GET /assessment-periods/:id/review -> PeriodReviewDetail`
  - `PUT /assessment-periods/:id/employee-draft -> { periodId, draftVersion, savedAt }`
  - `PeriodReviewsService.getReview(periodId, viewer)`
  - `PeriodReviewsService.saveEmployeeDraft(periodId, dto, viewer)`

- [ ] **Step 1: Define the failing detail and draft service tests**

Add these core cases to `period-reviews.service.spec.ts`:

```ts
it('returns frozen indicators and the current employee draft', async () => {
  prisma.assessmentPeriod.findUnique.mockResolvedValue(makePeriod({
    task: { employeeId: 'employee-1', managerId: 'manager-1' },
    indicatorVersion: { items: [makeVersionItem({ id: 'item-1', sourceInstanceId: 'indicator-1' })] },
    indicatorReviews: [makeReview({ indicatorVersionItemId: 'item-1', progress: 70 })],
  }));
  const result = await service.getReview('period-1', employeeViewer);
  expect(result).toMatchObject({
    period: { id: 'period-1', draftVersion: 0 },
    permissions: { canEditEmployee: true, canEditManager: false },
    indicators: [expect.objectContaining({
      indicatorVersionItemId: 'item-1',
      progress: 70,
      latestProgress: expect.objectContaining({ progress: 65, healthStatus: 'on_track' }),
    })],
  });
});

it('saves a partial employee draft without creating formal progress history', async () => {
  prisma.assessmentPeriod.findUnique.mockResolvedValue(makeEmployeeEditablePeriod());
  tx.assessmentPeriod.updateMany.mockResolvedValue({ count: 1 });
  await service.saveEmployeeDraft('period-1', {
    expectedVersion: 0,
    indicators: [{ indicatorVersionItemId: 'item-1', progress: 80, healthStatus: 'on_track' }],
  }, employeeViewer);
  expect(tx.assessmentPeriodIndicatorReview.upsert).toHaveBeenCalled();
  expect(tx.indicatorProgressUpdate.create).not.toHaveBeenCalled();
});
```

Also assert that another employee and an unrelated manager receive `ForbiddenException`, an in-scope HR viewer can read but cannot edit, and a stale `expectedVersion` receives `ConflictException`.

- [ ] **Step 2: Run the new spec and verify it fails**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
```

Expected: Jest fails because the module and service are absent.

- [ ] **Step 3: Define the request and response contracts**

Create the shared return shape:

```ts
export interface PeriodReviewDetail {
  period: {
    id: string;
    taskId: string;
    periodKey: string;
    periodType: AssessmentPeriodType;
    status: AssessmentPeriodStatus;
    selfEvalOpenAt: Date;
    selfEvalDueAt: Date;
    managerDueAt: Date;
    employeeSubmittedAt: Date | null;
    managerSubmittedAt: Date | null;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
    summaryComment: string | null;
    draftVersion: number;
  };
  employee: { id: string; name: string };
  manager: { id: string; name: string } | null;
  permissions: {
    canEditEmployee: boolean;
    canEditManager: boolean;
    canReturnEmployee: boolean;
  };
  indicators: PeriodReviewIndicatorDetail[];
}
```

`PeriodReviewIndicatorDetail.latestProgress` is the latest `IndicatorProgressUpdate` whose `recordDate` falls inside this period for the frozen item's `sourceInstanceId`. Return it as a read-only seed; never copy it into the period draft on the server.

Define a draft item where every editable value is optional:

```ts
export class EmployeePeriodReviewDraftItemDto {
  @IsUUID() indicatorVersionItemId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number | null;
  @IsOptional() @IsEnum(IndicatorProgressHealth) healthStatus?: IndicatorProgressHealth | null;
  @IsOptional() @IsString() @MaxLength(200) actualValueText?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) employeeComment?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) problemReason?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) nextMonthPlan?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) supportNeeded?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) attachments?: PeriodReviewAttachmentDto[];
  @IsOptional() @IsNumber() @Min(0) @Max(100) selfScore?: number | null;
}

export class SaveEmployeePeriodReviewDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EmployeePeriodReviewDraftItemDto)
  indicators!: EmployeePeriodReviewDraftItemDto[];
  @IsOptional() @IsString() @MaxLength(10_000) summaryComment?: string | null;
}
```

Use the existing attachment URL validation from `UpdateIndicatorProgressDto` rather than accepting arbitrary objects.

- [ ] **Step 4: Implement permission and optimistic draft saving**

Create these service helpers and use them from `getReview()` and `saveEmployeeDraft()`:

```ts
private assertCanRead(period: PeriodWithContext, viewer: AuthUser): void;
private assertEmployee(period: PeriodWithContext, viewer: AuthUser): void;
private assertEmployeeEditable(period: PeriodWithContext): void;
private async claimDraftVersion(
  tx: Prisma.TransactionClient,
  periodId: string,
  expectedVersion: number,
): Promise<number>;
```

`claimDraftVersion()` must use one conditional write:

```ts
const claimed = await tx.assessmentPeriod.updateMany({
  where: { id: periodId, draftVersion: expectedVersion, managerSubmittedAt: null },
  data: { draftVersion: { increment: 1 } },
});
if (claimed.count !== 1) {
  throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '内容已在其他设备更新，请刷新后继续' });
}
return expectedVersion + 1;
```

Employee draft saving is allowed in `self_eval` and `manager_scoring` only while `employeeSubmittedAt` and `managerSubmittedAt` are both null. Upsert only IDs included in the request and reject any item not in the period's frozen version.

- [ ] **Step 5: Register the controller and module**

Expose:

```ts
@Controller('assessment-periods')
export class PeriodReviewsController {
  @Get(':id/review')
  getReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    return this.service.getReview(id, viewer);
  }

  @Put(':id/employee-draft')
  saveEmployeeDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveEmployeePeriodReviewDraftDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.service.saveEmployeeDraft(id, dto, viewer);
  }
}
```

Import `PeriodReviewsModule` in `AppModule`.

- [ ] **Step 6: Run the focused test and build**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
npm run build
```

Expected: service cases and the Nest build pass.

- [ ] **Step 7: Commit**

```powershell
git add api/src/period-reviews api/src/app.module.ts
git commit -m "feat(performance): add period review drafts"
```

---

### Task 5: Submit Employee Monthly Review Atomically and Support Manager Return

**Files:**
- Create: `api/src/period-reviews/dto/submit-employee-period-review.dto.ts`
- Create: `api/src/period-reviews/dto/return-employee-period-review.dto.ts`
- Modify: `api/src/period-reviews/period-reviews.controller.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 draft records and `IndicatorVersionItem.sourceInstanceId` from Task 3.
- Produces:
  - `POST /assessment-periods/:id/employee-submit`
  - `POST /assessment-periods/:id/return-to-employee`
  - one formal employee revision and one progress update per frozen indicator.

- [ ] **Step 1: Write failing submit, fallback-summary, idempotency and return tests**

```ts
it('submits progress and self evaluation in one transaction', async () => {
  prisma.assessmentPeriod.findUnique.mockResolvedValue(makeEmployeeEditablePeriod());
  tx.assessmentPeriod.updateMany.mockResolvedValue({ count: 1 });
  await service.submitEmployeeReview('period-1', validEmployeeSubmission, employeeViewer);

  expect(tx.indicatorProgressUpdate.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      indicatorInstanceId: 'indicator-1',
      content: '月度复盘：完成度 80%，状态正常',
    }),
  }));
  expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ stage: 'employee', idempotencyKey: validEmployeeSubmission.idempotencyKey }),
  }));
  expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'manager_scoring', employeeSubmittedAt: expect.any(Date) }),
  }));
});

it('returns the existing success for a repeated idempotency key', async () => {
  prisma.assessmentPeriodReviewRevision.findUnique.mockResolvedValue(makeEmployeeRevision());
  await expect(service.submitEmployeeReview('period-1', validEmployeeSubmission, employeeViewer))
    .resolves.toMatchObject({ periodId: 'period-1', status: 'manager_scoring' });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
```

Add a return test proving the manager can clear `employeeSubmittedAt`, restore `self_eval`, increment `draftVersion`, write audit, and leave the prior revision untouched.

- [ ] **Step 2: Run and verify failure**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
```

Expected: new employee submission and return methods are missing.

- [ ] **Step 3: Define strict submission DTOs**

```ts
export class SubmitEmployeePeriodReviewItemDto {
  @IsUUID() indicatorVersionItemId!: string;
  @IsInt() @Min(0) @Max(100) progress!: number;
  @IsEnum(IndicatorProgressHealth) healthStatus!: IndicatorProgressHealth;
  @IsOptional() @IsString() @MaxLength(200) actualValueText?: string;
  @IsOptional() @IsString() @MaxLength(10_000) employeeComment?: string;
  @IsOptional() @IsString() @MaxLength(10_000) problemReason?: string;
  @IsOptional() @IsString() @MaxLength(10_000) nextMonthPlan?: string;
  @IsOptional() @IsString() @MaxLength(10_000) supportNeeded?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) attachments?: PeriodReviewAttachmentDto[];
  @IsNumber() @Min(0) @Max(100) selfScore!: number;
}

export class SubmitEmployeePeriodReviewDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsUUID() idempotencyKey!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => SubmitEmployeePeriodReviewItemDto)
  indicators!: SubmitEmployeePeriodReviewItemDto[];
  @IsOptional() @IsString() @MaxLength(10_000) summaryComment?: string;
}

export class ReturnEmployeePeriodReviewDto {
  @IsOptional() @IsString() @MaxLength(2_000) reason?: string;
}
```

- [ ] **Step 4: Implement atomic employee submission**

The service must:

```ts
async submitEmployeeReview(
  periodId: string,
  dto: SubmitEmployeePeriodReviewDto,
  viewer: AuthUser,
): Promise<PeriodReviewActionResult>;
```

Inside one transaction:

1. claim `draftVersion` and reject a locked period;
2. require the submitted indicator ID set to equal the frozen version item ID set;
3. upsert each `AssessmentPeriodIndicatorReview` row;
4. create one `IndicatorProgressUpdate` using `sourceInstanceId`;
5. use the employee comment when nonblank, otherwise call:

```ts
private progressSummary(progress: number, health: IndicatorProgressHealth): string {
  const labels = { on_track: '正常', at_risk: '有风险', blocked: '受阻', completed: '已完成' };
  return `月度复盘：完成度 ${progress}%，状态${labels[health]}`;
}
```

6. calculate weighted employee self total from version weights;
7. create the employee revision snapshot with the request idempotency key;
8. set `employeeSubmittedAt`, `selfScoreTotal`, `summaryComment`, and `status = manager_scoring`;
9. set the coarse task status to `manager_scoring` if it is still `goal_confirmed` or `self_eval`;
10. write `employee_period_review_submitted` audit and flow records.

After commit, create one manager notification titled `员工已提交月度复盘与自评` only when `cycle.notificationMode !== 'off'`; the manager's system task comes from period state and therefore still appears when outbound notifications are off. If two same-key requests race, catch the revision unique-key violation, fetch that revision and return the same formal result rather than returning a generic conflict.

- [ ] **Step 5: Implement manager return without deleting history**

Allow only `period.managerId === viewer.id`, require `managerSubmittedAt === null`, then:

```ts
await tx.assessmentPeriod.update({
  where: { id: period.id },
  data: {
    status: 'self_eval',
    employeeSubmittedAt: null,
    selfScoreTotal: null,
    draftVersion: { increment: 1 },
  },
});
```

Write a `return` flow record with the optional reason and notify the employee. Do not delete the employee revision; the next submission creates the next revision number.
Clear any unsubmitted manager score/comment draft fields in the current review rows so a pre-return draft cannot be submitted against the employee's revised content. Send the return notification only when outbound notifications are enabled.

- [ ] **Step 6: Add controller routes and run tests**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
npm run build
```

Expected: atomic submit, no half-write, fallback summary, idempotency, permissions and return cases pass.

- [ ] **Step 7: Commit**

```powershell
git add api/src/period-reviews
git commit -m "feat(performance): submit monthly employee reviews"
```

---

### Task 6: Save and Submit Manager Scores, Lock Periods, and Aggregate the Cycle

**Files:**
- Create: `api/src/period-reviews/dto/save-manager-period-review-draft.dto.ts`
- Create: `api/src/period-reviews/dto/submit-manager-period-review.dto.ts`
- Modify: `api/src/period-reviews/period-reviews.controller.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/tasks/scoring.service.ts`
- Modify: `api/src/tasks/scoring.service.spec.ts`

**Interfaces:**
- Consumes: frozen version items and period review rows.
- Produces:
  - `PUT /assessment-periods/:id/manager-draft`
  - `POST /assessment-periods/:id/manager-submit`
  - period total, formal manager revision, locked period, and cycle `GradeResult` after all valid periods complete.

- [ ] **Step 1: Write failing pure-score and manager-submit tests**

Add a reusable pure score case:

```ts
it('calculates a period total from frozen item weights', () => {
  expect(service.calcPeriodTotal([
    { id: 'a', name: 'A', indicatorType: 'kpi', dimensionName: '业绩', dimensionWeight: 1, weight: 0.6, score: 90 },
    { id: 'b', name: 'B', indicatorType: 'kpi', dimensionName: '业绩', dimensionWeight: 1, weight: 0.4, score: 80 },
  ])).toBe(86);
});
```

Add service cases proving:

```ts
expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'completed', managerScoreTotal: 86, lockedAt: expect.any(Date) }),
}));
expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ stage: 'manager' }),
}));
```

Add a three-period aggregate test with totals `80`, `90`, `100` expecting `GradeResult.calculatedScore = 90`, and a missing-period test expecting no cycle result.

- [ ] **Step 2: Run focused specs and verify failure**

```powershell
cd api
npm test -- --runInBand src/tasks/scoring.service.spec.ts src/period-reviews/period-reviews.service.spec.ts
```

Expected: `calcPeriodTotal`, manager draft and manager submit do not exist.

- [ ] **Step 3: Add manager DTOs with optional comments**

```ts
export class ManagerPeriodReviewDraftItemDto {
  @IsUUID() indicatorVersionItemId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) managerScore?: number | null;
  @IsOptional() @IsString() @MaxLength(10_000) managerComment?: string | null;
}

export class SaveManagerPeriodReviewDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManagerPeriodReviewDraftItemDto)
  indicators!: ManagerPeriodReviewDraftItemDto[];
}

export class SubmitManagerPeriodReviewItemDto {
  @IsUUID() indicatorVersionItemId!: string;
  @IsNumber() @Min(0) @Max(100) managerScore!: number;
  @IsOptional() @IsString() @MaxLength(10_000) managerComment?: string;
}

export class SubmitManagerPeriodReviewDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsUUID() idempotencyKey!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => SubmitManagerPeriodReviewItemDto)
  indicators!: SubmitManagerPeriodReviewItemDto[];
}
```

Do not add a validator requiring manager comments for score differences or scores below 60.

- [ ] **Step 4: Extract the pure period score function**

Add:

```ts
export interface PeriodScorableIndicator {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  dimensionName: string | null;
  dimensionWeight: number;
  weight: number;
  score: number;
}

calcPeriodTotal(items: PeriodScorableIndicator[]): number {
  const scorable = items.map((item) => ({
    ...item,
    dimensionName: item.dimensionName ?? '',
    dimensionType: this.resolveDimensionType(item.indicatorType),
    managerScore: item.score,
    finalScore: item.score,
  }));
  return this.calcTaskTotal(scorable).totalScore;
}
```

Keep legacy `calculateTaskScore()` unchanged.

- [ ] **Step 5: Implement manager draft and formal submission**

Manager draft uses the same `claimDraftVersion()` and upserts only `managerScore` and `managerComment`.

Formal submission must:

1. return an existing result for a repeated manager idempotency key, including a unique-key race caught after transaction start;
2. verify `viewer.id === period.managerId`;
3. allow `manager_scoring` even when `employeeSubmittedAt` is null;
4. require the submitted indicator set to equal the frozen version set;
5. upsert every manager score and optional comment, including periods where the employee never submitted and no review rows exist;
6. calculate and store `managerScoreTotal`;
7. create a manager revision snapshot;
8. set `status = completed`, `managerSubmittedAt`, and `lockedAt`;
9. write audit and flow records.

After locking, query all non-`no_result` task periods. If an unfinished period remains, set coarse task status to `goal_confirmed`. If all are complete, calculate:

```ts
const cycleScore = completedPeriods.reduce((sum, period) => sum + period.managerScoreTotal!.toNumber(), 0)
  / completedPeriods.length;
```

Upsert `GradeResult` with this score and `ScoringService.calcRawGrade()`, then transition the task using the current rule:

```ts
const targetStatus = task.managerId === task.deptHeadId ? 'hr_calibration' : 'dept_review';
await this.flowService.transitionTx(tx, {
  task,
  action: 'submit',
  targetStatus,
  actorId: viewer.id,
  taskUpdate: { managerScoredAt: submittedAt },
});
```

- [ ] **Step 6: Run focused verification**

```powershell
cd api
npm test -- --runInBand src/tasks/scoring.service.spec.ts src/period-reviews/period-reviews.service.spec.ts
npm run build
```

Expected: optional comments, per-period score, incomplete-cycle gate and equal-average result cases pass.

- [ ] **Step 7: Commit**

```powershell
git add api/src/period-reviews api/src/tasks/scoring.service.ts api/src/tasks/scoring.service.spec.ts
git commit -m "feat(performance): score and aggregate monthly periods"
```

---

### Task 7: Open Period Stages and Send One Set of Reminders

**Files:**
- Modify: `api/src/scheduler/scheduler.service.ts:65-100, 242-264`
- Modify: `api/src/scheduler/scheduler.service.spec.ts`
- Modify: `api/src/notifications/notifications.service.ts`
- Modify: `api/src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: `AssessmentPeriod.selfEvalOpenAt`, `selfEvalDueAt`, `managerDueAt`, status and cycle `notificationMode`.
- Produces: `SchedulerService.runPeriodStageOpenings(now = new Date()): Promise<void>` and notification types `monthly_review_opened`, `monthly_manager_score_opened`, `monthly_review_returned`.

- [ ] **Step 1: Write failing scheduler transition tests**

```ts
it('opens an unopened period for employee review at selfEvalOpenAt', async () => {
  prisma.assessmentPeriod.findMany.mockResolvedValue([makePeriod({ status: 'unopened' })]);
  await service.runPeriodStageOpenings(new Date('2027-02-01T01:00:00.000Z'));
  expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'period-1', status: 'unopened' },
    data: expect.objectContaining({ status: 'self_eval', openedAt: expect.any(Date) }),
  }));
  expect(tx.assessmentTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'self_eval' },
  }));
});

it('opens manager scoring after the employee due time without requiring employee submission', async () => {
  prisma.assessmentPeriod.findMany.mockResolvedValue([makePeriod({ status: 'self_eval', employeeSubmittedAt: null })]);
  await service.runPeriodStageOpenings(new Date('2027-02-03T10:01:00.000Z'));
  expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'manager_scoring' },
  }));
});
```

Add idempotency cases showing repeated cron runs do not duplicate status changes or notifications.

- [ ] **Step 2: Run scheduler specs and verify failure**

```powershell
cd api
npm test -- --runInBand src/scheduler/scheduler.service.spec.ts
```

Expected: `runPeriodStageOpenings()` is missing.

- [ ] **Step 3: Add the five-minute period cron**

```ts
@Cron('*/5 * * * *')
async openAssessmentPeriods(): Promise<void> {
  try {
    await this.runPeriodStageOpenings();
  } catch (error) {
    this.logger.error('开放月度复盘与评分任务异常', error);
  }
}
```

`runPeriodStageOpenings(now)` performs two conditional batches:

```ts
const employeeOpenings = await this.prisma.assessmentPeriod.findMany({
  where: { status: 'unopened', selfEvalOpenAt: { lte: now }, task: { cycle: { workflowVersion: 2 } } },
  include: { task: { include: { cycle: true } } },
});

const managerOpenings = await this.prisma.assessmentPeriod.findMany({
  where: { status: 'self_eval', selfEvalDueAt: { lte: now }, task: { cycle: { workflowVersion: 2 } } },
  include: { task: { include: { cycle: true } } },
});
```

Every write uses `updateMany({ where: { id, status: expectedStatus } })`; only a count of 1 creates audit and notification rows.

- [ ] **Step 4: Keep legacy cycle opening isolated**

Change `runSelfEvalOpenings()` to query `workflowVersion: 1` only. V2 task status is now driven by assessment periods and must not be moved by the legacy cycle-level `selfEvalOpenAt` path.

- [ ] **Step 5: Send one business notification per stage**

For cycles with `notificationMode !== 'off'`, create:

```ts
await this.notificationsService.create({
  userId: task.employeeId,
  cycleId: task.cycleId,
  taskId: task.id,
  type: 'monthly_review_opened',
  title: `${periodLabel}复盘与评分已开放`,
  content: `请在${formatDeadline(period.selfEvalDueAt)}前完成本月进展复盘和自评。`,
  extraData: { periodId: period.id, periodKey: period.periodKey },
});
```

Create the matching manager notification when the employee submits early or the due time opens manager scoring. Use the notification log's `extraData.periodId` plus notification `type` to check whether that stage was already announced.

- [ ] **Step 6: Run focused tests**

```powershell
cd api
npm test -- --runInBand src/scheduler/scheduler.service.spec.ts src/notifications/notifications.service.spec.ts
```

Expected: employee opening, manager opening, legacy isolation, notification-off and repeated-cron cases pass.

- [ ] **Step 7: Commit**

```powershell
git add api/src/scheduler api/src/notifications
git commit -m "feat(performance): schedule monthly review stages"
```

---

### Task 8: Expose the Active Period in Personal and Team Task Summaries

**Files:**
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `api/src/tasks/team-tasks.service.ts`
- Modify: `api/src/tasks/team-tasks.service.spec.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/types/enums.ts`

**Interfaces:**
- Consumes: v2 `AssessmentPeriod` status, deadlines and scores.
- Produces: `PeriodSummary`, `TaskDetail.periods`, `TaskDetail.activePeriod`, and `TeamTaskListItem.activePeriod`; v1 response shapes remain valid because these fields are optional.

- [ ] **Step 1: Add failing personal and team summary tests**

```ts
it('selects the actionable v2 period without hiding an overdue employee submission', async () => {
  prisma.assessmentTask.findUnique.mockResolvedValue(makeTask({
    cycle: { workflowVersion: 2 },
    periods: [
      makePeriod({ id: 'p1', sequence: 1, status: 'completed' }),
      makePeriod({ id: 'p2', sequence: 2, status: 'self_eval', selfEvalDueAt: past }),
    ],
  }));
  const result = await service.findOne('task-1', employeeViewer);
  expect(result.activePeriod).toMatchObject({ id: 'p2', action: 'employee_review', overdue: true });
});

it('counts manager work from period state instead of the cycle-level task status', async () => {
  prisma.assessmentTask.findMany.mockResolvedValue([
    makeTask({ status: 'self_eval', periods: [makePeriod({ status: 'manager_scoring' })] }),
  ]);
  const result = await service.findTeam({ stage: 'manager-eval' }, managerViewer);
  expect(result.items[0]).toMatchObject({ stageState: 'pending', activePeriod: { action: 'manager_score' } });
  expect(result.counts.pending).toBe(1);
});
```

- [ ] **Step 2: Run the focused specs and verify the missing fields fail**

```powershell
cd api
npm test -- --runInBand src/tasks/tasks.service.spec.ts src/tasks/team-tasks.service.spec.ts
```

- [ ] **Step 3: Add one shared period-summary mapper**

```ts
export interface PeriodSummary {
  id: string;
  periodKey: string;
  label: string;
  sequence: number;
  status: AssessmentPeriodStatus;
  selfEvalDueAt: Date;
  managerDueAt: Date;
  employeeSubmittedAt: Date | null;
  managerSubmittedAt: Date | null;
  totalScore: number | null;
  action: 'employee_review' | 'manager_score' | 'view_result' | 'none';
  overdue: boolean;
}
```

Order active periods by actionable state first and then `sequence`. A late employee submission remains editable until manager submission. For v1 tasks, return no period summary and continue using the existing task status mapper.

- [ ] **Step 4: Make team manager filtering period-aware**

For `workflowVersion = 2`, include a task in `manager-eval` when its assigned period is `manager_scoring`; completed means the selected period has status `completed` and a non-null `lockedAt`. Keep the current `TEAM_STAGE_STATUSES` branch only for v1 tasks.

- [ ] **Step 5: Run focused tests and API build**

```powershell
cd api
npm test -- --runInBand src/tasks/tasks.service.spec.ts src/tasks/team-tasks.service.spec.ts
npm run build
```

- [ ] **Step 6: Commit**

```powershell
git add api/src/tasks web/src/types/api.types.ts
git commit -m "feat(performance): expose active monthly review periods"
```

---

### Task 9: Add the Typed Web Client and Cross-Device Draft Autosave

**Files:**
- Create: `web/src/api/period-reviews.api.ts`
- Modify: `web/src/types/api.types.ts`
- Create: `web/src/views/task/composables/use-period-review-draft.ts`
- Create: `web/e2e/specs/28-monthly-review-responsive.spec.ts`

**Interfaces:**
- Consumes: Task 4–6 period-review endpoints and `draftVersion` optimistic locking.
- Produces: typed employee/manager save and submit calls plus a reusable `saved | saving | unsynced | conflict` draft state.

- [ ] **Step 1: Write the failing autosave contract test**

```ts
test('debounces edits, sends the current draft version, and reuses the server draft after reload', async ({ page }) => {
  const requests: unknown[] = [];
  await mockPeriodReview(page, { draftVersion: 3, indicators: [draftIndicator()] });
  await captureEmployeeDraftRequests(page, requests);
  await openEmployeePeriod(page, 'period-1');
  await page.getByTestId('period-progress-item-1').fill('80');
  await expect(page.getByTestId('draft-state')).toHaveText('保存中');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ expectedVersion: 3 });
  await expect(page.getByTestId('draft-state')).toHaveText('已保存');
});
```

- [ ] **Step 2: Add exact API types and client methods**

```ts
export interface PeriodReviewApi {
  get(periodId: string): Promise<PeriodReviewDetail>;
  saveEmployeeDraft(periodId: string, body: SaveEmployeePeriodDraftBody): Promise<DraftSavedResult>;
  submitEmployee(periodId: string, body: SubmitEmployeePeriodReviewBody): Promise<PeriodReviewDetail>;
  saveManagerDraft(periodId: string, body: SaveManagerPeriodDraftBody): Promise<DraftSavedResult>;
  submitManager(periodId: string, body: SubmitManagerPeriodReviewBody): Promise<PeriodReviewDetail>;
  returnToEmployee(periodId: string, body: ReturnPeriodReviewBody): Promise<PeriodReviewDetail>;
}
```

Use `/assessment-periods/:periodId/review`, `/employee-draft`, `/employee-submit`, `/manager-draft`, `/manager-submit`, and `/return-to-employee`. Submit bodies carry a fresh `crypto.randomUUID()` idempotency key.

- [ ] **Step 3: Implement the composable**

```ts
const state = ref<'saved' | 'saving' | 'unsynced' | 'conflict'>('saved');
const draftVersion = ref(detail.value.period.draftVersion);

const save = useDebounceFn(async () => {
  state.value = 'saving';
  try {
    const result = await saveDraft({ expectedVersion: draftVersion.value, indicators: serialize() });
    draftVersion.value = result.draftVersion;
    state.value = 'saved';
  } catch (error) {
    state.value = isVersionConflict(error) ? 'conflict' : 'unsynced';
    if (state.value === 'unsynced') scheduleRetry();
  }
}, 600);
```

Use bounded exponential retries while the page is open and the browser is online, reset the retry delay after a successful save, and keep the unsynced local input in memory between attempts. Register `beforeunload` only while state is `saving` or `unsynced`. On `409`, stop autosaving and show “草稿已在其他设备更新，请刷新后继续”; never overwrite the newer server draft silently.

- [ ] **Step 4: Run the contract test and type check**

```powershell
cd web
npm run type-check
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts --grep "debounces edits"
```

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/period-reviews.api.ts web/src/types/api.types.ts web/src/views/task/composables web/e2e/specs/28-monthly-review-responsive.spec.ts
git commit -m "feat(performance): add monthly review draft client"
```

---

### Task 10: Build the Employee PC Two-Column and Mobile Card Workspace

**Files:**
- Create: `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`
- Create: `web/src/views/task/components/PerformanceFormWorkspace.vue`
- Create: `web/src/views/task/components/MonthlyReviewReferencePanel.vue`
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/e2e/specs/28-monthly-review-responsive.spec.ts`

**Interfaces:**
- Consumes: `PeriodReviewDetail`, employee draft composable and period summaries.
- Produces: one employee submission containing progress review and self-score; desktop main/reference columns and continuous goal cards, mobile single-column cards with collapsible reference information.

- [ ] **Step 1: Add failing desktop and mobile acceptance cases**

```ts
test('employee completes progress and self-score in compact goal cards beside reference information', async ({ page }) => {
  await openEmployeePeriod(page, '2027-01');
  await expect(page.getByTestId('monthly-review-main')).toBeVisible();
  await expect(page.getByTestId('monthly-review-reference')).toBeVisible();
  await fillEmployeeIndicator(page, 'item-1', { progress: 80, health: 'on_track', selfScore: 88 });
  await page.getByRole('button', { name: '提交本月复盘' }).click();
  await expect(page.getByText('已提交，等待主管评分')).toBeVisible();
});

test('employee uses cards without horizontal scrolling at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEmployeePeriod(page, '2027-01');
  await expect(page.getByTestId('employee-period-cards')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

- [ ] **Step 2: Render the shared model in two responsive shells**

Each indicator contains:

```ts
type EmployeeIndicatorInput = {
  indicatorVersionItemId: string;
  progress: number | null;          // required, 0–100
  healthStatus: 'on_track' | 'at_risk' | 'blocked' | 'completed' | null; // required
  selfScore: number | null;         // required, 0–100
  actualValue: string | null;       // optional
  employeeComment: string | null;   // optional
  attachments: AttachmentRef[];     // optional
};
```

Each goal card shows goal name, current result, completion, status and self-score first; problem reason, next-month plan, support needed, other note and attachments remain optional and compact. The right reference panel shows original goal content, scoring/completion standard, prior monthly records and aligned objectives. Do not apply the target-setting weight-total validation.

- [ ] **Step 3: Add explicit in-period and previous-period reuse actions**

Prefill an existing draft automatically. If a new period has a current in-period `IndicatorProgressUpdate`, seed completion, health and optional progress material from that record. Otherwise show “沿用上月实际值与说明” as an explicit button; copy only optional actual value/comment/attachments, never progress, health or scores.

- [ ] **Step 4: Validate inline and submit once**

On submit, focus the first missing required cell/card and show its error below the field. Send all indicators in one `employee-submit` transaction request with the last draft version and idempotency key. A repeated click must reuse the in-flight promise and disable the button.

- [ ] **Step 5: Run employee responsive tests and type check**

```powershell
cd web
npm run type-check
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts --grep "employee"
```

- [ ] **Step 6: Commit**

```powershell
git add web/src/views/task web/e2e/specs/28-monthly-review-responsive.spec.ts
git commit -m "feat(performance): add responsive employee monthly review"
```

---

### Task 11: Build the Manager PC Table and Mobile Card Workspace

**Files:**
- Create: `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/src/views/task/components/TeamTaskList.vue`
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Modify: `web/e2e/specs/28-monthly-review-responsive.spec.ts`

**Interfaces:**
- Consumes: manager-editable period review and the existing `manager-eval` team workspace.
- Produces: all-indicator scoring on PC, one-indicator cards on mobile, optional manager comments, return, and “提交并处理下一人”.

- [ ] **Step 1: Add failing manager interaction tests**

```ts
test('manager can accept each self-score and submit without comments', async ({ page }) => {
  await openManagerPeriod(page, 'employee-1', '2027-01');
  await page.getByTestId('agree-self-score-item-1').click();
  await expect(page.getByText('与员工自评分相差 10 分')).toHaveCount(0);
  await page.getByRole('button', { name: '提交并处理下一人' }).click();
  await expect(page.getByTestId('team-workspace-employee')).not.toHaveText('方园');
});

test('score differences warn but do not require an explanation', async ({ page }) => {
  await openManagerPeriod(page, 'employee-1', '2027-01');
  await page.getByTestId('manager-score-item-1').fill('55');
  await expect(page.getByText('主管评分低于 60 分')).toBeVisible();
  await expect(page.getByTestId('manager-comment-item-1')).not.toHaveAttribute('required');
  await expect(page.getByRole('button', { name: '提交评分' })).toBeEnabled();
});
```

- [ ] **Step 2: Implement the responsive scoring workspace**

PC renders employee progress, self-score, manager score and optional comment in one table. Mobile uses one card per indicator with a sticky previous/next indicator control. Add “同意自评” only to the current row/card; do not provide a bulk fill action, and never copy comments.

- [ ] **Step 3: Implement warning-only rules**

```ts
function scoreWarnings(selfScore: number | null, managerScore: number | null): string[] {
  if (managerScore == null) return [];
  return [
    ...(selfScore != null && Math.abs(managerScore - selfScore) >= 10 ? ['与员工自评分相差 10 分及以上'] : []),
    ...(managerScore < 60 ? ['主管评分低于 60 分'] : []),
  ];
}
```

Only missing/out-of-range manager scores block submission. Manager comments and return reason are optional; returning asks for confirmation but does not invent a mandatory explanation rule.

- [ ] **Step 4: Advance to the next pending employee after success**

After `manager-submit` succeeds, refresh the team counts and list, then select the next `pending` employee in the same cycle and period. If none remains, return to the list and show “本月待评分人员已处理完成”. Do not advance on a failed or ambiguous request.

- [ ] **Step 5: Run manager responsive tests and type check**

```powershell
cd web
npm run type-check
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts --grep "manager|score differences"
```

- [ ] **Step 6: Commit**

```powershell
git add web/src/views/task web/e2e/specs/28-monthly-review-responsive.spec.ts
git commit -m "feat(performance): add responsive manager monthly scoring"
```

---

### Task 12: Verify the Three-Month Closed Loop and Prepare a Release Gate

**Files:**
- Create: `api/test/suites/13-performance-workflow-v2-monthly-review.e2e-spec.ts`
- Modify: `web/e2e/specs/28-monthly-review-responsive.spec.ts`
- Modify: `docs/acceptance/2026-08-29-production-acceptance-issues.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: executable evidence for one quarterly v2 cycle with three monthly periods, plus a production release checklist; it does not deploy.

- [ ] **Step 1: Write the failing API closed-loop suite**

```ts
it('completes three periods and averages only locked period totals equally', async () => {
  const cycle = await createQuarterlyV2Cycle({ scoringFrequency: 'monthly', notificationMode: 'off' });
  const task = await launchAndConfirmIndicators(cycle.id, employee);
  for (const [index, expected] of [80, 90, 70].entries()) {
    const period = await openPeriod(task.id, index + 1);
    await submitEmployeeReview(period.id, employee, completeEmployeeBody());
    await submitManagerReview(period.id, manager, managerBody(expected));
  }
  const result = await getTask(task.id, hrAdmin);
  expect(result.totalScore).toBe(80);
});
```

Also cover: v1 behavior unchanged; late employee submit remains allowed until manager submission; manager may submit with no employee review; employee submit writes progress and formal review in one transaction; duplicate idempotency returns the original result; stale draft version returns 409; optional employee/manager comments; return and resubmit revision history; notification off versus enabled; unauthorized employee/manager access.

- [ ] **Step 2: Run the isolated API E2E suite**

```powershell
cd api
npm run test:e2e -- --runTestsByPath test/suites/13-performance-workflow-v2-monthly-review.e2e-spec.ts
```

Expected: it fails before all implementation tasks are complete, then passes against the isolated test database.

- [ ] **Step 3: Finish browser acceptance on PC and mobile**

The Playwright suite must cover: one cycle switch; employee month selector; shared draft after reload; 1440px main/reference columns with goal cards; 390px single column, collapsible reference and non-overlapping fixed action bar; optional explanations; warning-only score differences; manager next-person action; locked history read-only; and a historical v1 task still opening the existing workspace.

```powershell
cd web
npx playwright test e2e/specs/25-cycle-scoring-plan.spec.ts e2e/specs/28-monthly-review-responsive.spec.ts
```

- [ ] **Step 4: Validate schema, focused unit tests, builds and formatting**

```powershell
cd api
npx prisma validate
npm test -- --runInBand src/cycles/cycles.service.spec.ts src/tasks/indicator-version.service.spec.ts src/period-reviews/period-reviews.service.spec.ts src/tasks/tasks.service.spec.ts src/tasks/team-tasks.service.spec.ts src/scheduler/scheduler.service.spec.ts
npm run build
cd ../web
npm run type-check
cd ..
git diff --check
```

- [ ] **Step 5: Record evidence and the production release gate**

Update ACC-003 in the acceptance issue list with exact commands, passing output, remaining risks, migration name and rollback scope. Before production release, require: current production image/Git baseline check, PostgreSQL backup, migration against a clone, API and Web rollback tags, candidate smoke, real employee/manager/HR role checks, and explicit user instruction “发布”. Do not run `prisma migrate deploy`, merge another branch, or replace production containers in this task.

- [ ] **Step 6: Commit the verified implementation evidence**

```powershell
git add api/test/suites/13-performance-workflow-v2-monthly-review.e2e-spec.ts web/e2e/specs/28-monthly-review-responsive.spec.ts docs/acceptance/2026-08-29-production-acceptance-issues.md
git commit -m "test(performance): verify unified monthly review flow"
```
