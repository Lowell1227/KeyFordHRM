# Navigation, Dashboard, and Notification Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace redundant or non-functional global navigation with four role-aware modules, make each role's dashboard task-oriented, and turn task notifications into direct workflow entry points.

**Architecture:** Route meta is the authority for page labels, roles, navigation module, order, and visibility; AppSidebar only renders the derived navigation tree and persists group collapse state. AppHeader removes unsupported controls, DashboardView reuses personal/team task APIs, and NotificationBell resolves task-aware deep links through a pure mapping helper.

**Tech Stack:** Vue 3, TypeScript 5.6, Vue Router 4, Pinia 2, Element Plus 2.8, Playwright 1.61.

## Dependency

Execute this plan after Tasks 1-9 of docs/superpowers/plans/2026-08-08-manager-team-performance-workspace.md. Dashboard team counts and supervisor notification deep links depend on GET /tasks/team and the scope/stage/taskId query contract.

## Global Constraints

- Expose only four functional first-level modules: 工作台, 绩效, 人员流程, 分析与设置.
- Hide unopened 任务, 项目, 考勤, and 薪酬 modules instead of showing disabled placeholders or watermarks.
- Keep one sidebar entry named 绩效工作台; target tracking, objective map, and performance tasks remain internal workspace navigation.
- Remove the standalone 团队绩效 sidebar entry; /manager/scoring remains a redirect only.
- Move probation and confirmation pages out of 我的绩效 and into 人员流程.
- Rename menu copy exactly: 周期与计划, 绩效校准, 改进计划, 申诉管理, 指标与模板.
- Result approval is visible only to VP, chairman, and system_admin.
- Route and API authorization remain authoritative even when a menu item is hidden.
- Keep kayford.sidebar.collapsedGroups and verify behavior after a real browser refresh.
- Remove unsupported global search and fixed chat badge; do not build search or instant messaging in this plan.
- Dashboard counts must come from personal/team task APIs and must not be fabricated.
- A notification without a legal target remains read-only.
- Desktop acceptance viewport is 1440x900; narrow-screen acceptance viewport is 390x844.

## File Structure

- web/src/router/navigation.types.ts: typed navigation module and route-menu metadata.
- web/src/router/navigation.ts: pure role filtering and navigation-tree builder.
- web/src/router/routes.ts: the single route/meta authority without browser-history side effects.
- web/src/router/index.ts: router construction and guards.
- web/src/components/layout/AppSidebar.vue: rendering and persisted collapse only.
- web/src/components/layout/AppHeader.vue: notifications, user menu, and non-duplicated page title.
- web/src/views/dashboard/DashboardView.vue: employee, supervisor, and administrative entry points.
- web/src/components/layout/notification-target.ts: pure notification-to-route mapping.
- web/src/components/layout/NotificationBell.vue: read-state and navigation interaction.
- web/e2e/specs/11-navigation-entrypoints.spec.ts: cross-role menu, header, dashboard, notification, and responsive acceptance.

---

### Task 1: Make route metadata the single navigation source

**Files:**
- Create: web/src/router/navigation.types.ts
- Create: web/src/router/navigation.ts
- Create: web/src/router/routes.ts
- Modify: web/src/router/index.ts:1-225
- Modify: web/src/components/layout/AppSidebar.vue:1-190
- Modify: web/e2e/page-objects/dashboard.page.ts
- Modify: web/e2e/specs/02-role-menu-visibility.spec.ts
- Create: web/e2e/specs/11-navigation-entrypoints.spec.ts

**Interfaces:**
- Produces: NavigationModuleKey and NavigationMeta.
- Produces: buildNavigation(routes, user): NavigationModule[].
- Produces: data-testid nav-module-workbench, nav-module-performance, nav-module-people, nav-module-analysis.

- [ ] **Step 1: Write failing navigation-tree and role tests**

~~~ts
import { buildNavigation } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';

test('employee navigation excludes administration and unopened modules', () => {
  const modules = buildNavigation(routes, { sysRole: 'employee', canViewAll: false });
  expect(modules.map((module) => module.label)).toEqual([
    '工作台',
    '绩效',
    '人员流程',
  ]);
  expect(JSON.stringify(modules)).not.toContain('团队绩效');
  expect(JSON.stringify(modules)).not.toContain('考勤');
});

test('HR navigation exposes analysis and settings pages', () => {
  const modules = buildNavigation(routes, { sysRole: 'hr', canViewAll: false });
  expect(modules.map((module) => module.label)).toEqual([
    '工作台',
    '绩效',
    '人员流程',
    '分析与设置',
  ]);
  expect(JSON.stringify(modules)).toContain('周期与计划');
  expect(JSON.stringify(modules)).toContain('指标与模板');
});
~~~

