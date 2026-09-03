import { expect, test, type Page, type Request } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const periodId = '11111111-1111-4111-8111-111111111111';

function taskDetail() {
  return {
    id: 'task-monthly-1',
    cycleId: 'cycle-2027-h1',
    cycleName: '2027 上半年绩效考核',
    workflowVersion: 2,
    employeeId: 'employee-1',
    employeeName: '方园',
    employeeNo: 'KF001',
    deptId: 'dept-1',
    deptName: '销售部',
    managerId: 'manager-1',
    managerName: '王主管',
    status: 'manager_scoring',
    isExempt: false,
    indicatorInstances: [],
    periods: [{
      id: periodId,
      periodKey: '2027-01',
      periodType: 'month',
      sequence: 1,
      status: 'self_eval',
      selfEvalOpenAt: '2027-02-01T01:00:00.000Z',
      selfEvalDueAt: '2027-02-03T10:00:00.000Z',
      managerDueAt: '2027-02-08T10:00:00.000Z',
      employeeSubmittedAt: null,
      managerSubmittedAt: null,
    }],
    flowRecords: [],
    workflowContext: {
      stage: 'self_eval',
      statusLabel: '待员工自评',
      currentHandler: { id: 'employee-1', name: '方园', nodeType: 'employee' },
      currentDeadline: '2027-02-03T10:00:00.000Z',
      canRemind: false,
      reminderNodeType: 'employee',
      reminderAvailableAt: null,
    },
  };
}

function reviewDetail() {
  const indicator = (id: string, name: string, weight: number) => ({
    indicatorVersionItemId: id,
    sourceInstanceId: null,
    name,
    description: `${name}的目标背景`,
    scoringStandard: '达到目标得 90 分，超额完成得 100 分',
    targetValue: 100,
    targetValueText: '100%',
    unit: '%',
    weight,
    isScoreRequired: weight > 0,
    monthlyProgressSource: 'none',
    progress: null,
    healthStatus: null,
    actualValueText: null,
    employeeComment: null,
    problemReason: null,
    nextMonthPlan: null,
    supportNeeded: null,
    attachments: [],
    selfScore: null,
    managerScore: null,
    managerComment: null,
    latestProgress: null,
    alignedObjectives: [{ id: `objective-${id}`, title: '提升年度客户续约率', level: 'company' }],
    history: [{
      periodKey: '2026-12',
      progress: 82,
      healthStatus: 'on_track',
      actualValueText: '已完成 82%',
      selfScore: 86,
      managerScore: 88,
    }],
  });
  return {
    period: {
      id: periodId,
      taskId: 'task-monthly-1',
      periodKey: '2027-01',
      periodType: 'month',
      status: 'self_eval',
      selfEvalOpenAt: '2027-02-01T01:00:00.000Z',
      selfEvalDueAt: '2027-02-03T10:00:00.000Z',
      managerDueAt: '2027-02-08T10:00:00.000Z',
      employeeSubmittedAt: null,
      managerSubmittedAt: null,
      selfScoreTotal: null,
      managerScoreTotal: null,
      draftVersion: 0,
    },
    context: {
      cycleName: '2027 上半年绩效考核',
      employeeName: '方园',
      employeeNo: 'KF001',
      deptName: '销售部',
      managerName: '王主管',
      statusLabel: '员工填写中',
    },
    permissions: { canEditEmployee: true, canEditManager: false },
    indicators: [
      indicator('21111111-1111-4111-8111-111111111111', '重点客户续约', 0.6),
      indicator('31111111-1111-4111-8111-111111111111', '新客户拓展', 0.4),
      indicator('41111111-1111-4111-8111-111111111111', '协同支持', 0),
    ],
  };
}

async function mockMonthlyReview(page: Page, requests: Request[]) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-monthly-review-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'employee-1',
      name: '方园',
      deptId: 'dept-1',
      deptName: '销售部',
      sysRole: 'employee',
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles/cycle-2027-h1', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'cycle-2027-h1',
      name: '2027 上半年绩效考核',
      type: 'semi_annual',
      startDate: '2027-01-01',
      endDate: '2027-06-30',
      status: 'self_eval',
      publishVisibleFields: {},
      gradeAMaxRatio: 0.2,
      gradeBMaxRatio: 0.4,
      gradeCMaxRatio: 0.3,
      gradeDMaxRatio: 0.1,
    })),
  }));
  await page.route('**/api/v1/tasks/task-monthly-1', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(taskDetail())),
  }));
  await page.route(`**/api/v1/assessment-periods/${periodId}/review`, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(reviewDetail())),
  }));
  await page.route(`**/api/v1/assessment-periods/${periodId}/employee-draft`, (route) => {
    requests.push(route.request());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ periodId, status: 'self_eval', draftVersion: 1, savedAt: new Date().toISOString() })),
    });
  });
  await page.route(`**/api/v1/assessment-periods/${periodId}/employee-submit`, (route) => {
    requests.push(route.request());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ periodId, status: 'manager_scoring', draftVersion: 2, savedAt: new Date().toISOString() })),
    });
  });
}

async function completeRequiredFields(page: Page) {
  const cards = page.getByTestId('monthly-review-goal-card');
  const firstCard = cards.nth(0);
  await firstCard.getByLabel('本月完成进度').fill('85');
  await firstCard.getByRole('button', { name: '正常推进' }).click();
  await firstCard.getByLabel('本月自评分').fill('90');
  await cards.nth(1).getByLabel('本月自评分').fill('82');
}

