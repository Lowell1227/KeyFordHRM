# 主管团队员工列表表格优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将主管团队绩效任务列表改为参考图风格的紧凑员工业务表格，并在窄屏下合并次要信息且保持可处理。

**Architecture:** 继续由 `TeamTaskList.vue` 使用现有 `ResizeObserver` 按组件实际宽度控制列，不新增接口或共享状态。用 Playwright 团队任务契约测试验证真实渲染出的列、操作入口、响应式信息和溢出，CSS 只覆盖该组件的表头、数据行和操作按钮。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Element Plus `el-table`、Playwright。

## Global Constraints

- 直接在 `main` 上修改，不创建分支或 worktree。
- 仅使用现有 `TeamTaskListItem` 字段，不扩展后端、数据库或权限规则。
- 桌面内容宽度达到 `980px` 时显示员工、部门、职位、考核周期、任务状态、结果、更新日期和操作列。
- 内容宽度 `640px` 至 `979px` 时隐藏周期、结果和更新日期，将周期并入员工次信息。
- 内容宽度低于 `640px` 时进一步隐藏部门、职位，将部门、职位、周期并入员工次信息。
- 待处理行显示“处理”，其他行显示“查看”，点击行为和权限保持不变。
- 表头约 `44px`、数据行约 `52px`，不产生文档级或表格容器横向溢出。
- 采用聚焦验证，不提前执行仓库全量审核。

---

### Task 1: 桌面员工业务列与文字操作

**Files:**
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts:596-635`
- Modify: `web/src/views/task/components/TeamTaskList.vue:1-280`

**Interfaces:**
- Consumes: 现有 `TeamTaskListItem` 的 `employeeName`、`employeeNo`、`avatarUrl`、`deptName`、`position`、`cycleName`、`status`、`stageState`、`totalScore`、`rawGrade`、`updatedAt`。
- Produces: 桌面列标题“员工 / 部门 / 职位 / 考核周期 / 任务状态 / 结果 / 更新日期 / 操作”，以及可访问名称为“处理 {员工名}”或“查看 {员工名}”的行操作按钮。

- [ ] **Step 1: 写桌面列与操作文案的失败测试**

在 `team list manager workspace` 中新增以下测试，使用完整的 `teamPageFixture` 同时覆盖待处理和已完成行：

```ts
test('team list renders employee business columns and explicit row actions on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTaskWorkspaceIdentity(page, 'manager');
  await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(teamPageFixture)),
  }));

  await page.goto('/tasks?scope=team&stage=goal-review&cycleId=cycle-1');

  for (const heading of ['员工', '部门', '职位', '考核周期', '任务状态', '结果', '更新日期', '操作']) {
    await expect(page.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '处理 Ada Chen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看 Lin Wei', exact: true })).toBeVisible();
});
```

该测试能捕获的生产缺陷是：职位列缺失、操作列没有文字，或待处理/已完成行使用相同动作文案。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "employee business columns"
```

Expected: 测试在找不到“职位”列或“处理 Ada Chen”按钮时失败，而不是因 TypeScript、路由或服务启动错误失败。

- [ ] **Step 3: 实现最小桌面表格结构**

在 `TeamTaskList.vue` 中：

```ts
const mediumColumns = computed(() => containerWidth.value > 0 && containerWidth.value < 980);
const narrowColumns = computed(() => containerWidth.value > 0 && containerWidth.value < 640);

function taskActionLabel(item: TeamTaskListItem): string {
  return item.stageState === 'pending' ? '处理' : '查看';
}
```

移除 `View` 图标导入；员工次信息在桌面只显示工号。新增独立“职位”列，并为末列设置 `label="操作"`、文字链接按钮和 `:aria-label="`${taskActionLabel(row)} ${row.employeeName}`"`：

```vue
<el-table-column v-if="!mediumColumns" prop="deptName" label="部门" min-width="120">
  <template #default="{ row }">{{ row.deptName || '-' }}</template>
</el-table-column>
<el-table-column v-if="!narrowColumns" prop="position" label="职位" min-width="120">
  <template #default="{ row }">{{ row.position || '-' }}</template>
</el-table-column>
<el-table-column v-if="!mediumColumns" prop="cycleName" label="考核周期" min-width="130" show-overflow-tooltip />
<el-table-column label="操作" width="72" fixed="right" align="center">
  <template #default="{ row }">
    <el-button
      class="team-task-list__action"
      link
      type="primary"
      size="small"
      :aria-label="`${taskActionLabel(asTeamTask(row))} ${row.employeeName}`"
      @click.stop="selectTask(asTeamTask(row))"
    >
      {{ taskActionLabel(asTeamTask(row)) }}
    </el-button>
  </template>
</el-table-column>
```

- [ ] **Step 4: 运行桌面测试并确认通过**

Run:

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "employee business columns"
```

Expected: `1 passed`，且无控制台错误。

- [ ] **Step 5: 提交桌面结构改动**

```powershell
git add -- web/e2e/specs/10-team-performance-contract.spec.ts web/src/views/task/components/TeamTaskList.vue
git commit -m "fix(web): clarify manager team employee table"
```

### Task 2: 响应式信息合并与紧凑密度

**Files:**
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts:1709-1757`
- Modify: `web/src/views/task/components/TeamTaskList.vue:213-280,302-441`

**Interfaces:**
- Consumes: Task 1 的 `mediumColumns`、`narrowColumns`、员工单元格和文字操作按钮。
- Produces: 中等宽度独立员工/部门/职位/状态/操作列；窄宽度独立员工/状态/操作列；员工次信息按宽度补入隐藏字段。

- [ ] **Step 1: 扩展响应式失败测试**

