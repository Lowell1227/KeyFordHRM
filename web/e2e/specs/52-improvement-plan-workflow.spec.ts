import { expect, test, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

async function mock(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'improvement-workflow-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: envelope({ id: 'manager', name: '上级', sysRole: 'employee',
      status: 'active', canViewAll: false, businessCapabilities: { canManageTeam: true } }) });
    if (path.endsWith('/notifications/unread-count')) return route.fulfill({ json: envelope({ count: 0 }) });
    if (path.endsWith('/improvement-plans/eligible-employees')) return route.fulfill({ json: envelope([
      { id: 'employee', name: '张员工', employeeNo: 'E001', deptName: '业务部' },
    ]) });
    if (path.endsWith('/improvement-plans/cycles')) return route.fulfill({ json: envelope([]) });
    if (path.endsWith('/improvement-plans/my-pending')) return route.fulfill({ json: envelope([
      { id: 'plan-pending', employeeName: '张员工', status: 'goal_revision', currentOwnerId: 'manager',
        allowedActions: ['edit', 'submit_goals'], targetDate: null, cycleName: null },
    ]) });
    if (path.endsWith('/improvement-plans') && route.request().method() === 'GET') {
      return route.fulfill({ json: envelope({ items: [{
        id: 'plan-drawer', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
        cycleId: null, cycleName: null, creatorId: 'manager', creatorName: '上级', targetDate: null,
        status: 'goal_revision', workflowVersion: 2, finalScore: null,
      }], total: 1, page: 1, pageSize: 10 }) });
    }
    if (path.endsWith('/improvement-plans') && route.request().method() === 'POST') {
      return route.fulfill({ json: envelope({ id: 'new-plan' }) });
    }
    if (path.endsWith('/cycles/mine')) return route.fulfill({ json: envelope([]) });
    if (path.endsWith('/cycles')) return route.fulfill({ json: envelope({ items: [], total: 0, page: 1, pageSize: 100 }) });
    if (path.endsWith('/departments')) return route.fulfill({ json: envelope([]) });
    if (path.endsWith('/tasks/mine')) return route.fulfill({ json: envelope({ items: [], total: 0 }) });
    return route.fulfill({ json: envelope({}) });
  });
}

test('manager can create an unlinked plan with background and weighted goals', async ({ page }) => {
  await mock(page);
  await page.goto('/improvement-plans');
  await page.getByRole('button', { name: '新建改进计划' }).click();
  const dialog = page.getByRole('dialog', { name: '创建改进计划' });
  await expect(dialog.getByText('基本信息', { exact: true })).toBeVisible();
  const cycleField = await dialog.getByRole('combobox', { name: '关联绩效周期计划' }).boundingBox();
  const targetDateField = await dialog.getByPlaceholder('选择日期').boundingBox();
  expect(Math.abs(cycleField!.y - targetDateField!.y)).toBeLessThanOrEqual(4);
  await dialog.getByRole('button', { name: '保存草稿' }).click();
  await expect(dialog.getByText('请选择员工', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: '员工' }).click();
  await page.getByRole('option', { name: /张员工/ }).click();
  await expect(dialog.getByText('请选择员工', { exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: '改进背景' }).fill('需要提升交付质量');
  await dialog.getByRole('textbox', { name: '目标名称 1' }).fill('减少返工');
  await dialog.getByRole('textbox', { name: '目标描述 1' }).fill('按时完成交付');
  await dialog.getByRole('spinbutton', { name: '目标权重 1' }).fill('100');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/improvement-plans') && request.method() === 'POST');
  await dialog.getByRole('button', { name: '保存草稿' }).click();
  const body = (await requestPromise).postDataJSON();
  expect(body).toMatchObject({ employeeId: 'employee', improvementNeed: '需要提升交付质量',
    goals: [{ name: '减少返工', description: '按时完成交付', weight: 100 }] });
  expect(body.cycleId ?? null).toBeNull();
});

test('invalid creation weights stay beside the fields and do not reach the API', async ({ page }) => {
  await mock(page);
  let createRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/improvement-plans') && request.method() === 'POST') createRequests += 1;
  });
  await page.goto('/improvement-plans');
  await page.getByRole('button', { name: '新建改进计划' }).click();
  const dialog = page.getByRole('dialog', { name: '创建改进计划' });
  await dialog.getByRole('combobox', { name: '员工' }).click();
  await page.getByRole('option', { name: /张员工/ }).click();
  await dialog.getByRole('textbox', { name: '改进背景' }).fill('需要提升交付质量');
  await dialog.getByRole('textbox', { name: '目标名称 1' }).fill('减少返工');
  await dialog.getByRole('textbox', { name: '目标描述 1' }).fill('按时完成交付');
  await dialog.getByRole('spinbutton', { name: '目标权重 1' }).fill('120');
  await dialog.getByRole('button', { name: '保存草稿' }).click();

  const goalCard = dialog.locator('.goal-card').first();
  await expect(goalCard.getByText('权重须大于 0 且不超过 100%')).toBeVisible();
  await expect(dialog.getByText('当前合计 120%，权重合计必须为 100%')).toHaveCount(0);
  expect(createRequests).toBe(0);
  await dialog.screenshot({ path: test.info().outputPath('creation-weight-field-error-desktop.png') });

  await dialog.getByRole('spinbutton', { name: '目标权重 1' }).fill('80');
  await dialog.getByRole('button', { name: '保存草稿' }).click();
  await expect(goalCard.getByText('权重须大于 0 且不超过 100%')).toHaveCount(0);
  await expect(dialog.getByText('当前合计 80%，权重合计必须为 100%')).toBeVisible();
  expect(createRequests).toBe(0);
  await dialog.screenshot({ path: test.info().outputPath('creation-weight-validation-desktop.png') });
});

