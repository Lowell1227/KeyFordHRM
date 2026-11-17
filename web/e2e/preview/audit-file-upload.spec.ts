import { test as base, expect, type Page, type Locator, type Response } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
type Fixture = { prefix: string; employeeId: string; cycles: string[]; tasks: string[] };
type Attachment = { name: string; url: string; size: number };

function fixtureQuery(code: string) {
  let output: string;
  try {
    output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
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
  } catch { throw new Error('Isolated upload fixture operation failed'); }
  const result = JSON.parse(output.trim());
  if (result.fixtureError) throw new Error(`Isolated upload fixture failed: ${result.fixtureError}`);
  return result;
}

function createFixture(status: 'self_eval' | 'manager_scoring'): Fixture {
  const prefix = `UPLOAD_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const employee = await db.user.findFirstOrThrow({ where: { employeeNo: 'EMP001', deletedAt: null, name: { startsWith: '测试·' } } });
    const manager = await db.user.findFirstOrThrow({ where: { employeeNo: 'MGR001', deletedAt: null, name: { startsWith: '测试·' } } });
    if (employee.directManagerId !== manager.id) throw new Error('Fictional reporting relationship required');
    const result = await db.$transaction(async tx => {
      const cycles = [], tasks = [];
      for (const suffix of ['A', 'B']) {
        const cycle = await tx.assessmentCycle.create({ data: { name: '${prefix}_' + suffix,
          startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'), status: '${status === 'manager_scoring' ? 'manager_score' : status}',
          workflowVersion: 1, notificationMode: 'off' } });
        cycles.push(cycle.id);
        const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: employee.id,
          managerId: manager.id, deptId: employee.deptId, status: '${status}' } });
        tasks.push(task.id);
      }
      return { prefix: '${prefix}', employeeId: employee.id, cycles, tasks };
    });
    console.log(JSON.stringify(result));
  `);
}

function removeFixture(f: Fixture) {
  return fixtureQuery(`
    const f = ${JSON.stringify(f)};
    await db.$transaction(async tx => {
      if (await tx.assessmentCycle.count({ where: { id: { in: f.cycles }, name: { startsWith: f.prefix + '_' } } }) !== 2
        || await tx.assessmentTask.count({ where: { id: { in: f.tasks }, cycleId: { in: f.cycles }, employeeId: f.employeeId } }) !== 2)
        throw new Error('Fixture ownership mismatch');
      await tx.notificationLog.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.flowRecord.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.selfEvalSummary.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.managerEvalSummary.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.auditLog.deleteMany({ where: { entityId: { in: [...f.tasks, ...f.cycles] } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: f.tasks } } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: f.cycles } } });
    });
    const { Client } = require('minio');
    const storage = new Client({ endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT), useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
    const bucket = process.env.MINIO_BUCKET;
    const ownKeys = async () => {
      const keys = [];
      for await (const object of storage.listObjectsV2(bucket, 'uploads/', true)) {
        if (object.name?.split('/').at(-1)?.includes('-' + f.prefix + '_')) keys.push(object.name);
      }
      return keys;
    };
    const keys = await ownKeys();
    for (const key of keys) await storage.removeObject(bucket, key);
    console.log(JSON.stringify({ prefix: f.prefix, removedObjects: keys.length,
      remainingObjects: (await ownKeys()).length,
      remainingTasks: await db.assessmentTask.count({ where: { id: { in: f.tasks } } }),
      remainingCycles: await db.assessmentCycle.count({ where: { id: { in: f.cycles } } }) }));
  `);
}

const test = base.extend<{ fixture: Fixture; fixtureStatus: 'self_eval' | 'manager_scoring' }>({
  fixtureStatus: ['manager_scoring', { option: true }],
  fixture: async ({ page, fixtureStatus }, use, info) => {
    expect(info.project.use.baseURL).toBe(origin);
    expect(info.config.globalSetup).toBeNull();
    const f = createFixture(fixtureStatus);
    const blocked: string[] = [], errors: string[] = [];
    page.on('pageerror', () => errors.push('pageerror'));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const allowedWrite = request.method() === 'POST' && url.pathname === '/api/v1/storage/upload'
        || request.method() === 'PUT' && f.tasks.some(id => url.pathname === `/api/v1/tasks/${id}/manager-evaluation-draft`);
      if (url.origin !== origin || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()) && !allowedWrite)) {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      await route.continue();
    });
    try {
      const employeeNo = fixtureStatus === 'manager_scoring' ? 'MGR001' : 'EMP001';
      const login = await page.request.post(`${origin}/api/v1/auth/test-login`, { data: { employeeNo }, maxRedirects: 0 });
      expect(login.status()).toBe(200);
      const token = (await login.json()).data.token;
      expect(typeof token).toBe('string');
      await page.addInitScript(value => {
        localStorage.setItem('token', value);
        localStorage.setItem('expiresAt', String(Date.now() + 600_000));
      }, token);
      await use(f);
      expect(blocked).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      const cleanup = removeFixture(f);
      await info.attach('sample-cleanup', { body: JSON.stringify(cleanup, null, 2), contentType: 'application/json' });
      expect(cleanup.remainingTasks).toBe(0);
      expect(cleanup.remainingCycles).toBe(0);
      expect(cleanup.remainingObjects).toBe(0);
      console.log(`Upload fixture cleanup: ${JSON.stringify(cleanup)}`);
    }
  },
});

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off' });
test.setTimeout(90_000);
test.beforeAll(({}, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  const format = '{"project":"{{index .Config.Labels "com.docker.compose.project"}}","running":{{.State.Running}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}';
  const containers = execFileSync('docker', ['inspect', '--format', format, 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' })
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
  for (const container of containers) {
    expect(container.project).toBe('hrm');
    expect(container.running).toBe(true);
  }
  expect(Object.keys(containers[0].networks)).toEqual(['hrm_internal']);
  expect(containers[1].ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
});

const isUpload = (response: Response) => new URL(response.url()).pathname === '/api/v1/storage/upload'
  && response.request().method() === 'POST';
function payload(f: Fixture, suffix: string) {
  return { name: `${f.prefix}_${suffix}.pdf`, mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% Fictional upload regression evidence\n%%EOF\n') };
}
async function upload(page: Page, box: Locator, f: Fixture, suffix: string): Promise<Attachment> {
  const responsePromise = page.waitForResponse(isUpload);
  await box.locator('input[type=file]').setInputFiles(payload(f, suffix));
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const attachment = (await response.json()).data;
  expect(attachment.name).toBe(`${f.prefix}_${suffix}.pdf`);
  await expect(box.getByRole('link', { name: attachment.name, exact: true })).toBeVisible();
  return attachment;
}
async function remove(box: Locator, name: string) {
  await box.locator('.file-upload__item').filter({ hasText: name }).getByRole('button', { name: '删除', exact: true }).click();
  await expect(box.getByRole('link', { name, exact: true })).toHaveCount(0);
}
async function assertLayout(page: Page, box: Locator) {
  await box.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await box.locator('.file-upload__item').evaluateAll(rows => rows.every(row => {
    const name = row.querySelector('a')!.getBoundingClientRect();
    const button = row.querySelector('button')!.getBoundingClientRect();
    return name.right <= button.left + 1 && button.right <= innerWidth && name.left >= 0;
  }))).toBe(true);
}
async function navigate(page: Page, target: string) {
  await page.evaluate(async path => {
    const app = (document.querySelector('#app') as Element & {
      __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } } };
    }).__vue_app__;
    await app.config.globalProperties.$router.push(path);
  }, target);
}

