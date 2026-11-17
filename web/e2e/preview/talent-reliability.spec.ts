import { test as base, expect, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
type Actor = { id: string; name: string; employeeNo: string };
type Candidate = { id: string; name: string; phone: string; email: string; note: string; currentCompany: string };
type Fixture = { prefix: string; candidate: Candidate; hr: Actor; manager: Actor; performanceManager: Actor; employee: Actor };
type Detail = Candidate & { status: string; editVersion: string; convertedUserId: string | null };
type Sessions = { open: (actor?: 'hr' | 'manager') => Promise<Page>; patches: string[] };

function fixtureQuery(source: string) {
  try {
    const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
        (async () => {
          const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview'
            || !await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))
            throw new Error('Uninitialized isolated preview');
          ${source}
        })().finally(() => db.$disconnect()).catch(() => { process.exitCode = 1; });`,
    });
    return JSON.parse(output);
  } catch {
    // Never expose subprocess output: a session token may be in stdout.
    throw new Error('Isolated talent reliability fixture operation failed');
  }
}

function createFixture(): Fixture {
  const prefix = `TR_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const phone = `100${String(randomInt(100_000_000)).padStart(8, '0')}`;
  return fixtureQuery(`
    const result = await db.$transaction(async tx => {
      const select = { id: true, name: true, employeeNo: true };
      const actor = (suffix, sysRole, extra = {}) => tx.user.create({ data: {
        name: '虚构' + suffix + '${prefix}', employeeNo: '${prefix}_' + suffix,
        accountType: 'service', status: 'active', sysRole, ...extra,
      }, select });
      const hr = await actor('HR', 'hr_user', { hrCapabilities: ['employee_archive_edit'] });
      const manager = await actor('Manager', 'employee', { accountType: 'employee' });
      const performanceManager = await actor('Performance', 'employee', { accountType: 'employee' });
      const employee = await actor('Employee', 'employee', { accountType: 'employee', directManagerId: performanceManager.id });
      // Roster and performance managers deliberately differ: only the roster relationship grants share eligibility.
      for (const user of [manager, performanceManager, employee]) await tx.employmentRecord.create({ data: {
        userId: user.id, employeeNo: user.employeeNo, effectiveFrom: new Date('2000-01-01'),
        entryDate: new Date('2000-01-01'), company: 'fuede', employeeStatus: 'active', changeType: 'onboarding',
        sourceType: 'preview_fixture', reason: '${prefix}', createdById: hr.id,
        directManagerId: user.id === employee.id ? manager.id : null,
      } });
      const candidate = await tx.talentCandidate.create({ data: {
        name: '虚构人才${prefix}', phone: '${phone}', email: '${prefix}@example.invalid',
        sourceChannel: 'other', currentCompany: '虚构原始公司', note: '私密备注${prefix}',
        expectSalaryMin: 10, expectSalaryMax: 20, createdById: hr.id,
      }, select: { id: true, name: true, phone: true, email: true, note: true, currentCompany: true } });
      return { prefix: '${prefix}', candidate, hr, manager, performanceManager, employee };
    });
    console.log(JSON.stringify(result));
  `);
}

function removeFixture(f: Fixture) {
  const result = fixtureQuery(`
    const f = ${JSON.stringify(f)}, ids = [f.hr.id, f.manager.id, f.performanceManager.id, f.employee.id];
    await db.$transaction(async tx => {
      if (await tx.user.count({ where: { id: { in: ids }, employeeNo: { startsWith: f.prefix + '_' } } }) !== 4
        || await tx.talentCandidate.count({ where: { id: f.candidate.id, createdById: f.hr.id,
          name: { endsWith: f.prefix } } }) !== 1) throw new Error('Fixture ownership mismatch');
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.talentShare.deleteMany({ where: { candidateId: f.candidate.id, createdById: f.hr.id } });
      await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.talentCandidate.deleteMany({ where: { id: f.candidate.id, createdById: f.hr.id } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids }, reason: f.prefix, sourceType: 'preview_fixture' } });
      await tx.user.deleteMany({ where: { id: { in: ids }, employeeNo: { startsWith: f.prefix + '_' } } });
    });
    console.log(JSON.stringify({
      candidates: await db.talentCandidate.count({ where: { id: f.candidate.id } }),
      users: await db.user.count({ where: { id: { in: ids } } }),
      shares: await db.talentShare.count({ where: { candidateId: f.candidate.id } }),
      notifications: await db.notificationLog.count({ where: { userId: { in: ids } } }),
      audits: await db.auditLog.count({ where: { userId: { in: ids } } }),
      employments: await db.employmentRecord.count({ where: { userId: { in: ids } } }),
    }));
  `);
  expect(result).toEqual({ candidates: 0, users: 0, shares: 0, notifications: 0, audits: 0, employments: 0 });
}

