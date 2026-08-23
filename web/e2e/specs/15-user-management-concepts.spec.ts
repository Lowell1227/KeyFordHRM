import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isTopLevelDepartmentLeader } from '../../src/utils/organization-relations';

const viewPath = fileURLToPath(
  new URL('../../src/views/admin/UserManageView.vue', import.meta.url),
);

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
});

test('uses concise and consistent organization relationship concepts', async () => {
  const source = await readFile(viewPath, 'utf8');

  for (const label of [
    '人员设置',
    '直属主管',
    '系统权限',
    '设置部门负责人',
    '最终业务审批人',
    '设置最终业务审批人',
    '待处理事项',
  ]) {
    expect(source).toContain(label);
  }

  expect(source).not.toContain('HRM 花名册是组织、人员和任职的唯一依据');
  expect(source).not.toContain('审批未就绪');
  expect(source).not.toContain('未推导');
  expect(source).not.toContain('审批人来源');
  expect(source).not.toContain('绩效结果审批人');
  expect(source).not.toContain('组织负责人');
  expect(source).not.toContain('openManagerDialog');
  expect(source).not.toContain('openRoleDialog');
  expect(source).not.toContain('该员工的系统角色');
  expect(source).toContain('主管权限：已开通');
  expect(source).not.toContain('设置负责人');
  expect(source).not.toContain('高级设置');
  expect(source).not.toContain('审批责任人');
  expect(source).not.toContain('关系说明');
  expect(source).not.toContain('title="设置审批覆盖"');
});

test('recognizes only the root department leader as eligible to have no performance manager', () => {
  const departments = [
    { id: 'dept-root', parentId: null, leaderId: 'leader-root' },
    { id: 'dept-child', parentId: 'dept-root', leaderId: 'leader-child' },
  ];

  expect(isTopLevelDepartmentLeader({
    id: 'leader-root',
    deptId: 'dept-root',
    directManagerId: 'legacy-manager',
  }, departments)).toBe(true);

  expect(isTopLevelDepartmentLeader({
    id: 'leader-child',
    deptId: 'dept-child',
    directManagerId: null,
  }, departments)).toBe(false);

  expect(isTopLevelDepartmentLeader({
    id: 'employee-root',
    deptId: 'dept-root',
    directManagerId: null,
  }, departments)).toBe(false);
});

test('keeps the employee roster pager visible while the table scrolls independently', async ({ page }) => {
  const employees = Array.from({ length: 45 }, (_, index) => ({
    id: `employee-${index + 1}`,
    name: `员工${String(index + 1).padStart(2, '0')}`,
    employeeNo: String(index + 1).padStart(3, '0'),
    deptId: 'dept-hr',
    deptName: '人事行政部',
    position: '专员',
    employmentType: 'full_time',
    status: 'active',
    directManagerId: 'manager-1',
    directManagerName: '直属主管',
    sysRole: 'employee',
    isAssessorOnly: false,
    canViewAll: false,
    dingtalkBindingState: 'unbound',
  }));
  const requestedPages: number[] = [];

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
      id: 'dept-hr', name: '人事行政部', parentId: null, company: 'fuede', sortOrder: 1, isActive: true,
      directMemberCount: employees.length, memberCount: employees.length, children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => {
    const url = new URL(route.request().url());
    const requestedPage = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    requestedPages.push(requestedPage);
    const start = (requestedPage - 1) * pageSize;
    const items = employees.slice(start, start + pageSize);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: employees.length, page: requestedPage, pageSize, items })),
    });
  });

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`${webBaseUrl}/users`);
  await page.getByRole('button', { name: '员工名册' }).click();

  const roster = page.locator('.directory-view');
  const tableBody = roster.locator('.el-table__body-wrapper .el-scrollbar__wrap');
  const pager = roster.locator('.el-pagination');
  await expect(roster.getByText('员工01', { exact: true })).toBeVisible();
  await expect.poll(() => tableBody.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollable: element.scrollHeight > element.clientHeight,
  }))).toEqual({ overflowY: 'auto', scrollable: true });
  await expect.poll(() => pager.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  })).toBe(true);

  await pager.locator('.btn-next').click();
  await expect.poll(() => requestedPages).toContain(2);
  await expect(roster.getByText('员工21', { exact: true })).toBeVisible();
});

