import { expect, test, type Page } from '@playwright/test';
async function setup(
  page: Page,
  actor = 'hr-specialist',
  status = 'indicator_approving',
  options: { staleConfirmation?: boolean; selfManager?: boolean } = {},
) {
  const reads: string[] = [];
  let state = status;
  const plan = () => ({
    id: 'goal-1',
    cycleId: 'cycle-1',
    cycleName: '合成季度目标计划',
    employeeId: 'employee',
    employeeName: '合成员工',
    deptName: '合成业务部门',
    managerId: options.selfManager ? 'employee' : 'manager',
    managerName: '绩效上级',
    deptHeadId: 'dept',
    deptHeadName: '部门负责人',
    approverId: 'leader',
    approverName: '分管领导',
    status: state,
    isExempt: false,
    goalWorkflowVersion: 2,
    updatedAt: '2026-10-29T00:00:00Z',
    currentStep:
      state === 'indicator_dept_reviewing'
        ? 'department_review'
        : state === 'indicator_confirming'
          ? 'employee_confirmation'
          : state === 'goal_confirmed'
            ? 'effective'
            : 'leader_review',
    currentHandlerId: 'leader',
    currentHandlerName: '分管领导',
    permissions: {
      canEdit: false,
      canApprove: actor === 'leader',
      canConfirm: actor === 'employee',
      canReject: actor === 'leader',
    },
    indicatorInstances: [
      {
        id: 'indicator-1',
        taskId: 'goal-1',
        name: '合成长目标用于手机换行和内容核对：本期完成交付并保留验收记录',
        description: '按已确认目标完成交付',
        weight: 1,
        indicatorType: 'kpi',
        dimensionWeight: 1,
        sortOrder: 1,
        visibilityScope: 'department',
        visibilityScopes: ['department'],
        visibleDepartmentIds: [],
        visibleUserIds: [],
        alignedObjectives: [],
        alignedParentIndicators: [],
      },
    ],
    flowRecords: [
      {
        id: 'record-1',
        nodeType: 'indicator_dept_review',
        action: 'approve',
        actorId: 'dept',
        actorName: '部门负责人',
        comment: '目标范围已核实',
        createdAt: '2026-10-29T00:00:00Z',
        extraData: null,
      },
    ],
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-goal');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname;
    reads.push(p);
    let data: unknown = [];
    if (p.endsWith('/auth/me'))
      data = {
        id: actor,
        name: '合成测试人',
        sysRole:
          actor === 'hr-specialist' || actor === 'ordinary-hr'
            ? 'hr_user'
            : 'employee',
        hrCapabilities:
          actor === 'hr-specialist'
            ? ['cycle_plan_edit', 'performance_publish']
            : [],
        businessCapabilities: { canManageTeam: false },
      };
    else if (p.endsWith('/notifications/unread-count')) data = 0;
    else if (p.endsWith('/goal-plans/options'))
      data = {
        cycles: [{ id: 'cycle-1', name: '合成季度目标计划' }],
        departments: [],
      };
    else if (p.endsWith('/goal-plans/goal-1') || p.endsWith('/tasks/goal-1'))
      data = plan();
    else if (p.endsWith('/goal-plans'))
      data = { items: [plan()], total: 1, page: 1, pageSize: 20 };
    else if (p.endsWith('/cycles/cycle-1'))
      data = {
        id: 'cycle-1',
        name: '合成季度目标计划',
        goalWorkflowVersion: 2,
        status: 'indicator_setting',
        publishVisibleFields: {},
      };
    else if (p.endsWith('/indicators/confirm')) {
      if (options.staleConfirmation) {
        state = 'indicator_dept_reviewing';
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 409,
            message: '任务已被其他操作更新，请刷新后重试',
          }),
        });
        return;
      }
      state = 'indicator_approving';
      data = { id: 'goal-1', status: state };
    } else if (p.endsWith('/indicators/approve')) {
      state = 'goal_confirmed';
      data = { id: 'goal-1', status: state };
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'success', data }),
    });
  });
  return reads;
}
for (const width of [1440, 1024, 390])
  test(`HR goal projection only ${width}`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: width === 390 ? 844 : width === 1024 ? 768 : 900,
    });
    const reads = await setup(page);
    await page.goto('/tasks?goalView=monitor');
    await expect(page.getByTestId('goal-plan-list')).toBeVisible();
    await page.screenshot({
      path: `../tmp/goal-five-step/list-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: '查看计划', exact: true })
      .first()
      .click();
    await expect(page.getByTestId('goal-monitor-detail')).toBeVisible();
    await expect(page.getByTestId('goal-current-handler')).toContainText(
      '分管领导',
    );
    await expect(
      page.getByRole('button', { name: '审核通过', exact: true }),
    ).toHaveCount(0);
    expect(reads.filter((p) => /^\/api\/v1\/tasks\/goal-1/.test(p))).toEqual(
      [],
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      page.getByText('部门负责人审核通过', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../tmp/goal-five-step/monitor-${width}.png`,
      fullPage: true,
    });
  });
