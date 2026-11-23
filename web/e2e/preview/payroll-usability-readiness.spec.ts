import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

async function control(op: 'create' | 'inspect', body = {}) {
  const response = await fetch(`http://127.0.0.1:3011/__usability-ui/${op}`, { method: 'POST',
    headers: { 'x-usability-ui-run': process.env.HRM_USABILITY_UI_RUN!, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200); return response.json();
}
async function post(page: Page, suffix: string, action: () => Promise<unknown>) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix));
  await action(); const response = await pending; expect(response.status()).toBe(201); return (await response.json()).data;
}

test('HR submits complete net reconciliation; independent review and approval make readiness ready; explicit revoke restores the hold', async ({ browser }, info) => {
  const fixture = await control('create');
  const errors: string[] = [], writes: string[] = [];
  const httpEvents: Array<{ path: string; status: number }> = [], navigations: string[] = [], reloads: string[] = [];
  const context = await browser.newContext({ ...info.project.use, baseURL: 'http://127.0.0.1:5175' });
  const page = await context.newPage();
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5175' ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) httpEvents.push({ path: url.pathname, status: response.status() }); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname); });
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { const value = JSON.parse(String(event.payload)); if (value.type === 'full-reload') reloads.push(value.path ?? '*'); } catch { /* Not a Vite JSON frame. */ }
  }));
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  const query = `?subjectId=${fixture.subjectId}&month=${fixture.month}`;
  const drawer = page.getByRole('dialog', { name: '首月签收', exact: true });
  async function login(role: 'hr' | 'reviewer' | 'approver') {
    await page.goto('/login'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    const target = role === 'hr' ? '/payroll/batches' : '/payroll/approvals';
    await page.goto(`/login?redirect=${encodeURIComponent(target + query)}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('password-login-toggle').click();
    await page.getByTestId('login-employee-no').fill(fixture.credentials[role].employeeNo);
    await page.getByTestId('login-password').fill(fixture.credentials[role].password);
    const loggedIn = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/auth/login');
    await page.getByTestId('login-submit').click();
    const response = await loggedIn;
    expect(response.status()).toBe(200);
    try { await expect(page).toHaveURL(new RegExp(target)); }
    catch (error) {
      const session = await page.evaluate(async () => {
        const source = '/src/stores/auth.store.ts';
        const { useAuthStore } = await import(source);
        const auth = useAuthStore();
        return { storedTokenPresent: !!localStorage.getItem('token'), loggedIn: auth.isLoggedIn, userLoaded: !!auth.user, tokenExpired: auth.tokenExpired };
      });
      const diagnostic = { diagnostic: 'actual-ui-login-navigation', role, httpEvents, navigations, reloads, session };
      await writeFile(path.resolve(`../test-results/payroll-usability-ui/${info.project.name}-login-diagnostic.json`), JSON.stringify(diagnostic, null, 2));
      console.log(JSON.stringify(diagnostic));
      throw error;
    }
    await expect(page.getByTestId('preview-login')).toHaveCount(0);
  }
  async function screenshot(stage: string) {
    await expect(page.getByRole('textbox', { name: '密码', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect.poll(() => drawer.evaluate(element => {
      const rect = element.getBoundingClientRect(), body = element.querySelector('.el-drawer__body');
      return rect.x >= -1 && rect.right <= innerWidth + 1 && rect.y >= -1 && rect.bottom <= innerHeight + 1
        && element.scrollWidth <= element.clientWidth + 1 && (!body || body.scrollWidth <= body.clientWidth + 1)
        && element.getAnimations().every(animation => animation.playState !== 'running');
    })).toBe(true);
    await drawer.getByRole('button', { name: '关闭', exact: true }).click({ trial: true });
    await page.screenshot({ path: path.resolve(`../test-results/payroll-usability-ui/${info.project.name}${process.env.HRM_USABILITY_UI_COLD === '1' ? '-cold' : ''}-${stage}.png`), fullPage: true, animations: 'disabled' });
  }
  try {
    await login('hr');
    const initial = await control('inspect', { subjectId: fixture.subjectId }); expect(initial.receipt).toBeNull();
    await page.getByRole('button', { name: '首月签收', exact: true }).click();
    await drawer.getByRole('button', { name: '提交对账签收', exact: true }).click();
    await drawer.locator('.el-select__wrapper').click();
    await page.getByRole('option').filter({ hasText: fixture.month }).click();
    await drawer.locator('.el-date-editor input').fill(fixture.firstMonth);
    await drawer.locator('.el-date-editor input').press('Tab');
    await drawer.getByLabel('核对依据').fill('本轮虚构净额、人员范围与扣缴事实核对，无真实工资资料');
    const request = await post(page, '/payroll/readiness/requests', () => drawer.getByRole('button', { name: '提交签收', exact: true }).click());
    await expect(drawer).toContainText('待签收'); await expect(drawer.getByTestId('payroll-net-total-net')).toHaveText(fixture.net);
    await expect(drawer.getByRole('button', { name: '签收', exact: true })).toHaveCount(0);
    await screenshot('submitted');
    const pending = await control('inspect', { subjectId: fixture.subjectId }); expect(pending.receipt).toBeNull(); expect(pending.decisions).toBe(0);
    await login('reviewer'); await page.goto(`/payroll/approvals${query}&readiness=${request.request.id}`);
    await expect(drawer).toContainText('当前环节：复核签收');
    await drawer.getByRole('button', { name: '签收', exact: true }).click();
    await post(page, `/requests/${request.request.id}/decide`, () => page.getByRole('dialog', { name: '签收对账结果', exact: true }).getByRole('button', { name: '签收', exact: true }).click());
    await expect(drawer).toContainText('待签收'); await screenshot('reviewed');
    const reviewed = await control('inspect', { subjectId: fixture.subjectId }); expect(reviewed.receipt).toBeNull(); expect(reviewed.decisions).toBe(1);
    await login('approver'); await page.goto(`/payroll/approvals${query}&readiness=${request.request.id}`);
    await expect(drawer).toContainText('当前环节：审批签收');
    await drawer.getByRole('button', { name: '签收', exact: true }).click();
    await post(page, `/requests/${request.request.id}/decide`, () => page.getByRole('dialog', { name: '签收对账结果', exact: true }).getByRole('button', { name: '签收', exact: true }).click());
    await expect(drawer).toContainText('已签收'); await screenshot('approved');
    const accepted = await control('inspect', { subjectId: fixture.subjectId }); expect(accepted.receipt).toBe('approved'); expect(accepted.decisions).toBe(2); expect(accepted.finalSignerMatches).toBe(true);
    const ready = await page.request.get(`/api/v1/payroll/readiness?subjectId=${fixture.subjectId}`, { headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` } });
    expect((await ready.json()).data).toEqual({ ready: true, firstMonth: fixture.firstMonth });
    await drawer.getByLabel('原因', { exact: true }).fill('虚构签收演练结束，显式撤销，不启用真实工资');
    await drawer.getByRole('button', { name: '撤销签收', exact: true }).click();
    await post(page, `/requests/${request.request.id}/revoke`, () => page.getByRole('dialog', { name: '撤销首月签收', exact: true }).getByRole('button', { name: '撤销签收', exact: true }).click());
    await expect(drawer).toContainText('签收已撤销'); await screenshot('revoked');
    const final = await control('inspect', { subjectId: fixture.subjectId }); expect(final.receipt).toBe('revoked'); expect(final.state).toBe('revoked'); expect(final.environmentUnchanged).toBe(true);
    expect(final.finances).toEqual({ payments: 0, reservations: 0, settlements: 0, exports: 0 });
    expect(writes.filter(value => value.endsWith('/decide'))).toHaveLength(2); expect(writes.some(value => /net-payment|export|settlements/.test(value))).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