Update the browser role test to assert employee, manager, HR, and approver menus and the absence of unopened modules.

- [ ] **Step 2: Run navigation tests and verify failure**

Run: cd web && npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts --grep "navigation"

Expected: FAIL because route navigation metadata and the builder do not exist.

- [ ] **Step 3: Define typed route navigation metadata**

Define:

~~~ts
export type NavigationModuleKey = 'workbench' | 'performance' | 'people' | 'analysis';

export interface NavigationMeta {
  module: NavigationModuleKey;
  label: string;
  order: number;
  group?: string;
  groupLabel?: string;
}

export interface NavigationItem {
  name: RouteRecordName;
  path: string;
  label: string;
  order: number;
}

export interface NavigationGroup {
  key: string;
  label: string;
  items: NavigationItem[];
}

export interface NavigationModule {
  key: NavigationModuleKey;
  label: string;
  order: number;
  defaultPath: string;
  groups: NavigationGroup[];
}

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    public?: boolean;
    layout?: string;
    title?: string;
    roles?: string[];
    navigation?: NavigationMeta;
  }
}
~~~

Move the RouteRecordRaw array from router/index.ts into router/routes.ts and export it there. router/index.ts imports routes, constructs createRouter, and keeps the existing guards. Add navigation metadata only to pages that should appear in a menu. Detail routes omit navigation.

Required placements:

- Dashboard: workbench / 工作台.
- Tasks: performance / 绩效工作台.
- Cycles: performance / 周期与计划.
- Calibration: performance / 绩效校准.
- Interviews: performance / 绩效面谈.
- Improvement plans: performance / 改进计划.
- Approval: performance / 结果审批.
- Publish: performance / 结果公示.
- Appeals: performance / 申诉管理.
- Probation and confirmation list pages: people.
- Reports: analysis / 报表分析.
- Indicators: analysis / group indicator-config / group label 指标与模板 / item label 指标库.
- Templates: analysis / group indicator-config / group label 指标与模板 / item label 考核模板.
- Users: analysis / 用户管理.

Objectives and action-items do not receive sidebar metadata because PerformanceWorkspace owns their internal navigation.

- [ ] **Step 4: Derive AppSidebar and preserve collapse state**

buildNavigation must:

1. Filter route entries by meta.roles.
2. Group visible entries by module and group.
3. Sort modules and entries by exact numeric order.
4. Remove empty modules.
5. Never include routes without navigation metadata.

AppSidebar renders the returned modules and uses the existing kayford.sidebar.collapsedGroups parser/writer. Remove the hard-coded menu array, unopened rail items, and watermark behavior. Ignore persisted keys that are not present in the current navigation tree.

Run: cd web && npm run type-check && npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts --grep "navigation"

Expected: type-check and navigation tests PASS.

- [ ] **Step 5: Commit navigation configuration**

~~~bash
git add web/src/router/navigation.types.ts web/src/router/navigation.ts web/src/router/routes.ts web/src/router/index.ts web/src/components/layout/AppSidebar.vue web/e2e/page-objects/dashboard.page.ts web/e2e/specs/02-role-menu-visibility.spec.ts web/e2e/specs/11-navigation-entrypoints.spec.ts
git commit -m "feat(web): simplify role-aware navigation"
~~~

### Task 2: Remove unsupported header controls and duplicate titles

**Files:**
- Modify: web/src/components/layout/AppHeader.vue
- Modify: web/src/layouts/DefaultLayout.vue
- Modify: web/src/components/performance/PerformanceWorkspace.vue
- Create: web/src/router/performance-workspace.ts
- Modify: web/e2e/specs/11-navigation-entrypoints.spec.ts

**Interfaces:**
- Consumes: current route meta title.
- Produces: data-testid app-notifications and header-user-menu.
- Produces: one visible page title per performance workspace.

- [ ] **Step 1: Write failing header behavior tests**

~~~ts
await page.goto('/tasks');
await expect(page.getByPlaceholder('搜索')).toHaveCount(0);
await expect(page.locator('.header-action')).toHaveCount(0);
await expect(page.getByTestId('performance-workspace-title')).toHaveCount(1);
await expect(page.getByTestId('header-user-menu')).toBeVisible();
await expect(page.getByTestId('app-notifications')).toBeVisible();
~~~

Add a non-workspace assertion that /reports still displays its route title once.

- [ ] **Step 2: Run the focused test and verify failure**

Run: cd web && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "header"

Expected: FAIL because search and fixed chat controls still render and performance title is duplicated.

- [ ] **Step 3: Simplify AppHeader**

