import { expect, test, type Page } from '@playwright/test';

const cycleId = '11111111-1111-4111-8111-111111111111';
const periodId = '21111111-1111-4111-8111-111111111111';
const september = { id: 'sep', businessPeriodKey: '2026-09', progress: 80, healthStatus: 'on_track', content: '九月交付保持正常', source: 'active_progress', updatedAt: '2026-09-08T08:00:00.000Z', attachments: [] };
const july = { ...september, id: 'jul', businessPeriodKey: '2026-07', progress: 20, healthStatus: 'at_risk', content: '七月原始进展', updatedAt: '2026-07-20T08:00:00.000Z' };
const references = [
  { id: 'july-latest', periodKey: '2026-07', progress: 65, healthStatus: 'blocked', content: '七月补录最新结果：已完成主体交付，等待客户补充验收材料。'.repeat(4), attachments: [], createdAt: '2026-09-08T08:00:00.000Z' },
  { id: 'july-older', periodKey: '2026-07', progress: 20, healthStatus: 'at_risk', content: '七月早期记录：供应存在风险', attachments: [], createdAt: '2026-07-20T08:00:00.000Z' },
  { id: 'september', periodKey: '2026-09', progress: 80, healthStatus: 'on_track', content: '九月进展，仅供跨月参考', attachments: [], createdAt: '2026-09-08T07:00:00.000Z' },
  { id: 'outside', periodKey: '2026-06', progress: 10, healthStatus: 'on_track', content: '周期外记录，仅供参考', attachments: [], createdAt: '2026-06-30T07:00:00.000Z' },
];
const expectedMonthlyDescription = `${references[1].content}\n\n${references[0].content}`;