test('collapses and restores roster filters without hiding the result workspace', async ({ page }) => {
  const employee = {
    id: 'employee-1', name: '员工01', employeeNo: '001', deptId: 'dept-hr', deptName: '人事行政部',
    position: '专员', employmentType: 'full_time', status: 'active', directManagerId: 'manager-1',
    directManagerName: '直属主管', sysRole: 'employee', isAssessorOnly: false, canViewAll: false,
    dingtalkBindingState: 'unbound',
  };

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
      id: 'dept-hr', name: '人事行政部', parentId: null, company: 'fuede', sortOrder: 1, isActive: true,
      directMemberCount: 1, memberCount: 1, children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [employee] })),
  }));

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`${webBaseUrl}/users`);
  await page.getByRole('button', { name: '员工名册' }).click();

  const roster = page.locator('.directory-view');
  const filterInput = roster.getByPlaceholder('搜索姓名或工号');
  await expect(filterInput).toBeVisible();
  await roster.getByRole('button', { name: '收起筛选' }).click();
  await expect(filterInput).toBeHidden();
  await expect(roster.getByText('员工01', { exact: true })).toBeVisible();
  await expect(roster.locator('.el-pagination')).toBeVisible();
  await roster.getByRole('button', { name: '展开筛选' }).click();
  await expect(filterInput).toBeVisible();
});

test('filters direct-manager candidates by employee name', async ({ page }) => {
  const employee = {
    id: 'employee-yu',
    name: '余焱玲',
    employeeNo: null,
    deptId: 'dept-hr',
    deptName: '人事部',
    position: '人事专员',
    employmentType: 'regular',
    status: 'active',
    directManagerId: null,
    directManagerName: null,
    sysRole: 'employee',
    isAssessorOnly: false,
    canViewAll: false,
  };
  const initialCandidate = {
    ...employee,
    id: 'employee-other',
    name: '张三',
  };
  const expectedManager = {
    ...employee,
    id: 'manager-fang',
    name: '方园',
    position: 'HRBP',
    sysRole: 'manager',
  };
  const searchedKeywords: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 10 * 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'admin-1',
      name: '系统管理员',
      deptId: null,
      sysRole: 'system_admin',
      isAssessorOnly: false,
      canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'dept-hr',
      name: '人事部',
      parentId: null,
      company: 'kayford',
      sortOrder: 1,
      isActive: true,
      directMemberCount: 1,
      memberCount: 1,
      effectiveApproverId: 'approver-yao',
      effectiveApproverName: '郭志浩',
      effectiveApproverSource: 'leader_manager',
      children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get('keyword') ?? '';
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    if (pageSize === 50) searchedKeywords.push(keyword);
    const items = pageSize === 50
      ? keyword === '方园' ? [expectedManager] : [initialCandidate]
      : [employee];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: items.length, page: 1, pageSize, items })),
    });
  });

  await page.goto(`${webBaseUrl}/users`);
  const approverCard = page.locator('.relation-card').filter({ hasText: '最终业务审批人' });
  await expect(approverCard).toContainText('郭志浩');
  await expect(approverCard).toContainText('自动取部门负责人的绩效直属上级');
  await expect(approverCard).toContainText('HR 只负责校准');
  await expect(page.getByRole('button', { name: '设置最终业务审批人' })).toBeVisible();
  await expect(page.locator('.approver-trail-card')).toHaveCount(0);
  await page.getByRole('button', { name: '人员设置' }).click();
  const dialog = page.getByRole('dialog', { name: '人员设置' });
  await expect(dialog).toBeVisible();
  const input = dialog.locator('.el-form-item').filter({ hasText: '绩效直属上级' }).locator('.el-select input');
  await input.fill('方园');
  await expect.poll(() => searchedKeywords).toContain('方园');

  const dropdown = page.locator('.el-select-dropdown:visible');
  await expect(dropdown.locator('.el-select-dropdown__item')).toHaveCount(1);
  await expect(dropdown).toContainText('方园');
  await expect(dropdown).not.toContainText('张三');
});

