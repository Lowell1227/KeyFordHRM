import { test, expect } from '@playwright/test';
import { DashboardPage } from '../page-objects/dashboard.page';
import { ReportsPage } from '../page-objects/reports.page';

test.describe('02-role-menu-visibility employee', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  test('employee sees only 首页 and 我的绩效', async ({ page }) => {
    await page.goto('/dashboard');
    const dashboard = new DashboardPage(page);
    await expect(dashboard.menuItem('首页')).toBeVisible();
    await expect(dashboard.menuItem('我的绩效')).toBeVisible();
    await expect(dashboard.menuItem('考核周期')).not.toBeVisible();
    await expect(dashboard.menuItem('绩效校准')).not.toBeVisible();
  });
});

test.describe('02-role-menu-visibility HR', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('HR sees full admin menus', async ({ page }) => {
    await page.goto('/dashboard');
    const dashboard = new DashboardPage(page);
    await expect(dashboard.menuItem('考核周期')).toBeVisible();
    await expect(dashboard.menuItem('考核模板')).toBeVisible();
    await expect(dashboard.menuItem('指标库')).toBeVisible();
    await expect(dashboard.menuItem('绩效校准')).toBeVisible();
    await expect(dashboard.menuItem('结果公示')).toBeVisible();
    await expect(dashboard.menuItem('申诉处理')).toBeVisible();
    await expect(dashboard.menuItem('用户管理')).toBeVisible();
  });
});

test.describe('02-role-menu-visibility VP', () => {
  test.use({ storageState: 'e2e/auth-state/approver.json' });

  test('VP sees only 汇总 tab in reports', async ({ page }) => {
    const reports = new ReportsPage(page);
    await reports.goto();
    await expect(reports.tab('汇总')).toBeVisible();
    await expect(reports.tab('进度')).not.toBeVisible();
    await expect(reports.tab('A/D名单')).not.toBeVisible();
    await expect(reports.tab('导出')).not.toBeVisible();
  });
});