Remove keyword state, Search and ChatDotRound imports, the el-input, the fixed badge, and all related CSS. Add data-testid app-notifications to the NotificationBell reference.

Create performance-workspace.ts exporting a shared PERFORMANCE_WORKSPACE_PATHS set containing /tasks, /objectives, and /action-items. AppHeader and DefaultLayout import the same set. AppHeader hides its left title for these exact workspace routes; for other routes it renders a plain route title, not a House icon pretending to be a breadcrumb. Add data-testid performance-workspace-title to the single local h1 in PerformanceWorkspace.

- [ ] **Step 4: Pass focused and responsive checks**

Run: cd web && npm run type-check && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "header"

Expected: PASS at desktop and 390px width with no control overlap.

- [ ] **Step 5: Commit header cleanup**

~~~bash
git add web/src/components/layout/AppHeader.vue web/src/layouts/DefaultLayout.vue web/src/components/performance/PerformanceWorkspace.vue web/src/router/performance-workspace.ts web/e2e/specs/11-navigation-entrypoints.spec.ts
git commit -m "fix(web): remove inactive global header controls"
~~~

### Task 3: Turn the dashboard into a role-aware task entry point

**Files:**
- Modify: web/src/views/dashboard/DashboardView.vue
- Modify: web/e2e/page-objects/dashboard.page.ts
- Modify: web/e2e/specs/11-navigation-entrypoints.spec.ts

**Interfaces:**
- Consumes: tasksApi.findMine and tasksApi.findTeam.
- Produces: employee-current-task, manager-goal-review-count, manager-evaluation-count test ids.
- Produces: all dashboard row commands navigate to a real task.

- [ ] **Step 1: Write failing employee and manager dashboard tests**

Mock personal and team APIs, then assert:

~~~ts
await page.goto('/dashboard');
await expect(page.getByTestId('employee-current-task')).toContainText('目标确认');
await page.getByTestId('employee-current-task-open').click();
await expect(page).toHaveURL('/tasks/task-1');
~~~

For manager storage state:

~~~ts
await expect(page.getByTestId('manager-goal-review-count')).toContainText('3');
await expect(page.getByTestId('manager-evaluation-count')).toContainText('2');
await page.getByTestId('manager-goal-review-open').click();
await expect(page).toHaveURL(/scope=team.*stage=goal-review/);
~~~

Add a management-table assertion that clicking 查看 with task id task-7 navigates to /tasks/task-7.

- [ ] **Step 2: Run dashboard tests and verify failure**

Run: cd web && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "dashboard"

Expected: FAIL because employee cards are duplicated, manager counts are absent, and table 查看 has no action.

- [ ] **Step 3: Implement employee and supervisor task summaries**

Employee:

- Load the newest personal task with tasksApi.findMine({ page: 1, pageSize: 20 }).
- Select the newest non-closed task by cycle date/order already returned by API.
- Map its status to the existing personal stage label.
- Render one primary command to /tasks/:id.
- Render the truthful HR-starts-tasks empty state when no task exists.

Supervisor:

- In parallel request findTeam for goal-review and manager-eval with pageSize 1.
- Use response.counts.pending.
- Link to exact scope/stage queries.
- Also show the supervisor's personal current task when findMine returns one.

Do not reuse the analytical report total as a pending-task count.

- [ ] **Step 4: Make administrative rows actionable and pass tests**

Render 查看 only when row.taskId or row.id is present and the current role can open the task. Bind router.push({ name: 'TaskDetail', params: { id: taskId } }).

Run: cd web && npm run type-check && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "dashboard"

Expected: dashboard tests PASS with no fake zero counts during loading.

- [ ] **Step 5: Commit dashboard entry points**

~~~bash
git add web/src/views/dashboard/DashboardView.vue web/e2e/page-objects/dashboard.page.ts web/e2e/specs/11-navigation-entrypoints.spec.ts
git commit -m "feat(web): add role-aware dashboard tasks"
~~~

### Task 4: Make task notifications actionable

**Files:**
- Create: web/src/components/layout/notification-target.ts
- Modify: web/src/components/layout/NotificationBell.vue
- Modify: web/src/stores/notification.store.ts
- Modify: web/e2e/specs/11-navigation-entrypoints.spec.ts

**Interfaces:**
- Produces: resolveNotificationTarget(notification, role): RouteLocationRaw | null.
- Consumes: Notification.taskId, Notification.type, and current sysRole.

- [ ] **Step 1: Write failing target-mapping and click tests**

~~~ts
expect(resolveNotificationTarget(
  { taskId: 'task-1', type: 'indicator_setting_notice' } as Notification,
  'manager',
)).toEqual({
  path: '/tasks',
  query: { scope: 'team', stage: 'goal-review', taskId: 'task-1' },
});