const test = base.extend<{ fixture: Fixture; sessions: Sessions }>({
  fixture: async ({}, use, info) => {
    expect(info.config.globalSetup).toBeNull();
    expect(info.project.use.baseURL).toBe(origin);
    const f = createFixture();
    try { await use(f); } finally { removeFixture(f); }
  },
  sessions: async ({ browser, fixture: f }, use, info) => {
    const contexts: BrowserContext[] = [], external: string[] = [], unexpectedWrites: string[] = [], errors: string[] = [], patches: string[] = [];
    const open: Sessions['open'] = async (role = 'hr') => {
      const actor = f[role];
      const { token } = fixtureQuery(`
        const actor = await db.user.findFirstOrThrow({ where: { id: '${actor.id}', employeeNo: '${actor.employeeNo}' } });
        const { JwtService } = require('@nestjs/jwt');
        const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({
          sub: actor.id, employeeNo: actor.employeeNo, sysRole: actor.sysRole,
        }, { expiresIn: '10m' });
        console.log(JSON.stringify({ token }));
      `);
      const device = info.project.use;
      const context = await browser.newContext({ baseURL: origin, viewport: device.viewport,
        isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent,
        deviceScaleFactor: device.deviceScaleFactor, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block',
        extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
      contexts.push(context);
      context.on('page', page => page.on('pageerror', () => errors.push('pageerror')));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
        if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method())) {
          const allowed = role === 'hr' && ((req.method() === 'PATCH' && url.pathname === `/api/v1/talents/${f.candidate.id}`)
            || (req.method() === 'POST' && url.pathname === `/api/v1/talents/${f.candidate.id}/shares`));
          if (!allowed) { unexpectedWrites.push(`${req.method()} ${url.pathname}`); return route.abort('blockedbyclient'); }
          if (req.method() === 'PATCH') patches.push(req.postDataJSON().editVersion ?? 'missing');
        }
        await route.continue();
      });
      await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url());
        if (url.protocol === 'ws:' && url.host === 'localhost:5173') { socket.connectToServer(); return; }
        external.push(url.origin); socket.close();
      });
      await context.addInitScript(value => {
        if (window.location.origin !== 'http://localhost:5173') return;
        localStorage.setItem('token', value);
        localStorage.setItem('expiresAt', String(Date.now() + 600_000));
      }, token);
      return context.newPage();
    };
    try { await use({ open, patches }); } finally {
      for (const context of contexts) await context.close();
      expect(external, 'External browser requests are blocked and must not be attempted').toEqual([]);
      expect(unexpectedWrites, 'Only this fictional candidate may be changed').toEqual([]);
      expect(errors).toEqual([]);
    }
  },
});

