# Goal Detail Entry And Business History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让指标卡片标题区可打开详情，并把技术化指标版本展示改为员工和直属上级可理解的当前目标依据与目标变更记录。

**Architecture:** 保留现有 `openIndicator` 事件和正式审计数据投影。卡片标题区复用同一事件；版本投影增加纯展示字段，详情抽屉只消费业务标签，不改接口和数据库。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Playwright

**Spec:** `docs/superpowers/specs/2026-09-03-business-readable-indicator-history.md`

## Global Constraints

- 仅改 Web 展示与交互，不改变 API、数据库、权限或流程状态。
- 保留现有显式“查看详情/更新进展”按钮。
- 日常进展和月度自评不得进入正式目标变更记录。
- 普通界面不显示 `V1`、`审批基线`等技术术语。
- PC 与 390px 手机宽度均不得产生横向溢出。

---

### Task 1: 卡片标题区详情入口

**Files:**
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`
- Modify: `web/src/views/objectives/GoalTrackingCyclePanel.vue`

**Interfaces:**
- Consumes: 现有 `openIndicator(indicatorId: string)` 事件。
- Produces: `goal-tracking-indicator-summary-${item.id}` 原生按钮，触发同一详情抽屉。

- [ ] **Step 1: Write the failing test**

在真实目标跟进页面测试中点击 `goal-tracking-indicator-summary-indicator-1`，断言指标详情抽屉打开且标题为 `GMV 达成率`；现有操作按钮仍显示 `更新9月进展`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- --grep "employee opens a real indicator drawer"`

Expected: FAIL because `goal-tracking-indicator-summary-indicator-1` does not exist.

- [ ] **Step 3: Write minimal implementation**

把卡片标题中的序号、名称和描述包入原生按钮：

```vue
<button
  type="button"
  class="tracking-goal-card__summary"
  :data-testid="`goal-tracking-indicator-summary-${item.id}`"
  :aria-label="`查看${item.title}详情`"
  @click="emit('openIndicator', item.id)"
>
  <span class="tracking-goal-card__index">{{ index + 1 }}</span>
  <span class="tracking-goal-card__copy">
    <strong>{{ item.title }}</strong>
    <span>{{ item.description || item.scoringStandard || '暂无目标说明' }}</span>
  </span>
</button>
```

只为该标题按钮增加悬停和 `:focus-visible` 样式，并把原通用卡片按钮样式收窄到操作按钮。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- --grep "employee opens a real indicator drawer"`

Expected: PASS.

### Task 2: 当前目标依据与业务化目标变更记录

**Files:**
- Modify: `web/e2e/specs/12-goal-tracking-model.spec.ts`
- Modify: `web/e2e/specs/09-performance-workspace.spec.ts`
- Modify: `web/src/views/objectives/indicator-version-history.ts`
- Modify: `web/src/views/objectives/GoalTrackingDetailDrawer.vue`

**Interfaces:**
- Consumes: `buildIndicatorVersionHistory(records)` 的正式记录过滤、排序和差异字段。
- Produces: `businessLabel: string`、`currentBasisLabel: string`，供详情抽屉展示。

- [ ] **Step 1: Write the failing model and browser assertions**

为包含首次确认与一次正式调整的记录断言：当前记录为 `目标已调整（第1次）`、当前依据为 `当前按第2版目标执行`，首次记录为 `目标已确认`。浏览器断言“当前目标依据”和“目标变更记录”可见，且不再显示 `V1`、`审批基线`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- 12-goal-tracking-model.spec.ts --grep "formal indicator versions"`

Run: `npm run test:e2e -- --grep "employee opens a real indicator drawer"`

Expected: FAIL because business labels and current-basis presentation are absent.

- [ ] **Step 3: Write minimal implementation**

在版本投影中生成：

```ts
businessLabel: isBaseline ? '目标已确认' : `目标已调整（第${Math.max(1, version - 1)}次）`,
currentBasisLabel: version === 1 ? '当前按已确认目标执行' : `当前按第${version}版目标执行`,
```

详情抽屉在进展区末尾增加当前目标依据摘要；把导航与历史区标题统一为“目标变更记录”，时间线改用 `businessLabel`，当前项使用“当前使用”辅助标识，空态改为“目标确认后将在这里保留正式记录”。

- [ ] **Step 4: Run focused tests and responsive verification**

Run: `npm run test:e2e -- 12-goal-tracking-model.spec.ts --grep "formal indicator versions"`

Run: `npm run test:e2e -- --grep "employee opens a real indicator drawer"`

Expected: PASS, including the existing 390px no-horizontal-overflow assertion.

### Task 3: Build, release and online verification

**Files:**
- Verify only: Web build output and production container state.

**Interfaces:**
- Consumes: Tasks 1-2 committed on leading `main`.
- Produces: new Web image and verified production page; existing API image remains unchanged.

- [ ] **Step 1: Run repository verification**

Run: `npm run type-check`

Run: `npm run build`

Run: `git diff --check`

Expected: all exit 0.

- [ ] **Step 2: Commit and push leading main**

Commit only the three Vue/TypeScript implementation files, two focused Playwright specs, this plan and its spec. Push `main` to `origin/main` without force.

- [ ] **Step 3: Preserve rollback and deploy Web only**

Tag the current production Web image with a timestamped rollback tag, build the Web service from the pushed commit, tag the new image with the short commit, and recreate only the production Web container under the existing `kayford-deploy` compose project.

- [ ] **Step 4: Verify online behavior and safety state**

Check the public root and health endpoints return 200, the deployed bundle contains the new business copy, the Web container uses the new image, API remains unchanged, quick login remains disabled, and recent production logs contain no new errors.
