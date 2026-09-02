import { expect, test } from '@playwright/test';
import type { AssessmentCycle, TaskDetail, TaskListItem } from '../../src/types/api.types';
import {
  formatPerformanceCycleOption,
  localDateKey,
  orderPerformanceCycles,
  resolvePerformanceCycle,
} from '../../src/utils/performance-cycle';

function cycle(id: string, startDate: string, endDate: string): AssessmentCycle {
  return {
    id,
    name: id,
    type: 'quarterly',
    startDate,
    endDate,
    status: 'self_eval',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  };
}

test('preserves a valid requested historical cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('past', '2026-01-01', '2026-03-31'),
    cycle('current', '2026-07-01', '2026-09-30'),
  ], 'past', '2026-08-16');

  expect(result.selectedCycle?.id).toBe('past');
  expect(result.requestedCycleIsValid).toBe(true);
});

test('defaults to the latest-starting in-progress cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('current-old', '2026-01-01', '2026-12-31'),
    cycle('current-new', '2026-07-01', '2026-09-30'),
    cycle('future', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('current-new');
});

test('falls back to the most recently ended cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('old', '2025-10-01', '2025-12-31'),
    cycle('recent', '2026-04-01', '2026-06-30'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('recent');
});

test('uses the earliest upcoming cycle when no cycle has started', () => {
  const result = resolvePerformanceCycle([
    cycle('later', '2027-01-01', '2027-03-31'),
    cycle('next', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('next');
});

test('handles inclusive boundaries, invalid dates, empty candidates, and local dates', () => {
  expect(resolvePerformanceCycle([
    cycle('boundary', '2026-08-16', '2026-08-16'),
    cycle('invalid', 'invalid', 'invalid'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('boundary');
  expect(resolvePerformanceCycle([], 'missing', '2026-08-16').selectedCycle).toBeNull();
  expect(localDateKey(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
  expect(orderPerformanceCycles([
    cycle('invalid-first', 'invalid', 'invalid'),
  ], '2026-08-16')[0]?.id).toBe('invalid-first');
});

test('distinguishes same-name task cycles by date, scoring mode, and personal participation', () => {
  const active = cycle('active', '2026-08-01', '2026-08-31');
  active.name = '2026年08月绩效考核';
  active.scoringFrequency = 'monthly';
  active.personalTask = { id: 'task-active', employeeId: 'employee-1', status: 'self_eval', isExempt: false };
  const exempt = cycle('exempt', '2026-08-01', '2026-08-31');
  exempt.name = '2026年08月绩效考核';
  exempt.scoringFrequency = 'cycle';
  exempt.personalTask = { id: 'task-exempt', employeeId: 'employee-1', status: 'exempted', isExempt: true };

  expect(formatPerformanceCycleOption(active)).toContain('月度跟进｜正常参与');
  expect(formatPerformanceCycleOption(exempt)).toContain('整周期跟进｜已豁免');
});

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

async function mockTaskCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  taskRequests: URL[],
  personalTasks: TaskListItem[] = [],
  personalDetail?: TaskDetail,
  directReports: Array<Record<string, unknown>> = [],
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-cycle-context-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'manager-1',
      name: 'Cycle Manager',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: 'manager',
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/users/manager-1/subordinates', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(directReports)),
  }));
  await page.route('**/api/v1/indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/templates**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/cycles**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const requestedCycleId = path.endsWith('/cycles/mine')
      ? undefined
      : path.match(/\/cycles\/([^/]+)$/)?.[1];
    const data = path.endsWith('/cycles/mine')
      ? cycleItems
      : requestedCycleId
        ? cycleItems.find((item) => item.id === requestedCycleId)
        : { total: cycleItems.length, page: 1, pageSize: 50, items: cycleItems };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(data)),
    });
  });
  await page.route('**/api/v1/tasks/mine**', (route) => {
    taskRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: personalTasks.length,
        page: 1,
        pageSize: 100,
        items: personalTasks,
      })),
    });
  });
  await page.route('**/api/v1/tasks/team**', (route) => {
    taskRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 0,
        page: 1,
        pageSize: 20,
        items: [],
        counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
        facets: { departments: [], employees: [] },
      })),
    });
  });
  await page.route('**/api/v1/tasks/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tasks/mine') || path.endsWith('/tasks/team')) return route.fallback();
    if (path.endsWith('/tasks/reference-indicators')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
      });
    }
    if (personalDetail && path.endsWith(`/tasks/${personalDetail.id}`)) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(personalDetail)),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'TASK_NOT_FOUND', message: 'Task not found', data: null }),
    });
  });
}

