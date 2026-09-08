import { expect, test, type Page } from '@playwright/test';
import type { PeriodReviewDetail } from '../../src/types/api.types';

const cycleId = '11111111-1111-4111-8111-111111111111';
const cycleName = '2026 Q3 季度考核（跨月评分与连续处理验收计划）';
const augustId = '33333333-3333-4333-8333-333333333333';
const septemberId = '44444444-4444-4444-8444-444444444444';
const taskId = 'task-period-context';

function review(id: string, month: number, employeeTaskId = taskId): PeriodReviewDetail {
  return {
    period: { id, taskId: employeeTaskId, periodKey: `2026-0${month}`, periodType: 'month', status: 'manager_scoring',
      periodStart: `2026-0${month}-01`, periodEnd: `2026-0${month}-30`,
      selfEvalOpenAt: `2026-0${month}-28T10:00:00.000Z`, selfEvalDueAt: `2026-0${month}-30T10:00:00.000Z`,
      managerDueAt: month === 8 ? '2026-09-10T10:00:00.000Z' : '2026-10-10T10:00:00.000Z',
      employeeSubmittedAt: `2026-0${month}-30T08:00:00.000Z`, managerSubmittedAt: null,
      selfScoreTotal: month === 8 ? 81 : 92, managerScoreTotal: null, selfGrade: 'B', managerGrade: 'B', draftVersion: 2 },
    context: { cycleName, employeeName: employeeTaskId === taskId ? '虚拟员工甲' : '虚拟员工乙', employeeNo: 'MOCK', deptName: '测试部', managerName: '虚拟主管', statusLabel: '主管评分' },
    permissions: { canEditEmployee: false, canEditManager: true },
    indicators: [{ indicatorVersionItemId: `item-${month}`, sourceInstanceId: `source-${month}`, name: `${month}月交付`, description: '按月核验交付成果',
      scoringStandard: '按实际交付评分', targetValue: 100, targetValueText: '100%', unit: '%', weight: 1, isScoreRequired: true,
      monthlyProgressSource: 'draft_or_result', progress: month * 10, healthStatus: 'on_track', actualValueText: null,
      employeeComment: `${month}月员工描述`, problemReason: null, nextMonthPlan: null, supportNeeded: null, attachments: [],
      selfScore: month === 8 ? 81 : 92, managerScore: 85, managerComment: '', latestProgress: null, progressReferences: [], alignedObjectives: [], history: [] }],
  };
}

