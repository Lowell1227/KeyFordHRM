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
  await page.route('**/api/v1/objectives**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: '11111111-1111-4111-8111-111111111111',
      title: '提升公司重点客户续约率',
      description: null,
      level: 'company',
      deptId: null,
      deptName: null,
      ownerId: null,
      ownerName: null,
      parentId: null,
      cycleId: 'cycle-2027-q1',
      cycleName: '2027 第一季度绩效考核',
      weight: null,
      priority: 0,
      progress: 0,
      status: 'active',
      reviewStatus: 'approved',
      reviewerId: null,
      reviewerName: null,
      reviewedById: null,
      reviewedByName: null,
      reviewedAt: null,
      reviewComment: null,
      canReview: false,
      ownerReportingDepth: null,
      relatedIndicatorId: null,
      relatedIndicatorName: null,
      createdBy: null,
      creatorName: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }])),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{ id: 'dept-1', name: '销售部', isActive: true, children: [] }])),
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

  test('uses the compact mode by default and switches to a complete PC editor without losing data', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const requests: Request[] = [];
    await mockGoalSetting(page, requests);

    await page.goto('/tasks/task-goal-1?stage=goal-setting');

    const workspace = page.getByTestId('goal-setting-workspace');
    await expect(workspace).toBeVisible();
    await expect(page.getByTestId('performance-form-reference')).toHaveCount(0);
    await expect(page.getByTestId('goal-setting-reference-open')).toBeVisible();
    await expect(page.getByTestId('goal-setting-simple-editor')).toBeVisible();
    await expect(page.getByTestId('goal-setting-complete-fields')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '添加目标' })).toBeVisible();
    await expect(page.getByRole('button', { name: '从指标库引入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交上级审核' })).toBeVisible();
    await expect(page.getByTestId('indicator-visibility-indicator-1')).toBeVisible();
    await expect(page.getByTestId('goal-align-open-0')).toBeVisible();

    const headerActions = page.getByTestId('performance-stage-actions');
    await expect(headerActions.getByRole('button', { name: '切换到完整模式' })).toBeVisible();

    const visibilityWrapper = page
      .getByTestId('indicator-visibility-indicator-1')
      .locator('.el-select__wrapper');
    const nameWrapper = page.locator('.goal-name .el-input__wrapper').first();
    await expect(visibilityWrapper).toHaveCSS('background-color', 'rgb(239, 246, 255)');
    await expect(visibilityWrapper).toHaveCSS('border-radius', '999px');
    expect(await visibilityWrapper.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(await nameWrapper.evaluate((element) => getComputedStyle(element).backgroundColor));

    await page.getByTestId('goal-name-input-0').fill('重点客户续约与增购');
    await page.getByRole('button', { name: '切换到完整模式' }).click();
    await expect(page.getByTestId('goal-setting-complete-editor')).toBeVisible();
    await expect(page.getByTestId('goal-setting-complete-fields')).toBeVisible();
    await expect(page.getByTestId('goal-setting-complete-fields').getByText('描述')).toBeVisible();
    await expect(page.getByTestId('goal-setting-complete-fields').getByText('衡量标准')).toBeVisible();
    await expect(page.getByText('目标量', { exact: true })).toBeVisible();
    await expect(page.getByText('完成量', { exact: true })).toBeVisible();
    await expect(page.getByTestId('goal-name-input-0')).toHaveValue('重点客户续约与增购');

    await page.getByTestId('goal-description-input-0').fill('完成重点客户续约并推动增购');
    await page.getByTestId('goal-standard-input-0').fill('续约率达到 90%');
    await page.getByTestId('goal-target-input-0').fill('90');
    await page.getByTestId('goal-unit-input-0').fill('%');

    await page.getByTestId('goal-align-open-0').click();
    await page.getByTestId('goal-align-select-0').click();
    await page.getByRole('option', { name: '提升公司重点客户续约率' }).click();
    await page.keyboard.press('Escape');

    await page.getByTestId('indicator-visibility-indicator-1').click();
    await page.getByRole('option', { name: '全公司可见' }).click();

    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].postDataJSON()).toMatchObject({
      action: 'save',
      instances: [{
        name: '重点客户续约与增购',
        description: '完成重点客户续约并推动增购',
        scoringStandard: '续约率达到 90%',
        targetValueText: '90',
        unit: '%',
        visibilityScope: 'company',
        alignedObjectiveIds: ['11111111-1111-4111-8111-111111111111'],
      }],
    });

    await page.getByRole('button', { name: '提交上级审核' }).click();
    await expect(page.getByTestId('goal-weight-feedback')).toContainText('提交前需调整为 100%');
    expect(requests).toHaveLength(1);

    await page.getByTestId('goal-weight-input-0').locator('input').fill('100');
    await page.getByRole('button', { name: '提交上级审核' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].postDataJSON()).toMatchObject({ action: 'submit' });

    await page.getByTestId('goal-setting-reference-open').click();
    await expect(page.getByTestId('goal-setting-reference-drawer')).toBeVisible();
    await expect(page.getByTestId('performance-reference-panel')).toBeVisible();
  });

  test('turns both modes into mobile cards with no horizontal overflow or covered final row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockGoalSetting(page, []);

    await page.goto('/tasks/task-goal-1?stage=goal-setting');

    await expect(page.getByTestId('goal-setting-simple-editor')).toBeVisible();
    await page.getByRole('button', { name: '切换到完整模式' }).click();
    await expect(page.getByTestId('goal-setting-complete-editor')).toBeVisible();

    const actionBar = page.getByTestId('goal-setting-actions');
    await expect(actionBar).toHaveCSS('position', 'fixed');
    await expect(actionBar.getByRole('button', { name: '提交上级审核' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const lastGoal = page.getByTestId('goal-setting-row').last();
    await lastGoal.scrollIntoViewIfNeeded();
    const actionBox = await actionBar.boundingBox();
    const lastGoalBox = await lastGoal.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(lastGoalBox).not.toBeNull();
    expect(lastGoalBox!.y + lastGoalBox!.height).toBeLessThanOrEqual(actionBox!.y);
  });
});
