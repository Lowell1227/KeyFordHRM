import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const origin = 'http://localhost:5173';
const previewCompany = '虚构验收所属公司';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20_000 });
test.setTimeout(180_000);
type Candidate = { id: string; name: string; phone: string };
const observations = new WeakMap<Page, { errors: string[]; external: string[]; writes: { method: string; path: string; status?: number }[] }>();

test.beforeEach(async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const observed = { errors: [] as string[], external: [] as string[], writes: [] as { method: string; path: string; status?: number }[] };
  observations.set(page, observed);
  page.on('pageerror', error => observed.errors.push(error.message));
  page.on('request', request => {
    if (!/^https?:/.test(request.url())) return;
    const url = new URL(request.url());
    if (url.origin !== origin) observed.external.push(url.origin);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) observed.writes.push({ method: request.method(), path: url.pathname });
  });
  page.on('response', response => {
    const request = response.request();
    const write = [...observed.writes].reverse().find(item => item.path === new URL(response.url()).pathname && item.method === request.method() && item.status === undefined);
    if (write) write.status = response.status();
  });
});

test.afterEach(async ({ page }, info) => {
  const observed = observations.get(page)!;
  const path = info.outputPath('page-boundaries.json');
  writeFileSync(path, JSON.stringify({ viewport: page.viewportSize(), url: page.url(), ...observed }, null, 2));
  await info.attach('page-boundaries', { path, contentType: 'application/json' });
  expect.soft(observed.errors, 'Uncaught browser errors').toEqual([]);
  expect.soft(observed.external, 'No requests outside the isolated preview').toEqual([]);
});

test.beforeAll(() => {
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  const env = (container: any) => Object.fromEntries(container.Config.Env.map((line: string) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  for (const container of [api, web]) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  // The canonical guard checks DB role, Redis DB9, storage and every external side-effect switch.
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  expect(new URL(env(api).DATABASE_URL).pathname).toBe('/hrm_preview');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(env(web).VITE_PREVIEW_MODE).toBe('true');
  expect(env(web).VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  expect(web.NetworkSettings.Ports['5173/tcp']).toContainEqual({ HostIp: '127.0.0.1', HostPort: '5173' });
  // Reference fixture only; all employee and workflow writes below still use the UI.
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000, input: `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
    (async () => {
      if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
      const existing = await db.contractSubject.findUnique({ where: { name: '${previewCompany}' } });
      if (!existing) await db.contractSubject.create({ data: { name: '${previewCompany}', internalCompany: 'fuede' } });
      else if (!existing.isActive || existing.internalCompany !== 'fuede') throw new Error('Reference fixture changed; preserve it for investigation');
    })().finally(() => db.$disconnect()).catch(() => process.exitCode = 1);
  ` });
});

async function login(page: Page, employeeNo = 'HR001') {
  await page.goto(`${origin}/login`);
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  if (employeeNo !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${employeeNo})` }).click();
  }
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

function responseFor(page: Page, method: string, path: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method, { timeout: 20_000 });
}

async function read(page: Page, path: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.get(`${origin}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status(), `Read assertion ${path}`).toBe(200);
  return (await response.json()).data;
}

async function screenshot(page: Page, info: TestInfo, name: string, surface?: Locator) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (surface) expect(await surface.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.locator('.el-alert--error:visible,.el-message--error:visible')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

function day(offset: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offset * 86400_000));
}

