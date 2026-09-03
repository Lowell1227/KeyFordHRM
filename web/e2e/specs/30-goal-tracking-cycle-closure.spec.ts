import { expect, test, type Page, type Request } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const activeCycleId = '11111111-1111-4111-8111-111111111111';
const exemptCycleId = '22222222-2222-4222-8222-222222222222';
const periodId = '33333333-3333-4333-8333-333333333333';

async function authenticate(page: Page, role: 'employee' | 'manager' = 'employee') {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'goal-tracking-closure-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(role === 'employee' ? {
      id: 'employee-1', name: '方园', sysRole: 'employee', deptId: 'dept-1',
      isAssessorOnly: false, canViewAll: false, directManagerId: 'manager-1', directManagerName: '王主管',
    } : {
      id: 'manager-1', name: '王主管', sysRole: 'manager', deptId: 'dept-1',
      isAssessorOnly: false, canViewAll: false,
    })),
  }));
}

function trackingContexts() {
  return [{
    id: activeCycleId, name: '2026年08月绩效考核', type: 'monthly',
    startDate: '2026-08-01', endDate: '2026-08-31', openedAt: '2026-08-30T06:35:00.000Z',
    scoringFrequency: 'monthly',
    task: { id: 'task-active', status: 'self_eval', isExempt: false, exemptReason: null, participantDisposition: 'active' },
    periods: [{
      id: periodId, periodKey: '2026-08', periodType: 'month', sequence: 1, status: 'self_eval',
      selfEvalOpenAt: '2026-08-29T10:00:00.000Z', selfEvalDueAt: '2026-08-31T10:00:00.000Z',
      managerDueAt: '2026-09-03T10:00:00.000Z', employeeSubmittedAt: null, managerSubmittedAt: null,
      selfScoreTotal: null, managerScoreTotal: null,
    }],
  }, {
    id: exemptCycleId, name: '2026年08月绩效考核', type: 'monthly',
    startDate: '2026-08-01', endDate: '2026-08-31', openedAt: '2026-08-20T02:51:00.000Z',
    scoringFrequency: 'cycle',
    task: { id: 'task-exempt', status: 'exempted', isExempt: true, exemptReason: 'HR按部门设置为本周期豁免', participantDisposition: 'cycle_exempt' },
    periods: [],
  }];
}

async function mockTracking(page: Page) {
  await authenticate(page);
  await page.route('**/api/v1/cycles/tracking-contexts?**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(trackingContexts())),
  }));
  await page.route('**/api/v1/objectives/tracking?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      taskId: 'task-active', taskStatus: 'self_eval', canEdit: true, totalWeight: 100,
      summary: {
        periodCount: 1,
        employeeSubmittedCount: 0,
        managerCompletedCount: 0,
        activeBusinessPeriodKey: '2026-08',
        activeUpdatedGoalCount: 1,
        goalCount: 2,
      },
      items: [{
        id: 'indicator-1', title: '完成重点客户续约', description: '完成年度重点客户续约与回款',
        scoringStandard: '续约率达到95%', ownerId: 'employee-1', ownerName: '方园', cycleId: activeCycleId,
        cycleName: '2026年08月绩效考核', priority: 1, status: 'active', progress: 68, weight: 60,
        latestProgress: { id: 'progress-1', progress: 68, healthStatus: 'on_track', content: '已完成7家重点客户续约', updatedAt: '2026-08-29T08:00:00.000Z', businessPeriodKey: '2026-08', source: 'active_progress' },
      }, {
        id: 'indicator-2', title: '提升客户回款及时率', description: '控制逾期回款并完成风险客户跟踪',
        ownerId: 'employee-1', ownerName: '方园', cycleId: activeCycleId, cycleName: '2026年08月绩效考核',
        priority: 2, status: 'active', progress: 45, weight: 40, latestProgress: null,
      }],
    })),
  }));
}

