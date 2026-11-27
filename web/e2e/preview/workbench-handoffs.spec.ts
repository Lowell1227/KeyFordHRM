import { test, expect, type Page, type Response, type Locator, type BrowserContext } from '@playwright/test';
import { assertHandoffPreview, createHandoffFixture, removeHandoffFixture, handoffOrigin, type HandoffFixture } from './workbench-handoffs-fixture';

type WorkItem = { id: string; demandId?: string; applicationId?: string; onboardingRequestId?: string; title: string };
type WorkGroup = { key: string; total: number; items: WorkItem[] };
type List = { items: Array<{ id: string; title?: string; sourceState?: string; submittedById?: string }>; total: number; page: number; pageSize: number };

test.setTimeout(180000);
let fixture: HandoffFixture;
let ownsFixture = false;
let external: string[];
let errors: string[];
let requests: Array<{ method: string; path: string; status: number }>;

async function guardBrowser(context: BrowserContext) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === handoffOrigin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    external.push(url.origin); await route.abort('blockedbyclient');
  });
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/')) requests.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
}

test.beforeEach(async ({ context }, info) => {
  ownsFixture = false;
  external = []; errors = []; requests = [];
  assertHandoffPreview(info);
  fixture = createHandoffFixture();
  ownsFixture = true;
  await guardBrowser(context);
});
test.afterEach(async ({}, info) => {
  await info.attach('handoff-http-evidence', { body: JSON.stringify({ requests, external, errors }, null, 2), contentType: 'application/json' });
  try { expect(external, 'External requests are forbidden').toEqual([]); expect(errors).toEqual([]); }
  finally { if (ownsFixture) removeHandoffFixture(fixture); }
});

