import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const origin = 'http://localhost:5173';
type Attachment = { name: string; url: string; size: number };
type Fixture = { prefix: string; cycleId: string; taskId: string; employeeId: string; managerId: string };

function fixtureQuery(code: string) {
  const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      (async () => {
        const marker = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
        if (marker?.value?.fictional !== true) throw new Error('Fictional preview marker required');
        ${code}
      })().finally(() => db.$disconnect()).catch(error => {
        console.log(JSON.stringify({ fixtureError: error.code ?? error.name }));
      });`,
  });
  const result = JSON.parse(output.trim());
  if (result.fixtureError) throw new Error(`Isolated download fixture failed: ${result.fixtureError}`);
  return result;
}

function createFixture(): Fixture {
  const prefix = `DOWNLOAD_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const employee = await db.user.findFirstOrThrow({ where: { employeeNo: 'EMP001', deletedAt: null, name: { startsWith: '测试·' } } });
    const manager = await db.user.findFirstOrThrow({ where: { employeeNo: 'MGR001', deletedAt: null, name: { startsWith: '测试·' } } });
    if (employee.directManagerId !== manager.id) throw new Error('Fictional reporting relationship required');
    const result = await db.$transaction(async tx => {
      const cycle = await tx.assessmentCycle.create({ data: { name: '${prefix}',
        startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'), status: 'manager_score',
        workflowVersion: 1, notificationMode: 'off' } });
      const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: employee.id,
        managerId: manager.id, deptId: employee.deptId, status: 'manager_scoring', selfEvalSubmittedAt: new Date() } });
      return { prefix: '${prefix}', cycleId: cycle.id, taskId: task.id, employeeId: employee.id, managerId: manager.id };
    });
    console.log(JSON.stringify(result));
  `);
}

function ownedFixture(f: Fixture, code: string) {
  return fixtureQuery(`
    const f = ${JSON.stringify(f)};
    if (!await db.assessmentTask.findFirst({ where: { id: f.taskId, cycleId: f.cycleId,
      employeeId: f.employeeId, cycle: { name: f.prefix } } })) throw new Error('Fixture ownership mismatch');
    ${code}
  `);
}

async function login(request: APIRequestContext, employeeNo: 'EMP001' | 'MGR001') {
  const response = await request.post(`${origin}/api/v1/auth/test-login`, { data: { employeeNo }, maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const token = (await response.json()).data.token;
  expect(typeof token).toBe('string');
  return token as string;
}

const pdf = (name: string) => Buffer.from(`%PDF-1.4\n% Fictional attachment download: ${name}\n%%EOF\n`);
async function upload(request: APIRequestContext, token: string, name: string): Promise<Attachment> {
  const response = await request.post(`${origin}/api/v1/storage/upload`, {
    headers: { authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: 'application/pdf', buffer: pdf(name) } }, maxRedirects: 0,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

async function clickDownload(page: Page, link: Locator, attachment: Attachment) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/download');
  const downloadPromise = page.waitForEvent('download', { timeout: 8_000 });
  await link.click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  const url = new URL(response.url());
  expect(url.origin).toBe(origin);
  expect([...url.searchParams.keys()]).toEqual(['key']);
  expect(Boolean(response.request().headers().authorization?.startsWith('Bearer '))).toBe(true);
  expect(download.suggestedFilename()).toBe(attachment.name);
  expect(await download.failure()).toBeNull();
  const saved = await download.path();
  expect(saved).not.toBeNull();
  expect(await readFile(saved!)).toEqual(pdf(attachment.name));
  expect(await response.body()).toEqual(pdf(attachment.name));
  await download.delete();
}

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off' });
test.setTimeout(90_000);
test.beforeAll(({}, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.config.globalSetup).toBeNull();
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(containers[0].NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(containers[1].NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
});

test('real authenticated task attachment clicks preserve PDF bytes and permission denial', async ({ page }, info) => {
  const f = createFixture();
  const files: Attachment[] = [], blocked: string[] = [], errors: string[] = [];
  page.on('pageerror', () => errors.push('pageerror'));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    await route.continue();
  });
  try {
    const employeeToken = await login(page.request, 'EMP001');
    const managerToken = await login(page.request, 'MGR001');
    const employeeFile = await upload(page.request, employeeToken, `${f.prefix}_employee.pdf`); files.push(employeeFile);
    const managerFile = await upload(page.request, managerToken, `${f.prefix}_manager.pdf`); files.push(managerFile);
    const apiUrl = `${origin}/api/v1${employeeFile.url}`;
    expect((await page.request.get(apiUrl, { maxRedirects: 0 })).status()).toBe(401);
    expect((await page.request.get(apiUrl, { headers: { authorization: `Bearer ${managerToken}` } })).status()).toBe(403);
    ownedFixture(f, `
      await db.selfEvalSummary.create({ data: { taskId: f.taskId, achievements: 'Fictional evidence', attachments: ${JSON.stringify([employeeFile])} } });
      await db.managerEvalSummary.create({ data: { taskId: f.taskId, strengths: 'Fictional feedback', attachments: ${JSON.stringify([managerFile])} } });
      console.log(JSON.stringify({ attached: true }));
    `);
    await page.addInitScript(token => {
      localStorage.setItem('token', token);
      localStorage.setItem('expiresAt', String(Date.now() + 600_000));
    }, managerToken);
    await page.goto(`/tasks?scope=team&stage=manager-eval&cycleId=${f.cycleId}&employeeId=${f.employeeId}&taskId=${f.taskId}`);
    await expect(page.getByTestId('preview-badge')).toBeVisible();
    const workspace = page.getByTestId('manager-evaluation-workspace');
    await clickDownload(page, workspace.locator('.file-upload').getByRole('link', { name: managerFile.name, exact: true }), managerFile);
    const employeeLink = workspace.locator('.summary-attachments').getByRole('link', { name: employeeFile.name, exact: true });
    await clickDownload(page, employeeLink, employeeFile);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await employeeLink.screenshot({ path: info.outputPath('manager-authenticated-evidence.png') });

    // Keep the page's old link, but remove only this owned fixture's manager relation at the real backend.
    ownedFixture(f, `await db.assessmentTask.update({ where: { id: f.taskId }, data: { managerId: null } }); console.log(JSON.stringify({ revoked: true }));`);
    let unexpectedDownloads = 0;
    page.on('download', () => unexpectedDownloads++);
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/download');
    await employeeLink.click();
    expect((await denied).status()).toBe(403);
    await expect(page.locator('.el-message--error')).toContainText('无权限');
    expect(unexpectedDownloads).toBe(0);
    await page.locator('.el-message--error').screenshot({ path: info.outputPath('real-download-denied.png') });
    ownedFixture(f, `
      await db.assessmentTask.update({ where: { id: f.taskId }, data: { managerId: f.managerId, status: 'published', publishedAt: new Date() } });
      await db.assessmentCycle.update({ where: { id: f.cycleId }, data: { status: 'published' } });
      console.log(JSON.stringify({ publishedFixture: true }));
    `);
    await page.addInitScript(token => { localStorage.setItem('token', token); }, employeeToken);
    await page.goto(`/tasks/${f.taskId}?stage=result`);
    const readonly = page.locator('.manager-summary__attachments').getByRole('link', { name: managerFile.name, exact: true });
    await expect(readonly).toBeVisible();
    await clickDownload(page, readonly, managerFile);
    await readonly.screenshot({ path: info.outputPath('employee-readonly-authenticated-evidence.png') });
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    const cleanup = ownedFixture(f, `
      const attachments = ${JSON.stringify(files)};
      const { StorageService } = require('./dist/src/storage/storage.service');
      const { ConfigService } = require('@nestjs/config');
      const storage = new StorageService(new ConfigService(process.env));
      for (const file of attachments) {
        const key = new URL(file.url, '${origin}').searchParams.get('key');
        if (!key?.split('/').at(-1)?.endsWith('-' + file.name) || !file.name.startsWith(f.prefix + '_')) throw new Error('Object ownership mismatch');
        await storage.removeObject(key);
      }
      await db.$transaction(async tx => {
        await tx.assessmentTask.delete({ where: { id: f.taskId } });
        await tx.assessmentCycle.delete({ where: { id: f.cycleId } });
      });
      console.log(JSON.stringify({ removedFiles: attachments.length,
        remainingTasks: await db.assessmentTask.count({ where: { id: f.taskId } }),
        remainingCycles: await db.assessmentCycle.count({ where: { id: f.cycleId } }) }));
    `);
    await info.attach('owned-fixture-cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' });
    expect(cleanup.remainingTasks).toBe(0);
    expect(cleanup.remainingCycles).toBe(0);
    console.log(`Download fixture cleanup: ${JSON.stringify(cleanup)}`);
  }
});
