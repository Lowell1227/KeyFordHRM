# 目标持续跟进与月度自评 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让员工在考核周期内随时低门槛提交目标进展，并按月形成逐指标自评、主管评分、月度总分和季度总分；同时修复未提交月份被提前推进、业务月份排序错误、零权重指标被强制评分和工作台阶段误判。

**Architecture:** 保留 `IndicatorProgressUpdate` 作为目标进展事件流，使用 `AssessmentPeriod`、`AssessmentPeriodIndicatorReview` 和 `AssessmentPeriodReviewRevision` 作为月度正式结果。服务端以 Asia/Shanghai 业务月份选择“当前进展”，以 `AssessmentPeriod` 作为正式流程唯一真相；通知采用可重试幂等键；公示前重开通过同一事务回退期次、任务、结果和流程当前态，但保留修订、流程记录和审计日志。Web 只消费服务端明确返回的月份、来源和阶段统计，不再根据粗粒度任务状态猜测。

**Tech Stack:** NestJS 10、Prisma 5/PostgreSQL、Jest、Vue 3、TypeScript、Element Plus、Playwright、PowerShell。

**Spec:** `docs/superpowers/specs/2026-09-03-continuous-goal-progress-and-monthly-self-evaluation-design.md`

## Global Constraints

- 页面、通知、接口说明只使用“目标跟进”“目标进展记录”“月度自评”“月度自评结果”“主管月度评分”“月度总分”“季度总分”；不新增“月度归档”“mark”或“月度归档结果”。
- 日常目标进展只接受状态、0–100 进度、描述和并发版本；不新增附件，历史附件只读保留。
- 员工可以在已开放且未公示的考核周期内随时提交目标进展；月度自评提交、主管评分、任务阶段不能锁死日常进展入口。
- 日常进展按实际提交时间归属 Asia/Shanghai 月份，不允许倒填业务日期。当前状态先比较业务月份，再比较 `createdAt` 和稳定主键；旧月份的晚提交不能覆盖新月份。
- 月度自评的状态、进度、描述可以为空；只有有效权重大于 0 的指标自评分必填。零权重指标不填写员工分或主管分，也不进入总分。
- 月度自评整月一次提交并冻结；主管只能在员工提交后保存或提交评分。主管提交锁定月份。
- 月度总分使用主管逐指标评分按有效权重加权，保留两位小数。季度总分仅在全部必需月份均由员工和主管完成且月度总分非空时计算，三个月简单平均并保留两位小数。
- 逾期只提醒，不自动提交、不自动推进、不自动判定无结果、不自动归档。关闭外部通知时，站内任务状态和 HR 逾期清单仍需正确。
- 主管评分提交前可以退回员工；主管评分提交后，具备 `cycle_plan_edit` 的 HR 或 HR 管理员可以填写原因直接重开。公示后拒绝重开，继续走现有只更正等级/系数的结果申诉流程。
- 重开只影响指定月份；保留员工和主管的正式提交修订、`FlowRecord` 和 `AuditLog`。当前员工内容与自评分作为重开后的初始值，主管当前评分与下游当前结果清空。
- `AssessmentPeriod` 是月度阶段真相。不得再用 `AssessmentTask.status` 推断某个月是否已由员工提交。
- 不修改 `2026 Q3 季度考核（902LW测试）` 的异常测试排期日期；线上状态修复只处理可由明确谓词识别的“未提交却进入主管评分”期次。
- 每个服务端状态变更必须具有事务、乐观并发或幂等保护。通知失败可以重试，但不能产生重复站内通知。
- `workflowVersion = 1` 的历史周期保持现有周期级自评行为；本计划的新月度语义只用于 `workflowVersion = 2` 且存在 `AssessmentPeriod` 的计划。
- 不把钉钉组织作为上下级来源；继续使用期次冻结的 `managerId` 和系统绩效权限。
- 每个任务先写失败测试，再写最小实现，再运行聚焦测试；未经用户再次明确“上线”，最后一项只形成发布候选、迁移预检和回滚材料，不操作生产。

---

## File and Interface Map

### Database and migrations

- Modify `api/prisma/schema.prisma`
  - `NotificationLog` 增加可空 `dedupeKey String? @unique @map("dedupe_key") @db.VarChar(160)`。
  - 不新增第二套月度结果表，不删除历史字段。
- Create `api/prisma/migrations/20260903000001_monthly_notification_dedupe/migration.sql`
  - 增加通知幂等键和唯一索引。
- Create `api/prisma/migrations/20260903000002_restore_unsubmitted_months/migration.sql`
  - 将无员工提交、无主管提交、未锁定却处于 `manager_scoring` 的 v2 月度期次恢复为 `self_eval`。
  - 为每个修复对象写入 `audit_logs`，并只在存在此类期次时恢复任务当前态。

### Backend: goal progress

- Create `api/src/objectives/goal-tracking-progress.ts`
  - `shanghaiMonthKey(date)`、`progressBusinessPeriodKey(record)`、`sortGoalProgress(records)`、`currentGoalProgress(records)`。
- Create `api/src/objectives/goal-tracking-progress.spec.ts`
  - 覆盖跨月、同月、正式月度结果、时区边界和稳定主键排序。
- Modify `api/src/objectives/objectives.service.ts`
  - 日常进展可编辑范围改为已开放且未公示的 v2 周期。
  - 当前状态与详情历史使用业务月份排序。
  - 月度正式提交写入的进展标记为 `monthly_self_evaluation`，普通提交标记为 `active_progress`。
- Modify `api/src/objectives/dto/update-indicator-progress.dto.ts`
  - 新提交仅接受 `progress`、`healthStatus`、`content`、`expectedLatestUpdateAt`。
- Modify `api/src/objectives/objectives.controller.ts`
  - 保持原路由，更新 Swagger/DTO 语义。
- Modify `api/src/objectives/objectives.service.spec.ts`
  - 覆盖持续跟进权限、月份排序、并发和旧附件只读。

### Backend: monthly result, score, reminder and reopen

- Modify `api/src/period-reviews/period-review.types.ts`
  - 增加 `isScoreRequired`、`monthlyProgressSource`、月份提交统计和 HR 监控类型。
- Modify `api/src/period-reviews/period-review-labels.ts`
  - 统一月度自评与主管月度评分文案。
- Modify `api/src/period-reviews/dto/save-employee-period-review-draft.dto.ts`
  - 状态、进度、描述、自评分均允许草稿为空。
- Modify `api/src/period-reviews/dto/submit-employee-period-review.dto.ts`
  - 状态、进度、描述允许为空；仅有效权重指标的自评分必填。
- Create `api/src/period-reviews/dto/reopen-period-review.dto.ts`
  - `reason` 必填、`expectedVersion` 必填。
