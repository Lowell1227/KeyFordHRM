import { expect, test, type Page } from '@playwright/test';

const cycleId = '11111111-1111-4111-8111-111111111111';
const progress = (id: string, source = 'active_progress') => ({
  id, source, businessPeriodKey: '2026-09', progress: 60, healthStatus: 'at_risk',
  content: `进展说明 ${id}`, updatedAt: '2026-09-08T08:00:00.000Z', attachments: [],
});

async function setup(page: Page, options: { empty?: boolean; canEdit?: boolean } = {}) {
  const canEdit = options.canEdit ?? true;
  let updates = options.empty ? [] : [progress('latest'), progress('daily'), progress('monthly', 'monthly_self_evaluation')];
  const submitted: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-progress-ui');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  const item = () => ({
    id: 'indicator-1', title: '完成虚拟项目交付', taskId: 'task-1', ownerId: 'employee-1', ownerName: '虚拟员工',
    cycleId, cycleName: '季度测试计划', status: 'active', progress: updates[0]?.progress ?? 0, weight: 100,
    description: '按期完成交付', scoringStandard: '达到既定验收标准', alignedObjectives: [], visibilityScope: 'supervisors',
    dimensionName: '工作目标', latestProgress: updates[0] ?? null,
  });
  await page.route('**/api/v1/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (endpoint.endsWith('/auth/me')) data = { id: 'employee-1', name: '虚拟员工', sysRole: 'employee', canViewAll: false, isAssessorOnly: false };
    else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint.endsWith('/cycles/tracking-contexts')) data = [{
      id: cycleId, name: '季度测试计划', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30',
      scoringFrequency: 'cycle', openedAt: '2026-07-01T00:00:00Z',
      task: { id: 'task-1', status: 'goal_confirmed', isExempt: false, participantDisposition: 'active' }, periods: [],
    }];
    else if (endpoint.endsWith('/objectives/tracking')) data = {
      taskId: 'task-1', taskStatus: 'goal_confirmed', canEdit, totalWeight: 100, items: [item()],
      summary: { periodCount: 3, employeeSubmittedCount: 0, managerCompletedCount: 0, activeBusinessPeriodKey: '2026-09', activeUpdatedGoalCount: updates.length ? 1 : 0, goalCount: 1 },
    };
    else if (endpoint.endsWith('/indicators/indicator-1')) data = {
      ...item(), canEdit, activeBusinessPeriodKey: '2026-09', progressUpdates: updates, changeRecords: [], selfEvaluationResults: [],
    };
    else if (endpoint.endsWith('/indicators/indicator-1/progress')) {
      const body = route.request().postDataJSON(); submitted.push(body);
      const created = { ...progress('new'), ...body }; updates = [created, ...updates]; data = created;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
  });
  await page.goto('/action-items');
  await page.getByTestId('goal-tracking-indicator-summary-indicator-1').click();
  await expect(page.getByTestId('goal-tracking-detail').getByRole('heading', { name: '完成虚拟项目交付' })).toBeVisible();
  return submitted;
}

for (const width of [1440, 390]) {
  test(`首次进展入口靠近空状态并能完成提交 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const submitted = await setup(page, { empty: true });
    const drawer = page.getByTestId('goal-tracking-detail');
    const empty = drawer.locator('#goal-detail-progress .goal-detail__empty');
    const button = empty.getByRole('button', { name: '更新进展', exact: true });
    await expect(button).toBeVisible();
    await expect(drawer.locator('.el-drawer__header').getByRole('button', { name: /更新/ })).toHaveCount(0);
    await expect.poll(() => drawer.evaluate(node => Math.round(node.getBoundingClientRect().right))).toBe(width);
    const centerOffset = await empty.evaluate(node => {
      const container = node.getBoundingClientRect();
      const action = node.querySelector('button')!.getBoundingClientRect();
      return Math.abs(action.x + action.width / 2 - container.x - container.width / 2);
    });
    expect(centerOffset).toBeLessThan(3);
    await page.screenshot({ path: testInfo.outputPath('empty-progress.png'), fullPage: true });
    await button.click();
    const form = drawer.getByTestId('goal-tracking-progress-form');
    await expect(form).toContainText('2026年9月');
    await expect(form.getByLabel('进展描述')).toBeFocused();
    await expect(drawer.getByText('当前尚未记录进展', { exact: true })).toHaveCount(0);
    await form.getByLabel('完成进度').fill('25');
    await form.getByLabel('进展描述').fill('已完成第一阶段交付');
    await page.screenshot({ path: testInfo.outputPath('progress-editor.png'), fullPage: true });
    await form.getByRole('button', { name: '更新进展', exact: true }).click();
    await expect.poll(() => submitted).toEqual([{ progress: 25, healthStatus: 'on_track', content: '已完成第一阶段交付', expectedLatestUpdateAt: null }]);
    await expect(drawer.getByTestId('goal-tracking-current-progress')).toContainText('已完成第一阶段交付');
    await expect(drawer.locator('.goal-detail__section-title').getByRole('button', { name: '更新进展', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('进展来源作为次要文字保留，状态和内容仍清楚可读', async ({ page }, testInfo) => {
  await setup(page);
  const drawer = page.getByTestId('goal-tracking-detail');
  await drawer.getByTestId('goal-tracking-history').locator('summary').click();
  const history = drawer.getByTestId('goal-tracking-history');
  await expect(history).toContainText('日常更新');
  await expect(history).toContainText('月度自评');
  await expect(history).toContainText('存在风险');
  await expect(history).toContainText('进展说明 monthly');
  const source = history.locator('.goal-progress-timeline__source').first();
  await expect(source).toBeVisible();
  const weight = await source.evaluate(node => getComputedStyle(node).fontWeight);
  expect(Number(weight)).toBeLessThan(600);
  await page.screenshot({ path: testInfo.outputPath('progress-history.png'), fullPage: true });
});

test('不可编辑的进展仍只读且没有更新入口', async ({ page }) => {
  await setup(page, { empty: true, canEdit: false });
  const drawer = page.getByTestId('goal-tracking-detail');
  await expect(drawer.getByText('当前尚未记录进展', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /更新/ })).toHaveCount(0);
});