test('workbench shows the current improvement-plan action independently of cycle tasks', async ({ page }) => {
  await mock(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: /张员工.*修改目标/ })).toBeVisible();
});

test('mobile creation keeps employee, background and goal fields usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/improvement-plans');
  await page.getByRole('button', { name: '新建改进计划' }).click();
  const dialog = page.getByRole('dialog', { name: '创建改进计划' });
  await expect(dialog.getByRole('combobox', { name: '员工' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '改进背景' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '目标描述 1' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('improvement-plan detail opens in a routed drawer and browser back keeps the list', async ({ page }) => {
  await mock(page);
  await page.route('**/api/v1/improvement-plans/plan-drawer', (route) => route.fulfill({ json: envelope({
    id: 'plan-drawer', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [{ id: 'g1', name: '交付质量', description: '减少返工', weight: 100 }],
    selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
    status: 'goal_revision', workflowVersion: 2, startedAt: null, completedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    currentOwnerId: 'manager', allowedActions: ['edit', 'submit_goals'], records: [],
  }) }));

  await page.goto('/improvement-plans');
  await page.getByRole('button', { name: '查看' }).first().click();
  await expect(page).toHaveURL(/\/improvement-plans\/plan-drawer$/);
  await expect(page.getByTestId('business-detail-drawer')).toHaveAttribute('data-drawer-variant', 'workflow');
  await expect(page.getByTestId('business-list-page')).toBeAttached();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.getByTestId('business-detail-drawer').evaluate((element) => (
    Math.round(element.getBoundingClientRect().width)
  ))).toBe(390);

  await page.goBack();
  await expect(page.getByTestId('business-detail-drawer')).toBeHidden();
  await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'workflow');
});

test('employee can return a specific goal suggestion without editing the approved goal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  const original = { id: 'g1', name: '交付质量', description: '减少返工', weight: 100 };
  const plan = { id: 'plan-employee', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [original], selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
    status: 'goal_employee_confirm', workflowVersion: 2, startedAt: null, completedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    currentOwnerId: 'employee', allowedActions: ['decide_goals'], records: [] };
  let decisionCommitted = false;
  await page.route('**/api/v1/improvement-plans/plan-employee**', (route) => {
    if (route.request().method() === 'POST') {
      decisionCommitted = true;
      return route.abort('timedout');
    }
    return route.fulfill({ json: envelope(decisionCommitted
      ? { ...plan, status: 'goal_revision', allowedActions: [] }
      : plan) });
  });
  await page.goto('/improvement-plans/plan-employee');
  const overview = page.getByTestId('business-detail-drawer').locator('.chart-card').first();
  await expect(overview.getByRole('button', { name: '退回发起人修改' })).toBeVisible();
  await expect(overview.getByRole('button', { name: '确认目标' })).toBeVisible();
  await expect(page.getByText('目标确认', { exact: true })).toHaveCount(0);
  await expect(page.getByText('可在上方逐项目标填写建议', { exact: false })).toHaveCount(0);
  await overview.getByRole('button', { name: '退回发起人修改' }).click();
  let dialog = page.getByRole('dialog', { name: '退回发起人修改' });
  const suggestion = dialog.getByRole('textbox', { name: '目标 1 修改建议' });
  await expect(suggestion).toBeVisible();
  await expect(page.getByText('减少返工')).toBeVisible();
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(page.getByText('请填写具体目标建议或整体意见')).toBeVisible();
  await suggestion.fill('建议写明每周返工次数上限');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/decide-goals'));
  await dialog.getByRole('button', { name: '确认退回' }).click();
  expect((await requestPromise).postDataJSON()).toMatchObject({ approve: false, comment: '', suggestions: [
    { goalId: original.id, comment: '建议写明每周返工次数上限' },
  ] });
  await expect(page.getByText('目标已退回发起人修改', { exact: true })).toBeVisible();
  await expect(page.getByText('网络错误，请稍后重试', { exact: true })).toHaveCount(0);
  expect(plan.goals[0]).toEqual(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('initiator sees the employee suggestion beside the goal and in the operation record', async ({ page }) => {
  await mock(page);
  await page.route('**/api/v1/improvement-plans/plan-revision', (route) => route.fulfill({ json: envelope({
    id: 'plan-revision', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [{ id: 'g1', name: '交付质量', description: '减少返工', weight: 100 }],
    selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
    status: 'goal_revision', workflowVersion: 2, startedAt: null, completedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    currentOwnerId: 'manager', allowedActions: ['edit', 'submit_goals'], records: [{
      id: 'record', action: 'reject_goals', actorName: '张员工', createdAt: new Date().toISOString(),
      oldValue: null, newValue: { comment: '', suggestions: [{
        goalId: 'g1', goalName: '交付质量', comment: '建议写明每周返工次数上限',
      }] },
    }],
  }) }));
  await page.goto('/improvement-plans/plan-revision');
  const content = page.getByTestId('improvement-content-evaluation');
  await expect(content.getByText('改进内容与评价', { exact: true })).toBeVisible();
  await expect(content.getByText('当前环节 · 目标修改', { exact: true })).toBeVisible();
  await expect(page.getByText('员工修改建议')).toBeVisible();
  await expect(page.getByText('建议写明每周返工次数上限')).toHaveCount(2);
  await expect(page.getByText('交付质量的修改建议')).toBeVisible();
});

test('operation records follow the time-first approval timeline visual hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  await page.route('**/api/v1/improvement-plans/plan-history', (route) => route.fulfill({ json: envelope({
    id: 'plan-history', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [{ id: 'g1', name: '交付质量', description: '减少返工', weight: 100 }],
    selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
    status: 'goal_revision', workflowVersion: 2, startedAt: null, completedAt: null,
    createdAt: '2026-09-15T02:00:00.000Z', updatedAt: '2026-09-15T03:00:00.000Z',
    currentOwnerId: 'manager', allowedActions: ['edit', 'submit_goals'], records: [
      { id: 'reject', action: 'reject_goals', actorName: '张员工', createdAt: '2026-09-15T03:00:00.000Z',
        oldValue: null, newValue: { comment: '请补充每周返工次数上限', suggestions: [] } },
      { id: 'submit', action: 'submit_goals', actorName: '上级', createdAt: '2026-09-15T02:30:00.000Z',
        oldValue: null, newValue: { goals: [{ id: 'g1', name: '交付质量', description: '减少返工', weight: 100 }] } },
      { id: 'draft', action: 'save_draft', actorName: '上级', createdAt: '2026-09-15T02:00:00.000Z',
        oldValue: null, newValue: {} },
    ],
  }) }));

  await page.goto('/improvement-plans/plan-history');
  const timeline = page.getByTestId('improvement-operation-timeline');
  const records = timeline.getByTestId('improvement-operation-record');
  await expect(records).toHaveCount(3);
  await expect(records.nth(0)).toHaveClass(/is-danger/);
  await expect(records.nth(1)).toHaveClass(/is-success/);
  await expect(records.nth(2)).toHaveClass(/is-neutral/);
  await expect(records.nth(0).locator('.improvement-operation__title')).toHaveText('目标确认');
  await expect(records.nth(0).locator('.improvement-operation__actor')).toContainText('张员工退回目标');
  await expect(records.nth(0).locator('.improvement-operation__note')).toHaveText('请补充每周返工次数上限');

  const positions = await records.nth(0).evaluate((record) => ({
    time: record.querySelector('time')!.getBoundingClientRect().top,
    title: record.querySelector('.improvement-operation__title')!.getBoundingClientRect().top,
  }));
  expect(positions.time).toBeLessThan(positions.title);
  await timeline.screenshot({ path: test.info().outputPath('operation-timeline-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await timeline.screenshot({ path: test.info().outputPath('operation-timeline-mobile.png') });
});

test('evaluation stage keeps each goal and its reviews in one compact card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  const goals = [
    { id: 'g1', name: '稳定交付质量', description: '每周返工不超过两次', weight: 40 },
    { id: 'g2', name: '提升响应效率', description: '需求当天完成反馈', weight: 60 },
  ];
  await page.route('**/api/v1/improvement-plans/plan-evaluation-layout', (route) => route.fulfill({ json: envelope({
    id: 'plan-evaluation-layout', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要同步提升交付质量与响应速度', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals,
    selfEvaluation: { weightedScore: 82, overallComment: '员工总体自评', items: [
      { goalId: 'g1', score: 80, comment: '返工次数已有下降' },
      { goalId: 'g2', score: 84, comment: '响应速度有所提升' },
    ] },
    managerEvaluation: { weightedScore: 79.2, overallComment: '直属上级总体评价', items: [
      { goalId: 'g1', score: 78, comment: '仍需稳定交付节奏' },
      { goalId: 'g2', score: 80, comment: '反馈较为及时' },
    ] },
    departmentEvaluation: null, finalScore: null,
    status: 'dept_review', workflowVersion: 2, startedAt: '2026-09-15T04:31:00.000Z', completedAt: null,
    createdAt: '2026-09-15T02:00:00.000Z', updatedAt: '2026-09-15T04:31:00.000Z',
    currentOwnerId: 'manager', allowedActions: ['evaluate'], records: [],
  }) }));

  await page.goto('/improvement-plans/plan-evaluation-layout');
  const content = page.getByTestId('improvement-content-evaluation');
  const goalCards = content.getByTestId('improvement-goal-evaluation');
  await expect(page.getByText('改进内容与评价', { exact: true })).toBeVisible();
  await expect(page.getByText('逐项目标评价', { exact: true })).toHaveCount(0);
  await expect(goalCards).toHaveCount(2);
  await expect(page.getByText('1. 稳定交付质量', { exact: true })).toHaveCount(1);
  await expect(page.getByText('每周返工不超过两次', { exact: true })).toHaveCount(1);
  await expect(goalCards.first()).toContainText('员工自评80 分 · 返工次数已有下降');
  await expect(goalCards.first()).toContainText('直属上级评价78 分 · 仍需稳定交付节奏');
  await expect(content.getByText('当前环节 · 部门负责人评价', { exact: true })).toHaveCount(1);
  await expect(goalCards.first().getByText('当前环节 · 部门负责人评价', { exact: true })).toHaveCount(0);
  await expect(content.getByText('员工自评 82 分 · 员工总体自评', { exact: true })).toBeVisible();
  await expect(content.getByText('直属上级评价 79.2 分 · 直属上级总体评价', { exact: true })).toBeVisible();
  await expect(goalCards.first().getByRole('spinbutton', { name: '目标评分 1' })).toBeVisible();
  await expect(content.getByRole('button', { name: '提交部门负责人评价' })).toBeVisible();
  await content.screenshot({ path: test.info().outputPath('unified-evaluation-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await content.screenshot({ path: test.info().outputPath('unified-evaluation-mobile.png') });
});

test('each evaluation role gets an explicit submit action', async ({ page }) => {
  await mock(page);
  const stages = [
    { id: 'self', status: 'self_eval', label: '提交员工自评' },
    { id: 'manager', status: 'manager_review', label: '提交直属上级评价' },
    { id: 'department', status: 'dept_review', label: '提交部门负责人评价' },
  ];
  for (const stage of stages) {
    await page.route(`**/api/v1/improvement-plans/plan-role-${stage.id}`, (route) => route.fulfill({ json: envelope({
      id: `plan-role-${stage.id}`, employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
      cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
      improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
      goals: [{ id: 'g1', name: '交付质量', description: '每周返工不超过两次', weight: 100 }],
      selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
      status: stage.status, workflowVersion: 2, startedAt: '2026-09-15T04:31:00.000Z', completedAt: null,
      createdAt: '2026-09-15T02:00:00.000Z', updatedAt: '2026-09-15T04:31:00.000Z',
      currentOwnerId: 'manager', allowedActions: ['evaluate'], records: [],
    }) }));
    await page.goto(`/improvement-plans/plan-role-${stage.id}`);
    await expect(page.getByTestId('improvement-content-evaluation').getByRole('button', { name: stage.label })).toBeVisible();
  }
});

test('goal confirmation actions stay in the page header and open the decision form in a dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  const plan = {
    id: 'plan-goal-dialog', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [{ id: 'g1', name: '交付质量', description: '每周返工不超过两次', weight: 100 }],
    selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
    status: 'goal_employee_confirm', workflowVersion: 2, startedAt: null, completedAt: null,
    createdAt: '2026-09-15T02:00:00.000Z', updatedAt: '2026-09-15T03:00:00.000Z',
    currentOwnerId: 'employee', allowedActions: ['decide_goals'], records: [],
  };
  await page.route('**/api/v1/improvement-plans/plan-goal-dialog**', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { approve: boolean };
      return route.fulfill({ json: envelope({ ...plan, status: body.approve ? 'self_eval' : 'goal_revision', allowedActions: [] }) });
    }
    return route.fulfill({ json: envelope(plan) });
  });

  await page.goto('/improvement-plans/plan-goal-dialog');
  const overview = page.getByTestId('business-detail-drawer').locator('.chart-card').first();
  const content = page.getByTestId('improvement-content-evaluation');
  const rejectButton = overview.getByRole('button', { name: '退回发起人修改' });
  await expect(rejectButton).toBeVisible();
  const approveButton = overview.getByRole('button', { name: '确认目标' });
  await expect(approveButton).toBeVisible();
  expect((await rejectButton.boundingBox())!.y).toBeLessThan((await content.boundingBox())!.y);
  await expect(page.getByRole('textbox', { name: '目标 1 修改建议' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '整体意见' })).toHaveCount(0);
  await overview.screenshot({ path: test.info().outputPath('top-goal-actions-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const mobileHeaderPositions = await overview.evaluate((card) => {
    const buttons = Array.from(card.querySelectorAll('button'));
    const reject = buttons.find((button) => button.textContent?.includes('退回发起人修改'))!;
    const approve = buttons.find((button) => button.textContent?.includes('确认目标'))!;
    const status = Array.from(card.querySelectorAll('.el-tag')).find((tag) => tag.textContent?.includes('待员工确认目标'))!;
    return { status: status.getBoundingClientRect().top, reject: reject.getBoundingClientRect().top, approve: approve.getBoundingClientRect().top };
  });
  expect(mobileHeaderPositions.status).toBeLessThan(mobileHeaderPositions.reject);
  expect(Math.abs(mobileHeaderPositions.reject - mobileHeaderPositions.approve)).toBeLessThanOrEqual(1);
  await overview.screenshot({ path: test.info().outputPath('top-goal-actions-mobile.png') });

  await rejectButton.click();
  const dialog = page.getByRole('dialog', { name: '退回发起人修改' });
  await expect(dialog.getByRole('textbox', { name: '目标 1 修改建议' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '整体意见' })).toBeVisible();
  await dialog.getByRole('textbox', { name: '目标 1 修改建议' }).fill('请明确每周返工次数上限');
  await dialog.screenshot({ path: test.info().outputPath('goal-decision-dialog-mobile.png') });
  await dialog.getByRole('button', { name: '取消' }).click();

  await approveButton.click();
  const approveDialog = page.getByRole('dialog', { name: '确认目标' });
  await expect(approveDialog.getByRole('textbox')).toHaveCount(0);
  await expect(approveDialog).toContainText('确认后将进入员工自评，无需填写意见');
  await approveDialog.screenshot({ path: test.info().outputPath('goal-approve-dialog-mobile.png') });
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/decide-goals'));
  await approveDialog.getByRole('button', { name: '确认目标' }).click();
  expect((await requestPromise).postDataJSON()).toEqual({ approve: true, comment: '' });
  await expect(approveDialog).toBeHidden();
});

