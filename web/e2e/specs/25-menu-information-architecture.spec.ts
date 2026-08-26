import { expect, test } from '@playwright/test';

test.describe('25-menu-information-architecture recruitment boundary', () => {
  test.describe('system administrator', () => {
    test.use({ storageState: 'e2e/auth-state/admin.json' });

    test('shows a paused recruitment page without hiring operations', async ({ page }) => {
      await page.goto('/recruitment');

      await expect(page).toHaveURL(/\/recruitment$/);
      await expect(page.getByRole('heading', { name: '招聘（规划中）' })).toBeVisible();
      await expect(page.getByText('已暂缓', { exact: true })).toBeVisible();
      await expect(page.getByText('当前不建设候选人、面试与 Offer 全流程')).toBeVisible();
      const overview = page.getByTestId('recruitment-overview');
      await expect(overview.getByRole('button')).toHaveCount(0);
      await expect(overview.locator('input, textarea, select')).toHaveCount(0);
    });
  });

  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('cannot see or open recruitment planning', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByTestId('nav-module-recruitment')).toHaveCount(0);

      await page.goto('/recruitment');
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});

test.describe('25-menu-information-architecture compensation boundary', () => {
  test.describe('system administrator', () => {
    test.use({ storageState: 'e2e/auth-state/admin.json' });

    test('shows a paused planning page without salary operations', async ({ page }) => {
      await page.goto('/compensation');

      await expect(page).toHaveURL(/\/compensation$/);
      await expect(page.getByRole('heading', { name: '薪酬（规划中）' })).toBeVisible();
      await expect(page.getByText('已暂缓', { exact: true })).toBeVisible();
      await expect(page.getByText('当前不开发工资核算与发放能力')).toBeVisible();
      const overview = page.getByTestId('compensation-overview');
      await expect(overview.getByRole('button')).toHaveCount(0);
      await expect(overview.locator('input, textarea, select')).toHaveCount(0);
    });

    test('marks compensation as planned and keeps the mobile rail usable', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');

      await expect(page.getByTestId('nav-module-compensation')).toBeVisible();
      await expect(page.getByTestId('module-status-compensation')).toHaveText('规划中');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('cannot open compensation before a dedicated permission exists', async ({ page }) => {
      await page.goto('/compensation');

      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});

test.describe('25-menu-information-architecture system capability overview', () => {
  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('shows current and missing system capabilities without fake actions', async ({ page }) => {
      await page.goto('/system');

      await expect(page).toHaveURL(/\/system$/);
      await expect(page.getByRole('heading', { name: '系统能力总览' })).toBeVisible();
      await expect(page.getByTestId('system-capability-status')).toHaveCount(12);
      await expect(page.getByText('招聘候选人、面试与 Offer 全流程')).toBeVisible();
      await expect(page.getByText('OA 审批读取与事件订阅')).toBeVisible();
      await expect(page.getByText('考勤结果读取')).toBeVisible();
      await expect(page.getByText('钉钉待办与消息')).toBeVisible();
      await expect(page.getByText('钉钉日志读取')).toBeVisible();
      await expect(page.getByText('薪酬指定 HR 主管权限')).toBeVisible();
      await expect(page.getByTestId('system-overview').getByRole('button')).toHaveCount(0);
    });
  });

  test.describe('employee', () => {
    test.use({ storageState: 'e2e/auth-state/employee.json' });

    test('cannot open the system overview', async ({ page }) => {
      await page.goto('/system');

      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});
