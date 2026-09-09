import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test('keeps query controls visible and uses mobile cards with bottom pagination', async ({ page }) => {
  const interviews = Array.from({ length: 25 }, (_, index) => ({
    id: `interview-${index + 1}`,
    employeeId: `employee-${index + 1}`,
    employeeName: `面谈员工${String(index + 1).padStart(2, '0')}`,
    employeeNo: String(index + 1).padStart(3, '0'),
    deptId: 'dept-sales',
    deptName: '销售部',
    cycleId: 'cycle-1',
    interviewerId: 'manager-1',
    status: 'pending',
    method: null,
    deadline: '2026-09-30T00:00:00.000Z',
    managerSignedAt: null,
    employeeSignedAt: null,
  }));

  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-manager-token');
    localStorage.setItem('expiresAt', String(Date.now() + 10 * 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'manager-1', name: '测试主管', deptId: 'dept-sales', sysRole: 'manager', isAssessorOnly: false, canViewAll: false,
      businessCapabilities: { canHandleInterviews: true },
    })),
  }));
  await page.route('**/api/v1/interviews**', (route) => {
    const url = new URL(route.request().url());
    const requestedPage = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const start = (requestedPage - 1) * pageSize;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: interviews.length,
        page: requestedPage,
        pageSize,
        items: interviews.slice(start, start + pageSize),
      })),
    });
  });

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`${webBaseUrl}/interviews`);

  const filters = page.getByPlaceholder('请输入姓名或工号');
  await expect(filters).toBeVisible();
  await expect(page.getByText('筛选条件', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /展开筛选|收起筛选/ })).toHaveCount(0);

  const resultCard = page.locator('.list-result-card');
  const desktopResults = resultCard.locator('.desktop-result-table');
  const mobileResults = resultCard.locator('.mobile-result-list');
  const pager = resultCard.locator('.list-pagination__control');
  await expect(desktopResults).toBeVisible();
  await expect(mobileResults).toBeHidden();
  await expect.poll(() => pager.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  })).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(desktopResults).toBeHidden();
  await expect(mobileResults).toBeVisible();
  await expect(mobileResults.locator('.mobile-result-card')).toHaveCount(10);
  await expect(mobileResults.locator('.mobile-result-card').first()).toContainText('面谈员工01');
  await expect(resultCard.locator('.app-pager')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
  }))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
});
