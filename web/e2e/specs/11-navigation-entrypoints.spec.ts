import { test, expect } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { isPerformanceWorkspacePath } from '../../src/router/performance-workspace';
import { routes } from '../../src/router/routes';
import { DashboardPage } from '../page-objects/dashboard.page';

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
