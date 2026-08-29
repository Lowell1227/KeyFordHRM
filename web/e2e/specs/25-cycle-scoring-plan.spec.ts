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
      const count = scoringFrequency === 'cycle'
        ? 1
        : ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as Record<string, number>)[String(body.type)] ?? 1;
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
            ?? buildSchedules(count, scoringFrequency).map((schedule) => ({ ...schedule, isException: false })),
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
    const body = route.request().postDataJSON() as { type: string; scoringFrequency?: 'monthly' | 'cycle' };
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
          warnings: [{ code: 'overlap_warning', periodKey: '2027-02', message: '该月与相邻计划有重叠风险' }],
          blockers: [{ code: 'manager_due_before_self', periodKey: '2027-02', message: '主管完成时间不得早于员工完成时间' }],
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
          schedules: buildSchedules(count, scoringFrequency),
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
  test('shows three monthly schedules for a quarterly cycle by default', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).toBeChecked();
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('每月复盘并评分');
    await expect(page.getByText('按月度评分', { exact: true })).toHaveCount(0);
    await expect(page.getByText('月度跟进', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cycle-review-frequency')).toHaveCount(0);
    await expect(page.getByText('复盘与评分', { exact: true })).toHaveCount(0);
    await expect(page.getByText('评分计划', { exact: true })).toHaveCount(0);
    await expect(page.getByText('结果审核按整个周期统一进行', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
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
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('当前周期不支持月度复盘');
  });

  test('shows six and twelve monthly schedule rows for semiannual and annual cycles', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-semiannual').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(6);

    await page.getByTestId('cycle-type-annual').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(12);
  });

  test('shows one overall schedule when a quarterly cycle uses cycle scoring', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();
    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-month-schedule-row')).toContainText('整个周期');
    await expect(page.getByTestId('cycle-schedule-column-header')).not.toBeVisible();
  });

  test('renders a compact scoring schedule with only contextual restore actions', async ({ page }) => {
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();

    const firstRow = page.getByTestId('cycle-month-schedule-row').first();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(page.getByTestId('cycle-schedule-column-header')).toBeVisible();
    await expect(firstRow.getByTestId('cycle-period-label')).toHaveText('2027年1月');
    await expect(firstRow.getByTestId('self-eval-open-at').locator('input')).toHaveValue('2027-01-01 09:00');
    await expect(firstRow.getByTestId('self-eval-due-at').locator('input')).toHaveValue('2027-01-03 18:00');
    await expect(firstRow.getByTestId('manager-due-at').locator('input')).toHaveValue('2027-01-06 18:00');
    await expect(secondRow.getByTestId('cycle-special-month-badge')).toHaveText('已调整');
    await expect(secondRow).toContainText('该月与相邻计划有重叠风险');
    await expect(secondRow).toContainText('主管完成时间不得早于员工完成时间');
    await expect(page.getByTestId('cycle-apply-unified')).toHaveCount(0);
    await expect(page.getByTestId('cycle-preserve-exceptions')).toHaveCount(0);
    await expect(firstRow.getByTestId('cycle-special-month-button')).toHaveCount(0);
    await expect(firstRow.getByTestId('cycle-restore-one')).toHaveCount(0);

    const managerDueInput = firstRow.getByTestId('manager-due-at').locator('input');
    await managerDueInput.fill('2027-01-08 18:00');
    await managerDueInput.press('Tab');
    await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveText('已调整');
    await expect(page.getByTestId('cycle-immutable-update')).toHaveText('array:true:row:true');

    await expect(firstRow.getByTestId('cycle-restore-one')).toHaveText('恢复本月默认');
    await firstRow.getByTestId('cycle-restore-one').click();
    await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveCount(0);
    await expect(page.getByTestId('cycle-restore-one-count')).toHaveText('1');

    await expect(page.getByTestId('cycle-restore-all')).toHaveText('全部恢复默认');
    await page.getByTestId('cycle-restore-all').click();
    await expect(secondRow.getByTestId('cycle-special-month-badge')).toHaveCount(0);
    await expect(page.getByTestId('cycle-restore-all-count')).toHaveText('1');
    await expect(page.getByTestId('cycle-restore-all')).toHaveCount(0);
  });

  test('keeps the scoring schedule usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();

    const firstRow = page.getByTestId('cycle-month-schedule-row').first();
    await expect(page.getByTestId('cycle-schedule-column-header')).not.toBeVisible();
    await expect(firstRow.getByText('自评开放时间', { exact: true })).toBeVisible();
    await expect(firstRow.getByText('员工计划完成时间', { exact: true })).toBeVisible();
    await expect(firstRow.getByText('主管计划完成时间', { exact: true })).toBeVisible();
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
      warnings: [{ code: 'CROSS_MONTH_WARNING', periodKey: '2027-02', message: '主管完成时间跨月，请确认安排' }],
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const createDialog = page.getByRole('dialog', { name: '创建绩效周期' });
    const reviewPlan = createDialog.getByTestId('cycle-review-plan');
    await expect(reviewPlan).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-scoring-settings')).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    await expect(reviewPlan.getByTestId('cycle-plan-summary')).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-review-settings-help')).toBeVisible();
    await expect(reviewPlan.getByTestId('cycle-schedule-help')).toBeVisible();
    expect(await reviewPlan.locator('.cycle-monthly-schedule-editor').evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true);
    await expect(createDialog.getByText('审核人', { exact: true })).toHaveCount(0);
    await expect(createDialog.getByText('月度跟进', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    const managerDueInput = secondRow.getByTestId('manager-due-at').locator('input');
    await managerDueInput.fill('2027-03-10 18:00');
    await managerDueInput.press('Tab');
    await expect(secondRow.getByTestId('cycle-special-month-badge')).toHaveText('已调整');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByRole('dialog', { name: '确认评分计划提示' })).toHaveCount(0);
    expect(previewBodies).toContainEqual(expect.objectContaining({
      schedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2027-02', isException: true }),
      ]),
    }));
    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies.at(-1)).not.toHaveProperty('reviewerId');
    expect(createBodies.at(-1)).toMatchObject({
      workflowVersion: 2,
      scoringFrequency: 'monthly',
      monthlyFollowUpRequired: true,
      periodSchedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2027-02', isException: true }),
      ]),
    });
    expect(createBodies.at(-1)).not.toHaveProperty('reviewFrequency');
  });

  test('submits one disabled monthly-review setting as cycle scoring and compatibility false', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await page.getByRole('button', { name: '下一步' }).click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      workflowVersion: 2,
      scoringFrequency: 'cycle',
      monthlyFollowUpRequired: false,
    });
  });

  test('uses authoritative edited-schedule blockers, treats equality as invalid, and waits before submit', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    const previewBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      previewBodies,
      previewResolver: (body) => {
        if (!Array.isArray(body.schedules)) return {};
        return {
          delayMs: 120,
          blockers: [{
            code: 'SELF_EVAL_DUE_NOT_BEFORE_MANAGER_DUE',
            periodKey: '2027-02',
            message: '服务端：自评截止时间必须早于主管评分截止时间',
          }],
        };
      },
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(secondRow).toBeVisible();

    await secondRow.getByTestId('manager-due-at').locator('input').fill('2027-02-03 18:00');
    await page.getByRole('button', { name: '下一步' }).click();

    expect(createBodies).toHaveLength(0);
    expect(previewBodies).toContainEqual(expect.objectContaining({
      schedules: expect.arrayContaining([
        expect.objectContaining({
          periodKey: '2027-02',
          selfEvalDueAt: '2027-02-03T18:00:00+08:00',
          managerDueAt: '2027-02-03T18:00:00+08:00',
        }),
      ]),
    }));
    await expect(secondRow).toContainText('服务端：自评截止时间必须早于主管评分截止时间');
    await expect(secondRow.getByTestId('manager-due-at').locator('input')).toBeFocused();
  });

  test('blocks submission and focuses the invalid schedule row', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      blockers: [{
        code: 'MANAGER_DUE_BEFORE_SELF_EVAL',
        periodKey: '2027-02',
        message: '主管完成时间不得早于员工完成时间',
      }],
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByRole('button', { name: '下一步' }).click();

    expect(createBodies).toHaveLength(0);
    const invalidRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(invalidRow).toContainText('主管完成时间不得早于员工完成时间');
    await expect(invalidRow.getByTestId('manager-due-at').locator('input')).toBeFocused();
  });

  test('asks to resubmit an approved cycle only when Next is clicked after scoring changes', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-monthly-review-switch').click();
    await expect(page.getByRole('dialog', { name: '确认重新生成评分计划？' })).toBeVisible();
    await page.getByRole('button', { name: '重新生成评分计划' }).click();

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
    await expect(reviewConfirm).toContainText('本次修改会使已审核的周期计划重新进入待审核状态');
    await reviewConfirm.getByRole('button', { name: '确认提交' }).click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).toMatchObject({ name: '2027 Q1 季度考核（调整）' });
  });

  test('restores the confirmed frequency and schedule when adjusted-schedule regeneration is declined', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-monthly-review-switch').click();
    const confirmation = page.getByRole('dialog', { name: '确认重新生成评分计划？' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '保留当前评分计划' }).click();

    await expect(page.getByTestId('cycle-monthly-review-switch').locator('input')).toBeChecked();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    await expect(page.getByTestId('cycle-review-reset-warning')).toHaveCount(0);
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
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('每月复盘并评分 · 3期');
  });

  test('treats persisted schedule ids as non-semantic after an approved plan is changed then restored', async ({ page }) => {
    const updateBodies: Record<string, unknown>[] = [];
    const cycleWithPersistedScheduleIds: AssessmentCycle = {
      ...integratedCycle,
      periodSchedules: buildSchedules(3, 'monthly').map((schedule, index) => ({
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
    await page.getByRole('dialog', { name: '审核周期计划' })
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

    await expect(page.getByTestId(`cycle-scoring-summary-${integratedCycle.id}`)).toHaveText('每月复盘并评分 · 3期');
    await page.getByText(integratedCycle.name, { exact: true }).first().click();
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('每月复盘并评分 · 3期');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('结果审核：按周期审核');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('已调整月份：1个');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('公司最终审定人：李宏');

    await page.getByRole('button', { name: '开始发起' }).click();
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('试用期排除：1人');
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('最高负责人豁免：李宏');
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('本次发起公司最终审定人：李宏');
  });
});
