import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test.use({ trace: 'off', video: 'off', screenshot: 'off', storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);
async function read(page: Page, path: string) {
  return page.evaluate(async path => {
    const r = await fetch(`/api/v1/${path}`, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
    return { status: r.status, data: (await r.json()).data };
  }, path);
}
test('original list terminates then atomically deletes its own tasks, retains authorized history', async ({ page, browser }, info) => {
  if (info.project.use.baseURL !== 'http://localhost:5173' || info.config.globalSetup !== null) throw Error('Only fixed isolated preview is allowed');
  const output = execFileSync(process.execPath, [resolve('../scripts/prepare-cycle-termination-preview.cjs'), '--deletion'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  const f = JSON.parse(output);
  if (!f.fictional || !/^CT_[a-f0-9]{10}$/.test(f.prefix) || f.tasks.length !== 4) throw Error('Invalid fictional fixture');
  delete f.operator;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const writes: string[] = [];
  page.on('request', r => { const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/v1/cycles') && r.method() !== 'GET') writes.push(`${r.method()} ${path}`); });
  await page.goto('/login');
  await page.getByTestId('preview-account').locator('.el-select__wrapper').click();
  await page.getByRole('option').filter({ hasText: '(HR001)' }).click();
  await page.getByTestId('preview-login').click(); await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`/cycles?keyword=${f.prefix}`);
  const mobile = info.project.name === 'mobile';
  const action = (name: string) => page.getByTestId(`cycle-${name}-${mobile ? 'mobile-' : ''}${f.cycleId}`);
  await expect(action('delete')).toHaveCount(0);
  await action('terminate').click();
  await expect(page.getByTestId('cycle-termination-summary')).toBeVisible();
  await page.getByTestId('cycle-termination-reason').fill(`${f.prefix} 虚构周期结束`);
  await page.getByTestId('cycle-termination-submit').click();
  await page.getByRole('dialog', { name: '再次确认终止周期' }).getByRole('button', { name: '终止周期并保留记录', exact: true }).click();
  await expect(page.getByTestId('cycle-termination-dialog')).toBeHidden();
  await expect(action('delete')).toBeVisible();
  const before = await read(page, `cycles/${f.cycleId}`); expect(before.status).toBe(200);
  await action('delete').click();
  const dialog = page.getByTestId('cycle-deletion-dialog');
  await expect(page.getByTestId('cycle-deletion-summary')).toBeVisible();
  await expect(dialog.getByText('未办结事项', { exact: true })).toBeVisible();
  await page.getByTestId('cycle-deletion-submit').click();
  await expect(dialog.getByText('请填写删除原因', { exact: true })).toBeVisible();
  const reason = `${f.prefix} 虚构逻辑删除，保留审计`;
  await page.getByTestId('cycle-deletion-reason').fill(reason);
  await expect(dialog.locator('.el-form-item.is-error')).toHaveCount(0);
  await expect(page.locator('.el-message')).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await dialog.locator('.el-dialog__body').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('cycle-delete-impact.png'), fullPage: true });
  await page.getByTestId('cycle-deletion-submit').click();
  await page.getByRole('dialog', { name: '再次确认删除周期' }).getByRole('button', { name: '返回核对', exact: true }).click();
  expect(writes.filter(p => p.endsWith('/delete'))).toHaveLength(0);
  await page.getByTestId('cycle-deletion-submit').click();
  await page.getByRole('dialog', { name: '再次确认删除周期' }).getByRole('button', { name: '删除周期及所属任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(action('primary')).toHaveCount(0);
  const after = await read(page, `cycles/${f.cycleId}`);
  expect(after.status).toBe(200); expect(after.data.status).toBe(before.data.status);
  expect(after.data.deletedAt).toBeTruthy(); expect(after.data.deletionReason).toBe(reason);
  expect(after.data.canDelete).toBe(false); expect(after.data.canTerminate).toBe(false);
  for (const task of f.tasks) {
    const record = await read(page, `performance-lifecycle/task/${task.id}`);
    expect(record.status).toBe(200); expect(record.data.lifecycleStatus).toBe('deleted');
    expect(record.data.allowedActions).toEqual([]);
  }
  await page.getByRole('combobox', { name: '周期记录范围' }).focus();
  await page.getByRole('combobox', { name: '周期记录范围' }).press('Enter');
  await page.getByRole('option', { name: '已删除', exact: true }).click();
  await expect(action('primary')).toBeVisible(); await action('primary').click();
  await expect(page.getByTestId('cycle-deletion-record')).toContainText(reason);
  await expect(page.getByTestId('cycle-workspace-delete')).toHaveCount(0);
  await expect(page.getByTestId('cycle-workspace-edit')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('cycle-delete-history.png'), fullPage: true });
  expect(writes).toEqual([`POST /api/v1/cycles/${f.cycleId}/terminate`, `POST /api/v1/cycles/${f.cycleId}/delete`]);
  expect(errors).toEqual([]);
  for (const employeeNo of ['EMP001', 'ADMIN']) {
    const context = await browser.newContext({ baseURL: 'http://localhost:5173', storageState: { cookies: [], origins: [] } });
    try {
      const other = await context.newPage(); await other.goto('/login');
      await other.getByTestId('preview-account').locator('.el-select__wrapper').click();
      await other.getByRole('option').filter({ hasText: `(${employeeNo})` }).click();
      await other.getByTestId('preview-login').click(); await expect(other).toHaveURL(/\/dashboard/);
      expect((await read(other, `cycles/${f.cycleId}/deletion-preview`)).status).toBe(403);
      if (employeeNo === 'EMP001') {
        expect((await read(other, `cycles/${f.cycleId}`)).status).toBe(200);
        expect((await read(other, `performance-lifecycle/task/${f.tasks[0].id}`)).status).toBe(200);
        expect((await read(other, `performance-lifecycle/task/${f.tasks[1].id}`)).status).toBe(403);
      }
    } finally { await context.close(); }
  }
});
