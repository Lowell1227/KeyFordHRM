import { expect, test } from '@playwright/test';

// Real Vue/Element Plus controls, no stub components or business API requests.
test.beforeEach(async ({ page }) => {
  await page.goto(`/e2e/fixtures/contract-date-input-harness.html${process.env.CONTRACT_DATE_BASELINE === '1' ? '?baseline=1' : ''}`);
  await expect(page.locator('[data-field="signedAt"] input')).toHaveValue('2026-02-28');
});

test('invalid typed calendar days remain visible and block submit after Tab and Enter', async ({ page }) => {
  const field = page.locator('[data-field="signedAt"]'), input = field.locator('input');
  for (const key of ['Tab', 'Enter']) {
    for (const invalid of ['2026-02-31', '2026-02-29', '2026-13-01', 'not-a-date']) {
      await input.fill(invalid);
      await input.press(key);
      await expect(input).toHaveValue(invalid);
      await expect(field.locator('.el-form-item__error')).toHaveText('请填写有效日期');
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('submitted')).toHaveText('[]');
      expect(JSON.parse(await page.getByTestId('model').innerText()).signedAt).toBe(invalid);
    }
  }
});

test('correcting, clearing and external record changes recover without stale input', async ({ page }) => {
  const field = page.locator('[data-field="signedAt"]'), input = field.locator('input');
  await input.fill('2026-02-31');
  await input.press('Tab');
  await expect(field.locator('.el-form-item__error')).toHaveText('请填写有效日期');
  await input.fill('2028-02-29');
  await input.press('Enter');
  await expect(input).toHaveValue('2028-02-29');
  await expect(field.locator('.el-form-item__error')).toHaveCount(0);
  await page.getByTestId('submit').click();
  expect(JSON.parse(await page.getByTestId('submitted').innerText())[0].signedAt).toBe('2028-02-29');
  await input.fill('2026-02-31');
  await input.hover();
  await field.locator('.el-input__clear').click();
  await expect(input).toHaveValue('');
  await expect(field.locator('.el-form-item__error')).toHaveCount(0);
  await page.getByTestId('submit').click();
  expect(JSON.parse(await page.getByTestId('submitted').innerText())[1].signedAt).toBeNull();
  await input.fill('invalid-date');
  await page.getByTestId('switch-record').click();
  await expect(input).toHaveValue('2027-06-01');
  await expect(field.locator('.el-form-item__error')).toHaveCount(0);
});

test('calendar choice replaces invalid text and remains usable at mobile width', async ({ page }) => {
  const field = page.locator('[data-field="signedAt"]'), input = field.locator('input');
  await input.fill('2026-02-31');
  await input.press('Tab');
  await field.getByRole('button', { name: '选择日期' }).click();
  const calendar = page.locator('.contract-date-calendar:visible');
  await expect(calendar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await calendar.locator('td.available:not(.prev-month):not(.next-month)').filter({ hasText: /^15$/ }).click();
  await expect(input).toHaveValue('2026-02-15');
  await expect(field.locator('.el-form-item__error')).toHaveCount(0);
  await expect(calendar).toHaveCount(0);
  await page.getByTestId('submit').click();
  expect(JSON.parse(await page.getByTestId('submitted').innerText())[0].signedAt).toBe('2026-02-15');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('all three fields enforce calendar validity, retain range checks and inherit disabled state', async ({ page }) => {
  for (const field of ['signedAt', 'effectiveFrom', 'expiresAt']) {
    const container = page.locator(`[data-field="${field}"]`);
    await container.locator('input').fill('2026-02-31');
    await container.locator('input').press('Tab');
    await expect(container.locator('.el-form-item__error')).toHaveText('请填写有效日期');
    await container.locator('input').fill('2026-03-01');
  }
  await page.locator('[data-field="signedAt"] input').fill('2026-04-01');
  await page.locator('[data-field="expiresAt"] input').fill('2026-02-28');
  await page.getByTestId('submit').click();
  await expect(page.locator('[data-field="expiresAt"] .el-form-item__error')).toHaveText('到期日期不能早于生效日期');
  await expect(page.getByTestId('submitted')).toHaveText('[]');
  await page.locator('[data-field="expiresAt"] input').fill('2026-03-31');
  await page.getByTestId('submit').click();
  expect(JSON.parse(await page.getByTestId('submitted').innerText())).toHaveLength(1);
  await page.getByTestId('toggle-disabled').click();
  await expect(page.locator('[data-field="signedAt"] input')).toBeDisabled();
  await expect(page.locator('[data-field="signedAt"]').getByRole('button', { name: '选择日期' })).toBeDisabled();
});