test.describe('cycle-first task contracts', () => {
  test.use({
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/auth-state/manager.json',
  });

  test('canonicalizes the nearest cycle before loading personal and team tasks', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('future', '2026-10-01', '2026-12-31'),
    ], taskRequests);

    await page.goto('/tasks?scope=team&stage=goal-review&employeeId=old&taskId=old&page=3');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect(page).not.toHaveURL(/employeeId=|taskId=|page=/);
    await expect.poll(() => taskRequests.length).toBeGreaterThan(0);
    expect(taskRequests.every((url) => url.searchParams.get('cycleId') === 'current')).toBe(true);
  });

  test('shows only real cycles and reset preserves the historical cycle', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], taskRequests);

    await page.goto('/tasks?scope=team&stage=goal-review&cycleId=past&deptId=dept-1');
    await expect(page.getByTestId('team-cycle-filter')).toHaveAttribute('data-testid', 'team-cycle-filter');
    await page.getByTestId('team-cycle-filter').click();
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '全部考核周期' })).toHaveCount(0);
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '仅看待办任务' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.team-toolbar__reset').click();
    await expect(page).toHaveURL(/cycleId=past/);
    await expect(page).not.toHaveURL(/deptId=/);
  });

  test('does not request task data when no cycle is available', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [], taskRequests);

    await page.goto('/tasks');

    await expect(page.getByText('暂无考核周期').first()).toBeVisible();
    expect(taskRequests).toHaveLength(0);
  });

  test('shows the real direct-report roster when no performance cycle exists', async ({ page }) => {
    const taskRequests: URL[] = [];
    await mockTaskCycleShell(page, [], taskRequests, [], undefined, [
      {
        id: 'employee-1',
        name: '俞丹',
        employeeNo: null,
        avatarUrl: null,
        deptId: 'hr-dept',
        deptName: '人事部',
        position: '人事专员',
        sysRole: 'employee',
        status: 'active',
        directManagerId: 'manager-1',
      },
      {
        id: 'employee-2',
        name: '方园',
        employeeNo: null,
        avatarUrl: null,
        deptId: 'hr-dept',
        deptName: '人事部',
        position: 'HRBP',
        sysRole: 'employee',
        status: 'active',
        directManagerId: 'manager-1',
      },
    ]);

    await page.goto('/tasks?scope=team&stage=goal-review');

    const list = page.getByTestId('team-task-list');
    await expect(list).toContainText('直属下属');
    await expect(list).toContainText('2 人');
    await expect(list).toContainText('俞丹');
    await expect(list).toContainText('方园');
    await expect(list).toContainText('待发起考核');
    expect(taskRequests).toHaveLength(0);
  });

  test('renders every personal stage as one compact detail card', async ({ page }) => {
    const taskRequests: URL[] = [];
    const currentCycle = cycle('current', '2026-07-01', '2026-09-30');
    const personalTask: TaskListItem = {
      id: 'personal-task-1',
      cycleId: currentCycle.id,
      cycleName: currentCycle.name,
      employeeId: 'manager-1',
      employeeName: 'Cycle Manager',
      status: 'self_eval',
      isExempt: false,
      updatedAt: '2026-08-16T00:00:00.000Z',
    };
    await mockTaskCycleShell(page, [currentCycle], taskRequests, [personalTask]);

    await page.goto('/tasks?scope=mine');

    const card = page.getByTestId('personal-task-card');
    await expect(card).toContainText('目标制定');
    await expect(card).toContainText('已完成');
    await expect(page.getByRole('columnheader')).toHaveCount(0);
    await expect(page.locator('.app-pager')).toHaveCount(0);

    await page.getByTestId('task-stage-goal-confirmation').click();
    await expect(card).toContainText('目标确认');
    await expect(card).toContainText('已完成');

    await page.getByTestId('task-stage-self-eval').click();
    await expect(card).toContainText('自评');
    await expect(card).toContainText('待处理');

    await page.getByTestId('task-stage-result').click();
    await expect(card).toContainText('结果确认');
    await expect(card).toContainText('未开始');

    await page.getByTestId('personal-task-detail').click();
    await expect(page).toHaveURL(/\/tasks\/personal-task-1\?.*stage=result/);
  });

  test('reloads the personal performance task after switching assessment cycle', async ({ page }) => {
    const taskRequests: URL[] = [];
    const activeCycle = cycle('cycle-active', '2026-08-01', '2026-08-30');
    activeCycle.name = '2026年08月绩效考核';
    activeCycle.scoringFrequency = 'monthly';
    activeCycle.personalTask = {
      id: 'task-active',
      employeeId: 'manager-1',
      status: 'self_eval',
      isExempt: false,
    };
    const exemptCycle = cycle('cycle-exempt', '2026-08-01', '2026-08-31');
    exemptCycle.name = '2026年08月绩效考核';
    exemptCycle.scoringFrequency = 'monthly';
    exemptCycle.personalTask = {
      id: 'task-exempt',
      employeeId: 'manager-1',
      status: 'exempted',
      isExempt: true,
    };

    await mockTaskCycleShell(page, [activeCycle, exemptCycle], taskRequests);
    await page.route('**/api/v1/tasks/mine**', (route) => {
      const url = new URL(route.request().url());
      taskRequests.push(url);
      const isExempt = url.searchParams.get('cycleId') === exemptCycle.id;
      const task: TaskListItem = isExempt
        ? {
            id: 'task-exempt',
            cycleId: exemptCycle.id,
            cycleName: exemptCycle.name,
            employeeId: 'manager-1',
            employeeName: 'Cycle Manager',
            status: 'exempted',
            isExempt: true,
            exemptReason: 'HR 按部门设置为本周期豁免',
            updatedAt: '2026-08-30T03:00:00.000Z',
          }
        : {
            id: 'task-active',
            cycleId: activeCycle.id,
            cycleName: activeCycle.name,
            employeeId: 'manager-1',
            employeeName: 'Cycle Manager',
            status: 'self_eval',
            isExempt: false,
            updatedAt: '2026-08-30T02:00:00.000Z',
          };
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 100, items: [task] })),
      });
    });

    await page.goto('/tasks?scope=mine&cycleId=cycle-active');
    await expect(page.getByTestId('personal-task-card')).toContainText('已完成');

    await page.getByTestId('task-cycle-filter').click();
    await page.locator('.el-select-dropdown__item').filter({ hasText: '已豁免' }).click();

    await expect(page).toHaveURL(/cycleId=cycle-exempt/);
    await expect.poll(() => taskRequests.at(-1)?.searchParams.get('cycleId')).toBe('cycle-exempt');
    await expect(page.locator('.personal-task-card__state')).toHaveText('已豁免');
    await expect(page.getByTestId('task-stage-goal-setting').locator('.task-stage-item__state')).toHaveText('已豁免');
    await expect(page.getByTestId('task-stage-goal-confirmation').locator('.task-stage-item__state')).toHaveText('已豁免');
    await expect(page.getByTestId('task-stage-self-eval').locator('.task-stage-item__state')).toHaveText('已豁免');
    await expect(page.getByTestId('task-stage-result').locator('.task-stage-item__state')).toHaveText('已豁免');
  });

  test('shows an exempt task as exempted in goal setting list and detail', async ({ page }) => {
    const taskRequests: URL[] = [];
    const currentCycle = cycle('cycle-exempt', '2026-08-01', '2026-08-31');
    const personalTask: TaskListItem = {
      id: 'task-exempt',
      cycleId: currentCycle.id,
      cycleName: '2026年08月绩效考核',
      employeeId: 'employee-exempt',
      employeeName: '方园',
      employeeNo: '319',
      deptId: 'hr-team',
      deptName: '人事组',
      managerId: 'manager-1',
      managerName: '俞丹',
      status: 'exempted',
      isExempt: true,
      exemptReason: 'HR 按部门设置为本周期豁免',
      updatedAt: '2026-08-30T03:00:00.000Z',
    };
    const personalDetail: TaskDetail = {
      ...personalTask,
      snapshotId: '',
      indicatorInstances: [],
      flowRecords: [],
    };
    await mockTaskCycleShell(page, [currentCycle], taskRequests, [personalTask], personalDetail);

    await page.goto('/tasks?scope=mine&stage=goal-setting&cycleId=cycle-exempt');

    await expect(page.locator('.personal-task-card__state')).toHaveText('已豁免');
    await page.getByTestId('personal-task-detail').click();
    await expect(page.getByTestId('performance-stage-state')).toHaveText('已豁免');
    await expect(page.getByText('该任务已豁免')).toBeVisible();
  });

  test('opens the requested personal stage with matching state content and actions', async ({ page }) => {
    const taskRequests: URL[] = [];
    const currentCycle = cycle('current', '2026-07-01', '2026-09-30');
    const personalDetail: TaskDetail = {
      id: 'personal-task-1',
      cycleId: currentCycle.id,
      cycleName: '2026-Q3',
      snapshotId: 'snapshot-1',
      employeeId: 'manager-1',
      employeeName: 'Cycle Manager',
      employeeNo: 'MGR001',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-2',
      managerName: 'Direct Manager',
      status: 'self_eval',
      isExempt: false,
      updatedAt: '2026-08-16T00:00:00.000Z',
      indicatorInstances: [
        {
          id: 'indicator-1',
          taskId: 'personal-task-1',
          name: 'Delivery quality',
          description: 'Complete the agreed delivery objectives.',
          weight: 1,
          dimensionWeight: 1,
          indicatorType: 'kpi',
          sortOrder: 0,
          visibilityScope: 'supervisors',
          visibleDepartmentIds: [],
          visibleUserIds: [],
          alignedObjectives: [],
        },
      ],
      flowRecords: [],
    };
    await mockTaskCycleShell(page, [currentCycle], taskRequests, [], personalDetail);

    await page.goto('/tasks/personal-task-1?stage=goal-setting&returnTo=%2Ftasks%3Fscope%3Dmine');
    const detail = page.getByTestId('personal-performance-detail');
    await expect(detail.getByTestId('performance-stage-title')).toHaveText('目标制定');
    await expect(detail.getByTestId('performance-stage-state')).toHaveText('已完成');
    await expect(detail.getByText('请添加本期的绩效指标，和您的主管进行确认。')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '提交主管审核' })).toHaveCount(0);

    await page.goto('/tasks/personal-task-1?stage=goal-confirmation&returnTo=%2Ftasks%3Fscope%3Dmine');
    await expect(detail.getByTestId('performance-stage-title')).toHaveText('目标确认');
    await expect(detail.getByTestId('performance-stage-state')).toHaveText('已完成');
    await expect(detail.locator('.chart-card__title').getByText('目标确认', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '确认指标' })).toHaveCount(0);

    await page.goto('/tasks/personal-task-1?stage=self-eval&returnTo=%2Ftasks%3Fscope%3Dmine');
    await expect(detail.getByTestId('performance-stage-title')).toHaveText('自评');
    await expect(detail.getByTestId('performance-stage-state')).toHaveText('待处理');
    await expect(detail.getByText('员工自评', { exact: true }).first()).toBeVisible();
    await expect(detail.getByRole('button', { name: '提交自评' })).toBeVisible();
    await expect(detail.getByRole('button', { name: '从钉钉周报拉取' })).toHaveCount(0);

    await page.goto('/tasks/personal-task-1?stage=result&returnTo=%2Ftasks%3Fscope%3Dmine');
    await expect(detail.getByTestId('performance-stage-title')).toHaveText('结果确认');
    await expect(detail.getByTestId('performance-stage-state')).toHaveText('未开始');
    await expect(detail.getByText('当前环节尚未开始')).toBeVisible();
    await expect(detail.getByRole('button', { name: '确认结果' })).toHaveCount(0);
  });

  test('keeps personal indicator editing compact with advanced fields on demand', async ({ page }) => {
    const taskRequests: URL[] = [];
    const currentCycle = cycle('current', '2026-07-01', '2026-09-30');
    const personalDetail: TaskDetail = {
      id: 'personal-task-1',
      cycleId: currentCycle.id,
      cycleName: '2026-Q3',
      snapshotId: 'snapshot-1',
      employeeId: 'manager-1',
      employeeName: 'Cycle Manager',
      employeeNo: 'MGR001',
      deptId: 'dept-1',
      deptName: 'Engineering',
      managerId: 'manager-2',
      managerName: 'Direct Manager',
      status: 'indicator_setting',
      isExempt: false,
      updatedAt: '2026-08-16T00:00:00.000Z',
      indicatorInstances: [
        {
          id: 'indicator-1',
          taskId: 'personal-task-1',
          name: 'Delivery quality',
          description: 'Complete the agreed delivery objectives.',
          scoringStandard: 'Accepted on schedule',
          dataSource: 'Release report',
          dataCaliber: 'Production release',
          targetValueText: 'One accepted release',
          weight: 1,
          indicatorType: 'kpi',
          sortOrder: 0,
          visibilityScope: 'supervisors',
          visibleDepartmentIds: [],
          visibleUserIds: [],
          alignedObjectives: [],
        },
      ],
      flowRecords: [],
    };
    await mockTaskCycleShell(page, [currentCycle], taskRequests, [], personalDetail);

    await page.goto('/tasks/personal-task-1?returnTo=%2Ftasks%3Fscope%3Dmine');

    const detail = page.getByTestId('personal-performance-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('performance-stage-title')).toHaveText('目标制定');
    await expect(detail.getByTestId('performance-cycle-badge')).toHaveText('2026-Q3');
    await expect(detail.getByTestId('performance-employee-summary')).toContainText('Cycle Manager');
    await expect(detail.getByText('考核指标', { exact: true })).toBeVisible();
    await expect(detail.locator('.indicator-grid--header')).toContainText('指标描述');
    await expect(detail.getByTestId('indicator-row-indicator-1')).toContainText('Complete the agreed delivery objectives.');
    await expect(detail.getByText('参考信息', { exact: true })).toHaveCount(0);
    await expect(detail.getByTestId('performance-reference-panel')).toHaveCount(0);
    await expect(detail.getByText('任务详情', { exact: true })).toHaveCount(0);
    await expect(detail.getByText('人员信息', { exact: true })).toHaveCount(0);
    await expect(detail.locator('.el-steps')).toHaveCount(0);

    await detail.getByTestId('indicator-name-indicator-1').click();
    const compactEditor = detail.getByTestId('indicator-compact-editor-indicator-1');
    await expect(compactEditor).toBeVisible();
    await expect(compactEditor.getByText('指标名称', { exact: true })).toBeVisible();
    await expect(compactEditor.getByText('指标描述', { exact: true })).toBeVisible();
    await expect(compactEditor.getByText('评分标准', { exact: true })).toBeVisible();
    await expect(compactEditor.locator('textarea').nth(1)).toHaveValue('Accepted on schedule');
    await expect(compactEditor.getByText('权重', { exact: true })).toBeVisible();
    await expect(detail.getByTestId('indicator-advanced-settings-indicator-1')).toHaveCount(0);

    await detail.getByTestId('indicator-more-settings-indicator-1').click();
    const advancedSettings = detail.getByTestId('indicator-advanced-settings-indicator-1');
    await expect(advancedSettings).toBeVisible();
    await expect(advancedSettings.getByText('数据来源', { exact: true })).toBeVisible();
    await expect(advancedSettings.getByText('数据口径', { exact: true })).toBeVisible();
    await expect(advancedSettings.getByText('目标值', { exact: true })).toBeVisible();
  });
});

