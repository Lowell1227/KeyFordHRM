import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
type Fixture = { prefix: string; employeeId: string; cycles: string[]; tasks: string[] };

function query<T>(code: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
        (async () => {
          const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview') throw Error('Wrong database');
          const marker = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
          if (marker?.value?.fictional !== true) throw Error('Missing fictional marker');
          const result = await (async () => { ${code} })(); process.stdout.write(JSON.stringify(result));
        })().finally(() => db.$disconnect()).catch(() => process.exitCode = 1);`,
      encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch { throw Error('Isolated late-submission fixture failed; output withheld'); }
}

function createFixture(): Fixture {
  const prefix = `LATEPOST_${randomUUID().slice(0, 8)}`;
  return query(`
    const employee = await db.user.findFirstOrThrow({ where: { employeeNo: 'EMP001', deletedAt: null,
      name: { startsWith: '测试·' } } });
    const manager = await db.user.findFirstOrThrow({ where: { employeeNo: 'MGR001', deletedAt: null,
      name: { startsWith: '测试·' } } });
    return db.$transaction(async tx => {
      const cycles = [], tasks = [];
      for (const suffix of ['A', 'B']) {
        const cycle = await tx.assessmentCycle.create({ data: { name: '${prefix}_' + suffix,
          status: 'self_eval', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'),
          workflowVersion: 1, notificationMode: 'off' } });
        const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: employee.id,
          managerId: manager.id, deptId: employee.deptId, status: 'self_eval',
          indicatorInstances: { create: { name: '${prefix}_' + suffix, weight: 1,
            dimensionWeight: 1, indicatorType: 'kpi', selfScore: 80 } } } });
        cycles.push(cycle.id); tasks.push(task.id);
      }
      return { prefix: '${prefix}', employeeId: employee.id, cycles, tasks };
    });
  `);
}

function cleanup(f: Fixture) {
  return query<{ tasks: number; cycles: number }>(`
    const f = ${JSON.stringify(f)};
    if (await db.assessmentCycle.count({ where: { id: { in: f.cycles }, name: { startsWith: f.prefix + '_' },
      notificationMode: 'off' } }) !== 2 || await db.assessmentTask.count({ where: { id: { in: f.tasks },
      employeeId: f.employeeId, cycleId: { in: f.cycles } } }) !== 2) throw Error('Foreign fixture');
    await db.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.flowRecord.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.auditLog.deleteMany({ where: { entityId: { in: [...f.tasks, ...f.cycles] } } });
      await tx.selfEvalSummary.deleteMany({ where: { taskId: { in: f.tasks } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: f.tasks } } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: f.cycles } } });
    });
    return { tasks: await db.assessmentTask.count({ where: { id: { in: f.tasks } } }),
      cycles: await db.assessmentCycle.count({ where: { id: { in: f.cycles } } }) };
  `);
}

test.use({ trace: 'off', video: 'off', screenshot: 'off', timezoneId: 'Asia/Shanghai' });
test.setTimeout(90_000);

test('late real self-evaluation response cannot remove the new task draft', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
    encoding: 'utf8', timeout: 15_000, stdio: 'pipe',
  }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(containers[0].NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(containers[1].NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  const f = createFixture(), blocked: string[] = [], errors: string[] = [];
  let release!: () => void, responseFetched = false, responseDelivered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const endpoint = `/api/v1/tasks/${f.tasks[0]}/self-eval`;
  page.on('pageerror', () => errors.push('pageerror'));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method())
      && !(url.pathname === endpoint && req.method() === 'POST'))) {
      blocked.push(`${req.method()} ${url.pathname}`); return route.abort('blockedbyclient');
    }
    if (url.pathname === endpoint && req.method() === 'POST') {
      // Commit through the real API; delay only delivery of its unmodified response.
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(200);
      responseFetched = true;
      await gate; await route.fulfill({ response }); responseDelivered = true;
    } else await route.continue();
  });
  try {
    const login = await page.request.post(`${origin}/api/v1/auth/test-login`, { data: { employeeNo: 'EMP001' }, maxRedirects: 0 });
    expect(login.status()).toBe(200);
    const token = (await login.json()).data.token;
    await page.addInitScript(value => {
      localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600_000));
    }, token);
    await page.goto(`${origin}/tasks/${f.tasks[0]}?stage=self-eval`);
    await expect(page.getByTestId('preview-badge')).toBeVisible();
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await expect.poll(() => responseFetched).toBe(true);
    await page.evaluate(async path => {
      const app = (document.querySelector('#app') as Element & { __vue_app__: {
        config: { globalProperties: { $router: { push(path: string): Promise<unknown> } } } } }).__vue_app__;
      await app.config.globalProperties.$router.push(path);
    }, `/tasks/${f.tasks[1]}?stage=self-eval`);
    const text = `${f.prefix} B unsent draft`, key = `kayford.self-eval-draft.${f.employeeId}.${f.tasks[1]}`;
    const input = page.getByPlaceholder('概括 1-3 项关键成果');
    await input.fill(text);
    await page.getByRole('button', { name: '保存并稍后继续', exact: true }).click();
    const draft = await page.evaluate(key => localStorage.getItem(key), key);
    expect(draft).toContain(text);
    const responsePromise = page.waitForResponse(response => response.url().endsWith(endpoint));
    release(); expect((await responsePromise).status()).toBe(200);
    await expect.poll(() => responseDelivered).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = await page.evaluate(key => localStorage.getItem(key), key);
    expect(after).not.toBeNull();
    // The ordinary autosave timer may refresh its timestamp, never the draft content.
    const { updatedAt: savedAt, ...savedContent } = JSON.parse(draft!);
    const { updatedAt: afterAt, ...afterContent } = JSON.parse(after!);
    expect(afterContent).toEqual(savedContent);
    expect(afterAt).toBeGreaterThanOrEqual(savedAt);
    await expect(input).toHaveValue(text);
    await expect(page.getByRole('button', { name: '检查并提交', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload(); await expect(input).toHaveValue(text);
    await page.screenshot({ path: info.outputPath('task-B-draft-after-late-submit.png'), fullPage: true });
    expect(query(`return (await db.assessmentTask.findUniqueOrThrow({ where: { id: '${f.tasks[0]}' } })).status;`)).toBe('manager_scoring');
    expect(query(`return (await db.assessmentTask.findUniqueOrThrow({ where: { id: '${f.tasks[1]}' } })).status;`)).toBe('self_eval');
    expect(blocked).toEqual([]); expect(errors).toEqual([]);
  } finally {
    release(); await page.unrouteAll({ behavior: 'wait' }); await page.close();
    const remaining = cleanup(f);
    expect(remaining).toEqual({ tasks: 0, cycles: 0 });
    await info.attach('owned-cleanup', { body: JSON.stringify(remaining), contentType: 'application/json' });
  }
});
