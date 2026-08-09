import { test, expect } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { isPerformanceWorkspacePath } from '../../src/router/performance-workspace';
import { routes } from '../../src/router/routes';
import { DashboardPage } from '../page-objects/dashboard.page';
import type {
  Paginated,
  TaskListItem,
  TeamTaskListItem,
  TeamTaskPage,
} from '../../src/types/api.types';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const taskItem = (overrides: Partial<TaskListItem> = {}): TaskListItem => ({
  id: 'task-default',
  cycleId: 'cycle-default',
  cycleName: '2026 Q3',
  snapshotId: 'snapshot-default',
  employeeId: 'employee-1',
  employeeName: 'Employee',
  status: 'indicator_confirming',
  isExempt: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const taskPage = (items: TaskListItem[]): Paginated<TaskListItem> => ({
  total: items.length,
  page: 1,
  pageSize: 20,
  items,
});

const teamTaskItem = (overrides: Partial<TeamTaskListItem> = {}): TeamTaskListItem => ({
  id: 'team-task-default',
  cycleId: 'cycle-default',
  cycleName: '2026 Q3',
  employeeId: 'employee-1',
  employeeName: 'Employee',
  deptId: 'dept-1',
  deptName: 'Engineering',
  managerId: 'manager-1',
  status: 'indicator_reviewing',
  totalScore: null,
  rawGrade: null,
  updatedAt: '2026-08-01T00:00:00.000Z',
  employeeNo: 'E-1',
  avatarUrl: null,
  position: 'Engineer',
  stageState: 'pending',
  ...overrides,
});

const teamPage = (pending: number, stage: 'goal-review' | 'manager-eval' = 'goal-review'): TeamTaskPage => ({
  total: pending,
  page: 1,
  pageSize: 1,
  items: pending > 0
    ? [teamTaskItem({
      id: `${stage}-task-1`,
      status: stage === 'goal-review' ? 'indicator_reviewing' : 'manager_scoring',
    })]
    : [],
  counts: { all: pending, notStarted: 0, pending, completed: 0, exempted: 0 },
  facets: { departments: [], employees: [] },
});

test.describe('11-navigation-entrypoints navigation tree', () => {
  test('employee navigation excludes administration and unopened modules', () => {
    const modules = buildNavigation(routes, { sysRole: 'employee', canViewAll: false });

    expect(modules.map((module) => module.label)).toEqual(['工作台', '绩效', '人员流程']);
    expect(JSON.stringify(modules)).not.toContain('团队绩效');
    expect(JSON.stringify(modules)).not.toContain('考勤');
    expect(JSON.stringify(modules)).not.toContain('目标跟进');
  });

  test('HR navigation exposes analysis and settings pages in configured order', () => {
    const modules = buildNavigation(routes, { sysRole: 'hr', canViewAll: false });

    expect(modules.map((module) => module.label)).toEqual(['工作台', '绩效', '人员流程', '分析与设置']);
    const analysis = modules.find((module) => module.key === 'analysis');
    expect(analysis?.defaultPath).toBe('/reports');
    expect(analysis?.groups.flatMap((group) => group.items.map((item) => item.label))).toEqual([
      '报表分析',
      '指标库',
      '考核模板',
      '用户管理',
    ]);
    expect(analysis?.groups.find((group) => group.key === 'indicator-config')?.items.map((item) => item.label)).toEqual([
      '指标库',
      '考核模板',
    ]);
  });

  test('does not expose route records without navigation metadata', () => {
    const modules = buildNavigation(routes, { sysRole: 'manager', canViewAll: false });

    expect(JSON.stringify(modules)).not.toContain('目标地图');
    expect(JSON.stringify(modules)).not.toContain('目标跟进');
    expect(JSON.stringify(modules)).not.toContain('任务详情');
  });
});

test.describe('11-navigation-entrypoints navigation active state', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('team performance deep link remains active in the performance workspace', async ({ page }) => {
    await page.goto('/tasks?scope=team&stage=manager-eval');
    const dashboard = new DashboardPage(page);

    await expect(dashboard.module('performance')).toBeVisible();
    await expect(dashboard.menuItem('绩效工作台')).toHaveClass(/is-active/);
  });

  test('preserves a performance collapse across refresh and removes stale persisted keys', async ({ page }) => {
    await page.goto('/tasks');
    await page.evaluate(() => {
      localStorage.setItem('kayford.sidebar.collapsedGroups', JSON.stringify({ performance: true, retired: true }));
    });
    await page.reload();

    const performanceGroup = page.locator('.menu-group__title', { hasText: '绩效管理' });
    await expect(performanceGroup).toHaveAttribute('aria-expanded', 'false');
    const persisted = await page.evaluate(() => localStorage.getItem('kayford.sidebar.collapsedGroups'));
    expect(persisted).toBe(JSON.stringify({ performance: true }));

    await page.reload();
    await expect(performanceGroup).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('11-navigation-entrypoints dashboard task entry points', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('employee skips newer terminal tasks and opens the latest active personal task', async ({ page }) => {
    const items = [
      taskItem({ id: 'task-confirmed', cycleId: 'cycle-3', cycleName: '2026 Q4', status: 'confirmed' }),
      taskItem({ id: 'task-active', cycleId: 'cycle-2', cycleName: '2026 Q3', status: 'indicator_confirming' }),
      taskItem({ id: 'task-closed', cycleId: 'cycle-1', cycleName: '2026 Q2', status: 'closed' }),
      taskItem({ id: 'task-exempted', cycleId: 'cycle-0', cycleName: '2026 Q1', status: 'exempted', isExempt: true }),
    ];
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(taskPage(items))),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.currentEmployeeTask()).toContainText('目标确认');
    await dashboard.currentEmployeeTaskOpen().click();
    const destination = new URL(page.url());
    expect(destination.pathname).toBe('/tasks/task-active');
    expect([...destination.searchParams.entries()]).toEqual([['returnTo', '/tasks']]);
  });
});

test.describe('11-navigation-entrypoints manager dashboard task entry points', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('manager sees true pending counts and opens the matching team workspace', async ({ page }) => {
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(taskPage([]))),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPage(stage === 'goal-review' ? 3 : 2, stage === 'manager-eval' ? 'manager-eval' : 'goal-review'))),
      });
    });
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managerGoalReviewCount()).toHaveText('3');
    await expect(dashboard.managerEvaluationCount()).toHaveText('2');
    await dashboard.managerGoalReviewOpen().click();
    const destination = new URL(page.url());
    expect(destination.pathname).toBe('/tasks');
    expect([...destination.searchParams.entries()]).toEqual([
      ['scope', 'team'],
      ['stage', 'goal-review'],
    ]);
  });

  test('each manager task request settles independently when another request is slow or fails', async ({ page }) => {
    let releaseManagerEvaluation!: () => void;
    const managerEvaluationGate = new Promise<void>((resolve) => {
      releaseManagerEvaluation = resolve;
    });
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({ status: 500 }));
    await page.route('**/api/v1/tasks/team**', async (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage');
      if (stage === 'manager-eval') await managerEvaluationGate;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPage(stage === 'goal-review' ? 4 : 2, stage === 'manager-eval' ? 'manager-eval' : 'goal-review'))),
      });
    });
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managerGoalReviewCount()).toHaveText('4', { timeout: 1_500 });
    await expect(dashboard.managerPersonalTask()).toHaveAttribute('data-state', 'error');
    await expect(dashboard.managerEvaluationCard()).toHaveAttribute('aria-busy', 'true');
    await expect(dashboard.managerEvaluationCount()).toHaveCount(0);

    releaseManagerEvaluation();
    await expect(dashboard.managerEvaluationCount()).toHaveText('2');
  });

  test('role identity changes ignore late responses from the previous request generation', async ({ page }) => {
    let releaseFirstGeneration!: () => void;
    const firstGenerationGate = new Promise<void>((resolve) => {
      releaseFirstGeneration = resolve;
    });
    let personalCalls = 0;
    const teamCalls: Record<string, number> = { 'goal-review': 0, 'manager-eval': 0 };

    await page.route('**/api/v1/tasks/mine**', async (route) => {
      personalCalls += 1;
      const firstGeneration = personalCalls === 1;
      if (firstGeneration) await firstGenerationGate;
      const item = taskItem({
        id: firstGeneration ? 'task-old' : 'task-new',
        cycleName: firstGeneration ? 'Old cycle' : 'New cycle',
        status: 'self_eval',
      });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(taskPage([item]))),
      });
    });
    await page.route('**/api/v1/tasks/team**', async (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage') as 'goal-review' | 'manager-eval';
      teamCalls[stage] += 1;
      const firstGeneration = teamCalls[stage] === 1;
      if (firstGeneration) await firstGenerationGate;
      const pending = firstGeneration ? (stage === 'goal-review' ? 1 : 2) : (stage === 'goal-review' ? 22 : 33);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(teamPage(pending, stage))),
      });
    });
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect.poll(() => personalCalls).toBe(1);
    await expect.poll(() => teamCalls['goal-review']).toBe(1);
    await expect.poll(() => teamCalls['manager-eval']).toBe(1);

    await page.evaluate(async () => {
      const storeModulePath = '/src/stores/auth.store.ts';
      const { useAuthStore } = await import(storeModulePath);
      const store = useAuthStore();
      if (!store.user) throw new Error('Expected a loaded manager identity');
      store.user = { ...store.user, id: 'manager-second-generation' };
    });

    await expect(dashboard.managerPersonalTask()).toContainText('New cycle');
    await expect(dashboard.managerGoalReviewCount()).toHaveText('22');
    await expect(dashboard.managerEvaluationCount()).toHaveText('33');

    const oldPersonalResponse = page.waitForResponse((response) => response.url().includes('/api/v1/tasks/mine'));
    releaseFirstGeneration();
    await oldPersonalResponse;
    await expect(dashboard.managerPersonalTask()).toContainText('New cycle');
    await expect(dashboard.managerGoalReviewCount()).toHaveText('22');
    await expect(dashboard.managerEvaluationCount()).toHaveText('33');
  });

  test('management rows expose a detail command only for real task ids', async ({ page }) => {
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(taskPage([]))),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPage(0))),
    }));
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 1,
        page: 1,
        pageSize: 50,
        items: [{ id: 'cycle-1', name: '2026 Q3', status: 'published' }],
      })),
    }));
    await page.route('**/api/v1/reports/cycle/cycle-1/summary**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        stats: { total: 2, grades: { A: { count: 0, ratio: 0 }, B: { count: 0, ratio: 0 }, C: { count: 0, ratio: 0 }, D: { count: 0, ratio: 0 } } },
        items: [
          { taskId: 'task-7', employeeName: 'Ada', employeeNo: 'E-7', deptName: 'Engineering', position: 'Engineer', totalScore: null, grade: null, managerName: 'Manager' },
          { employeeName: 'No task', employeeNo: 'E-8', deptName: 'Engineering', position: 'Engineer', totalScore: null, grade: null, managerName: 'Manager' },
        ],
      })),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managementTaskOpen('task-7')).toBeVisible();
    await expect(page.getByTestId('dashboard-task-open-undefined')).toHaveCount(0);
    await dashboard.managementTaskOpen('task-7').click();
    const destination = new URL(page.url());
    expect(destination.pathname).toBe('/tasks/task-7');
    expect([...destination.searchParams.entries()]).toEqual([['returnTo', '/tasks']]);
  });
});