async function fillDate(input: Locator, value: string) {
  await input.fill(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function fillEmployment(page: Page, drawer: Locator) {
  await drawer.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await page.getByRole('option', { name: previewCompany, exact: true }).click();
  await drawer.locator('[data-archive-field="employee.deptId"] .el-select').click();
  await page.getByRole('treeitem').filter({ hasText: '预览业务部' }).click();
  for (const field of ['entryDate', 'effectiveFrom']) {
    await fillDate(drawer.locator(`[data-archive-field="employee.${field}"] input`), day(-3));
  }
}

function resultRow(page: Page, info: TestInfo, name: string) {
  return page.locator(info.project.name === 'mobile' ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true });
}

async function openTalent(page: Page, info: TestInfo, candidate: Candidate) {
  await page.goto(`${origin}/talents`);
  const search = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await search.fill(candidate.name);
  await search.press('Enter');
  if (info.project.name === 'mobile') await resultRow(page, info, candidate.name).getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(candidate.name, { exact: true }).filter({ visible: true }).first().click();
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
}

async function createTalent(page: Page, info: TestInfo): Promise<Candidate> {
  const name = `虚构全程${info.project.name}${randomUUID().slice(0, 8)}`;
  const phone = `100${Date.now().toString().slice(-8)}`;
  await page.goto(`${origin}/talents`);
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  await page.getByPlaceholder('候选人姓名', { exact: true }).fill(name);
  await page.getByPlaceholder('11 位手机号', { exact: true }).fill(phone);
  await page.getByTestId('talent-form-source').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  const saved = responseFor(page, 'POST', '/talents');
  await page.getByRole('button', { name: '加入人才库', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const candidate = (await response.json()).data;
  if (info.project.name === 'mobile') {
    await page.locator('.mobile-result-card').filter({ hasText: name }).getByRole('button', { name: '打开详情', exact: true }).click();
  } else {
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  }
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
  return { id: candidate.id as string, name, phone };
}

// Fixture only: a new fictional probation participant, not the lifecycle employee under test.
async function probationParticipant(info: TestInfo) {
  const employeeNo = `PL_${randomUUID().slice(0, 8)}`;
  const source = `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
      const department = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
      const user = await prisma.user.create({ data: { name: '虚构试用参与人${employeeNo}', employeeNo: '${employeeNo}',
        status: 'probation', sysRole: 'employee', deptId: department.id, entryDate: new Date('${day(-30)}T00:00:00+08:00') } });
      console.log(JSON.stringify({ id: user.id, employeeNo: user.employeeNo, status: user.status }));
    })().finally(() => prisma.$disconnect()).catch(() => process.exitCode = 1);
  `;
  const fixture = JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', input: source, timeout: 15_000 }));
  await evidence(info, 'fixture-only-probation-participant', fixture);
  return fixture as { id: string; employeeNo: string };
}

async function finishOnboarding(page: Page, info: TestInfo, candidate: Candidate, doubleClick = false) {
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  await expect(drawer.getByLabel('姓名', { exact: true })).toHaveValue(candidate.name);
  await expect(drawer.getByLabel('手机号', { exact: true })).toHaveValue(candidate.phone);
  for (let step = 0; step < 4; step++) {
    await expect(drawer.locator('.submission-process:visible')).toHaveCount(step === 3 ? 1 : 0);
    await expect(drawer.getByText('后续办理流程', { exact: true })).toHaveCount(0);
    if (step === 1) {
      await fillEmployment(page, drawer);
      await drawer.locator('[data-archive-field="employee.employeeStatus"] .el-select').click();
      await page.getByRole('option', { name: '在职', exact: true }).click();
      for (const field of ['entryDate', 'effectiveFrom']) {
        await fillDate(drawer.locator(`[data-archive-field="employee.${field}"] input`), day(-3));
      }
    }
    if (step === 3) await expect(drawer.locator('.submission-process')).toHaveText('提交审核 → 审核通过 → 确认到岗 → 入职生效');
    await screenshot(page, info, `onboarding-step-${step + 1}`, drawer);
    if (step === 3) {
      await drawer.locator('.submission-process').scrollIntoViewIfNeeded();
      await screenshot(page, info, 'onboarding-final-process', drawer);
    }
    if (step < 3) await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  }
  const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/employee-archives'
    && response.request().method() === 'POST' && (!doubleClick || response.status() === 201), { timeout: 20_000 });
  await drawer.getByRole('button', { name: '提交', exact: true }).click({ clickCount: doubleClick ? 2 : 1 });
  const response = await submitted;
  expect(response.status()).toBe(201);
  const request = (await response.json()).data;
  await expect(drawer).not.toBeVisible();
  expect(request.talentCandidateId).toBe(candidate.id || null);
  return request as { id: string; userId?: string; onboardingStatus: string };
}

async function onboardFromTalent(page: Page, info: TestInfo, candidate: Candidate, doubleClick = false) {
  await page.locator('.talent-detail-drawer').getByRole('button', { name: '办理入职', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/entry-exit\\?talentId=${candidate.id}`));
  return finishOnboarding(page, info, candidate, doubleClick);
}

async function openApplication(page: Page, info: TestInfo, candidate: Candidate, requestId: string) {
  await page.goto(`${origin}/entry-exit?tab=applications`);
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(candidate.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await resultRow(page, info, candidate.name).getByRole('button', { name: /^(查看办理详情|确认到岗)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`requestId=${requestId}`));
  const drawer = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(drawer).toContainText(candidate.name);
  return drawer;
}

async function approve(page: Page, drawer: Locator, requestId: string) {
  const response = responseFor(page, 'POST', '/employee-archives/reviews/approve');
  await drawer.getByRole('button', { name: '通过', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  expect((await result.json()).data.failed).toEqual([]);
  // Route synchronization can leave an earlier detail GET in flight; read after the write completes.
  return read(page, `/employee-archives/applications/${requestId}`);
}

async function arrive(page: Page, drawer: Locator, requestId: string) {
  const response = responseFor(page, 'POST', `/employee-archives/applications/${requestId}/confirm-arrival`);
  await drawer.getByRole('button', { name: '确认到岗', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  expect((await result.json()).data.onboardingStatus).toBe('effective');
  await expect(drawer.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
}

test('HR staff submits and a different HR administrator reviews and confirms arrival', async ({ page }, info) => {
  const marker = `DUAL_${randomUUID().slice(0, 8)}`;
  const fixture = JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 15_000, input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      (async () => {
        if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
        const dept = await db.department.findFirstOrThrow({ where: { name: '预览人事部' } });
        const user = await db.user.create({ data: { name: '虚构入职经办${marker}', employeeNo: '${marker}',
          status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit', 'organization_edit'], deptId: dept.id,
          employmentHistory: { create: { effectiveFrom: new Date('2025-01-01T00:00:00Z'), entryDate: new Date('2025-01-01T00:00:00Z'),
            company: 'fuede', deptId: dept.id, employeeStatus: 'active', employeeNo: '${marker}', changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
        const { JwtService } = require('@nestjs/jwt');
        const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: user.id, employeeNo: user.employeeNo }, { expiresIn: '15m' });
        console.log(JSON.stringify({ id: user.id, token }));
      })().finally(() => db.$disconnect()).catch(() => process.exitCode = 1);
    `,
  }));
  await page.goto(`${origin}/login`);
  await page.evaluate(token => localStorage.setItem('token', token), fixture.token);
  await page.goto(`${origin}/entry-exit`);
  const staff = await read(page, '/auth/me');
  expect(staff.id).toBe(fixture.id);
  expect(staff.sysRole).toBe('hr_user');
  expect(staff.hrCapabilities).not.toContain('employee_archive_review');
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const candidate = { id: '', name: `虚构双角色${marker}`, phone: '' };
  await page.getByRole('dialog', { name: '办理入职', exact: true }).getByLabel('姓名', { exact: true }).fill(candidate.name);
  const application = await finishOnboarding(page, info, candidate);
  const staffDetail = await openApplication(page, info, candidate, application.id);
  await expect(staffDetail.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
  await expect(staffDetail.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
  for (const [path, data] of [
    ['/employee-archives/reviews/approve', { requestIds: [application.id] }],
    [`/employee-archives/applications/${application.id}/confirm-arrival`, {}],
  ] as const) {
    const denied = await page.request.post(`${origin}/api/v1${path}`, { headers: { authorization: `Bearer ${fixture.token}` }, data });
    expect(denied.status()).toBe(403);
  }
  const pending = await read(page, `/employee-archives/applications/${application.id}`);
  expect(pending.createdById).toBe(staff.id);
  expect(pending.profileReviewStatus).toBe('pending');
  await screenshot(page, info, 'staff-submitted-without-review-actions', staffDetail);
  await page.evaluate(() => localStorage.clear());
  await login(page);
  const reviewer = await read(page, '/auth/me');
  expect(reviewer.sysRole).toBe('hr');
  expect(reviewer.id).not.toBe(staff.id);
  const review = await openApplication(page, info, candidate, application.id);
  const approved = await approve(page, review, application.id);
  expect(approved.profileReviewedById).toBe(reviewer.id);
  expect(approved.createdById).toBe(staff.id);
  expect(approved.onboardingStatus).toBe('pending_entry');
  expect((await read(page, `/employee-archives/${approved.userId}`)).status).toBe('pending_entry');
  await arrive(page, review, application.id);
  const completed = await read(page, `/employee-archives/applications/${application.id}`);
  expect(completed.arrivalConfirmedById).toBe(reviewer.id);
  expect(completed.onboardingStatus).toBe('effective');
  await review.getByRole('button', { name: '查看员工档案', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/users?employeeId=${approved.userId}`);
  await expect(page.locator('.employee-archive-drawer')).toContainText(candidate.name);
  await screenshot(page, info, 'separate-reviewer-arrival-archive');
  await evidence(info, 'separate-role-handoff', { requestId: application.id, submitterId: staff.id,
    reviewerId: reviewer.id, userId: approved.userId, status: completed.onboardingStatus });
});

test('direct onboarding shows the missing name beside the field', async ({ page }) => {
  await login(page);
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="employee.name"] .el-form-item__error')).toHaveText('请填写姓名');
  await expect(drawer.getByLabel('姓名', { exact: true })).toBeFocused();
});

test('identity lookup waits for its own autosaved draft without reporting a duplicate', async ({ page }, info) => {
  await login(page);
  const candidate = await createTalent(page, info);
  let releaseDraft!: () => void;
  const heldResponse = new Promise<void>(resolve => { releaseDraft = resolve; });
  let draftCreated!: () => void;
  const created = new Promise<void>(resolve => { draftCreated = resolve; });
  let draftId = '';
  // Keep the real backend response, but delay delivery to reproduce a slow connection.
  await page.route('**/api/v1/employee-archives/drafts', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    draftId = (await response.json()).data.id;
    draftCreated();
    await heldResponse;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.locator('.talent-detail-drawer').getByRole('button', { name: '办理入职', exact: true }).click();
  await created;
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  const lookedUp = responseFor(page, 'POST', '/employee-archives/identity-lookup');
  try {
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  } finally { releaseDraft(); }
  const lookup = await lookedUp;
  expect(lookup.request().postDataJSON().excludeRequestId).toBe(draftId);
  expect((await lookup.json()).data.candidates).toEqual([]);
  await expect(drawer.getByRole('heading', { name: '任职信息', exact: true })).toBeVisible();
  await expect(drawer.locator('.identity-result:visible')).toHaveCount(0);
  await screenshot(page, info, 'autosave-identity-handoff', drawer);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  expect((await read(page, `/employee-archives/applications/${draftId}`)).talentCandidateId).toBe(candidate.id);
});

test('onboarding step header covers scrolling fields at compact widths', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1024, height: 768 });
  await login(page);
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  await drawer.getByLabel('姓名', { exact: true }).fill(`虚构布局验收${randomUUID().slice(0, 8)}`);
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await drawer.locator('.el-drawer__body').evaluate(element => { element.scrollTop = 240; });
  await expect.poll(() => drawer.locator('.el-drawer__body').evaluate(element => element.scrollTop)).toBeGreaterThan(20);
  await expect.poll(() => drawer.evaluate(element => {
    const body = element.querySelector('.el-drawer__body')!.getBoundingClientRect();
    const header = element.querySelector('.wizard-head')!.getBoundingClientRect();
    return Math.abs(header.top - body.top);
  })).toBeLessThanOrEqual(1);
  await screenshot(page, info, 'compact-onboarding-scroll', drawer);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).not.toBeVisible();
});

test('onboarding validates each step and ends on check and submit', async ({ page }, info) => {
  await login(page);
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  await drawer.getByLabel('姓名', { exact: true }).fill(`虚构分步校验${randomUUID().slice(0, 8)}`);
  await drawer.getByLabel('手机号', { exact: true }).fill('12345');
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="profile.phone"] .el-form-item__error')).toHaveText('请填写完整的 11 位手机号');
  await expect(drawer.getByRole('heading', { name: '身份核验' })).toBeVisible();
  await drawer.getByLabel('手机号', { exact: true }).fill('');
  await drawer.getByLabel('身份证号', { exact: true }).fill('123');
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="profile.idNumber"] .el-form-item__error')).toContainText('完整的身份证号');
  await expect(drawer.getByRole('heading', { name: '身份核验' })).toBeVisible();
  await drawer.getByLabel('身份证号', { exact: true }).fill('');
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '任职信息' })).toBeVisible();
  await expect(drawer.getByText('组织归属', { exact: true })).toHaveCount(0);
  await expect(drawer.locator('.el-form-item__label').filter({ hasText: /^所属公司$/ })).toBeVisible();
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="employee.companyText"] .el-form-item__error')).toHaveText('请选择所属公司');
  await expect(drawer.locator('[data-archive-field="employee.deptId"] .el-form-item__error')).toHaveText('请选择部门');
  await expect(drawer.locator('[data-archive-field="employee.entryDate"] .el-form-item__error')).toHaveText('请选择入职日期');
  await expect(drawer.locator('[data-archive-field="employee.effectiveFrom"] .el-form-item__error')).toHaveText('请选择任职开始日期');
  await screenshot(page, info, 'employment-step-errors', drawer);
  await fillEmployment(page, drawer);
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator(info.project.name === 'mobile' ? '.mobile-step' : '.el-step__title.is-process')).toHaveText(info.project.name === 'mobile' ? '3/4 档案' : '档案');
  await drawer.getByRole('button', { name: '个人与教育' }).click();
  await drawer.getByLabel('毕业院校', { exact: true }).fill('文'.repeat(201));
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="profile.school"] .el-form-item__error')).toHaveText('最多填写 200 个字符');
  await drawer.getByLabel('毕业院校', { exact: true }).fill('虚构分步院校');
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '检查并提交', exact: true })).toBeVisible();
  await expect(drawer.locator(info.project.name === 'mobile' ? '.mobile-step' : '.el-step__title.is-process')).toHaveText(info.project.name === 'mobile' ? '4/4 检查并提交' : '检查并提交');
  await expect(drawer.getByText('预览提交', { exact: true })).toHaveCount(0);
  await expect(drawer.locator('.preview-grid')).toContainText(previewCompany);
  await expect(drawer.locator('.el-form-item__error:visible')).toHaveCount(0);
  await screenshot(page, info, 'check-and-submit', drawer);
  const submitted = responseFor(page, 'POST', '/employee-archives');
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  const application = (await response.json()).data;
  expect(application.proposedValue.employee.company).toBe('fuede');
  expect(application.proposedValue.employee.companyText).toBe(previewCompany);
  await expect(page).toHaveURL(new RegExp(`requestId=${application.id}`));
});

test('restored legacy dates remain visible and can be corrected within employment step', async ({ page }, info) => {
  await login(page);
  const name = `虚构历史日期${randomUUID().slice(0, 8)}`;
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  await drawer.getByLabel('姓名', { exact: true }).fill(name);
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await fillEmployment(page, drawer);
  await drawer.locator('[data-archive-field="employee.position"] input').fill('虚构历史日期岗位');
  const saved = responseFor(page, 'POST', '/employee-archives/drafts');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const draft = (await (await saved).json()).data;
  await expect(drawer).not.toBeVisible();
  // This case restores a historical payload; only this newly-created fictional draft is seeded.
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { stdio: 'pipe', timeout: 15_000, input: `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
    (async () => {
      const draft = await db.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: '${draft.id}' } });
      if (draft.recordStatus !== 'draft' || draft.proposedValue.employee.name !== '${name}') throw new Error('Fixture ownership mismatch');
      const proposed = draft.proposedValue;
      Object.assign(proposed.employee, { effectiveTo: '${day(-1)}', actualRegularDate: '${day(-2)}', leaveDate: '${day(-1)}' });
      await db.employeeDataChangeRequest.update({ where: { id: draft.id }, data: { proposedValue: proposed } });
    })().finally(() => db.$disconnect()).catch(() => process.exitCode = 1);
  ` });
  await page.getByRole('tab', { name: '草稿', exact: true }).click();
  await resultRow(page, info, name).getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(drawer.getByLabel('任职结束', { exact: true })).toHaveValue(day(-1));
  await expect(drawer.getByLabel('实际转正日期', { exact: true })).toHaveValue(day(-2));
  await expect(drawer.getByLabel('离职日期', { exact: true })).toHaveValue(day(-1));
  await fillDate(drawer.getByLabel('任职开始', { exact: true }), day(1));
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('[data-archive-field="employee.effectiveTo"] .el-form-item__error')).toHaveText('任职结束日期不能早于任职开始日期');
  await screenshot(page, info, 'legacy-date-correction', drawer);
  await fillDate(drawer.getByLabel('任职结束', { exact: true }), day(2));
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.locator('.supplement-groups')).toBeVisible();
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
});

test('company directory mapping drives onboarding and archive editing without rewriting history', async ({ page }, info) => {
  await login(page);
  const companyName = `虚构映射${randomUUID().slice(0, 8)}`;
  await page.goto(`${origin}/basic-data?tab=contract-subjects`);
  await page.getByRole('button', { name: '新增主体', exact: true }).click();
  const subjectDialog = page.getByRole('dialog', { name: '新增合同主体', exact: true });
  await subjectDialog.getByLabel('主体名称', { exact: true }).fill(companyName);
  const createdResponse = responseFor(page, 'POST', '/contract-subjects');
  await subjectDialog.getByRole('button', { name: '保存主体', exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const subject = (await created.json()).data;
  expect(subject.internalCompany).toBeNull();
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const create = page.getByRole('dialog', { name: '办理入职', exact: true });
  await create.getByLabel('姓名', { exact: true }).fill(`虚构选项${randomUUID().slice(0, 8)}`);
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await create.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await expect(page.getByRole('option').filter({ hasText: companyName })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await create.getByRole('button', { name: '关闭', exact: true }).click();

  async function changeMapping(label: string) {
    await page.goto(`${origin}/basic-data?tab=contract-subjects`);
    await page.getByPlaceholder('搜索主体名称').fill(companyName);
    await resultRow(page, info, companyName).getByRole('button', { name: '编辑主体', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑合同主体', exact: true });
    await dialog.locator('.el-select').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    const updated = responseFor(page, 'PATCH', `/contract-subjects/${subject.id}`);
    await dialog.getByRole('button', { name: '保存主体', exact: true }).click();
    expect((await updated).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
  }
  await changeMapping('北京孚德（beijing_fuede）');
  await screenshot(page, info, 'company-directory-mapping');
  const person: Candidate = { id: '', name: `虚构公司档案${randomUUID().slice(0, 8)}`, phone: '' };
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  await create.getByLabel('姓名', { exact: true }).fill(person.name);
  const application = await finishOnboarding(page, info, person);
  const detail = page.getByRole('dialog', { name: /办理详情$/ });
  const approved = await approve(page, detail, application.id);
  await arrive(page, detail, application.id);
  const userId = approved.userId;
  await detail.getByRole('button', { name: '查看员工档案', exact: true }).click();
  const archive = page.locator('.employee-archive-drawer');
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(archive.getByText('组织归属', { exact: true })).toHaveCount(0);
  await expect(archive.locator('[data-archive-field="employee.companyText"]')).toHaveCount(1);
  await archive.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await page.getByRole('option', { name: companyName, exact: true }).click();
  await screenshot(page, info, 'archive-single-company');
  const saved = responseFor(page, 'PATCH', `/employee-archives/${userId}/draft`);
  await archive.getByRole('button', { name: '提交', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(archive.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  const changedArchive = await read(page, `/employee-archives/${userId}`);
  expect(changedArchive.currentEmployment.company).toBe('beijing_fuede');
  expect(changedArchive.currentEmployment.companyText).toBe(companyName);
  expect(changedArchive.currentEmployment.contractSubjectId).toBe(subject.id);
  await expect(archive).toContainText(companyName);

  await changeMapping('凡思堡（fansibao）');
  await page.goto(`${origin}/users?employeeId=${userId}`);
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click();
  await archive.locator('[data-archive-field="profile.school"] input').fill('虚构历史映射院校');
  const unrelatedSaved = responseFor(page, 'PATCH', `/employee-archives/${userId}/draft`);
  await archive.getByRole('button', { name: '提交', exact: true }).click();
  expect((await unrelatedSaved).status()).toBe(200);
  const preservedArchive = await read(page, `/employee-archives/${userId}`);
  expect(preservedArchive.currentEmployment.company).toBe('beijing_fuede');
  expect(preservedArchive.currentEmployment.companyText).toBe(companyName);
  expect(preservedArchive.employeeProfile.school).toBe('虚构历史映射院校');
  await evidence(info, 'company-mapping-boundaries', { userId, subjectId: subject.id, currentMapping: 'fansibao', retainedCompany: preservedArchive.currentEmployment.company });
});

test('legacy archive without employment can supplement profile without guessing company', async ({ page }, info) => {
  const name = `虚构缺任职${randomUUID().slice(0, 8)}`;
  const userId = randomUUID();
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { stdio: 'pipe', timeout: 15_000, input: `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
    (async () => {
      if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
      const department = await db.department.findFirstOrThrow({ where: { name: '预览业务部' } });
      await db.user.create({ data: { id: '${userId}', name: '${name}', employeeNo: 'LC_${userId.slice(0, 8)}', status: 'active', sysRole: 'employee', deptId: department.id } });
    })().finally(() => db.$disconnect()).catch(() => process.exitCode = 1);
  ` });
  await login(page);
  await page.goto(`${origin}/users?employeeId=${userId}`);
  const archive = page.locator('.employee-archive-drawer');
  await archive.getByRole('button', { name: '编辑档案', exact: true }).click();
  await archive.locator('[data-archive-field="profile.school"] input').fill('虚构缺项补充院校');
  const saved = responseFor(page, 'PATCH', `/employee-archives/${userId}/draft`);
  await archive.getByRole('button', { name: '提交', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(archive.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  const result = await read(page, `/employee-archives/${userId}`);
  expect(result.employeeProfile.school).toBe('虚构缺项补充院校');
  expect(result.employmentHistory).toEqual([]);
  expect(result.currentEmployment).toBeNull();
  await screenshot(page, info, 'legacy-profile-preserved');
});

test('direct onboarding resumes its draft and hands off through arrival and archived reentry', async ({ page }, info) => {
  await login(page);
  const person: Candidate = { id: '', name: `虚构直接入职${randomUUID().slice(0, 8)}`, phone: `100${Date.now().toString().slice(-8)}` };
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const create = page.getByRole('dialog', { name: '办理入职', exact: true });
  await create.getByLabel('姓名', { exact: true }).fill(person.name);
  await create.getByLabel('手机号', { exact: true }).fill(person.phone);
  await create.getByRole('heading', { name: '身份核验' }).click();
  await expect(create.locator('.save-state')).toHaveClass(/save-state--saved/);
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await create.locator('[data-archive-field="employee.position"] input').fill('虚构验收岗位');
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(create.locator('[data-archive-field="employee.deptId"] .el-form-item__error')).toHaveText('请选择部门');
  await expect(create.locator('[data-archive-field="employee.entryDate"] .el-form-item__error')).toHaveText('请选择入职日期');
  await expect(create.locator('[data-archive-field="employee.effectiveFrom"] .el-form-item__error')).toHaveText('请选择任职开始日期');
  await fillEmployment(page, create);
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await create.getByRole('button', { name: '个人与教育' }).click();
  await create.getByLabel('毕业院校', { exact: true }).fill('虚构验收院校');
  await create.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).not.toBeVisible();
  await page.getByRole('tab', { name: '草稿', exact: true }).click();
  const draftRow = resultRow(page, info, person.name);
  await expect(draftRow).toContainText('第 3/4 步');
  await draftRow.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(create.locator('.supplement-groups')).toBeVisible();
  await create.getByRole('button', { name: '个人与教育' }).click();
  await expect(create.getByLabel('毕业院校', { exact: true })).toHaveValue('虚构验收院校');
  await screenshot(page, info, 'direct-draft-resumed', create);
  await create.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(create.getByRole('heading', { name: '检查并提交' })).toBeVisible();
  await create.getByRole('button', { name: '上一步', exact: true }).click();
  await create.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(create.locator('[data-archive-field="employee.position"] input')).toHaveValue('虚构验收岗位');
  await create.getByRole('button', { name: '上一步', exact: true }).click();
  const application = await finishOnboarding(page, info, person);

  // Continue from the submitted page, without finding the application again or using API mutations.
  const detail = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`requestId=${application.id}`));
  await expect(detail).toContainText(person.name);
  const timeline = detail.getByTestId('personnel-application-timeline');
  expect(application.performanceReviewStatus).toBe('not_required');
  await expect(timeline.getByText('绩效关系', { exact: true })).toHaveCount(0);
  await expect(timeline.getByText('无需审核', { exact: true })).toHaveCount(0);
  await expect(timeline.getByText('基础档案', { exact: true })).toHaveCount(1);
  await expect(detail.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
  const approved = await approve(page, detail, application.id);
  expect(approved.onboardingStatus).toBe('pending_entry');
  await expect(timeline).toContainText('待 HR 确认到岗');
  await expect(timeline.getByText('绩效关系', { exact: true })).toHaveCount(0);
  await screenshot(page, info, 'onboarding-review-awaiting-arrival', detail);
  const userId = approved.userId;
  expect((await read(page, `/employee-archives/${userId}`)).status).toBe('pending_entry');
  await arrive(page, detail, application.id);
  const firstArchive = await read(page, `/employee-archives/${userId}`);
  expect(firstArchive.status).toBe('active');
  await detail.getByRole('button', { name: '查看员工档案', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`employeeId=${userId}`));
  await expect(page.locator('.employee-archive-drawer')).toContainText(person.name);
  await screenshot(page, info, 'direct-effective-archive');

  await page.goto(`${origin}/users`);
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(person.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await resultRow(page, info, person.name).getByRole('button', { name: '办理离职', exact: true }).click();
  const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
  await fillDate(resignation.getByLabel('最后工作日', { exact: true }), day(-1));
  await resignation.getByLabel('离职原因', { exact: true }).fill('虚构数据入离职验收');
  const leaving = responseFor(page, 'POST', `/employee-archives/${userId}/employments`);
  await resignation.getByRole('button', { name: '提交审核', exact: true }).click();
  const leavingResponse = await leaving;
  expect(leavingResponse.status()).toBe(201);
  const leaveRequest = (await leavingResponse.json()).data;
  await approve(page, await openApplication(page, info, person, leaveRequest.id), leaveRequest.id);
  expect((await read(page, `/employee-archives/${userId}`)).status).toBe('resigned');
  await page.goto(`${origin}/users`);
  await page.getByRole('tab', { name: '已离职', exact: true }).click();
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(person.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await resultRow(page, info, person.name).getByRole('button', { name: '归档', exact: true }).click();
  const archiving = responseFor(page, 'POST', '/employee-archives/archive');
  await page.getByRole('dialog', { name: '归档离职员工' }).getByRole('button', { name: '确认归档' }).click();
  expect((await archiving).status()).toBe(201);
  expect((await read(page, `/employee-archives/${userId}`)).archivedAt).toBeTruthy();

  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  await create.getByLabel('姓名', { exact: true }).fill(person.name);
  const matches = create.getByRole('region', { name: '同名离职员工' });
  await expect(matches).toContainText('已归档');
  await matches.getByRole('button', { name: /^选择 .* 再入职$/ }).click();
  const reentry = page.getByRole('dialog', { name: '办理再入职', exact: true });
  await expect(reentry).toContainText(firstArchive.employeeNo);
  await reentry.getByRole('button', { name: '提交', exact: true }).click();
  await expect(reentry.locator('.el-form-item').filter({ hasText: '再入职日期' }).locator('.el-form-item__error')).toHaveText('请选择再入职日期');
  await fillDate(reentry.getByLabel('再入职日期', { exact: true }), day(0));
  await reentry.locator('.el-form-item').filter({ hasText: '员工状态' }).locator('.el-select').click();
  await page.getByRole('option', { name: '在职', exact: true }).click();
  const resubmitting = responseFor(page, 'POST', `/employee-archives/${userId}/reentry`);
  await reentry.getByRole('button', { name: '提交', exact: true }).click();
  const reentryResponse = await resubmitting;
  expect(reentryResponse.status()).toBe(201);
  const reentryRequest = (await reentryResponse.json()).data;
  expect(reentryRequest.userId).toBe(userId);
  await expect(reentry).not.toBeVisible();
  await expect(detail).toContainText(person.name);
  await expect(page).toHaveURL(new RegExp(`requestId=${reentryRequest.id}`));
  expect(reentryRequest.performanceReviewStatus).toBe('not_required');
  await expect(timeline.getByText('绩效关系', { exact: true })).toHaveCount(0);
  await expect(timeline.getByText('无需审核', { exact: true })).toHaveCount(0);
  await screenshot(page, info, 'reentry-submitted-details', detail);
  await approve(page, detail, reentryRequest.id);
  expect((await read(page, `/employee-archives/${userId}`)).status).not.toBe('active');
  await arrive(page, detail, reentryRequest.id);
  const finalArchive = await read(page, `/employee-archives/${userId}`);
  expect(finalArchive.id).toBe(userId);
  expect(finalArchive.status).toBe('active');
  expect(finalArchive.archivedAt).toBeNull();
  expect(finalArchive.employeeNo).not.toBe(firstArchive.employeeNo);
  expect(finalArchive.employmentHistory.length).toBeGreaterThan(firstArchive.employmentHistory.length);
  expect(finalArchive.employmentHistory.some((item: { employeeNo: string }) => item.employeeNo === firstArchive.employeeNo)).toBe(true);
  await screenshot(page, info, 'reentry-effective-details', detail);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/entry-exit?tab=applications`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await evidence(info, 'direct-onboarding-and-reentry', { userId, applicationId: application.id, resignationId: leaveRequest.id, reentryId: reentryRequest.id, status: finalArchive.status, oldEmployeeNo: firstArchive.employeeNo, newEmployeeNo: finalArchive.employeeNo });
});

test('full UI personnel lifecycle selects active and probation interview participants', async ({ page }, info) => {
  const participant = await probationParticipant(info);
  await login(page);
  const candidate = await createTalent(page, info);
  const drawer = page.locator('.talent-detail-drawer');
  await drawer.getByRole('button', { name: '记一条', exact: true }).click();
  await drawer.getByPlaceholder('本次沟通要点（必填）').fill('虚构全程回归，页面保存跟进后安排面试');
  const followUp = responseFor(page, 'POST', `/talents/${candidate.id}/follow-ups`);
  await drawer.getByRole('button', { name: '保存跟进', exact: true }).click();
  expect((await followUp).status()).toBe(201);
  await drawer.getByRole('button', { name: '新增面试', exact: true }).click();
  const active = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users' && new URL(r.url()).searchParams.get('status') === 'active');
  const probation = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users' && new URL(r.url()).searchParams.get('status') === 'probation');
  await drawer.locator('.el-form-item').filter({ hasText: '内部参与人' }).locator('.el-select').click();
  expect((await active).status()).toBe(200);
  expect((await probation).status()).toBe(200);
  const peopleInput = drawer.locator('.el-form-item').filter({ hasText: '内部参与人' }).getByRole('combobox');
  const activeSearch = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users'
    && new URL(r.url()).searchParams.get('status') === 'active' && new URL(r.url()).searchParams.get('keyword') === 'EMP001');
  await peopleInput.fill('EMP001');
  const activeBody = await (await activeSearch).json();
  await expect(page.locator('.el-select-dropdown:visible')).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: /EMP001/ })).toBeVisible();
  await page.getByRole('option').filter({ hasText: /EMP001/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('option').filter({ hasText: /EMP001/ })).toBeInViewport({ ratio: 1 });
  await page.getByRole('option').filter({ hasText: /EMP001/ }).click();
  const probationSearch = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users'
    && new URL(r.url()).searchParams.get('status') === 'probation' && new URL(r.url()).searchParams.get('keyword') === participant.employeeNo);
  await peopleInput.fill(participant.employeeNo);
  const probationBody = await (await probationSearch).json();
  await expect(page.getByRole('option').filter({ hasText: participant.employeeNo })).toBeVisible();
  await expect(page.locator('.el-select-dropdown:visible')).not.toContainText('加载中');
  await page.getByRole('option').filter({ hasText: participant.employeeNo }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('option').filter({ hasText: participant.employeeNo })).toBeInViewport({ ratio: 1 });
  await evidence(info, 'participant-selector', {
    candidateId: candidate.id, active: activeBody.data?.items?.map((u: any) => ({ id: u.id, employeeNo: u.employeeNo, status: u.status, archivedAt: u.archivedAt })),
    probation: probationBody.data?.items?.map((u: any) => ({ id: u.id, employeeNo: u.employeeNo, status: u.status, archivedAt: u.archivedAt })),
    options: await page.getByRole('option').filter({ visible: true }).allTextContents(),
  });
  await page.screenshot({ path: info.outputPath('participant-selector.png'), fullPage: true, animations: 'disabled', scale: 'css' });
  await page.getByRole('option').filter({ hasText: participant.employeeNo }).click();
  await page.keyboard.press('Escape');
  await expect(drawer.locator('.el-select__selection')).toContainText('EMP001');
  await expect(drawer.locator('.el-select__selection')).toContainText(participant.employeeNo);
  expect(activeBody.data.items.some((u: any) => u.employeeNo === 'EMP001')).toBe(true);
  expect(activeBody.data.items.every((u: any) => u.status === 'active' && !u.archivedAt)).toBe(true);
  expect(probationBody.data.items.every((u: any) => u.status === 'probation' && !u.archivedAt)).toBe(true);
  expect(probationBody.data.items.some((u: any) => u.id === participant.id)).toBe(true);
  for (const [label, time] of [['开始时间（北京时间）', '10:00:00'], ['结束时间（北京时间）', '11:00:00']]) {
    await fillDate(drawer.getByRole('combobox', { name: label }), `${day(1)} ${time}`);
  }
  const meetingUrl = `https://meeting.tencent.com/dm/fictional-${candidate.id}`;
  await drawer.getByRole('textbox', { name: '会议邀请内容' }).fill(`虚构面试邀请，仅测试，不外发。\n${meetingUrl}`);
  await drawer.getByRole('textbox', { name: '安排备注', exact: true }).fill('虚构共享安排');
  const created = responseFor(page, 'POST', '/talent-interviews');
  await drawer.getByRole('button', { name: '保存邀约', exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const interview = (await createdResponse.json()).data;
  expect(interview.meetingUrl).toBe(meetingUrl);
  await drawer.locator('.interview-panel .el-collapse-item__header').click();
  await expect(drawer.getByRole('link', { name: '打开腾讯会议', exact: true })).toHaveAttribute('href', meetingUrl);
  await drawer.getByRole('button', { name: '修改邀约', exact: true }).click();
  await drawer.getByRole('textbox', { name: '安排备注', exact: true }).fill('虚构共享安排，页面修改已保存');
  const edited = responseFor(page, 'PATCH', `/talent-interviews/${interview.id}`);
  await drawer.getByRole('button', { name: '保存邀约', exact: true }).click();
  expect((await edited).status()).toBe(200);
  await expect(drawer.getByText('虚构共享安排，页面修改已保存', { exact: true })).toBeVisible();
  await screenshot(page, info, 'interview-edited', drawer);
  await drawer.getByRole('button', { name: '完成面试', exact: true }).click();
  const completed = responseFor(page, 'POST', `/talent-interviews/${interview.id}/complete`);
  await page.getByRole('dialog', { name: '面试邀约', exact: true }).getByRole('button', { name: '完成面试', exact: true }).click();
  expect((await completed).status()).toBe(201);
  await expect(drawer.locator('.interview-panel')).toContainText('已完成');
  expect((await read(page, `/talent-interviews/${interview.id}`)).status).toBe('completed');
  await screenshot(page, info, 'interview-completed', drawer);

  const application = await onboardFromTalent(page, info, candidate);
  const review = await openApplication(page, info, candidate, application.id);
  const pending = await approve(page, review, application.id);
  expect(pending.onboardingStatus).toBe('pending_entry');
  const userId = pending.userId;
  expect((await read(page, `/talents/${candidate.id}`)).status).not.toBe('hired');
  expect((await read(page, `/employee-archives/${userId}`)).status).toBe('pending_entry');
  await screenshot(page, info, 'review-approved-awaiting-arrival', review);
  await arrive(page, review, application.id);
  const hired = await read(page, `/talents/${candidate.id}`);
  expect(hired.status).toBe('hired');
  expect(hired.convertedUserId).toBe(userId);
  await screenshot(page, info, 'arrival-confirmed', review);

  await openTalent(page, info, candidate);
  const archiveRead = responseFor(page, 'GET', `/employee-archives/${userId}`);
  await page.getByRole('button', { name: `查看员工档案：${candidate.name}`, exact: true }).click();
  await expect(page).toHaveURL(`${origin}/users?employeeId=${userId}`);
  expect((await (await archiveRead).json()).data.id).toBe(userId);
  const archive = page.locator('.employee-archive-drawer');
  await expect(archive.getByRole('heading', { name: candidate.name, exact: true })).toBeVisible();
  await screenshot(page, info, 'exact-linked-employee-archive', archive);

  await page.goto(`${origin}/users`);
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(candidate.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await resultRow(page, info, candidate.name).getByRole('button', { name: '办理离职', exact: true }).click();
  const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
  await fillDate(resignation.getByRole('combobox', { name: '最后工作日', exact: true }), day(-1));
  await resignation.getByRole('textbox', { name: '离职原因', exact: true }).fill('虚构全程回归结束，保留审计记录');
  const resigned = responseFor(page, 'POST', `/employee-archives/${userId}/employments`);
  await resignation.getByRole('button', { name: '提交审核', exact: true }).click();
  const resignationResponse = await resigned;
  expect(resignationResponse.status()).toBe(201);
  const resignationRequest = (await resignationResponse.json()).data;
  await expect(resignation).toContainText('待 HR 审核');
  await screenshot(page, info, 'resignation-submitted', resignation);
  const resignationReview = await openApplication(page, info, candidate, resignationRequest.id);
  await approve(page, resignationReview, resignationRequest.id);
  await expect.poll(async () => (await read(page, `/employee-archives/${userId}`)).status).toBe('resigned');
  await screenshot(page, info, 'resignation-approved', resignationReview);

  await page.goto(`${origin}/users`);
  await page.getByRole('tab', { name: '已离职', exact: true }).click();
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(candidate.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await resultRow(page, info, candidate.name).getByRole('button', { name: '归档', exact: true }).click();
  const archived = responseFor(page, 'POST', '/employee-archives/archive');
  await page.getByRole('dialog', { name: '归档离职员工', exact: true }).getByRole('button', { name: '确认归档', exact: true }).click();
  expect((await archived).status()).toBe(201);
  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  const archivedRow = resultRow(page, info, candidate.name);
  await expect(archivedRow.getByRole('button', { name: '取消归档', exact: true })).toBeVisible();
  const persisted = await read(page, `/employee-archives/${userId}`);
  expect(persisted.archivedAt).toBeTruthy();
  expect(persisted.status).toBe('resigned');
  expect(persisted.employmentHistory.length).toBeGreaterThan(0);
  await screenshot(page, info, 'archived-retained-history');
  await evidence(info, 'lifecycle-identities', { candidateId: candidate.id, interviewId: interview.id, requestId: application.id, userId, resignationRequestId: resignationRequest.id });
});

test('returned onboarding is revised and resubmitted through its original page', async ({ page }, info) => {
  await login(page);
  const candidate = await createTalent(page, info);
  const application = await onboardFromTalent(page, info, candidate);
  const review = await openApplication(page, info, candidate, application.id);
  await review.getByRole('button', { name: '退回', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: '退回员工变更', exact: true });
  await prompt.getByRole('textbox').fill('虚构退回，补充核验后重新提交');
  const rejected = responseFor(page, 'POST', '/employee-archives/reviews/reject');
  await prompt.getByRole('button', { name: '确认退回', exact: true }).click();
  expect((await rejected).status()).toBe(201);
  await expect(review).toContainText('已退回');
  await screenshot(page, info, 'returned-onboarding', review);
  await review.getByRole('button', { name: '修改后重新提交', exact: true }).click();
  const resubmitted = await finishOnboarding(page, info, candidate);
  expect(resubmitted.id).toBe(application.id);
  const persisted = await read(page, `/employee-archives/applications/${application.id}`);
  expect(persisted.profileReviewStatus).toBe('pending');
  expect(persisted.arrivalConfirmedAt).toBeNull();
  const timeline = review.getByTestId('personnel-application-timeline');
  await expect(review.getByRole('heading', { name: '补充办理记录' })).toHaveCount(0);
  await expect(timeline.getByText('退回申请', { exact: true })).toHaveCount(1);
  await expect(timeline.getByText('虚构退回，补充核验后重新提交', { exact: true })).toHaveCount(1);
});

test('arrival actions belong to their step and revisions stay in chronological history', async ({ page }, info) => {
  await login(page);
  const candidate = await createTalent(page, info);
  const application = await onboardFromTalent(page, info, candidate);
  const review = await openApplication(page, info, candidate, application.id);
  await approve(page, review, application.id);
  const timeline = review.getByTestId('personnel-application-timeline');
  const arrivalStep = timeline.locator('[data-step-key="waiting-effective"]');
  const panel = arrivalStep.getByRole('region', { name: '确认到岗', exact: true });
  await expect(panel).toBeVisible();
  await expect(arrivalStep).toHaveAttribute('aria-current', 'step');
  await expect(panel.getByRole('button', { name: '确认到岗', exact: true })).toBeEnabled();
  const appearance = await panel.evaluate(element => {
    const css = getComputedStyle(element);
    return { border: parseFloat(css.borderLeftWidth), background: css.backgroundColor };
  });
  expect(appearance.border).toBeGreaterThanOrEqual(2);
  expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');

  for (const offset of [-2, -1]) {
    await panel.getByRole('button', { name: '修改到岗日期', exact: true }).click();
    await fillDate(panel.locator('.el-date-editor input'), day(offset));
    const revising = responseFor(page, 'PATCH', `/employee-archives/applications/${application.id}/arrival-date`);
    await panel.getByRole('button', { name: '提交日期变更', exact: true }).click();
    expect((await revising).status()).toBe(200);
    await expect(review.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
    await approve(page, review, application.id);
    await expect(panel).toBeVisible();
  }

  await expect(review.getByRole('heading', { name: '补充办理记录' })).toHaveCount(0);
  const revisions = timeline.locator('[data-event-action="revise_employee_arrival_date"]');
  await expect(revisions).toHaveCount(2);
  await expect(revisions.first().locator('.personnel-process-timeline__avatar')).toHaveCount(1);
  await expect(revisions.first()).toContainText('修改到岗日期并重新提交');
  const audit = await read(page, `/employee-archives/applications/${application.id}`);
  const events = audit.events.filter((event: { action: string }) => ['approve_employee_data_change', 'revise_employee_arrival_date'].includes(event.action));
  expect(events).toHaveLength(5);
  await expect(timeline.locator('[data-event-id]')).toHaveCount(audit.events.filter((event: { action: string }) => !/draft/.test(event.action)).length);
  for (const event of events) await expect(timeline.locator(`[data-event-id="${event.id}"]`)).toHaveCount(1);
  const timestamps = await timeline.locator(':scope > li[data-occurred-at]').evaluateAll(nodes => nodes.map(node => Date.parse(node.getAttribute('data-occurred-at')!)));
  expect(timestamps.length).toBeGreaterThanOrEqual(6);
  expect(timestamps.every(Number.isFinite)).toBe(true);
  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  const orderedActions = await timeline.locator('[data-event-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-event-action')));
  expect(orderedActions.filter(action => ['approve_employee_data_change', 'revise_employee_arrival_date'].includes(action!)))
    .toEqual(['approve_employee_data_change', 'revise_employee_arrival_date', 'approve_employee_data_change', 'revise_employee_arrival_date', 'approve_employee_data_change']);
  await expect(page.locator('.el-message:visible')).toHaveCount(0);
  await timeline.locator(':scope > li').first().scrollIntoViewIfNeeded();
  await screenshot(page, info, 'process-history', review);
  await panel.scrollIntoViewIfNeeded();
  await screenshot(page, info, 'arrival-step-action', review);
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 768 });
    await panel.scrollIntoViewIfNeeded();
    await screenshot(page, info, 'arrival-step-action-compact', review);
  }
  await arrive(page, review, application.id);
  await expect(panel).toHaveCount(0);
  await expect(timeline.locator('[data-step-key="waiting-effective"]')).toContainText('已完成');
  await expect(timeline.locator('[data-step-key="effective"]')).toContainText('已生效');
});

