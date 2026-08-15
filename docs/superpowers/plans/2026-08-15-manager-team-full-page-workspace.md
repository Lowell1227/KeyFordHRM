# 主管团队绩效全页处理工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主管从团队绩效待办点击员工姓名、整行、“处理”或“查看”后，进入共用全页工作台；指标审核与主管评分保持相同页面结构并分别显示现有业务字段和操作。

**Architecture:** 保留 `/tasks?scope=team&stage=...&taskId=...` 深链和父页面现有数据、权限、并发控制及操作编排。新增只负责顶栏、员工切换栏、员工概况、加载错误态和响应式布局的 `TeamTaskWorkspaceShell.vue`；`TaskListView.vue` 在详情状态将现有 `GoalReviewWorkspace` 或 `ManagerEvaluationWorkspace` 放入外壳插槽，并隐藏列表筛选区。首次进入使用 `router.push`，详情内切人和显式返回使用查询状态替换，确保浏览器返回恢复原列表条件。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Vue Router、Element Plus、Playwright contract tests。

## Global Constraints

- 直接在 `main` 修改，不创建分支或 worktree。
- 不改后端接口、数据库字段、绩效状态机和角色权限。
- 不复制截图系统独有字段或无现成功能的按钮；审核和评分内容分别复用现有业务组件。
- 按测试驱动逐项开发，每项先看到目标断言失败，再写最小生产实现。
- 只运行聚焦契约测试、类型检查、构建和真实角色页面复核，不提前执行仓库全量审核。
- 保留用户现有未提交内容：`README.md`、`docs/acceptance/`、`docs/operations/`、`tmp/`。

---

### Task 1: 全页外壳与指标审核进入/返回

**Files:**
- Create: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/src/components/performance/PerformanceWorkspace.vue`
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:** `TeamTaskWorkspaceShell` 接收 `stage`、`members`、`task`、`loading`、`error`，发出 `back`、`retry`、`member-selected(taskId)`，通过默认插槽承载阶段业务组件。`PerformanceWorkspace` 新增默认值为 `true` 的 `showHeader` 和 `showNavigation`。

- [ ] **Step 1: Write the failing goal-review full-page contract test**

将现有指标审核打开测试改为以下页面边界：

```ts
await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&keyword=Ada&page=2');
await page.getByRole('button', { name: '打开 Ada Chen 的团队任务' }).click();
await expect(page).toHaveURL(/taskId=task-1/);
await expect(page.getByTestId('team-task-workspace')).toBeVisible();
await expect(page.getByRole('heading', { name: '指标审核', exact: true })).toBeVisible();
await expect(page.getByTestId('goal-review-workspace')).toBeVisible();
await expect(page.getByTestId('manager-evaluation-workspace')).toHaveCount(0);
await expect(page.getByTestId('team-task-list')).toHaveCount(0);
await expect(page.getByTestId('team-filter-panel')).toHaveCount(0);
await page.getByTestId('team-task-workspace-back').click();
await expect(page).toHaveURL('/tasks?scope=team&stage=goal-review&stageState=pending&keyword=Ada&page=2');
```

测试 fixture 必须返回该页有效数据，同时保留 `cycleId`、部门、员工、关键字和分页查询的精确恢复断言。

- [ ] **Step 2: Run the new test and confirm the expected failure**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "opens goal review in a full-page team workspace"
```

Expected: 因 `team-task-workspace` 尚不存在且列表仍在而失败；先排除 mock、路由或 TypeScript 设置错误。

- [ ] **Step 3: Implement the minimal shared shell**

创建以下公共契约：

```ts
const props = defineProps<{
  stage: TeamTaskStage;
  members: TeamTaskListItem[];
  task?: TeamTaskListItem;
  loading?: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  back: [];
  retry: [];
  'member-selected': [taskId: string];
}>();
const title = computed(() => props.stage === 'goal-review' ? '指标审核' : '主管评分');
```

外壳渲染：顶部返回/标题/周期、员工切换栏、员工概况、加载骨架、错误重试、空态和默认插槽。根节点使用 `team-task-workspace`，返回按钮使用 `team-task-workspace-back`，员工按钮复用 `team-task-row-${member.id}` 并设置 `aria-current`。桌面左栏、窄屏上栏；所有 grid 子项设置 `min-width: 0`。