- Create `api/src/period-reviews/dto/query-period-monitoring.dto.ts`
  - 月份、状态、员工关键字和分页筛选。
- Modify `api/src/period-reviews/period-reviews.service.ts`
  - 同月进展预填、员工提交、主管门禁、有效权重总分、正式修订、重开事务。
- Modify `api/src/period-reviews/period-reviews.controller.ts`
  - 增加重开和 HR 月度进度监控端点。
- Create `api/src/period-reviews/period-monitoring.service.ts`
  - 周期月度进度汇总、筛选和重开权限投影。
- Create `api/src/period-reviews/period-monitoring.service.spec.ts`
  - 监控统计、数据范围和权限测试。
- Modify `api/src/period-reviews/period-reviews.module.ts`
  - 注册监控服务、流程和通知依赖。
- Modify `api/src/period-reviews/period-reviews.service.spec.ts`
  - 员工、主管、重开、修订和并发测试。
- Modify `api/src/period-reviews/period-aggregation.service.ts`
  - 全期完成门禁和季度简单平均。
- Modify `api/src/period-reviews/period-aggregation.service.spec.ts`
  - 缺月、`no_result`、零权重和两位小数测试。
- Create `api/src/period-reviews/monthly-reminder-policy.ts`
  - Asia/Shanghai 日历日提醒决策纯函数。
- Create `api/src/period-reviews/monthly-reminder-policy.spec.ts`
  - 提前 3 日、截止日、逾期第 1 日和此后每 3 日测试。
- Modify `api/src/scheduler/scheduler.service.ts`
  - 删除逾期自动推进主管评分；按期次发送员工和冻结主管提醒。
- Modify `api/src/scheduler/scheduler.service.spec.ts`
  - 提醒节奏、关闭外部通知和无自动推进测试。
- Modify `api/src/notifications/notifications.service.ts`
  - 幂等创建与失败重试。
- Modify `api/src/notifications/notifications.service.spec.ts`
  - 重复调用、失败重试和并发占用测试。
- Modify `api/src/flow/flow.service.ts`
  - 支持公示前月度重开后的当前节点回退并保留流程历史。

### Backend: workbench and task projections

- Modify `api/src/tasks/tasks.service.ts`
  - `findMine()` 和任务详情返回按 `sequence` 排序的期次以及显式月度统计。
- Modify `api/src/tasks/tasks.service.spec.ts`
  - 最早未提交月份、员工已交主管未交、未来未开放月份测试。
- Modify `api/src/tasks/team-tasks.service.ts`
  - 团队主管待办只包含员工已提交的期次。
- Modify `api/src/tasks/team-tasks.service.spec.ts`
  - 未提交月份不进入主管待办。

### Web types and API clients

- Modify `web/src/types/api.types.ts`
  - 目标进展来源/月份、月度评分要求、工作台期次统计、HR 监控与重开请求。
- Modify `web/src/api/objectives.api.ts`
  - 日常进展提交体只含三项业务字段和并发版本。
- Modify `web/src/api/period-reviews.api.ts`
  - 月度监控查询和重开接口。
- Modify `web/src/components/layout/notification-target.ts`
  - 员工月度自评、主管月度评分和重开通知跳转到指定 `periodId`。

### Web: workbench, goal tracking and monthly workspaces

- Modify `web/src/views/task/task-stage.ts`
  - 使用期次状态/提交时间选择员工待办，不从任务状态猜测。
- Modify `web/src/views/task/task-stage.spec.ts`
  - 工作台文案、进度和阶段纯函数测试。
- Modify `web/src/views/dashboard/DashboardView.vue`
  - 展示 `2026年9月月度自评`、`第3/3期 · 已提交 2/3` 等明确结果。
- Modify `web/src/views/task/TaskDetailView.vue`
  - 期次选择、员工等待、主管入口和统一术语。
- Modify `web/src/views/performance/goal-tracking.ts`
  - 当前动作和标签统一月度自评语义。
- Modify `web/src/views/performance/GoalTrackingCyclePanel.vue`
  - 展示员工提交、当月目标覆盖、主管月度评分三项统计。
- Modify `web/src/views/performance/GoalTrackingDetailDrawer.vue`
  - 当前结果优先、历史按月折叠；日常提交只保留状态、进度和描述。
- Modify `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`
  - 简化为状态、进度、描述和自评分；无同月进展显示“本月未更新”。
- Modify `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`
  - 只对有效权重指标评分，展示员工月度自评结果。
- Modify `web/src/views/task/components/MonthlyReviewReferencePanel.vue`
  - 统一术语并将历史作为次级参考信息。

### Web: HR monthly monitoring

- Create `web/src/views/admin/components/CycleMonthlyProgressPanel.vue`
  - 周期月度提交统计、逾期清单、筛选、重开确认与原因输入。
- Modify `web/src/views/admin/CycleManageView.vue`
  - 为已发起 v2 计划加载月度进度监控。
- Modify `web/src/views/admin/components/CycleWorkspaceShell.vue`
  - 在周期执行区呈现月度监控组件，不混入目标制定统计。

### Acceptance tests

- Modify `web/e2e/specs/12-goal-tracking-model.spec.ts`
  - 连续跟进、业务月份排序和术语。
- Modify `web/e2e/specs/28-monthly-review-responsive.spec.ts`
  - 简化员工表单、有效权重评分、PC/手机。
- Create `web/e2e/specs/34-monthly-self-evaluation-workflow.spec.ts`
  - 工作台、员工提交、主管评分、HR 重开与历史展示的接口模拟闭环。
- Create `api/test/suites/14-continuous-progress-monthly-self-evaluation.e2e-spec.ts`
  - 三个月服务端闭环、提醒门禁和重开。
- Create `api/src/period-reviews/monthly-repair-migration.spec.ts`
  - 校验修复 SQL 的限定谓词、审计和任务回退。

---

## API Contract Changes

### Goal tracking response

`GET /objectives/tracking/:cycleId` 的指标当前进展增加：

```ts
type GoalProgressSource = 'active_progress' | 'monthly_self_evaluation';

interface GoalTrackingLatestProgress {
  id: string;
  progress: number;
  healthStatus: ProgressHealthStatus;
  content: string;
  updatedAt: string;
  businessPeriodKey: string; // YYYY-MM
  source: GoalProgressSource;
}

interface GoalTrackingSummary {
  periodCount: number;
  employeeSubmittedCount: number;
  managerCompletedCount: number;
  indicatorCount: number;
  currentMonthUpdatedCount: number;
  currentPeriodKey: string | null;
}
```

`POST /objectives/indicators/:indicatorId/progress` 请求体收敛为：

```ts
interface UpdateIndicatorProgressInput {
  progress: number;
  healthStatus: ProgressHealthStatus;
  content: string;
  expectedLatestUpdateAt?: string;
}
```

