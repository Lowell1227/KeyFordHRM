import { expect, test, type Page } from '@playwright/test';

async function mockEntry(
  page: Page,
  options: { manager?: boolean; mismatch?: boolean; denied?: boolean } = {},
) {
  const writes: string[] = [],
    reads: string[] = [];
  const period = {
    id: 'period-sep',
    taskId: options.mismatch ? 'different-task' : 'task-1',
    periodKey: '2026-09',
    periodType: 'month',
    status: options.manager ? 'manager_scoring' : 'self_eval',
    sequence: 1,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    selfEvalOpenAt: '2026-09-01T00:00:00Z',
    selfEvalDueAt: '2026-10-03T00:00:00Z',
    managerDueAt: '2026-10-08T00:00:00Z',
    employeeSubmittedAt: options.manager ? '2026-10-01T00:00:00Z' : null,
    managerSubmittedAt: null,
    selfScoreTotal: 80,
    managerScoreTotal: null,
    selfGrade: 'B',
    managerGrade: null,
    draftVersion: 1,
    attachments: [],
  };
  const review = {
    period,
    context: {
      cycleName: '合成季度绩效 · 很长的周期名称用于手机换行验证',
      employeeName: '合成员工',
      employeeNo: 'SYNTHETIC',
      deptName: '合成部门',
      managerName: '合成期间主管',
      statusLabel: '填写中',
    },
    permissions: {
      canEditEmployee: !options.manager,
      canEditManager: !!options.manager,
      viewerRole: options.manager ? 'manager' : 'employee',
    },
    indicators: [
      {
        indicatorVersionItemId: 'item-1',
        sourceInstanceId: 'indicator-1',
        name: '合成项目交付目标',
        description: '按实际交付核对',
        scoringStandard: '按既有规则评价',
        targetValue: 10,
        targetValueText: null,
        unit: '家',
        weight: 1,
        isScoreRequired: true,
        monthlyProgressSource: 'draft_or_result',
        progress: 60,
        healthStatus: 'on_track',
        actualValueText: null,
        employeeComment: '合成自评草稿',
        problemReason: null,
        nextMonthPlan: null,
        supportNeeded: null,
        attachments: [],
        selfScore: 80,
        managerScore: 81,
        managerComment: '合成主管草稿',
        latestProgress: null,
        progressReferences: [],
        alignedObjectives: [],
        history: [],
      },
    ],
  };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-card-entry');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      endpoint = new URL(request.url()).pathname;
    reads.push(endpoint);
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(endpoint);
    if (options.denied && endpoint.includes('/assessment-periods/')) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 4003, message: '无权查看该期复盘' }),
      });
      return;
    }
    let data: unknown = [];
    if (endpoint.endsWith('/auth/me'))
      data = {
        id: options.manager ? 'frozen-period-manager' : 'employee',
        name: '合成测试人',
        sysRole: options.manager ? 'manager' : 'employee',
        businessCapabilities: { canManageTeam: !!options.manager },
      };
    else if (endpoint.endsWith('/notifications/unread-count')) data = 0;
    else if (endpoint.endsWith('/assessment-periods/period-sep/review'))
      data = review;
    else if (endpoint.endsWith('/tasks/task-1'))
      data = {
        id: 'task-1',
        cycleId: 'cycle-1',
        cycleName: '合成季度绩效',
        workflowVersion: 2,
        employeeId: 'employee',
        employeeName: '合成员工',
        managerId: 'different-task-manager',
        managerName: '另一名任务主管',
        status: 'self_eval',
        isExempt: false,
        periods: [
          period,
          { ...period, id: 'period-oct', periodKey: '2026-10', sequence: 2 },
        ],
        indicatorInstances: [],
        flowRecords: [],
        workflowContext: {
          stage: 'self_eval',
          statusLabel: '待员工自评',
          currentHandler: {
            id: 'employee',
            name: '合成员工',
            nodeType: 'employee',
          },
          currentDeadline: null,
          canRemind: false,
        },
      };
    else if (endpoint.endsWith('/cycles/cycle-1'))
      data = {
        id: 'cycle-1',
        name: '合成季度绩效',
        type: 'quarterly',
        status: 'self_eval',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        publishVisibleFields: {},
      };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'success', data }),
    });
  });
  return { writes, reads };
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
  [320, 844],
]) {
  test(`frozen manager card entry uses period permissions without reading the whole task ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    const { reads, writes } = await mockEntry(page, { manager: true });
    await page.goto('/tasks/task-1/periods/period-sep');
    await expect(
      page.getByTestId('manager-period-review-workspace'),
    ).toBeVisible();
    await expect(page.getByTestId('period-review-entry-context')).toContainText(
      '2026-09',
    );
    await expect(page.getByTestId('monthly-review-workspace')).toHaveCount(0);
    expect(reads).not.toContain('/api/v1/tasks/task-1');
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`frozen-period-manager-${width}.png`),
      fullPage: true,
    });
  });
}
test('personal period entry opens the employee form and survives refresh without changing period', async ({
  page,
}) => {
  const { writes } = await mockEntry(page);
  await page.goto('/tasks/task-1/periods/period-sep');
  await expect(page.getByTestId('monthly-review-workspace')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('monthly-review-workspace')).toBeVisible();
  expect(page.url()).toContain('/periods/period-sep');
  expect(writes).toEqual([]);
});
test('cross-task period entry is rejected rather than opening a different form', async ({
  page,
}) => {
  const { writes } = await mockEntry(page, { mismatch: true });
  await page.goto('/tasks/task-1/periods/period-sep');
  await expect(page.getByTestId('period-review-entry-error')).toContainText(
    '不属于',
  );
  await expect(page.getByTestId('monthly-review-workspace')).toHaveCount(0);
  await expect(page.getByTestId('manager-period-review-workspace')).toHaveCount(
    0,
  );
  expect(writes).toEqual([]);
});
test('a permission failure is shown without a writable form', async ({
  page,
}) => {
  const { writes } = await mockEntry(page, { denied: true });
  await page.goto('/tasks/task-1/periods/period-sep');
  await expect(page.getByTestId('period-review-entry-error')).toContainText(
    '无权',
  );
  await expect(page.getByTestId('monthly-review-workspace')).toHaveCount(0);
  expect(writes).toEqual([]);
});
test('an explicit invalid period on the original task route never falls back to September or October', async ({
  page,
}) => {
  const { reads, writes } = await mockEntry(page);
  await page.goto('/tasks/task-1?stage=self-eval&periodId=another-task-period');
  await expect(
    page.getByTestId('performance-period-unavailable'),
  ).toContainText('期间');
  await expect(page.getByTestId('monthly-review-workspace')).toHaveCount(0);
  expect(reads.filter((url) => url.includes('/assessment-periods/'))).toEqual(
    [],
  );
  expect(writes).toEqual([]);
});
