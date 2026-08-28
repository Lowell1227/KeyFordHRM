import { expect, test } from '@playwright/test';

function buildSchedules(count: number, scoringFrequency: 'monthly' | 'cycle') {
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