### Monthly self-evaluation response

现有期次详情指标增加：

```ts
interface PeriodReviewIndicator {
  weight: number;
  isScoreRequired: boolean; // weight > 0
  monthlyProgressSource: 'draft_or_result' | 'active_progress' | 'none';
  progress: number | null;
  healthStatus: ProgressHealthStatus | null;
  employeeComment: string | null; // 页面名称“描述”，复用现有存储字段
  selfScore: number | null;
  managerScore: number | null;
  managerComment: string | null;
}
```

员工正式提交仍按全量指标传递，服务端规则为：

- 所有指标都必须有稳定 `indicatorId`，防止部分数组导致漏项或越权；
- `progress`、`healthStatus`、`employeeComment` 均可为 `null`；
- `weight > 0` 时 `selfScore` 必须为 0–100；
- `weight <= 0` 时 `selfScore` 必须为 `null`，旧数据中的 0 只读兼容展示为“不参与评分”。

### HR monitoring and reopen

```http
GET /assessment-periods/cycle/:cycleId/monitoring?periodKey=2026-09&status=employee_overdue&keyword=方园&page=1&pageSize=20
POST /assessment-periods/:periodId/reopen
```

```ts
interface ReopenPeriodReviewInput {
  reason: string;
  expectedVersion: number;
}

interface CyclePeriodMonitoringResult {
  summary: {
    periodInstanceCount: number;
    employeeSubmittedCount: number;
    managerCompletedCount: number;
    employeeOverdueCount: number;
  };
  items: Array<{
    periodId: string;
    periodKey: string;
    sequence: number;
    employee: { id: string; name: string; employeeNo: string | null };
    departmentName: string | null;
    managerName: string | null;
    status: AssessmentPeriodStatus;
    employeeDueAt: string | null;
    employeeSubmittedAt: string | null;
    managerSubmittedAt: string | null;
    managerScoreTotal: number | null;
    canReopen: boolean;
    reopenBlockedReason: string | null;
    draftVersion: number;
  }>;
  page: number;
  pageSize: number;
  total: number;
}
```

读取端点允许 `SysRole.hr`、`SysRole.system_admin`、`cycle_plan_edit` 或 `cycle_plan_review`。重开端点只允许 `SysRole.hr`、`SysRole.system_admin` 或 `cycle_plan_edit`；角色/能力组合遵循现有 Guard 的 OR 语义，不在服务内硬编码用户名称。

---

### Task 1: Lock the Business-Month Ordering Contract

**Files:**
- Create: `api/src/objectives/goal-tracking-progress.ts`
- Create: `api/src/objectives/goal-tracking-progress.spec.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `web/src/types/api.types.ts`

**Interfaces:**
- Consumes `IndicatorProgressUpdate.createdAt`, optional `period.periodKey`, optional `periodReviewRevisionId`, stable `id`.
- Produces `businessPeriodKey`, `source` and a deterministic descending order.

- [ ] **Step 1: Add failing pure ordering tests**

Create fixtures that prove a 2026-07 formal result submitted on September 3 is ordered after other July records but below every August record:

```ts
it('does not let a late July result replace August current progress', () => {
  const records = [
    progress({ id: 'aug-1', createdAt: '2026-08-20T02:00:00Z' }),
    progress({ id: 'jul-formal', createdAt: '2026-09-03T02:00:00Z', periodKey: '2026-07', formal: true }),
  ];

  expect(currentGoalProgress(records)?.id).toBe('aug-1');
  expect(sortGoalProgress(records).map((item) => item.id)).toEqual(['aug-1', 'jul-formal']);
});

it('uses Asia/Shanghai when an active submit crosses UTC month end', () => {
  expect(shanghaiMonthKey(new Date('2026-07-31T16:30:00.000Z'))).toBe('2026-08');
});
```

- [ ] **Step 2: Run the focused test and confirm the helper is missing**

Run:

```powershell
cd api
npm test -- --runInBand src/objectives/goal-tracking-progress.spec.ts
```

Expected: FAIL because the new helper module/functions do not exist.

- [ ] **Step 3: Implement the pure ordering helper**

Implement these exact rules:

1. Formal monthly record uses `period.periodKey`.
2. Active progress uses `createdAt` converted to `Asia/Shanghai` and formatted `YYYY-MM`.
3. Sort descending by business month, then `createdAt`, then `id`.
4. Source is formal only when the record is bound to a monthly result/revision; do not infer formal source from free-text content.

- [ ] **Step 4: Replace service-level `createdAt desc` selection**

Fetch the bounded progress collection needed for the cycle/indicator and select through `sortGoalProgress()`. Return `businessPeriodKey` and `source` in both overview and drawer history. Keep historical attachment metadata in the response; never copy attachments into a new active submit.

- [ ] **Step 5: Add service tests for stable mapping**

Test overview current value, drawer ordering, equal-timestamp ID tiebreak and formal source mapping. Assert that an old attachment remains readable but new progress mapping defaults `attachments` to `[]`.

- [ ] **Step 6: Run focused backend verification**

```powershell
npm test -- --runInBand src/objectives/goal-tracking-progress.spec.ts src/objectives/objectives.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the business-month foundation**

```powershell
git add api/src/objectives/goal-tracking-progress.ts api/src/objectives/goal-tracking-progress.spec.ts api/src/objectives/objectives.service.ts api/src/objectives/objectives.service.spec.ts web/src/types/api.types.ts
git commit -m "fix(performance): order progress by business month"
```

---

### Task 2: Keep Ordinary Goal Progress Open and Lightweight

**Files:**
- Modify: `api/src/objectives/dto/update-indicator-progress.dto.ts`
- Modify: `api/src/objectives/objectives.controller.ts`
- Modify: `api/src/objectives/objectives.service.ts`
- Modify: `api/src/objectives/objectives.service.spec.ts`
- Modify: `web/src/api/objectives.api.ts`
- Modify: `web/src/views/performance/GoalTrackingDetailDrawer.vue`
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`

**Interfaces:**
- Request contains only status, progress, description and optional concurrency timestamp.
- Authorization is derived from cycle lifecycle/publication and indicator ownership, not the coarse task stage.

- [ ] **Step 1: Add failing backend authorization and DTO tests**

Cover these cases:

- employee can update during another month's `manager_scoring`;
- employee can update after their current month employee submit while manager is pending;
- employee cannot update an unopened cycle, a published cycle, another employee's indicator or an inactive/deleted indicator;
- request with `attachments` is rejected by validation;
- stale `expectedLatestUpdateAt` returns the existing conflict response.

- [ ] **Step 2: Run the objective service spec**

```powershell
cd api
npm test -- --runInBand src/objectives/objectives.service.spec.ts
```

Expected: FAIL because `canEdit` still depends on self-evaluation task status and the DTO still accepts attachments.

- [ ] **Step 3: Change the edit predicate**

Create one private predicate used by overview, detail and mutation:

```ts
canSubmitActiveProgress =
  cycle.workflowVersion === 2 &&
  cycle.openedAt !== null &&
  cycle.publishedAt === null &&
  task.publishedAt === null &&
  task.employeeId === actor.id;
