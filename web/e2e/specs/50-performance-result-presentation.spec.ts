import { expect, test, type Page } from '@playwright/test';

const cycleId = 'presentation-cycle';
const cycleName = '2026 Q3 季度考核 · 跨区域协同项目';
const employeeName = '虚拟绩效员工';
const gradeDistribution = Object.fromEntries(['A', 'B', 'C', 'D'].map(grade => [grade, { count: grade === 'A' ? 1 : 0, ratio: grade === 'A' ? 1 : 0, maxRatio: 1, isOverLimit: false }]));
const periods = ['07', '08', '09'].map(month => ({ id: month, periodKey: `2026-${month}`, periodType: 'month', status: 'completed', selfScoreTotal: 84, managerScoreTotal: 88, selfGrade: 'B', managerGrade: 'A' }));
const flowRecords = Array.from({ length: 8 }, (_, index) => ({
  id: `record-${index}`, nodeType: index % 2 ? 'dept_review' : 'manager_score', action: 'approve', actorName: '虚拟办理人', createdAt: `2026-09-0${index + 1}T10:00:00.000Z`,
  comment: '交付依据完整，部门协作结果已核对。\n' + '用于验证长评语正常换行、抽屉独立滚动和底部关闭按钮可见。'.repeat(6),
}));

async function mockResultPages(page: Page) {
  const writes: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-result-style');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      writes.push(path);
      return route.fulfill({ status: 405, json: { code: 405, message: '展示验收禁止写入' } });
    }
    const cycle = { id: cycleId, name: cycleName, type: 'quarterly', status: 'approval', startDate: '2026-07-01', endDate: '2026-09-30', gradeAMaxRatio: 1, gradeBMaxRatio: 1 };
    const row = { resultEvidence: { periods, indicators: [{ id: 'goal-one', name: '季度交付指标', weight: 1, avgSelfScore: 84, avgManagerScore: 88 }] }, id: 'presentation-task', taskId: 'presentation-task', cycleId, cycleName, employeeId: 'other-employee', employeeName, employeeNo: 'QA019', deptName: '跨区域业务协作部', position: '项目交付专员', managerName: '虚拟直属上级', status: 'approval', approvedAt: '2026-09-08T10:00:00Z', totalScore: 88, calculatedScore: 88, rawGrade: 'B', calibratedGrade: 'A', isExempt: false };
    let data: unknown = {};
    if (path.endsWith('/auth/me')) data = { id: 'test-manager', name: '虚拟部门负责人', sysRole: 'hr', status: 'active', canViewAll: true, businessCapabilities: { identities: [], canReviewDepartment: true, canViewDepartmentReview: true, canOperateDepartmentReview: true, canViewPerformanceCalibration: true, canOperatePerformanceCalibration: true, canViewPerformanceApproval: true, canOperatePerformanceApproval: true } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/calibration/cycles')) data = [cycle];
    else if (path === '/api/v1/cycles') data = { items: [cycle], total: 1 };
    else if (path.includes('department-review')) data = { items: [{ ...row, departmentReview: { canReview: false, latest: { action: 'approve', combined: false, createdAt: '2026-09-07T10:00:00Z' } } }], total: 1, pendingTotal: 0 };
    else if (path.endsWith('/calibration')) data = { items: [{ ...row, canCalibrate: false, canViewDetail: true }], gradeDistribution, totalActive: 1, progress: { finalGrading: 0, deptReview: 0, pending: 0, inApproval: 1, done: 0 } };
    else if (path.includes('/calibration/tasks/')) data = { ...row, finalGrade: 'B', periods, indicators: [], rejectHistory: [], flowRecords };
    else if (path.endsWith('/approval/overview')) data = { ownPending: 0, ownTotal: 1, cyclePending: 0, gradeDistribution, rejects: [] };
    else if (path.endsWith('/approval')) data = [{ ...row, approverId: 'test-manager', isVeto: false }];
    else if (path.endsWith('/publication-records')) data = { items: [{ ...row, publicationState: 'ready_to_publish', canPublish: true, resultMasked: false, publishedAt: null }], total: 1 };
    else if (path.includes('/publication-records/')) data = { ...row, publicationState: 'ready_to_publish', flowRecords, periods, resultMasked: false };
    else if (path.endsWith('/final-grade')) data = { ...row, currentGrade: 'B', periods, flowRecords, canSubmit: false, allPeriodsComplete: true, latestReject: null };
    else if (path.endsWith('/tasks/presentation-task')) data = { ...row, indicatorInstances: [], flowRecords, gradeResult: { calculatedScore: 88, rawGrade: 'B', calibratedGrade: 'A' } };
    else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    return route.fulfill({ json: { code: 0, data } });
  });
  return writes;
}

