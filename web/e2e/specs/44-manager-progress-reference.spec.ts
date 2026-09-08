import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PeriodReviewDetail, PeriodReviewProgressReference } from '../../src/types/api.types';

const cycleId = '11111111-1111-4111-8111-111111111111';
const periodId = '33333333-3333-4333-8333-333333333333';
const taskId = 'task-manager-reference';
const employeeDescription = `员工自评：已完成核心交付，持续跟进验收。${'针对客户追加需求逐项核对交付范围，所有反馈均记录到验收清单。'.repeat(5)}\n\n下阶段安排：补充验收材料并完成培训，逐项确认交付质量与使用效果。`;
const evidenceDirectory = fileURLToPath(new URL('../../../tmp/qa-progress-summary-20260908/manager-screenshots/', import.meta.url));
mkdirSync(evidenceDirectory, { recursive: true });

const references: PeriodReviewProgressReference[] = [
  { id: 'august-middle', periodKey: '2026-08', progress: 60, healthStatus: 'at_risk', content: '八月中旬：客户追加需求，已安排补充交付。', attachments: [], createdAt: '2026-08-18T07:30:00.000Z' },
  { id: 'september', periodKey: '2026-09', progress: 95, healthStatus: 'on_track', content: '九月独立记录，仅供跨月参考。', attachments: [], createdAt: '2026-09-08T08:00:00.000Z' },
  { id: 'august-latest', periodKey: '2026-08', progress: 80, healthStatus: 'blocked', content: '八月补录结果：主体交付已完成，仍等待客户验收材料。'.repeat(4), attachments: [], createdAt: '2026-09-08T07:00:00.000Z' },
  { id: 'june', periodKey: '2026-06', progress: 10, healthStatus: 'on_track', content: '六月周期外的准备记录。', attachments: [], createdAt: '2026-06-20T07:00:00.000Z' },
  { id: 'august-first', periodKey: '2026-08', progress: 20, healthStatus: 'on_track', content: '八月初：方案已确认，开始执行。', attachments: [], createdAt: '2026-08-03T06:00:00.000Z' },
];

interface WriteRequest { endpoint: string; method: string; body: unknown }

