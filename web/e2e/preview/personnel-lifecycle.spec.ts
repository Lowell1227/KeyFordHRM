import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const origin = 'http://localhost:5173';
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
      await drawer.locator('[data-archive-field="employee.deptId"] .el-select').click();
      await page.getByRole('treeitem').filter({ hasText: '预览业务部' }).click();
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
  expect(request.talentCandidateId).toBe(candidate.id);
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
  const activeBody = await (await active).json();
  const probationBody = await (await probation).json();
  await expect(page.locator('.el-select-dropdown:visible')).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: /EMP001/ })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: participant.employeeNo })).toBeVisible();
  await expect(page.locator('.el-select-dropdown:visible')).not.toContainText('加载中');
  await page.getByRole('option').filter({ hasText: /EMP001/ }).scrollIntoViewIfNeeded();
  await page.getByRole('option').filter({ hasText: participant.employeeNo }).evaluate(element => element.scrollIntoView({ block: 'nearest' }));
  await expect(page.getByRole('option').filter({ hasText: /EMP001/ })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('option').filter({ hasText: participant.employeeNo })).toBeInViewport({ ratio: 1 });
  await evidence(info, 'participant-selector', {
    candidateId: candidate.id, active: activeBody.data?.items?.map((u: any) => ({ id: u.id, employeeNo: u.employeeNo, status: u.status, archivedAt: u.archivedAt })),
    probation: probationBody.data?.items?.map((u: any) => ({ id: u.id, employeeNo: u.employeeNo, status: u.status, archivedAt: u.archivedAt })),
    options: await page.getByRole('option').filter({ visible: true }).allTextContents(),
  });
  await page.screenshot({ path: info.outputPath('participant-selector.png'), fullPage: true, animations: 'disabled', scale: 'css' });
  await page.getByRole('option').filter({ hasText: /EMP001/ }).click();
  await page.getByRole('option').filter({ hasText: participant.employeeNo }).click();
  await page.keyboard.press('Escape');
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