test('same-name cycles remain selectable and the employee can enter the exact review period', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTracking(page);
  await page.goto('/action-items');

  const selector = page.getByTestId('goal-tracking-cycle');
  await expect(selector.locator('option')).toHaveCount(2);
  await expect(selector.locator('option').nth(0)).toContainText('月度自评');
  await expect(selector.locator('option').nth(1)).toContainText('已豁免');
  await expect(page.getByTestId('goal-tracking-summary')).toContainText('8月目标已更新 1/2');
  await expect(page.getByTestId('goal-tracking-surface')).toContainText('完成重点客户续约');
  await expect(page.getByRole('complementary', { name: '评分期次' })).toContainText('待月度自评');

  await Promise.all([
    page.waitForURL(new RegExp(`/tasks/task-active\\?.*stage=self-eval.*periodId=${periodId}`)),
    page.getByTestId('goal-tracking-primary-action').click(),
  ]);
});

test('mobile goal tracking uses cards without horizontal overflow and preserves exempt context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTracking(page);
  await page.goto('/action-items');

  await expect(page.getByTestId('goal-tracking-row-indicator-1')).toBeVisible();
  await expect(page.getByTestId('goal-tracking-primary-action')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByTestId('goal-tracking-cycle').selectOption(exemptCycleId);
  await expect(page.getByTestId('goal-tracking-surface')).toContainText('本周期已豁免');
  await expect(page.getByTestId('goal-tracking-surface')).toContainText('HR按部门设置为本周期豁免');
});

test('distinguishes missing goals from a follow-up period that is not open', async ({ page }) => {
  await authenticate(page);
  const pendingContext = {
    ...trackingContexts()[0],
    task: { ...trackingContexts()[0].task, status: 'indicator_drafting' },
    periods: [{ ...trackingContexts()[0].periods[0], status: 'unopened' }],
  };
  await page.route('**/api/v1/cycles/tracking-contexts?**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([pendingContext])),
  }));
  await page.route('**/api/v1/objectives/tracking?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      taskId: 'task-active', taskStatus: 'indicator_drafting', canEdit: true, totalWeight: 0, items: [],
    })),
  }));

  await page.goto('/action-items');

  await expect(page.getByTestId('goal-tracking-summary')).toContainText('目标待制定');
  await expect(page.getByTestId('goal-tracking-primary-action')).toHaveText('开始制定');
  await expect(page.getByTestId('goal-tracking-surface').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '评分期次' })).toContainText('待目标制定');
});

function managerTask() {
  return {
    id: 'task-manager-1', cycleId: activeCycleId, cycleName: '2026年08月绩效考核', workflowVersion: 2,
    employeeId: 'employee-1', employeeName: '方园', employeeNo: 'KF001', deptId: 'dept-1', deptName: '人事组',
    managerId: 'manager-1', managerName: '王主管', status: 'manager_scoring', isExempt: false, indicatorInstances: [],
    periods: [{
      id: periodId, periodKey: '2026-08', periodType: 'month', sequence: 1, status: 'manager_scoring',
      selfEvalOpenAt: '2026-08-29T10:00:00.000Z', selfEvalDueAt: '2026-08-31T10:00:00.000Z', managerDueAt: '2026-09-03T10:00:00.000Z',
      employeeSubmittedAt: '2026-08-30T08:00:00.000Z', managerSubmittedAt: null,
    }], flowRecords: [],
    workflowContext: { stage: 'manager_score', statusLabel: '待主管评分', currentHandler: { id: 'manager-1', name: '王主管', nodeType: 'manager' }, currentDeadline: '2026-09-03T10:00:00.000Z', canRemind: false, reminderNodeType: 'manager', reminderAvailableAt: null },
  };
}

