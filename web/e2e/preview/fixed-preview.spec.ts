import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1'], { encoding: 'utf8' }));
  const env = Object.fromEntries(container.Config.Env.map((line: string) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  // Fail before any writes if this URL no longer targets the isolated preview.
  expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
  expect(env.HRM_PREVIEW).toBe('true');
  expect(new URL(env.DATABASE_URL).pathname).toBe('/hrm_preview');
  expect(env.DINGTALK_NOTIFICATION_ENABLED).toBe('false');
  expect(env.DINGTALK_INTERVIEW_CALENDAR_ENABLED).toBe('false');
  expect(Object.keys(container.NetworkSettings.Networks)).toEqual(['hrm_internal']);
});

async function login(page: Page, employeeNo = 'HR001') {
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  if (employeeNo !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${employeeNo})` }).click();
  }
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

async function token(request: APIRequestContext, employeeNo: string) {
  const response = await request.post('/api/v1/auth/test-login', { data: { employeeNo } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.token as string;
}

test('anonymous entry and role login render without external login or horizontal overflow', async ({ page }, info) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== 'localhost') external.push(new URL(request.url()).hostname);
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: '预览系统' })).toBeVisible();
  await expect(page.getByRole('button', { name: /钉钉/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('login.png'), fullPage: true });
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true });
  expect(external).toEqual([]);
});

test('HR can create through the page and read persisted real-backend data after reload', async ({ page, request }, info) => {
  const name = `预览回归${Date.now()}${info.project.name}`;
  const phone = `100${Date.now().toString().slice(-8)}`;
  let id: string | undefined;
  const authorization = `Bearer ${await token(request, 'HR001')}`;
  try {
    await login(page);
    await page.goto('/talents');
    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    await page.getByPlaceholder('候选人姓名', { exact: true }).fill(name);
    await page.getByPlaceholder('11 位手机号', { exact: true }).fill(phone);
    await page.getByTestId('talent-form-source').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/talents') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '加入人才库', exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    id = (await response.json()).data.id;
    await page.reload();
    await expect(page.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    const persisted = await request.get(`/api/v1/talents/${id}`, { headers: { authorization } });
    expect((await persisted.json()).data.name).toBe(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('talents.png'), fullPage: true });
  } finally {
    if (id) {
      const impact = await request.get(`/api/v1/talents/${id}/delete-impact`, { headers: { authorization } });
      const removed = await request.delete(`/api/v1/talents/${id}`, { headers: { authorization }, data: { impactVersion: (await impact.json()).data.version } });
      expect(removed.ok()).toBeTruthy();
    }
  }
});

test('employee is denied HR data while fictional manager has actual team capability', async ({ request, page }) => {
  await login(page, 'EMP001');
  const employeeToken = await token(request, 'EMP001');
  const response = await request.get('/api/v1/talents', { headers: { authorization: `Bearer ${employeeToken}` } });
  expect(response.status()).toBe(403);
  const managerToken = await token(request, 'MGR001');
  const me = await request.get('/api/v1/auth/me', { headers: { authorization: `Bearer ${managerToken}` } });
  const user = (await me.json()).data;
  expect(user.businessCapabilities.canManageTeam).toBe(true);
});

test('preview storage uploads and downloads real bytes without production access', async ({ request }) => {
  const authorization = `Bearer ${await token(request, 'HR001')}`;
  const content = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');
  const upload = await request.post('/api/v1/storage/upload?purpose=talent-resume', {
    headers: { authorization }, multipart: { file: { name: 'preview-fixture.png', mimeType: 'image/png', buffer: content } },
  });
  expect(upload.ok()).toBeTruthy();
  const meta = (await upload.json()).data;
  const download = await request.get(`/api/v1${meta.url}`, { headers: { authorization } });
  expect(download.ok()).toBeTruthy();
  expect(await download.body()).toEqual(content);
});
