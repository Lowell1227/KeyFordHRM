import { expect, test, type Page } from '@playwright/test';
const ref = 'a'.repeat(64), ref2 = 'b'.repeat(64);
const path = `/archive-assistant/preview/${ref}`;
const wrap = (data: unknown) => ({ code: 0, message: 'success', data });
const saved = { requestId: '11111111-1111-4111-8111-111111111111', requestVersion: 1, recordStatus: 'draft', url: '/users?assistantRequestId=11111111-1111-4111-8111-111111111111', replayed: false };
const preview = { employeeName: '【测试】档案助手样例', workLocation: '杭州（测试资料）', notice: '尚未保存，正式档案未改变', expiresAt: '2099-01-01T00:00:00Z', saved: null };
async function setup(page: Page, loggedIn = true) {
  if (loggedIn) await page.addInitScript(() => { localStorage.setItem('token', 'mock'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', route => route.fulfill({ json: wrap([]) }));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: wrap({ id: 'pilot', name: '测试HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], businessCapabilities: {} }) }));
  await page.route('**/api/v1/employee-archives/assistant/preview', route => route.fulfill({ json: wrap(preview) }));
}
for (const width of [1440, 390]) test(`preview and explicit single save ${width}px`, async ({ page }) => {
  await setup(page); await page.setViewportSize({ width, height: 900 });
  let writes = 0;
  await page.route('**/api/v1/employee-archives/assistant/save', async route => {
    writes++; expect(route.request().postDataJSON()).toEqual({ token: 'signed-token' });
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({ json: wrap(saved) });
  });
  const read = page.waitForRequest(request => request.url().endsWith('/employee-archives/assistant/preview'));
  await page.goto(path + '#preview=signed-token');
  const request = await read; expect(request.method()).toBe('GET'); expect(request.headers()['x-archive-preview']).toBe('signed-token');
  expect(request.url()).not.toContain('signed-token');
  await expect(page.getByText(preview.employeeName)).toBeVisible();
  expect(writes).toBe(0); expect(page.url()).not.toContain('signed-token');
  expect(await page.evaluate(() => sessionStorage.getItem(`archive-assistant:${'a'.repeat(64)}`))).toBe('signed-token');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = page.getByRole('button', { name: '保存待核草稿' });
  await button.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await expect(page.getByText('已保存待核草稿，正式档案未改变')).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole('link', { name: '打开草稿' })).toHaveAttribute('href', saved.url);
});
async function mockOAuth(page: Page, callbackQuery = 'code=mock-code') {
  await page.route('https://login.dingtalk.com/**', route => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get('redirect_uri')!;
    expect(callback).toBe('http://127.0.0.1:5189/auth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid corpid');
    expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'corpId', 'redirect_uri', 'response_type', 'scope']);
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${callback}?${callbackQuery}`)})</script>` });
  });
  await page.route('**/api/v1/auth/dingtalk', route => {
    expect(route.request().postDataJSON()).toEqual({ authCode: 'mock-code', loginMode: 'oauth' });
    return route.fulfill({ json: wrap({ token: 'mock', expiresIn: 600, user: { id: 'pilot', name: '测试HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], businessCapabilities: {} } }) });
  });
}
test('external OAuth automatically returns to captured preview with token only in session/header', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  await setup(page, false); await page.goto(path + '#preview=signed-token');
  await expect(page).toHaveURL(/\/login\?redirect=/); expect(page.url()).not.toContain('signed-token');
  // Register after setup's generic API stub so the actual callback exercises authentication.
  await mockOAuth(page);
  const read = page.waitForRequest(request => request.url().endsWith('/assistant/preview'));
  await page.getByRole('button', { name: '选择钉钉账号/组织登录' }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByText(preview.employeeName)).toBeVisible();
  expect((await read).headers()['x-archive-preview']).toBe('signed-token');
  expect(urls.every(url => !url.includes('signed-token'))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('archive-assistant:oauth-return'))).toBeNull();
});
for (const target of [
  'https://outside.invalid' + path, '//outside.invalid' + path,
  '/\\outside.invalid' + path, path + '?preview=signed-token',
  path + '#preview=signed-token', '/archive-assistant/preview/not-a-reference',
]) test(`OAuth does not retain unsafe archive return ${target}`, async ({ page }) => {
  await setup(page, false); await mockOAuth(page);
  await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
  // An unrelated OAuth attempt also clears an abandoned archive return.
  await page.evaluate(reference => sessionStorage.setItem('archive-assistant:oauth-return', JSON.stringify({ reference, expiresAt: Date.now() + 60000 })), ref);
  await page.getByRole('button', { name: '选择钉钉账号/组织登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await page.evaluate(() => sessionStorage.getItem('archive-assistant:oauth-return'))).toBeNull();
});

for (const [index, record] of [
  'malformed-json', JSON.stringify({ reference: '//outside.invalid', expiresAt: Date.now() + 60000 }),
  JSON.stringify({ reference: ref, expiresAt: 0 }), JSON.stringify({ reference: ref, expiresAt: 9999999999999 }),
].entries()) test(`callback rejects malformed or expired stored return ${index}`, async ({ page }) => {
  await setup(page, false); await mockOAuth(page);
  await page.goto('/login');
  await page.evaluate(value => sessionStorage.setItem('archive-assistant:oauth-return', value), record);
  await page.goto('/auth/callback?code=mock-code&redirect=%2Fusers');
  await expect(page).toHaveURL('/users');
  expect(await page.evaluate(() => sessionStorage.getItem('archive-assistant:oauth-return'))).toBeNull();
});

for (const failure of ['missing-code', 'auth-error']) test(`archive OAuth ${failure} preserves safe destination for retry`, async ({ page }) => {
  await setup(page, false); await mockOAuth(page, failure === 'missing-code' ? '' : 'code=mock-code');
  if (failure === 'auth-error') await page.route('**/api/v1/auth/dingtalk', route => route.fulfill({ status: 403, json: { message: '账号未开通' } }));
  await page.goto(path + '#preview=signed-token');
  await page.getByRole('button', { name: '选择钉钉账号/组织登录' }).click();
  await expect(page.getByText(failure === 'missing-code' ? '缺少钉钉授权码' : '该钉钉账号尚未同步到系统，请联系 HR 或系统管理员后重试')).toBeVisible();
  await expect(page).toHaveURL(`/login?redirect=${path}`);
  expect(await page.evaluate(() => sessionStorage.getItem('archive-assistant:oauth-return'))).toBeNull();
  expect(await page.evaluate(reference => sessionStorage.getItem(`archive-assistant:${reference}`), ref)).toBe('signed-token');
});

test('ordinary callback retains query redirect and missing-code fallback', async ({ page }) => {
  await setup(page, false); await mockOAuth(page);
  await page.goto('/auth/callback?redirect=%2Fusers');
  await expect(page).toHaveURL('/login?redirect=/users');
  await page.goto('/auth/callback?code=mock-code&redirect=%2Fusers');
  await expect(page).toHaveURL('/users');
});

test('ordinary callback error retains query redirect', async ({ page }) => {
  await setup(page, false);
  await page.route('**/api/v1/auth/dingtalk', route => route.fulfill({ status: 403, json: { message: '账号未开通' } }));
  await page.goto('/auth/callback?code=mock-code&redirect=%2Fusers');
  await expect(page).toHaveURL('/login?redirect=/users');
  await expect(page.getByText('该钉钉账号尚未同步到系统，请联系 HR 或系统管理员后重试')).toBeVisible();
});

test('ordinary callback rejects external query redirect', async ({ page }) => {
  await setup(page, false); await mockOAuth(page);
  await page.goto('/auth/callback?code=mock-code&redirect=https%3A%2F%2Foutside.invalid');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('password login clears abandoned OAuth return and keeps its query destination', async ({ page }) => {
  await setup(page, false);
  await page.route('**/api/v1/auth/login', route => route.fulfill({ json: wrap({ token: 'mock', expiresIn: 600, user: { id: 'pilot', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], businessCapabilities: {} } }) }));
  await page.goto('/login?redirect=/users');
  await page.evaluate(reference => sessionStorage.setItem('archive-assistant:oauth-return', JSON.stringify({ reference, expiresAt: Date.now() + 60000 })), ref);
  await page.getByTestId('password-login-toggle').click();
  await page.getByTestId('login-employee-no').fill('mock-user');
  await page.getByTestId('login-password').fill('mock-password');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/users');
  expect(await page.evaluate(() => sessionStorage.getItem('archive-assistant:oauth-return'))).toBeNull();
});
for (const status of [400, 403, 409]) test(`inline preview error ${status}`, async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/employee-archives/assistant/preview', route => route.fulfill({ status, json: { message: 'private-error' } }));
  await page.goto(path + '#preview=signed-token');
  await expect(page.getByRole('alert')).toContainText(status === 403 ? '权限' : status === 409 ? '重新核对' : '失效');
  await expect(page.getByRole('button', { name: '保存待核草稿' })).toHaveCount(0);
});
test('replay describes existing record without asserting lifecycle', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/employee-archives/assistant/preview', route => route.fulfill({ json: wrap({ ...preview, saved: { ...saved, recordStatus: 'draft', replayed: true } }) }));
  await page.goto(path + '#preview=signed-token');
  await expect(page.getByText('该资料已接收，本次未重复保存，请查看原记录当前状态')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存待核草稿' })).toHaveCount(0);
});
test('network save failure never automatically retries', async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route('**/api/v1/employee-archives/assistant/save', route => { writes++; return route.abort(); });
  await page.goto(path + '#preview=signed-token'); await page.getByRole('button', { name: '保存待核草稿' }).click();
  await expect(page.getByRole('alert')).toContainText('保存结果'); expect(writes).toBe(1);
});
test('route switch suppresses late old preview', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/employee-archives/assistant/preview', async route => {
    const old = route.request().headers()['x-archive-preview'] === 'old-token';
    if (old) await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ json: wrap({ ...preview, employeeName: old ? '旧资料' : preview.employeeName }) });
  });
  const firstRead = page.waitForRequest(request => request.url().endsWith('/employee-archives/assistant/preview'));
  await page.goto(path + '#preview=old-token');
  await firstRead;
  await page.evaluate((next) => { history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); }, `/archive-assistant/preview/${ref2}#preview=new-token`);
  await expect(page.getByText(preview.employeeName)).toBeVisible();
  await page.waitForTimeout(1400); await expect(page.getByText('旧资料')).toHaveCount(0);
});