将现有列表溢出测试矩阵扩展为桌面、中等、移动三档，并在打开详情前加入可见列和员工次信息断言：

```ts
for (const viewport of [
  {
    name: 'desktop', width: 1440, height: 900,
    visibleHeaders: ['员工', '部门', '职位', '考核周期', '任务状态', '结果', '更新日期', '操作'],
    hiddenHeaders: [], secondaryText: 'E001',
  },
  {
    name: 'medium', width: 1180, height: 820,
    visibleHeaders: ['员工', '部门', '职位', '任务状态', '操作'],
    hiddenHeaders: ['考核周期', '结果', '更新日期'], secondaryText: 'E001 · 2026 H1',
  },
  {
    name: 'mobile', width: 390, height: 844,
    visibleHeaders: ['员工', '任务状态', '操作'],
    hiddenHeaders: ['部门', '职位', '考核周期', '结果', '更新日期'],
    secondaryText: 'E001 · Engineering · Senior Engineer · 2026 H1',
  },
]) {
  test(`team list presents responsive employee columns at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockTaskWorkspaceIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPageWith(teamPageFixture.items.slice(0, 2)))),
    }));

    await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
    await expect(page.getByTestId('team-task-list')).toBeVisible();
    for (const heading of viewport.visibleHeaders) {
      await expect(page.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    for (const heading of viewport.hiddenHeaders) {
      await expect(page.getByRole('columnheader', { name: heading, exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId('team-task-row-task-1').locator('.member-cell__meta')).toHaveText(viewport.secondaryText);

    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow).toBeLessThanOrEqual(8);
    const tableFit = await page.getByTestId('team-task-table-wrap').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tableFit.scrollWidth).toBeLessThanOrEqual(tableFit.clientWidth + 2);

    await page.getByTestId('team-task-row-task-1').click();
    await expect(page.getByTestId('team-member-rail')).toBeVisible();
    if (viewport.name === 'mobile') {
      await expect(page.getByTestId('team-task-list')).toBeHidden();
      await expect(page.getByTestId('team-member-heading')).toBeFocused();
      await page.getByRole('button', { name: '关闭成员详情' }).click();
      await expect(page.getByTestId('team-task-list')).toBeFocused();
    } else {
      await expect(page.getByTestId('team-task-list')).toBeVisible();
    }
  });
}
```

保留现有文档及表格容器无溢出、详情打开/关闭和焦点恢复断言。该测试能捕获的生产缺陷是：断点隐藏错误、隐藏字段没有合并回员工信息，或窄屏必须横向滚动才能操作。

- [ ] **Step 2: 运行响应式测试并确认按预期失败**

Run:

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "responsive employee columns"
```

Expected: 中等或移动用例因列集合或员工次信息不符失败。

- [ ] **Step 3: 实现三档次信息和局部密度样式**

员工次信息只在相应断点补入被隐藏字段：

```vue
<small class="member-cell__meta">
  {{ row.employeeNo || '-' }}
  <template v-if="mediumColumns">
    <span v-if="narrowColumns && row.deptName"> · {{ row.deptName }}</span>
    <span v-if="narrowColumns && row.position"> · {{ row.position }}</span>
    <span v-if="row.cycleName"> · {{ row.cycleName }}</span>
  </template>
</small>
```

组件局部样式覆盖全局表格密度，并允许窄屏次信息最多两行：

```css
.team-task-list :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 44px;
  background: #f7f9fc !important;
}

.team-task-list :deep(.el-table__body td.el-table__cell) {
  height: 52px;
  padding: 5px 0;
}

.team-task-list__action {
  min-height: 28px;
  padding: 0 4px;
  font-weight: 600;
}

@media (max-width: 768px) {
  .member-cell__meta {
    display: -webkit-box;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}
```

- [ ] **Step 4: 运行响应式测试并确认通过**

Run:

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "responsive employee columns"
```

Expected: `3 passed`，三档都无文档级或列表容器横向溢出。

- [ ] **Step 5: 提交响应式改动**

```powershell
git add -- web/e2e/specs/10-team-performance-contract.spec.ts web/src/views/task/components/TeamTaskList.vue
git commit -m "fix(web): refine responsive team table"
```

### Task 3: 聚焦回归与周强页面视觉验收

**Files:**
- Verify: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Verify: `web/src/views/task/components/TeamTaskList.vue`

**Interfaces:**
- Consumes: Task 1、Task 2 的最终团队表格。
- Produces: 聚焦自动化结果、桌面与 `390px` 周强页面截图检查结论。

- [ ] **Step 1: 运行团队任务聚焦契约测试**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "team list manager workspace|team list presents responsive employee columns"
```

Expected: 所有选中的团队列表用例通过。

- [ ] **Step 2: 运行前端静态验证**

```powershell
npm run type-check
npm run build
```

Expected: 两条命令退出码均为 `0`。

- [ ] **Step 3: 在真实周强会话检查桌面页面**

打开 `/tasks?scope=team&stage=goal-review&stageState=pending`，确认独立列、52px 左右行高、“处理”入口、批量按钮和筛选面板对齐；点击“处理”后仍进入现有详情。

- [ ] **Step 4: 在 `390x844` 检查窄屏页面**

确认只保留员工、任务状态、操作列，部门/职位/周期出现在员工次信息中，页面和列表都无横向滚动；检查浏览器控制台没有新增错误。

- [ ] **Step 5: 检查最终差异与工作区边界**

```powershell
git diff --check cf1d095..HEAD
git status --short
git log -3 --oneline
```

Expected: 本功能提交只涉及设计/计划文档、`TeamTaskList.vue` 和团队任务契约测试；用户原有 `README.md`、`docs/acceptance/`、`docs/operations/`、`tmp/` 仍未被纳入提交。