async function mockTeam(page: Page, options: { explicitPeriod?: boolean; slowFirst?: boolean; wholeCycle?: boolean; finished?: boolean; finishOnSubmit?: boolean; includeFinishedInTeam?: boolean; finalStatus?: 'dept_review' | 'hr_calibration'; reviewerName?: string | null } = {}) {
  const finalStatus = options.finalStatus ?? 'dept_review';
  const august = review(augustId, 8);
  const july = review('55555555-5555-4555-8555-555555555555', 7);
  const september = review(septemberId, 9, options.slowFirst ? 'task-second' : taskId);
  if (options.wholeCycle) { august.period.periodType = 'cycle'; august.period.periodKey = '2026-Q3'; }
  let current = august;
  let finished = Boolean(options.finished);
  let finalSubmitted = false;
  let finalComment: string | null = null;
  if (finished) for (const item of [july, august, september]) { item.period.status = 'completed'; item.period.managerSubmittedAt = '2026-09-08T10:00:00.000Z'; item.permissions.canEditManager = false; }
  const writes: Array<{ path: string; body: any }> = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstStarted = false;
  const teamItem = (detail: PeriodReviewDetail) => ({
    id: detail.period.taskId, cycleId, cycleName, employeeId: detail.period.taskId, employeeName: detail.context.employeeName,
    employeeNo: 'MOCK', deptId: 'test-dept', deptName: '测试部', managerId: 'manager', status: finalSubmitted ? finalStatus : 'manager_scoring',
    stageState: finalSubmitted ? 'completed' : finished || detail.permissions.canEditManager ? 'pending' : 'not_started', totalScore: null, rawGrade: null,
    updatedAt: '2026-09-08T10:00:00.000Z', avatarUrl: null, position: '测试岗位', periodReview: detail.period,
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-manager-period-context');
    localStorage.setItem('expiresAt', String(Date.now() + 3_600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = [];
    if (request.method() === 'POST') {
      writes.push({ path, body: request.postDataJSON() });
      if (path.endsWith('/final-grade')) {
        finalSubmitted = true;
        finalComment = request.postDataJSON().comment?.trim() || null;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { taskId, status: finalStatus } }) });
        return;
      }
      const returned = path.endsWith('/manager-return');
      august.period.status = returned ? 'self_eval' : 'completed';
      august.permissions.canEditManager = false;
      august.context.statusLabel = returned ? '员工自评中' : '月度评分已完成';
      if (returned) { august.period.employeeSubmittedAt = null; august.period.managerGrade = null; }
      current = options.explicitPeriod || options.wholeCycle ? august : september;
      if (options.finishOnSubmit && !returned) {
        finished = true;
        for (const item of [july, august, september]) { item.period.status = 'completed'; item.period.managerSubmittedAt = '2026-09-08T10:00:00.000Z'; item.permissions.canEditManager = false; }
      }
      data = { periodId: augustId, status: august.period.status, draftVersion: 3, savedAt: '2026-09-08T10:00:00.000Z' };
    } else if (path.endsWith('/auth/me')) data = { id: 'manager', name: '虚拟主管', sysRole: 'manager', businessCapabilities: { canManageTeam: true } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/cycles/mine')) data = [{ id: cycleId, name: cycleName, type: 'quarterly', status: 'manager_score', startDate: '2026-07-01', endDate: '2026-09-30' }];
    else if (path.endsWith('/tasks/team')) data = {
      items: finished && !options.includeFinishedInTeam ? [] : options.slowFirst ? [teamItem(august), teamItem(september)] : [teamItem(current)],
      total: options.slowFirst ? 2 : 1, page: 1, pageSize: 20,
      counts: { all: 1, pending: finalSubmitted ? 0 : 1, completed: finalSubmitted ? 1 : 0, notStarted: 0, exempted: 0 }, facets: { employees: [], departments: [] },
    };
    else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0, page: 1, pageSize: 100 };
    else if (path.endsWith(`/tasks/${taskId}/final-grade`)) data = {
      taskId, cycleId, cycleName, employeeName: '虚拟员工甲', deptName: '测试部', position: '测试岗位', managerName: '虚拟主管',
      status: finalSubmitted ? finalStatus : 'manager_scoring', currentGrade: finalSubmitted ? 'B' : null, calculatedScore: 84.33, comment: finalComment,
      allPeriodsComplete: true, canSubmit: !finalSubmitted, latestReject: null,
      departmentReview: { combined: finalStatus === 'hr_calibration', reviewerName: options.reviewerName === undefined ? finalStatus === 'hr_calibration' ? '虚拟主管' : '虚拟部门负责人' : options.reviewerName },
      periods: [
        { periodKey: '2026-07', periodType: 'month', status: 'completed', selfScoreTotal: 78, managerScoreTotal: 80, selfGrade: 'B', managerGrade: 'B' },
        { periodKey: '2026-08', periodType: 'month', status: 'completed', selfScoreTotal: 81, managerScoreTotal: 85, selfGrade: 'B', managerGrade: 'B' },
        { periodKey: '2026-09', periodType: 'month', status: 'completed', selfScoreTotal: 92, managerScoreTotal: 88, selfGrade: 'A', managerGrade: 'B' },
      ],
    };
    else if (path.endsWith(`/tasks/${taskId}`)) data = {
      id: taskId, cycleId, cycleName, employeeId: taskId, employeeName: '虚拟员工甲', employeeNo: 'MOCK', managerId: 'manager', managerName: '虚拟主管',
      workflowVersion: 2, status: finalSubmitted ? finalStatus : 'manager_scoring', isExempt: false, deptName: '测试部',
      managerStageState: finalSubmitted ? 'completed' : finished ? 'pending' : 'not_started',
      periods: (finished ? [july, august, september] : [august, september]).map((item, index) => ({ ...item.period, sequence: index + 1 })), indicatorInstances: [], flowRecords: [],
    };
    else if (path.endsWith(`/assessment-periods/${augustId}/review`)) {
      if (options.slowFirst) { firstStarted = true; await firstGate; }
      data = august;
    } else if (path.endsWith(`/assessment-periods/${septemberId}/review`)) data = september;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
  });
  await page.goto(`/tasks?scope=team&stage=manager-eval&cycleId=${cycleId}&taskId=${taskId}${options.explicitPeriod ? `&periodId=${augustId}` : ''}`);
  return { writes, releaseFirst, firstStarted: () => firstStarted };
}