test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15_000 });
test.setTimeout(120_000);
test.beforeAll(({}, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.config.globalSetup).toBeNull();
  const format = '{"project":"{{index .Config.Labels "com.docker.compose.project"}}","running":{{.State.Running}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}';
  const [api, web] = execFileSync('docker', ['inspect', '--format', format, 'hrm-api-1', 'hrm-web-1'],
    { encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split(/\r?\n/).map(line => JSON.parse(line));
  expect([api.project, web.project]).toEqual(['hrm', 'hrm']);
  expect(api.running && web.running).toBe(true);
  expect(Object.keys(api.networks)).toEqual(['hrm_internal']);
  expect(web.ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
});

const responseFor = (page: Page, id: string, method = 'GET') => page.waitForResponse(response =>
  response.url() === `${origin}/api/v1/talents/${id}` && response.request().method() === method);

async function openTalent(page: Page, f: Fixture) {
  await page.goto('/talents');
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  const filter = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await filter.fill(f.prefix); await filter.press('Enter');
  const response = responseFor(page, f.candidate.id);
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('.mobile-result-card').filter({ hasText: f.candidate.name }).getByRole('button', { name: '打开详情', exact: true }).click();
  } else {
    await page.getByRole('row').filter({ hasText: f.candidate.name }).getByRole('button', { name: '打开', exact: true }).click();
  }
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const row = (await loaded.json()).data as Detail;
  expect(row.editVersion).toEqual(expect.any(String)); expect(row.editVersion).not.toBe('');
  const drawer = page.getByRole('dialog', { name: f.candidate.name, exact: true });
  await expect(drawer.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  return { drawer, row };
}

async function openEditor(page: Page, f: Fixture) {
  const { drawer } = await openTalent(page, f);
  const response = responseFor(page, f.candidate.id);
  await drawer.getByRole('button', { name: '编辑', exact: true }).click();
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const row = (await loaded.json()).data as Detail;
  const editor = page.getByRole('dialog', { name: '编辑人才', exact: true });
  await expect(editor.getByPlaceholder('候选人姓名', { exact: true })).toHaveValue(f.candidate.name);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  return { editor, row };
}

async function save(page: Page, editor: Locator, id: string): Promise<Response> {
  const response = responseFor(page, id, 'PATCH');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  return response;
}

async function persisted(page: Page, id: string): Promise<Detail> {
  const response = await page.request.get(`${origin}/api/v1/talents/${id}`, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

test('real CAS: stale input survives 409 and cancelled reload; explicit reload rebases the next save', async ({ fixture: f, sessions }, info) => {
  const a = await sessions.open(), b = await sessions.open();
  const first = await openEditor(a, f), second = await openEditor(b, f);
  expect(first.row.editVersion).toBe(second.row.editVersion);
  const companyA = `A已保存${f.prefix}`, companyB = `B未保存${f.prefix}`, noteB = `B保留备注${f.prefix}`;
  await first.editor.getByLabel('当前公司', { exact: true }).fill(companyA);
  await second.editor.getByLabel('当前公司', { exact: true }).fill(companyB);
  await second.editor.getByLabel('备注', { exact: true }).fill(noteB);
  const savedA = await save(a, first.editor, f.candidate.id);
  expect(savedA.status()).toBe(200);
  expect(savedA.request().postDataJSON().editVersion).toBe(first.row.editVersion);
  await expect(first.editor).toBeHidden();
  const afterA = await persisted(a, f.candidate.id);
  expect(afterA.currentCompany).toBe(companyA); expect(afterA.editVersion).not.toBe(first.row.editVersion);
  const rejected = await save(b, second.editor, f.candidate.id);
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON().editVersion).toBe(second.row.editVersion);
  expect((await rejected.json()).data.reason).toBe('TALENT_EDIT_CONFLICT');
  const warning = second.editor.locator('.el-alert--warning');
  await expect(warning).toContainText('当前输入已保留');
  await expect(second.editor.getByLabel('当前公司', { exact: true })).toHaveValue(companyB);
  await expect(second.editor.getByLabel('备注', { exact: true })).toHaveValue(noteB);
  await expect(second.editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  expect(await warning.evaluate(el => Boolean(el.compareDocumentPosition(el.parentElement!.querySelector('form')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect((await persisted(a, f.candidate.id)).currentCompany).toBe(companyA);
  await second.editor.locator('form').dispatchEvent('submit');
  expect(sessions.patches).toHaveLength(2);
  await warning.getByRole('button', { name: '重新加载最新资料', exact: true }).click();
  const confirm = b.getByRole('dialog', { name: '重新加载最新资料', exact: true });
  await expect(confirm).toContainText('替换当前未保存的内容');
  await confirm.getByRole('button', { name: '继续保留输入', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(second.editor.getByLabel('当前公司', { exact: true })).toHaveValue(companyB);
  await expect(second.editor.getByLabel('备注', { exact: true })).toHaveValue(noteB);
  await expect(second.editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await warning.scrollIntoViewIfNeeded();
  await second.editor.screenshot({ path: info.outputPath('cas-input-retained.png'), animations: 'disabled' });
  await warning.getByRole('button', { name: '重新加载最新资料', exact: true }).click();
  const reload = responseFor(b, f.candidate.id);
  await confirm.getByRole('button', { name: '重新加载', exact: true }).click();
  expect((await reload).status()).toBe(200);
  await expect(second.editor.getByLabel('当前公司', { exact: true })).toHaveValue(companyA);
  await expect(second.editor.getByLabel('备注', { exact: true })).toHaveValue(f.candidate.note);
  await expect(warning).toHaveCount(0);
  await expect(second.editor.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  await second.editor.getByLabel('当前公司', { exact: true }).fill(`B核对后保存${f.prefix}`);
  const savedB = await save(b, second.editor, f.candidate.id);
  expect(savedB.status()).toBe(200);
  expect(savedB.request().postDataJSON().editVersion).toBe(afterA.editVersion);
  await expect(second.editor).toBeHidden();
  expect((await persisted(b, f.candidate.id)).currentCompany).toBe(`B核对后保存${f.prefix}`);
  expect(sessions.patches).toEqual([first.row.editVersion, second.row.editVersion, afterA.editVersion]);
  expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await info.attach('cas-evidence', { contentType: 'application/json', body: JSON.stringify({
    statuses: [savedA.status(), rejected.status(), savedB.status()], baselineRetained: true, cancelRetainedInput: true,
    explicitReloadRebased: true, requestCount: sessions.patches.length,
  }) });
});

test('real detail rejection carries the baseline that was read', async ({ fixture: f, sessions }, info) => {
  const page = await sessions.open(), { drawer, row } = await openTalent(page, f);
  await drawer.getByRole('button', { name: '标记淘汰', exact: true }).click();
  const response = responseFor(page, f.candidate.id, 'PATCH');
  await page.getByRole('dialog', { name: '标记淘汰', exact: true }).getByRole('button', { name: '标记淘汰', exact: true }).click();
  const rejected = await response;
  expect(rejected.status()).toBe(200);
  expect(rejected.request().postDataJSON()).toEqual({ status: 'rejected', editVersion: row.editVersion });
  const current = await persisted(page, f.candidate.id);
  expect(current).toMatchObject({ status: 'rejected', currentCompany: f.candidate.currentCompany, note: f.candidate.note });
  expect(current.editVersion).not.toBe(row.editVersion);
  await expect(drawer.locator('.talent-detail__badges')).toContainText('已淘汰');
  await drawer.screenshot({ path: info.outputPath('detail-rejected-with-baseline.png'), animations: 'disabled' });
});

test('real stale editor uses CAS before hired-status rules and reloads without undoing the hired fixture', async ({ fixture: f, sessions }) => {
  const page = await sessions.open(), { editor, row } = await openEditor(page, f);
  const pending = `到岗前未保存${f.prefix}`;
  await editor.getByLabel('当前公司', { exact: true }).fill(pending);
  // This simulates only the concurrent hired state; the actual arrival workflow is covered by the API owner's tests.
  fixtureQuery(`
    const result = await db.talentCandidate.updateMany({ where: { id: '${f.candidate.id}', createdById: '${f.hr.id}',
      name: '${f.candidate.name}', status: 'new' }, data: { status: 'hired', convertedUserId: '${f.employee.id}', convertedAt: new Date() } });
    if (result.count !== 1) throw new Error('Fixture ownership or status mismatch');
    console.log(JSON.stringify({ changed: result.count }));
  `);
  const rejected = await save(page, editor, f.candidate.id);
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON().editVersion).toBe(row.editVersion);
  expect((await rejected.json()).data.reason).toBe('TALENT_EDIT_CONFLICT');
  await expect(editor.getByLabel('当前公司', { exact: true })).toHaveValue(pending);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  const warning = editor.locator('.el-alert--warning');
  await expect(warning).toContainText('当前输入已保留');
  await warning.getByRole('button', { name: '重新加载最新资料', exact: true }).click();
  const reload = responseFor(page, f.candidate.id);
  await page.getByRole('dialog', { name: '重新加载最新资料', exact: true }).getByRole('button', { name: '重新加载', exact: true }).click();
  expect((await reload).status()).toBe(200);
  await expect(editor.getByLabel('当前公司', { exact: true })).toHaveValue(f.candidate.currentCompany);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  const hired = await persisted(page, f.candidate.id);
  expect(hired).toMatchObject({ status: 'hired', convertedUserId: f.employee.id });
  await editor.getByLabel('当前公司', { exact: true }).fill(`到岗后核对${f.prefix}`);
  const saved = await save(page, editor, f.candidate.id);
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON().editVersion).toBe(hired.editVersion);
  expect(saved.request().postDataJSON()).not.toHaveProperty('status');
  expect(await persisted(page, f.candidate.id)).toMatchObject({ status: 'hired', convertedUserId: f.employee.id, currentCompany: `到岗后核对${f.prefix}` });
});

test('real share search excludes ordinary staff; a current manager sees only the redacted candidate without library access', async ({ fixture: f, sessions }, info) => {
  const page = await sessions.open(), { drawer } = await openTalent(page, f);
  await drawer.getByRole('button', { name: '转发', exact: true }).click();
  const share = page.getByRole('dialog', { name: `转发候选人：${f.candidate.name}`, exact: true });
  const select = share.getByTestId('talent-share-recipients').getByRole('combobox');
  const search = async (keyword: string) => {
    const response = page.waitForResponse(res => {
      const url = new URL(res.url());
      return url.pathname === '/api/v1/talents/share-recipients' && url.searchParams.get('keyword') === keyword;
    });
    await select.fill(keyword);
    const result = await response; expect(result.status()).toBe(200);
    return (await result.json()).data.items as Actor[];
  };
  expect((await search(f.prefix)).map(user => user.id).sort()).toEqual([f.hr.id, f.manager.id].sort());
  await expect(page.getByRole('option').filter({ hasText: f.hr.employeeNo })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: f.manager.employeeNo })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: f.employee.employeeNo })).toHaveCount(0);
  await expect(page.getByRole('option').filter({ hasText: f.performanceManager.employeeNo })).toHaveCount(0);
  expect(await search(f.employee.employeeNo)).toEqual([]);
  const denied = await page.request.post(`${origin}/api/v1/talents/${f.candidate.id}/shares`, {
    maxRedirects: 0, data: { recipientIds: [f.employee.id], expiresInDays: 7, includeResume: false },
  });
  expect(denied.status()).toBe(400);
  await search(f.prefix);
  await page.getByRole('option').filter({ hasText: f.manager.employeeNo }).click();
  await select.fill(f.hr.employeeNo);
  await page.getByRole('option').filter({ hasText: f.hr.employeeNo }).click();
  await share.getByRole('heading', { name: '新建分享', exact: true }).click();
  const creating = page.waitForResponse(res => res.url() === `${origin}/api/v1/talents/${f.candidate.id}/shares` && res.request().method() === 'POST');
  await share.getByRole('button', { name: '生成分享链接', exact: true }).click();
  const created = await creating; expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({ recipientIds: [f.manager.id, f.hr.id], includeResume: false });
  const link = (await created.json()).data.url as string;
  expect(link).toMatch(/^\/talents\/s\/[a-f0-9]+$/);
  const manager = await sessions.open('manager');
  for (const path of ['/api/v1/talents', `/api/v1/talents/${f.candidate.id}`]) {
    expect((await manager.request.get(`${origin}${path}`, { maxRedirects: 0 })).status()).toBe(403);
  }
  const viewed = manager.waitForResponse(res => new URL(res.url()).pathname.startsWith('/api/v1/talents/shares/'));
  await manager.goto(link);
  const redacted = await viewed; expect(redacted.status()).toBe(200);
  const payload = (await redacted.json()).data;
  for (const field of ['id', 'phone', 'email', 'note', 'sourceChannel', 'expectSalaryMin', 'expectSalaryMax', 'followUps', 'editVersion']) {
    expect(payload.candidate).not.toHaveProperty(field);
  }
  expect(payload.files).toEqual([]);
  const content = manager.locator('.talent-shared');
  await expect(content.getByRole('heading', { name: f.candidate.name, exact: true })).toBeVisible();
  for (const secret of [f.candidate.phone, f.candidate.email, f.candidate.note]) await expect(content).not.toContainText(secret);
  await expect(content.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await manager.screenshot({ path: info.outputPath('manager-redacted-view.png'), fullPage: true, animations: 'disabled' });
});
