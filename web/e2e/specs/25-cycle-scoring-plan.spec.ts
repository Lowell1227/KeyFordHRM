import { expect, test } from '@playwright/test';

function buildSchedules(count: number, scoringFrequency: 'monthly' | 'cycle') {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    return {
      periodKey: scoringFrequency === 'cycle' ? '2027-cycle' : `2027-${month}`,
      periodType: scoringFrequency === 'cycle' ? 'cycle' : 'month',
      sequence: index + 1,
      periodStart: `2027-${month}-01`,
      periodEnd: `2027-${month}-28`,
      selfEvalOpenAt: `2027-${month}-01 09:00`,
      selfEvalDueAt: `2027-${month}-03 18:00`,
      managerDueAt: `2027-${month}-06 18:00`,
      isException: false,
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
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          scoringFrequency,
          reviewFrequency: 'cycle',
          schedules: buildSchedules(count, scoringFrequency),
          blockers: [],
          warnings: [],
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
  });
});