for (const [finalStatus, label] of [['dept_review', '部门复核'], ['hr_calibration', '绩效校准']] as const) {
  test(`周期评定提交后按实际流转状态提示${label}`, async ({ page }) => {
    const state = await mockTeam(page, { finished: true, includeFinishedInTeam: true, finalStatus });
    const results = page.getByTestId('manager-period-results');
    await results.getByLabel('整周期最终等级 B', { exact: true }).click();
    await results.getByRole('button', { name: '提交评定', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByText(`整周期结果评定已提交，已进入${label}。`, { exact: true })).toBeVisible();
    await expect(results.getByTestId('cycle-current-stage')).toContainText(label);
    await page.reload();
    await expect(results.getByTestId('cycle-current-stage')).toContainText(label);
    expect(state.writes).toHaveLength(1);
  });
}

for (const width of [1440, 390]) {
  for (const finalStatus of ['dept_review', 'hr_calibration'] as const) {
    test(`周期评定确认弹窗说明复核职责，按钮与标题保持简洁 ${finalStatus} ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await mockTeam(page, { finished: true, includeFinishedInTeam: true, finalStatus });
      const results = page.getByTestId('manager-period-results');
      await expect(results).not.toContainText('合并完成部门复核');
      await expect(results).not.toContainText('虚拟部门负责人');
      await results.getByLabel('整周期最终等级 B', { exact: true }).click();
      await results.getByRole('button', { name: '提交评定', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '提交整周期结果评定', exact: true });
      await expect(dialog).toBeVisible();
      if (finalStatus === 'hr_calibration') {
        await expect(dialog).toContainText('绩效直属上级与部门负责人为同一人');
        await expect(dialog).toContainText('合并完成部门复核');
        await expect(dialog).toContainText('进入绩效校准');
      } else {
        await expect(dialog).toContainText('虚拟部门负责人');
        await expect(dialog).toContainText('部门复核');
        await expect(dialog).not.toContainText('合并完成部门复核');
      }
      expect(state.writes).toHaveLength(0);
      const dialogBox = await dialog.locator('.el-message-box').boundingBox();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('cycle-review-confirmation.png'), fullPage: true, animations: 'disabled' });
      await dialog.getByRole('button', { name: '再想想', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(state.writes).toHaveLength(0);
      await results.getByRole('button', { name: '提交评定', exact: true }).click();
      await dialog.getByRole('button', { name: '提交', exact: true }).click();
      await expect.poll(() => state.writes.length).toBe(1);
      expect(state.writes[0]).toEqual({ path: `/api/v1/tasks/${taskId}/final-grade`, body: { grade: 'B', comment: '' } });
    });
  }
}

test('缺少冻结复核人姓名时确认弹窗不虚构办理人', async ({ page }) => {
  await mockTeam(page, { finished: true, finalStatus: 'dept_review', reviewerName: null });
  const results = page.getByTestId('manager-period-results');
  await results.getByLabel('整周期最终等级 B', { exact: true }).click();
  await results.getByRole('button', { name: '提交评定', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('进入部门复核');
  await expect(dialog).not.toContainText('虚拟部门负责人');
  await expect(dialog).not.toContainText('合并完成部门复核');
});

for (const width of [1440, 390]) {
  test(`退回后明确所属周期和当前月份，标题数据截止时间同步切换 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockTeam(page);
    const bar = page.getByTestId('manager-review-period-bar');
    await expect(bar.getByText(`所属周期：${cycleName}`, { exact: true })).toBeVisible();
    await expect(bar).toContainText('2026年8月直属上级月度评分');
    await page.getByRole('button', { name: '退回员工补充', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(cycleName);
    await expect(dialog).toContainText('2026年8月');
    await dialog.getByRole('button', { name: '确认退回', exact: true }).click();
    await expect(bar).toContainText('2026年9月直属上级月度评分');
    await expect(bar).toContainText('2026/10/10');
    await expect(bar).not.toContainText('2026/9/10');
    await expect(page.getByTestId('manager-review-self-total')).toHaveText('92');
    await expect(page.getByTestId('manager-review-goal-card')).toContainText('9月员工描述');
    await expect(page.getByTestId('manager-period-action-notice')).toHaveText('2026年8月已退回员工补充；已切换至2026年9月评分。');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.path).toContain(`${augustId}/manager-return`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(dialog).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('period-context-after-return.png'), fullPage: true });
  });
}

test('提交提示说明已评分月份及接续月份，提交数据仍属于原月份', async ({ page }) => {
  const state = await mockTeam(page);
  await page.getByRole('button', { name: '提交评分', exact: true }).click();
  await expect(page.getByTestId('manager-period-action-notice')).toHaveText('2026年8月评分已提交；已切换至2026年9月评分。');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: `/api/v1/assessment-periods/${augustId}/manager-submit`, body: { indicators: [{ indicatorVersionItemId: 'item-8', managerScore: 85 }] } });
});

