import { expect, test, type Page } from '@playwright/test';

const statusPath = '/api/v1/system/configuration-status';

async function signIn(page: Page, employeeNo: 'ADMIN' | 'HR001') {
  const response = await page.request.post('/api/v1/auth/test-login', { data: { employeeNo } });
  expect(response.ok()).toBe(true);
  const token = (await response.json()).data.token as string;
  expect(typeof token).toBe('string');
  await page.goto('/login');
  await page.evaluate(value => {
    localStorage.setItem('token', value);
    localStorage.setItem('expiresAt', String(Date.now() + 3500000));
  }, token);
  return { authorization: 'Bearer ' + token };
}

async function hasNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('administrator sees only status and can open the corresponding provider settings', async ({ page }, info) => {
  expect((await page.request.get(statusPath)).status()).toBe(401);
  const headers = await signIn(page, 'ADMIN');
  const response = await page.request.get(statusPath, { headers });
  expect(response.status()).toBe(200);
  const rows = (await response.json()).data;
  expect(rows.length).toBeGreaterThan(8);
  for (const row of rows) {
    expect(Object.keys(row)).toEqual(expect.arrayContaining(['enabled', 'fields', 'id', 'verification', 'verifiedAt']));
    for (const field of row.fields) {
      expect(Object.keys(field).sort()).toEqual(['label', 'state']);
      expect(['present', 'missing', 'managed', 'unknown']).toContain(field.state);
    }
  }
  await page.goto('/system');
  const overview = page.getByRole('region', { name: '配置总览' });
  await expect(overview.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await overview.getByRole('button', { name: '全部', exact: true }).click();
  const resume = overview.locator('#config-ai-resume');
  await expect(resume).toBeVisible();
  await expect(resume).toContainText(/API Key[：:].*(已填写|未填写|待核实)/);
  await expect(overview.locator('#config-recruitment-mail')).toBeVisible();
  await expect(page.getByRole('region', { name: '系统能力状态' })).toBeHidden();
  await hasNoOverflow(page);
  await page.screenshot({ path: info.outputPath('configuration.png'), fullPage: true });
  const capabilityToggle = page.getByTestId('system-overview').locator('summary');
  await capabilityToggle.click();
  await expect(page.getByRole('region', { name: '系统能力状态' })).toBeVisible();
  await capabilityToggle.click();
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 768 });
    await hasNoOverflow(page);
  }
  const [destination] = await Promise.all([
    page.waitForEvent('popup'),
    resume.getByRole('link', { name: '前往配置' }).click(),
  ]);
  await expect(destination).toHaveURL(/\/system\/configurations\/ai-resume$/);
  await expect(destination.getByRole('heading', { name: '简历解析', exact: true })).toBeVisible();
  await expect(destination.getByRole('link', { name: '维护 DeepSeek 凭据' })).toBeVisible();
  await expect(page).toHaveURL(/\/system$/);
});

test('HR follows the mailbox help link without access to credential status', async ({ page }) => {
  const headers = await signIn(page, 'HR001');
  expect((await page.request.get(statusPath, { headers })).status()).toBe(403);
  let browserStatusRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === statusPath) browserStatusRequests++;
  });
  await page.goto('/system');
  await expect(page.getByText('集成凭据和验证状态由系统管理员查看。')).toBeVisible();
  expect(browserStatusRequests).toBe(0);
  await page.goto('/recruitment/intakes?state=awaiting_resume');
  const alert = page.locator('.el-alert').filter({ hasText: '招聘邮箱未配置' });
  await expect(alert).toBeVisible();
  const [destination] = await Promise.all([
    page.waitForEvent('popup'),
    alert.getByRole('link', { name: '查看配置方式' }).click(),
  ]);
  await expect(destination).toHaveURL(/\/configuration-help\/recruitment-mail$/);
  await expect(destination.getByText('由系统管理员处理', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/recruitment\/intakes\?state=awaiting_resume$/);
  await hasNoOverflow(destination);
});

test('opening resume configuration help leaves the HR draft in place', async ({ page }) => {
  await signIn(page, 'HR001');
  const writes: string[] = [];
  page.context().on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(path);
  });
  await page.goto('/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const name = page.getByPlaceholder('候选人姓名');
  await name.fill('虚构配置验收草稿');
  const [destination] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: '查看配置方式' }).click(),
  ]);
  await expect(destination).toHaveURL(/\/configuration-help\/ai-resume$/);
  await expect(name).toHaveValue('虚构配置验收草稿');
  expect(writes).toEqual([]);
});

test('a payroll rule issue opens settings for the same subject and month', async ({ page }) => {
  await signIn(page, 'HR001');
  const subjectId = 'c1067f7c-d879-4d18-a6ca-115f8504a694';
  const month = '2036-11';
  const batch = '/payroll/batches/48690bd2-713f-423e-8f7b-71a6fcd15938';
  await page.goto(`${batch}?subjectId=${subjectId}&month=${month}`);
  await page.getByRole('combobox', { name: '计算版本' }).press('Enter');
  await page.getByRole('option', { name: /^第 11 版 ·/ }).click();
  const issue = page.locator('.issue-list li').filter({ hasText: '考核期间与工资归属月不一致' });
  const [destination] = await Promise.all([
    page.waitForEvent('popup', { timeout: 10000 }),
    issue.getByRole('link', { name: '发薪主体工资规则' }).click(),
  ]);
  await expect(destination).toHaveURL(url => url.pathname === '/payroll/standards'
    && url.searchParams.get('subjectId') === subjectId && url.searchParams.get('month') === month
    && url.searchParams.get('tab') === 'rules');
  await expect(destination.getByRole('tab', { name: '工资规则', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(url => url.pathname === batch);
});
