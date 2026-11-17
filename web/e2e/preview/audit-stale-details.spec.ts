import { test as base, expect, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
type Row = { id: string; name: string };
type Fixture = { prefix: string; candidates: Row[]; employees: Row[]; cycles: Row[]; tasks: { id: string }[] };

function fixtureQuery(source: string) {
  try {
    const result = JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
        (async () => {
          if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          ${source}
        })().finally(() => db.$disconnect()).catch(error => {
          console.log(JSON.stringify({ fixtureError: error.code ?? error.name, model: error.meta?.modelName }));
        });`,
    }));
    if (result.fixtureError) throw new Error(`Isolated fixture failed: ${result.fixtureError} (${result.model ?? 'unknown model'})`);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Isolated fixture failed:')) throw error;
    throw new Error('Isolated stale-detail fixture operation failed');
  }
}

function createFixture(): Fixture {
  const prefix = `STALE_${randomUUID().slice(0, 8)}`;
  return fixtureQuery(`
    const hr = await db.user.findFirstOrThrow({ where: { employeeNo: 'HR001', sysRole: 'hr', deletedAt: null } });
    const result = await db.$transaction(async tx => {
      const candidates = [], employees = [], cycles = [], tasks = [];
      for (const suffix of ['A', 'B']) {
        candidates.push(await tx.talentCandidate.create({ data: {
          name: '虚构人才' + suffix + '${prefix}', phone: '100' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'),
          sourceChannel: 'other', currentCompany: '虚构公司' + suffix, note: '${prefix}', createdById: hr.id,
        }, select: { id: true, name: true } }));
        const employee = await tx.user.create({ data: { employeeNo: '${prefix}_' + suffix,
          name: '虚构任务员工' + suffix + '${prefix}', status: 'active', sysRole: 'employee' }, select: { id: true, name: true } });
        employees.push(employee);
        const cycle = await tx.assessmentCycle.create({ data: { name: '虚构周期' + suffix + '${prefix}',
          startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'), status: 'indicator_setting', notificationMode: 'off' },
          select: { id: true, name: true } });
        cycles.push(cycle);
        tasks.push(await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: employee.id,
          status: 'indicator_drafting' }, select: { id: true } }));
      }
      return { prefix: '${prefix}', candidates, employees, cycles, tasks };
    });
    console.log(JSON.stringify(result));
  `);
}

function removeFixture(f: Fixture) {
  const result = fixtureQuery(`
    const f = ${JSON.stringify(f)};
    const candidateIds = f.candidates.map(r => r.id), employeeIds = f.employees.map(r => r.id);
    const cycleIds = f.cycles.map(r => r.id), taskIds = f.tasks.map(r => r.id);
    await db.$transaction(async tx => {
      if (await tx.talentCandidate.count({ where: { id: { in: candidateIds }, note: f.prefix } }) !== 2
        || await tx.user.count({ where: { id: { in: employeeIds }, employeeNo: { startsWith: f.prefix + '_' } } }) !== 2
        || await tx.assessmentCycle.count({ where: { id: { in: cycleIds }, name: { endsWith: f.prefix } } }) !== 2
        || await tx.assessmentTask.count({ where: { id: { in: taskIds }, cycleId: { in: cycleIds }, employeeId: { in: employeeIds } } }) !== 2)
        throw new Error('Fixture ownership mismatch');
      await tx.notificationLog.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.flowRecord.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.auditLog.deleteMany({ where: { entityId: { in: [...candidateIds, ...employeeIds, ...cycleIds, ...taskIds] } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: taskIds } } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: cycleIds } } });
      await tx.talentCandidate.deleteMany({ where: { id: { in: candidateIds }, note: f.prefix } });
      await tx.user.deleteMany({ where: { id: { in: employeeIds }, employeeNo: { startsWith: f.prefix + '_' } } });
    });
    console.log(JSON.stringify({ remaining: await db.user.count({ where: { id: { in: employeeIds } } }) }));
  `);
  expect(result.remaining).toBe(0);
}

const test = base.extend<{ fixture: Fixture; blockedWrites: string[] }>({
  blockedWrites: async ({ page }, use) => {
    const writes: string[] = [], external: string[] = [], errors: string[] = [];
    page.on('pageerror', () => errors.push('pageerror'));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      await route.continue();
    });
    await use(writes);
    expect(writes).toEqual([]);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  },
  fixture: async ({ page, blockedWrites }, use, info) => {
    expect(info.config.globalSetup).toBeNull();
    expect(info.project.use.baseURL).toBe(origin);
    expect(blockedWrites).toEqual([]);
    const f = createFixture();
    try {
      const login = await page.request.post(`${origin}/api/v1/auth/test-login`, { data: { employeeNo: 'HR001' }, maxRedirects: 0 });
      expect(login.status()).toBe(200);
      const token: string = (await login.json()).data.token;
      expect(typeof token).toBe('string');
      await page.addInitScript(value => {
        localStorage.setItem('token', value);
        localStorage.setItem('expiresAt', String(Date.now() + 600_000));
      }, token);
      await use(f);
    } finally {
      await page.close();
      removeFixture(f);
    }
  },
});

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off' });
test.setTimeout(90_000);
test.beforeAll(({}, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.config.globalSetup).toBeNull();
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

async function openTalent(page: Page, row: Row) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('.mobile-result-card').filter({ hasText: row.name }).getByRole('button', { name: '打开详情', exact: true }).click();
  } else {
    await page.getByRole('row').filter({ hasText: row.name }).getByRole('button', { name: '打开', exact: true }).click();
  }
  const detail = page.getByRole('dialog', { name: row.name, exact: true });
  await expect(detail.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  return detail;
}

test('#8 real talent A then failed B is empty and unsavable until retry', async ({ page, fixture: f, blockedWrites }, info) => {
  await page.goto(`${origin}/talents`);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(f.prefix);
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
  await (await openTalent(page, f.candidates[0]!)).getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑人才', exact: true });
  await expect(editor.getByPlaceholder('候选人姓名', { exact: true })).toHaveValue(f.candidates[0]!.name);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).toBeHidden();
  const b = await openTalent(page, f.candidates[1]!);
  const url = `${origin}/api/v1/talents/${f.candidates[1]!.id}`;
  const failGet = async (route: Route) => {
    if (route.request().method() === 'GET') return route.abort('failed');
    await route.fallback();
  };
  await page.route(url, failGet);
  await b.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(editor.locator('.el-alert')).toContainText('加载失败');
  await expect(editor.getByPlaceholder('候选人姓名', { exact: true })).toHaveValue('');
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  expect(await editor.locator('input, textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value)))
    .not.toContain(f.candidates[0]!.name);
  await editor.locator('form').dispatchEvent('submit');
  expect(blockedWrites).toEqual([]);
  await editor.screenshot({ path: info.outputPath('talent-B-load-failed.png'), animations: 'disabled' });
  await page.unroute(url, failGet);
  const retry = page.waitForResponse(response => response.url() === url && response.request().method() === 'GET');
  await editor.getByRole('button', { name: '重新加载', exact: true }).click();
  const response = await retry;
  expect(response.status()).toBe(200);
  expect((await response.json()).data.id).toBe(f.candidates[1]!.id);
  await expect(editor.getByPlaceholder('候选人姓名', { exact: true })).toHaveValue(f.candidates[1]!.name);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  await expect(editor.locator('.el-alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await editor.screenshot({ path: info.outputPath('talent-B-retry-loaded.png'), animations: 'disabled' });
});

async function navigateSameDocument(page: Page, path: string) {
  // Reuse the mounted detail component, as a normal SPA task-to-task navigation does.
  await page.evaluate(async target => {
    const app = (document.querySelector('#app') as Element & {
      __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } } };
    }).__vue_app__;
    await app.config.globalProperties.$router.push(target);
  }, path);
}

for (const delayed of ['task', 'cycle'] as const) {
  test(`#14 real delayed A ${delayed} cannot replace the B page`, async ({ page, fixture: f, blockedWrites }, info) => {
    const a = f.tasks[0]!, b = f.tasks[1]!;
    const url = delayed === 'task' ? `${origin}/api/v1/tasks/${a.id}` : `${origin}/api/v1/cycles/${f.cycles[0]!.id}`;
    let release!: () => void, received = false, fulfilled = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(url, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expect((await response.json()).data.id).toBe(delayed === 'task' ? a.id : f.cycles[0]!.id);
      received = true;
      await gate;
      await route.fulfill({ response });
      fulfilled = true;
    });
    try {
      await page.goto(`${origin}/tasks/${a.id}`);
      await expect(page.getByTestId('preview-badge')).toBeVisible();
      await expect.poll(() => received).toBe(true);
      const bResponse = page.waitForResponse(response => response.url() === `${origin}/api/v1/tasks/${b.id}`);
      await navigateSameDocument(page, `/tasks/${b.id}`);
      expect((await bResponse).status()).toBe(200);
      await expect(page.getByTestId('performance-employee-summary')).toContainText(f.employees[1]!.name);
      await expect(page.locator('.performance-detail .el-loading-mask:visible')).toHaveCount(0);
      const lateResponse = page.waitForResponse(response => response.url() === url);
      release();
      expect((await lateResponse).status()).toBe(200);
      await expect.poll(() => fulfilled).toBe(true);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page).toHaveURL(`${origin}/tasks/${b.id}`);
      await expect(page.getByTestId('performance-employee-summary')).toContainText(f.employees[1]!.name);
      await expect(page.getByTestId('performance-employee-summary')).not.toContainText(f.employees[0]!.name);
      await expect(page.getByTestId('performance-cycle-badge')).toHaveText(f.cycles[1]!.name);
      await expect(page.locator('.performance-detail .el-loading-mask:visible')).toHaveCount(0);
      expect(blockedWrites).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`task-B-after-late-A-${delayed}.png`), fullPage: true, animations: 'disabled' });
      await info.attach('real-response-order', { contentType: 'application/json', body: JSON.stringify({
        delayed, a: a.id, b: b.id, aResponseFetchedBeforeB: received, aFulfilledAfterB: fulfilled,
        targetAfterLateResponse: b.id, interceptedWrites: blockedWrites.length,
      }) });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
