import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

test.describe('HR business list templates', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('appeals uses the record template on desktop and mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/appeals');

    const listPage = page.getByTestId('business-list-page');
    await expect(listPage).toHaveAttribute('data-list-variant', 'record');
    await expect(listPage.locator('.desktop-result-table')).toBeVisible();
    await expect(listPage.locator('.mobile-result-list')).toBeHidden();
    await page.getByRole('button', { name: '新增申诉记录' }).click();
    await expect(page.getByTestId('business-detail-drawer')).toHaveAttribute('data-drawer-variant', 'standard');
    await page.getByRole('button', { name: '取消' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(listPage.locator('.desktop-result-table')).toBeHidden();
    await expect(listPage.locator('.mobile-result-list')).toBeVisible();
    await page.getByRole('button', { name: '新增申诉记录' }).click();
    await expect.poll(() => page.getByTestId('business-detail-drawer').evaluate((element) => (
      Math.round(element.getBoundingClientRect().width)
    ))).toBe(390);
    await page.getByRole('button', { name: '取消' }).click();
    await expect.poll(() => page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
  });

  test('confirmation workflow opens in a routed drawer and browser back keeps the list', async ({ page }) => {
    await page.route('**/api/v1/confirmation-applications/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/warnings')) return route.fallback();
      const id = path.split('/').at(-1) ?? '';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          id,
          employeeId: 'employee-drawer',
          employee: { id: 'employee-drawer', name: '抽屉验收员工' },
          status: 'approved',
          manager: { id: 'manager-drawer', name: '直属主管' },
          hr: { id: 'hr-drawer', name: 'HR 经办人' },
          companyApprover: { id: 'approver-drawer', name: '公司审批人' },
          roster: {
            company: 'fuede',
            deptName: '验收部门',
            position: '验收岗位',
            entryDate: '2026-01-01T00:00:00.000Z',
            plannedRegularDate: '2026-04-01T00:00:00.000Z',
          },
          actualRegularDate: '2026-04-01T00:00:00.000Z',
          summary: '用于验证流程详情在列表抽屉内完整显示。',
          workflowVersion: 2,
          canViewInternalMeeting: false,
          canApprove: false,
          pendingRole: null,
          steps: [],
          history: [],
          meetingAttachments: [],
        })),
      });
    });
    await page.route('**/api/v1/tasks**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ items: [], total: 0, page: 1, pageSize: 50 })),
    }));
    await page.goto('/confirmation-applications/manage');

    const listPage = page.getByTestId('business-list-page');
    await page.getByRole('button', { name: '查看' }).first().click();
    await expect(page).toHaveURL(/\/confirmation-applications\/manage\/[^/]+$/);
    await expect(page.getByTestId('business-detail-drawer')).toHaveAttribute('data-drawer-variant', 'workflow');
    await expect(page.getByTestId('business-detail-drawer').getByText('抽屉验收员工')).toBeVisible();
    await expect(listPage).toBeAttached();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByTestId('business-detail-drawer').evaluate((element) => (
      Math.round(element.getBoundingClientRect().width)
    ))).toBe(390);

    await page.goBack();
    await expect(page.getByTestId('business-detail-drawer')).toBeHidden();
    await expect(listPage).toHaveAttribute('data-list-variant', 'workflow');
  });
});

test.describe('administrator business list templates', () => {
  test.use({ storageState: 'e2e/auth-state/admin.json' });

  test('employee roster uses one record list without a duplicate organization scope', async ({ page }) => {
    await page.goto('/users');

    const listPage = page.getByTestId('business-list-page');
    await expect(listPage).toHaveAttribute('data-list-variant', 'record');
    await expect(page.getByTestId('split-list-layout')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '部门' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '选择范围' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
  });
});