function managerReviewDetail() {
  const item = (id: string, name: string, selfScore: number) => ({
    indicatorVersionItemId: id, sourceInstanceId: null, name, description: `${name}目标说明`, scoringStandard: '达到目标得90分',
    targetValue: 100, targetValueText: '100%', unit: '%', weight: .5, progress: 80, healthStatus: 'on_track',
    isScoreRequired: true, monthlyProgressSource: 'draft_or_result',
    actualValueText: '已完成主要交付', employeeComment: '按计划推进', problemReason: null, nextMonthPlan: null, supportNeeded: null,
    attachments: [], selfScore, managerScore: null, managerComment: null, latestProgress: null, alignedObjectives: [], history: [],
  });
  return {
    period: { id: periodId, taskId: 'task-manager-1', periodKey: '2026-08', periodType: 'month', status: 'manager_scoring', selfEvalOpenAt: '2026-08-29T10:00:00.000Z', selfEvalDueAt: '2026-08-31T10:00:00.000Z', managerDueAt: '2026-09-03T10:00:00.000Z', employeeSubmittedAt: '2026-08-30T08:00:00.000Z', managerSubmittedAt: null, selfScoreTotal: 86, managerScoreTotal: null, draftVersion: 0 },
    context: { cycleName: '2026年08月绩效考核', employeeName: '方园', employeeNo: 'KF001', deptName: '人事组', managerName: '王主管', statusLabel: '主管评分' },
    permissions: { canEditEmployee: false, canEditManager: true },
    indicators: [item('41111111-1111-4111-8111-111111111111', '重点客户续约', 90), item('51111111-1111-4111-8111-111111111111', '回款及时率', 82)],
  };
}

async function mockManagerReview(page: Page, requests: Request[]) {
  await authenticate(page, 'manager');
  await page.route(`**/api/v1/cycles/${activeCycleId}`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: activeCycleId, name: '2026年08月绩效考核', type: 'monthly', startDate: '2026-08-01', endDate: '2026-08-31', status: 'manager_score', publishVisibleFields: {}, gradeAMaxRatio: .2, gradeBMaxRatio: .4, gradeCMaxRatio: .3, gradeDMaxRatio: .1 })) }));
  await page.route('**/api/v1/tasks/task-manager-1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(managerTask())) }));
  await page.route(`**/api/v1/assessment-periods/${periodId}/review`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(managerReviewDetail())) }));
  await page.route(`**/api/v1/assessment-periods/${periodId}/manager-draft`, (route) => { requests.push(route.request()); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ periodId, status: 'manager_scoring', draftVersion: 1, savedAt: new Date().toISOString() })) }); });
  await page.route(`**/api/v1/assessment-periods/${periodId}/manager-submit`, (route) => { requests.push(route.request()); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ periodId, status: 'completed', draftVersion: 2, savedAt: new Date().toISOString() })) }); });
}

test('frozen manager can save and formally submit per-indicator scores', async ({ page }) => {
  const requests: Request[] = [];
  await mockManagerReview(page, requests);
  await page.goto(`/tasks/task-manager-1?stage=self-eval&periodId=${periodId}`);

  const cards = page.getByTestId('manager-review-goal-card');
  await expect(page.getByTestId('manager-review-form-workspace')).toBeVisible();
  await expect(page.getByTestId('manager-review-reference')).toBeVisible();
  await expect(page.getByText('2026年8月主管月度评分', { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(2);
  const cardBox = await cards.first().boundingBox();
  const referenceBox = await page.getByTestId('manager-review-reference').boundingBox();
  expect(cardBox).not.toBeNull();
  expect(referenceBox).not.toBeNull();
  expect(referenceBox!.x).toBeGreaterThan(cardBox!.x + cardBox!.width - 1);
  await cards.nth(0).getByRole('button', { name: '同意自评' }).click();
  await cards.nth(1).getByLabel('主管评分').fill('55');
  await expect(cards.nth(1)).toContainText('低于60分');
  await expect(cards.nth(1)).toContainText('相差27分');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'PUT').length).toBe(1);
  await page.getByRole('button', { name: '提交主管评分' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  expect(requests.find((request) => request.method() === 'POST')?.postDataJSON()).toMatchObject({ expectedVersion: 1 });
});
