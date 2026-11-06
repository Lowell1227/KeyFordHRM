import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, data, message: 'success', timestamp: Date.now() });

async function setupPage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({
      id: 'hr-1', name: 'HR管理员', sysRole: 'hr', canViewAll: true,
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response([])) }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response([])) }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/contract-subjects**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response([])) }));
  await page.route('**/api/v1/personnel-reference-data/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response([])) }));
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/issues**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ items: [] })),
  }));
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'review-detail-1',
    userId: 'employee-yu',
    employeeName: '余焱玲',
    employeeNo: '001',
    sourceType: 'manual_archive_change',
    recordStatus: 'submitted',
    profileReviewStatus: 'pending',
    performanceReviewStatus: 'not_required',
    validationErrors: [],
    validationWarnings: [],
    createdAt: '2026-11-06T08:00:00.000Z',
    updatedAt: '2026-11-06T08:00:00.000Z',
    events: [],
    createdBy: { id: 'admin-1', name: '方园' },
    baseValue: { employee: { jobGrade: 'P3' }, profile: {}, contracts: [] },
    proposedValue: { employee: { jobGrade: 'P6' }, profile: {}, contracts: [] },
    ...overrides,
  };
}

test('审核人在办理详情抽屉内直接通过待审核变更', async ({ page }) => {
  await setupPage(page);
  let detail = makeRequest();
  const approveCalls: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ items: [detail], total: 1, page: 1, pageSize: 20 })),
  }));
  await page.route('**/api/v1/employee-archives/applications/review-detail-1', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response(detail)),
  }));
  await page.route('**/api/v1/employee-archives/reviews/approve', (route) => {
    approveCalls.push(route.request().postDataJSON() as Record<string, unknown>);
    detail = makeRequest({ profileReviewStatus: 'approved' });
    void route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response({ succeeded: [{ requestId: 'review-detail-1', scopes: ['profile', 'performance'] }], failed: [] })),
    });
  });

  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '查看办理详情', exact: true }).click();
  const detailDialog = page.getByRole('dialog', { name: '档案修改办理详情', exact: true });
  await expect(detailDialog).toBeVisible();

  // 待审核状态下审核人可直接在抽屉内办理
  await expect(detailDialog.getByRole('button', { name: '通过', exact: true })).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: '退回', exact: true })).toBeVisible();
  await detailDialog.getByRole('button', { name: '通过', exact: true }).click();

  await expect.poll(() => approveCalls.length).toBe(1);
  expect(approveCalls[0]).toEqual({ requestIds: ['review-detail-1'], scopes: ['profile', 'performance'] });
  // 审核完成后刷新详情，审核按钮消失
  await expect(detailDialog.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
  await expect(detailDialog.getByRole('button', { name: '退回', exact: true })).toHaveCount(0);
});

test('审核人在办理详情抽屉内退回待审核变更并填写原因', async ({ page }) => {
  test.setTimeout(60_000);
  await setupPage(page);
  let detail = makeRequest();
  const rejectCalls: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ items: [detail], total: 1, page: 1, pageSize: 20 })),
  }));
  await page.route('**/api/v1/employee-archives/applications/review-detail-1', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response(detail)),
  }));
  await page.route('**/api/v1/employee-archives/reviews/reject', (route) => {
    rejectCalls.push(route.request().postDataJSON() as Record<string, unknown>);
    detail = makeRequest({ profileReviewStatus: 'rejected' });
    void route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response({ succeeded: [{ requestId: 'review-detail-1', scopes: ['profile', 'performance'] }], failed: [] })),
    });
  });

  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '查看办理详情', exact: true }).click();
  const detailDialog = page.getByRole('dialog', { name: '档案修改办理详情', exact: true });
  await detailDialog.getByRole('button', { name: '退回', exact: true }).click();

  const prompt = page.locator('.el-message-box').filter({ hasText: '退回员工变更' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('textbox').fill('职级调整依据不足');
  await prompt.getByRole('button', { name: '确认退回' }).click();

  await expect.poll(() => rejectCalls.length).toBe(1);
  expect(rejectCalls[0]).toEqual({ requestIds: ['review-detail-1'], reason: '职级调整依据不足' });
  // 详情刷新为已退回，审核按钮消失
  await expect(detailDialog.getByText('已退回，待修改')).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: '退回', exact: true })).toHaveCount(0);
});

test('无审核权限的办理人不显示抽屉内审核按钮', async ({ page }) => {
  await setupPage(page);
  // 普通 HR：可编辑档案但无 employee_archive_review 能力
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({
      id: 'hr-2', name: '普通HR', sysRole: 'hr_user', canViewAll: false,
      hrCapabilities: ['employee_archive_edit'],
    })),
  }));
  const detail = makeRequest();
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ items: [detail], total: 1, page: 1, pageSize: 20 })),
  }));
  await page.route('**/api/v1/employee-archives/applications/review-detail-1', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response(detail)),
  }));

  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '查看办理详情', exact: true }).click();
  const detailDialog = page.getByRole('dialog', { name: '档案修改办理详情', exact: true });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
  await expect(detailDialog.getByRole('button', { name: '退回', exact: true })).toHaveCount(0);
});