test('leader without direct reports sees assigned review queue', async ({
  page,
}) => {
  await setup(page, 'leader');
  await page.goto('/tasks?goalView=review');
  await expect(page.getByTestId('goal-plan-list')).toBeVisible();
  await page.getByRole('button', { name: '办理目标', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '目标审核通过', exact: true }),
  ).toBeVisible();
});
test('employee confirmation waits for leader', async ({ page }) => {
  await setup(page, 'employee', 'indicator_confirming');
  await page.goto('/tasks/goal-1?stage=goal-confirmation');
  await page.getByRole('button', { name: '确认指标', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('仍需分管领导审核');
  const confirmation = page.waitForRequest((r) =>
    r.url().endsWith('/indicators/confirm'),
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认指标', exact: true })
    .click();
  expect((await confirmation).postDataJSON()).toEqual({
    expectedUpdatedAt: '2026-10-29T00:00:00Z',
  });
  await expect(page.getByTestId('goal-stage-status')).toContainText(
    '待分管领导审核',
  );
});

for (const width of [1440, 390]) {
  test(`department reviewer has no editing rights ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, 'dept', 'indicator_dept_reviewing');
    await page.goto('/tasks/goal-1?stage=goal-setting');
    await expect(
      page.getByRole('button', { name: '目标审核通过', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '退回绩效上级修改', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('goal-setting-simple-editor')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });
  test(`noncurrent leader cannot act on department review ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, 'leader', 'indicator_dept_reviewing');
    await page.goto('/tasks/goal-1?stage=goal-setting');
    await expect(page.getByTestId('goal-stage-status')).toContainText(
      '待部门负责人审核',
    );
    await expect(
      page.getByRole('button', { name: '目标审核通过', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '退回绩效上级修改', exact: true }),
    ).toHaveCount(0);
  });
}
test('ordinary HR monitor cannot call projection or full task list', async ({
  page,
}) => {
  const reads = await setup(page, 'ordinary-hr');
  await page.goto('/tasks?goalView=monitor');
  await expect(
    page.getByText('无权查看全员目标计划', { exact: true }),
  ).toBeVisible();
  expect(
    reads.some(
      (p) =>
        p.endsWith('/goal-plans') ||
        p.endsWith('/goal-plans/options') ||
        p.endsWith('/tasks'),
    ),
  ).toBeFalsy();
});
test('leader approval uses dedicated goal action with version', async ({
  page,
}) => {
  await setup(page, 'leader');
  await page.goto('/tasks/goal-1?stage=goal-confirmation');
  await page.getByRole('button', { name: '目标审核通过', exact: true }).click();
  const request = page.waitForRequest((r) =>
    r.url().endsWith('/tasks/goal-1/indicators/approve'),
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '目标审核通过', exact: true })
    .click();
  expect((await request).postDataJSON()).toEqual({
    expectedUpdatedAt: '2026-10-29T00:00:00Z',
  });
});