test.describe('monthly goal review responsive workspace', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('uses the shared full-width period workspace at 1440 and sends distinct draft/submit requests', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const requests: Request[] = [];
    await mockMonthlyReview(page, requests);

    await page.goto('/tasks/task-monthly-1?stage=self-eval');

    await expect(page.getByTestId('monthly-review-workspace')).toBeVisible();
    await expect(page.getByTestId('monthly-review-reference')).toHaveCount(0);
    await expect(page.getByTestId('monthly-review-form-workspace')).toBeVisible();
    await expect(page.getByText('2027年1月月度自评', { exact: true })).toBeVisible();
    await expect(page.getByTestId('performance-stage-state')).toHaveText('待处理');
    await expect(page.getByTestId('monthly-review-goal-card')).toHaveCount(3);
    await expect(page.getByTestId('performance-employee-summary')).toContainText('方园');
    await expect(page.getByTestId('performance-employee-summary')).toContainText('绩效直属上级 王主管');

    const periodBar = page.getByTestId('monthly-review-period-bar');
    await expect(periodBar).toContainText('自评分已填写 0/2 · 不参与评分 1项');
    const scoreHelp = periodBar.getByRole('button', { name: '查看评分说明' });
    await expect(scoreHelp).toBeVisible();
    await scoreHelp.hover();
    await expect(page.getByRole('tooltip')).toContainText('共3项；2项参与评分，1项零权重不参与评分。是否评分与正常/受阻状态无关。');
    const firstCard = page.getByTestId('monthly-review-goal-card').first();
    const firstCardBox = await firstCard.boundingBox();
    const actionBox = await page.getByTestId('monthly-review-actions').boundingBox();
    const periodBarBox = await periodBar.boundingBox();
    expect(firstCardBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(periodBarBox).not.toBeNull();
    expect(firstCardBox!.width).toBeGreaterThan(900);
    expect(actionBox!.y).toBeGreaterThanOrEqual(periodBarBox!.y);
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(periodBarBox!.y + periodBarBox!.height + 1);
    await expect(firstCard.getByTestId('period-review-indicator-context')).toContainText('达到目标得 90 分');
    await expect(firstCard.getByTestId('period-review-indicator-context')).toContainText('历史月度结果 1条');

    await expect(page.getByTestId('monthly-review-goal-card').first()).not.toContainText('问题原因');
    await expect(page.getByTestId('monthly-review-goal-card').first()).not.toContainText('下一步计划');
    await expect(page.getByTestId('monthly-review-goal-card').first()).not.toContainText('所需支持');
    await expect(page.getByTestId('monthly-review-goal-card').first()).not.toContainText('补充说明');
    await expect(page.getByTestId('monthly-review-goal-card').nth(2)).toContainText('不参与评分');
    await expect(page.getByTestId('monthly-review-goal-card').first()).toContainText('本月未更新，可只填写自评分后提交');

    await page.getByRole('button', { name: '提交月度自评' }).click();
    await expect(page.getByTestId('monthly-review-goal-card').nth(0).getByText('请填写 0-100 分的本月自评分')).toBeVisible();

    await completeRequiredFields(page);
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect.poll(() => requests.filter((request) => request.method() === 'PUT').length).toBe(1);
    const draftBody = requests.find((request) => request.method() === 'PUT')?.postDataJSON();
    expect(draftBody).toMatchObject({ expectedVersion: 0 });
    expect(draftBody.indicators).toHaveLength(3);
    expect(draftBody.indicators[0]).toMatchObject({ progress: 85, healthStatus: 'on_track', selfScore: 90 });
    expect(draftBody.indicators[1]).toMatchObject({ progress: null, healthStatus: null, selfScore: 82 });
    expect(draftBody.indicators[2]).toMatchObject({ progress: null, healthStatus: null, selfScore: null });

    await page.getByRole('button', { name: '提交月度自评' }).click();
    await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
    const submitBody = requests.find((request) => request.method() === 'POST')?.postDataJSON();
    expect(submitBody).toMatchObject({ expectedVersion: 1 });
    expect(submitBody.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(submitBody.indicators).toHaveLength(3);
  });

  test('keeps the same full-width card structure at 390 with an unobstructed fixed action bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMonthlyReview(page, []);

    await page.goto('/tasks/task-monthly-1?stage=self-eval');

    await expect(page.getByTestId('monthly-review-reference')).toHaveCount(0);
    await expect(page.getByTestId('period-review-indicator-context')).toHaveCount(3);

    const actionBar = page.getByTestId('monthly-review-actions');
    await expect(actionBar).toHaveCSS('position', 'fixed');
    await expect(page.getByRole('button', { name: '提交月度自评' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const lastCard = page.getByTestId('monthly-review-goal-card').last();
    const lastCardBox = await lastCard.boundingBox();
    await lastCard.scrollIntoViewIfNeeded();
    const actionBox = await actionBar.boundingBox();
    const scrolledLastCardBox = await lastCard.boundingBox();
    expect(lastCardBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(scrolledLastCardBox!.y + scrolledLastCardBox!.height).toBeLessThanOrEqual(actionBox!.y);
  });
});
