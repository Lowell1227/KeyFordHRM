import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`approval and return keep history rows after refresh with detail only ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { localStorage.setItem('token', 'isolated-retention'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
    const cycle = { id: 'retention-cycle', name: '记录留存验收', status: 'approval', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30' };
    const rows = ['通过测试员工', '退回测试员工'].map((employeeName, index) => ({ id: `task-${index}`, cycleId: cycle.id, employeeId: `employee-${index}`, employeeName, status: 'approval', approverId: 'approver', approvedAt: null as string | null, totalScore: 80, rawGrade: 'B', calibratedGrade: null }));
    const writes: string[] = [];
    await page.route('**/api/v1/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      let data: unknown = [];
      if (request.method() !== 'GET') {
        writes.push(path);
        if (path.endsWith('/approval')) { expect(request.postDataJSON().taskIds).toEqual(['task-0']); rows[0].approvedAt = '2026-09-09T01:00:00Z'; data = { approved: 1 }; }
        else if (path.endsWith('/task-1/approval/reject')) { expect(request.postDataJSON().comment).toBe('补充校准依据'); rows[1].status = 'hr_calibration'; data = { id: 'task-1' }; }
        else throw new Error(`unexpected isolated write ${path}`);
      } else if (path.endsWith('/auth/me')) data = { id: 'approver', name: '虚拟审批人', sysRole: 'employee', status: 'active', businessCapabilities: { identities: [], canViewPerformanceApproval: true, canOperatePerformanceApproval: true } };
      else if (path.endsWith('/cycles')) data = { items: [cycle], total: 1 };
      else if (path.endsWith('/approval/overview')) data = { ownPending: rows.filter(r => r.status === 'approval' && !r.approvedAt).length, ownTotal: 2, cyclePending: 0, rejects: [], gradeDistribution: {} };
      else if (path.endsWith('/approval')) data = rows;
      else if (path.includes('/tasks/task-')) { const row = rows.find(r => path.endsWith(r.id))!; data = { ...row, cycleName: cycle.name, flowRecords: [], gradeResult: { calculatedScore: 80, rawGrade: 'B', calibratedGrade: null }, resultEvidence: { periods: [], indicators: [] } }; }
      else if (path.endsWith('/notifications/unread-count')) data = 0;
      else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
      await route.fulfill({ json: { code: 0, data } });
    });
    await page.goto(`/approval?cycleId=${cycle.id}`);
    const items = width <= 768 ? page.locator('.mobile-result-card') : page.locator('.el-table__body tr');
    const first = items.filter({ hasText: '通过测试员工' });
    const second = items.filter({ hasText: '退回测试员工' });
    await first.getByRole('button', { name: '通过', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '通过', exact: true }).click();
    await expect(first).toContainText('待员工确认');
    await second.getByRole('button', { name: '退回', exact: true }).click();
    await page.getByPlaceholder('请输入审批意见（必填）').fill('补充校准依据');
    await page.getByRole('button', { name: '确认退回', exact: true }).click();
    await expect(second).toContainText('绩效校准中');
    await page.reload();
    for (const row of [first, second]) {
      await expect(row.getByRole('checkbox')).toBeDisabled();
      await expect(row.getByRole('button')).toHaveText(['查看详情']);
      await row.getByRole('button', { name: '查看详情' }).click();
      await expect(page.locator('.performance-result-drawer')).toContainText('暂无月度结果');
      await expect(page.locator('.performance-result-drawer')).toContainText('暂无关键节点记录');
      await page.locator('.performance-result-drawer').getByRole('button', { name: '关闭', exact: true }).click();
    }
    expect(writes).toEqual(['/api/v1/cycles/retention-cycle/approval', '/api/v1/tasks/task-1/approval/reject']);
  });
}

test('历史专属关系刷新后仍可进入复核、校准和审批页面', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('token', 'history-only'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  const writes: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(path);
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'historical-user', name: '历史任务负责人', sysRole: 'employee', status: 'active', hrCapabilities: [], businessCapabilities: {
      identities: [], canReviewDepartment: false, canHandleHrCycle: false, canOperatePerformanceApproval: false,
      canViewDepartmentReview: true, canViewPerformanceCalibration: true, canViewPerformanceApproval: true,
    } };
    else if (path.endsWith('/cycles') || path.endsWith('/tasks/mine')) data = path.includes('/calibration/') ? [] : { items: [], total: 0 };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    await route.fulfill({ json: { code: 0, data } });
  });
  for (const path of ['/department-review', '/calibration', '/approval']) {
    await page.goto(path);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('.performance-result-page')).toBeVisible();
  }
  expect(writes).toEqual([]);
});