async function mockApp(page: Page, options: { review?: boolean; readonly?: boolean; cycle?: boolean; empty?: boolean; julyEmpty?: boolean; septemberLocked?: boolean; trackingCycle?: boolean; records?: typeof references } = {}) {
  const writes: Array<{ endpoint: string; body: any }> = [];
  let updates = options.julyEmpty ? [september] : [september, july];
  const period = {
    id: periodId, taskId: 'task-1', periodKey: options.cycle ? '2026-Q3' : '2026-07', periodType: options.cycle ? 'cycle' : 'month', sequence: 1,
    periodStart: '2026-07-01', periodEnd: options.cycle ? '2026-09-30' : '2026-07-31',
    status: options.readonly ? 'manager_scoring' : 'self_eval', selfEvalOpenAt: '2026-07-01T00:00:00.000Z',
    selfEvalDueAt: '2026-10-03T10:00:00.000Z', managerDueAt: '2026-10-08T10:00:00.000Z',
    employeeSubmittedAt: options.readonly ? '2026-09-01T08:00:00.000Z' : null, managerSubmittedAt: null,
    selfScoreTotal: 91, managerScoreTotal: null, selfGrade: 'B', managerGrade: null, draftVersion: 3,
  };
  const trackingItem = () => ({
    id: 'indicator-1', title: '完成虚拟项目交付', taskId: 'task-1', ownerId: 'employee-1', ownerName: '虚拟员工', cycleId,
    cycleName: '季度测试计划', status: 'active', progress: 80, weight: 100, description: '按期完成交付', scoringStandard: '达到既定验收标准',
    alignedObjectives: [], visibilityScope: 'supervisors', dimensionName: '工作目标', latestProgress: september,
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-monthly-reference-ui');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  // Catch every API request: this suite must never reach a business database.
  await page.route('**/api/v1/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      const body = route.request().postDataJSON();
      writes.push({ endpoint, body });
      if (endpoint.endsWith('/indicators/indicator-1/progress')) {
        const created = { ...(body.periodId ? july : september), ...body, id: 'new-progress', updatedAt: '2026-09-08T09:00:00.000Z' };
        updates = body.periodId ? [september, created, july] : [created, september, july];
        data = created;
      } else data = { periodId, status: period.status, draftVersion: 4, savedAt: '2026-09-08T09:00:00.000Z' };
    } else if (endpoint.endsWith('/auth/me')) data = { id: 'employee-1', name: '虚拟员工', deptId: 'dept-1', deptName: '测试部', sysRole: 'employee', canViewAll: false, isAssessorOnly: false };
    else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint.endsWith('/cycles/tracking-contexts')) data = [{
      id: cycleId, name: '季度测试计划', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30', scoringFrequency: 'cycle', openedAt: '2026-07-01T00:00:00Z',
      task: { id: 'task-1', status: 'goal_confirmed', isExempt: false, participantDisposition: 'active' }, periods: [],
    }];
    else if (endpoint.endsWith('/objectives/tracking')) data = { taskId: 'task-1', taskStatus: 'goal_confirmed', canEdit: true, totalWeight: 100, items: [trackingItem()], summary: { periodCount: 3, employeeSubmittedCount: 1, managerCompletedCount: 0, activeBusinessPeriodKey: '2026-09', activeUpdatedGoalCount: 1, goalCount: 1 } };
    else if (endpoint.endsWith('/indicators/indicator-1')) data = {
      ...trackingItem(), canEdit: true, activeBusinessPeriodKey: '2026-09', progressUpdates: updates, changeRecords: [], selfEvaluationResults: [],
      progressPeriods: options.trackingCycle ? [] : [
        { id: 'period-july', periodKey: '2026-07', canEdit: true, reason: null },
        { id: 'period-august', periodKey: '2026-08', canEdit: false, reason: '本月自评已提交' },
        { id: 'period-september', periodKey: '2026-09', canEdit: !options.septemberLocked, reason: options.septemberLocked ? '本月自评已提交' : null },
        { id: 'period-october', periodKey: '2026-10', canEdit: false, reason: '本月尚未开始' },
      ],
    };
    else if (endpoint.endsWith('/tasks/task-1')) data = {
      id: 'task-1', cycleId, cycleName: '季度测试计划', workflowVersion: 2, employeeId: 'employee-1', employeeName: '虚拟员工', employeeNo: 'MOCK001',
      deptId: 'dept-1', deptName: '测试部', managerId: 'manager-1', managerName: '虚拟主管', status: 'manager_scoring', isExempt: false,
      indicatorInstances: [], periods: [period], flowRecords: [],
      workflowContext: { stage: 'self_eval', statusLabel: '待员工自评', currentHandler: { id: 'employee-1', name: '虚拟员工', nodeType: 'employee' }, currentDeadline: period.selfEvalDueAt, canRemind: false },
    };
    else if (endpoint.endsWith(`/cycles/${cycleId}`)) data = { id: cycleId, name: '季度测试计划', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30', status: 'self_eval', publishVisibleFields: {} };
    else if (endpoint.endsWith(`/assessment-periods/${periodId}/review`)) data = {
      period, context: { cycleName: '季度测试计划', employeeName: '虚拟员工', employeeNo: 'MOCK001', deptName: '测试部', managerName: '虚拟主管', statusLabel: options.readonly ? '已提交' : '员工填写中' },
      permissions: { canEditEmployee: !options.readonly, canEditManager: false },
      indicators: [{
        indicatorVersionItemId: 'item-1', sourceInstanceId: 'indicator-1', name: '完成虚拟项目交付', description: '按期完成交付', scoringStandard: '达到既定验收标准',
        targetValue: 100, targetValueText: '100%', unit: '%', weight: 1, isScoreRequired: true, monthlyProgressSource: 'draft_or_result',
        progress: 42, healthStatus: 'on_track', employeeComment: '我的未保存自评说明', selfScore: 91,
        actualValueText: null, problemReason: null, nextMonthPlan: null, supportNeeded: null, attachments: [], managerScore: null, managerComment: null,
        latestProgress: null, progressReferences: options.empty ? [] : options.records ?? references, alignedObjectives: [], history: [],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
  });
  await page.goto(options.review ? '/tasks/task-1?stage=self-eval' : '/action-items');
  if (!options.review) await page.getByTestId('goal-tracking-indicator-summary-indicator-1').click();
  return writes;
}

for (const width of [1440, 390]) {
  test(`历史月份补录保留各月草稿并且不替换九月当前进展 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockApp(page);
    const drawer = page.getByTestId('goal-tracking-detail');
    await drawer.getByTestId('goal-tracking-update-trigger').click();
    const form = drawer.getByTestId('goal-tracking-progress-form');
    await expect(form.getByLabel('归属月份')).toHaveValue('period-september');
    await expect(form.getByLabel('完成进度')).toHaveValue('80');
    await form.getByLabel('进展描述').fill('九月未保存草稿');
    await form.getByLabel('归属月份').selectOption('period-july');
    await expect(form.getByLabel('完成进度')).toHaveValue('20');
    await expect(form.getByLabel('进展状态')).toHaveValue('at_risk');
    await expect(form.getByLabel('进展描述')).toHaveValue('');
    await form.getByLabel('完成进度').fill('35');
    await form.getByLabel('进展描述').fill('七月补录交付结果');
    await form.getByLabel('归属月份').selectOption('period-september');
    await expect(form.getByLabel('进展描述')).toHaveValue('九月未保存草稿');
    await form.getByLabel('归属月份').selectOption('period-july');
    await expect(form.getByLabel('完成进度')).toHaveValue('35');
    await expect(form.locator('option[value="period-august"]')).toHaveJSProperty('disabled', true);
    await expect(form.locator('option[value="period-october"]')).toHaveJSProperty('disabled', true);
    await page.screenshot({ path: testInfo.outputPath('backfill-editor.png'), fullPage: true });
    await form.getByRole('button', { name: '更新进展', exact: true }).click();
    await expect.poll(() => writes.map(write => write.body)).toEqual([{ periodId: 'period-july', progress: 35, healthStatus: 'at_risk', content: '七月补录交付结果', expectedLatestUpdateAt: '2026-07-20T08:00:00.000Z' }]);
    await expect(drawer.getByTestId('goal-tracking-current-progress')).toContainText('九月交付保持正常');
    await drawer.getByTestId('goal-tracking-history').locator('summary').click();
    await expect(drawer.getByTestId('goal-tracking-history')).toContainText('七月补录交付结果');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });

  test(`查看多条进展并同步三字段，取消覆盖保护自评草稿 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockApp(page, { review: true });
    const card = page.getByTestId('monthly-review-goal-card').first();
    const reference = card.getByTestId('monthly-progress-reference');
    await expect(reference).toContainText('65%');
    await expect(reference).toContainText('2026/09/08');
    await expect(reference).toContainText(references[0].content);
    await page.screenshot({ path: testInfo.outputPath('monthly-reference-default.png'), fullPage: true });
    await reference.getByText('本期其他记录（1）', { exact: true }).click();
    await expect(reference.getByTestId('progress-reference-july-older')).toContainText('供应存在风险');
    await reference.getByText('其他月份（2）', { exact: true }).click();
    await expect(reference.getByTestId('progress-reference-september')).toContainText('九月进展');
    await expect(reference.getByTestId('progress-reference-september').getByRole('button')).toHaveCount(0);
    const sync = reference.getByRole('button', { name: '汇总本月进展到自评' });
    await expect(sync).toBeVisible();
    await sync.click();
    const confirmation = page.getByRole('dialog', { name: '汇总本月进展' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('textbox', { name: '汇总描述预览' })).toHaveValue(expectedMonthlyDescription);
    await page.screenshot({ path: testInfo.outputPath('sync-confirmation.png'), fullPage: true, animations: 'disabled' });
    const confirmationBox = await confirmation.boundingBox();
    expect(confirmationBox!.x).toBeGreaterThanOrEqual(0);
    expect(confirmationBox!.x + confirmationBox!.width).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: '保留当前填写', exact: true }).click();
    await expect(card.getByLabel('本月完成进度')).toHaveValue('42');
    await expect(card.getByRole('textbox')).toHaveValue('我的未保存自评说明');
    await sync.click();
    await page.getByRole('button', { name: '替换并填入', exact: true }).click();
    await expect(card.getByLabel('本月完成进度')).toHaveValue('65');
    await expect(card.getByRole('button', { name: '当前受阻', exact: true })).toHaveClass(/is-active/);
    await expect(card.getByRole('textbox')).toHaveValue(expectedMonthlyDescription);
    await expect(card.getByLabel('本月自评分')).toHaveValue('91');
    await expect(page.getByRole('button', { name: '自评等级 B', exact: true })).toHaveClass(/is-active/);
    expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].endpoint).toContain('/employee-draft');
    expect(writes[0].body).toEqual({ expectedVersion: 3, selfGrade: 'B', indicators: [{ indicatorVersionItemId: 'item-1', progress: 65, healthStatus: 'blocked', employeeComment: expectedMonthlyDescription, selfScore: 91 }] });
    await page.screenshot({ path: testInfo.outputPath('monthly-reference-expanded.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('当前月已提交时默认最近可编辑月，无该月记录从空进展开始', async ({ page }) => {
  const writes = await mockApp(page, { julyEmpty: true, septemberLocked: true });
  await page.getByTestId('goal-tracking-update-trigger').click();
  const form = page.getByTestId('goal-tracking-progress-form');
  await expect(form.getByLabel('归属月份')).toHaveValue('period-july');
  await expect(form.getByLabel('完成进度')).toHaveValue('0');
  await expect(form.getByLabel('进展状态')).toHaveValue('on_track');
  await form.getByLabel('进展描述').fill('首次补录七月结果');
  await form.getByRole('button', { name: '更新进展', exact: true }).click();
  await expect.poll(() => writes.map(write => write.body)).toEqual([{ periodId: 'period-july', progress: 0, healthStatus: 'on_track', content: '首次补录七月结果', expectedLatestUpdateAt: null }]);
});

test('整周期明确返回空月份列表时仍可更新当前进展', async ({ page }) => {
  const writes = await mockApp(page, { trackingCycle: true });
  await page.getByTestId('goal-tracking-update-trigger').click();
  const form = page.getByTestId('goal-tracking-progress-form');
  await expect(form).toBeVisible();
  await expect(form.getByLabel('归属月份')).toHaveCount(0);
  await expect(form.getByLabel('完成进度')).toHaveValue('80');
  await form.getByLabel('进展描述').fill('整周期最新交付情况');
  await form.getByRole('button', { name: '更新进展', exact: true }).click();
  await expect.poll(() => writes.map(write => write.body)).toEqual([{ progress: 80, healthStatus: 'on_track', content: '整周期最新交付情况', expectedLatestUpdateAt: '2026-09-08T08:00:00.000Z' }]);
  await expect(page.getByTestId('goal-tracking-current-progress')).toContainText('整周期最新交付情况');
});

test('同步后的相同内容可再次同步，无覆盖确认也不写入接口', async ({ page }) => {
  const writes = await mockApp(page, { review: true });
  const sync = page.getByRole('button', { name: '汇总本月进展到自评' });
  await sync.click();
  await page.getByRole('button', { name: '替换并填入', exact: true }).click();
  await expect(page.getByLabel('本月完成进度')).toHaveValue('65');
  await sync.click();
  await expect(page.getByRole('button', { name: '替换并填入', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('monthly-review-goal-card').getByRole('textbox')).toHaveValue(expectedMonthlyDescription);
  expect(writes).toHaveLength(0);
});

test('已提交自评仍可查阅进展，但没有同步动作', async ({ page }) => {
  const writes = await mockApp(page, { review: true, readonly: true });
  const reference = page.getByTestId('monthly-progress-reference');
  await expect(reference).toContainText('65%');
  await expect(reference.getByRole('button')).toHaveCount(0);
  await expect(page.getByLabel('本月完成进度')).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('整周期按起止范围允许本期月份同步，即使 periodKey 不是 month', async ({ page }) => {
  await mockApp(page, { review: true, cycle: true });
  const reference = page.getByTestId('monthly-progress-reference');
  await reference.getByText('本期其他记录（2）', { exact: true }).click();
  await expect(reference.getByRole('button', { name: '汇总本期进展到自评' })).toBeVisible();
  await reference.getByText('其他月份（1）', { exact: true }).click();
  await expect(reference.getByTestId('progress-reference-outside').getByRole('button')).toHaveCount(0);
  await reference.getByRole('button', { name: '汇总本期进展到自评' }).click();
  await expect(page.getByRole('textbox', { name: '汇总描述预览' })).toHaveValue(`${references[1].content}\n\n${references[2].content}\n\n${references[0].content}`);
});

test('最新记录只更新状态进度时，汇总仍保留全部已有文字并排除其他月份', async ({ page }) => {
  await mockApp(page, { review: true, records: [
    ...references,
    { ...references[0], id: 'july-empty-latest', progress: 100, healthStatus: 'completed', content: '  ', createdAt: '2026-09-09T08:00:00.000Z' },
  ] });
  await page.getByRole('button', { name: '汇总本月进展到自评' }).click();
  await expect(page.getByRole('textbox', { name: '汇总描述预览' })).toHaveValue(expectedMonthlyDescription);
  await page.getByRole('button', { name: '替换并填入' }).click();
  await expect(page.getByLabel('本月完成进度')).toHaveValue('100');
  await expect(page.getByRole('button', { name: '已经完成', exact: true })).toHaveClass(/is-active/);
});

test('汇总超过描述上限时完整预览并允许精简，确认前不覆盖草稿也不截断', async ({ page }) => {
  const content = '项目进展原始记录'.repeat(1600);
  const writes = await mockApp(page, { review: true, records: [{ ...references[0], content }] });
  await page.getByRole('button', { name: '汇总本月进展到自评' }).click();
  const preview = page.getByRole('textbox', { name: '汇总描述预览' });
  await expect(preview).toHaveValue(content);
  await expect(page.getByRole('button', { name: '替换并填入' })).toBeDisabled();
  await expect(page.getByTestId('monthly-review-goal-card').getByRole('textbox')).toHaveValue('我的未保存自评说明');
  await preview.fill('员工检查后精简的本月交付记录');
  await page.getByRole('button', { name: '替换并填入' }).click();
  await expect(page.getByTestId('monthly-review-goal-card').getByRole('textbox')).toHaveValue('员工检查后精简的本月交付记录');
  expect(writes).toHaveLength(0);
});

test('仅其他月份有记录时可查看但不能汇总到本月', async ({ page }) => {
  const writes = await mockApp(page, { review: true, records: [references[2]] });
  const panel = page.getByTestId('monthly-progress-reference');
  await expect(panel).toContainText('本期暂无日常进展');
  await expect(panel.getByRole('button')).toHaveCount(0);
  await panel.getByText('其他月份（1）', { exact: true }).click();
  await expect(panel).toContainText(references[2].content);
  expect(writes).toHaveLength(0);
});

test('无日常进展显示紧凑空态，不影响本人填写', async ({ page }) => {
  await mockApp(page, { review: true, empty: true });
  await expect(page.getByTestId('monthly-progress-reference')).toContainText('本期暂无日常进展');
  await expect(page.getByLabel('本月自评分')).toBeEnabled();
});
