import { test as base, expect, type Page, type Request, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const origin = 'http://localhost:5173';
type Person = { id: string; name: string; employeeNo: string };
type Fixture = {
  prefix: string; operatorId: string; employees: Person[]; subjectId: string;
  gradeId: string; gradeName: string; token: string;
};
type RequestEvent = {
  sequence: number; method: string; path: string; startedMs: number;
  status?: number; finishedMs?: number; failure?: string;
};
type Observation = {
  requests: RequestEvent[]; pageErrors: string[]; checkpoints: string[];
  scriptErrors: { name: string; category: string; message: string; stack: string; modules: string[] }[];
  resourceResponses: { path: string; status: number }[];
  resourceFailures: { path: string; status?: number; failure?: string }[];
};

function diagnosticRedactor(f: Fixture) {
  const privateValues = [f.token, f.operatorId, f.subjectId, f.gradeId, f.gradeName,
    ...f.employees.flatMap(person => [person.id, person.name, person.employeeNo]), f.prefix];
  const redact = (value: string) => {
    for (const item of privateValues.filter(Boolean)) {
      value = value.replaceAll(item, '[redacted]').replaceAll(encodeURIComponent(item), '[redacted]');
    }
    return value
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
      .replace(/\b(?:token|access_token|refresh_token|password|secret|authorization|cookie)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[redacted]')
      .replace(/\+?\d[\d ()-]{8,}\d[Xx]?/g, '[redacted]')
      .replace(/[^\x00-\x7F]+/g, '[redacted]');
  };
  const path = (raw: string) => {
    try {
      const url = new URL(raw);
      return url.origin === origin ? redact(decodeURIComponent(url.pathname)).replace(/[?#].*$/, '') : null;
    } catch { return null; }
  };
  const location = (raw: string) => {
    const coordinates = raw.match(/:\d+(?::\d+)?$/)?.[0] ?? '';
    const modulePath = path(coordinates ? raw.slice(0, -coordinates.length) : raw);
    return modulePath && /^\/(?:src\/|node_modules\/|@|.*\.[cm]?js$)/.test(modulePath)
      ? `${modulePath}${coordinates}` : null;
  };
  const error = (value: Error) => {
    const name = /^(?:Type|Reference|Syntax|Range|URI|Eval|Aggregate)?Error$/.test(value.name) ? value.name : 'Error';
    const message = redact(value.message.replace(/https?:\/\/[^\s)]+/g, raw => location(raw) ?? '[url]'))
      .replace(/[?#][^\s)]+/g, '[query]')
      .replace(/\breading (['"])([A-Za-z_$][\w$]*)\1/g, 'reading $2')
      .replace(/(['"`])[^'"`\r\n]*\1/g, '[value]');
    // Keep frame order and source coordinates, never arbitrary function names or external URLs.
    const frames = [...(value.stack ?? '').split('\n').slice(1).join('\n').matchAll(/https?:\/\/[^\s)]+/g)]
      .flatMap(match => { const frame = location(match[0]); return frame ? [frame] : []; });
    return { name, message, stack: [`${name}: ${message}`, ...frames.map(frame => `    at ${frame}`)].join('\n'),
      modules: [...new Set(frames.map(frame => frame.replace(/:\d+(?::\d+)?$/, '')))] };
  };
  return { path, error };
}

async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach(name, { contentType: 'application/json', path });
}

function fixtureQuery(source: string) {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
        (async () => {
          if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          ${source}
        })().finally(() => prisma.$disconnect()).catch(() => { process.exitCode = 1; });`,
    }));
  } catch {
    throw new Error('Isolated reopen fixture operation failed');
  }
}

function createFixture(): Fixture {
  const prefix = `O01_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  return fixtureQuery(`
    const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
    const position = await prisma.position.findFirstOrThrow({ where: { code: 'PREVIEW_STAFF' } });
    const result = await prisma.$transaction(async tx => {
      const grade = await tx.personnelReferenceData.create({ data: { kind: 'job_grade', name: '${prefix}_6', isActive: true } });
      const subject = await tx.contractSubject.create({ data: { name: '虚构重开主体${prefix}', internalCompany: 'fuede' } });
      const employment = employeeNo => ({ effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
        company: 'fuede', companyText: subject.name, contractSubjectId: subject.id, deptId: dept.id,
        employeeStatus: 'active', employeeNo, changeType: 'onboarding', sourceType: 'preview_fixture' });
      const operator = await tx.user.create({ data: { employeeNo: '${prefix}_HR', name: '虚构重开维护员${prefix}',
        status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], deptId: dept.id,
        employmentHistory: { create: employment('${prefix}_HR') } } });
      const employees = [];
      for (const suffix of ['A', 'B']) {
        const employeeNo = '${prefix}_' + suffix;
        const employee = await tx.user.create({ data: { employeeNo, name: '虚构重开' + suffix + '${prefix}',
          status: 'active', sysRole: 'employee', deptId: dept.id, positionId: position.id, position: position.name,
          entryDate: new Date('2025-01-01T00:00:00Z'), employeeProfile: { create: { childrenCount: 0 } },
          employmentHistory: { create: { ...employment(employeeNo), positionId: position.id, position: position.name, jobGrade: '1' } } },
          select: { id: true, name: true, employeeNo: true } });
        employees.push(employee);
      }
      return { prefix: '${prefix}', operatorId: operator.id, employees, subjectId: subject.id, gradeId: grade.id, gradeName: grade.name };
    });
    const { JwtService } = require('@nestjs/jwt');
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: result.operatorId, employeeNo: '${prefix}_HR' }, { expiresIn: '15m' });
    console.log(JSON.stringify({ ...result, token }));
  `);
}

function removeFixture(f: Fixture) {
  return fixtureQuery(`
    const expected = ${JSON.stringify([f.operatorId, ...f.employees.map(person => person.id)])};
    const users = await prisma.user.findMany({ where: { employeeNo: { startsWith: '${f.prefix}_' } }, select: { id: true } });
    const ids = users.map(user => user.id);
    if (ids.length !== expected.length || expected.some(id => !ids.includes(id))) throw new Error('Fixture ownership mismatch');
    const subject = await prisma.contractSubject.findUniqueOrThrow({ where: { id: '${f.subjectId}' } });
    if (subject.name !== '虚构重开主体${f.prefix}') throw new Error('Subject ownership mismatch');
    const grade = await prisma.personnelReferenceData.findUniqueOrThrow({ where: { id: '${f.gradeId}' } });
    if (grade.kind !== 'job_grade' || grade.name !== '${f.prefix}_6' || grade.name !== '${f.gradeName}') throw new Error('Grade ownership mismatch');
    if (await prisma.employmentRecord.count({ where: { jobGrade: grade.name, userId: { notIn: ids } } })) throw new Error('Foreign grade usage');
    const requests = await prisma.employeeDataChangeRequest.findMany({
      where: { OR: [{ userId: { in: ids } }, { createdById: { in: ids } }] }, select: { id: true, userId: true, createdById: true } });
    if (requests.some(request => !ids.includes(request.userId) || !ids.includes(request.createdById))) throw new Error('Foreign request ownership');
    await prisma.$transaction(async tx => {
      await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: [...ids, ...requests.map(request => request.id)] } }] } });
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeContract.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests.map(request => request.id) } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.contractSubject.delete({ where: { id: '${f.subjectId}' } });
      await tx.personnelReferenceData.delete({ where: { id: '${f.gradeId}', kind: 'job_grade', name: '${f.gradeName}' } });
    });
    console.log(JSON.stringify({ prefix: '${f.prefix}', removedIds: ids, removedGradeId: '${f.gradeId}',
      remaining: await prisma.user.count({ where: { id: { in: expected } } }),
      remainingGrade: await prisma.personnelReferenceData.count({ where: { id: '${f.gradeId}' } }) }));
  `);
}

const test = base.extend<{ owned: Fixture; observed: Observation }>({
  owned: async ({ page }, use, info) => {
    expect(info.config.globalSetup).toBeNull();
    const f = createFixture();
    await evidence(info, 'owned-fixture', {
      prefix: f.prefix, operatorId: f.operatorId, employees: f.employees, subjectId: f.subjectId,
      gradeId: f.gradeId, gradeName: f.gradeName,
    });
    try { await use(f); } finally {
      await page.close();
      const cleanup = removeFixture(f);
      await evidence(info, 'owned-fixture-cleanup', cleanup);
      expect(cleanup.remaining).toBe(0);
      expect(cleanup.remainingGrade).toBe(0);
    }
  },
  observed: async ({ page, owned }, use, info) => {
    const observed: Observation = { requests: [], pageErrors: [], checkpoints: [], scriptErrors: [], resourceResponses: [], resourceFailures: [] };
    const diagnostics = diagnosticRedactor(owned);
    const resourcePath = (request: Request) => ['script', 'stylesheet', 'image', 'font', 'media', 'manifest'].includes(request.resourceType())
      ? diagnostics.path(request.url()) : null;
    const entries = new Map<Request, RequestEvent>();
    const started = Date.now();
    const personLabels = new Map(owned.employees.map((person, index) => [person.id, `employee-${index}`]));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith('/api/v1/')) return;
      let path = url.pathname;
      for (const [id, label] of personLabels) path = path.replace(id, label);
      const entry = { sequence: entries.size + 1, method: request.method(), path, startedMs: Date.now() - started };
      entries.set(request, entry);
      observed.requests.push(entry);
    });
    page.on('response', response => {
      const entry = entries.get(response.request());
      if (entry) entry.status = response.status();
      else {
        const path = resourcePath(response.request());
        if (path) {
          observed.resourceResponses.push({ path, status: response.status() });
          if (response.status() >= 400) observed.resourceFailures.push({ path, status: response.status() });
        }
      }
    });
    page.on('requestfinished', request => {
      const entry = entries.get(request);
      if (entry) entry.finishedMs = Date.now() - started;
    });
    page.on('requestfailed', request => {
      const entry = entries.get(request);
      if (entry) {
        entry.finishedMs = Date.now() - started;
        entry.failure = request.failure()?.errorText.match(/net::[A-Z_]+/)?.[0] ?? 'request-failed';
      } else {
        const path = resourcePath(request);
        if (path) observed.resourceFailures.push({ path,
          failure: request.failure()?.errorText.match(/net::[A-Z_]+/)?.[0] ?? 'request-failed' });
      }
    });
    page.on('pageerror', error => {
      const sanitized = diagnostics.error(error);
      observed.pageErrors.push(sanitized.name);
      const category = sanitized.message.match(/^(?:Failed to fetch dynamically imported module|Importing a module script failed|Cannot read properties of (?:null|undefined))/)?.[0] ?? 'unclassified';
      observed.scriptErrors.push({ ...sanitized, category });
    });
    try { await use(observed); } finally {
      // Raw Playwright traces contain Authorization/localStorage; keep only allowlisted metadata.
      await evidence(info, 'sanitized-request-timeline', observed);
      if (info.status !== info.expectedStatus && !page.isClosed()) {
        await page.screenshot({ path: info.outputPath('diagnostic-failure.png'), fullPage: true });
      }
    }
  },
});
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off' });
test.setTimeout(180_000);

test.beforeAll(() => {
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8', stdio: 'pipe' }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(Object.keys(containers[0].NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(containers[1].NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
});

async function api(page: Page, f: Fixture, method: string, path: string, data?: unknown) {
  const response = await page.request.fetch(`${origin}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${f.token}` }, ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path}`).toBe(200);
  const body = await response.json();
  expect(body.code).toBe(0);
  return body.data;
}

function drawer(page: Page) {
  return page.getByRole('dialog', { name: '员工档案', exact: true });
}

async function enterEditor(page: Page, person: Person) {
  const dialog = drawer(page);
  await expect(dialog.getByRole('heading', { name: person.name, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(dialog.locator('.archive-inline-editor')).toBeVisible();
  await expect(dialog.getByText('暂时无法加载最新档案，请重试。', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('.archive-query-error')).toHaveCount(0);
  return dialog;
}

test('O01 real backend: saved legacy draft survives repeated close and reopen without interception', async ({ page, owned: f, observed }, info) => {
  const person = f.employees[0]!;
  const path = `/employee-archives/${person.id}`;
  const initial = await api(page, f, 'GET', path);
  const draft = await api(page, f, 'PATCH', `${path}/draft/save`, {
    baseVersion: initial.archiveVersion, employee: { jobGrade: f.gradeName }, profile: { professionalTitle: '虚构待审职称' }, performance: {},
  });
  fixtureQuery(`
    const changed = await prisma.employeeDataChangeRequest.updateMany({
      where: { id: '${draft.id}', userId: '${person.id}', createdById: '${f.operatorId}', sourceType: 'manual_archive_change' },
      data: { recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' } });
    if (changed.count !== 1) throw new Error('Owned legacy request missing'); console.log(JSON.stringify({ changed: changed.count }));
  `);
  await page.addInitScript(token => localStorage.setItem('token', token), f.token);
  let expectedTitle = '虚构待审职称';
  const widths = info.project.name === 'desktop' ? [1440, 1024] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (let iteration = 0; iteration < 6; iteration++) {
      observed.checkpoints.push(`${width}:open:${iteration}`);
      await page.goto(`${origin}/users?employeeId=${person.id}`);
      let dialog = await enterEditor(page, person);
      const title = dialog.locator('[data-archive-field="profile.professionalTitle"] input');
      await expect(title).toHaveValue(expectedTitle);
      expectedTitle = `虚构重开职称${width}_${iteration}`;
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}/draft/save`
        && response.request().method() === 'PATCH');
      await title.fill(expectedTitle);
      expect((await saved).status()).toBe(200);
      await expect(dialog.locator('.archive-footer-state')).toContainText('草稿已保存');
      expect((await api(page, f, 'GET', path)).currentEmployment.jobGrade).toBe('1');
      expect((await api(page, f, 'GET', path)).employeeProfile.professionalTitle ?? '').toBe('');
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      observed.checkpoints.push(`${width}:reopen:${iteration}`);
      // Match the old failure: full navigation immediately after the close action.
      await page.goto(`${origin}/users?employeeId=${person.id}`);
      dialog = await enterEditor(page, person);
      await expect(dialog.locator('[data-archive-field="profile.professionalTitle"] input')).toHaveValue(expectedTitle);
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (iteration === 5) await page.screenshot({ path: info.outputPath(`reopened-${width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
  await page.goto(`${origin}/users?employeeId=${person.id}`);
  const dialog = await enterEditor(page, person);
  const submitted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}/draft`
    && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  await expect(dialog.locator('.archive-inline-editor')).toHaveCount(0);
  const formal = await api(page, f, 'GET', path);
  expect(formal.currentEmployment.jobGrade).toBe(f.gradeName);
  expect(formal.employeeProfile.professionalTitle).toBe(expectedTitle);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.requests.filter(entry => entry.path === '/api/v1/employee-archives/employee-0'
    && (entry.status !== 200 || entry.failure))).toEqual([]);
  observed.checkpoints.push('draft-retained-and-final-submit-effective');
});

test('O01 timing: late real archive responses cannot replace a reopened employee', async ({ page, owned: f, observed }, info) => {
  await page.addInitScript(token => localStorage.setItem('token', token), f.token);
  await page.goto(`${origin}/users`);
  const search = page.getByRole('textbox', { name: '搜索姓名、当前工号或历史工号' });
  await search.fill(f.prefix);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const first = f.employees[0]!;
  const second = f.employees[1]!;
  const row = (person: Person) => page.locator('.el-table__row, .mobile-result-card').filter({ hasText: person.employeeNo });
  await expect(row(first).filter({ visible: true })).toHaveCount(1);
  let release!: () => void;
  let fetched!: () => void;
  let delivered!: () => void;
  const releaseResponse = new Promise<void>(resolve => { release = resolve; });
  const responseFetched = new Promise<void>(resolve => { fetched = resolve; });
  const responseDelivered = new Promise<void>(resolve => { delivered = resolve; });
  const url = `${origin}/api/v1/employee-archives/${first.id}`;
  await page.route(url, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    fetched();
    await releaseResponse;
    await route.fulfill({ response });
    delivered();
  });
  try {
    await row(first).filter({ visible: true }).getByRole('button', { name: '查看档案', exact: true }).click();
    await responseFetched;
    observed.checkpoints.push('first-real-200-held-before-close');
    await drawer(page).getByRole('button', { name: '关闭此对话框' }).click();
    await expect(drawer(page)).toBeHidden();
    await row(second).filter({ visible: true }).getByRole('button', { name: '查看档案', exact: true }).click();
    const secondDialog = await enterEditor(page, second);
    release();
    await responseDelivered;
    await page.unroute(url);
    await expect(secondDialog.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
    await expect(secondDialog.locator('[data-archive-field="profile.professionalTitle"] input')).toHaveValue('');
    await expect(secondDialog.getByText('暂时无法加载最新档案，请重试。', { exact: true })).toHaveCount(0);
    await secondDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(drawer(page)).toBeHidden();
    await row(first).filter({ visible: true }).getByRole('button', { name: '查看档案', exact: true }).click();
    await enterEditor(page, first);
    await page.screenshot({ path: info.outputPath('late-response-reopened.png'), fullPage: true });
    expect(observed.pageErrors).toEqual([]);
    observed.checkpoints.push('second-unchanged-and-first-reopened');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