test.describe('11-navigation-entrypoints dashboard task access boundaries', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('HR dashboard does not request supervisor-only team work', async ({ page }) => {
    let teamRequests = 0;
    await page.route('**/api/v1/tasks/team**', (route) => {
      teamRequests += 1;
      return route.fulfill({ status: 500 });
    });
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    await page.goto('/dashboard');
    await expect(page.locator('.dashboard-admin')).toBeVisible();
    expect(teamRequests).toBe(0);
  });
});

test.describe('11-navigation-entrypoints dashboard task layout', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('manager task entry stays compact without horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(taskPage([
        taskItem({ id: 'task-1', cycleId: 'cycle-1', cycleName: '2026 Q3', employeeId: 'manager-1', status: 'self_eval' }),
      ]))),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(teamPage(12))),
    }));
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    await page.goto('/dashboard');
    await expect(page.getByTestId('manager-goal-review-count')).toHaveText('12');

    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards: Array.from(document.querySelectorAll('.manager-task-entry .task-entry-card')).map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    }));
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.cards.every((card) => card.left >= 0 && card.right <= 390)).toBe(true);

    await page.screenshot({ path: '../.superpowers/sdd/2026-08-08-navigation-dashboard-notifications/task-3-mobile.png', fullPage: true });
  });
});

