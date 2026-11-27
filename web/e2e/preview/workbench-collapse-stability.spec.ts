import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function login(page: Page, account = 'HR001') {
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  if (account !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${account})` }).click();
  }
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.workbench-section')).not.toHaveCount(0);
  await expect(page.locator('.workbench-section[aria-busy="true"]')).toHaveCount(0);
}

test('folded workbench stays in place and a single focus does not become repeated polling', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const endpoints = ['/api/v1/workbench/operations', '/api/v1/talent-recruitment/workbench'];
  await login(page);
  for (const toggle of await page.locator('.workbench-section__toggle').all()) {
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  }
  const reads = Object.fromEntries(endpoints.map(path => [path, 0]));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path in reads) reads[path]++;
  });
  // Real responses are delayed, never replaced: temporary loading must not reorder a fold.
  await page.route('**/api/v1/**', async route => {
    if (endpoints.includes(new URL(route.request().url()).pathname)) await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue();
  });
  const layouts = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const states: string[] = [];
    const read = () => JSON.stringify([...document.querySelectorAll('.workbench-section')].map(element => [
      element.getAttribute('aria-label'), Math.round(element.getBoundingClientRect().y),
    ]));
    states.push(read());
    window.dispatchEvent(new Event('focus'));
    const until = performance.now() + 6000;
    while (performance.now() < until) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      states.push(read());
    }
    return [...new Set(states)];
  });
  await info.attach('fold-stability', { body: JSON.stringify({ reads, layouts }, null, 2), contentType: 'application/json' });
  for (const endpoint of endpoints) expect(reads[endpoint], endpoint).toBe(1);
  expect(layouts, 'Folded sections must not jump during temporary loading').toHaveLength(1);
  await expect(page.locator('.workbench-section__toggle[aria-expanded="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('folded-workbench-stable.png'), fullPage: true });
});

for (const account of ['HR001', 'MGR001', 'EMP001']) {
  test(`${account}: expanded workbench keeps content and all queue reads are bounded on returning`, async ({ page }, info) => {
    expect(info.project.use.baseURL).toBe('http://localhost:5173');
    await login(page, account);
    for (const toggle of await page.locator('.workbench-section__toggle').all()) {
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    }
    const readKey = (raw: string) => {
      const url = new URL(raw);
      if (!/^\/api\/v1\/(workbench\/operations|talent-recruitment\/workbench|tasks\/(mine|team)|cycles\/mine|goal-plans|goal-changes\/my-pending|improvement-plans\/my-pending)$/.test(url.pathname)) return '';
      url.searchParams.sort(); return url.pathname + url.search;
    };
    const reads: Record<string, number> = {};
    page.on('request', request => { const key = readKey(request.url()); if (key) reads[key] = (reads[key] ?? 0) + 1; });
    await page.route('**/api/v1/**', async route => {
      if (readKey(route.request().url())) await new Promise(resolve => setTimeout(resolve, 250));
      await route.continue();
    });
    const layouts = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const states: string[] = [];
      const read = () => JSON.stringify([...document.querySelectorAll('.workbench-section')].map(element => [
        element.getAttribute('aria-label'), Math.round(element.getBoundingClientRect().y), Math.round(element.getBoundingClientRect().height),
      ]));
      states.push(read());
      // Browsers commonly emit both events for one return to the tab.
      document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));
      const until = performance.now() + 6000;
      while (performance.now() < until) { await new Promise(resolve => requestAnimationFrame(resolve)); states.push(read()); }
      return [...new Set(states)];
    });
    await writeFile(info.outputPath('expanded-refresh-metrics.json'), JSON.stringify({ reads, layouts }, null, 2));
    for (const path of ['/api/v1/workbench/operations', '/api/v1/talent-recruitment/workbench', '/api/v1/tasks/mine', '/api/v1/cycles/mine', '/api/v1/goal-plans', '/api/v1/goal-changes/my-pending', '/api/v1/improvement-plans/my-pending']) {
      expect(Object.keys(reads).some(key => key.split('?')[0] === path), path).toBe(true);
    }
    for (const [key, count] of Object.entries(reads)) expect(count, key).toBe(1);
    expect(layouts, 'Unchanged queue data must not collapse expanded content during refresh').toHaveLength(1);
    await expect(page.locator('.workbench-section__toggle[aria-expanded="false"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('expanded-workbench-stable.png'), fullPage: true });
  });
}

test('folded personnel section remains present on network failure and retry does not reset the fold', async ({ page }, info) => {
  await login(page);
  const section = page.getByRole('region', { name: '人事事项', exact: true });
  await expect(section).toBeVisible();
  const toggle = section.locator('.workbench-section__toggle');
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  await page.route('**/api/v1/workbench/operations?**', route => route.abort('failed'));
  await section.getByRole('button', { name: '刷新人事事项', exact: true }).click();
  await expect(section).toBeVisible();
  await expect(section.getByRole('alert')).toContainText('暂时无法读取');
  await expect(section.locator('.workbench-section__count')).toHaveText('暂不可用');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.unroute('**/api/v1/workbench/operations?**');
  await section.getByRole('button', { name: '重试', exact: true }).click();
  await expect(section.getByRole('alert')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: info.outputPath('personnel-retry-fold-retained.png'), fullPage: true });
});

test('personnel pagination remains on the same page after returning to the workbench', async ({ page }, info) => {
  await login(page);
  const section = page.getByRole('region', { name: '人事事项', exact: true });
  const toggle = section.locator('.workbench-section__toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await section.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(section.locator('.operation-pages')).toContainText('第 2 页');
  await expect(section).toHaveAttribute('aria-busy', 'false');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/workbench/operations' && r.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(section.locator('.operation-pages')).toContainText('第 2 页');
  await page.screenshot({ path: info.outputPath('personnel-page-retained.png'), fullPage: true });
});
