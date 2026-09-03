import { expect, test } from '@playwright/test';
import type { AssessmentCycle, CyclePeriodSchedule } from '../../src/types/api.types';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

function buildSchedules(count: number, scoringFrequency: 'monthly' | 'cycle'): CyclePeriodSchedule[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    return {
      periodKey: scoringFrequency === 'cycle' ? 'cycle' : `2027-${month}`,
      periodType: scoringFrequency === 'cycle' ? 'cycle' : 'month',
      sequence: index + 1,
      periodStart: `2027-${month}-01`,
      periodEnd: `2027-${month}-28`,
      selfEvalOpenAt: `2027-${month}-01T09:00:00+08:00`,
      selfEvalDueAt: `2027-${month}-03T18:00:00+08:00`,
      managerDueAt: `2027-${month}-06T18:00:00+08:00`,
      isException: index === 1,
    };
  });
}

function buildSchedulesForRange(
  startDate: string,
  endDate: string,
  scoringFrequency: 'monthly' | 'cycle',
): CyclePeriodSchedule[] {
  if (scoringFrequency === 'cycle') {
    return [{
      periodKey: 'cycle',
      periodType: 'cycle',
      sequence: 1,
      periodStart: startDate,
      periodEnd: endDate,
      selfEvalOpenAt: `${endDate}T09:00:00+08:00`,
      selfEvalDueAt: `${endDate}T18:00:00+08:00`,
      managerDueAt: `${endDate}T18:00:00+08:00`,
      isException: false,
    }];
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const schedules: CyclePeriodSchedule[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (year < end.getUTCFullYear() || (year === end.getUTCFullYear() && month <= end.getUTCMonth())) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const isFirst = schedules.length === 0;
    const isLast = year === end.getUTCFullYear() && month === end.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    schedules.push({
      periodKey: key,
      periodType: 'month',
      sequence: schedules.length + 1,
      periodStart: isFirst ? startDate : `${key}-01`,
      periodEnd: isLast ? endDate : `${key}-${lastDay}`,
      selfEvalOpenAt: `${key}-01T09:00:00+08:00`,
      selfEvalDueAt: `${key}-03T18:00:00+08:00`,
      managerDueAt: `${key}-06T18:00:00+08:00`,
      isException: false,
    });
    month += 1;
    if (month === 12) {
      year += 1;
      month = 0;
    }
  }
  return schedules;
}

const integratedCycle: AssessmentCycle = {
  id: 'cycle-v2',
  name: '2027 Q1 季度考核',
  type: 'quarterly',
  workflowVersion: 2,
  scoringFrequency: 'monthly',
  reviewFrequency: 'cycle',
  planVersion: 3,
  periodSchedules: buildSchedules(3, 'monthly'),
  companyFinalApproverId: 'leader-1',
  companyFinalApprover: { id: 'leader-1', name: '李宏' },
  startDate: '2027-01-01',
  endDate: '2027-03-31',
  goalSettingOpenAt: '2026-12-15T09:00:00+08:00',
  selfEvalOpenAt: '2027-04-01T09:00:00+08:00',
  deadlineIndicatorSetting: '2026-12-22T18:00:00+08:00',
  deadlineIndicatorConfirm: '2026-12-30T18:00:00+08:00',
  deadlineSelfEval: '2027-04-03T18:00:00+08:00',
  deadlineManagerScore: '2027-04-06T18:00:00+08:00',
  deadlineHrCalibration: '2027-04-08T18:00:00+08:00',
  deadlineApproval: '2027-04-10T18:00:00+08:00',
  deadlinePublish: '2027-04-11T18:00:00+08:00',
  status: 'draft',
  reviewStatus: 'approved',
  monthlyFollowUpRequired: true,
  reviewerId: 'hr-1',
  reviewer: { id: 'hr-1', name: '姚瑶' },
  creator: { id: 'hr-1', name: '姚瑶' },
  hrOwnerId: 'hr-1',
  participantDeptIds: [],
  participantUserIds: [],
  explicitExemptDeptIds: [],
  explicitExemptUserIds: [],
  notificationMode: 'off',
  publishVisibleFields: {},
  gradeAMaxRatio: 0.2,
  gradeBMaxRatio: 0.4,
  gradeCMaxRatio: 0.3,
  gradeDMaxRatio: 0.1,
};

interface IntegratedPageOptions {
  cycles?: AssessmentCycle[];
  blockers?: Array<{ code: string; periodKey: string; message: string }>;
  warnings?: Array<{ code: string; periodKey: string; message: string }>;
  createBodies?: Record<string, unknown>[];
  updateBodies?: Record<string, unknown>[];
  reviewBodies?: Record<string, unknown>[];
  previewBodies?: Record<string, unknown>[];
  previewCompletions?: number[];
  previewResolver?: (
    body: Record<string, unknown>,
    callIndex: number,
  ) => {
    delayMs?: number;
    schedules?: CyclePeriodSchedule[];
    blockers?: Array<{ code: string; periodKey: string; message: string }>;
    warnings?: Array<{ code: string; periodKey: string; message: string }>;
  };
}

async function mockIntegratedCyclePage(
  page: import('@playwright/test').Page,
  options: IntegratedPageOptions = {},
) {
  const cycles = options.cycles ?? [];
  let previewCallIndex = 0;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-cycle-scoring-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-1',
      name: '姚瑶',
      employeeNo: 'HR001',
      deptId: 'hr-dept',
      deptName: '人力资源部',
      sysRole: 'hr',
      isAssessorOnly: false,
      canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{
        id: 'hr-1',
        name: '姚瑶',
        employeeNo: 'HR001',
        deptId: 'hr-dept',
        deptName: '人力资源部',
        sysRole: 'hr',
        status: 'active',
      }],
    })),
  }));
  await page.route('**/api/v1/templates**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/notification-settings/dingtalk', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ available: true, enabled: false, effectiveEnabled: false })),
  }));
  await page.route('**/api/v1/cycles**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/cycles/schedule-preview')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.previewBodies?.push(body);
      const callIndex = previewCallIndex++;
      const scoringFrequency = body.scoringFrequency === 'cycle' || body.type === 'custom'
        ? 'cycle'
        : 'monthly';
      const resolved = options.previewResolver?.(body, callIndex);
      if (resolved?.delayMs) await new Promise((resolve) => setTimeout(resolve, resolved.delayMs));
      const submittedSchedules = Array.isArray(body.schedules)
        ? body.schedules as CyclePeriodSchedule[]
        : undefined;
      options.previewCompletions?.push(callIndex);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          scoringFrequency,
          reviewFrequency: 'cycle',
          schedules: resolved?.schedules
            ?? submittedSchedules
            ?? buildSchedulesForRange(String(body.startDate), String(body.endDate), scoringFrequency),
          blockers: resolved?.blockers ?? options.blockers ?? [],
          warnings: resolved?.warnings ?? options.warnings ?? [],
        })),
      });
    }
    if (path.endsWith('/preflight')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ready: true,
          planHash: 'plan-hash',
          companyFinalApprover: { id: 'leader-1', name: '李宏' },
          cycle: {
            id: integratedCycle.id,
            name: integratedCycle.name,
            status: integratedCycle.status,
            goalSettingOpenAt: integratedCycle.goalSettingOpenAt,
          },
          participantCount: 2,
          templateCount: 0,
          participants: [
            {
              employeeId: 'employee-1',
              employeeName: '陈晨',
              deptId: 'sales',
              deptName: '销售部',
              managerId: 'manager-1',
              managerName: '王强',
              deptHeadId: 'manager-1',
              approverId: 'leader-1',
              templateId: null,
              templateName: null,
              templateVersion: null,
              isExempt: false,
              exemptReason: null,
              participantDisposition: 'active',
            },
            {
              employeeId: 'leader-1',
              employeeName: '李宏',
              deptId: null,
              deptName: null,
              managerId: null,
              managerName: null,
              deptHeadId: null,
              approverId: null,
              templateId: null,
              templateName: null,
              templateVersion: null,
              isExempt: true,
              exemptReason: '最高负责人豁免',
              participantDisposition: 'top_leader_exempt',
            },
          ],
          exclusions: [{
            employeeId: 'probation-1',
            employeeName: '孙珊',
            reasonCode: 'PROBATION_NOT_IN_PLAN',
            reason: '试用期员工不进入本绩效计划',
          }],
          blockers: [],
          warnings: [],
        })),
      });
    }
    const id = path.split('/').at(-1);
    const matchedCycle = cycles.find((cycle) => cycle.id === id) ?? integratedCycle;
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.updateBodies?.push(body);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ...matchedCycle,
          ...body,
          reviewStatus: matchedCycle.reviewStatus === 'approved' ? 'pending' : matchedCycle.reviewStatus,
        })),
      });
    }
    if (request.method() === 'POST' && path.endsWith('/review')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.reviewBodies?.push(body);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ...matchedCycle,
          planVersion: matchedCycle.planVersion + 1,
          reviewStatus: 'approved',
          reviewedAt: new Date().toISOString(),
        })),
      });
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.createBodies?.push(body);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...integratedCycle, ...body, id: 'cycle-created', reviewStatus: 'pending' })),
      });
    }
    if (path !== '/api/v1/cycles') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(matchedCycle)),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: cycles.length, page: 1, pageSize: 10, items: cycles })),
    });
  });
}

