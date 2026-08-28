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
        body: JSON.stringify(apiResponse({ ...matchedCycle, ...body })),
      });
    }
    if (request.method() === 'POST' && path.endsWith('/review')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.reviewBodies?.push(body);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          ...matchedCycle,
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
    await expect(page.getByTestId('cycle-scoring-monthly').locator('input')).toBeChecked();
    await expect(page.getByTestId('cycle-review-frequency')).toContainText('按周期审核');
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
  });

  test('fixes monthly and custom cycles to their required scoring frequency', async ({ page }) => {
    await mountScoringPlanHarness(page);

    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-monthly').click();
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('固定按月评分');

    await page.getByTestId('cycle-type-custom').click();
    await expect(page.getByTestId('cycle-scoring-settings')).toContainText('按整个周期评分');
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
    await page.getByTestId('cycle-scoring-cycle').click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-month-schedule-row')).toContainText('整个周期');
  });

  test('renders schedule details and keeps editor updates, restores, issues, and unified choices explicit', async ({ page }) => {
    await mountScoringPlanHarness(page);
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-type-quarterly').click();

    const firstRow = page.getByTestId('cycle-month-schedule-row').first();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    await expect(firstRow.getByTestId('cycle-period-label')).toHaveText('2027年1月');
    await expect(firstRow.getByTestId('self-eval-open-at').locator('input')).toHaveValue('2027-01-01 09:00');
    await expect(firstRow.getByTestId('self-eval-due-at').locator('input')).toHaveValue('2027-01-03 18:00');
    await expect(firstRow.getByTestId('manager-due-at').locator('input')).toHaveValue('2027-01-06 18:00');
    await expect(secondRow.getByTestId('cycle-special-month-badge')).toHaveText('特殊月份');
    await expect(secondRow).toContainText('该月与相邻计划有重叠风险');
    await expect(secondRow).toContainText('主管完成时间不得早于员工完成时间');
    await expect(page.getByTestId('cycle-apply-unified')).toHaveText('重新应用默认规则');
    await expect(page.getByTestId('cycle-apply-unified')).not.toHaveText('统一调整规则');

    await firstRow.getByTestId('cycle-special-month-button').click();
    await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveText('特殊月份');
    await expect(page.getByTestId('cycle-immutable-update')).toHaveText('array:true:row:true');

    await firstRow.getByTestId('cycle-restore-one').click();
    await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveCount(0);
    await expect(page.getByTestId('cycle-restore-one-count')).toHaveText('1');

    await firstRow.getByTestId('cycle-special-month-button').click();
    await page.getByTestId('cycle-restore-all').click();
    await expect(firstRow.getByTestId('cycle-special-month-badge')).toHaveCount(0);
    await expect(page.getByTestId('cycle-restore-all-count')).toHaveText('1');

    await page.getByTestId('cycle-apply-unified').click();
    await expect(page.getByTestId('cycle-apply-unified-value')).toHaveText('true');
    await page.getByTestId('cycle-preserve-exceptions').click();
    await page.getByTestId('cycle-apply-unified').click();
    await expect(page.getByTestId('cycle-apply-unified-value')).toHaveText('false');
  });
});

test.describe('cycle scoring plan integration', () => {
  test('creates workflow v2 with a normalized special-month schedule after explicit warning confirmation', async ({ page }) => {
    const createBodies: Record<string, unknown>[] = [];
    const previewBodies: Record<string, unknown>[] = [];
    await mockIntegratedCyclePage(page, {
      createBodies,
      previewBodies,
      warnings: [{ code: 'CROSS_MONTH_WARNING', periodKey: '2027-02', message: '主管完成时间跨月，请确认安排' }],
    });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);
    await page.getByTestId('cycle-scoring-monthly').click();
    const secondRow = page.getByTestId('cycle-month-schedule-row').nth(1);
    const managerDueInput = secondRow.getByTestId('manager-due-at').locator('input');
    await managerDueInput.fill('2027-03-10 18:00');
    await managerDueInput.press('Tab');
    await expect(secondRow.getByTestId('cycle-special-month-badge')).toHaveText('特殊月份');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByRole('dialog', { name: '确认评分计划提示' })).toContainText('主管完成时间跨月，请确认安排');
    expect(previewBodies).toContainEqual(expect.objectContaining({
      schedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2027-02', isException: true }),
      ]),
    }));
    expect(createBodies).toHaveLength(0);
    await page.getByRole('button', { name: '确认并继续' }).click();
    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies.at(-1)).toMatchObject({
      workflowVersion: 2,
      scoringFrequency: 'monthly',
      periodSchedules: expect.arrayContaining([
        expect.objectContaining({ periodKey: '2027-02', isException: true }),
      ]),
    });
    expect(createBodies.at(-1)).not.toHaveProperty('reviewFrequency');
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

  test('warns that an approved workflow v2 draft needs review again after scoring frequency changes', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-scoring-cycle').click();
    await expect(page.getByRole('dialog', { name: '重新生成还是保留当前评分计划？' })).toBeVisible();
    await page.getByRole('button', { name: '重新生成评分计划' }).click();

    await expect(page.getByTestId('cycle-review-reset-warning')).toContainText('修改后需重新审核');
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(1);
  });

  test('restores the confirmed frequency and schedule when special-month regeneration is declined', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId(`cycle-edit-${integratedCycle.id}`).click();
    await expect(page.getByTestId('cycle-month-schedule-row')).toHaveCount(3);

    await page.getByTestId('cycle-scoring-cycle').click();
    const confirmation = page.getByRole('dialog', { name: '重新生成还是保留当前评分计划？' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '保留当前评分计划' }).click();

    await expect(page.getByTestId('cycle-scoring-monthly').locator('input')).toBeChecked();
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

    await page.getByTestId('cycle-scoring-cycle').click();
    await page.getByTestId('cycle-scoring-monthly').click();
    await expect.poll(() => previewCompletions).toContain(0);

    await expect(page.getByTestId('cycle-scoring-monthly').locator('input')).toBeChecked();
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
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('按月评分 · 3个月');
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

    await page.getByTestId('cycle-scoring-cycle').click();
    await expect(page.getByTestId('cycle-review-reset-warning')).toContainText('修改后需重新审核');
    await page.getByTestId('cycle-scoring-monthly').click();

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

  test('submits the inspected plan version when the assigned reviewer approves', async ({ page }) => {
    const reviewBodies: Record<string, unknown>[] = [];
    const pendingCycle: AssessmentCycle = { ...integratedCycle, reviewStatus: 'pending' };
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

  test('shows scoring, fixed review, exceptions, final approver, and v2 preflight dispositions', async ({ page }) => {
    await mockIntegratedCyclePage(page, { cycles: [integratedCycle] });
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId(`cycle-scoring-summary-${integratedCycle.id}`)).toHaveText('按月评分 · 3个月');
    await page.getByText(integratedCycle.name, { exact: true }).first().click();
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('按月评分 · 3个月');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('结果审核：按周期审核');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('特殊月份：1个');
    await expect(page.getByTestId('cycle-workspace-scoring-summary')).toContainText('公司最终审定人：李宏');

    await page.getByRole('button', { name: '开始发起检查' }).click();
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('试用期排除：1人');
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('最高负责人豁免：李宏');
    await expect(page.getByTestId('cycle-preflight-summary')).toContainText('本次发起公司最终审定人：李宏');
  });
});