test('final review actions stay in the page header and the return dialog keeps required-opinion validation', async ({ page }) => {
  await mock(page);
  const plan = {
    id: 'plan-final-dialog', employeeId: 'employee', employeeName: '张员工', employeeNo: 'E001', deptName: '业务部',
    cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '上级',
    improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
    goals: [{ id: 'g1', name: '交付质量', description: '每周返工不超过两次', weight: 100 }],
    selfEvaluation: { weightedScore: 80, overallComment: '员工自评', items: [{ goalId: 'g1', score: 80, comment: '已有改善' }] },
    managerEvaluation: { weightedScore: 78, overallComment: '直属上级评价', items: [{ goalId: 'g1', score: 78, comment: '继续保持' }] },
    departmentEvaluation: { weightedScore: 76, overallComment: '部门负责人评价', items: [{ goalId: 'g1', score: 76, comment: '达到预期' }] },
    finalScore: null, status: 'vp_review', workflowVersion: 2, startedAt: '2026-09-15T04:31:00.000Z', completedAt: null,
    createdAt: '2026-09-15T02:00:00.000Z', updatedAt: '2026-09-15T05:00:00.000Z',
    currentOwnerId: 'vp', allowedActions: ['decide_final'], records: [],
  };
  await page.route('**/api/v1/improvement-plans/plan-final-dialog**', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: envelope({ ...plan, status: 'manager_review', allowedActions: [] }) });
    }
    return route.fulfill({ json: envelope(plan) });
  });

  await page.goto('/improvement-plans/plan-final-dialog');
  const overview = page.getByTestId('business-detail-drawer').locator('.chart-card').first();
  await expect(overview.getByRole('button', { name: '退回直属上级重评' })).toBeVisible();
  await expect(overview.getByRole('button', { name: '审核确认' })).toBeVisible();
  await expect(page.locator('.chart-card').filter({ has: page.getByText('分管总审核', { exact: true }) })).toHaveCount(0);

  await overview.getByRole('button', { name: '审核确认' }).click();
  const approveDialog = page.getByRole('dialog', { name: '审核确认' });
  await expect(approveDialog).toContainText('待确认综合分：76');
  await expect(approveDialog.getByRole('textbox')).toHaveCount(0);
  await expect(approveDialog).toContainText('确认后将完成改进计划，无需填写审核意见');
  await approveDialog.screenshot({ path: test.info().outputPath('final-review-dialog-desktop.png') });
  await approveDialog.getByRole('button', { name: '取消' }).click();

  await overview.getByRole('button', { name: '退回直属上级重评' }).click();
  const rejectDialog = page.getByRole('dialog', { name: '退回直属上级重评' });
  await rejectDialog.getByRole('button', { name: '确认退回' }).click();
  await expect(rejectDialog.getByText('驳回时请填写理由')).toBeVisible();
  await rejectDialog.getByRole('textbox', { name: '分管总审核意见' }).fill('请直属上级重新核对评价');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/decide-final'));
  await rejectDialog.getByRole('button', { name: '确认退回' }).click();
  expect((await requestPromise).postDataJSON()).toEqual({ approve: false, comment: '请直属上级重新核对评价' });
  await expect(rejectDialog).toBeHidden();
});