async function mountScoringPlanHarness(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/cycles/schedule-preview', (route) => {
    const body = route.request().postDataJSON() as {
      type: string;
      scoringFrequency?: 'monthly' | 'cycle';
      startDate: string;
      endDate: string;
      schedules?: CyclePeriodSchedule[];
    };
    const scoringFrequency = body.type === 'monthly'
      ? 'monthly'
      : body.type === 'custom'
        ? 'cycle'
        : body.scoringFrequency ?? 'monthly';
    const count = scoringFrequency === 'cycle'
      ? 1
      : ({ quarterly: 3, semiannual: 6, annual: 12, monthly: 1 } as Record<string, number>)[body.type] ?? 1;
    const issues = scoringFrequency === 'monthly'
      ? {
          warnings: [
            { code: 'overlap_warning', periodKey: '2027-02', message: '该月与相邻计划有重叠风险' },
            { code: 'manager_due_before_self', periodKey: '2027-02', message: '主管评分早于自评截止' },
          ],
          blockers: [],
        }
      : { warnings: [], blockers: [] };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          scoringFrequency,
          reviewFrequency: 'cycle',
          schedules: Array.isArray(body.schedules)
            ? body.schedules
            : buildSchedules(count, scoringFrequency),
          ...issues,
        },
        timestamp: Date.now(),
      }),
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/e2e/fixtures/cycle-scoring-plan-harness.html');
  try {
    await expect(page.getByTestId('cycle-create')).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    throw new Error(`Harness did not mount: ${errors.join(' | ') || page.url()}`, { cause: error });
  }
}

