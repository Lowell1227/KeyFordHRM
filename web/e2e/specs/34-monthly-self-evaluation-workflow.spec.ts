import { expect, test, type Page, type Request } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const cycleId = '11111111-1111-4111-8111-111111111111';
const periodId = '22222222-2222-4222-8222-222222222222';

const cycle = {
  id: cycleId,
  name: '2026 Q3 季度考核（902LW测试）',
  type: 'quarterly',
  workflowVersion: 2,
  scoringFrequency: 'monthly',
  planVersion: 3,
  startDate: '2026-07-09',
  endDate: '2026-09-06',
  openedAt: '2026-09-02T02:43:00.000Z',
  status: 'self_eval',
  reviewStatus: 'approved',
  notificationMode: 'dingtalk',
  creator: { id: 'hr-1', name: '姚瑶' },
  reviewer: { id: 'hr-1', name: '姚瑶' },
  companyFinalApprover: { id: 'leader-1', name: '李宏' },
  publishVisibleFields: {},
  gradeAMaxRatio: .2,
  gradeBMaxRatio: .4,
  gradeCMaxRatio: .3,
  gradeDMaxRatio: .1,
  periodSchedules: ['2026-07', '2026-08', '2026-09'].map((periodKey, index) => ({
    periodKey,
    periodType: 'month',
    sequence: index + 1,
    periodStart: `${periodKey}-01`,
    periodEnd: `${periodKey}-28`,
    selfEvalOpenAt: `${periodKey}-01T09:00:00+08:00`,
    selfEvalDueAt: `${periodKey}-03T18:00:00+08:00`,
    managerDueAt: `${periodKey}-06T18:00:00+08:00`,
    isException: false,
  })),
};

function monitoringResult(page = 1) {
  return {
    cycle: { id: cycleId, name: cycle.name },
    summary: { employeePending: 1, employeeOverdue: 1, managerPending: 1, managerCompleted: 1, total: 4 },
    total: 42,
    page,
    pageSize: 20,
    items: [{
      id: periodId,
      taskId: '33333333-3333-4333-8333-333333333333',
      periodKey: '2026-08',
      sequence: 2,
      status: 'completed',
      derivedStatus: 'manager_completed',
      draftVersion: 4,
      employeeId: '44444444-4444-4444-8444-444444444444',
      employeeNo: '319',
      employeeName: '方园',
      deptName: '人事组',
      managerName: '姚瑶',
      selfEvalOpenAt: '2026-09-01T01:00:00.000Z',
      selfEvalDueAt: '2026-09-01T10:00:00.000Z',
      managerDueAt: '2026-09-02T10:00:00.000Z',
      employeeSubmittedAt: '2026-09-01T08:00:00.000Z',
      managerSubmittedAt: '2026-09-02T08:00:00.000Z',
      lockedAt: '2026-09-02T08:00:00.000Z',
      selfScoreTotal: 86,
      managerScoreTotal: 88,
      canReopen: true,
      reopenBlockedReason: null,
    }, {
      id: '55555555-5555-4555-8555-555555555555',
      taskId: '66666666-6666-4666-8666-666666666666',
      periodKey: '2026-09',
      sequence: 3,
      status: 'completed',
      derivedStatus: 'manager_completed',
      draftVersion: 2,
      employeeId: '77777777-7777-4777-8777-777777777777',
      employeeNo: '320',
      employeeName: '俞丹',
      deptName: '人事组',
      managerName: '方园',
      selfEvalOpenAt: '2026-09-01T01:00:00.000Z',
      selfEvalDueAt: '2026-09-01T10:00:00.000Z',
      managerDueAt: '2026-09-02T10:00:00.000Z',
      employeeSubmittedAt: '2026-09-01T08:00:00.000Z',
      managerSubmittedAt: '2026-09-02T08:00:00.000Z',
      lockedAt: '2026-09-02T08:00:00.000Z',
      selfScoreTotal: 90,
      managerScoreTotal: 91,
      canReopen: false,
      reopenBlockedReason: '结果已经公示，请走现有结果更正流程',
    }],
  };
}

async function mockCycleWorkspace(page: Page, requests: Request[]) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'monthly-monitor-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'admin-1', name: 'HR管理员', sysRole: 'system_admin', deptId: null,
      isAssessorOnly: false, canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/notification-settings/dingtalk', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ available: true, enabled: true, effectiveEnabled: true })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([])),
  }));
  await page.route(`**/api/v1/assessment-periods/cycle/${cycleId}/monitoring**`, (route) => {
    requests.push(route.request());
    const requestedPage = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(monitoringResult(requestedPage))) });
  });
  await page.route(`**/api/v1/assessment-periods/${periodId}/reopen`, (route) => {
    requests.push(route.request());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ periodId, status: 'self_eval', draftVersion: 5, savedAt: new Date().toISOString() })),
    });
  });
  await page.route('**/api/v1/cycles**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/${cycleId}/participant-record`)) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          cycleId,
          source: 'manual',
          recordedAt: cycle.openedAt,
          operator: cycle.creator,
          summary: { total: 1, active: 1, exempted: 0 },
          participants: [{
            employeeId: '44444444-4444-4444-8444-444444444444',
            employeeName: '方园', deptName: '人事组', managerName: '姚瑶',
            isExempt: false, exemptReason: null,
          }],
        })),
      });
    }
    if (path.endsWith(`/${cycleId}`)) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(cycle)) });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ items: [cycle], total: 1, page: 1, pageSize: 10 })),
    });
  });
}

test('HR monitors monthly self evaluation progress and reopens only an eligible unpublished month', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests: Request[] = [];
  await mockCycleWorkspace(page, requests);

  await page.goto(`/cycles?cycleId=${cycleId}`);

  const panel = page.getByTestId('cycle-monthly-progress-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('待员工月度自评1');
  await expect(panel).toContainText('月度自评已逾期1');
  await expect(panel).toContainText('待主管月度评分1');
  await expect(panel).toContainText('主管月度评分已完成1');
  await expect(panel).toContainText('方园');
  await expect(panel).toContainText('结果已经公示，请走现有结果更正流程');
  await expect(page.getByTestId('cycle-monthly-progress-pagination')).toBeVisible();
  expect(new URL(requests.find((request) => request.method() === 'GET')!.url()).searchParams.get('pageSize')).toBe('20');

  const pagination = page.getByTestId('cycle-monthly-progress-pagination');
  await pagination.getByRole('listitem', { name: '第 2 页' }).click();
  await expect.poll(() => requests.some((request) => (
    request.method() === 'GET' && new URL(request.url()).searchParams.get('page') === '2'
  ))).toBe(true);
  await pagination.getByRole('listitem', { name: '第 1 页' }).click();
  await expect.poll(() => requests.filter((request) => (
    request.method() === 'GET' && new URL(request.url()).searchParams.get('page') === '1'
  )).length).toBeGreaterThan(1);

  await panel.getByRole('button', { name: '重新开放月度自评' }).click();
  const dialog = page.getByRole('dialog', { name: '重新开放2026-08月度自评' });
  await expect(dialog).toContainText('历史记录保留');
  await dialog.locator('textarea').fill('员工反馈本月评分材料需要修订');
  await dialog.getByRole('button', { name: '确认重新开放' }).click();

  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  expect(requests.find((request) => request.method() === 'POST')?.postDataJSON()).toEqual({
    expectedVersion: 4,
    reason: '员工反馈本月评分材料需要修订',
  });
  await expect(page.getByText('月度自评已重新开放')).toBeVisible();
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBeGreaterThan(1);
});