async function mockObjectiveCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  treeCycles: Array<string | null>,
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-objective-cycle-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'manager-1',
      name: 'Cycle Manager',
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: 'manager',
      isAssessorOnly: false,
      canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: cycleItems.length,
      page: 1,
      pageSize: 100,
      items: cycleItems,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/indicators**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
  }));
  await page.route('**/api/v1/users/manager-1/subordinates', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/objectives/tree**', (route) => {
    treeCycles.push(new URL(route.request().url()).searchParams.get('cycleId'));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse([])),
    });
  });
}

test.describe('cycle-first objective map contracts', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('writes the current cycle before requesting the objective tree', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], treeCycles);

    await page.goto('/objectives');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect.poll(() => treeCycles.length).toBe(1);
    expect(treeCycles).toEqual(['current']);
  });

  test('preserves a valid historical objective cycle and offers no all-cycle option', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [
      cycle('past', '2026-01-01', '2026-03-31'),
      cycle('current', '2026-07-01', '2026-09-30'),
    ], treeCycles);

    await page.goto('/objectives?cycleId=past');

    await expect(page).toHaveURL(/cycleId=past/);
    await page.getByTestId('objective-map-cycle').click();
    await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '全部周期' })).toHaveCount(0);
    expect(treeCycles.every((cycleId) => cycleId === 'past')).toBe(true);
  });

  test('does not request an objective tree when no cycle is available', async ({ page }) => {
    const treeCycles: Array<string | null> = [];
    await mockObjectiveCycleShell(page, [], treeCycles);

    await page.goto('/objectives');

    await expect(page.getByText('暂无考核周期').first()).toBeVisible();
    expect(treeCycles).toHaveLength(0);
  });
});

