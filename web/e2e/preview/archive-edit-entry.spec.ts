import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(150_000);

function fixtureQuery(source: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1; });`,
  }));
}

test.beforeAll(() => {
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  const env = (container: any) => Object.fromEntries(container.Config.Env.map((line: string) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  expect(new URL(env(api).DATABASE_URL).pathname).toBe('/hrm_preview');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(env(web).VITE_PREVIEW_MODE).toBe('true');
  expect(env(web).VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  expect(web.NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
});

async function login(page: Page) {
  await page.goto(`${origin}/login`);
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

async function api(page: Page, path: string, data?: unknown) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const options = { headers: { authorization: `Bearer ${token}` }, ...(data === undefined ? {} : { data }) };
  const response = data === undefined
    ? await page.request.get(`${origin}/api/v1${path}`, options)
    : await page.request.patch(`${origin}/api/v1${path}`, options);
  expect(response.status(), `${data === undefined ? 'GET' : 'PATCH'} ${path}`).toBe(200);
  return (await response.json()).data;
}

function saveResponse(page: Page, id: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/employee-archives/${id}/draft/save`
    && response.request().method() === 'PATCH');
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test('real archive editing resumes fresh drafts, keeps concurrent input, and resumes historical pending records', async ({ page, context }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const viewport = info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  const observed = { errors: [] as string[], external: [] as string[], writes: [] as string[] };
  const observe = (target: Page) => {
    target.on('pageerror', error => observed.errors.push(error.message));
    target.on('request', request => {
      if (!/^https?:/.test(request.url())) return;
      const url = new URL(request.url());
      if (url.origin !== origin) observed.external.push(url.origin);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) observed.writes.push(url.pathname);
    });
  };
  observe(page);
  const suffix = randomUUID().slice(0, 8);
  const employeeNo = `AE_${suffix}`;
  const employee = fixtureQuery(`
    const department = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const employee = await prisma.user.create({ data: {
      name: '虚构编辑${suffix}', employeeNo: '${employeeNo}', status: 'active', sysRole: 'employee',
      deptId: department.id, entryDate: new Date('2025-01-01T00:00:00Z'),
      employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), company: 'fuede',
        deptId: department.id, entryDate: new Date('2025-01-01T00:00:00Z'), changeType: 'onboarding', probationMonths: 0 } },
    } }); console.log(JSON.stringify({ id: employee.id, name: employee.name, employeeNo: employee.employeeNo }));
  `) as { id: string; name: string; employeeNo: string };
  let secondPage: Page | undefined;
  try {
    await login(page);
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    const nameField = drawer.locator('[data-archive-field="employee.name"] input');
    const openDetail = async () => {
      await page.goto(`${origin}/users?employeeId=${employee.id}`);
      await expect(drawer.getByRole('heading', { name: employee.name, exact: true })).toBeVisible();
    };
    await openDetail();
    const beforeOpenWrites = observed.writes.length;
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await expect(nameField).toHaveValue(employee.name);
    await page.waitForTimeout(1300); // Beyond the 700ms autosave debounce: opening is not an edit.
    expect(observed.writes.slice(beforeOpenWrites)).toEqual([]);
    await expect(drawer.locator('.archive-save-error')).toHaveCount(0);
    await expect(page.locator('.el-message--error')).toHaveCount(0);
    await snapshot(page, info, 'quiet-edit-entry');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();

    await openDetail();
    const archive = await api(page, `/employee-archives/${employee.id}`);
    // A separate save after detail opened simulates another HR's newly available draft.
    const draft = await api(page, `/employee-archives/${employee.id}/draft/save`, {
      baseVersion: archive.archiveVersion, employee: { name: `${employee.name}原草稿` }, profile: {}, contracts: [], performance: {},
    });
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await expect(nameField).toHaveValue(`${employee.name}原草稿`);
    const firstSave = saveResponse(page, employee.id);
    await nameField.fill(`${employee.name}续写`);
    const firstSaved = await firstSave;
    expect(firstSaved.status()).toBe(200);
    expect(firstSaved.request().postDataJSON()).toMatchObject({ draftId: draft.id, expectedVersion: draft.requestVersion });
    await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');

    secondPage = await context.newPage();
    await secondPage.setViewportSize(viewport);
    observe(secondPage);
    await secondPage.goto(`${origin}/users?employeeId=${employee.id}`);
    const secondDrawer = secondPage.getByRole('dialog', { name: '员工档案', exact: true });
    await secondDrawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    const secondNameField = secondDrawer.locator('[data-archive-field="employee.name"] input');
    await expect(secondNameField).toHaveValue(`${employee.name}续写`);
    const latestName = `${employee.name}另一窗口`;
    const secondSave = saveResponse(secondPage, employee.id);
    await secondNameField.fill(latestName);
    expect((await secondSave).status()).toBe(200);

    const staleSave = saveResponse(page, employee.id);
    const retainedName = `${employee.name}保留输入`;
    await nameField.fill(retainedName);
    expect((await staleSave).status()).toBe(409);
    await expect(drawer.locator('.archive-save-error')).toHaveCount(1);
    await expect(page.locator('.el-message--error')).toHaveCount(0);
    await expect(nameField).toHaveValue(retainedName);
    await expect(drawer.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
    await drawer.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('button', { name: '保留当前输入', exact: true }).click();
    await expect(nameField).toHaveValue(retainedName);
    await snapshot(page, info, 'one-concurrency-notice-retains-input');
    await drawer.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('button', { name: '放弃修改并加载', exact: true }).click();
    await expect(nameField).toHaveValue(latestName);
    await expect(drawer.locator('.archive-save-error')).toHaveCount(0);
    expect((await api(page, `/employee-archives/${employee.id}`)).name).toBe(employee.name);
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await secondPage.close(); secondPage = undefined;

    // Fixture-only transition to a historical pending request. Opening resumes its proposal without applying it.
    fixtureQuery(`
      const employee = await prisma.user.findFirstOrThrow({ where: { id: '${employee.id}', employeeNo: '${employeeNo}' } });
      const updated = await prisma.employeeDataChangeRequest.updateMany({ where: { id: '${draft.id}', userId: employee.id },
        data: { recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' } });
      if (updated.count !== 1) throw new Error('Fixture request missing'); console.log(JSON.stringify({ changed: updated.count }));
    `);
    await openDetail();
    const beforePending = observed.writes.length;
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await expect(drawer.getByText('已有待处理的档案变更', { exact: true })).toHaveCount(0);
    await expect(drawer.locator('.archive-inline-editor')).toBeVisible();
    await expect(nameField).toHaveValue(latestName);
    await page.waitForTimeout(1000);
    expect(observed.writes.slice(beforePending)).toEqual([]);
    await expect(page.locator('.el-message--error')).toHaveCount(0);
    await snapshot(page, info, 'historical-pending-resumes-edit');
    expect((await api(page, `/employee-archives/${employee.id}`)).name).toBe(employee.name);
    expect(observed.errors).toEqual([]);
    expect(observed.external).toEqual([]);
    await info.attach('isolated-edit-evidence', { body: JSON.stringify({ employeeNo, ...observed }, null, 2), contentType: 'application/json' });
  } finally {
    await secondPage?.close();
    // Only this run's UUID-qualified fictional employee and its own records are removed.
    fixtureQuery(`
      const employee = await prisma.user.findFirstOrThrow({ where: { id: '${employee.id}', employeeNo: '${employeeNo}' } });
      const requests = await prisma.employeeDataChangeRequest.findMany({ where: { userId: employee.id }, select: { id: true } });
      await prisma.$transaction(async tx => {
        await tx.auditLog.deleteMany({ where: { OR: [{ entityType: 'user', entityId: employee.id },
          { entityType: 'employee_data_change_request', entityId: { in: requests.map(r => r.id) } }] } });
        await tx.employmentRecord.deleteMany({ where: { userId: employee.id } });
        await tx.employeeDataChangeRequest.deleteMany({ where: { userId: employee.id } });
        await tx.employeeProfile.deleteMany({ where: { userId: employee.id } });
        await tx.user.delete({ where: { id: employee.id } });
      }); console.log(JSON.stringify({ removedOwnFixture: true }));
    `);
  }
});
