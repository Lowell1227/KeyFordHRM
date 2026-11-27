import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

type Actor = { sysRole: string; hrCapabilities?: string[]; payrollAccess?: { enabled: boolean;
  subjects: { capabilities: string[] }[] } };

async function expectQuickCards(page: Page) {
  const section = page.getByTestId('dashboard-quick-actions');
  const cards = section.locator('.quick-action');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  await expect(section.locator('.quick-action__description')).toHaveCount(count);
  await expect(section.locator('.quick-action__link')).toHaveCount(count);
  for (const card of await cards.all()) {
    await expect(card.locator('.quick-action__description')).not.toHaveText('');
    await expect(card.locator('.quick-action__link')).toHaveText('进入');
    await expect(card).toHaveAccessibleName((await card.locator('.quick-action__label').innerText()).trim());
    const layout = await card.evaluate(element => {
      const label = element.querySelector('.quick-action__label')!.getBoundingClientRect();
      const description = element.querySelector('.quick-action__description')!.getBoundingClientRect();
      const link = element.querySelector('.quick-action__link')!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { stacked: label.bottom <= description.top && description.bottom <= link.top,
        contained: [label, description, link].every(row => row.left >= box.left && row.right <= box.right), height: box.height };
    });
    expect(layout.stacked).toBe(true);
    expect(layout.contained).toBe(true);
    expect(layout.height).toBeGreaterThan(90);
  }
  expect(await section.evaluate(element => {
    const style = getComputedStyle(element);
    return style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0
      && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

async function login(page: Page, account: string): Promise<Actor> {
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  if (account !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${account})` }).click();
  }
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/test-login');
  await page.getByTestId('preview-login').click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
  return (await result.json()).data.user;
}

function privateOperator(): { employeeNo: string; password: string } {
  const filename = process.env.HRM_ENTRY_FIXTURE_FILE;
  if (!filename || !isAbsolute(filename)) throw new Error('HRM_ENTRY_FIXTURE_FILE must point to the private local fixture JSON');
  let fixture: { fictional?: unknown; prefix?: unknown; operator?: { employeeNo?: unknown; password?: unknown } };
  try { fixture = JSON.parse(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Private entry fixture could not be read; file details withheld'); }
  if (!fixture || fixture.fictional !== true || typeof fixture.prefix !== 'string' || !/^CT_[a-f0-9]{10}$/.test(fixture.prefix)
    || typeof fixture.operator?.employeeNo !== 'string' || fixture.operator.employeeNo !== `${fixture.prefix}HR`
    || typeof fixture.operator.password !== 'string' || !fixture.operator.password) {
    throw new Error('Private entry fixture requires the fictional operator credentials from the coordinator script');
  }
  return { employeeNo: fixture.operator.employeeNo, password: fixture.operator.password };
}

async function passwordLogin(page: Page, operator: { employeeNo: string; password: string }): Promise<Actor> {
  await page.goto('/login');
  try {
    // Preview deliberately exposes only listed quick identities. Authenticate this owned
    // narrow fixture with the real password API; all subsequent business actions use UI.
    const result = await page.request.post('/api/v1/auth/login', { data: operator });
    expect(result.status()).toBe(200);
    const { data } = await result.json();
    if (typeof data.token !== 'string' || data.passwordChangeRequired) throw new Error('Fixture session unavailable');
    await page.evaluate(session => {
      localStorage.setItem('token', session.token);
      localStorage.setItem('expiresAt', String(Date.now() + session.expiresIn * 1000));
      localStorage.setItem('passwordChangeRequired', 'false');
    }, { token: data.token, expiresIn: data.expiresIn });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    return data.user;
  } catch { throw new Error('Private fixture password login failed; input values and response details withheld'); }
}

for (const account of ['HR001', 'MGR001', 'EMP001']) {
  test(`${account}: peer navigation and top work entries preserve scope on desktop/mobile`, async ({ page }, info) => {
    expect(info.project.use.baseURL).toBe('http://localhost:5173');
    const writes: string[] = [], errors: string[] = [], entries: boolean[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        && url.pathname !== '/api/v1/auth/test-login') writes.push(`${request.method()} ${url.pathname}`);
    });
    page.on('response', async response => {
      if (new URL(response.url()).pathname === '/api/v1/goal-changes/entry' && response.ok()) {
        entries.push((await response.json()).data.visible === true);
      }
    });
    const actor = await login(page, account);
    await expect.poll(() => entries.length).toBe(1);
    const quick = page.getByTestId('dashboard-quick-actions');
    if (account === 'HR001') {
      await expectQuickCards(page);
      for (const label of ['员工档案', '入离职', '人才库', '简历收件', '应聘与面试', '招聘需求']) {
        await expect(quick.getByRole('button', { name: label, exact: true })).toBeVisible();
      }
      expect(await quick.evaluate(element => element.parentElement?.firstElementChild === element)).toBe(true);
      const capabilities = actor.payrollAccess?.enabled
        ? actor.payrollAccess.subjects.flatMap(subject => subject.capabilities) : [];
      await expect(quick.getByRole('button', { name: '工资资料', exact: true })).toHaveCount(capabilities.includes('payroll_edit') ? 1 : 0);
      await expect(quick.getByRole('button', { name: '复核与审批', exact: true })).toHaveCount(
        capabilities.some(cap => ['payroll_review', 'payroll_approve'].includes(cap)) ? 1 : 0);
      await quick.getByRole('button', { name: '员工档案', exact: true }).click();
      await expect(page).toHaveURL(/\/users$/);
      await page.getByTestId('nav-module-workbench').click();
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${account}-workbench-top.png`), fullPage: true });

    await page.getByTestId('nav-module-performance').click();
    const sidebar = page.getByRole('complementary', { name: '系统导航', exact: true });
    const group = sidebar.locator('.menu-group').filter({ has: page.locator('.menu-link').filter({ hasText: /^绩效任务$/ }) });
    const toggle = group.locator('.menu-group__title');
    if (info.project.name === 'desktop' && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const menu = group.locator('.menu-link');
    await expect(menu).toHaveText(['绩效任务', ...(account === 'HR001' ? ['目标台账'] : []), ...(entries[0] ? ['目标变更'] : [])]);
    const taskTabs = page.getByRole('navigation', { name: '绩效任务视图', exact: true });
    await expect(taskTabs.getByRole('link')).toHaveText(['我的目标', /^目标审核/, '绩效待办']);
    if (account === 'HR001') {
      await menu.filter({ hasText: /^目标台账$/ }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('goalView')).toBe('monitor');
      await expect(menu.filter({ hasText: /^目标台账$/ })).toHaveAttribute('aria-current', 'page');
      await expect(menu.filter({ hasText: /^绩效任务$/ })).not.toHaveAttribute('aria-current', 'page');
      await expect(taskTabs).toHaveCount(0);
    }
    if (entries[0]) {
      await menu.filter({ hasText: /^目标变更$/ }).click();
      await expect(page).toHaveURL(/\/goal-changes$/);
      await expect(menu.filter({ hasText: /^目标变更$/ })).toHaveAttribute('aria-current', 'page');
      await expect(taskTabs).toHaveCount(0);
    }
    await menu.filter({ hasText: /^绩效任务$/ }).click();
    await expect(taskTabs).toBeVisible();
    for (const view of ['mine', 'review']) {
      await taskTabs.locator(`[data-section="${view}"]`).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('goalView')).toBe(view);
      await expect(menu.filter({ hasText: /^绩效任务$/ })).toHaveAttribute('aria-current', 'page');
    }
    await taskTabs.locator('[data-section="tasks"]').click();
    const original = page.getByTestId('performance-secondary-nav');
    await expect(original.getByRole('link', { name: '绩效待办', exact: true })).toHaveAttribute('href', '/tasks');
    await expect(page.locator('.performance-workspace__context .task-stage-list').first()
      .locator('.task-stage-item > span:first-child')).toHaveText(['目标制定', '目标确认', '自评', '结果确认']);
    expect(entries).toHaveLength(1);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${account}-peer-menu.png`), fullPage: true });
  });
}

test.describe('private fixture personnel operator', () => {
  test('fictional personnel operator starts work through password login without acquiring review rights', async ({ page }, info) => {
    expect(info.project.use.baseURL).toBe('http://localhost:5173');
    const operator = privateOperator();
    const writes: string[] = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        && pathname !== '/api/v1/auth/login') writes.push(`${request.method()} ${pathname}`);
    });
    const actor = await passwordLogin(page, operator);
    expect(actor.sysRole).toBe('hr_user');
    expect(actor.hrCapabilities).toContain('employee_archive_edit');
    expect(actor.hrCapabilities).not.toContain('employee_archive_review');
    const quick = page.getByTestId('dashboard-quick-actions');
    await expectQuickCards(page);
    for (const label of ['员工档案', '入离职', '人才库', '简历收件', '招聘需求', '应聘与面试']) {
      await expect(quick.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['待我审核', '录用确认', '结果审批', '复核与审批']) {
      await expect(quick.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await quick.getByRole('button', { name: '入离职', exact: true }).click();
    await expect(page).toHaveURL(/\/entry-exit$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(writes).toEqual([]);
    await page.getByTestId('nav-module-workbench').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.screenshot({ path: info.outputPath('personnel-quick-cards.png'), fullPage: true });
  });
});
