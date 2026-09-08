import { expect, test, type Page } from '@playwright/test';

const cycleId = '11111111-1111-4111-8111-111111111111';
async function setup(page: Page) {
  const calls: Array<{ path: string; body?: unknown }> = [];
  let submitted = false;
  const cycle = { id: cycleId, name: '负责人范围验收周期', type: 'quarterly', status: 'hr_calibration', workflowVersion: 2,
    startDate: '2026-07-01', endDate: '2026-09-30', gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-cycle-owner');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    calls.push({ path, body });
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'owner', name: '虚拟周期负责人', sysRole: 'hr_user', canViewAll: false,
      hrCapabilities: ['cycle_plan_edit'], businessCapabilities: { canHandleHrCycle: true } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path === '/api/v1/calibration/cycles') data = [cycle];
    else if (path.endsWith('/calibration/confirm')) { submitted = true; data = { updated: 1 }; }
    else if (path === `/api/v1/cycles/${cycleId}/calibration`) data = {
      totalActive: 2, progress: { finalGrading: 0, deptReview: 0, pending: submitted ? 1 : 2, inApproval: submitted ? 1 : 0, done: 0 },
      gradeDistribution: Object.fromEntries(['A','B','C','D'].map(grade => [grade, { count: grade === 'B' ? 1 : 0, ratio: grade === 'B' ? 1 : 0, maxRatio: 0.4, isOverLimit: grade === 'B' }])),
      items: [
        { taskId: 'own-task', employeeName: '虚拟周期负责人', status: 'hr_calibration', deptName: '测试部', calculatedScore: null, rawGrade: null,
          canCalibrate: false, canViewDetail: false, actionHint: '本人结果由其他有权限的 HR 处理' },
        { taskId: 'other-task', employeeName: '虚拟员工甲', status: submitted ? 'approval' : 'hr_calibration', deptName: '测试部', calculatedScore: 85, rawGrade: 'B',
          canCalibrate: !submitted, canViewDetail: true, actionHint: null },
      ],
    };
    else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return calls;
}

for (const width of [1440, 390]) {
  test(`负责人限定周期校准、本人不展示结果且不可操作 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await setup(page);
    await page.goto(`/calibration?cycleId=${cycleId}`);
    await expect(page.getByTestId('calibration-cycle-select')).toContainText('负责人范围验收周期');
    const ownRow = page.getByRole('row').filter({ hasText: '虚拟周期负责人' });
    const employeeRow = page.getByRole('row').filter({ hasText: '虚拟员工甲' });
    await expect(ownRow).toContainText('本人结果由其他有权限的 HR 处理');
    await expect(ownRow.getByRole('checkbox')).toBeDisabled();
    await expect(ownRow.getByRole('button')).toHaveCount(0);
    await expect(employeeRow.getByRole('checkbox')).toBeEnabled();
    await employeeRow.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await expect(employeeRow).toContainText('结果审批中');
    expect(calls.filter(call => call.body)).toEqual([{ path: `/api/v1/cycles/${cycleId}/calibration/confirm`, body: { taskIds: ['other-task'] } }]);
    expect(calls.some(call => call.path === '/api/v1/cycles')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('scoped-calibration.png'), fullPage: true });
  });
}