async function login(page: Page, actor: 'personnel' | 'owner' | 'reviewer') {
  await page.addInitScript(({ token }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('expiresAt', String(Date.now() + 20 * 60 * 1000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, { token: fixture[actor].token });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function read(page: Page, path: string, status = 200) {
  const response = await page.request.get(`/api/v1${path}`, { headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` } });
  expect(response.status(), path).toBe(status);
  return status === 200 ? (await response.json()).data : undefined;
}
function responseFor(page: Page, path: string, params: Record<string, string> = {}) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1${path}` && response.request().method() === 'GET'
      && Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}
async function data<T>(response: Promise<Response>): Promise<T> {
  const result = await response; expect(result.ok()).toBe(true); return (await result.json()).data;
}
async function workbench(page: Page, key: string, tab: string) {
  const payload = await read(page, '/talent-recruitment/workbench') as { groups: WorkGroup[] };
  const group = payload.groups.find(row => row.key === key);
  expect(group, key).toBeDefined();
  const section = page.getByTestId('dashboard-recruitment');
  await expect(section).toHaveAttribute('aria-busy', 'false');
  const toggle = section.getByRole('button', { name: /招聘事项/ }).first();
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await section.getByRole('tab', { name: new RegExp(`^${tab} `) }).click();
  const panel = section.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  return { section, panel, group: group! };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function pageTwo(page: Page, scope: Locator, endpoint: string, params: Record<string, string>, queryKey: string) {
  const next = responseFor(page, endpoint, { ...params, page: '2', pageSize: '20' });
  await scope.locator('.btn-next').click();
  const result = await data<List>(next);
  expect(result.page).toBe(2); expect(result.pageSize).toBe(20); expect(result.total).toBeGreaterThan(20);
  expect(result.items.length).toBeGreaterThan(0);
  await expect.poll(() => new URL(page.url()).searchParams.get(queryKey)).toBe('2');
  for (const [key, value] of Object.entries(params)) {
    if (key === 'workQueue') expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  }
  const restored = responseFor(page, endpoint, { ...params, page: '2', pageSize: '20' });
  await page.reload();
  expect((await data<List>(restored)).items.map(row => row.id)).toEqual(result.items.map(row => row.id));
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  await noOverflow(page);
  return result;
}
async function localAction(page: Page, action: 'return' | 'submit', demandId: string) {
  const label = action === 'return' ? '退回修改' : '提交审核';
  await page.getByRole('dialog', { name: '招聘需求详情', exact: true }).getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(`${fixture.prefix}_fictional_${action}`);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/recruitment-demands/${demandId}/local-actions` && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
}

test('personnel receives another recruiter\'s accepted application, opens the original intake, and retains the full-list page', async ({ page }, info) => {
  await login(page, 'personnel');
  const me = await read(page, '/auth/me');
  expect(me.hrCapabilities).toEqual(['employee_archive_edit']);
  const first = fixture.candidates[0];
  const handoff = await workbench(page, 'onboarding_handoff', '待人事接收');
  expect(handoff.group.total).toBeGreaterThanOrEqual(22);
  expect(handoff.group.items.some(row => row.applicationId === first.applicationId)).toBe(true);
  await handoff.panel.getByRole('button').filter({ hasText: first.name }).click();
  await expect(page).toHaveURL(/\/entry-exit\?/);
  expect(new URL(page.url()).searchParams.get('talentId')).toBe(first.id);
  expect(new URL(page.url()).searchParams.get('talentApplicationId')).toBe(first.applicationId);
  const intake = page.getByRole('dialog', { name: '办理入职', exact: true });
  await expect(intake).toBeVisible();
  await expect(intake.locator('[data-archive-field="employee.name"] input')).toHaveValue(first.name);
  // Existing policy and talent-permissions tests allow archive editors to read talent details.
  // Splitting that legacy capability needs a later business decision, not an E2E-driven policy change.
  const candidateResponse = await page.request.get(`/api/v1/talents/${first.id}`, { headers: { authorization: `Bearer ${fixture.personnel.token}` } });
  expect(candidateResponse.status(), 'Existing archive-editor talent-read compatibility').toBe(200);
  const candidate = (await candidateResponse.json()).data;
  expect(candidate.id).toBe(first.id);
  expect(candidate.ownerId).toBe(fixture.owner.id);
  expect((await read(page, '/auth/me')).hrCapabilities, 'Reception must not add any capability').toEqual(['employee_archive_edit']);
  await expect(intake.getByText('草稿已保存', { exact: true })).toBeVisible();
  await intake.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto('/dashboard');
  const after = await read(page, '/talent-recruitment/workbench') as { groups: WorkGroup[] };
  expect(after.groups.find(row => row.key === 'onboarding_handoff')!.items.some(row => row.applicationId === first.applicationId)).toBe(false);
  const full = await read(page, '/talent-recruitment/workbench/onboarding-handoff?page=1&pageSize=100') as List;
  expect(full.items.some(row => row.id === first.applicationId)).toBe(false);
  const overdue = await workbench(page, 'entry_overdue', '到岗日期已过待确认');
  const originalIndex = overdue.group.items.findIndex(row => row.onboardingRequestId === fixture.originalRequestId);
  expect(originalIndex).toBeGreaterThanOrEqual(0);
  await overdue.panel.getByRole('button').nth(originalIndex).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('requestId')).toBe(fixture.originalRequestId);
  await expect(page.getByRole('dialog').filter({ hasText: `${fixture.prefix}_original_intake` })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('original-intake.png'), fullPage: true });
  await page.goto('/dashboard');
  const all = await workbench(page, 'onboarding_handoff', '待人事接收');
  const listResponse = responseFor(page, '/talent-recruitment/workbench/onboarding-handoff');
  await all.section.getByRole('button', { name: '全部待接收', exact: true }).click();
  await data<List>(listResponse);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('handoff');
  const list = page.getByTestId('onboarding-handoff-list');
  await expect(list).toBeVisible();
  const second = await pageTwo(page, list, '/talent-recruitment/workbench/onboarding-handoff', {}, 'handoffPage');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('handoff');
  expect(second.items.some(row => fixture.candidates.some(candidate => candidate.applicationId === row.id))).toBe(true);
  await page.screenshot({ path: info.outputPath('handoff-page-two.png'), fullPage: true });
});

test('independent demand reviewer returns the original; only its submitter gets the returned task and resubmits through the original page', async ({ page, browser }, info) => {
  await login(page, 'reviewer');
  expect((await read(page, '/auth/me')).hrCapabilities).toEqual(['recruitment_demand_review']);
  await read(page, `/talents/${fixture.candidates[0].id}`, 403);
  await read(page, `/talent-recruitment/applications/${fixture.candidates[0].applicationId}`, 403);
  const own = await read(page, `/recruitment-demands/${fixture.selfDemandId}`);
  expect(own.allowedActions).not.toContain('approve'); expect(own.allowedActions).not.toContain('return');
  const selfReview = await page.request.post(`/api/v1/recruitment-demands/${fixture.selfDemandId}/local-actions`, {
    headers: { authorization: `Bearer ${fixture.reviewer.token}` }, data: { action: 'approve', expectedRevision: own.revision },
  });
  expect(selfReview.status()).toBe(403);
  const reviewQueue = await read(page, '/recruitment-demands?workQueue=review&pageSize=100') as List;
  expect(reviewQueue.items.some(row => row.id === fixture.selfDemandId)).toBe(false);
  expect(reviewQueue.items.every(row => row.sourceState === 'pending' && row.submittedById !== fixture.reviewer.id)).toBe(true);
  const review = await workbench(page, 'demand_review', '待审核招聘需求');
  const index = review.group.items.findIndex(row => fixture.pendingIds.includes(row.demandId!));
  expect(index).toBeGreaterThanOrEqual(0);
  const demandId = review.group.items[index].demandId!;
  await review.panel.getByRole('button').nth(index).click();
  await expect(page).toHaveURL(/\/recruitment\/demands\?/);
  expect(new URL(page.url()).searchParams.get('demandId')).toBe(demandId);
  expect(new URL(page.url()).searchParams.get('workQueue')).toBe('review');
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toContainText(fixture.positionName);
  await expect(detail.getByText('本岗位渠道转化', { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await localAction(page, 'return', demandId);
  await expect(detail).toContainText(`${fixture.prefix}_fictional_return`);
  expect((await read(page, '/recruitment-demands?workQueue=review&pageSize=100') as List).items.some(row => row.id === demandId)).toBe(false);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto('/dashboard');
  const remaining = await workbench(page, 'demand_review', '待审核招聘需求');
  expect(remaining.group.items.some(row => row.demandId === demandId)).toBe(false);
  const allResponse = responseFor(page, '/recruitment-demands', { workQueue: 'review' });
  await remaining.section.getByRole('button', { name: '全部需求', exact: true }).click();
  await data<List>(allResponse);
  await pageTwo(page, page.locator('.list-pagination'), '/recruitment-demands', { workQueue: 'review' }, 'page');
  await page.screenshot({ path: info.outputPath('review-page-two.png'), fullPage: true });

  // Find the reviewer's historical submission through the actual list, not a deep-link shortcut.
  const range = page.getByRole('combobox', { name: '招聘需求办理范围', exact: true });
  await range.focus(); await range.press('Enter');
  await expect(page.getByRole('option', { name: '全部需求', exact: true })).toBeVisible();
  await page.getByRole('option', { name: '全部需求', exact: true }).click();
  await page.getByPlaceholder('部门、岗位或单号', { exact: true }).fill(fixture.selfDemandId);
  const selfList = responseFor(page, '/recruitment-demands', { keyword: fixture.selfDemandId });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  expect((await data<List>(selfList)).items.map(row => row.id)).toEqual([fixture.selfDemandId]);
  await page.getByRole('button', { name: /^(查看|查看需求)$/ }).filter({ visible: true }).click();
  const selfDetail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(selfDetail).toContainText(fixture.selfDemandId);
  await expect(selfDetail.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0);
  await expect(selfDetail.getByRole('button', { name: '退回修改', exact: true })).toHaveCount(0);
  await selfDetail.getByRole('button', { name: '关闭', exact: true }).click();

  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = info.project.use;
  const ownerContext = await browser.newContext({ baseURL: handoffOrigin, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  await guardBrowser(ownerContext);
  const owner = await ownerContext.newPage();
  try {
  await login(owner, 'owner');
  expect((await read(owner, '/auth/me')).hrCapabilities).toEqual(['recruitment_edit']);
  const returned = await workbench(owner, 'demand_returned', '需求退回待修改');
  const returnedIndex = returned.group.items.findIndex(row => row.demandId === demandId);
  expect(returnedIndex).toBeGreaterThanOrEqual(0);
  await returned.panel.getByRole('button').nth(returnedIndex).click();
  await expect.poll(() => new URL(owner.url()).searchParams.get('demandId')).toBe(demandId);
  expect(new URL(owner.url()).searchParams.get('workQueue')).toBe('returned');
  const returnedDetail = owner.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(returnedDetail).toContainText(`${fixture.prefix}_fictional_return`);
  await expect(returnedDetail.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0);
  await localAction(owner, 'submit', demandId);
  expect((await read(owner, '/recruitment-demands?workQueue=returned&pageSize=100') as List).items.some(row => row.id === demandId)).toBe(false);
  expect((await read(page, '/recruitment-demands?workQueue=review&pageSize=100') as List).items.some(row => row.id === demandId)).toBe(true);
  await returnedDetail.getByRole('button', { name: '关闭', exact: true }).click();
  await owner.goto('/dashboard');
  const returnedRemaining = await workbench(owner, 'demand_returned', '需求退回待修改');
  expect(returnedRemaining.group.items.some(row => row.demandId === demandId)).toBe(false);
  const returnedAll = responseFor(owner, '/recruitment-demands', { workQueue: 'returned' });
  await returnedRemaining.section.getByRole('button', { name: '全部需求', exact: true }).click();
  await data<List>(returnedAll);
  const second = await pageTwo(owner, owner.locator('.list-pagination'), '/recruitment-demands', { workQueue: 'returned' }, 'page');
  expect(second.items.every(row => row.sourceState === 'rejected' && row.submittedById === fixture.owner.id)).toBe(true);
  await owner.screenshot({ path: info.outputPath('returned-page-two.png'), fullPage: true });
  await noOverflow(owner);
  } finally { await ownerContext.close(); }
});