test('uses one person settings dialog and shows manager access before saving', async ({ page }) => {
  const employee = {
    id: 'employee-yu',
    name: '余焱玲',
    employeeNo: null,
    deptId: 'dept-hr',
    deptName: '人事部',
    position: '人事专员',
    employmentType: 'regular',
    status: 'active',
    directManagerId: null,
    directManagerName: null,
    sysRole: 'employee',
    isAssessorOnly: false,
    canViewAll: false,
  };
  const manager = {
    ...employee,
    id: 'manager-fang',
    name: '方园',
    position: 'HRBP',
  };
  let performanceReviewBody: unknown;

  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 10 * 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'admin-1',
      name: '系统管理员',
      deptId: null,
      sysRole: 'system_admin',
      isAssessorOnly: false,
      canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'dept-hr',
      name: '人事部',
      parentId: null,
      company: 'kayford',
      sortOrder: 1,
      isActive: true,
      directMemberCount: 1,
      memberCount: 1,
      children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => {
    const url = new URL(route.request().url());
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const items = pageSize === 50 ? [manager] : [employee];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: items.length, page: 1, pageSize, items })),
    });
  });
  await page.route('**/api/v1/users/**', async (route) => {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(manager)),
    });
  });
  await page.route('**/api/v1/employee-archives/employee-yu/performance-manager-review', (route) => {
    performanceReviewBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        id: 'review-manager-change',
        userId: employee.id,
        profileReviewStatus: 'not_required',
        performanceReviewStatus: 'pending',
      })),
    });
  });
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [] })),
  }));

  await page.goto(`${webBaseUrl}/users`);
  await expect(page.getByRole('columnheader', { name: '岗位', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '系统角色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '人员设置' }).click();
  const dialog = page.getByRole('dialog', { name: '人员设置' });
  await expect(dialog.getByText('余焱玲的岗位', { exact: true })).toBeVisible();
  await expect(dialog.locator('.el-form-item').filter({ hasText: '余焱玲的岗位' })).toContainText('人事专员');
  await expect(dialog.getByText('余焱玲的系统角色', { exact: true })).toBeVisible();
  await dialog.locator('.el-form-item').filter({ hasText: '绩效直属上级' }).locator('.el-select').click();
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '方园' }).click();
  await expect(dialog).toContainText('方园的主管权限');
  await expect(dialog).toContainText('未开通，绩效关系审核通过时自动开通');
  await expect(dialog).toContainText('绩效关系审核通过时将把系统角色升级为主管，岗位 HRBP 保持不变');
  await dialog.getByRole('button', { name: '提交审核' }).click();

  await expect.poll(() => performanceReviewBody).toEqual({
    managerId: manager.id,
  });

  await page.getByRole('button', { name: '员工名册' }).click();
  await expect(page.getByRole('columnheader', { name: '岗位', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '系统角色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '人员设置' }).click();
  const rosterDialog = page.getByRole('dialog', { name: '人员设置' });
  await expect(rosterDialog.getByText('余焱玲的岗位', { exact: true })).toBeVisible();
  await expect(rosterDialog.getByText('余焱玲的系统角色', { exact: true })).toBeVisible();
});

test('opens one employee archive with employment history, contracts and an identity-only DingTalk switch', async ({ page }) => {
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
    currentEmployment: {
      id: 'employment-current',
      company: 'fansibao',
    },
    employeeContracts: [{
      id: 'contract-1',
      contractType: 'contract',
      name: '劳动合同',
      signingCompany: '孚德',
      signedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z',
      termType: '3年',
    }],
    dingtalkBinding: {
      id: 'binding-1',
      status: 'enabled',
      boundAt: '2024-01-01T00:00:00.000Z',
      disabledAt: null,
      disabledReason: null,
      lastLoginAt: '2026-08-19T08:00:00.000Z',
    },
  };

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
  await page.route('**/api/v1/employee-archives/employee-yu', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archive)),
  }));

  await page.goto(`${webBaseUrl}/users`);
  await page.getByRole('button', { name: '员工名册' }).click();
  await page.getByRole('button', { name: '查看档案' }).click();

  const drawer = page.getByRole('dialog', { name: '员工档案' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('当前任职');
  await expect(drawer.locator('.employee-archive__facts > div').filter({ hasText: '所属公司' }).first()).toContainText('凡思堡');
  await expect(drawer).toContainText('任职历史');
  await expect(drawer).toContainText('劳动合同');
  await expect(drawer).toContainText('仅影响钉钉登录和消息通知，不读取或同步钉钉组织');
  await expect(drawer.getByRole('switch')).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => drawer.evaluate((element) => ({
    drawerWidth: element.getBoundingClientRect().width,
    pageWidth: document.documentElement.scrollWidth,
  }))).toEqual({ drawerWidth: 390, pageWidth: 390 });
});

