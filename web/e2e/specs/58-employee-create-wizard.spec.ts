import { expect, test, type Page } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

const department = {
  id: '30000000-0000-4000-8000-000000000001',
  name: '人事部',
  fullPath: '人事行政部 / 人事部',
  parentId: null,
  company: 'fuede',
  sortOrder: 1,
  isActive: true,
  directMemberCount: 0,
  memberCount: 0,
  children: [],
};

async function setupPersonnelPage(page: Page, options: {
  initialDraft?: Record<string, any> | null;
  draftDelayMs?: number;
} = {}) {
  const draftBodies: Array<Record<string, any>> = [];
  const createBodies: Array<Record<string, any>> = [];
  const events: string[] = [];
  let currentDraft: Record<string, any> | null = options.initialDraft ?? null;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-1', name: 'HR管理员', sysRole: 'hr', canViewAll: true,
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([department])),
  }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: '40000000-0000-4000-8000-000000000001',
      code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true, activeEmployeeCount: 0,
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: currentDraft ? 1 : 0,
      page: 1,
      pageSize: 20,
      items: currentDraft ? [currentDraft] : [],
    })),
  }));
  await page.route('**/api/v1/employee-archives/drafts', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    draftBodies.push(body);
    events.push('draft-start');
    if (options.draftDelayMs) await new Promise((resolve) => setTimeout(resolve, options.draftDelayMs));
    currentDraft = {
      id: 'draft-create-1', userId: null, employeeNo: null, employeeName: body.name,
      sourceType: 'manual_employee_create', profileReviewStatus: 'pending',
      performanceReviewStatus: body.performanceManagerId ? 'pending' : 'not_required',
      validationErrors: [], validationWarnings: [], baseValue: {}, recordStatus: 'draft',
      proposedValue: {
        employee: body.employee, profile: body.profile, contracts: body.contracts,
        performance: body.performance,
        draftMeta: { currentStep: body.draftStep, completedSteps: body.completedSteps },
      },
      createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z',
    };
    events.push('draft-finished');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(currentDraft)) });
  });
  await page.route('**/api/v1/employee-archives', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    createBodies.push(body);
    events.push('create');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ id: 'submitted-1', ...body, recordStatus: 'submitted' })),
    });
  });
  await page.route('**/api/v1/employee-archives/diagnostics', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse({ blocking: false, total: 0, items: [] })),
  }));
  return { draftBodies, createBodies, events, getDraft: () => currentDraft };
}

test('新增员工采用完整七步向导且最后一步才提交审核', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(drawer.getByText('身份核验', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('任职信息', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('管理关系', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('个人与教育', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('联系与保障', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('合同与附件', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('预览提交', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: '保存并退出' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '下一步' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '提交审核' })).toHaveCount(0);
  await expect(drawer.getByText('员工工号将在提交审核时自动生成')).toBeVisible();
});

test('输入姓名后静默自动保存并从上次步骤继续填写', async ({ page }) => {
  const state = await setupPersonnelPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('姓名').fill('草稿员工');
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect.poll(() => state.draftBodies.at(-1)).toMatchObject({
    name: '草稿员工', draftStep: 1, completedSteps: [0], saveMode: 'auto',
  });
  await expect(drawer.getByText('已保存', { exact: true })).toBeVisible();
  await expect(page.getByText('草稿已保存，尚未提交审核')).toHaveCount(0);

  await drawer.getByRole('button', { name: '保存并退出' }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByText('草稿', { exact: true }).click();
  await expect(page.getByText('草稿员工', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).first().click();

  const resumed = page.getByRole('dialog', { name: '新增员工' });
  await expect(resumed.locator('.el-step__title.is-process')).toHaveText('任职信息');
  await resumed.getByLabel('入职日期').fill('2026-09-18');
  await resumed.getByLabel('入职日期').press('Enter');
  await expect(resumed.getByLabel('本次记录生效日期')).toHaveValue('2026-09-18');
  await expect(resumed.getByLabel('预计转正日期')).toHaveValue('2026-12-18');
});

test('提交审核会等待正在进行的自动保存完成', async ({ page }) => {
  const initialDraft = {
    id: 'draft-create-1', userId: null, employeeNo: null, employeeName: '待提交员工',
    sourceType: 'manual_employee_create', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    validationErrors: [], validationWarnings: [], baseValue: {}, recordStatus: 'draft',
    proposedValue: {
      employee: {
        name: '待提交员工', phone: null, company: 'fuede', deptId: department.id,
        entryDate: '2026-09-18', effectiveFrom: '2026-09-18', employmentType: 'full_time',
        employeeStatus: 'probation', probationMonths: 3, plannedRegularDate: '2026-12-18',
      },
      profile: {}, contracts: [], performance: { managerId: null },
      draftMeta: { currentStep: 6, completedSteps: [0, 1, 2, 3, 4, 5] },
    },
    createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z',
  };
  const state = await setupPersonnelPage(page, { initialDraft, draftDelayMs: 900 });
  await page.goto('/users');
  await page.getByText('草稿', { exact: true }).click();
  await page.getByRole('button', { name: '继续编辑' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('姓名').evaluate((input: HTMLInputElement) => {
    input.value = '待提交员工（更新）';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => state.events).toContain('draft-start');
  await drawer.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => state.createBodies.length).toBe(1);

  expect(state.events.indexOf('draft-finished')).toBeLessThan(state.events.indexOf('create'));
  expect(state.createBodies[0]).toMatchObject({ draftId: 'draft-create-1', name: '待提交员工（更新）' });
});

test('390px 手机宽度下向导保持单列且可继续填写', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(drawer.locator('.mobile-step')).toHaveText('1/7 身份核验');
  await expect(drawer.locator('.desktop-steps')).toBeHidden();
  await drawer.getByLabel('姓名').fill('手机端员工');
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.locator('.mobile-step')).toHaveText('2/7 任职信息');
  await expect(drawer.getByLabel('所属公司')).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
