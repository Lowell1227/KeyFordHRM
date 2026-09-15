import { expect, test } from '@playwright/test';

test.describe('HR business list templates', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('appeals uses the record template on desktop and mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/appeals');

    const listPage = page.getByTestId('business-list-page');
    await expect(listPage).toHaveAttribute('data-list-variant', 'record');
    await expect(listPage.locator('.desktop-result-table')).toBeVisible();
    await expect(listPage.locator('.mobile-result-list')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(listPage.locator('.desktop-result-table')).toBeHidden();
    await expect(listPage.locator('.mobile-result-list')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
  });

  test('confirmation management uses the workflow template', async ({ page }) => {
    await page.goto('/confirmation-applications/manage');

    await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'workflow');
  });
});

test.describe('administrator business list templates', () => {
  test.use({ storageState: 'e2e/auth-state/admin.json' });

  test('employee roster uses the split master-data template', async ({ page }) => {
    await page.goto('/users');

    await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'split-master');
    await expect(page.getByTestId('split-list-layout')).toBeVisible();
  });
});