const emptyReportSummary = {
  stats: {
    total: 0,
    grades: {
      A: { count: 0, ratio: 0 },
      B: { count: 0, ratio: 0 },
      C: { count: 0, ratio: 0 },
      D: { count: 0, ratio: 0 },
    },
  },
  items: [],
};

async function authenticateCyclePage(
  page: import('@playwright/test').Page,
  role: 'manager' | 'hr' | 'vp',
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-report-cycle-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: `${role}-1`,
      name: `Cycle ${role}`,
      deptId: 'dept-1',
      deptName: 'Engineering',
      sysRole: role,
      isAssessorOnly: false,
      canViewAll: role === 'hr',
    })),
  }));
}

async function mockReportCycleShell(
  page: import('@playwright/test').Page,
  cycleItems: AssessmentCycle[],
  summaryCycles: string[],
) {
  await authenticateCyclePage(page, 'hr');
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: cycleItems.length,
      page: 1,
      pageSize: 100,
      items: cycleItems,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/reports/cycle/*/summary**', (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/reports\/cycle\/([^/]+)\/summary/);
    if (match?.[1]) summaryCycles.push(match[1]);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyReportSummary)),
    });
  });
}

test.describe('cycle-first report contracts', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('canonicalizes one report cycle before loading summary data', async ({ page }) => {
    const summaryCycles: string[] = [];
    await mockReportCycleShell(page, [
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('past', '2026-01-01', '2026-03-31'),
    ], summaryCycles);

    await page.goto('/reports');

    await expect(page).toHaveURL(/cycleId=current/);
    await expect.poll(() => summaryCycles.length).toBe(1);
    expect(summaryCycles).toEqual(['current']);
  });

  test('preserves a valid historical report cycle', async ({ page }) => {
    const summaryCycles: string[] = [];
    await mockReportCycleShell(page, [
      cycle('current', '2026-07-01', '2026-09-30'),
      cycle('past', '2026-01-01', '2026-03-31'),
    ], summaryCycles);

    await page.goto('/reports?cycleId=past');

    await expect(page.getByTestId('report-cycle-select')).toContainText('past');
    await expect.poll(() => summaryCycles.length).toBe(1);
    expect(summaryCycles).toEqual(['past']);
  });
});

test('management dashboard uses the nearest eligible result cycle', async ({ page }) => {
  const summaryCycles: string[] = [];
  await authenticateCyclePage(page, 'manager');
  const cycleItems = [
    { ...cycle('recent-result', '2026-04-01', '2026-06-30'), status: 'closed' as const },
    { ...cycle('current-non-result', '2026-07-01', '2026-09-30'), status: 'self_eval' as const },
    { ...cycle('current-result', '2026-07-15', '2026-09-15'), status: 'published' as const },
  ];
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: cycleItems.length, page: 1, pageSize: 50, items: cycleItems })),
  }));
  await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 0,
      page: 1,
      pageSize: 1,
      items: [],
      counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
      facets: { departments: [], employees: [] },
    })),
  }));
  await page.route('**/api/v1/reports/cycle/*/summary**', (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/reports\/cycle\/([^/]+)\/summary/);
    if (match?.[1]) summaryCycles.push(match[1]);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(emptyReportSummary)),
    });
  });

  await page.goto('http://localhost:5173/dashboard');

  await expect(page.getByTestId('dashboard-result-cycle')).toHaveText('current-result');
  expect(summaryCycles).toEqual(['current-result']);
});

async function mockLifecycleCycleShell(
  page: import('@playwright/test').Page,
  kind: 'calibration' | 'approval' | 'publish',
  cycleItems: AssessmentCycle[],
  businessCycles: string[],
) {
  await authenticateCyclePage(page, kind === 'approval' ? 'vp' : 'hr');
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: cycleItems.length,
      page: 1,
      pageSize: 100,
      items: cycleItems,
    })),
  }));

  if (kind === 'calibration') {
    await page.route('**/api/v1/cycles/*/calibration**', (route) => {
      const match = new URL(route.request().url()).pathname.match(/\/cycles\/([^/]+)\/calibration/);
      if (match?.[1]) businessCycles.push(match[1]);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          gradeDistribution: {},
          totalActive: 0,
          pendingCalibration: 0,
          items: [],
        })),
      });
    });
  } else if (kind === 'approval') {
    await page.route('**/api/v1/cycles/*/approval**', (route) => {
      const match = new URL(route.request().url()).pathname.match(/\/cycles\/([^/]+)\/approval/);
      if (match?.[1]) businessCycles.push(match[1]);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse([])),
      });
    });
  } else {
    await page.route('**/api/v1/tasks**', (route) => {
      const cycleId = new URL(route.request().url()).searchParams.get('cycleId');
      if (cycleId) businessCycles.push(cycleId);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
      });
    });
  }
}

