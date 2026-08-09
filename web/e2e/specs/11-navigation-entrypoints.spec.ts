import { test, expect } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { isPerformanceWorkspacePath } from '../../src/router/performance-workspace';
import { routes } from '../../src/router/routes';
import { DashboardPage } from '../page-objects/dashboard.page';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const emptyTeamPage = (pending: number) => ({
  total: pending,
  page: 1,
  pageSize: 1,
  items: [],
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

  test('employee opens the latest active personal task from the dashboard', async ({ page }) => {
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 2,
        page: 1,
        pageSize: 20,
        items: [
          { id: 'task-1', cycleId: 'cycle-1', cycleName: '2026 Q3', employeeId: 'employee-1', status: 'indicator_confirming', isExempt: false },
          { id: 'task-closed', cycleId: 'cycle-0', cycleName: '2026 Q2', employeeId: 'employee-1', status: 'closed', isExempt: false },
        ],
      })),
    }));

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.currentEmployeeTask()).toContainText('目标确认');
    await dashboard.currentEmployeeTaskOpen().click();
    await expect(page).toHaveURL(/\/tasks\/task-1\?returnTo=/);
  });
});

test.describe('11-navigation-entrypoints manager dashboard task entry points', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('manager sees true pending counts and opens the matching team workspace', async ({ page }) => {
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(emptyTeamPage(stage === 'goal-review' ? 3 : 2))),
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
    await expect(page).toHaveURL(/\/tasks\?scope=team&stage=goal-review/);
  });

  test('management rows expose a detail command only for real task ids', async ({ page }) => {
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyTeamPage(0))),
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
    await expect(page).toHaveURL(/\/tasks\/task-7\?returnTo=/);
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
      body: JSON.stringify(apiResponse({
        total: 1,
        page: 1,
        pageSize: 20,
        items: [{ id: 'task-1', cycleId: 'cycle-1', cycleName: '2026 Q3', employeeId: 'manager-1', status: 'self_eval', isExempt: false }],
      })),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyTeamPage(12))),
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
