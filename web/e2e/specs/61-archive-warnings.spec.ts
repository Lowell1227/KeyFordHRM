import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

// Legacy personnel fixtures have no maintained contract subjects.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/contract-subjects**', route => route.fulfill({ json: response([]) }));
});
const employee = {
  id: 'archive-warning-employee', name: '档案待完善测试员工', employeeNo: 'WARN001',
  sysRole: 'employee', status: 'active', employmentType: 'full_time',
  deptName: '人事行政部', position: '人事专员', directManagerName: '直属上级',
  hrCapabilities: [], businessIdentities: [], isAssessorOnly: false, canViewAll: false,
  dingtalkBindingState: 'unbound', archivedAt: null,
  archiveWarnings: [
    { field: 'profile.phone', message: '联系电话待补充' },
    { field: 'contracts.signedAt', message: '第一次劳动合同签订日期待核对，请根据合同原件补充完整日期' },
  ],
};

async function setup(page: Page, capability = 'employee_archive_review', companyText: string | null = null) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'archive-warning-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'hr-warning', name: '档案审核人员', sysRole: 'hr_user',
      hrCapabilities: [capability], canViewAll: false };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
    else if (path.includes('/employee-archives/issues/employee/')) data = { items: employee.archiveWarnings.map((warning, index) => ({
      id: `issue-${index}`, requestId: 'synthetic-source-request', employeeId: employee.id, field: warning.field,
      kind: 'missing', message: warning.message, reason: warning.message,
      source: { value: null }, current: { value: null }, status: 'open', canConfirmCurrent: false,
      confirmBlockedReason: '请在原档案中核实补充，不能直接确认空值。', fingerprint: `synthetic-${index}`,
      maintenance: { employeeId: employee.id, requestId: 'synthetic-source-request', draft: false },
    })) };
    else if (path.endsWith(`/employee-archives/${employee.id}`)) data = { ...employee,
      currentEmployment: { company: 'fuede', companyText },
      employeeProfile: {}, employmentHistory: [], contracts: [], changeHistory: [], archiveEvents: [],
      dept: { name: '人事行政部' }, dingtalkBinding: null };
    else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(data)) });
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px 档案姓名旁可展开待确认清单并进入原有档案维护`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.goto('/users');
    const list = page.locator(viewport.width < 768 ? '.roster-mobile-list' : '.desktop-result-table');
    await expect(list.getByText(employee.name, { exact: viewport.width >= 768 })).toBeVisible();
    const marker = list.getByRole('button', { name: '待确认 2项', exact: true });
    await expect(marker).toBeVisible();
    await marker.click();
    const details = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
    await expect(details.getByRole('heading', { name: '联系电话待补充', exact: true })).toBeVisible();
    await expect(details.getByRole('heading', { name: employee.archiveWarnings[1]!.message, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`archive-warnings-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await details.getByRole('button', { name: '查看资料', exact: true }).first().click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await expect(drawer).toBeVisible();
    await expect(page.locator('.employee-archive__name')).toContainText(employee.name);
    await expect(drawer.getByRole('button', { name: '提交审核', exact: true })).toHaveCount(0);
    await expect(page.getByText('所属公司', { exact: true }).locator('..').locator('strong')).toHaveText('待补充');
  });
}

test('只有组织管理权限时不展示档案待完善提示', async ({ page }) => {
  await setup(page, 'organization_edit');
  await page.goto('/users');
  await expect(page.locator('.roster-person-heading').getByText(employee.name)).toBeVisible();
  await expect(page.getByRole('button', { name: '待确认 2项', exact: true })).toHaveCount(0);
});

test('档案详情直接显示花名册公司名称', async ({ page }) => {
  await setup(page, 'employee_archive_review', '花名册公司完整名称');
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).click();
  await expect(page.getByText('所属公司', { exact: true }).locator('..').locator('strong')).toHaveText('花名册公司完整名称');
});
