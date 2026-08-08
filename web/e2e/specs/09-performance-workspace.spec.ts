import { expect, test } from '@playwright/test';

test.describe('09-performance-workspace manager shell', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  for (const entry of [
    { path: '/action-items', current: '目标跟进' },
    { path: '/objectives', current: '目标地图' },
    { path: '/tasks', current: '绩效待办' },
  ]) {
    test(`${entry.current} uses shared performance navigation`, async ({ page }) => {
      await page.goto(entry.path);
      const nav = page.getByTestId('performance-secondary-nav');

      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标跟进' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '目标地图' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '绩效待办' })).toBeVisible();
      await expect(nav.getByRole('link', { name: entry.current })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  test('objective map exposes compact filters and one continuous data surface', async ({ page }) => {
    await page.goto('/objectives');

    await expect(page.getByTestId('objective-map-toolbar')).toBeVisible();
    await expect(page.getByTestId('objective-level-filter')).toBeVisible();
    await expect(page.getByTestId('objective-map-surface')).toBeVisible();
    await expect(page.getByTestId('objective-create')).toBeVisible();
  });
});
