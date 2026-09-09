import { expect, test, type Page } from '@playwright/test';

const taskId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const response = (data: unknown) => ({ code: 0, message: 'success', data });

function reviewItem(page: Page, width: number, employeeName: string) {
  return width <= 768
    ? page.locator('.department-review-mobile-list .mobile-result-card').filter({ hasText: employeeName })
    : page.getByRole('row').filter({ hasText: employeeName });
}

async function setup(page: Page, role: 'head' | 'employee' | 'employee-head' = 'head', options: { status?: string; combined?: boolean; approvedAt?: string; reviewGate?: Promise<void> } = {}) {
  let status = options.status ?? 'dept_review';
  let latestReview: { action: 'approve' | 'reject'; createdAt: string; combined: boolean } | null = options.combined ? { action: 'approve', createdAt: '2026-09-08T10:00:00Z', combined: true } : null;
  const flowRecords = [{ id: 'grade-record', nodeType: 'manager_score', action: 'submit', actorName: '虚拟直属上级', createdAt: '2026-09-08T09:00:00Z', comment: '整周期结果评定：最终等级 B', extraData: { type: 'final_grade_submitted', comment: '周期交付稳定，建议加强协作。' } }];
  if (options.combined) flowRecords.push({ id: 'combined-record', nodeType: 'dept_review', action: 'approve', actorName: '虚拟复核账号', createdAt: '2026-09-08T10:00:00Z', comment: '绩效直属上级与部门负责人为同一人，本次提交合并完成部门复核。', extraData: { type: 'combined_department_review', comment: '' } });
  const submissions: unknown[] = [];
  const userId = role === 'head' ? 'head-1' : 'employee-1';
  await page.addInitScript(() => {
    localStorage.setItem('token', 'department-review-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 3600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    let data: unknown = {};
    if (endpoint.endsWith('/auth/me')) data = { id: userId, name: '虚拟复核账号', sysRole: 'employee', canViewAll: false, businessCapabilities: { canReviewDepartment: role === 'head', canManageTeam: false } };
    else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint === '/api/v1/cycles/mine') data = [{ id: cycleId, name: '部门复核回归周期', status: 'manager_score' }];
    else if (endpoint === '/api/v1/departments') data = [];
    else if (endpoint === '/api/v1/cycles') data = { items: [{ id: cycleId, name: '部门复核回归周期', status: 'manager_score' }], total: 1 };
    else if (endpoint === '/api/v1/cycles/' + cycleId) data = { id: cycleId, name: '部门复核回归周期', workflowVersion: 2, status: 'manager_score', publishVisibleFields: {} };
    else if (endpoint === '/api/v1/tasks/department-review') data = { items: [{ id: taskId, cycleId, employeeName: '虚拟员工甲', employeeNo: 'QA_EMPLOYEE', cycleName: '部门复核回归周期', deptName: '人事组', position: '绩效专员', status, approvedAt: options.approvedAt, totalScore: 92.4, rawGrade: 'B', calibratedGrade: 'A', departmentReview: { canReview: status === 'dept_review', latest: latestReview } }], total: 1, pendingTotal: status === 'dept_review' ? 1 : 0, page: 1, pageSize: 20 };
    else if (endpoint.endsWith('/dept-review') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); submissions.push(body);
      if (options.reviewGate) await options.reviewGate;
      latestReview = { action: body.action, createdAt: '2026-09-08T10:00:00Z', combined: false };
      flowRecords.push({ id: 'department-record', nodeType: 'dept_review', action: body.action, actorName: '虚拟复核账号', createdAt: '2026-09-08T10:00:00Z', comment: body.comment ?? '', extraData: { type: '', comment: '' } });
      status = body.action === 'approve' ? 'hr_calibration' : 'manager_scoring'; data = { id: taskId, status };
    } else if (endpoint.endsWith('/final-grade')) data = {
      taskId, cycleId, employeeName: '虚拟员工甲', cycleName: '部门复核回归周期', status, approvedAt: options.approvedAt,
      deptName: '人事组', position: '绩效制度与组织发展高级专员（跨团队协作与长期项目跟进）', managerName: '虚拟直属上级', calculatedScore: 92.4, currentGrade: 'B', canSubmit: false, allPeriodsComplete: true, latestReject: null,
      flowRecords: role === 'head' ? flowRecords : [],
      periods: [{ periodKey: '2026-09', selfGrade: 'A', managerGrade: 'A', selfScoreTotal: 92.4, managerScoreTotal: 92.4 }],
    };
    else if (endpoint === '/api/v1/tasks/' + taskId) data = {
      id: taskId, cycleId, cycleName: '部门复核回归周期', employeeId: 'employee-1', employeeName: '虚拟员工甲', employeeNo: 'QA_EMPLOYEE', deptName: '人事组', position: '绩效制度与组织发展高级专员（跨团队协作与长期项目跟进）',
      managerId: options.combined ? 'head-1' : 'manager-1', managerName: '虚拟直属上级', deptHeadId: role === 'employee-head' ? 'employee-1' : 'head-1', status, approvedAt: options.approvedAt, isExempt: false, workflowVersion: 2,
      periods: [{ id: 'period-1', periodKey: '2026-09', status: 'completed', sequence: 1, periodType: 'month', managerSubmittedAt: '2026-10-01T00:00:00Z', employeeSubmittedAt: '2026-10-01T00:00:00Z' }],
      gradeResult: role === 'head' ? { calculatedScore: 92.4, rawGrade: 'B', calibratedGrade: 'A', isPublished: false } : null,
      indicatorInstances: [], flowRecords: role === 'head' ? flowRecords : [],
      workflowContext: { stage: 'review', statusLabel: '待部门复核', currentHandler: null, canRemind: false },
    };
    else if (endpoint.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    else if (endpoint.includes('/dashboard')) data = {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(data)) });
  });
  return submissions;
}

