import { test, expect } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
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