test('#15 real manager delete-upload-delete retains C after save and reload', async ({ page, fixture: f }, info) => {
  const url = `/tasks?scope=team&stage=manager-eval&cycleId=${f.cycles[0]}&employeeId=${f.employeeId}&taskId=${f.tasks[0]}`;
  await page.goto(url);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  const box = page.getByTestId('manager-evaluation-workspace').locator('.file-upload');
  await expect(box).toBeVisible();
  const a = await upload(page, box, f, 'A');
  const b = await upload(page, box, f, 'B');
  await remove(box, a.name);
  const c = await upload(page, box, f, 'C-new-attachment');
  await expect(box.locator('.file-upload__name')).toHaveText([b.name, c.name]);
  await remove(box, b.name);
  await expect(box.locator('.file-upload__name')).toHaveText([c.name]);
  await assertLayout(page, box);
  await box.screenshot({ path: info.outputPath('manager-delete-upload-delete.png'), animations: 'disabled' });

  const saveResponse = page.waitForResponse(response => response.url().endsWith(`/tasks/${f.tasks[0]}/manager-evaluation-draft`)
    && response.request().method() === 'PUT');
  await page.getByTestId('manager-evaluation-save').click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');
  expect(fixtureQuery(`console.log(JSON.stringify((await db.managerEvalSummary.findUniqueOrThrow({ where: { taskId: '${f.tasks[0]}' } })).attachments));`))
    .toEqual([c]);
  await page.reload();
  await expect(box.locator('.file-upload__name')).toHaveText([c.name]);
  await assertLayout(page, box);
  await box.screenshot({ path: info.outputPath('manager-saved-reloaded.png'), animations: 'disabled' });
});

test.describe('employee upload lifecycle', () => {
  test.use({ fixtureStatus: 'self_eval' });
  test('#15 real inflight upload preserves deletion and cannot follow navigation to B', async ({ page, fixture: f }, info) => {
    const pathA = `/tasks/${f.tasks[0]}?stage=self-eval`, pathB = `/tasks/${f.tasks[1]}?stage=self-eval`;
    await page.goto(pathA);
    await expect(page.getByTestId('preview-badge')).toBeVisible();
    const box = page.getByTestId('self-eval-summary').locator('.file-upload');
    const a = await upload(page, box, f, 'A');
    const c = await upload(page, box, f, 'C');
    await remove(box, a.name);

    let release!: () => void, reached = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Hold only request timing; continue sends the actual file to the real isolated upload backend.
    await page.route('**/api/v1/storage/upload?*', async route => {
      reached = true;
      await gate;
      await route.fallback();
    }, { times: 1 });
    const responsePromise = page.waitForResponse(isUpload);
    try {
      await box.locator('input[type=file]').setInputFiles(payload(f, 'late-A'));
      await expect.poll(() => reached).toBe(true);
      await remove(box, c.name);
      await navigate(page, pathB);
      await expect(page).toHaveURL(`${origin}${pathB}`);
      await expect(box).toBeVisible();
      await expect(box.locator('.file-upload__item')).toHaveCount(0);
    } finally { release(); }
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    expect((await response.json()).data.name).toBe(`${f.prefix}_late-A.pdf`);
    await response.finished();
    const fresh = await upload(page, box, f, 'fresh-B');
    await expect(box.locator('.file-upload__name')).toHaveText([fresh.name]);
    await assertLayout(page, box);
    await box.screenshot({ path: info.outputPath('employee-target-B-no-late-A.png'), animations: 'disabled' });
    await navigate(page, pathA);
    await expect(box).toBeVisible();
    await expect(box.locator('.file-upload__item')).toHaveCount(0);
    await page.reload();
    await expect(box).toBeVisible();
    await expect(box.locator('.file-upload__item')).toHaveCount(0);
    await box.screenshot({ path: info.outputPath('employee-A-no-resurrection.png'), animations: 'disabled' });
  });
});