```

Also retain existing tenant/company, active indicator and data-scope checks. Do not use `task.status` or `task.selfEvalSubmittedAt` in this predicate.

- [ ] **Step 4: Narrow the mutation body**

Remove `attachments` from `UpdateIndicatorProgressDto` and Web request type. Create active records with an empty attachment array/default. Keep response typing for historical attachments.

- [ ] **Step 5: Simplify the drawer editor**

Remove the rich formatting toolbar and upload action from the active progress editor. Keep:

- status select;
- numeric 0–100 progress;
- plain multiline description;
- single “更新进展” action.

Do not delete old attachment display from history entries.

- [ ] **Step 6: Add Playwright request assertions**

Assert the mocked request body contains only `progress`, `healthStatus`, `content`, `expectedLatestUpdateAt`, and that the editor remains enabled when the monthly task is waiting for manager score.

- [ ] **Step 7: Run focused backend and Web checks**

```powershell
cd api
npm test -- --runInBand src/objectives/objectives.service.spec.ts
cd ..\web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/12-goal-tracking-model.spec.ts
```

Expected: both PASS.

- [ ] **Step 8: Commit the lightweight progress flow**

```powershell
git add api/src/objectives web/src/api/objectives.api.ts web/src/views/performance/GoalTrackingDetailDrawer.vue web/e2e/specs/12-goal-tracking-model.spec.ts
git commit -m "feat(performance): keep goal progress continuously editable"
```

---

### Task 3: Simplify Employee Monthly Self-Evaluation and Autofill Same-Month Progress

**Files:**
- Modify: `api/src/period-reviews/dto/save-employee-period-review-draft.dto.ts`
- Modify: `api/src/period-reviews/dto/submit-employee-period-review.dto.ts`
- Modify: `api/src/period-reviews/period-review.types.ts`
- Modify: `api/src/period-reviews/period-review-labels.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`

**Interfaces:**
- Reuses `employeeComment` as the persisted “描述” field.
- `monthlyProgressSource` tells Web whether values came from saved monthly work, same-month active progress, or neither.

- [ ] **Step 1: Add failing detail/autofill tests**

Test this priority for each indicator:

1. existing monthly draft/result;
2. latest active progress whose Asia/Shanghai month equals `periodKey`;
3. all status/progress/description fields `null`, source `none`.

Also prove August active progress does not prefill September and a July formal result submitted in September does not count as September active progress.

- [ ] **Step 2: Add failing submission validation tests**

Cover:

- effective indicator accepts null status/progress/description when self-score exists;
- effective indicator rejects missing self-score;
- zero-weight indicator accepts only null self-score;
- old zero-weight stored score 0 is returned as null plus `isScoreRequired: false`;
- submission may contain unchanged/unfilled progress for all indicators;
- submission remains whole-month and rejects missing/unknown/duplicate indicator IDs;
- idempotency and `draftVersion` conflict behavior remain intact.

- [ ] **Step 3: Run the failing service spec**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
```

Expected: FAIL on required progress/status and zero-weight score handling.

- [ ] **Step 4: Implement same-month prefill without persistence**

In `getReview()`, load active progress for each indicator within the period's Asia/Shanghai month boundaries. Convert the boundary to UTC before querying. Prefill only the response when no saved monthly value exists; opening the page must not write a draft, revision or progress event.

- [ ] **Step 5: Implement effective-weight validation**

Define one shared helper:

```ts
const isScoreRequired = decimalToNumber(item.weight) > 0;
```

Use it for employee validation, response projection and later manager validation/aggregation. Reject a supplied non-null zero-weight score instead of silently counting it.

- [ ] **Step 6: Write formal progress only when content exists**

On employee submission:

- always update the monthly review row and create an employee revision snapshot;
- create `IndicatorProgressUpdate` only for an indicator where at least one of status/progress/description is non-null;
- bind that progress row to the period and employee revision;
- never invent a fallback summary string;
- never create an empty progress row just to prove the month was submitted.

- [ ] **Step 7: Update terminology labels**

Replace backend-facing “月度复盘”“复盘与评分”“月度跟进” with “月度自评” for the employee formal task and “主管月度评分” for the manager task. Do not rename database enum values.

- [ ] **Step 8: Run focused service tests**

```powershell
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the monthly employee contract**

```powershell
git add api/src/period-reviews
git commit -m "feat(performance): simplify monthly self evaluation"
```

---

### Task 4: Gate Manager Scoring and Calculate Complete-Period Totals

**Files:**
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/period-reviews/period-aggregation.service.ts`
- Modify: `api/src/period-reviews/period-aggregation.service.spec.ts`
- Modify: `api/src/tasks/team-tasks.service.ts`
- Modify: `api/src/tasks/team-tasks.service.spec.ts`

**Interfaces:**
- Manager draft and submit require `employeeSubmittedAt != null`.
- Month total and quarter total use the same effective-weight predicate.

- [ ] **Step 1: Add failing manager gate tests**

Assert manager draft, manager submit and team pending list all reject/omit a period whose status is `manager_scoring` but `employeeSubmittedAt` is null. Keep a regression case for the known scheduler-corrupted state.

- [ ] **Step 2: Add failing weight/aggregation tests**

```ts
it('ignores zero-weight indicators and rounds the manager monthly total to two decimals', ...);
it('returns no quarterly total while any required period lacks employee submission', ...);
it('returns no quarterly total while any required period lacks manager submission or total', ...);
it('does not exclude no_result or average only completed periods', ...);
it('averages all three completed monthly totals and rounds to two decimals', ...);
```

- [ ] **Step 3: Run focused specs and observe current failures**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts src/period-reviews/period-aggregation.service.spec.ts src/tasks/team-tasks.service.spec.ts
```

Expected: FAIL because manager draft/submit currently bypass employee submission and aggregation filters missing months.

- [ ] **Step 4: Enforce manager eligibility**

Use a single `assertManagerEditable(period, requireEmployeeSubmission = true)` path for both draft and submit. Do not advance a corrupted period as a side effect; return the existing conflict/business error and let migration/HR state repair handle it.

- [ ] **Step 5: Calculate monthly total from effective indicators**

Require a score for every positive-weight frozen indicator, reject scores for zero-weight indicators, normalize by the sum of positive weights, and round with the existing Decimal helper to two decimal places. Preserve manager comments as optional.

- [ ] **Step 6: Make quarterly result all-or-nothing**

Load all required period schedules/periods in `sequence` order. Return no total and do not advance downstream workflow until every period satisfies:

```ts
period.employeeSubmittedAt !== null &&
period.managerSubmittedAt !== null &&
period.managerScoreTotal !== null &&
period.lockedAt !== null
```

Do not interpret `no_result` as complete. Average all required monthly totals with equal month weight.

- [ ] **Step 7: Run focused specs**

```powershell
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts src/period-reviews/period-aggregation.service.spec.ts src/tasks/team-tasks.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit scoring correctness**