test.describe('cycle-first lifecycle workbench contracts', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  for (const entry of [
    { kind: 'calibration' as const, path: '/calibration', testId: 'calibration-cycle-select' },
    { kind: 'approval' as const, path: '/approval', testId: 'approval-cycle-select' },
    { kind: 'publish' as const, path: '/publish', testId: 'publish-cycle-select' },
  ]) {
    test(`${entry.kind} selects the nearest eligible cycle before loading work`, async ({ page }) => {
      const businessCycles: string[] = [];
      await mockLifecycleCycleShell(page, entry.kind, [
        cycle('past-eligible', '2026-01-01', '2026-03-31'),
        cycle('current-eligible', '2026-07-01', '2026-09-30'),
      ], businessCycles);

      await page.goto(entry.path);

      await expect(page).toHaveURL(/cycleId=current-eligible/);
      await expect(page.getByTestId(entry.testId)).toContainText('current-eligible');
      await expect.poll(() => businessCycles.length).toBe(1);
      expect(businessCycles).toEqual(['current-eligible']);
    });
  }

  test('keeps an eligible historical approval deep link', async ({ page }) => {
    const businessCycles: string[] = [];
    await mockLifecycleCycleShell(page, 'approval', [
      cycle('current-eligible', '2026-07-01', '2026-09-30'),
      cycle('past-eligible', '2026-01-01', '2026-03-31'),
    ], businessCycles);

    await page.goto('/approval?cycleId=past-eligible');

    await expect(page.getByTestId('approval-cycle-select')).toContainText('past-eligible');
    expect(businessCycles).toEqual(['past-eligible']);
  });

  test('does not load calibration work without an eligible cycle', async ({ page }) => {
    const businessCycles: string[] = [];
    await mockLifecycleCycleShell(page, 'calibration', [], businessCycles);

    await page.goto('/calibration');

    await expect(page.getByText('暂无可校准的考核周期')).toBeVisible();
    expect(businessCycles).toHaveLength(0);
  });
});