- [ ] **Step 4: Integrate goal review and history-safe navigation**

在 `TaskListView.vue` 增加：

```ts
const isTeamTaskWorkspace = computed(
  () => activeScope.value === 'team' && Boolean(taskId.value),
);
const workspaceMembers = computed(() => {
  const current = selectedTeamTask.value;
  if (current && !teamPage.value.items.some((item) => item.id === current.id)) return [current];
  return teamPage.value.items;
});
async function selectTeamTask(payload: { taskId: string }) {
  await router.push({ query: { ...route.query, taskId: payload.taskId } });
}
async function switchTeamTask(nextTaskId: string) {
  await workspaceQuery.update({ taskId: nextTaskId });
}
async function closeTeamTaskWorkspace() {
  await workspaceQuery.update({ taskId: undefined });
  await nextTick();
  teamListRef.value?.focusList();
}
```

用外壳顶层分支替换内联 `TeamMemberRail`。指标审核插槽继续使用现有 `GoalReviewWorkspace` 的全部 prop/event，不改保存、通过、驳回编排。详情激活时完全不渲染筛选、表格和批量区。

在 `PerformanceWorkspace.vue` 中条件渲染 header/navigation；三块外围 UI 均隐藏时 body 使用单列。`TaskListView.vue` 只在团队全页详情时传入 false。

- [ ] **Step 5: Run and commit Task 1**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "opens goal review in a full-page team workspace"
Set-Location ..
git add -- web/src/views/task/components/TeamTaskWorkspaceShell.vue web/src/views/task/TaskListView.vue web/src/components/performance/PerformanceWorkspace.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): open team goal review as full page"
```

Expected: 聚焦测试通过，提交只包含上述文件。

### Task 2: 主管评分内容、员工切换与未保存保护

**Files:**
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:** 两个阶段共用外壳但互不渲染对方字段；详情内切人只替换 `taskId`；`ManagerEvaluationWorkspace` 继续负责现有离开脏数据确认；已完成任务按现有权限只读。

- [ ] **Step 1: Write failing manager-score and dirty-navigation tests**

```ts
await page.goto('/tasks?scope=team&stage=manager-eval&stageState=pending');
await page.getByRole('button', { name: '处理 Ada Chen', exact: true }).click();
await expect(page.getByTestId('team-task-workspace')).toBeVisible();
await expect(page.getByRole('heading', { name: '主管评分', exact: true })).toBeVisible();
await expect(page.getByTestId('manager-evaluation-workspace')).toBeVisible();
await expect(page.getByTestId('goal-review-workspace')).toHaveCount(0);
await expect(page.getByText('员工自评分')).toBeVisible();
await expect(page.getByText('主管评分')).toBeVisible();
```

扩展现有未保存测试：编辑主管评语后点击 `team-task-row-task-2`，选择“继续编辑”应留在 `task-1`；再切换并选择“放弃修改”应进入 `task-2`。对 `team-task-workspace-back` 重复两种选择。

- [ ] **Step 2: Run manager tests and confirm expected failure**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "shared full-page shell|protects unsaved manager evaluation"
```

Expected: 评分内容或切换断言在集成前失败，且不是测试设置失败。

- [ ] **Step 3: Render the stage-specific component in the same shell**

在外壳插槽中做互斥分支：

```vue
<GoalReviewWorkspace v-if="selectedTeamTask && teamStage === 'goal-review'" />
<ManagerEvaluationWorkspace v-else-if="selectedTeamTask && teamStage === 'manager-eval'" />
```

实际代码必须保留当前内联实现的全部 props/events。员工点击调用 `switchTeamTask`，不得绕过评分组件已有的 `onBeforeRouteUpdate` / `onBeforeRouteLeave`。

- [ ] **Step 4: Cover completed-task read-only entry and both list triggers**

契约测试分别点击员工姓名和操作按钮。完成行断言文案为“查看”、可进入相同外壳，并且编辑/提交动作按当前子组件契约缺失或禁用。