```powershell
git add api/src/period-reviews api/src/tasks/team-tasks.service.ts api/src/tasks/team-tasks.service.spec.ts
git commit -m "fix(performance): gate and aggregate monthly scores"
```

---

### Task 5: Stop Automatic Advancement and Add Idempotent Monthly Reminders

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260903000001_monthly_notification_dedupe/migration.sql`
- Create: `api/prisma/migrations/20260903000002_restore_unsubmitted_months/migration.sql`
- Create: `api/src/period-reviews/monthly-reminder-policy.ts`
- Create: `api/src/period-reviews/monthly-reminder-policy.spec.ts`
- Create: `api/src/period-reviews/monthly-repair-migration.spec.ts`
- Modify: `api/src/notifications/notifications.service.ts`
- Modify: `api/src/notifications/notifications.service.spec.ts`
- Modify: `api/src/scheduler/scheduler.service.ts`
- Modify: `api/src/scheduler/scheduler.service.spec.ts`

**Interfaces:**
- `NotificationLog.dedupeKey` uniquely identifies recipient, period, reminder kind and Shanghai calendar date.
- Scheduler never changes `self_eval` to `manager_scoring` solely because a due date passed.

- [ ] **Step 1: Add pure reminder-policy tests**

Given employee due date, current Shanghai date and employee submission state, expect:

- 3 days before: `due_soon_3`;
- due date: `due_today`;
- 1 day overdue: `overdue_1`;
- 4, 7, 10 days overdue: `overdue_every_3`;
- other days or submitted: `null`.

Include UTC inputs that fall on adjacent Shanghai dates.

- [ ] **Step 2: Add failing scheduler tests**

Assert:

- overdue employee period remains `self_eval`;
- task is not advanced by deadline;
- due-soon/due-day message goes to employee;
- overdue message goes to employee and frozen `managerId`;
- HR receives no per-person notification;
- disabled external notification still leaves period/task queryable as overdue;
- workflow v2 monthly periods do not also receive old generic cycle reminder.

- [ ] **Step 3: Add failing notification idempotency tests**

Use a deterministic key such as:

```ts
monthly-self-eval:period-1:user-1:overdue-1:2026-09-02
```

Test duplicate successful calls produce one log/push, failed delivery can be atomically reclaimed and retried, and two concurrent calls cannot both deliver.

- [ ] **Step 4: Add migration contract tests before SQL**

The test reads both migration files and asserts the repair migration contains all restrictive predicates:

- workflow v2/monthly period join;
- `status = 'manager_scoring'`;
- `employee_submitted_at IS NULL`;
- `manager_submitted_at IS NULL`;
- `locked_at IS NULL`;
- cycle/task not published;
- audit insertion with action `monthly_period_state_repaired`;
- task rollback only for tasks that own repaired periods.

It must also assert the migration does not update period schedule dates and does not use a cycle-name wildcard.

- [ ] **Step 5: Run the new tests and verify failure**

```powershell
cd api
npm test -- --runInBand src/period-reviews/monthly-reminder-policy.spec.ts src/period-reviews/monthly-repair-migration.spec.ts src/notifications/notifications.service.spec.ts src/scheduler/scheduler.service.spec.ts
```

Expected: FAIL because the policy/schema/migrations are absent and scheduler still auto-advances.

- [ ] **Step 6: Add notification dedupe schema and service behavior**

Create a nullable unique column so historical rows need no backfill. In `NotificationsService`, insert/claim the key transactionally:

- existing `sent` or `pending`: return without another delivery;
- existing `failed`: conditional update to `pending`, then retry;
- unique-race loser: re-read and follow the same state rule.

Do not mark a failed row as sent without a successful channel call.

- [ ] **Step 7: Replace automatic opening logic with reminder-only logic**

Remove `runPeriodManagerOpenings()` from scheduler execution and delete/deactivate its deadline transition code. Keep scheduled self-evaluation opening. Query employee-unsubmitted periods and use the pure reminder policy; build dedupe keys with period ID, recipient ID, kind and Shanghai date.

- [ ] **Step 8: Write the targeted state-repair migration**

Use PostgreSQL CTEs so the exact repaired period IDs drive both audit rows and task updates. Store old/new status, actor=`system_migration`, migration identifier and reason in audit detail JSON. Do not touch scores, revisions, progress records or schedule dates.

- [ ] **Step 9: Validate Prisma and focused specs**

```powershell
npx prisma validate
npm test -- --runInBand src/period-reviews/monthly-reminder-policy.spec.ts src/period-reviews/monthly-repair-migration.spec.ts src/notifications/notifications.service.spec.ts src/scheduler/scheduler.service.spec.ts
```

Expected: schema valid and all tests PASS.

- [ ] **Step 10: Commit scheduler, notification and repair changes**

```powershell
git add api/prisma api/src/period-reviews/monthly-reminder-policy.ts api/src/period-reviews/monthly-reminder-policy.spec.ts api/src/period-reviews/monthly-repair-migration.spec.ts api/src/notifications api/src/scheduler
git commit -m "fix(performance): remind without auto advancing months"
```

---

### Task 6: Add Controlled Pre-Publication Month Reopen

**Files:**
- Create: `api/src/period-reviews/dto/reopen-period-review.dto.ts`
- Modify: `api/src/period-reviews/period-reviews.controller.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`
- Modify: `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.module.ts`
- Modify: `api/src/flow/flow.service.ts`
- Modify: `api/src/flow/flow.service.spec.ts`
- Modify: `api/src/notifications/notifications.service.ts`

**Interfaces:**
- `POST /assessment-periods/:periodId/reopen` with required `reason` and `expectedVersion`.
- Requires HR administrator or `cycle_plan_edit`; rejects public results.

- [ ] **Step 1: Add failing authorization and publication tests**

Cover:

- `hr_user` with `cycle_plan_edit` can reopen;
- `SysRole.hr` and `SysRole.system_admin` can reopen;
- HR viewer with only `cycle_plan_review` cannot reopen;
- manager and employee cannot reopen;
- reject when any of cycle, task or grade result is published;
- reject before manager submit/lock because normal manager return must be used;
- stale `expectedVersion` changes nothing.

- [ ] **Step 2: Add failing transaction-state tests**

For a locked month after downstream review, assert one successful transaction:

- period becomes `self_eval` and clears employee/manager submit times, lock and both totals;
- current employee values/self-scores remain;
- current manager scores/comments are null;
- task returns to `self_eval` and current downstream timestamps are null;
- current `GradeResult` calculated/current grade, coefficient, veto, calibration, approval and employee confirmation values are null;
- employee/manager revisions, flow records and audit records are not deleted;
- another month is unchanged;
- new audit contains actor, reason, old status/totals and new status;
- employee receives one idempotent reopen notification.

- [ ] **Step 3: Run focused failing specs**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts src/flow/flow.service.spec.ts
```