test.describe('cycle scoring plan controls', () => {
  test('shows one whole-cycle schedule for a quarterly cycle by default', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('月度自评');
    await expect(page.getByText('按月度评分', { exact: true })).toHaveCount(0);
    await expect(page.getByText('月度自评', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cycle-review-frequency')).toHaveCount(0);
    await expect(page.getByText('评分计划', { exact: true })).toHaveCount(0);
    await expect(page.getByText('结果审核按整个周期统一进行', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cycle-schedule-column-header')).toContainText('周期');
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-period-label')).toHaveText('整个周期');
  });

  test('fixes monthly and custom cycles to their required scoring frequency', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-monthly').click();
    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).toBeChecked();
    await expect(page.getByTestId('cycle-monthly-review-switch')).toHaveClass(/is-disabled/);
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('月度周期固定开启');

    await page.getByTestId('cycle-type-custom').click();
    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('cycle-monthly-review-switch')).toHaveClass(/is-disabled/);
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('当前周期不支持月度自评');
  });

  test('shows six and twelve monthly schedule rows for semiannual and annual cycles', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-semiannual').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(6);

    await page.getByTestId('cycle-type-annual').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(12);
  });

  test('shows one overall schedule when a quarterly cycle uses cycle scoring', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-month-schedule-row')).toContainText('整个周期');
    await expect(page.getByTestId('cycle-schedule-column-header')).toContainText('周期');
  });

  test('renders full monthly follow-up times with row dots and only one restore action', async ({ page }) => {
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await page.getByTestId('cycle-monthly-review-switch').click();

    const firstRow = page.getByTestId('cycle-month-schedule-row').first();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(page.getByTestId('cycle-schedule-column-header')).toBeVisible();
    await expect(firstRow.getByTestId('cycle-period-label')).toHaveText('2027年1月');
    await expect(firstRow.getByTestId('self-eval-open-at').locator('input')).toHaveValue('2027-01-01 09:00');
    await expect(firstRow.getByTestId('self-eval-due-at').locator('input')).toHaveValue('2027-01-03 18:00');
    await expect(firstRow.getByTestId('manager-due-at').locator('input')).toHaveValue('2027-01-06 18:00');
    await expect(secondRow.getByTestId('cycle-special-month-dot')).toHaveAttribute('aria-label', '时间已调整');
    await expect(secondRow).toContainText('该月与相邻计划有重叠风险');
    await expect(secondRow).toContainText('主管评分早于自评截止');
    await expect(page.getByTestId('cycle-apply-unified')).toHaveCount(0);
    await expect(page.getByTestId('cycle-preserve-exceptions')).toHaveCount(0);
    await expect(firstRow.getByTestId('cycle-special-month-button')).toHaveCount(0);
    await expect(page.getByTestId('cycle-restore-one')).toHaveCount(0);

    const managerDueInput = firstRow.getByTestId('manager-due-at').locator('input');
    await managerDueInput.fill('2027-01-08 18:00');
    await managerDueInput.press('Tab');
    await expect(firstRow.getByTestId('cycle-special-month-dot')).toHaveAttribute('aria-label', '时间已调整');
    await expect(page.getByTestId('cycle-immutable-update')).toHaveText('array:true:row:true');

    await expect(page.getByTestId('cycle-restore-all')).toHaveCount(0);
  });

  test('shows an empty monthly follow-up time as an inline required field', async ({ page }) => {
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    const field = page.getByTestId('cycle-month-schedule-row').first().getByTestId('self-eval-open-at');
    const input = field.locator('input');
    await expect(input).toHaveValue('2027-01-01 09:00');
    await input.fill('');
    await input.press('Tab');

    await expect(field).toHaveClass(/is-missing/);
    await expect(field.locator('.cycle-time-field__required')).toHaveText('必填');
    await expect(page.locator('.el-message')).toHaveCount(0);
  });

  test('keeps the scoring schedule usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();

    const firstRow = page.getByTestId('cycle-month-schedule-row').first();
    await expect(page.getByTestId('cycle-schedule-column-header')).not.toBeVisible();
    await expect(firstRow.getByText('自评开始', { exact: true })).toBeVisible();
    await expect(firstRow.getByText('自评截止', { exact: true })).toBeVisible();
    await expect(firstRow.getByText('主管评分截止', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('cycle scoring plan integration', () => {
  test('creates workflow v2 without reviewer or schedule-warning confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const createBodies: Record<string, unknown>[] = [];
    const previewBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      previewBodies,
      warnings: [{ code: 'CROSS_MONTH_WARNING', periodKey: '2026-11', message: '主管完成时间跨月，请确认安排' }],
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const createDialog = page.getByRole('dialog', { name: '新建考核周期' });
    const reviewPlan = createDialog.getByTestId('cycle-time-plan');
    await expect(reviewPlan).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-scoring-settings')).toBeVisible();
    await reviewPlan.getByTestId('cycle-monthly-review-switch').click();
    await expect(reviewPlan.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    await expect(reviewPlan.getByTestId('cycle-plan-summary')).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-review-settings-help')).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-schedule-help')).toBeVisible();
    expect(await reviewPlan.locator('.cycle-monthly-schedule-editor').evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true);
    await expect(createDialog.getByText('审核人', { exact: true })).toHaveCount(0);
    await expect(createDialog.getByText('月度自评', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    const managerDueInput = secondRow.getByTestId('manager-due-at').locator('input');
    await managerDueInput.fill('2026-12-10 18:00');
    await managerDueInput.press('Tab');
    await expect(secondRow.getByTestId('cycle-special-month-dot')).toHaveAttribute('aria-label', '时间已调整');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByRole('dialog', { name: '确认评分计划提示' })).toHaveCount(0);
    expect(previewBodies).toContainEqual(expect.objectContaining({
      schedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2026-11', isException: true }),
      ]),
    }));
    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies.at(-1)).not.toHaveProperty('reviewerId');
    expect(createBodies.at(-1)).toMatchObject({
      workflowVersion: 2,
      scoringFrequency: 'monthly',
      monthlyFollowUpRequired: true,
      periodSchedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2026-11', isException: true }),
      ]),
    });
    expect(createBodies.at(-1)).not.toHaveProperty('reviewFrequency');
  });

  test('submits the default whole-cycle setting as cycle scoring and compatibility false', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await page.getByRole('button', { name: '下一步' }).click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      workflowVersion: 2,
      scoringFrequency: 'cycle',
      monthlyFollowUpRequired: false,
    });
  });

  test('uses authoritative edited-schedule warnings, allows equality, and waits before submit', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    const previewBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      previewBodies,
      previewResolver: (body) => {
        if (!Array.isArray(body.schedules)) return {};
        return {
          delayMs: 120,
          warnings: [{
            code: 'SELF_EVAL_DUE_NOT_BEFORE_MANAGER_DUE',
            periodKey: '2026-11',
            message: '自评与主管评分时间相同',
          }],
        };
      },
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(secondRow).toBeVisible();

    await secondRow.getByTestId('manager-due-at').locator('input').fill('2026-11-03 18:00');
    await secondRow.getByTestId('manager-due-at').locator('input').press('Tab');
    await expect(secondRow).toContainText('自评与主管评分时间相同');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(previewBodies).toContainEqual(expect.objectContaining({
      schedules: expect.arrayContaining([
        expect.objectContaining({
          periodKey: '2026-11',
          selfEvalDueAt: '2026-11-03T18:00:00+08:00',
          managerDueAt: '2026-11-03T18:00:00+08:00',
        }),
      ]),
    }));
  });

  test('shows an authoritative schedule warning without blocking submission', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      warnings: [{
        code: 'MANAGER_DUE_BEFORE_SELF_EVAL',
        periodKey: '2026-11',
        message: '主管完成时间不得早于员工完成时间',
      }],
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    const invalidRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(invalidRow).toContainText('主管完成时间不得早于员工完成时间');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect.poll(() => createBodies).toHaveLength(1);
  });

  test('asks to resubmit an approved cycle only when Next is clicked after scoring changes', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByRole('dialog', { name: '确认重新生成评分计划？' })).toHaveCount(0);

    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);

    await page.getByRole('button', { name: '下一步' }).click();
    const reviewConfirm = page.getByRole('dialog', { name: '重新提交周期审核？' });
    await expect(reviewConfirm).toContainText('HR 管理员');
    await reviewConfirm.getByRole('button', { name: '返回修改' }).click();
    expect(updateBodies).toHaveLength(0);
    await expect(page.getByTestId('cycle-create-dialog')).toBeVisible();

    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('dialog', { name: '重新提交周期审核？' })
      .getByRole('button', { name: '确认提交' })
      .click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    await expect(page.getByTestId('cycle-workspace')).toBeVisible();
  });

  test('treats a cycle name change as a business change that must be resubmitted', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();

    await page.getByLabel('周期名称').fill('2027 Q1 季度考核（调整）');
    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
    await page.getByRole('button', { name: '下一步' }).click();

    const reviewConfirm = page.getByRole('dialog', { name: '重新提交周期审核？' });
    await expect(reviewConfirm).toContainText('本次修改会使已审核的考核周期重新进入待审核状态');
    await reviewConfirm.getByRole('button', { name: '确认提交' }).click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).toMatchObject({ name: '2027 Q1 季度考核（调整）' });
  });

  test('switches frequency directly without an adjusted-schedule regeneration dialog', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByRole('dialog', { name: '确认重新生成评分计划？' })).toHaveCount(0);
    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
  });

  test('uses covered months after a period change and preserves matching adjusted rows', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    const dialog = page.getByRole('dialog', { name: '编辑考核周期' });
    const periodInputs = dialog.locator('.el-date-editor--daterange input');
    await periodInputs.nth(0).click();
    const picker = page.locator('.el-date-range-picker:visible');
    await picker.locator('.el-date-range-picker__content.is-left td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^15$/ })
      .click();
    await picker.locator('.el-date-range-picker__content.is-right td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^20$/ })
      .click();

    await expect(page.getByRole('dialog', { name: '是否同步调整时间节点？' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '确认重新生成评分计划？' })).toHaveCount(0);
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(2);
    const adjustedRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(adjustedRow.getByTestId('cycle-special-month-dot')).toHaveAttribute('aria-label', '时间已调整');
    await expect(adjustedRow.getByTestId('manager-due-at').locator('input')).toHaveValue('2027-02-06 18:00');
    await expect(dialog.getByTestId('cycle-period-warning')).toContainText('当前期间覆盖2个月，与季度常规3个月不同，仍可保存');
  });

  test('ignores a stale delayed preview after a newer frequency preview completes', async ({ page }) => {
    const previewCompletions: number[] = [];
    const noExceptionCycle: AssessmentCycle = {
      ...integratedCycle,
      periodSchedules: integratedCycle.periodSchedules?.map((schedule) => ({ ...schedule, isException: false })),
      reviewStatus: 'pending',
    };
    await mockIntegratedCyclePage(page, {
      cycles: [noExceptionCycle],
      previewCompletions,
      previewResolver: (body) => ({ delayMs: body.scoringFrequency === 'cycle' ? 250 : 0 }),
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${noExceptionCycle.id}`).click();

    await page.getByTestId('cycle-monthly-review-switch').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect.poll(() => previewCompletions).toContain(0);

    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).toBeChecked();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
  });

  test('opens an approved workflow v2 draft without updating when nothing changed', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();

    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByTestId('cycle-workspace')).toBeVisible();
    expect(updateBodies).toHaveLength(0);
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('月度自评 · 3期');
  });

  test('treats persisted schedule ids as non-semantic after an approved plan is changed then restored', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    const cycleWithPersistedScheduleIds: AssessmentCycle = {
      ...integratedCycle,
      periodSchedules: buildSchedulesForRange(
        integratedCycle.startDate,
        integratedCycle.endDate,
        'monthly',
      ).map((schedule, index) => ({
        ...schedule,
        id: `persisted-schedule-${index + 1}`,
        isException: false,
      })),
    };
    await mockIntegratedCyclePage(page, { cycles: [cycleWithPersistedScheduleIds], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${cycleWithPersistedScheduleIds.id}`).click();

    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
    await page.getByTestId('cycle-monthly-review-switch').click();

    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByTestId('cycle-workspace')).toBeVisible();
    expect(updateBodies).toHaveLength(0);
  });

  test('keeps a historical workflow v1 edit on v1 without adding scoring fields', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    const historicalCycle: AssessmentCycle = {
      ...integratedCycle,
      id: 'cycle-v1',
      name: '历史季度考核',
      workflowVersion: 1,
      scoringFrequency: undefined,
      reviewFrequency: undefined,
      periodSchedules: undefined,
      companyFinalApproverId: undefined,
      companyFinalApprover: undefined,
      reviewStatus: 'pending',
    };
    await mockIntegratedCyclePage(page, { cycles: [historicalCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${historicalCycle.id}`).click();

    await expect(page.getByTestId('cycle-scoring-settings')).toHaveCount(0);
    await page.getByLabel('周期名称').fill('历史季度考核（修订）');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).not.toHaveProperty('workflowVersion');
    expect(updateBodies[0]).not.toHaveProperty('scoringFrequency');
    expect(updateBodies[0]).not.toHaveProperty('periodSchedules');
    expect(updateBodies[0]).toHaveProperty('expectedPlanVersion', historicalCycle.planVersion);
  });

  test('resubmits an approved historical cycle when any business field changes', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    const approvedHistoricalCycle: AssessmentCycle = {
      ...integratedCycle,
      id: 'cycle-v1-approved',
      name: '历史季度考核',
      workflowVersion: 1,
      scoringFrequency: undefined,
      reviewFrequency: undefined,
      periodSchedules: undefined,
      companyFinalApproverId: undefined,
      companyFinalApprover: undefined,
      reviewStatus: 'approved',
    };
    await mockIntegratedCyclePage(page, { cycles: [approvedHistoricalCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${approvedHistoricalCycle.id}`).click();

    await page.getByLabel('周期名称').fill('历史季度考核（调整）');
    await page.getByRole('button', { name: '下一步' }).click();

    const reviewConfirm = page.getByRole('dialog', { name: '重新提交周期审核？' });
    await expect(reviewConfirm).toBeVisible();
    expect(updateBodies).toHaveLength(0);
    await reviewConfirm.getByRole('button', { name: '确认提交' }).click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).not.toHaveProperty('workflowVersion');
    expect(updateBodies[0]).not.toHaveProperty('scoringFrequency');
  });

  test('lets an HR administrator review a plan from the review pool', async ({ page }) => {
    const reviewBodies: Record<string, unknown>[] = [];
    const pendingCycle: AssessmentCycle = {
      ...integratedCycle,
      reviewerId: undefined,
      reviewer: null,
      reviewStatus: 'pending',
    };
    await mockIntegratedCyclePage(page, { cycles: [pendingCycle], reviewBodies });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: '审核', exact: true }).click();
    await page.getByRole('dialog', { name: '审核考核周期' })
      .getByRole('button', { name: '审核通过' })
      .click();

    await expect.poll(() => reviewBodies).toHaveLength(1);
    expect(reviewBodies[0]).toMatchObject({
      action: 'approve',
      expectedPlanVersion: pendingCycle.planVersion,
    });
  });

  test('submits the current plan version when postponing an active cycle deadline', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    const activeCycle: AssessmentCycle = { ...integratedCycle, status: 'indicator_setting' };
    await mockIntegratedCyclePage(page, { cycles: [activeCycle], updateBodies });
    await page.goto('/cycles?group=active');

    await page.getByRole('button', { name: '更多操作' }).first().click();
    await page.locator('.el-dropdown-menu:visible').getByText('修改截止日', { exact: true }).click();
    const publishDeadline = page.getByPlaceholder('选择结果公示截止');
    await publishDeadline.fill('2027-04-12 18:00');
    await publishDeadline.press('Tab');
    await page.getByRole('dialog', { name: '修改节点截止日' })
      .getByRole('button', { name: '保存' })
      .click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).toMatchObject({
      expectedPlanVersion: activeCycle.planVersion,
    });
  });

  test('shows scoring, fixed review, exceptions, final approver, and v2 preflight dispositions', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId(`cycle-scoring-summary-${integratedCycle.id}`)).toHaveText('月度自评 · 3期');
    await page.getByText(integratedCycle.name, { exact: true }).first().click();
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('月度自评 · 3期');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).not.toContainText('结果审核：按周期审核');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('已调整月份：1个');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('结果审批人：李宏');

    await page.getByRole('button', { name: '发起考核' }).click();
    const preflightSummary = page.getByTestId('cycle-preflight-summary');
    await expect(preflightSummary).toContainText('范围人数2人');
    await expect(preflightSummary).toContainText('参与人员1人');
    await expect(preflightSummary).toContainText('豁免人员1人');
    await expect(preflightSummary).toContainText('未进入范围1人');
    await expect(preflightSummary).not.toContainText('公司最终审定人');

    const participantDetails = page.getByTestId('cycle-preflight-details');
    await participantDetails.locator('summary').click();
    await expect(participantDetails).toContainText('李宏');
    await expect(participantDetails).toContainText('最高负责人豁免');
  });
});
