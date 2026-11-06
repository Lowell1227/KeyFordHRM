import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

const employee = {
  id: 'employee-yu',
  name: '余焱玲',
  employeeNo: '001',
  deptId: 'dept-hr',
  deptName: '人事部',
  position: '人事专员',
  employmentType: 'full_time',
  status: 'active',
  directManagerId: 'manager-fang',
  directManagerName: '方园',
  sysRole: 'employee',
  isAssessorOnly: false,
  canViewAll: false,
  dingtalkBindingState: 'enabled',
};

const archive = {
  ...employee,
  entryDate: '2024-01-01T00:00:00.000Z',
  dept: { id: 'dept-hr', name: '人事部', fullPath: '职能中心/人事部', company: 'fuede' },
  performanceManager: { id: 'manager-fang', name: '方园', employeeNo: '002' },
  rosterManager: { id: 'manager-fang', name: '方园', employeeNo: '002' },
  employeeProfile: {
    phone: '138****0000',
    gender: '女',
    birthDate: null,
    ethnicity: null,
    education: '本科',
    professionalTitle: null,
    school: '示例大学',
    graduationDate: null,
    major: '人力资源',
  },
  employmentHistory: [{
    id: 'employment-1',
    company: 'fuede',
    position: '人事专员',
    jobGrade: 'P3',
    jobFamily: '人力资源',
    workLocation: '杭州',
    employeeStatus: 'active',
    effectiveFrom: '2024-01-01T00:00:00.000Z',
    effectiveTo: null,
    changeType: 'hire',
    dept: { id: 'dept-hr', name: '人事部', fullPath: '职能中心/人事部' },
    directManager: { id: 'manager-fang', name: '方园', employeeNo: '002' },
  }],
  currentEmployment: { id: 'employment-current', company: 'fansibao', companyText: '凡思堡' },
  employeeContracts: [],
  dingtalkBinding: null,
};

async function mockBase(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 10 * 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'admin-1', name: '系统管理员', deptId: null, sysRole: 'system_admin', isAssessorOnly: false, canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'dept-hr', name: '人事部', parentId: null, company: 'fuede', sortOrder: 1, isActive: true,
      directMemberCount: 1, memberCount: 1, children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [employee] })),
  }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/contract-subjects**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/personnel-reference-data/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/employee-yu', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archive)),
  }));
  await page.route('**/api/v1/employee-archives/issues**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse({ items: [] })),
  }));
}

async function openEditor(page: import('@playwright/test').Page) {
  await page.goto(`${webBaseUrl}/users`);
  await page.getByRole('button', { name: '查看档案' }).click();
  const drawer = page.getByRole('dialog', { name: '员工档案' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '编辑档案' }).click();
  await expect(drawer.getByRole('textbox', { name: '职级' })).toBeVisible();
  return drawer;
}

const leaveDialog = (page: import('@playwright/test').Page) => (
  page.locator('.el-message-box').filter({ hasText: '保留本次修改' })
);

test('档案编辑在草稿保存被冲突阻断时仍可放弃修改并关闭抽屉', async ({ page }) => {
  await mockBase(page);
  await page.route('**/api/v1/employee-archives/employee-yu/draft/save**', (route) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ code: 4090, message: '资料已变化，请重新打开最新草稿核对' }),
  }));

  const drawer = await openEditor(page);
  await drawer.getByRole('textbox', { name: '职级' }).fill('P6');
  // 自动保存触发 409 后进入阻断态：提示“资料已更新，本次输入已保留”
  await expect(drawer.getByText(/资料已更新，本次输入已保留/)).toBeVisible();

  const closeDrawer = async () => {
    await page.locator('.employee-archive-drawer .el-drawer__close-btn').click();
    await expect(leaveDialog(page)).toBeVisible();
  };

  // “保存后离开”在阻断态必然失败，抽屉应保持打开（修复前此处会反复弹窗无法退出）
  await closeDrawer();
  await leaveDialog(page).getByRole('button', { name: '保存后离开' }).click();
  await expect(drawer).toBeVisible();

  // 重新关闭并选择“放弃修改离开”，抽屉应正常关闭
  await closeDrawer();
  await leaveDialog(page).getByRole('button', { name: '放弃修改离开' }).click();
  await expect(drawer).toBeHidden();
});

test('档案编辑离开弹窗保留继续编辑入口，不强制保存或放弃', async ({ page }) => {
  let draftSaved = false;
  await mockBase(page);
  await page.route('**/api/v1/employee-archives/employee-yu/draft/save**', (route) => {
    draftSaved = true;
    void route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ id: 'review-1', requestVersion: 1, profileReviewStatus: 'pending' })),
    });
  });

  const drawer = await openEditor(page);
  await drawer.getByRole('textbox', { name: '职级' }).fill('P6');
  await expect.poll(() => draftSaved).toBe(true);
  // 第一次保存已同步快照；再次编辑让表单回到未保存状态（700ms 自动保存窗口内关闭）
  await drawer.getByRole('textbox', { name: '职级' }).fill('P7');

  await page.locator('.employee-archive-drawer .el-drawer__close-btn').click();
  const dialog = leaveDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存后离开' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '放弃修改离开' })).toBeVisible();

  // 点击弹窗右上角 X 视为继续编辑：抽屉保持打开且输入保留
  await dialog.locator('.el-message-box__headerbtn').click();
  await expect(dialog).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: '职级' })).toHaveValue('P7');
});
