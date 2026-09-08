import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173' });

const approvalCycleA = 'history-cycle-a';
const approvalCycleB = 'history-cycle-b';

async function mockApprovalHistory(page: Page, options: { failFirstDetail?: boolean; slowDetail?: boolean; slowCycle?: boolean } = {}) {
  const calls: Array<{ path: string; method: string }> = [];
  const cycles = [approvalCycleA, approvalCycleB].map((id, index) => ({
    id, name: index ? '审批历史周期乙' : '审批历史周期甲', status: 'approval', type: 'quarterly',
    startDate: '2026-07-01', endDate: '2026-09-30',
  }));
  let releaseDetail!: () => void;
  let releaseCycle!: () => void;
  const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
  const cycleGate = new Promise<void>((resolve) => { releaseCycle = resolve; });
  let detailAttempts = 0;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-approval-history');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    calls.push({ path, method });
    if (method !== 'GET') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ code: 405, message: '只读验收禁止写入' }) });
      return;
    }
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = {
      id: 'history-approver', name: '虚拟审批人', sysRole: 'employee', status: 'active', canViewAll: false,
      businessCapabilities: { canViewPerformanceApproval: true, canOperatePerformanceApproval: true, identities: [] },
    };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/cycles')) data = { items: cycles, total: 2 };
    else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    else if (path.includes('/approval')) {
      const cycleId = path.includes(approvalCycleB) ? approvalCycleB : approvalCycleA;
      if (options.slowCycle && cycleId === approvalCycleA) await cycleGate;
      if (path.endsWith('/overview')) data = {
        ownPending: 2, ownTotal: 2, cyclePending: 2, rejects: [],
        gradeDistribution: Object.fromEntries(['A', 'B', 'C', 'D'].map((grade) => [grade, { count: grade === 'B' ? 2 : 0, ratio: 0, maxRatio: 1, isOverLimit: false }])),
      };
      else data = [
        { id: `task-${cycleId}-first`, employeeId: 'employee-first', employeeName: cycleId === approvalCycleA ? '虚拟员工甲' : '虚拟员工乙', totalScore: 86 },
        { id: `task-${cycleId}-second`, employeeId: 'employee-second', employeeName: '虚拟员工丙', totalScore: null },
        { id: `task-${cycleId}-self`, employeeId: 'history-approver', employeeName: '虚拟审批人', totalScore: null, rawGrade: null, approverId: 'other-approver' },
      ].map((row) => ({ cycleId, status: 'approval', approverId: 'history-approver', approvedAt: row.id.endsWith('-first') ? '2026-09-06T14:00:00.000Z' : null, rawGrade: 'B', isVeto: false, ...row }));
    } else if (path.startsWith('/api/v1/tasks/task-')) {
      const taskId = path.split('/').at(-1)!;
      const firstTask = taskId === `task-${approvalCycleA}-first`;
      if (firstTask) {
        detailAttempts++;
        if (options.slowDetail) await detailGate;
        if (options.failFirstDetail && detailAttempts === 1) {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 503, message: '历史意见暂时无法读取' }) });
          return;
        }
      }
      const cycleId = taskId.includes(approvalCycleB) ? approvalCycleB : approvalCycleA;
      const employeeName = taskId.endsWith('second') ? '虚拟员工丙' : cycleId === approvalCycleA ? '虚拟员工甲' : '虚拟员工乙';
      data = {
        id: taskId, cycleId, cycleName: cycles.find((cycle) => cycle.id === cycleId)!.name,
        employeeId: 'employee-other', employeeName, status: 'approval', approvedAt: firstTask ? '2026-09-06T14:00:00.000Z' : null, deptName: '验收部门', managerName: '虚拟直属上级', indicatorInstances: [],
        gradeResult: { calculatedScore: taskId.endsWith('second') ? null : 86, rawGrade: 'B', calibratedGrade: 'A' },
        flowRecords: [
          { id: 'cycle-grade', nodeType: 'manager_score', action: 'submit', actorName: '虚拟直属上级', createdAt: '2026-09-06T10:00:00.000Z', comment: '周期评定提交', extraData: { type: 'final_grade_submitted', comment: `${employeeName}的周期评语：稳定交付。` } },
          { id: 'department', nodeType: 'dept_review', action: 'approve', actorName: '虚拟部门复核人', createdAt: '2026-09-06T11:00:00.000Z', comment: '部门复核意见：成果依据完整。' },
          { id: 'calibration', nodeType: 'hr_calibration', action: 'submit', actorName: '虚拟周期负责人', createdAt: '2026-09-06T12:00:00.000Z', comment: '校准意见：同意提交审批。' },
          { id: 'approval', nodeType: 'approval', action: 'reject', actorName: '虚拟审批人', createdAt: '2026-09-06T13:00:00.000Z', comment: '历史审批意见：请补充交付依据。' },
        ],
      };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return { calls, releaseDetail, releaseCycle };
}

function approvalHistoryRow(page: Page, employeeName: string) {
  return page.locator('.el-table__body tr').filter({ hasText: employeeName });
}