for (const status of [400, 403, 409]) test(`inline save error ${status} blocks further writes`, async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route('**/api/v1/employee-archives/assistant/save', route => {
    writes++; return route.fulfill({ status, json: { message: 'private-detail' } });
  });
  await page.goto(path + '#preview=signed-token'); await page.getByRole('button', { name: '保存待核草稿' }).click();
  await expect(page.getByRole('alert')).toContainText(status === 403 ? '权限' : status === 409 ? '重新核对' : '失效');
  await expect(page.getByRole('button', { name: '保存待核草稿' })).toBeDisabled(); expect(writes).toBe(1);
});
test('expired preview cannot save', async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route('**/api/v1/employee-archives/assistant/preview', route => route.fulfill({ json: wrap({ ...preview, expiresAt: '2000-01-01T00:00:00Z' }) }));
  await page.route('**/api/v1/employee-archives/assistant/save', route => { writes++; return route.fulfill({ json: wrap(saved) }); });
  await page.goto(path + '#preview=signed-token'); await page.getByRole('button', { name: '保存待核草稿' }).click();
  await expect(page.getByRole('alert')).toContainText('失效'); expect(writes).toBe(0);
});
test('saved link opens existing personnel application detail', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/employee-archives/assistant/save', route => route.fulfill({ json: wrap(saved) }));
  await page.route('**/api/v1/users**', route => route.fulfill({ json: wrap({ items: [], total: 0 }) }));
  let details = 0;
  await page.route(`**/api/v1/employee-archives/applications/${saved.requestId}`, route => {
    details++; return route.fulfill({ json: wrap({ id: saved.requestId, sourceType: 'manual_employee_create', sourceSystem: 'archive_assistant_pilot', employeeName: preview.employeeName, recordStatus: 'draft', proposedValue: { name: preview.employeeName, employee: { workLocation: preview.workLocation } }, profileReviewStatus: 'pending', performanceReviewStatus: 'pending', createdAt: '2026-10-30T00:00:00Z' }) });
  });
  await page.goto(path + '#preview=signed-token'); await page.getByRole('button', { name: '保存待核草稿' }).click();
  await page.getByRole('link', { name: '打开草稿' }).click();
  await expect(page).toHaveURL(/users\?assistantRequestId=/);
  await expect(page.getByRole('dialog')).toBeVisible(); expect(details).toBe(1);
});
test('ordinary employee cannot use preview or personnel deep link', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: wrap({ id: 'other', name: '员工', sysRole: 'employee', businessCapabilities: {} }) }));
  let reads = 0;
  await page.route('**/api/v1/employee-archives/assistant/**', route => { reads++; return route.fulfill({ json: wrap(preview) }); });
  await page.route('**/api/v1/employee-archives/applications/**', route => { reads++; return route.fulfill({ json: wrap({}) }); });
  await page.goto(path + '#preview=signed-token'); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(saved.url); await expect(page).toHaveURL(/\/dashboard$/); expect(reads).toBe(0);
});

test('route switch ignores old save response and never saves the new preview automatically', async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route('**/api/v1/employee-archives/assistant/save', async route => {
    writes++; await new Promise(resolve => setTimeout(resolve, 1200)); await route.fulfill({ json: wrap(saved) });
  });
  await page.goto(path + '#preview=old-token');
  const write = page.waitForRequest(request => request.url().endsWith('/assistant/save'));
  await page.getByRole('button', { name: '保存待核草稿' }).click(); await write;
  await page.evaluate((next) => { history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); }, `/archive-assistant/preview/${ref2}#preview=new-token`);
  await expect(page.getByRole('button', { name: '保存待核草稿' })).toBeEnabled();
  await page.waitForTimeout(1400); await expect(page.getByRole('link', { name: '打开草稿' })).toHaveCount(0); expect(writes).toBe(1);
});
