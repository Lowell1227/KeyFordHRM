import { expect, test, type Page, type Request } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

function goalTaskDetail(weight = 0.8) {
  return {
    id: 'task-goal-1',
    cycleId: 'cycle-2027-q1',
    cycleName: '2027 第一季度绩效考核',
    workflowVersion: 1,
    employeeId: 'employee-1',
    employeeName: '方园',
    employeeNo: 'KF001',
    deptId: 'dept-1',
    deptName: '销售部',
    managerId: 'manager-1',
    managerName: '王主管',
    status: 'indicator_setting',
    isExempt: false,
    updatedAt: '2026-08-29T10:00:00.000Z',
    periods: [],
    indicatorInstances: [{
      id: 'indicator-1',
      taskId: 'task-goal-1',
      name: '重点客户续约',
      description: '完成重点客户续约并提高续约质量',
      scoringStandard: '续约率达到 90%，且无重大客户投诉',
      weight,
      dimensionWeight: 1,
      indicatorType: 'kpi',
      sortOrder: 0,
      visibilityScope: 'supervisors',
      visibleDepartmentIds: [],
      visibleUserIds: [],
      alignedObjectives: [],
    }],
    flowRecords: [],
    workflowContext: {
      stage: 'goal_setting',
      statusLabel: '目标制定中',
      currentHandler: { id: 'employee-1', name: '方园', nodeType: 'employee' },
      currentDeadline: '2027-01-05T10:00:00.000Z',
      canRemind: false,
      reminderNodeType: 'employee',
      reminderAvailableAt: null,
    },
  };
}

async function mockGoalSetting(
  page: Page,
  requests: Request[],
  taskDetail = goalTaskDetail(),
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-goal-setting-token');
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
  await page.route('**/api/v1/cycles/cycle-2027-q1', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'cycle-2027-q1',
      name: '2027 第一季度绩效考核',
      type: 'quarterly',
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      status: 'indicator_setting',
      publishVisibleFields: {},
      gradeAMaxRatio: 0.2,
      gradeBMaxRatio: 0.4,
      gradeCMaxRatio: 0.3,
      gradeDMaxRatio: 0.1,
    })),
  }));
  await page.route('**/api/v1/tasks/reference-indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ page: 1, pageSize: 20, total: 0, items: [] })),
  }));
  await page.route('**/api/v1/tasks/task-goal-1/indicators', (route) => {
    requests.push(route.request());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(taskDetail)),
    });
  });
  await page.route('**/api/v1/tasks/task-goal-1', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(taskDetail)),
  }));
}

test.describe('goal setting responsive workspace', () => {
  test('keeps goal setting visible when an unconfirmed monthly period was opened early', async ({ page }) => {
    const earlyPeriodTask = {
      ...goalTaskDetail(),
      workflowVersion: 2,
      status: 'indicator_drafting',
      periods: [{
        id: 'period-opened-too-early',
        periodKey: '2026-07',
        periodType: 'monthly',
        sequence: 1,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        selfEvalOpenAt: '2026-07-25T00:00:00.000Z',
        selfEvalDueAt: '2026-07-31T00:00:00.000Z',
        managerDueAt: '2026-08-03T00:00:00.000Z',
        status: 'self_eval',
        employeeSubmittedAt: null,
        managerSubmittedAt: null,
      }],
    };
    let monthlyReviewRequests = 0;
    await page.route('**/api/v1/assessment-periods/*/review', (route) => {
      monthlyReviewRequests += 1;
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'CONFLICT', message: '本期目标版本尚未确认' }),
      });
    });
    await mockGoalSetting(page, [], earlyPeriodTask);

    await page.goto('/tasks/task-goal-1?stage=goal-setting');

    await expect(page.getByTestId('performance-stage-title')).toHaveText('目标制定');
    await expect(page.getByTestId('goal-setting-workspace')).toBeVisible();
    await expect(page.getByText('月度复盘加载失败')).toHaveCount(0);
    expect(monthlyReviewRequests).toBe(0);
  });

  test('uses a reference-style PC workspace and separates draft, add-next, and submit actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const requests: Request[] = [];
    await mockGoalSetting(page, requests);

    await page.goto('/tasks/task-goal-1?stage=goal-setting');

    const workspace = page.getByTestId('goal-setting-workspace');
    const reference = page.getByTestId('performance-form-reference');
    await expect(workspace).toBeVisible();
    await expect(reference).toBeVisible();
    await expect(reference.getByTestId('performance-reference-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存并添加下一个' })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交主管审核' })).toBeVisible();

    const workspaceBox = await workspace.boundingBox();
    const referenceBox = await reference.boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(referenceBox).not.toBeNull();
    expect(referenceBox!.x).toBeGreaterThan(workspaceBox!.x + workspaceBox!.width * 0.55);

    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].postDataJSON()).toMatchObject({ action: 'save' });

    await page.getByRole('button', { name: '提交主管审核' }).click();
    await expect(page.getByTestId('goal-weight-feedback')).toContainText('提交前需调整为 100%');
    expect(requests).toHaveLength(1);

    await page.getByTestId('goal-weight-input-0').locator('input').fill('100');
    await page.getByRole('button', { name: '提交主管审核' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].postDataJSON()).toMatchObject({ action: 'submit' });
  });

  test('uses one column at 390 with collapsible references and an unobstructed fixed submit bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockGoalSetting(page, []);

    await page.goto('/tasks/task-goal-1?stage=goal-setting');

    const reference = page.getByTestId('performance-form-reference');
    await expect(reference.getByRole('button', { name: '展开参考信息' })).toBeVisible();
    await expect(reference.getByTestId('performance-reference-panel')).toBeHidden();
    await reference.getByRole('button', { name: '展开参考信息' }).click();
    await expect(reference.getByTestId('performance-reference-panel')).toBeVisible();

    const actionBar = page.getByTestId('goal-setting-actions');
    await expect(actionBar).toHaveCSS('position', 'fixed');
    await expect(actionBar.getByRole('button', { name: '提交主管审核' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const lastGoal = page.getByTestId('goal-setting-card').last();
    await lastGoal.scrollIntoViewIfNeeded();
    const actionBox = await actionBar.boundingBox();
    const lastGoalBox = await lastGoal.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(lastGoalBox).not.toBeNull();
    expect(lastGoalBox!.y + lastGoalBox!.height).toBeLessThanOrEqual(actionBox!.y);
  });
});