for (const width of [1440, 390]) {
  test(`审批详情只读显示关键节点意见并隔离本人未公示结果 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await mockApprovalHistory(page);
    await page.goto(`/approval?cycleId=${approvalCycleA}`);
    await expect(approvalHistoryRow(page, '虚拟审批人').getByRole('button', { name: '详情', exact: true })).toHaveCount(0);
    await expect(approvalHistoryRow(page, '虚拟员工丙')).toContainText('—');
    await approvalHistoryRow(page, '虚拟员工甲').getByRole('button', { name: '详情', exact: true }).click();
    const drawer = page.getByTestId('approval-detail-drawer');
    await expect(drawer).toBeVisible();
    const summary = drawer.getByTestId('performance-result-summary');
    await expect(summary).toContainText('虚拟员工甲');
    await expect(summary).toContainText('审批历史周期甲');
    await expect(summary).toContainText('已通过，待公示');
    await expect(summary).toContainText('86.00');
    await expect(summary.getByText('B', { exact: true })).toBeVisible();
    await expect(summary.getByText('A', { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: '查看全部 4 条记录', exact: true }).click();
    for (const text of ['虚拟员工甲', '审批历史周期甲', '86.00', '虚拟员工甲的周期评语：稳定交付。', '部门复核意见：成果依据完整。', '校准意见：同意提交审批。', '历史审批意见：请补充交付依据。']) {
      await expect(drawer).toContainText(text);
    }
    await expect(drawer.getByRole('button', { name: /^(通过|退回)$/ })).toHaveCount(0);
    const enteringGeometry = await drawer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, transform: getComputedStyle(element).transform };
    });
    await drawer.evaluate(async (element) => {
      const animations = element.parentElement?.getAnimations({ subtree: true }) ?? [];
      await Promise.all(animations.filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)));
    });
    const geometry = await drawer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const textStarts = [...element.querySelectorAll('.el-drawer__title, .review-history h3, .review-history li p')].map((textElement) => {
        const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
        let textNode: Node | null = walker.nextNode();
        while (textNode && !textNode.textContent?.trim()) textNode = walker.nextNode();
        const range = document.createRange();
        const start = textNode?.textContent?.search(/\S/) ?? 0;
        range.setStart(textNode!, start);
        range.setEnd(textNode!, start + 1);
        return { text: textElement.textContent, left: range.getBoundingClientRect().left };
      });
      return { left: bounds.left, right: bounds.right, width: bounds.width, viewport: innerWidth, textStarts };
    });
    await testInfo.attach('approval-drawer-geometry', { body: JSON.stringify({ entering: enteringGeometry, settled: geometry }, null, 2), contentType: 'application/json' });
    expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    for (const firstCharacter of geometry.textStarts) expect(firstCharacter.left, firstCharacter.text ?? '').toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(state.calls.some((call) => call.path.endsWith('-self'))).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('approval-review-history.png'), fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: `../tmp/qa-review-history-20260908/approval-history-${width}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('审批详情读取失败有明确错误和重试入口', async ({ page }) => {
  const state = await mockApprovalHistory(page, { failFirstDetail: true });
  await page.goto(`/approval?cycleId=${approvalCycleA}`);
  await approvalHistoryRow(page, '虚拟员工甲').getByRole('button', { name: '详情', exact: true }).click();
  const drawer = page.getByTestId('approval-detail-drawer');
  await expect(drawer).toContainText('历史意见暂时无法读取');
  await drawer.getByRole('button', { name: '重试', exact: true }).click();
  await drawer.getByRole('button', { name: '查看全部 4 条记录', exact: true }).click();
  await expect(drawer).toContainText('虚拟员工甲的周期评语：稳定交付。');
  expect(state.calls.filter((call) => call.path.endsWith(`task-${approvalCycleA}-first`))).toHaveLength(2);
});

test('审批详情切换员工后忽略前一员工迟到的响应', async ({ page }) => {
  const state = await mockApprovalHistory(page, { slowDetail: true });
  await page.goto(`/approval?cycleId=${approvalCycleA}`);
  await approvalHistoryRow(page, '虚拟员工甲').getByRole('button', { name: '详情', exact: true }).click();
  await expect.poll(() => state.calls.some((call) => call.path.endsWith(`task-${approvalCycleA}-first`))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('approval-detail-drawer')).toBeHidden();
  await approvalHistoryRow(page, '虚拟员工丙').getByRole('button', { name: '详情', exact: true }).click();
  const drawer = page.getByTestId('approval-detail-drawer');
  await drawer.getByRole('button', { name: '查看全部 4 条记录', exact: true }).click();
  await expect(drawer).toContainText('虚拟员工丙的周期评语：稳定交付。');
  const late = page.waitForResponse((response) => response.url().endsWith(`task-${approvalCycleA}-first`));
  state.releaseDetail();
  await late;
  await expect(drawer).toContainText('虚拟员工丙的周期评语：稳定交付。');
  await expect(drawer).not.toContainText('虚拟员工甲');
});

test('审批切换周期后忽略前一周期迟到的任务名单', async ({ page }) => {
  const state = await mockApprovalHistory(page, { slowCycle: true });
  await page.goto(`/approval?cycleId=${approvalCycleA}`);
  await expect.poll(() => state.calls.some((call) => call.path === `/api/v1/cycles/${approvalCycleA}/approval`)).toBe(true);
  await page.getByTestId('approval-cycle-select').click();
  await page.getByRole('option', { name: '审批历史周期乙', exact: true }).click();
  await expect(approvalHistoryRow(page, '虚拟员工乙')).toBeVisible();
  const late = page.waitForResponse((response) => response.url().endsWith(`/cycles/${approvalCycleA}/approval/overview`));
  state.releaseCycle();
  await late;
  await expect(approvalHistoryRow(page, '虚拟员工乙')).toBeVisible();
  await expect(approvalHistoryRow(page, '虚拟员工甲')).toHaveCount(0);
  await approvalHistoryRow(page, '虚拟员工乙').getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.getByTestId('approval-detail-drawer')).toContainText('审批历史周期乙');
});