async function mockManagerReview(page: Page, options: { empty?: boolean; readonly?: boolean; cycle?: boolean } = {}) {
  const writes: WriteRequest[] = [];
  const period: PeriodReviewDetail['period'] = {
    id: periodId, taskId, periodKey: options.cycle ? '2026-Q3' : '2026-08', periodType: options.cycle ? 'cycle' : 'month',
    periodStart: options.cycle ? '2026-07-01' : '2026-08-01', periodEnd: options.cycle ? '2026-09-30' : '2026-08-31',
    status: options.readonly ? 'completed' : 'manager_scoring',
    selfEvalOpenAt: '2026-08-29T10:00:00.000Z', selfEvalDueAt: '2026-09-09T10:00:00.000Z', managerDueAt: '2026-09-12T10:00:00.000Z',
    employeeSubmittedAt: '2026-09-08T08:30:00.000Z', managerSubmittedAt: options.readonly ? '2026-09-08T09:00:00.000Z' : null,
    selfScoreTotal: 91, managerScoreTotal: options.readonly ? 86 : null, selfGrade: 'A', managerGrade: 'B', draftVersion: 3,
  };
  const detail: PeriodReviewDetail = {
    period,
    context: { cycleName: '虚拟季度考核计划', employeeName: '虚拟员工', employeeNo: 'MOCK001', deptName: '测试部', managerName: '虚拟主管', statusLabel: options.readonly ? '月度评分已完成' : '待主管评分' },
    permissions: { canEditEmployee: false, canEditManager: !options.readonly },
    indicators: [{
      indicatorVersionItemId: 'item-1', sourceInstanceId: 'indicator-1', name: '完成虚拟项目交付', description: '按期完成交付', scoringStandard: '达到既定验收标准',
      targetValue: 100, targetValueText: '100%', unit: '%', weight: 1, isScoreRequired: true, monthlyProgressSource: 'draft_or_result',
      progress: 75, healthStatus: 'on_track', employeeComment: employeeDescription, selfScore: 91,
      actualValueText: '已完成核心交付', problemReason: null, nextMonthPlan: null, supportNeeded: null, attachments: [],
      managerScore: 86, managerComment: '已保存的上级评价依据', latestProgress: null,
      progressReferences: options.empty ? [] : references, alignedObjectives: [], history: [],
    }],
  };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-manager-progress-reference-ui');
    localStorage.setItem('expiresAt', String(Date.now() + 3_600_000));
  });
  // All API traffic is fulfilled locally; no request may reach a business database.
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    let data: unknown = [];
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push({ endpoint, method: request.method(), body: request.postDataJSON() });
      data = { periodId, status: period.status, draftVersion: 4, savedAt: '2026-09-08T10:00:00.000Z' };
    } else if (endpoint.endsWith('/auth/me')) {
      data = { id: 'manager-1', name: '虚拟主管', sysRole: 'manager', deptId: 'dept-1', isAssessorOnly: false, canViewAll: false, businessCapabilities: { canManageTeam: true } };
    } else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint.endsWith('/cycles/mine')) data = [{ id: cycleId, name: '虚拟季度考核计划', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30', status: 'manager_score' }];
    else if (endpoint.endsWith('/tasks/team')) data = { items: [], total: 0, page: 1, pageSize: 20, counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 }, facets: { departments: [], employees: [] } };
    else if (endpoint.endsWith('/tasks/mine')) data = { items: [], total: 0, page: 1, pageSize: 100 };
    else if (endpoint.endsWith(`/assessment-periods/${periodId}/review`)) data = detail;
    else if (endpoint.endsWith(`/cycles/${cycleId}`)) {
      data = { id: cycleId, name: '虚拟季度考核计划', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30', status: 'manager_score', publishVisibleFields: {} };
    } else if (endpoint.endsWith(`/tasks/${taskId}`)) {
      data = {
        id: taskId, cycleId, cycleName: '虚拟季度考核计划', workflowVersion: 2,
        employeeId: 'employee-1', employeeName: '虚拟员工', employeeNo: 'MOCK001', deptId: 'dept-1', deptName: '测试部',
        managerId: 'manager-1', managerName: '虚拟主管', status: 'manager_scoring', isExempt: false, indicatorInstances: [],
        periods: [{ ...period, sequence: 1 }], flowRecords: [],
        workflowContext: { stage: 'manager_score', statusLabel: options.readonly ? '月度评分已完成' : '待主管评分', currentHandler: { id: 'manager-1', name: '虚拟主管', nodeType: 'manager' }, currentDeadline: period.managerDueAt, canRemind: false },
      };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
  });
  await page.goto(options.readonly
    ? `/tasks?scope=team&stage=manager-eval&cycleId=${cycleId}&taskId=${taskId}&periodId=${periodId}`
    : `/tasks/${taskId}?stage=self-eval&periodId=${periodId}`);
  await expect(page.getByTestId('manager-period-review-workspace')).toBeVisible();
  return writes;
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${evidenceDirectory}${name}.png`, fullPage: true, animations: 'disabled' });
}

for (const width of [1440, 390]) {
  test(`主管展开多条跟进参考保留评分草稿及保存协议 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockManagerReview(page);
    const card = page.getByTestId('manager-review-goal-card');
    const reference = card.getByTestId('monthly-progress-reference');
    const toggle = reference.getByText('本月跟进记录（3条）', { exact: true });
    await expect(toggle).toBeVisible();
    await expect(reference.getByTestId('progress-reference-august-latest')).toBeHidden();
    const employeeBox = await card.locator('.manager-score-card__employee').boundingBox();
    const referenceBox = await reference.boundingBox();
    const scoreBox = await card.getByTestId('manager-review-score-group').boundingBox();
    expect(referenceBox!.y).toBeGreaterThanOrEqual(employeeBox!.y + employeeBox!.height - 1);
    expect(scoreBox!.y).toBeGreaterThanOrEqual(referenceBox!.y + referenceBox!.height - 1);
    const employeeText = card.locator('.manager-score-card__employee .is-wide strong');
    await expect(employeeText).toHaveText(employeeDescription);
    const descriptionLayout = await employeeText.evaluate(element => ({
      height: element.getBoundingClientRect().height, width: element.clientWidth, textWidth: element.scrollWidth,
    }));
    expect(descriptionLayout.height).toBeGreaterThan(40);
    expect(descriptionLayout.width).toBeGreaterThan(employeeBox!.width * .9);
    expect(descriptionLayout.textWidth).toBeLessThanOrEqual(descriptionLayout.width);
    await screenshot(page, `manager-reference-collapsed-${width}`);

    await card.getByLabel('直属上级评分', { exact: true }).fill('88');
    await card.getByRole('textbox').fill('尚未保存的主管评语：结合交付质量评分。');
    await page.getByRole('button', { name: '直属上级等级 C', exact: true }).click();
    await toggle.click();
    const latest = reference.getByTestId('progress-reference-august-latest');
    await expect(latest).toBeVisible();
    await expect(latest).toContainText('2026-08');
    await expect(latest).toContainText('2026/09/08 15:00');
    await expect(latest).toContainText('80%');
    await expect(latest).toContainText('当前受阻');
    await expect(latest).toContainText(references[2].content);
    await reference.locator('summary').filter({ hasText: /本期.*（2）/ }).click();
    await expect(reference.getByTestId('progress-reference-august-middle')).toBeVisible();
    await expect(reference.getByTestId('progress-reference-august-middle')).toContainText('2026/08/18 15:30');
    await expect(reference.getByTestId('progress-reference-august-first')).toBeVisible();
    await reference.getByText('其他月份（2）', { exact: true }).click();
    await expect(reference.getByTestId('progress-reference-september')).toContainText('2026-09');
    await expect(reference.getByTestId('progress-reference-september')).toContainText('九月独立记录');
    await expect(reference.getByTestId('progress-reference-june')).toBeVisible();
    await expect(reference.getByRole('button')).toHaveCount(0);
    await expect(reference.getByText(/汇总|同步/)).toHaveCount(0);
    await expect(card.getByLabel('直属上级评分', { exact: true })).toHaveValue('88');
    await expect(card.getByRole('textbox')).toHaveValue('尚未保存的主管评语：结合交付质量评分。');
    await expect(page.getByRole('button', { name: '直属上级等级 C', exact: true })).toHaveClass(/is-active/);
    await expect(card.locator('.manager-score-card__employee')).toContainText('员工自评：已完成核心交付，持续跟进验收。');
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await screenshot(page, `manager-reference-expanded-${width}`);

    await toggle.click();
    await expect(latest).toBeHidden();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([{
      endpoint: `/api/v1/assessment-periods/${periodId}/manager-draft`, method: 'PUT',
      body: { expectedVersion: 3, managerGrade: 'C', indicators: [{ indicatorVersionItemId: 'item-1', managerScore: 88, managerComment: '尚未保存的主管评语：结合交付质量评分。' }] },
    }]);
  });

  test(`主管无跟进记录时保留零条折叠入口和评分能力 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockManagerReview(page, { empty: true });
    const reference = page.getByTestId('monthly-progress-reference');
    await reference.getByText('本月跟进记录（0条）', { exact: true }).click();
    await expect(reference).toContainText('本期暂无日常进展');
    await expect(reference.locator('article')).toHaveCount(0);
    await expect(reference.getByRole('button')).toHaveCount(0);
    await expect(page.getByLabel('直属上级评分', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('直属上级评分', { exact: true })).toHaveValue('86');
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await screenshot(page, `manager-reference-empty-${width}`);
  });

  test(`已评分主管仍可只读查看跟进记录 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockManagerReview(page, { readonly: true });
    const reference = page.getByTestId('monthly-progress-reference');
    await expect(reference.getByTestId('progress-reference-august-latest')).toBeHidden();
    await reference.getByText('本月跟进记录（3条）', { exact: true }).click();
    await expect(reference.getByTestId('progress-reference-august-latest')).toContainText(references[2].content);
    await expect(reference.getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('manager-review-score-result')).toContainText('86分');
    await expect(page.getByTestId('manager-review-score-result')).toContainText('已保存的上级评价依据');
    await expect(page.getByTestId('manager-review-overall-grade').locator('.manager-review__grade-result')).toHaveText('B');
    await expect(page.getByLabel('直属上级评分', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '提交评分', exact: true })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await screenshot(page, `manager-reference-readonly-${width}`);
  });
}

test('整周期主管参考按起止月份归组并保持只读', async ({ page }) => {
  const writes = await mockManagerReview(page, { cycle: true });
  const reference = page.getByTestId('monthly-progress-reference');
  await expect(reference.getByTestId('progress-reference-september')).toBeHidden();
  await reference.getByText('本期跟进记录（4条）', { exact: true }).click();
  await expect(reference.getByTestId('progress-reference-september')).toBeVisible();
  await reference.locator('summary').filter({ hasText: /本期.*（3）/ }).click();
  await expect(reference.getByTestId('progress-reference-august-latest')).toBeVisible();
  await reference.getByText('其他月份（1）', { exact: true }).click();
  await expect(reference.getByTestId('progress-reference-june')).toBeVisible();
  await expect(reference.getByRole('button')).toHaveCount(0);
  expect(writes).toEqual([]);
});