test('明确指定月份退回后仍展示原月份并关闭评分操作', async ({ page }) => {
  await mockTeam(page, { explicitPeriod: true });
  await page.getByRole('button', { name: '退回员工补充', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认退回', exact: true }).click();
  await expect(page.getByTestId('manager-review-period-bar')).toContainText('2026年8月直属上级月度评分');
  await expect(page.getByTestId('manager-review-actions')).toHaveCount(0);
  await expect(page.getByTestId('manager-period-action-notice')).toHaveText('2026年8月已退回员工补充，等待员工重新提交。');
});

test('整周期提示保持整周期含义，不伪造月份切换', async ({ page }) => {
  await mockTeam(page, { wholeCycle: true, explicitPeriod: true });
  await page.getByRole('button', { name: '提交评分', exact: true }).click();
  await expect(page.getByTestId('manager-review-period-bar')).toContainText(cycleName);
  await expect(page.getByTestId('manager-period-action-notice')).toHaveText('整周期评分已提交。');
});

test('切换员工时迟到的旧月份响应不得覆盖新月份', async ({ page }) => {
  const state = await mockTeam(page, { slowFirst: true });
  await expect.poll(state.firstStarted).toBe(true);
  await page.getByTestId('team-task-row-task-second').click();
  await expect(page.getByTestId('manager-review-period-bar')).toContainText('2026年9月');
  const oldResponse = page.waitForResponse(response => response.url().endsWith(`${augustId}/review`));
  state.releaseFirst();
  await oldResponse;
  await expect(page.getByTestId('manager-review-period-bar')).toContainText('2026年9月');
  await expect(page.getByTestId('manager-review-goal-card')).toContainText('9月员工描述');
  await expect(page.getByText('该月份不属于当前员工的绩效任务', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`全部月度完成后补载任务仍显示月度评分回顾，禁止回落旧评分表单 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockTeam(page, { finished: true });
    await expect(page.getByTestId(`team-task-row-${taskId}`)).toContainText('待周期结果评定');
    const results = page.getByTestId('manager-period-results');
    await expect(results).toBeVisible();
    await expect(results).toContainText(cycleName);
    await expect(results).toContainText('月度结果回顾');
    await expect(results.getByTestId('cycle-result-score')).toHaveText('84.33分');
    await expect(results).toContainText('3个月的直属上级评分取平均');
    await expect(results.getByText('全部月度评分完成后才能提交整周期结果评定', { exact: true })).toHaveCount(0);
    await expect(results.locator('.grade-option--active')).toHaveCount(0);
    for (const value of ['81.00', '85.00', '92.00', '88.00']) await expect(results.getByText(value, { exact: true })).toBeVisible();
    const managerScoreBox = await results.getByText('88.00', { exact: true }).boundingBox();
    expect(managerScoreBox!.x + managerScoreBox!.width).toBeLessThanOrEqual(width);
    await expect(page.getByTestId('manager-evaluation-workspace')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.writes).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('monthly-results-complete.png'), fullPage: true });
    await results.getByLabel('整周期最终等级 B', { exact: true }).click();
    await results.getByRole('button', { name: '提交评定', exact: true }).click();
    expect(state.writes).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: '提交', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual({ path: `/api/v1/tasks/${taskId}/final-grade`, body: { grade: 'B', comment: '' } });
  });
}

test('最后一月提交后直接进入月度结果回顾而非空白旧表单', async ({ page }) => {
  const state = await mockTeam(page, { finishOnSubmit: true });
  await page.getByRole('button', { name: '提交评分', exact: true }).click();
  await expect(page.getByTestId('manager-period-results')).toContainText('月度结果回顾');
  await expect(page.getByTestId('manager-evaluation-workspace')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

for (const width of [1440, 390]) {
  test(`周期评定保持待办，ABCD等级和评语提交后回显并完成任务 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockTeam(page, { finished: true, includeFinishedInTeam: true });
    await page.goto('/');
    await expect(page.getByTestId('manager-evaluation-count')).toHaveText('1');
    await page.getByTestId('manager-evaluation-open').click();
    await page.getByTestId('team-task-list').getByRole('button', {name:'处理 虚拟员工甲',exact:true}).click();
    await expect(page.getByTestId(`team-task-row-${taskId}`)).toContainText('待周期结果评定');
    await expect(page.getByTestId('manager-evaluation-pending-count')).toHaveText('1 人待处理');
    await page.getByTestId('team-task-workspace-back').click();
    await expect(page.getByTestId('team-count-pending')).toContainText('1');
    await expect(page.getByTestId('manager-team-stage-manager-eval')).toContainText('待处理 1');
    await expect(page.getByTestId('team-task-list')).toContainText('待周期结果评定');
    await page.getByTestId('team-task-list').getByRole('button', {name:'处理 虚拟员工甲',exact:true}).click();
    const results = page.getByTestId('manager-period-results');
    const grades = results.locator('.grade-tag');
    await expect(grades.first()).toBeVisible();
    for (const label of await grades.allTextContents()) expect(label.trim()).toMatch(/^[ABCD]$/);
    for (const grade of ['A','B','C','D']) await expect(results.getByLabel(`整周期最终等级 ${grade}`, {exact:true})).toHaveText(grade);
    await results.getByLabel('整周期最终等级 B', {exact:true}).click();
    const comment = '本周期稳定完成交付。\n下周期加强协作和风险预警。';
    await results.getByRole('textbox', {name:'周期评语'}).fill(comment);
    await results.getByRole('button', {name:'提交评定',exact:true}).click();
    await page.getByRole('dialog').getByRole('button', {name:'提交',exact:true}).click();
    await expect(results.getByTestId('cycle-comment-readonly')).toHaveText(comment);
    await expect(page.getByTestId('manager-evaluation-pending-count')).toHaveText('0 人待处理');
    await expect(page.getByTestId(`team-task-row-${taskId}`)).toContainText('已完成');
    expect(state.writes).toEqual([{ path:`/api/v1/tasks/${taskId}/final-grade`, body:{grade:'B',comment} }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('cycle-grade-comment-completed.png'),fullPage:true});
    await page.getByTestId('team-task-workspace-back').click();
    await expect(page.getByTestId('team-count-completed')).toContainText('1');
    await expect(page.getByTestId('team-count-pending')).toContainText('0');
    await page.goto('/');
    await expect(page.getByTestId('manager-evaluation-count')).toHaveText('0');
  });
}
