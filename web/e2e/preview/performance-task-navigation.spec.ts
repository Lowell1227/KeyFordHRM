import { test, expect } from '@playwright/test';

for (const account of ['HR001', 'MGR001', 'EMP001']) {
  test(`${account}: fixed task entries, role scope and original performance todo stay usable`, async ({ page }, info) => {
    expect(info.project.use.baseURL).toBe('http://localhost:5173');
    const writes: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        && url.pathname !== '/api/v1/auth/test-login') writes.push(`${request.method()} ${url.pathname}`);
    });
    await page.goto('/login');
    if (account !== 'HR001') {
      await page.getByTestId('preview-account').click();
      await page.getByRole('option').filter({ hasText: `(${account})` }).click();
    }
    await page.getByTestId('preview-login').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/tasks');
    const navigation = page.getByRole('navigation', { name: '绩效任务视图', exact: true });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link', { name: '我的目标', exact: true })).toHaveAttribute('href', '/tasks?goalView=mine');
    await expect(navigation.getByRole('link', { name: /^目标审核/ })).toHaveAttribute('href', '/tasks?goalView=review');
    await expect(navigation.locator('[data-section="tasks"]')).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[data-section="monitor"]')).toHaveCount(account === 'HR001' ? 1 : 0);

    const secondary = page.getByTestId('performance-secondary-nav');
    await expect(secondary.getByRole('link', { name: '绩效待办', exact: true })).toHaveAttribute('href', '/tasks');
    const originalStages = ['目标制定', '目标确认', '自评', '结果确认'];
    await expect(page.locator('.performance-workspace__context .task-stage-list').first().locator('.task-stage-item > span:first-child')).toHaveText(originalStages);
    if (account === 'MGR001') {
      await expect(page.getByTestId('manager-personal-task-group')).toBeVisible();
      await expect(page.getByTestId('manager-team-task-group')).toBeVisible();
    }
    const position = await navigation.evaluate(element => ({ x: Math.round(element.getBoundingClientRect().x), y: Math.round(element.getBoundingClientRect().y) }));
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const entry = await page.request.get('/api/v1/goal-changes/entry', { headers: { Authorization: `Bearer ${token}` } });
    expect(entry.status()).toBe(200);
    const canChange = (await entry.json()).data.visible === true;
    await expect(navigation.locator('[data-section="changes"]')).toHaveCount(canChange ? 1 : 0);
    const sections = ['mine', 'review', ...(account === 'HR001' ? ['monitor'] : []), ...(canChange ? ['changes'] : []), 'tasks'];
    for (const section of sections) {
      await navigation.locator(`[data-section="${section}"]`).click();
      await expect(navigation.locator(`[data-section="${section}"]`)).toHaveAttribute('aria-current', 'page');
      const actual = new URL(page.url());
      expect(actual.pathname).toBe(section === 'changes' ? '/goal-changes' : '/tasks');
      if (['mine', 'review', 'monitor'].includes(section)) expect(actual.searchParams.get('goalView')).toBe(section);
      expect(await navigation.evaluate(element => ({ x: Math.round(element.getBoundingClientRect().x), y: Math.round(element.getBoundingClientRect().y) }))).toEqual(position);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${section}.png`), fullPage: true });
    }
    await expect(secondary.getByRole('link', { name: '绩效待办', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.performance-workspace__context .task-stage-list').first().locator('.task-stage-item > span:first-child')).toHaveText(originalStages);
    await page.goto('/tasks?goalView=review&employeeName=LC_');
    await expect(navigation.locator('[data-section="review"]')).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(navigation.locator('[data-section="review"]')).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).searchParams.get('employeeName')).toBe('LC_');
    await navigation.locator('[data-section="mine"]').click();
    await page.goBack();
    await expect(navigation.locator('[data-section="review"]')).toHaveAttribute('aria-current', 'page');
    if (account === 'HR001' && info.project.name === 'desktop') {
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(navigation.locator('[data-section="monitor"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath('navigation-1024.png'), fullPage: true });
    }
    if (account === 'EMP001') {
      const monitorReads: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/v1/goal-plans') && url.searchParams.get('scope') === 'monitor') monitorReads.push(url.pathname);
      });
      await page.goto('/tasks?goalView=monitor');
      await expect(page.getByText('无权查看目标台账', { exact: true })).toBeVisible();
      await expect(navigation.locator('[data-section="monitor"]')).toHaveCount(0);
      expect(monitorReads).toEqual([]);
    }
    expect(writes).toEqual([]);
  });
}

test('a late goal-list initialization does not cancel navigation while the next page module loads', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('http://localhost:5173');
  await page.goto('/login'); await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  let delayedOptions = false, delayedModule = false;
  await page.route('**/api/v1/goal-plans/options?**', async route => {
    delayedOptions = true;
    await new Promise(resolve => setTimeout(resolve, 250)); await route.continue();
  });
  await page.route('**/src/views/goal-changes/GoalChangeListView.vue*', async route => {
    delayedModule = true;
    await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue();
  });
  await page.goto('/tasks?goalView=mine');
  const nav = page.getByRole('navigation', { name: '绩效任务视图', exact: true });
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/goal-plans');
  await nav.locator('[data-section="changes"]').click();
  expect((await loaded).ok()).toBe(true);
  await expect(page).toHaveURL(/\/goal-changes$/);
  await expect(nav.locator('[data-section="changes"]')).toHaveAttribute('aria-current', 'page');
  expect(delayedOptions).toBe(true); expect(delayedModule).toBe(true);
  await page.screenshot({ path: info.outputPath('late-load-navigation-retained.png'), fullPage: true });
});