- [ ] **Step 5: Run and commit Task 2**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "manager evaluation|shared full-page shell|completed team task"
Set-Location ..
git add -- web/src/views/task/TaskListView.vue web/src/views/task/components/TeamTaskWorkspaceShell.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "feat(web): share team workspace for manager scoring"
```

### Task 3: 深链、加载错误、响应式与回归迁移

**Files:**
- Modify: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Modify: `web/src/views/task/TaskListView.vue`
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Remove if unused: `web/src/views/task/components/TeamMemberRail.vue`

**Interfaces:** 合法跨页深链以补载任务作为唯一员工项；非直属深链清除 `taskId` 并显示现有警告；加载/重试由外壳承载；所有宽度下详情均不显示列表，窄屏员工栏置于正文上方。

- [ ] **Step 1: Locate and migrate every legacy inline-detail assertion**

```powershell
rg -n "team-member-rail|team-member-heading|关闭成员详情|team-task-list.*toBeVisible|team-batch" web/e2e/specs/10-team-performance-contract.spec.ts
```

把 rail 断言改为全页 shell；每档宽度都断言详情时列表不存在；用 `team-task-workspace-back` 验证列表焦点恢复；原来在内联详情中执行的批量动作改为返回列表后执行。保留深链补载、越权拒绝、延迟保存版本、错误重试、脏数据和并发保护断言。

- [ ] **Step 2: Run focused contracts and observe failures**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "team list manager workspace|team workspace|manager evaluation"
```

Expected: 仅剩旧页面假设或真实边界缺陷；每个生产缺陷先保留失败断言再改实现。

- [ ] **Step 3: Fix deep-link and responsive edge cases minimally**

保证选中补载任务不在当前页时 `workspaceMembers` 返回 `[selectedTeamTask]`。保留现有 `hydrateSelectedTeamTask` 和 `denyTeamTaskAccess`，只移除 rail 焦点逻辑。桌面紧凑左栏；`<=768px` 员工栏横向滚动置顶；文档级横向溢出不超过现有测试的 8px。`rg` 确认生产和测试均无引用后才删除 `TeamMemberRail.vue`。

- [ ] **Step 4: Re-run focused contracts and commit**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "team list manager workspace|team workspace|manager evaluation"
Set-Location ..
git add -- web/src/views/task/TaskListView.vue web/src/views/task/components/TeamTaskWorkspaceShell.vue web/e2e/specs/10-team-performance-contract.spec.ts
git add -u -- web/src/views/task/components/TeamMemberRail.vue
git commit -m "test(web): cover full-page team task flows"
```

若旧组件仍有其他引用，不删除也不暂存该文件。

### Task 4: 聚焦验证与周强真实页面复核

**Files:**
- Verify: `web/src/views/task/TaskListView.vue`
- Verify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Verify: `web/src/views/task/components/GoalReviewWorkspace.vue`
- Verify: `web/src/views/task/components/ManagerEvaluationWorkspace.vue`
- Verify: `web/e2e/specs/10-team-performance-contract.spec.ts`

- [ ] **Step 1: Run final focused automation**

```powershell
Set-Location web
npx playwright test --config playwright.contract.config.ts --grep "team list manager workspace|team workspace|manager evaluation"
npm run type-check
npm run build
```

Expected: 聚焦用例、类型检查和生产构建全部退出 `0`。

- [ ] **Step 2: Verify the real Zhou Qiang manager session**

在已登录浏览器中分别检查指标审核和主管评分：姓名/处理入口、同结构异字段、员工切换、显式返回、浏览器返回、原筛选分页恢复、桌面和窄屏无文档级横向溢出、控制台无新增错误。

- [ ] **Step 3: Check final diff and workspace boundaries**

```powershell
git diff --check 3eef5b4..HEAD
git status --short
git log -6 --oneline
```

Expected: 功能提交只包含计划、共用外壳、父页面/外围布局、必要的旧组件删除和聚焦测试；用户原有 `README.md`、`docs/acceptance/`、`docs/operations/`、`tmp/` 未被暂存。

- [ ] **Step 4: Report qualified completion**

分别报告：共用结构与阶段字段的变化、自动化/类型/构建证据、周强桌面/窄屏复核结果或准确阻塞、main 上的提交号，以及保留的无关工作区文件。