Expected: FAIL because the endpoint and rollback transition do not exist.

- [ ] **Step 4: Implement DTO, Guard metadata and service authorization**

Use existing controller convention:

```ts
@Roles(SysRole.hr, SysRole.system_admin)
@HrCapabilities(HrCapability.cycle_plan_edit)
```

Validate trimmed reason length 1–2000 and nonnegative integer `expectedVersion`. Recheck authorization and publication inside the service/transaction rather than relying only on route metadata.

- [ ] **Step 5: Implement a serializable/CAS reopen transaction**

Lock or conditionally update the target period by ID, expected version, `completed` status and non-null `lockedAt`. Increment `draftVersion` once. Update period reviews, task and grade result in the same transaction. If another request wins, return conflict without duplicated audit/notification.

- [ ] **Step 6: Preserve workflow history while restoring current node**

For current task nodes `manager_scoring`, `dept_review`, `hr_calibration` or `approval`, record a `withdraw` transition to `self_eval`. If task is already `self_eval` because another month was reopened, append an explicit FlowRecord/AuditLog for this month without attempting an invalid duplicate state transition.

- [ ] **Step 7: Notify after transaction commit**

Use `period-reopened:<periodId>:<newDraftVersion>:<employeeId>` as dedupe key. Notification title/body uses “月度自评已重新开放” and includes the month and HR reason. Route metadata includes task ID and period ID.

- [ ] **Step 8: Run focused tests**

```powershell
npm test -- --runInBand src/period-reviews/period-reviews.service.spec.ts src/flow/flow.service.spec.ts src/notifications/notifications.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit controlled reopen**

```powershell
git add api/src/period-reviews api/src/flow api/src/notifications
git commit -m "feat(performance): allow controlled monthly reopen"
```

---

### Task 7: Add HR Cycle Monthly Progress Monitoring

**Files:**
- Create: `api/src/period-reviews/dto/query-period-monitoring.dto.ts`
- Create: `api/src/period-reviews/period-monitoring.service.ts`
- Create: `api/src/period-reviews/period-monitoring.service.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.controller.ts`
- Modify: `api/src/period-reviews/period-reviews.module.ts`
- Modify: `api/src/period-reviews/period-review.types.ts`

**Interfaces:**
- `GET /assessment-periods/cycle/:cycleId/monitoring` returns summary and paginated detail.
- Data source is frozen cycle participants/tasks/periods; no DingTalk organization query.

- [ ] **Step 1: Add failing monitoring-service tests**

Test summary counts and list projection for:

- employee pending before due;
- employee overdue after due;
- employee submitted/manager pending;
- manager completed;
- one employee with three period instances;
- filters by period, derived status and employee keyword;
- deterministic ordering: period sequence, overdue priority, employee number/name, period ID;
- pagination total independent from page size;
- read capability allowed while `canReopen` remains false without edit capability.

- [ ] **Step 2: Run the missing-service spec**

```powershell
cd api
npm test -- --runInBand src/period-reviews/period-monitoring.service.spec.ts
```

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement query parsing and derived statuses**

Allowed filters:

```ts
type MonitoringStatus =
  | 'employee_pending'
  | 'employee_overdue'
  | 'manager_pending'
  | 'manager_completed';
```

Derive overdue from `employeeSubmittedAt === null` and Shanghai current time after `employeeDueAt`; do not persist a second overdue status.

- [ ] **Step 4: Implement data-scope and permission projection**

Check company/tenant and cycle access before querying. Use frozen manager/participant/task data. Compute `canReopen` from both actor permission and row state/publication; return a business `reopenBlockedReason` for UI instead of exposing internal authorization codes.

- [ ] **Step 5: Add controller route and module wiring**

Apply read metadata for HR roles plus `cycle_plan_edit`/`cycle_plan_review`. Pass actor identity to service so data scope is enforced consistently.

- [ ] **Step 6: Run focused and module tests**

```powershell
npm test -- --runInBand src/period-reviews/period-monitoring.service.spec.ts src/period-reviews/period-reviews.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit monitoring API**

```powershell
git add api/src/period-reviews
git commit -m "feat(performance): expose monthly progress monitoring"
```

---

### Task 8: Make Workbench Stage and Month Progress Accurate

**Files:**
- Modify: `api/src/tasks/tasks.service.ts`
- Modify: `api/src/tasks/tasks.service.spec.ts`
- Modify: `web/src/views/task/task-stage.ts`
- Modify: `web/src/views/task/task-stage.spec.ts`
- Modify: `web/src/views/dashboard/DashboardView.vue`
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/components/layout/notification-target.ts`

**Interfaces:**
- Server returns periods in sequence with explicit submission timestamps.
- Client selects the oldest opened employee-unsubmitted period; no compatibility guess from `manager_scoring` alone.

- [ ] **Step 1: Add failing backend task projection tests**

Assert `findMine()` returns period count, employee submitted count and ordered period rows. A task-level `manager_scoring` value must not rewrite an unopened or employee-unsubmitted period.

- [ ] **Step 2: Add failing pure client stage tests**

Required outputs:

```ts
// oldest open missing month
{ title: '2026年7月月度自评', meta: '第1/3期 · 已提交 0/3', action: '填写月度自评' }

// September employee submitted, manager pending
{ title: '2026年9月月度自评', meta: '第3/3期 · 已提交 3/3', action: '等待主管月度评分' }