test('department tree, organization detail and archive drawer scroll independently on desktop', async ({ page }) => {
  const departments = Array.from({ length: 24 }, (_, index) => ({
    id: `dept-${index}`,
    name: `部门${String(index + 1).padStart(2, '0')}`,
    parentId: null,
    company: 'fuede',
    sortOrder: index,
    isActive: true,
    directMemberCount: 1,
    memberCount: 1,
    children: [],
  }));
  const employee = {
    id: 'employee-scroll', employeeNo: '001', name: '滚动测试员工', deptId: 'dept-0', deptName: '部门01',
    position: '专员', employmentType: 'full_time', status: 'active', directManagerId: null,
    directManagerName: null, sysRole: 'employee', isAssessorOnly: false, canViewAll: false,
    dingtalkBindingState: 'unbound',
  };
  const orgMembers = [
    employee,
    ...Array.from({ length: 11 }, (_, index) => ({
      ...employee,
      id: `employee-scroll-${index + 2}`,
      employeeNo: String(index + 2).padStart(3, '0'),
      name: `滚动测试员工${index + 2}`,
    })),
  ];
  const archive = {
    ...employee,
    entryDate: '2024-01-01T00:00:00.000Z',
    dept: { id: 'dept-0', name: '部门01', fullPath: '孚德 / 部门01', company: 'fuede' },
    performanceManager: null,
    rosterManager: null,
    employeeProfile: {},
    employmentHistory: Array.from({ length: 12 }, (_, index) => ({
      id: `employment-${index}`,
      company: 'fuede', position: `岗位${index + 1}`, jobGrade: null, jobFamily: null,
      workLocation: '杭州', employeeStatus: 'active', effectiveFrom: '2024-01-01T00:00:00.000Z',
      effectiveTo: null, changeType: 'transfer', dept: { id: 'dept-0', name: '部门01', fullPath: '孚德 / 部门01' },
      directManager: null,
    })),
    employeeContracts: [],
    dingtalkBinding: null,
  };

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
    contentType: 'application/json', body: JSON.stringify(apiResponse(departments)),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: orgMembers.length, page: 1, pageSize: 20, items: orgMembers })),
  }));
  await page.route('**/api/v1/employee-archives/employee-scroll', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archive)),
  }));

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`${webBaseUrl}/users`);

  for (const selector of ['.app-rail', '.menu-scroll']) {
    await expect.poll(() => page.locator(selector).evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  }

  for (const selector of ['.org-tree-panel', '.org-detail']) {
    await expect.poll(() => page.locator(selector).evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollable: element.scrollHeight > element.clientHeight,
    }))).toEqual({ overflowY: 'auto', scrollable: true });
  }

  await page.getByRole('button', { name: '查看档案' }).first().click();
  const drawerBody = page.locator('.employee-archive-drawer .el-drawer__body');
  await expect.poll(() => drawerBody.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollable: element.scrollHeight > element.clientHeight,
  }))).toEqual({ overflowY: 'auto', scrollable: true });
});
