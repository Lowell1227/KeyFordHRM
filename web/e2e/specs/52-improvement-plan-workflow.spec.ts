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
      return route.fulfill({ json: envelope({ items: [], total: 0, page: 1, pageSize: 10 }) });
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
  await dialog.getByRole('combobox', { name: '员工' }).click();
  await page.getByRole('option', { name: /张员工/ }).click();
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
  const goalsSection = page.locator('.chart-card').filter({ has: page.getByText('改进背景与目标', { exact: true }) });
  await expect(goalsSection.getByRole('textbox', { name: '整体意见' })).toBeVisible();
  await expect(goalsSection.getByRole('button', { name: '确认目标' })).toBeVisible();
  await expect(page.getByText('目标确认', { exact: true })).toHaveCount(0);
  await expect(page.getByText('可在上方逐项目标填写建议', { exact: false })).toHaveCount(0);
  const suggestion = page.getByRole('textbox', { name: '目标 1 修改建议' });
  await expect(suggestion).toBeVisible();
  await expect(page.getByText('减少返工')).toBeVisible();
  await page.getByRole('button', { name: '退回发起人修改' }).click();
  await expect(page.getByText('请填写具体目标建议或整体意见')).toBeVisible();
  await suggestion.fill('建议写明每周返工次数上限');
  await page.getByRole('button', { name: '确认目标' }).click();
  await expect(page.getByText('已填写修改建议，请退回发起人修改或清空建议')).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/decide-goals'));
  await page.getByRole('button', { name: '退回发起人修改' }).click();
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
  await expect(page.getByText('员工修改建议')).toBeVisible();
  await expect(page.getByText('建议写明每周返工次数上限')).toHaveCount(2);
  await expect(page.getByText('交付质量的修改建议')).toBeVisible();
});