// employee done this month, next month unopened
{ action: '更新目标进展', hint: '下一期月度自评尚未开放' }
```

Also prove “结果确认” is not returned before actual publication/employee confirmation stage.

- [ ] **Step 3: Run focused tests and verify stage failures**

```powershell
cd api
npm test -- --runInBand src/tasks/tasks.service.spec.ts
cd ..\web
npm test -- --runInBand src/views/task/task-stage.spec.ts
```

If Web has no unit-test script for this file, execute the repository's existing TypeScript contract runner used by `task-stage.spec.ts`; do not add a second test framework. Expected: new assertions fail on current coarse-state logic.

- [ ] **Step 4: Implement server and pure stage projection**

Select in this order:

1. oldest opened employee-unsubmitted period;
2. latest employee-submitted manager-unsubmitted period for waiting status;
3. next unopened period plus continuous progress action;
4. downstream review/published result only when the explicit stage warrants it.

Use `period.sequence`, not date-string sorting.

- [ ] **Step 5: Render exact month/progress copy**

Update Dashboard and Task Detail headings/buttons. The workbench card must name the month and show `第x/y期 · 已提交 n/y`. Keep the cycle name as secondary context.

- [ ] **Step 6: Route period notifications precisely**

Use notification metadata `{ taskId, periodId, action }` so opening a reminder or reopen message selects the specified period. Retain task fallback only for historical notifications without period ID.

- [ ] **Step 7: Run focused API, type and UI contract checks**

```powershell
cd api
npm test -- --runInBand src/tasks/tasks.service.spec.ts
cd ..\web
npm run type-check
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts --grep "工作台|月份|等待主管"
```

Expected: PASS.

- [ ] **Step 8: Commit workbench accuracy**

```powershell
git add api/src/tasks web/src/views/task web/src/views/dashboard web/src/components/layout/notification-target.ts web/src/types/api.types.ts web/e2e/specs/28-monthly-review-responsive.spec.ts
git commit -m "fix(performance): show exact monthly task stage"
```

---

### Task 9: Refocus Goal Tracking on Current State and Secondary History

**Files:**
- Modify: `web/src/views/performance/goal-tracking.ts`
- Modify: `web/src/views/performance/GoalTrackingCyclePanel.vue`
- Modify: `web/src/views/performance/GoalTrackingDetailDrawer.vue`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`

**Interfaces:**
- Consumes server-provided `businessPeriodKey`, `source` and summary counts.
- Does not re-sort records by browser locale or infer source from description.

- [ ] **Step 1: Add failing model/UI assertions**

Assert the overview renders:

- `月度自评已提交 2/3`;
- `本月目标已更新 1/3`;
- `主管月度评分已完成 0/3`;
- current goal card sourced from the newest business month;
- one compact current record;
- monthly history collapsed by default with the latest group first;
- formal indicator version history remains in its existing separate tab.

- [ ] **Step 2: Run the current goal-tracking Playwright spec**

```powershell
cd web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/12-goal-tracking-model.spec.ts
```

Expected: FAIL on old “期次进度/月度跟进” copy and fully expanded timeline.

- [ ] **Step 3: Replace overview summary**

Render the three business metrics from API counts. When no current period is open, show a neutral explicit phrase instead of `0/0`. Do not add a fourth synonym for task completion.

- [ ] **Step 4: Restructure drawer disclosure**

The top card contains current status, progress, description, business month, source label and update action. Below it, add a collapsed “历史目标进展（n）”; group entries by `businessPeriodKey`, with monthly self-evaluation result visually stronger than active updates inside the same month.

- [ ] **Step 5: Keep current action independent from monthly submission**

`selectTrackingAction()` must return “更新进展” throughout the open/unpublished cycle. If employee has an open monthly task, also expose a separate “填写月度自评” action; do not replace continuous tracking with the monthly action.

- [ ] **Step 6: Run Playwright and type-check**

```powershell
npm run type-check
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/12-goal-tracking-model.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the goal-tracking presentation**

```powershell
git add web/src/views/performance web/src/types/api.types.ts web/e2e/specs/12-goal-tracking-model.spec.ts
git commit -m "feat(performance): focus tracking on current progress"
```

---

### Task 10: Deliver Employee, Manager and HR Monthly Interfaces

**Files:**
- Modify: `web/src/api/period-reviews.api.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`
- Modify: `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`
- Modify: `web/src/views/task/components/MonthlyReviewReferencePanel.vue`
- Create: `web/src/views/admin/components/CycleMonthlyProgressPanel.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/e2e/specs/28-monthly-review-responsive.spec.ts`
- Create: `web/e2e/specs/34-monthly-self-evaluation-workflow.spec.ts`

**Interfaces:**
- Employee form submits all indicator IDs but only requires scores for `isScoreRequired` items.
- HR reopen dialog sends reason and current `draftVersion`.

- [ ] **Step 1: Add failing employee responsive tests**

On PC and mobile assert:

- page title uses `2026年9月月度自评`;
- each goal shows only status, progress, description and self-score;
- problem reason, next-month plan, support-needed, supplementary explanation and upload are absent from the active form;
- `monthlyProgressSource = none` shows “本月未更新” without a validation error;
- positive-weight score is required;
- zero-weight goal shows “不参与评分” and no score input;
- submitting after updating only one goal is allowed when all effective scores are present.

- [ ] **Step 2: Add failing manager tests**

Assert manager UI is hidden/blocked before employee submit, shows the frozen employee monthly result afterward, requires positive-weight manager scores only, treats comment as optional and displays auto-calculated monthly total.

- [ ] **Step 3: Add failing HR monitoring/reopen tests**

Route-mock monitoring and reopen APIs. Assert:

- summary cards and overdue list render;
- month/status/keyword filters become query parameters;
- reviewer-only HR sees no reopen button;
- editor/admin sees reopen only on eligible locked rows;
- confirmation dialog requires a reason and sends `expectedVersion`;
- success refreshes monitoring and shows “月度自评已重新开放”;
- published row explains “公示后请走结果更正流程” and cannot reopen.

- [ ] **Step 4: Run both Playwright specs and confirm current failures**

```powershell
cd web
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts e2e/specs/34-monthly-self-evaluation-workflow.spec.ts
```

Expected: FAIL on old heavy employee form and missing HR monitoring UI.

- [ ] **Step 5: Simplify employee form state and validation**

Map `employeeComment` to the visible label “描述”. Keep hidden legacy fields in read-only historical projection only; do not include them in new save/submit requests. Build validation from `isScoreRequired`, not raw truthiness of `weight` or existing self-score.

- [ ] **Step 6: Correct manager workspace**

Render employee status/progress/description/self-score as reference. Create manager score inputs only for effective indicators. Compute preview through the same normalized positive-weight formula, while treating server total as authoritative after submission.

- [ ] **Step 7: Build the HR monthly progress panel**

Use a compact summary plus filterable table/card layout. PC uses table; mobile uses stacked employee-period cards. Reopen is an explicit row action with a reason dialog and consequence copy: “将清除当前主管评分及未公示的下游结果，员工需重新提交，主管需重新评分；历史记录保留。”

- [ ] **Step 8: Integrate the panel into cycle execution**

Load it only for launched v2 cycles with periods. Keep goal-preparation metrics in their existing preparation section. Do not label HR monitoring as a notification inbox.

- [ ] **Step 9: Run Web verification**

```powershell
npm run type-check
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/28-monthly-review-responsive.spec.ts e2e/specs/34-monthly-self-evaluation-workflow.spec.ts
```

Expected: PASS on desktop and mobile projects configured in Playwright.

- [ ] **Step 10: Commit all three role interfaces**

```powershell
git add web/src/api/period-reviews.api.ts web/src/types/api.types.ts web/src/views/task/components web/src/views/admin web/e2e/specs/28-monthly-review-responsive.spec.ts web/e2e/specs/34-monthly-self-evaluation-workflow.spec.ts
git commit -m "feat(performance): deliver monthly self evaluation workspaces"
```

---

### Task 11: Prove the Three-Month Workflow and Prepare a Reversible Release

**Files:**
- Create: `api/test/suites/14-continuous-progress-monthly-self-evaluation.e2e-spec.ts`
- Modify: affected tests only if the integrated contract exposes a real mismatch; do not weaken assertions to make the suite green.
- Create during release preparation: a timestamped database backup outside the repository and a deployment record using the existing release procedure.

**Interfaces:**
- Acceptance plan: `2026 Q3 季度考核（902LW测试）`.
- Acceptance account: 方园, employee number 319.
- Production mutation remains gated by a fresh explicit user instruction.

- [ ] **Step 1: Add an integrated API test before final implementation cleanup**

The test must execute:

1. open July employee period;
2. submit active progress multiple times and preserve each event;
3. open monthly self-evaluation with same-month prefill;
4. submit with one goal having no monthly progress and all effective self-scores;
5. verify manager cannot act before employee submit in a separate August fixture;
6. submit manager scores and calculate July total;
7. repeat all required periods and calculate quarter total only after September manager submit;
8. reopen August as capable HR before publication, preserve revisions, clear current downstream result, resubmit and rescore;
9. publish and prove reopen is rejected;
10. prove the existing post-publication appeal path changes only allowed grade/coefficient fields.

- [ ] **Step 2: Run the integrated test and fix only contract gaps**

```powershell
cd api
npm test -- --runInBand test/suites/14-continuous-progress-monthly-self-evaluation.e2e-spec.ts
```

Expected: PASS. If setup infrastructure is unavailable, report the exact missing dependency; do not replace this with mocked unit-test evidence.

- [ ] **Step 3: Run the complete focused regression set**

```powershell
cd api
npx prisma validate
npm test -- --runInBand src/objectives/goal-tracking-progress.spec.ts src/objectives/objectives.service.spec.ts src/period-reviews/period-reviews.service.spec.ts src/period-reviews/period-aggregation.service.spec.ts src/period-reviews/monthly-reminder-policy.spec.ts src/period-reviews/monthly-repair-migration.spec.ts src/period-reviews/period-monitoring.service.spec.ts src/notifications/notifications.service.spec.ts src/scheduler/scheduler.service.spec.ts src/tasks/tasks.service.spec.ts src/tasks/team-tasks.service.spec.ts src/flow/flow.service.spec.ts
npm run build
cd ..\web
npm run type-check
npm run build
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/12-goal-tracking-model.spec.ts e2e/specs/28-monthly-review-responsive.spec.ts e2e/specs/34-monthly-self-evaluation-workflow.spec.ts
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform a read-only production preflight**