for (const width of [1440, 390]) {
  for (const [path, title] of [['department-review', '部门复核'], ['calibration', '绩效校准'], ['approval', '结果审批'], ['publish', '结果公示']]) {
  test(`${title}表体和抽屉保持一致且长评语可读 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockResultPages(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const snapshots: unknown[] = [];
      await page.goto(`/${path}?cycleId=${cycleId}`);
      const view = page.locator('.performance-result-page');
      const table = view.locator('.performance-result-table').last();
      await expect(table).toContainText(employeeName);
      const headers = await table.locator('thead th').allTextContents();
      const commonFields = ['员工', '部门', '岗位', '周期得分', '周期等级', '当前环节'];
      expect(headers.map(value => value.trim()).filter(value => commonFields.includes(value))).toEqual(commonFields);
      for (const [field, expectedWidth] of [['周期得分', 110], ['周期等级', 100], ['操作', 180]] as const) {
        const actualWidth = await table.locator('thead th').evaluateAll((elements, label) => elements.find(element => element.textContent?.trim() === label)?.getBoundingClientRect().width, field);
        expect(Math.round(actualWidth!)).toBe(expectedWidth);
      }
      await expect(table).toContainText('QA019');
      await expect(table).toContainText('88.00');
      await expect(table).toContainText('已审批，待公示');
      if (path === 'calibration') {
        await expect(view.locator('.ratio-item').filter({ has: page.locator('.grade-tag', { hasText: /^A$/ }) }).locator('.ratio-count')).toHaveText('1人');
      }
      const metrics = await table.evaluate(element => {
        const header = element.querySelector('thead th:not(.el-table-column--selection)')!;
        const cell = element.querySelector('tbody td:not(.el-table-column--selection)')!;
        return { headerFont: getComputedStyle(header).fontSize, bodyFont: getComputedStyle(cell).fontSize, headerHeight: header.getBoundingClientRect().height, bodyHeight: cell.getBoundingClientRect().height };
      });
      expect(metrics.headerFont).toBe('13px');
      expect(metrics.bodyFont).toBe('13px');
      expect(metrics.headerHeight).toBe(40);
      expect(metrics.bodyHeight).toBeGreaterThanOrEqual(56);
      const identity = table.locator('.performance-result-employee').first();
      expect(await identity.evaluate(element => element.children[1].getBoundingClientRect().top >= element.children[0].getBoundingClientRect().bottom)).toBe(true);
      await table.getByRole('button', { name: '查看详情', exact: true }).click();
      const drawer = page.locator('.performance-result-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('performance-result-summary')).toContainText(cycleName);
      await expect(drawer.getByTestId('performance-result-summary')).toContainText('周期得分');
      await expect(drawer.locator('.el-drawer__title')).toContainText(title);
      await expect(drawer.getByRole('heading', { name: '月度结果回顾' })).toBeVisible();
      await expect(drawer.locator('.performance-period-table')).toContainText('2026-07');
      await expect(drawer.locator('.performance-period-table')).toContainText('88.00');
      await drawer.getByText('指标汇总（跨月平均）', { exact: true }).click();
      await expect(drawer.getByText('季度交付指标', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: '查看全部 8 条记录' }).click();
      await drawer.locator('.el-drawer__body').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(drawer.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
      await expect.poll(async () => Math.round((await drawer.boundingBox())!.width)).toBe(Math.min(720, width));
      const drawerMetrics = await drawer.evaluate(element => {
        const titleElement = element.querySelector('.el-drawer__title')!;
        const body = element.querySelector('.el-drawer__body')!;
        return { font: getComputedStyle(titleElement).fontSize, weight: getComputedStyle(titleElement).fontWeight, padding: getComputedStyle(body).paddingLeft, width: element.getBoundingClientRect().width, bodyOverflow: body.scrollWidth > body.clientWidth };
      });
      expect(drawerMetrics.font).toBe('16px');
      expect(drawerMetrics.weight).toBe('600');
      expect(drawerMetrics.bodyOverflow).toBe(false);
      snapshots.push({ path, metrics, drawerMetrics });
      await drawer.locator('.el-drawer__body').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`${path}-drawer-${width}.png`), fullPage: true, animations: 'disabled' });
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(table).toContainText(employeeName);
      await table.locator('.el-scrollbar__wrap').evaluateAll(elements => elements.forEach(element => { element.scrollLeft = 0; }));
      await page.screenshot({ path: testInfo.outputPath(`${path}-list-${width}.png`), fullPage: true, animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach('presentation-geometry', { body: JSON.stringify(snapshots, null, 2), contentType: 'application/json' });
  });
  }
}