test.describe('11-navigation-entrypoints header', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('classifies canonical and trailing-slash workspace paths exactly', () => {
    for (const path of [
      '/tasks',
      '/tasks////',
      '/objectives',
      '/objectives//',
      '/action-items',
      '/action-items///',
    ]) {
      expect(isPerformanceWorkspacePath(path)).toBe(true);
    }

    for (const path of ['/tasks/task-1', '/tasks-extra', '/performance/tasks']) {
      expect(isPerformanceWorkspacePath(path)).toBe(false);
    }
  });

  test('performance workspace keeps one local title and only working header actions', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.getByPlaceholder('搜索')).toHaveCount(0);
    await expect(page.locator('.app-header .header-action')).toHaveCount(0);
    await expect(page.getByTestId('performance-workspace-title')).toHaveCount(1);
    await expect(page.getByTestId('app-route-title')).toHaveCount(0);
    await expect(page.getByTestId('app-notifications')).toBeVisible();
    await expect(page.getByTestId('header-user-menu')).toBeVisible();
  });

  test('normalizes trailing slashes without treating task details or prefixes as workspaces', async ({ page }) => {
    for (const path of ['/tasks/', '/objectives/', '/action-items/']) {
      await page.goto(path);

      await expect(page.locator('.app-main')).toHaveClass(/app-main--workspace/);
      await expect(page.getByTestId('performance-workspace-title')).toHaveCount(1);
      await expect(page.getByTestId('app-route-title')).toHaveCount(0);
    }

    await page.goto('/tasks/not-a-workspace');

    await expect(page.locator('.app-main')).not.toHaveClass(/app-main--workspace/);
    await expect(page.getByTestId('performance-workspace-title')).toHaveCount(0);
    await expect(page.getByTestId('app-route-title')).toHaveCount(1);
  });

  test('keeps notifications and user menu right-aligned without overlap at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks/');

    await expect(page.getByTestId('app-notifications')).toBeVisible();
    await expect(page.getByTestId('header-user-menu')).toBeVisible();

    const layout = await page.evaluate(() => {
      const header = document.querySelector('.app-header')?.getBoundingClientRect();
      const actions = document.querySelector('.app-header__right')?.getBoundingClientRect();
      const notifications = document.querySelector('[data-testid="app-notifications"]')?.getBoundingClientRect();
      const userMenu = document.querySelector('[data-testid="header-user-menu"]')?.getBoundingClientRect();

      if (!header || !actions || !notifications || !userMenu) return null;

      return {
        rightGap: header.right - actions.right,
        controlsOverlap: notifications.right > userMenu.left,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.rightGap).toBeLessThanOrEqual(12);
    expect(layout?.controlsOverlap).toBe(false);
    expect(layout?.overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('11-navigation-entrypoints non-workspace header', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('non-workspace pages retain one plain route title', async ({ page }) => {
    await page.goto('/reports');

    await expect(page.getByTestId('app-route-title')).toHaveText('报表分析');
    await expect(page.getByTestId('app-route-title')).toHaveCount(1);
  });
});