test('department rejection requires reason and sends current task version', async ({
  page,
}) => {
  await setup(page, 'dept', 'indicator_dept_reviewing');
  await page.goto('/tasks/goal-1?stage=goal-setting');
  await page
    .getByRole('button', { name: '退回绩效上级修改', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: '确认退回', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('textbox')
    .fill('请由绩效上级调整目标口径');
  const request = page.waitForRequest((r) =>
    r.url().endsWith('/indicators/reject'),
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认退回', exact: true })
    .click();
  expect((await request).postDataJSON()).toEqual({
    comment: '请由绩效上级调整目标口径',
    expectedUpdatedAt: '2026-10-29T00:00:00Z',
  });
});

test('monitor filter survives routed detail and browser back', async ({
  page,
}) => {
  await setup(page);
  await page.goto(
    '/tasks?goalView=monitor&cycleId=cycle-1&employeeName=合成员工',
  );
  await expect(page.getByRole('textbox', { name: '员工姓名' })).toHaveValue(
    '合成员工',
  );
  await page
    .getByRole('button', { name: '查看计划', exact: true })
    .first()
    .click();
  await expect(page.getByTestId('goal-monitor-detail')).toBeVisible();
  await expect(page).toHaveURL(/tasks\/goal-1/);
  await page.goBack();
  await expect(page.getByRole('textbox', { name: '员工姓名' })).toHaveValue(
    '合成员工',
  );
  await expect(page).toHaveURL(/cycleId=cycle-1/);
});
test('goal list request failure is visible and retryable', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/goal-plans?**', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 500, message: '合成读取失败' }),
    }),
  );
  await page.goto('/tasks?goalView=monitor');
  await expect(
    page.getByText('目标计划加载失败，请重试', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`employee v2 draft uses existing goal editor ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, 'employee', 'indicator_drafting');
    await page.goto('/tasks/goal-1?stage=goal-setting');
    await expect(page.getByTestId('goal-setting-simple-editor')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '提交上级审核', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '目标审核通过', exact: true }),
    ).toHaveCount(0);
  });
  test(`manager v2 review keeps existing adjustment surface ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, 'manager', 'indicator_reviewing');
    await page.goto('/tasks/goal-1?stage=goal-setting');
    await expect(page.getByTestId('goal-setting-simple-editor')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '审核通过', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '退回员工修改', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '目标审核通过', exact: true }),
    ).toHaveCount(0);
  });
}

test('stale employee confirmation surfaces one conflict and refreshes current round', async ({
  page,
}) => {
  const reads = await setup(page, 'employee', 'indicator_confirming', {
    staleConfirmation: true,
  });
  await page.goto('/tasks/goal-1?stage=goal-confirmation');
  await page.getByRole('button', { name: '确认指标', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认指标', exact: true })
    .click();
  await expect(
    page.getByText('任务已被其他操作更新，请刷新后重试', { exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(() => reads.filter((p) => p.endsWith('/tasks/goal-1')).length)
    .toBe(2);
  await expect(
    page.getByRole('button', { name: '确认指标', exact: true }),
  ).toHaveCount(0);
});
for (const status of ['indicator_drafting', 'indicator_reviewing'])
  test(`self-manager remains employee at ${status}`, async ({ page }) => {
    await setup(page, 'employee', status, { selfManager: true });
    await page.goto('/tasks/goal-1?stage=goal-setting');
    if (status === 'indicator_drafting')
      await expect(
        page.getByTestId('goal-setting-simple-editor'),
      ).toBeVisible();
    else
      await expect(page.getByTestId('goal-setting-simple-editor')).toHaveCount(
        0,
      );
    await expect(
      page.getByRole('button', { name: '审核通过', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '目标审核通过', exact: true }),
    ).toHaveCount(0);
  });