expect(resolveNotificationTarget(
  { taskId: 'task-2', type: 'self_eval_submitted' } as Notification,
  'manager',
)).toEqual({
  path: '/tasks',
  query: { scope: 'team', stage: 'manager-eval', taskId: 'task-2' },
});

expect(resolveNotificationTarget(
  { taskId: 'task-3', type: 'indicator_setting_notice' } as Notification,
  'employee',
)).toEqual({ name: 'TaskDetail', params: { id: 'task-3' } });
~~~

Browser test: mock recent notifications and mark-read endpoint, click one row, assert mark-read request and final URL.

- [ ] **Step 2: Run notification tests and verify failure**

Run: cd web && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "notification"

Expected: FAIL because rows have no click behavior and the resolver does not exist.

- [ ] **Step 3: Implement the pure route resolver**

Rules:

- Missing taskId returns null.
- manager or dept_head plus indicator_setting_notice returns team goal-review.
- manager or dept_head plus self_eval_submitted returns team manager-eval.
- All other task notifications return named TaskDetail.
- Do not route HR notifications into team scope unless a future API explicitly establishes manager ownership.

- [ ] **Step 4: Wire read state and navigation**

NotificationBell receives router and auth store. A row with target:

1. Awaits store.markAsRead(item.id).
2. If read fails, shows a warning but continues.
3. Pushes the resolved route.
4. Closes the popover.

A row without target has no pointer cursor, click handler, or keyboard command. Add Enter/Space keyboard behavior for actionable rows.

Run: cd web && npm run type-check && npx playwright test e2e/specs/11-navigation-entrypoints.spec.ts --grep "notification"

Expected: mapping and browser tests PASS.

- [ ] **Step 5: Commit notification deep links**

~~~bash
git add web/src/components/layout/notification-target.ts web/src/components/layout/NotificationBell.vue web/src/stores/notification.store.ts web/e2e/specs/11-navigation-entrypoints.spec.ts
git commit -m "feat(web): link notifications to performance tasks"
~~~

### Task 5: Run cross-role navigation and entry-point acceptance

**Files:**
- Modify: web/e2e/specs/02-role-menu-visibility.spec.ts
- Modify: web/e2e/specs/06-role-page-smoke.spec.ts
- Modify: web/e2e/specs/08-rbac-responsive.spec.ts
- Modify: web/e2e/specs/11-navigation-entrypoints.spec.ts

**Interfaces:**
- Consumes: all behavior from Tasks 1-4.
- Produces: final role, refresh, deep-link, and responsive evidence.

- [ ] **Step 1: Add cross-role acceptance cases**

Required assertions:

- Employee: 工作台, 绩效, 人员流程; no 分析与设置.
- Manager: 工作台, 绩效, 人员流程; no HR configuration.
- HR: all four modules, 周期与计划, 绩效校准, 指标与模板, 用户管理.
- VP/chairman: 结果审批 visible, HR-only configuration hidden.
- /manager/scoring redirects to team manager-eval.
- /templates and /approval authorized routes have matching visible menu entries.
- Unauthorized direct route access still receives the existing route guard behavior.

- [ ] **Step 2: Add refresh persistence and mobile assertions**

Collapse the performance group, verify localStorage contains the module key, reload, and assert aria-expanded=false. At 390x844 assert:

~~~ts
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
expect(overflow).toBeLessThanOrEqual(8);
await expect(page.getByTestId('header-user-menu')).toBeVisible();
await expect(page.getByTestId('app-notifications')).toBeVisible();
~~~

- [ ] **Step 3: Run focused browser suites**

Run:

~~~bash
cd web && npx playwright test e2e/specs/02-role-menu-visibility.spec.ts e2e/specs/06-role-page-smoke.spec.ts e2e/specs/08-rbac-responsive.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts
~~~

Expected: all focused suites PASS.

- [ ] **Step 4: Run frontend verification and inspect screenshots**

Run:

~~~bash
cd web && npm run type-check
cd web && npm run build
~~~

Capture employee, manager, HR, and VP dashboards at 1440x900 plus employee/manager views at 390x844. Verify no duplicate title, empty first-level module, dead command, text overlap, horizontal overflow, console error, or failed API request.

- [ ] **Step 5: Commit acceptance coverage**

~~~bash
git add web/e2e/specs/02-role-menu-visibility.spec.ts web/e2e/specs/06-role-page-smoke.spec.ts web/e2e/specs/08-rbac-responsive.spec.ts web/e2e/specs/11-navigation-entrypoints.spec.ts
git commit -m "test(web): verify streamlined application entry points"
~~~
