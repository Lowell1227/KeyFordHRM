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
test('captures fragment before login redirect and returns using session token', async ({ page }) => {
  await setup(page, false); await page.goto(path + '#preview=signed-token');
  await expect(page).toHaveURL(/\/login\?redirect=/); expect(page.url()).not.toContain('signed-token');
  await page.evaluate(() => { localStorage.setItem('token', 'mock'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.goto(path); await expect(page.getByText(preview.employeeName)).toBeVisible();
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
