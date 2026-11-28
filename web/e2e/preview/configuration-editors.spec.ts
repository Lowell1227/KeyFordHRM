import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ownedMailboxes = new Set<string>();
test.afterEach(() => {
  if (!ownedMailboxes.size) return;
  const ids = [...ownedMailboxes];
  if (!ids.every(id => /^recruitment-mail:[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid owned mailbox ids');
  execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20_000, input: `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client'); const db=new PrismaClient({log:[]});
    (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional');
    const owner=await db.user.findUniqueOrThrow({where:{employeeNo:'ADMIN'},select:{id:true}});
    await db.systemConfig.deleteMany({where:{key:{in:${JSON.stringify(ids.map(id => 'integration_configuration:' + id))}},updatedBy:owner.id}});
    })().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  });
  ownedMailboxes.clear();
});

async function signIn(page: Page, employeeNo: 'ADMIN' | 'HR001') {
  const response = await page.request.post('/api/v1/auth/test-login', { data: { employeeNo } });
  expect(response.ok()).toBe(true);
  const token = (await response.json()).data.token as string;
  await page.goto('/login');
  await page.evaluate(value => {
    localStorage.setItem('token', value);
    localStorage.setItem('expiresAt', String(Date.now() + 3_500_000));
  }, token);
  return { authorization: 'Bearer ' + token };
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('administrator can configure two independent recruitment mailboxes', async ({ page }, info) => {
  const headers = await signIn(page, 'ADMIN');
  await page.goto('/system/configurations/recruitment-mail');
  await expect(page.getByTestId('recruitment-mailbox-list')).toBeVisible();
  const creation = page.waitForResponse(response => response.url().endsWith('/api/v1/system/configuration-mailboxes') && response.request().method() === 'POST');
  await page.getByTestId('mailbox-create').click();
  const firstId = (await (await creation).json()).data.id as string;
  ownedMailboxes.add(firstId);
  const editor = page.getByTestId('system-configuration-editor');
  await expect(editor).toBeVisible();
  const response = await page.request.get('/api/v1/system/configurations/' + encodeURIComponent(firstId), { headers });
  expect(response.status()).toBe(200);
  const view = (await response.json()).data;
  expect(view.fields.some((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_ACCOUNT')).toBe(true);
  const account = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_ACCOUNT');
  const password = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_PASSWORD');
  await expect(editor.getByLabel(account.label, { exact: true })).toBeVisible();
  await expect(editor.getByLabel(password.label, { exact: true })).toHaveAttribute('type', 'password');
  await expect(editor.getByLabel(password.label, { exact: true })).toHaveValue('');
  await expect(editor.getByTestId('configuration-save')).toBeVisible();
  await expect(editor.getByTestId('configuration-apply')).toBeVisible();
  const name = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_NAME');
  const folder = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_FOLDER');
  const from = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_AUTHORIZED_FROM');
  const provider = view.fields.find((field: { key: string }) => field.key === 'RECRUITMENT_MAIL_PROVIDER');
  expect(provider.type).toBe('select');
  expect(provider.options.map((option: { value: string }) => option.value)).toEqual(expect.arrayContaining(['alimail', 'qq', 'netease163', 'netease126']));
  await editor.getByRole('combobox', { name: provider.label, exact: true }).press('Enter');
  await page.getByRole('option', { name: provider.options.find((option: { value: string }) => option.value === 'qq').label, exact: true }).click();
  const firstName = '虚构收件箱A_' + randomUUID().slice(0, 6);
  await editor.getByLabel(name.label, { exact: true }).fill(firstName);
  await editor.getByLabel(account.label, { exact: true }).fill('preview@example.invalid');
  await editor.getByLabel(password.label, { exact: true }).fill('SyntheticFixtureOnly');
  await editor.getByLabel(folder.label, { exact: true }).fill('招聘简历');
  await editor.getByLabel(from.label, { exact: true }).fill('2037-01-01 08:00');
  await editor.getByLabel(from.label, { exact: true }).press('Tab');
  const savedResponse = page.waitForResponse(result => result.request().method() === 'PUT' && result.url().includes('/system/configurations/'));
  await editor.getByTestId('configuration-save').click();
  expect((await savedResponse).ok()).toBe(true);
  await expect(editor.getByLabel(password.label, { exact: true })).toHaveValue('');
  await editor.getByTestId('configuration-test').click();
  await expect(editor.getByTestId('configuration-apply')).toBeEnabled();
  await editor.getByTestId('configuration-apply').click();
  await expect(editor.getByText('配置已应用。', { exact: false })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('mail-configuration.png'), fullPage: true });
  await editor.getByRole('link', { name: '返回邮箱列表' }).click();
  await expect(page.getByTestId('recruitment-mailbox-list').getByText(firstName, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const secondCreation = page.waitForResponse(result => result.url().endsWith('/api/v1/system/configuration-mailboxes') && result.request().method() === 'POST');
  await page.getByTestId('mailbox-create').click();
  const secondId = (await (await secondCreation).json()).data.id as string;
  ownedMailboxes.add(secondId);
  expect(secondId).not.toBe(firstId);
  await expect(page.getByTestId('system-configuration-editor')).toBeVisible();
  const firstAfter = (await (await page.request.get('/api/v1/system/configurations/' + encodeURIComponent(firstId), { headers })).json()).data;
  expect(firstAfter.appliedRevision).toBeGreaterThan(0);
  expect(firstAfter.fields.find((field: { key: string }) => field.key === name.key).value).toBe(firstName);
  await noOverflow(page);
});

test('overview defaults to all and keeps DeepSeek and resume parsing discoverable', async ({ page }, info) => {
  await signIn(page, 'ADMIN');
  await page.goto('/system');
  const overview = page.getByRole('region', { name: '配置总览' });
  await expect(overview.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(overview.locator('#config-ai-progress-deepseek')).toBeVisible();
  await expect(overview.locator('#config-ai-resume')).toBeVisible();
  for (const id of ['dingtalk-login', 'dingtalk-notifications', 'dingtalk-calendar', 'recruitment-demand', 'recruitment-mail', 'payroll-attendance', 'payroll-access']) {
    const link = overview.locator(`#config-${id}`).getByRole('link', { name: '前往配置' });
    await expect(link).toHaveAttribute('href', new RegExp(`/system/(configurations/${id}|payroll-grants)`));
  }
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('all-configuration.png'), fullPage: true });
});

test('HR cannot read or write platform configuration through direct URLs', async ({ page }) => {
  const headers = await signIn(page, 'HR001');
  for (const id of ['recruitment-mail', 'dingtalk-app', 'recruitment-demand', 'ai-resume']) {
    const response = await page.request.get(`/api/v1/system/configurations/${id}`, { headers });
    expect(response.status()).toBe(403);
    const saved = await page.request.put(`/api/v1/system/configurations/${id}`, {
      headers, data: { expectedRevision: 0, values: {} },
    });
    expect(saved.status()).toBe(403);
  }
  await page.goto('/system/configurations/recruitment-mail');
  await expect(page.getByTestId('system-configuration-editor')).toHaveCount(0);
});
