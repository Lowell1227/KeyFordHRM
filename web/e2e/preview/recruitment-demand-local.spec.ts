import { test, expect, type APIResponse, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });
const origin = 'http://localhost:5173';
type Actor = { id: string; name: string; token: string };
type Fixture = { prefix: string; department: { id: string; name: string }; position: { id: string; name: string; code: string };
  education: { id: string; name: string }; actors: Record<'operator' | 'reviewer' | 'confirmer' | 'viewer' | 'outsider' | 'dual', Actor> };
type Demand = { id: string; revision: number; sourceKind: string; sourceState: string; instanceId: string | null;
  usable: boolean; requestedHeadcount: number; approvedHeadcount: number | null; allowedActions: string[];
  submittedById: string | null; approvedById: string | null; occupiedCount: number; acceptedCount: number;
  events?: Array<{ action: string; revision: number; reason: string | null }> };
type Application = { id: string; candidateId: string; revision: number; stage: string; recruitmentDemandId: string | null;
  hiringRequestedById: string | null; hiringReviewedById: string | null; recruitmentDemandSnapshot: unknown };
type Fingerprint = { month: string; count: number; sha256: string };

function previewNode<T>(body: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client');
      const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
      const fixtures = require('./test/talent-core/recruitment-demand-preview.cjs');
      (async()=>{ await fixtures.assertFictionalDatabase(db); ${body} })()
        .catch(()=>{process.exitCode=1;}).finally(()=>db.$disconnect());`,
    }));
  } catch { throw new Error('Guarded local recruitment fixture failed; credential-bearing output suppressed'); }
}
const payrollFingerprint = () => previewNode<Fingerprint>('console.log(JSON.stringify(await fixtures.payrollPreviewFingerprint(db)));');

async function as(page: Page, actor: Actor, path = '/recruitment/demands') {
  await page.goto('/login');
  await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
function response(page: Page, method: string, path: string, action?: string) {
  return page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1' + path
    && result.request().method() === method && (!action || result.request().postDataJSON()?.action === action));
}
async function json<T>(result: Pick<APIResponse, 'status' | 'url' | 'json'>, status: number): Promise<T> {
  expect(result.status(), new URL(result.url()).pathname).toBe(status);
  const envelope = await result.json(); expect(envelope.code).toBe(0); return envelope.data as T;
}
async function api(page: Page, actor: Actor, method: string, path: string, data?: unknown) {
  return page.request.fetch(origin + '/api/v1' + path, { method, headers: { authorization: `Bearer ${actor.token}` }, data, timeout: 60000 });
}
function field(page: Page, scope: Locator, label: string) {
  return scope.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
}
async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>('body *')].filter(element => element.getClientRects().length
      && element.getBoundingClientRect().right > innerWidth + 1).slice(0, 25).map(element => ({ tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '', right: element.getBoundingClientRect().right,
      width: element.getBoundingClientRect().width, scroll: element.scrollWidth, client: element.clientWidth })) }));
  await info.attach(name + '-layout', { body: JSON.stringify(layout), contentType: 'application/json' });
  await writeFile(info.outputPath(name + '-layout.json'), JSON.stringify(layout, null, 2));
  expect(layout.document <= layout.viewport, `${name}: page overflow`).toBe(true);
  for (const scope of await page.locator('.el-drawer__body:visible, .el-dialog__body:visible').all()) {
    expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: dialog overflow`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, animations: 'disabled' });
}
async function openDemand(page: Page, f: Fixture, mobile: boolean) {
  const keyword = page.getByPlaceholder('部门、岗位或单号', { exact: true });
  await keyword.fill(f.prefix);
  const listed = response(page, 'GET', '/recruitment-demands');
  await page.getByRole('button', { name: '查询', exact: true }).click(); await listed;
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: f.position.name }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: mobile ? '查看需求' : '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toContainText('HRM录入');
  for (const label of ['刷新钉钉原单', '核对部门、岗位和人数']) await expect(detail.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await expect(detail.getByRole('link', { name: '查看钉钉原单', exact: true })).toHaveCount(0);
  return detail;
}
async function localAction(page: Page, demand: Demand, action: string, label: string, reason?: string) {
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await detail.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  if (reason !== undefined) await dialog.locator('textarea').fill(reason);
  const saved = response(page, 'POST', `/recruitment-demands/${demand.id}/local-actions`, action);
  const history = response(page, 'GET', `/recruitment-demands/${demand.id}`);
  await dialog.getByRole('button', { name: label, exact: true }).click();
  const row = await json<Demand>(await saved, 201);
  await history;
  await expect(dialog).not.toBeVisible();
  await expect(detail.locator('section[aria-label="需求时间线"]')).toContainText(`版本 ${row.revision}`);
  return row;
}
async function abandon(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function createCandidateAndApplication(page: Page, f: Fixture, mobile: boolean) {
  await as(page, f.actors.dual, '/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const talent = page.locator('.talent-form'), name = `虚构${f.prefix}_系统需求候选人`;
  await talent.getByPlaceholder('候选人姓名').fill(name);
  await talent.getByPlaceholder('11 位手机号').fill(`170${randomInt(10000000, 100000000)}`);
  await page.getByTestId('talent-form-source').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  await field(page, talent, '学历').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.education.name, exact: true }).click();
  const created = response(page, 'POST', '/talents');
  await page.getByRole('button', { name: '加入人才库', exact: true }).click();
  const candidate = await json<{ id: string }>(await created, 201);
  const search = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await search.fill(name); await search.press('Enter');
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  if (mobile) await row.getByRole('button', { name: '打开详情', exact: true }).click();
  else await row.getByText(name, { exact: true }).click();
  const panel = page.locator('.talent-detail-drawer .application-panel');
  await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
  const form = panel.locator('.application-panel__form');
  await form.getByLabel('岗位名称', { exact: true }).fill(f.position.name);
  await form.getByLabel('招聘批次', { exact: true }).fill(f.prefix);
  await field(page, form, '部门（选填）').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.department.name, exact: true }).click();
  const applied = response(page, 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`);
  await form.getByRole('button', { name: '保存应聘', exact: true }).click();
  const application = await json<Application>(await applied, 201);
  expect(application.stage).toBe('screening'); expect(application.recruitmentDemandId).toBeNull();
  return { candidate, application, name };
}

test('system demand UI: independent return/approval, hiring confirmation and acceptance use real HTTP/PG', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  const mobile = info.project.name === 'mobile';
  await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900 });
  const before = payrollFingerprint(); expect(before.count).toBe(32);
  const prefix = `RDL_${mobile ? 'm' : 'd'}_${randomUUID().slice(0, 8)}`;
  const f = previewNode<Fixture>(`console.log(JSON.stringify(await fixtures.createLocalFixture(db, ${JSON.stringify(prefix)})));`);
  const errors: string[] = [], externalCalls: string[] = [], reviewerRequests: string[] = [], confirmerRequests: string[] = [];
  let phase = 'create', stage = 'preview_guard', passed = false;
  const proof: Record<string, unknown> = { prefix, viewport: page.viewportSize(), realNestHttp: true, realPostgreSQL: true,
    routeMocks: false, primaryWorkflow: 'UI only', payrollBefore: before, cases: [] as string[] };
  const pass = (name: string) => (proof.cases as string[]).push(name);
  page.context().on('page', target => target.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  page.context().on('request', request => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) externalCalls.push(`${request.method()} ${url.hostname}${url.pathname}`);
    if (phase === 'review') reviewerRequests.push(url.pathname);
    if (phase === 'confirm') confirmerRequests.push(url.pathname);
  });
  let other: Page | undefined;
  try {
    stage = 'create_draft';
    await as(page, f.actors.operator);
    await page.getByRole('button', { name: '新建招聘需求', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: '新建招聘需求', exact: true });
    await createDialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(createDialog.getByText('请选择有效的 HRM 部门', { exact: true })).toBeVisible();
    for (const [label, option] of [['申请部门', f.department.name], ['申请岗位', f.position.name]]) {
      await createDialog.getByRole('combobox', { name: label, exact: true }).press('ArrowDown');
      const choice = page.getByRole('option', { name: option, exact: true });
      await expect(choice).toBeVisible();
      expect(await choice.evaluate(element => {
        const rect = element.closest('.el-select__popper')!.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= innerWidth + 1;
      }), `${label}: open options must fit the viewport`).toBe(true);
      await choice.click();
    }
    await createDialog.getByRole('spinbutton', { name: '申请人数', exact: true }).fill('2');
    await createDialog.getByRole('textbox', { name: '招聘原因', exact: true }).fill(`虚构${prefix}首版招聘申请依据`);
    await capture(page, info, '01-system-demand-create-form');
    const created = response(page, 'POST', '/recruitment-demands/local');
    await createDialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    const createdResponse = await created;
    let demand = await json<Demand>(createdResponse, 201);
    proof.demandId = demand.id;
    expect(demand).toMatchObject({ sourceKind: 'local', sourceState: 'draft', instanceId: null, usable: false });
    await expect(createDialog).not.toBeVisible();
    const repeated = await json<Demand>(await api(page, f.actors.operator, 'POST', '/recruitment-demands/local', createdResponse.request().postDataJSON()), 201);
    expect(repeated.id).toBe(demand.id); expect(repeated.revision).toBe(demand.revision);
    const duplicates = previewNode<number>(`console.log(await db.recruitmentDemand.count({where:{sourceKind:'local',createdById:${JSON.stringify(f.actors.operator.id)}}}));`);
    expect(duplicates).toBe(1); pass('actual_UI_create_with_direct_same_request_retry_one_record');

    stage = 'stale_version_preserves_form';
    const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
    await expect(detail).toContainText('HRM录入');
    for (const label of ['刷新钉钉原单', '核对部门、岗位和人数']) await expect(detail.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: '修改需求', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '修改招聘需求', exact: true });
    const preserved = `虚构${prefix}旧页面未保存输入必须保留`;
    await editor.getByRole('textbox', { name: '招聘原因', exact: true }).fill(preserved);
    await editor.getByRole('spinbutton', { name: '申请人数', exact: true }).fill('3');
    other = await page.context().newPage();
    await as(other, f.actors.operator); const otherDetail = await openDemand(other, f, mobile);
    await otherDetail.getByRole('button', { name: '修改需求', exact: true }).click();
    const otherEditor = other.getByRole('dialog', { name: '修改招聘需求', exact: true });
    await otherEditor.getByRole('textbox', { name: '招聘原因', exact: true }).fill(`虚构${prefix}另一窗口已保存的依据`);
    const changed = response(other, 'PATCH', `/recruitment-demands/${demand.id}/local`);
    await otherEditor.getByRole('button', { name: '保存草稿', exact: true }).click();
    demand = await json<Demand>(await changed, 200); await expect(otherEditor).not.toBeVisible();
    const stale = response(page, 'PATCH', `/recruitment-demands/${demand.id}/local`);
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await stale).status()).toBe(409);
    await expect(editor.getByRole('textbox', { name: '招聘原因', exact: true })).toHaveValue(preserved);
    await expect(editor.getByRole('spinbutton', { name: '申请人数', exact: true })).toHaveValue('3');
    await expect(field(page, editor, '申请部门')).toContainText(f.department.name);
    await expect(field(page, editor, '申请岗位')).toContainText(f.position.name);
    await expect(editor.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    await capture(page, info, '02-real-stale-version-input-retained');
    await editor.getByRole('button', { name: '刷新详情，保留输入', exact: true }).click();
    await expect(editor.getByRole('textbox', { name: '招聘原因', exact: true })).toHaveValue(preserved);
    await abandon(page, editor); await other.close(); other = undefined;
    pass('second_UI_editor_generates_actual_409_and_preserves_all_local_input');

    stage = 'ordinary_editor_submits_for_review';
    demand = await localAction(page, demand, 'submit', '提交审核');
    expect(demand.submittedById).toBe(f.actors.operator.id);
    await expect(detail.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0);
    const denied = await api(page, f.actors.operator, 'POST', `/recruitment-demands/${demand.id}/local-actions`,
      { expectedRevision: demand.revision, action: 'approve' }); expect(denied.status()).toBe(403);
    await capture(page, info, '03-submitted-by-ordinary-editor'); pass('ordinary_editor_cannot_approve_without_demand_review_capability');

    stage = 'independent_return'; phase = 'review';
    await as(page, f.actors.reviewer); const reviewerDetail = await openDemand(page, f, mobile);
    for (const label of ['新建招聘需求', '同步钉钉需求']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await expect(reviewerDetail.getByRole('button', { name: '修改需求', exact: true })).toHaveCount(0);
    await reviewerDetail.getByRole('button', { name: '退回修改', exact: true }).click();
    const returnDialog = page.getByRole('dialog', { name: '退回修改', exact: true });
    await returnDialog.getByRole('button', { name: '退回修改', exact: true }).click();
    await expect(returnDialog.locator('.el-form-item__error')).toHaveText('请填写原因');
    const reason = `虚构${prefix}请补充岗位招聘原因`;
    await returnDialog.locator('textarea').fill(reason);
    const returned = response(page, 'POST', `/recruitment-demands/${demand.id}/local-actions`, 'return');
    await returnDialog.getByRole('button', { name: '退回修改', exact: true }).click();
    demand = await json<Demand>(await returned, 201); await expect(returnDialog).not.toBeVisible();
    await expect(reviewerDetail.getByRole('region', { name: '需求时间线' })).toContainText(reason);
    await capture(page, info, '04-independent-return-with-reason');
    phase = 'operator';
    expect(reviewerRequests.filter(path => /^\/api\/v1\/(?:talents(?:\/|$)|talent-recruitment(?:\/|$))/.test(path))).toEqual([]);
    expect(reviewerRequests.filter(path => /\/recruitment-demands\/[^/]+\/applications$/.test(path))).toEqual([]);
    expect((await api(page, f.actors.reviewer, 'GET', '/talents')).status()).toBe(403);
    pass('demand_only_reviewer_returns_reason_without_global_talent_read');

    stage = 'edit_resubmit_independent_approve';
    await as(page, f.actors.operator); const returnedDetail = await openDemand(page, f, mobile);
    await returnedDetail.getByRole('button', { name: '修改需求', exact: true }).click();
    const resubmitEditor = page.getByRole('dialog', { name: '修改招聘需求', exact: true });
    await resubmitEditor.getByRole('textbox', { name: '招聘原因', exact: true }).fill(`虚构${prefix}补齐后重新提交的业务依据`);
    const edited = response(page, 'PATCH', `/recruitment-demands/${demand.id}/local`);
    await resubmitEditor.getByRole('button', { name: '保存草稿', exact: true }).click();
    demand = await json<Demand>(await edited, 200); await expect(resubmitEditor).not.toBeVisible();
    demand = await localAction(page, demand, 'submit', '提交审核');
    await as(page, f.actors.reviewer); await openDemand(page, f, mobile);
    demand = await localAction(page, demand, 'approve', '审核通过', '虚构独立需求审核通过');
    expect(demand).toMatchObject({ sourceState: 'approved', usable: true, approvedHeadcount: 2, approvedById: f.actors.reviewer.id });
    expect(demand.approvedById).not.toBe(demand.submittedById);
    await capture(page, info, '05-independently-approved-system-demand'); pass('UI_return_edit_resubmit_and_independent_approve');

    stage = 'readonly_and_direct403';
    await as(page, f.actors.viewer); const readonly = await openDemand(page, f, mobile);
    for (const label of ['修改需求', '审核通过', '提交审核', '撤销需求', '退回修改']) await expect(readonly.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建招聘需求', exact: true })).toHaveCount(0);
    expect((await api(page, f.actors.viewer, 'PATCH', `/recruitment-demands/${demand.id}/local`,
      { expectedRevision: demand.revision, deptId: f.department.id, positionId: f.position.id, headcount: 9, reason: '虚构无权修改' })).status()).toBe(403);
    expect((await api(page, f.actors.outsider, 'GET', `/recruitment-demands/${demand.id}`)).status()).toBe(403);
    await capture(page, info, '06-readonly-demand'); pass('readonly_controls_absent_and_direct_forbidden');

    stage = 'candidate_creation_and_choose_system_demand';
    const { candidate, application, name } = await createCandidateAndApplication(page, f, mobile);
    proof.candidateId = candidate.id; proof.applicationId = application.id;
    const panel = page.locator('.application-panel');
    await panel.getByRole('button', { name: '提交录用', exact: true }).click();
    const command = panel.locator('.application-panel__command');
    await command.locator('textarea').fill(`虚构${prefix}独立录用意见`);
    const options = response(page, 'GET', '/recruitment-demands/options');
    await command.getByRole('combobox', { name: '招聘需求单', exact: true }).fill(prefix); await options;
    const option = page.getByRole('option').filter({ hasText: demand.id });
    await expect(option).toContainText('系统需求'); await option.click();
    const submitted = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'submit_hiring');
    await command.getByRole('button', { name: '提交录用', exact: true }).click();
    let hiring = await json<Application>(await submitted, 201);
    expect(hiring).toMatchObject({ stage: 'hiring_review', recruitmentDemandId: demand.id, hiringRequestedById: f.actors.dual.id });
    expect(hiring.recruitmentDemandSnapshot).toMatchObject({ demandId: demand.id, instanceId: null, approvedHeadcount: 2, sourceKind: 'local' });
    await expect(panel.locator('.demand-summary')).toContainText('HRM录入');
    await capture(page, info, '07-approved-system-demand-selected-in-original-application');
    expect((await api(page, f.actors.dual, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`,
      { action: 'approve_hiring', expectedRevision: hiring.revision })).status()).toBe(403);
    expect((await api(page, f.actors.reviewer, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`,
      { action: 'approve_hiring', expectedRevision: hiring.revision })).status()).toBe(403);
    pass('UI_approved_local_demand_selection_and_distinct_hiring_confirmation_boundary');

    stage = 'original_hiring_confirmation'; phase = 'confirm';
    await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${hiring.id}`);
    const review = page.locator('.hiring-review__detail');
    await expect(review.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(review.locator('.demand-summary')).toContainText('HRM录入');
    await expect(review.locator('.demand-summary')).toContainText(demand.id);
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    const confirmed = response(page, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`, 'approve_hiring');
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    hiring = await json<Application>(await confirmed, 201);
    expect(hiring).toMatchObject({ stage: 'offered', hiringReviewedById: f.actors.confirmer.id });
    expect(hiring.hiringReviewedById).not.toBe(hiring.hiringRequestedById);
    await capture(page, info, '08-original-independent-hiring-confirmation'); phase = 'operator';
    expect(confirmerRequests.filter(path => path.startsWith('/api/v1/recruitment-demands'))).toEqual([]);

    stage = 'acceptance_occupies_seat';
    await as(page, f.actors.dual, `/talents?candidateId=${candidate.id}&applicationId=${hiring.id}`);
    const acceptedPanel = page.locator('.application-panel');
    await acceptedPanel.getByRole('button', { name: '候选人接受', exact: true }).click();
    const accepted = response(page, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`, 'accept_offer');
    await acceptedPanel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click();
    hiring = await json<Application>(await accepted, 201); expect(hiring.stage).toBe('accepted');
    const occupied = await json<Demand>(await api(page, f.actors.dual, 'GET', `/recruitment-demands/${demand.id}`), 200);
    expect(occupied).toMatchObject({ occupiedCount: 1, acceptedCount: 1 });
    await expect(acceptedPanel.getByRole('button', { name: '办理入职', exact: true })).toHaveCount(0);
    await capture(page, info, '09-acceptance-occupancy-legacy-onboarding-boundary');
    proof.seats = { occupiedCount: occupied.occupiedCount, acceptedCount: occupied.acceptedCount };
    pass('original_hiring_confirmation_and_acceptance_occupancy_without_onboarding_expansion');
    expect(errors).toEqual([]); expect(externalCalls).toEqual([]); passed = true;
  } finally {
    if (other) await other.close();
    proof.passed = passed; proof.lastStage = stage; proof.pageErrors = errors; proof.externalCalls = externalCalls;
    try {
      // Only this prefix's actor-created demands are withdrawn; payroll and other workers' fixtures are not touched.
      const rows = previewNode<Array<{ id: string }>>(`console.log(JSON.stringify(await db.recruitmentDemand.findMany({
        where:{sourceKind:'local',createdById:{in:${JSON.stringify(Object.values(f.actors).map(actor => actor.id))}}},select:{id:true}})));`);
      for (const row of rows) {
        const current = await json<Demand>(await api(page, f.actors.operator, 'GET', '/recruitment-demands/' + row.id), 200);
        if (current.sourceState !== 'withdrawn') await json<Demand>(await api(page, f.actors.operator, 'POST', `/recruitment-demands/${row.id}/local-actions`,
          { action: 'withdraw', expectedRevision: current.revision, reason: '虚构测试结束，只撤回本轮测试需求' }), 201);
      }
      proof.cleanup = previewNode(`console.log(JSON.stringify(await fixtures.archiveLocalFixture(db, ${JSON.stringify(prefix)})));`);
      expect(proof.cleanup).toMatchObject({ activeActors: 0, activeCandidates: 0, activeDemands: 0 });
      proof.payrollAfter = payrollFingerprint(); expect(proof.payrollAfter).toEqual(before);
    } finally { await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2)); }
  }
});