function selfEvalTaskDetail(): TaskDetail {
  const indicator = (id: string, name: string, weight: number, sortOrder: number) => ({
    id,
    taskId: 'self-eval-task-1',
    name,
    description: `${name}的目标说明`,
    dimensionName: sortOrder === 0 ? '业绩目标' : '能力态度',
    weight,
    dimensionWeight: 1,
    indicatorType: 'kpi' as const,
    sortOrder,
    scoringStandard: '请结合目标完成情况、质量与时效进行评分。',
    dataSource: '项目验收记录',
    dataCaliber: '以本周期确认的验收结果为准',
    targetValue: 100,
    unit: '分',
    visibilityScope: 'supervisors' as const,
    visibleDepartmentIds: [],
    visibleUserIds: [],
    alignedObjectives: [],
  });

  return {
    id: 'self-eval-task-1',
    cycleId: 'current',
    cycleName: '2026-Q3',
    snapshotId: 'snapshot-1',
    employeeId: 'manager-1',
    employeeName: '测试员工',
    employeeNo: 'EMP002',
    deptId: 'dept-1',
    deptName: '研发部',
    managerId: 'manager-2',
    managerName: '直属主管',
    status: 'self_eval',
    isExempt: false,
    updatedAt: '2026-08-25T00:00:00.000Z',
    indicatorInstances: [
      indicator('indicator-1', '核心项目交付', 0.6, 0),
      indicator('indicator-2', '协作与责任心', 0.4, 1),
    ],
    flowRecords: [],
  };
}