Before any deployment, record:

- current local `main`, `origin/main` and deployed revision;
- clean/dirty worktree and exact commits included;
- health endpoints and current API/Web image identifiers;
- migration status;
- count and IDs of rows that the repair migration would affect;
- for 方园 319, each period's `periodKey`, status, employee/manager submitted times, lock and totals;
- `ENABLE_TEST_QUICK_LOGIN` current setting without printing secrets.

The repair preview query must use the same predicates as the migration. If it includes a submitted, locked or published period, stop and correct the migration before seeking release authorization.

- [ ] **Step 5: Present release candidate and request explicit authorization**

Report code commit range, test evidence, exact number of repair rows, rollback plan and any known data anomaly such as the deliberately unchanged test schedule. Wait for a fresh user message explicitly authorizing production deployment.

- [ ] **Step 6: After authorization, back up and deploy through the existing production procedure**

Create a timestamped PostgreSQL backup, verify its size/nonzero status, tag or record the currently deployed images/commit, apply migrations once, deploy API and Web from the reviewed `main`, and ensure `ENABLE_TEST_QUICK_LOGIN` is disabled after acceptance.

- [ ] **Step 7: Verify real online behavior by role**

Using the formal online address and actual account/controlled acceptance access:

- employee 方园 sees the correct month and `已提交 n/3`;
- an unsubmitted month remains employee self-evaluation and never appears as manager-ready;
- ordinary progress remains editable and current status follows business month;
- employee form allows empty progress content but requires effective self-scores;
- manager scores only after employee submit and total is automatic;
- HR monitoring counts match database rows;
- authorized HR reopen works before publication and is blocked after publication;
- notification routes open the exact month;
- public/health routes are healthy.

- [ ] **Step 8: Verify repair and rollback evidence**

Compare post-deploy repaired IDs to the preflight set, confirm one audit row per repaired period, confirm no schedule dates changed, and confirm no history rows were deleted. Keep backup path, prior revision/image IDs and migration result in the release record.

- [ ] **Step 9: Commit the integrated acceptance test and any verified contract-only adjustments**

```powershell
git add api/test/suites/14-continuous-progress-monthly-self-evaluation.e2e-spec.ts
git commit -m "test(performance): cover monthly self evaluation lifecycle"
```

Do not include production backups, secrets, generated screenshots or deployment logs in Git.

---

## Final Self-Review Checklist

- [ ] Search user-visible code and new tests for forbidden/obsolete terms in this flow:

```powershell
rg -n "月度归档|归档结果|mark|月度复盘|复盘与评分" api/src web/src web/e2e/specs/12-goal-tracking-model.spec.ts web/e2e/specs/28-monthly-review-responsive.spec.ts web/e2e/specs/34-monthly-self-evaluation-workflow.spec.ts
```

Expected: no newly introduced user-visible obsolete term; any historical compatibility key is documented and not rendered.

- [ ] Search for implementation-plan placeholders:

```powershell
rg -n "T[B]D|T[O]DO|F[I]XME|add appropriat[e]|as neede[d]|e[t]c\." docs/superpowers/plans/2026-09-03-continuous-goal-progress-and-monthly-self-evaluation.md
```

Expected: no matches.

- [ ] Confirm all totals use positive weights only and no client recomputation overrides server results.
- [ ] Confirm no scheduler path updates `self_eval` to `manager_scoring` without employee submission.
- [ ] Confirm all reopened months preserve revisions, flow history and audit logs.
- [ ] Confirm publication checks cover cycle, task and grade result.
- [ ] Confirm workflow v1 regression tests remain green.
- [ ] Confirm no code or migration changes the `2026 Q3 季度考核（902LW测试）` schedule dates.
- [ ] Confirm the release step remained unexecuted until explicit production authorization.
