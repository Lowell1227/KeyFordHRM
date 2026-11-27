import { test, expect, type Page } from '@playwright/test';

async function taskPeerMenu(page: Page) {
  const sidebar = page.getByRole('complementary', { name: '系统导航', exact: true });
  const group = sidebar.locator('.menu-group').filter({ has: page.locator('.menu-link').filter({ hasText: /^绩效任务$/ }) });
  const toggle = group.locator('.menu-group__title');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  return group.locator('.menu-link');
}

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
    const entryResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/goal-changes/entry' && r.ok());
    await page.goto('/tasks');
    const canChange = (await (await entryResponse).json()).data.visible === true;
    const navigation = page.getByRole('navigation', { name: '绩效任务视图', exact: true });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link', { name: '我的目标', exact: true })).toHaveAttribute('href', '/tasks?goalView=mine');
    await expect(navigation.getByRole('link', { name: /^目标审核/ })).toHaveAttribute('href', '/tasks?goalView=review');
    await expect(navigation.locator('[data-section="tasks"]')).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[data-section="monitor"], [data-section="changes"]')).toHaveCount(0);
    await expect(navigation.getByRole('link')).toHaveText(['我的目标', /^目标审核/, '绩效待办']);
    const peers = await taskPeerMenu(page);
    await expect(peers).toHaveText(['绩效任务', ...(account === 'HR001' ? ['目标台账'] : []), ...(canChange ? ['目标变更'] : [])]);

    const secondary = page.getByTestId('performance-secondary-nav');
    await expect(secondary.getByRole('link', { name: '绩效待办', exact: true })).toHaveAttribute('href', '/tasks');
    const originalStages = ['目标制定', '目标确认', '自评', '结果确认'];
    await expect(page.locator('.performance-workspace__context .task-stage-list').first().locator('.task-stage-item > span:first-child')).toHaveText(originalStages);
    if (account === 'MGR001') {
      await expect(page.getByTestId('manager-personal-task-group')).toBeVisible();
      await expect(page.getByTestId('manager-team-task-group')).toBeVisible();
    }
    const position = await navigation.evaluate(element => ({ x: Math.round(element.getBoundingClientRect().x), y: Math.round(element.getBoundingClientRect().y) }));
    const sections = ['mine', 'review', 'tasks'];
    for (const section of sections) {
      await navigation.locator(`[data-section="${section}"]`).click();
      await expect(navigation.locator(`[data-section="${section}"]`)).toHaveAttribute('aria-current', 'page');
      const actual = new URL(page.url());
      expect(actual.pathname).toBe('/tasks');
      if (['mine', 'review'].includes(section)) expect(actual.searchParams.get('goalView')).toBe(section);
      await expect(peers.filter({ hasText: /^绩效任务$/ })).toHaveAttribute('aria-current', 'page');
      expect(await navigation.evaluate(element => ({ x: Math.round(element.getBoundingClientRect().x), y: Math.round(element.getBoundingClientRect().y) }))).toEqual(position);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${section}.png`), fullPage: true });
    }
    const peerPages = [
      ...(account === 'HR001' ? [{ label: '目标台账', path: '/tasks', view: 'monitor' }] : []),
      ...(canChange ? [{ label: '目标变更', path: '/goal-changes', view: 'changes' }] : []),
    ];
    for (const peer of peerPages) {
      await peers.filter({ hasText: peer.label }).click();
      await expect(peers.filter({ hasText: peer.label })).toHaveAttribute('aria-current', 'page');
      await expect(peers.filter({ hasText: /^绩效任务$/ })).not.toHaveAttribute('aria-current', 'page');
      await expect(navigation).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(peer.path);
      if (peer.view === 'monitor') expect(new URL(page.url()).searchParams.get('goalView')).toBe('monitor');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${peer.view}.png`), fullPage: true });
    }
    await peers.filter({ hasText: /^绩效任务$/ }).click();
    await expect(navigation.locator('[data-section="tasks"]')).toHaveAttribute('aria-current', 'page');
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
      await expect(peers.filter({ hasText: /^目标台账$/ })).toBeVisible();
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
      await expect(peers.filter({ hasText: /^目标台账$/ })).toHaveCount(0);
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
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/goal-plans');
  await page.goto('/tasks?goalView=mine');
  const peers = await taskPeerMenu(page);
  const changes = peers.filter({ hasText: /^目标变更$/ });
  await expect(changes).toBeVisible();
  await changes.click();
  expect((await loaded).ok()).toBe(true);
  await expect(page).toHaveURL(/\/goal-changes$/);
  await expect(changes).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: '绩效任务视图', exact: true })).toHaveCount(0);
  expect(delayedOptions).toBe(true); expect(delayedModule).toBe(true);
  await page.screenshot({ path: info.outputPath('late-load-navigation-retained.png'), fullPage: true });
});