test.describe('employee self-evaluation soft guide', () => {
  test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173' });

  test('focuses the employee on one indicator instead of a wide report table', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');

    const workspace = page.getByTestId('personal-performance-detail');
    const guide = workspace.getByTestId('self-eval-guide');
    const cards = guide.getByTestId('self-eval-card');
    await expect(guide).toContainText('每项自评分为必填，其他内容可按需补充');
    await expect(guide.getByTestId('self-eval-progress')).toHaveText('已评分 0/2');
    await expect(cards).toHaveCount(2);
    await expect(workspace.getByRole('columnheader')).toHaveCount(0);
    await expect(cards.nth(0).getByTestId('self-eval-card-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(cards.nth(1).getByTestId('self-eval-card-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(cards.nth(0).getByTestId('self-eval-card-body')).toBeVisible();
    await expect(cards.nth(1).getByTestId('self-eval-card-body')).toBeHidden();
    await expect(cards.nth(0).getByText('完成情况与证据（选填）')).toBeVisible();
    await expect(cards.nth(0).getByText('评分说明（选填）')).toBeVisible();
    await cards.nth(0).getByRole('button', { name: '下一项' }).click();
    await expect(cards.nth(0).getByTestId('self-eval-card-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(cards.nth(1).getByTestId('self-eval-card-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('automatically restores an unfinished self-evaluation on the current device', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    const guide = page.getByTestId('self-eval-guide');
    const firstCard = guide.getByTestId('self-eval-card').nth(0);
    await firstCard.getByPlaceholder('填写关键结果或完成比例').fill('完成 95%');
    await firstCard.getByPlaceholder('0-100').fill('92');
    await firstCard.getByPlaceholder('写关键结果、时间或数据即可').fill('关键里程碑均按期验收');

    await expect(guide.getByTestId('self-eval-progress')).toHaveText('已评分 1/2');
    await expect(guide.getByTestId('self-eval-draft-status')).toContainText('已暂存于当前设备');

    await page.reload();

    const restoredCard = page.getByTestId('self-eval-card').nth(0);
    await expect(restoredCard.getByPlaceholder('填写关键结果或完成比例')).toHaveValue('完成 95%');
    expect(Number(await restoredCard.getByPlaceholder('0-100').inputValue())).toBe(92);
    await expect(restoredCard.getByPlaceholder('写关键结果、时间或数据即可')).toHaveValue('关键里程碑均按期验收');
    await expect(page.getByTestId('self-eval-draft-status')).toContainText('已恢复当前设备草稿');
  });

  test('scopes a self-evaluation draft to the authenticated editing user and task', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    await page.getByTestId('self-eval-card').nth(0).getByPlaceholder('0-100').fill('92');

    await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith('kayford.self-eval-draft.')))).toEqual([
      'kayford.self-eval-draft.manager-1.self-eval-task-1',
    ]);
  });

  test('does not delete a device draft when a manager opens self-evaluation read-only', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    await page.getByTestId('self-eval-card').nth(0).getByPlaceholder('0-100').fill('92');
    await expect(page.getByTestId('self-eval-draft-status')).toContainText('已暂存于当前设备');
    const draftKey = await page.evaluate(() => Object.keys(localStorage)
      .find((key) => key.startsWith('kayford.self-eval-draft.')) ?? '');
    expect(draftKey).not.toBe('');

    await page.evaluate(() => {
      const app = (document.querySelector('#app') as any).__vue_app__;
      const auth = app.config.globalProperties.$pinia._s.get('auth');
      auth.user = {
        id: 'manager-2',
        name: '直属主管',
        deptId: 'dept-1',
        deptName: 'Engineering',
        sysRole: 'manager',
        isAssessorOnly: false,
        canViewAll: false,
      };
    });

    await expect(page.getByRole('button', { name: '保存并稍后继续' })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).not.toBeNull();
  });

  test('keeps in-memory work and stays on the page when device draft storage fails', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key.startsWith('kayford.self-eval-draft.')) {
          throw new DOMException('storage unavailable', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });

    const score = page.getByTestId('self-eval-card').nth(0).getByPlaceholder('0-100');
    await score.fill('92');
    await page.getByRole('button', { name: '保存并稍后继续' }).click();

    await expect(page).toHaveURL(/\/tasks\/self-eval-task-1\?stage=self-eval/);
    expect(Number(await score.inputValue())).toBe(92);
    await expect(page.getByText('当前设备无法暂存草稿，请勿关闭页面')).toBeVisible();
    await expect(page.locator('.el-message')).toHaveCount(1);
  });

  test('clears the current user draft only after self-evaluation submission succeeds', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    const draftKey = 'kayford.self-eval-draft.manager-1.self-eval-task-1';
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.route('**/api/v1/tasks/self-eval-task-1/self-eval', (route) => {
      detail.status = 'manager_scoring';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ success: true })),
      });
    });
    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    await page.evaluate(({ key }) => localStorage.setItem(key, 'confirmed-local-draft'), { key: draftKey });
    const cards = page.getByTestId('self-eval-card');
    await cards.nth(0).getByPlaceholder('0-100').fill('92');
    await cards.nth(1).getByTestId('self-eval-card-toggle').click();
    await cards.nth(1).getByPlaceholder('0-100').fill('88');
    await page.getByRole('button', { name: '检查并提交' }).click();
    await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交' }).click();

    await expect(page.getByText('自评提交成功')).toBeVisible();
    await expect.poll(() => page.evaluate(({ key }) => localStorage.getItem(key), { key: draftKey }))
      .toBeNull();
  });

  test('locates missing scores before submitting the checked self-evaluation', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    let actualValueRequests = 0;
    let submitRequests = 0;
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.route('**/api/v1/tasks/self-eval-task-1/actual-value', (route) => {
      actualValueRequests += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ success: true })) });
    });
    await page.route('**/api/v1/tasks/self-eval-task-1/self-eval', (route) => {
      submitRequests += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ success: true })) });
    });

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    const cards = page.getByTestId('self-eval-card');
    await cards.nth(0).getByPlaceholder('填写关键结果或完成比例').fill('完成 95%');
    await cards.nth(0).getByPlaceholder('0-100').fill('92');
    await page.getByRole('button', { name: '检查并提交' }).click();

    await expect(cards.nth(1).getByTestId('self-eval-card-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(cards.nth(1).getByText('请填写 0-100 分的自评分')).toBeVisible();
    await expect(cards.nth(1).getByPlaceholder('0-100')).toBeFocused();
    expect(submitRequests).toBe(0);

    await cards.nth(1).getByPlaceholder('0-100').fill('88');
    await page.getByRole('button', { name: '检查并提交' }).click();
    const confirm = page.getByRole('dialog', { name: '提交前检查' });
    await expect(confirm).toContainText('2 项指标均已评分');
    await confirm.getByRole('button', { name: '确认提交' }).click();

    await expect.poll(() => submitRequests).toBe(1);
    expect(actualValueRequests).toBe(1);
  });

  test('keeps optional summary prompts progressively disclosed', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');

    const summary = page.getByTestId('self-eval-summary');
    await expect(summary).toContainText('以下内容均为选填');
    await expect(summary.getByText('本周期回顾（选填）')).toBeVisible();
    await expect(summary.getByPlaceholder('概括 1-3 项关键成果')).toBeVisible();
    await expect(summary.getByPlaceholder('下一阶段重点工作目标')).toBeHidden();
    await summary.getByText('下一阶段（选填）').click();
    await expect(summary.getByPlaceholder('下一阶段重点工作目标')).toBeVisible();
    await expect(summary.getByPlaceholder('对团队或管理者的建议')).toBeHidden();
    await summary.getByText('建议与材料（选填）').click();
    await expect(summary.getByPlaceholder('对团队或管理者的建议')).toBeVisible();
  });

  test('explains partial persistence when final self-evaluation submission fails', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.route('**/api/v1/tasks/self-eval-task-1/actual-value', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ success: true })),
    }));
    await page.route('**/api/v1/tasks/self-eval-task-1/self-eval', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'SELF_EVAL_FAILED', message: 'temporary failure', data: null }),
    }));

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    const cards = page.getByTestId('self-eval-card');
    await cards.nth(0).getByPlaceholder('填写关键结果或完成比例').fill('完成 95%');
    await cards.nth(0).getByPlaceholder('0-100').fill('92');
    await cards.nth(1).getByTestId('self-eval-card-toggle').click();
    await cards.nth(1).getByPlaceholder('0-100').fill('88');
    await page.getByRole('button', { name: '检查并提交' }).click();
    await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交' }).click();

    await expect(page.getByText('自评尚未提交，实际完成信息已保存，请稍后重试')).toBeVisible();
    await expect(page.locator('.el-message')).toHaveCount(1, { timeout: 1_000 });
    await expect(page.getByTestId('self-eval-draft-status')).toContainText('当前设备');
  });

  test('keeps one clear error when final self-evaluation returns a business-code failure', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.route('**/api/v1/tasks/self-eval-task-1/actual-value', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ success: true })),
    }));
    await page.route('**/api/v1/tasks/self-eval-task-1/self-eval', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 5001, message: 'temporary failure', data: null, timestamp: Date.now() }),
    }));

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    const cards = page.getByTestId('self-eval-card');
    await cards.nth(0).getByPlaceholder('填写关键结果或完成比例').fill('完成 95%');
    await cards.nth(0).getByPlaceholder('0-100').fill('92');
    await cards.nth(1).getByTestId('self-eval-card-toggle').click();
    await cards.nth(1).getByPlaceholder('0-100').fill('88');
    await page.getByRole('button', { name: '检查并提交' }).click();
    await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交' }).click();

    await expect(page.getByText('自评尚未提交，实际完成信息已保存，请稍后重试')).toBeVisible();
    await expect(page.locator('.el-message')).toHaveCount(1, { timeout: 1_000 });
  });

  test('keeps one clear error and the local draft when actual values cannot be saved', async ({ page }) => {
    const detail = selfEvalTaskDetail();
    let submitRequests = 0;
    await mockTaskCycleShell(page, [cycle('current', '2026-07-01', '2026-09-30')], [], [], detail);
    await page.route('**/api/v1/tasks/self-eval-task-1/actual-value', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ACTUAL_VALUE_FAILED', message: 'temporary failure', data: null }),
    }));
    await page.route('**/api/v1/tasks/self-eval-task-1/self-eval', (route) => {
      submitRequests += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ success: true })) });
    });

    await page.goto('/tasks/self-eval-task-1?stage=self-eval');
    const cards = page.getByTestId('self-eval-card');
    await cards.nth(0).getByPlaceholder('填写关键结果或完成比例').fill('完成 95%');
    await cards.nth(0).getByPlaceholder('0-100').fill('92');
    await cards.nth(1).getByTestId('self-eval-card-toggle').click();
    await cards.nth(1).getByPlaceholder('0-100').fill('88');
    await page.getByRole('button', { name: '检查并提交' }).click();
    await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交' }).click();

    await expect(page.getByText('自评尚未提交，当前设备草稿仍保留，请稍后重试')).toBeVisible();
    await expect(page.locator('.el-message')).toHaveCount(1, { timeout: 1_000 });
    expect(submitRequests).toBe(0);
  });
});
