import { expect, test, type Page } from '@playwright/test';

const cycleId = '11111111-1111-4111-8111-111111111111';
function calibrationItem(page: Page, width: number, employeeName: string) {
  return width <= 768
    ? page.locator('.calibration-mobile-list .mobile-result-card').filter({ hasText: employeeName })
    : page.getByRole('row').filter({ hasText: employeeName });
}
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
      hrCapabilities: ['cycle_plan_edit'], businessCapabilities: { canHandleHrCycle: true, canViewPerformanceCalibration: true } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path === '/api/v1/calibration/cycles') data = [cycle];
    else if (path.endsWith('/calibration/confirm')) { submitted = true; data = { updated: 1 }; }
    else if (path.endsWith('/calibration/tasks/other-task')) data = {
      taskId: 'other-task', employeeName: '虚拟员工甲', deptName: '测试部', position: '跨区域绩效运营与业务协同高级专员', managerName: '直属上级甲', status: 'hr_calibration', calculatedScore: 85, finalGrade: 'B',
      periods: [], indicators: [], rejectHistory: [],
      flowRecords: [
        { id: '0', nodeType: 'manager_score', action: 'reject', actorName: '直属上级甲', comment: '七月自评需补充成果', extraData: { type: 'manager_period_review_returned', periodKey: '2026-07' }, createdAt: '2026-08-31T09:00:00Z' },
        { id: '1', nodeType: 'manager_score', action: 'submit', actorName: '直属上级甲', comment: '系统评定摘要', extraData: { type: 'final_grade_submitted', comment: '按期完成季度交付，需加强沟通。' }, createdAt: '2026-09-01T09:00:00Z' },
        { id: '2', nodeType: 'dept_review', action: 'reject', actorName: '部门负责人乙', comment: '请补充项目验收依据', createdAt: '2026-09-02T09:00:00Z' },
        { id: '3', nodeType: 'manager_score', action: 'submit', actorName: '直属上级甲', extraData: { type: 'final_grade_submitted', comment: '已补齐验收记录。\n本周期目标完成。' }, createdAt: '2026-09-03T09:00:00Z' },
        { id: '4', nodeType: 'dept_review', action: 'approve', actorName: '部门负责人乙', comment: '部门已核实交付成果，复核通过。', createdAt: '2026-09-04T09:00:00Z' },
      ],
    };
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
  test(`校准详情保留复核意见、退回及周期评语 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await setup(page);
    await page.goto(`/calibration?cycleId=${cycleId}`);
    await calibrationItem(page, width, '虚拟员工甲').getByRole('button', { name: '查看详情', exact: true }).click();
    const summary = page.getByTestId('performance-result-summary');
    await expect(summary).toContainText('负责人范围验收周期');
    await expect(summary).toContainText('虚拟员工甲');
    await expect(summary).toContainText('绩效校准中');
    await expect(summary).toContainText('85.00');
    await expect(summary.getByText('B', { exact: true })).toBeVisible();
    await expect(summary).toContainText('分数与等级无换算关系');
    const history = page.getByTestId('review-history');
    await expect(history.getByText('部门已核实交付成果，复核通过。')).toBeVisible();
    await expect(history.getByText('已补齐验收记录。\n本周期目标完成。')).toBeVisible();
    await expect(history.getByText('请补充项目验收依据')).toBeVisible();
    await history.getByRole('button', { name: '查看全部 5 条记录' }).click();
    await expect(history.getByText('按期完成季度交付，需加强沟通。')).toBeVisible();
    await expect(history.getByText('系统评定摘要')).toHaveCount(0);
    await expect(history.getByText('2026-07 月度评价')).toBeVisible();
    await expect(history.getByText('七月自评需补充成果')).toBeVisible();
    expect(calls.filter(call => call.body)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('calibration-review-history.png'), fullPage: true });
  });
  test(`负责人限定周期校准、本人不展示结果且不可操作 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await setup(page);
    await page.goto(`/calibration?cycleId=${cycleId}`);
    await expect(page.getByTestId('calibration-cycle-select')).toContainText('负责人范围验收周期');
    const ownRow = calibrationItem(page, width, '虚拟周期负责人');
    const employeeRow = calibrationItem(page, width, '虚拟员工甲');
    await expect(ownRow).toContainText('本人结果由其他有权限的 HR 处理');
    await expect(ownRow.getByRole('checkbox')).toBeDisabled();
    await expect(ownRow.getByRole('button')).toHaveCount(0);
    await expect(employeeRow.getByRole('checkbox')).toBeEnabled();
    await employeeRow.getByRole('button', { name: '确认校准', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await expect(employeeRow).toContainText('结果审批中');
    expect(calls.filter(call => call.body)).toEqual([{ path: `/api/v1/cycles/${cycleId}/calibration/confirm`, body: { taskIds: ['other-task'] } }]);
    expect(calls.some(call => call.path === '/api/v1/cycles')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('scoped-calibration.png'), fullPage: true });
  });
}