test('cancelled pending arrival restores the original identity and requires review again', async ({ page }, info) => {
  await login(page);
  const candidate = await createTalent(page, info);
  const application = await onboardFromTalent(page, info, candidate);
  const review = await openApplication(page, info, candidate, application.id);
  const pending = await approve(page, review, application.id);
  await review.getByRole('button', { name: '取消本次入职', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: '取消本次入职', exact: true });
  await prompt.getByRole('textbox').fill('虚构取消后恢复回归');
  const cancelled = responseFor(page, 'POST', `/employee-archives/applications/${application.id}/cancel`);
  await prompt.getByRole('button', { name: '确认取消', exact: true }).click();
  const cancelResponse = await cancelled;
  expect(cancelResponse.status()).toBe(201);
  const cancelledBody = (await cancelResponse.json()).data;
  const latest = await read(page, `/employee-archives/applications/${application.id}`);
  const me = await read(page, '/auth/me');
  const fields = (value: any) => Object.fromEntries(['id', 'userId', 'intakeType', 'onboardingStatus', 'recordStatus', 'requiresArrivalConfirmation', 'profileReviewStatus', 'canResume', 'cancelledAt', 'archivedAt', 'arrivalConfirmedAt', 'arrivalDate', 'arrivalConfirmedById'].map(key => [key, value[key]]));
  const evidence = { cancelResponse: fields(cancelledBody), persisted: fields(latest), role: { sysRole: me.sysRole, hrCapabilities: me.hrCapabilities } };
  const evidencePath = info.outputPath('cancel-restore-state.json');
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  await info.attach('cancel-restore-state', { path: evidencePath, contentType: 'application/json' });
  await expect(review).toContainText('已取消');
  await expect(review.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
  await expect(review.getByRole('button', { name: '重新办理入职', exact: true })).toBeVisible();
  await review.getByRole('button', { name: '重新办理入职', exact: true }).click();
  const restored = responseFor(page, 'PATCH', `/employee-archives/applications/${application.id}/arrival-date`);
  await review.getByRole('button', { name: '重新提交审核', exact: true }).click();
  expect((await restored).status()).toBe(200);
  await expect(review.getByRole('button', { name: '通过', exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: '确认到岗', exact: true })).toHaveCount(0);
  const timeline = review.getByTestId('personnel-application-timeline');
  await expect(review.getByRole('heading', { name: '补充办理记录' })).toHaveCount(0);
  await expect(timeline.getByText('取消申请', { exact: true })).toHaveCount(1);
  await expect(timeline.getByText('恢复入职并重新提交', { exact: true })).toHaveCount(1);
  await screenshot(page, info, 'restored-awaiting-review', review);
  const restoredPending = await approve(page, review, application.id);
  expect(restoredPending.userId).toBe(pending.userId);
  await arrive(page, review, application.id);
  const persisted = await read(page, `/employee-archives/${pending.userId}`);
  expect(persisted.employmentHistory).toHaveLength(1);
});

test('rapid duplicate submit creates only one onboarding application', async ({ page }, info) => {
  await login(page);
  const candidate = await createTalent(page, info);
  const application = await onboardFromTalent(page, info, candidate, true);
  await openApplication(page, info, candidate, application.id);
  const persisted = await read(page, `/employee-archives/applications/list?keyword=${encodeURIComponent(candidate.name)}&pageSize=100`);
  expect(persisted.items.filter((row: any) => row.talentCandidateId === candidate.id && row.recordStatus !== 'draft')).toHaveLength(1);
  const submissions = observations.get(page)!.writes.filter(row => row.method === 'POST' && row.path === '/api/v1/employee-archives');
  expect(submissions.filter(row => row.status === 201)).toHaveLength(1);
  expect(submissions.every(row => row.status === 201 || row.status === 409)).toBe(true);
});

test('ordinary employee cannot enter personnel maintenance pages', async ({ page }, info) => {
  await login(page, 'EMP001');
  for (const route of ['/talents', '/entry-exit', '/users']) {
    await page.goto(`${origin}${route}`);
    await expect(page).not.toHaveURL(`${origin}${route}`);
    await expect(page.getByRole('button', { name: /^(新增人才|办理入职|办理离职|确认到岗|通过)$/ })).toHaveCount(0);
  }
  const token = await page.evaluate(() => localStorage.getItem('token'));
  for (const path of ['/talents', '/employee-archives/applications/list']) {
    const response = await page.request.get(`${origin}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status()).toBe(403);
  }
  await screenshot(page, info, 'employee-personnel-denied');
  expect(observations.get(page)!.writes.filter(row => row.path !== '/api/v1/auth/test-login')).toEqual([]);
});