test('部门复核详情识别结果审批已通过并等待员工确认', async ({ page }) => {
  await setup(page, 'head', { status: 'approval', combined: true, approvedAt: '2026-09-08T12:00:00.000Z' });
  await page.goto('/department-review');
  await page.getByRole('row').filter({ hasText: '虚拟员工甲' }).getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(page).toHaveURL(/\/department-review$/);
  const drawer = page.getByTestId('department-review-detail-drawer');
  await expect(drawer).toBeVisible();
  const workspace = drawer.getByTestId('department-review-workspace');
  await expect(workspace.locator('.chart-card')).toHaveCount(0);
  await expect(workspace.getByTestId('performance-result-summary')).toContainText('待员工确认');
  await expect(workspace).toContainText('部门复核已完成，结果审批已通过，等待员工确认。');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
});

for (const width of [1440, 390]) {
  test(`部门负责人从待办进入复核并通过，宽度 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const submissions = await setup(page);
    await page.goto('/department-review');
    await page.getByRole('button', { name: '进入复核', exact: true }).click();
    await expect(page.getByTestId('department-review-workspace')).toBeVisible();
    const summary = page.getByTestId('department-review-workspace').getByTestId('performance-result-summary');
    await expect(summary).toContainText('部门复核回归周期');
    await expect(summary).toContainText('虚拟员工甲');
    await expect(summary).toContainText('部门复核中');
    await expect(summary).toContainText('绩效制度与组织发展高级专员（跨团队协作与长期项目跟进）');
    await expect(summary).toContainText('92.40');
    await expect(summary.getByText('B', { exact: true })).toBeVisible();
    await expect(page.getByTestId('performance-stage-unavailable')).toHaveCount(0);
    await expect(summary.getByText('92.40', { exact: true })).toBeVisible();
    await expect(page.getByTestId('department-review-workspace').getByTestId('review-history')).toContainText('周期交付稳定，建议加强协作。');
    await page.getByRole('textbox', { name: '复核意见' }).fill('复核确认交付依据充分');
    await page.getByRole('button', { name: '复核通过', exact: true }).click();
    await expect.poll(() => submissions).toEqual([{ action: 'approve', comment: '复核确认交付依据充分' }]);
    await expect(page.getByText('部门复核已通过，已进入绩效校准。', { exact: true })).toBeVisible();
    await page.goto('/department-review');
    const row = reviewItem(page, width, '虚拟员工甲');
    await expect(row).toContainText('复核通过');
    await expect(row).toContainText('绩效校准中');
    await expect(page.getByTestId('department-review-pending-total')).toHaveCount(0);
    await expect(row.getByRole('button', { name: '进入复核', exact: true })).toHaveCount(0);
    await row.getByRole('button', { name: '查看详情', exact: true }).click();
    await expect(page.getByTestId('department-review-workspace')).toBeVisible();
    const history = page.getByTestId('department-review-workspace').getByTestId('review-history');
    await expect(history).toContainText('周期交付稳定，建议加强协作。');
    await expect(history).toContainText('复核确认交付依据充分');
    await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

for (const width of [1440, 390]) {
  test(`同人合并复核的已公示记录保留只读详情及真实办理历史 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const submissions = await setup(page, 'head', { status: 'published', combined: true });
    await page.goto('/department-review');
    const row = reviewItem(page, width, '虚拟员工甲');
    await expect(row).toContainText('合并复核通过');
    await expect(row).toContainText('已公示');
    await row.getByRole('button', { name: '查看详情', exact: true }).click();
    const workspace = page.getByTestId('department-review-workspace');
    await expect(workspace).toBeVisible();
    await expect(workspace.getByTestId('review-history')).toContainText('合并办理');
    await expect(workspace.getByTestId('review-history')).toContainText('周期交付稳定，建议加强协作。');
    await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '退回上级重评', exact: true })).toHaveCount(0);
    expect(submissions).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('退回必须填写原因，提交后进入上级重评', async ({ page }) => {
  const submissions = await setup(page);
  await page.goto('/tasks/' + taskId);
  await page.getByRole('button', { name: '退回上级重评', exact: true }).click();
  await expect(page.getByText('请填写退回原因', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(0);
  await page.getByRole('textbox', { name: '复核意见' }).fill('请补充最终等级依据');
  await page.getByRole('button', { name: '退回上级重评', exact: true }).click();
  await expect.poll(() => submissions).toEqual([{ action: 'reject', comment: '请补充最终等级依据' }]);
  await expect(page.getByText('已退回直属上级重新评定。', { exact: true })).toBeVisible();
});

test('复核请求未完成时抽屉不可关闭，完成后仍刷新名单', async ({ page }) => {
  let releaseReview!: () => void;
  const reviewGate = new Promise<void>(resolve => { releaseReview = resolve; });
  await setup(page, 'head', { reviewGate });
  await page.goto('/department-review');
  await page.getByRole('button', { name: '进入复核', exact: true }).click();
  const drawer = page.getByTestId('department-review-detail-drawer');
  await drawer.getByRole('button', { name: '复核通过', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();

  releaseReview();
  await expect(page.getByTestId('department-review-pending-total')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
});

async function setupRecords(page: Page, options: { paginated?: boolean; slowCalibration?: boolean } = {}) {
  await setup(page);
  const requests: Array<{ status: string | null; page: number }> = [];
  let releaseCalibration!: () => void;
  const calibrationGate = new Promise<void>(resolve => { releaseCalibration = resolve; });
  const record = (id: string, employeeName: string, status: string, latest: { action: 'approve' | 'reject'; combined: boolean } | null = null) => ({
    id, cycleId, employeeName, employeeNo: `E-${id}`, cycleName: '2026年度部门复核记录与完整周期处理状态展示验证周期', deptName: '测试部门', position: '测试岗位', status,
    totalScore: status === 'indicator_setting' ? null : 92.4, rawGrade: status === 'indicator_setting' ? null : 'B', calibratedGrade: status === 'indicator_setting' ? null : 'A', approvedAt: status === 'approval' ? '2026-09-08T12:00:00.000Z' : null,
    departmentReview: { canReview: status === 'dept_review', latest: latest ? { ...latest, createdAt: '2026-09-08T10:00:00Z' } : null },
  });
  const rows = [
    record('pending', '虚拟待复核成员', 'dept_review'),
    record('approved', '虚拟已通过成员', 'hr_calibration', { action: 'approve', combined: false }),
    record('combined', '虚拟合并办理成员', 'approval', { action: 'approve', combined: true }),
    record('returned', '虚拟已退回成员', 'manager_scoring', { action: 'reject', combined: false }),
    record('not-started', '虚拟尚未开始成员', 'indicator_setting'),
    record('legacy', '虚拟历史无记录成员', 'published'),
  ];
  await page.route('**/api/v1/tasks/department-review*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const status = query.get('status');
    const requestedPage = Number(query.get('page') ?? 1);
    requests.push({ status, page: requestedPage });
    if (status === 'hr_calibration' && options.slowCalibration) await calibrationGate;
    const filtered = status ? rows.filter(row => row.status === status) : rows;
    const total = options.paginated && !status ? 26 : filtered.length;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response({ items: filtered, total, pendingTotal: 1, page: requestedPage, pageSize: 20 })) });
  });
  return { requests, releaseCalibration };
}

for (const width of [1440, 390]) {
  test(`部门复核默认保留全部成员记录并区分办理与当前环节 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setupRecords(page);
    await page.goto('/department-review');
    await expect(page.getByTestId('department-review-pending-total')).toHaveCount(0);
    const resultSurface = width <= 768 ? page.locator('.department-review-mobile-list') : page.getByRole('table').last();
    for (const [name, handling, stage] of [
      ['虚拟待复核成员', '待复核', '部门复核中'],
      ['虚拟已通过成员', '复核通过', '绩效校准中'],
      ['虚拟合并办理成员', '合并复核通过', '待员工确认'],
      ['虚拟已退回成员', '已退回', '直属上级评分中'],
      ['虚拟尚未开始成员', '待开始', '目标制定中'],
      ['虚拟历史无记录成员', '暂无复核记录', '已公示'],
    ]) {
      const row = width <= 768
        ? resultSurface.locator('.mobile-result-card').filter({ hasText: name })
        : resultSurface.getByRole('row').filter({ hasText: name });
      await expect(row).toContainText(handling);
      await expect(row).toContainText(stage);
      await expect(row.getByRole('button', { name: name === '虚拟待复核成员' ? '进入复核' : '查看详情', exact: true })).toBeVisible();
    }
    const notStarted = width <= 768
      ? resultSurface.locator('.mobile-result-card').filter({ hasText: '虚拟尚未开始成员' })
      : resultSurface.getByRole('row').filter({ hasText: '虚拟尚未开始成员' });
    await expect(notStarted).not.toContainText('92.40');
    await expect(notStarted).not.toContainText('复核通过');
    await expect(page.getByRole('button', { name: '进入复核', exact: true })).toHaveCount(1);
    expect(state.requests[0]).toEqual({ status: null, page: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('department-review-all-records.png'), fullPage: true, animations: 'disabled' });
    if (width === 390) {
      await expect(page.locator('.department-review-list .desktop-result-table')).toBeHidden();
      await expect(resultSurface).toBeVisible();
      const actionBox = await resultSurface.getByRole('button', { name: '进入复核', exact: true }).boundingBox();
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath('department-review-mobile-cards.png'), fullPage: true, animations: 'disabled' });
    }
  });
}

test('当前环节筛选重置页码并保留待复核总数，清除后恢复全部记录', async ({ page }) => {
  const state = await setupRecords(page, { paginated: true });
  await page.goto('/department-review');
  await page.locator('.el-pagination .btn-next').click();
  await expect.poll(() => state.requests.at(-1)?.page).toBe(2);
  await page.locator('.performance-record-filter-extra .el-select').click();
  await page.getByRole('option', { name: '绩效校准中', exact: true }).click();
  await expect.poll(() => state.requests.at(-1)).toEqual({ status: 'hr_calibration', page: 1 });
  await expect(page.getByTestId('department-review-pending-total')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '虚拟已通过成员' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '虚拟待复核成员' })).toHaveCount(0);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect.poll(() => state.requests.at(-1)).toEqual({ status: null, page: 1 });
  await expect(page.getByRole('row').filter({ hasText: '虚拟待复核成员' })).toBeVisible();
});

test('切换环节后迟到的旧列表不能覆盖当前筛选结果', async ({ page }) => {
  const state = await setupRecords(page, { slowCalibration: true });
  await page.goto('/department-review');
  await page.locator('.performance-record-filter-extra .el-select').click();
  await page.getByRole('option', { name: '绩效校准中', exact: true }).click();
  await expect.poll(() => state.requests.at(-1)?.status).toBe('hr_calibration');
  await page.locator('.performance-record-filter-extra .el-select').click();
  await page.getByRole('option', { name: '结果审批中', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '虚拟合并办理成员' })).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes('/tasks/department-review') && response.url().includes('hr_calibration'));
  state.releaseCalibration();
  await oldResponse;
  await expect(page.getByRole('row').filter({ hasText: '虚拟合并办理成员' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '虚拟已通过成员' })).toHaveCount(0);
});

test('关闭后切换员工时迟到的旧详情不会串到新抽屉', async ({ page }) => {
  await setupRecords(page);
  let releasePending!: () => void;
  const pendingGate = new Promise<void>(resolve => { releasePending = resolve; });
  const detail = (id: string, employeeName: string, status: string) => ({
    id, cycleId, cycleName: '部门复核回归周期', employeeId: `employee-${id}`, employeeName,
    employeeNo: `E-${id}`, deptName: '测试部门', position: '测试岗位', managerId: 'manager-1', managerName: '虚拟上级',
    deptHeadId: 'head-1', status, approvedAt: null, isExempt: false, workflowVersion: 2, periods: [],
    gradeResult: { calculatedScore: 92.4, rawGrade: 'B', calibratedGrade: null, isPublished: false },
    indicatorInstances: [], flowRecords: [], workflowContext: { stage: 'result', statusLabel: '', currentHandler: null, canRemind: false },
  });
  await page.route('**/api/v1/tasks/pending', async route => {
    await pendingGate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(detail('pending', '虚拟待复核成员', 'dept_review'))) });
  });
  await page.route('**/api/v1/tasks/approved', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response(detail('approved', '虚拟已通过成员', 'hr_calibration'))),
  }));
  await page.route('**/api/v1/tasks/approved/final-grade', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({
      taskId: 'approved', cycleId, cycleName: '部门复核回归周期', employeeName: '虚拟已通过成员', status: 'hr_calibration',
      deptName: '测试部门', position: '测试岗位', managerName: '虚拟上级', calculatedScore: 92.4, currentGrade: 'B',
      canSubmit: false, allPeriodsComplete: true, latestReject: null, flowRecords: [], periods: [],
    })),
  }));

  await page.goto('/department-review');
  await page.getByRole('row').filter({ hasText: '虚拟待复核成员' }).getByRole('button', { name: '进入复核', exact: true }).click();
  await page.getByTestId('department-review-detail-drawer').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '虚拟已通过成员' }).getByRole('button', { name: '查看详情', exact: true }).click();
  const drawer = page.getByTestId('department-review-detail-drawer');
  await expect(drawer.getByTestId('performance-result-summary')).toContainText('虚拟已通过成员');
  releasePending();
  await expect(drawer.getByTestId('performance-result-summary')).toContainText('虚拟已通过成员');
  await expect(drawer).not.toContainText('虚拟待复核成员');
});

test('员工公示前不能看到复核操作及未公示结果', async ({ page }) => {
  await setup(page, 'employee');
  await page.goto('/tasks/' + taskId + '?stage=result');
  await expect(page.getByText('虚拟员工甲', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('department-review-workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
  await expect(page.getByText('92.40', { exact: true })).toHaveCount(0);
});

test('部门负责人查看本人任务时仍遵守员工公示边界', async ({ page }) => {
  await setup(page, 'employee-head');
  await page.goto('/tasks/' + taskId + '?stage=result');
  await expect(page.getByText('虚拟员工甲', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('department-review-workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
  await expect(page.getByText('92.40', { exact: true })).toHaveCount(0);
});

test('没有部门复核记录的上级评分任务不能显示已退回', async ({ page }) => {
  await setup(page, 'head', { status: 'manager_scoring' });
  await page.goto('/tasks/' + taskId + '?stage=result&returnTo=/department-review');
  const workspace = page.getByTestId('department-review-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByTestId('review-history')).toContainText('周期交付稳定，建议加强协作。');
  await expect(workspace).not.toContainText('已退回直属上级重新评定');
  await expect(workspace.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
});

test('没有部门复核记录的校准任务只显示真实当前环节', async ({ page }) => {
  await setup(page, 'head', { status: 'hr_calibration' });
  await page.goto('/tasks/' + taskId + '?stage=result&returnTo=/department-review');
  const workspace = page.getByTestId('department-review-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('当前已进入绩效校准。');
  await expect(workspace).not.toContainText('部门复核已通过');
  await expect(workspace.getByRole('button', { name: '复核通过', exact: true })).toHaveCount(0);
});
