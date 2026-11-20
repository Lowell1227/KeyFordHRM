import { test, expect, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
async function install(page: Page, failExport = false) {
  const queries: URLSearchParams[] = [], exports: URLSearchParams[] = [];
  await page.addInitScript(() => localStorage.setItem('token', 'mock-talent-export'));
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr', name: '虚构使用者', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/application-positions')) return route.fulfill(envelope(['财务', '运营']));
    if (path.endsWith('/talents/export')) {
      exports.push(url.searchParams);
      if (failExport) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '导出超过5000行，请缩小筛选范围' }) });
      return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('synthetic-workbook-download') });
    }
    if (path.endsWith('/talents')) {
      queries.push(url.searchParams);
      return route.fulfill(envelope({ items: [], total: 41 }));
    }
    return route.fulfill(envelope([]));
  });
  return { queries, exports };
}

for (const width of [1440, 390]) {
  test(`application filters include historical roles and export all matching rows at ${width}px (mock)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { queries, exports } = await install(page);
    await page.goto('/talents');
    await expect(page.getByRole('button', { name: '导出应聘记录', exact: true })).toBeVisible();
    await page.getByTestId('talent-filter-application-position').click();
    await page.getByRole('option', { name: '财务', exact: true }).click();
    await page.getByTestId('talent-filter-application-stage').click();
    await page.getByRole('option', { name: '已淘汰', exact: true }).click();
    await page.getByPlaceholder('最低元/月', { exact: true }).fill('5501');
    await page.getByPlaceholder('最低元/月', { exact: true }).press('Tab');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出应聘记录', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/^人才应聘记录-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(exports).toHaveLength(1);
    expect(Object.fromEntries(exports[0])).toEqual({ applicationPosition: '财务', applicationStage: 'rejected', salaryMinYuan: '5501' });
    expect(queries.at(-1)?.get('applicationPosition')).toBe('财务');
    expect(queries.at(-1)?.get('applicationStage')).toBe('rejected');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.talent-filter-bar__switches').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('application-export.png'), fullPage: true, animations: 'disabled' });
  });
}

test('an export rejected by the server displays its reason and allows retry (mock)', async ({ page }) => {
  const { exports } = await install(page, true);
  let downloads = 0; page.on('download', () => downloads++);
  await page.goto('/talents');
  await expect(page.getByRole('button', { name: '导出应聘记录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出应聘记录', exact: true }).click();
  await expect(page.getByText('导出超过5000行，请缩小筛选范围', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出应聘记录', exact: true })).toBeEnabled();
  expect(exports).toHaveLength(1); expect(downloads).toBe(0);
});
