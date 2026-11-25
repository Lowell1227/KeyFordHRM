import { test, expect, type APIResponse, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import intakeFixtures from '../../../api/test/talent-core/recruitment-intake-fixtures.cjs';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });
const origin = 'http://localhost:5173';
type Actor = { id: string; name: string; token: string };
type Intake = { id: string; revision: number; state: string; ownerId: string; sourceNotes: string | null; nextFollowUpAt: string | null;
  positionName: string | null; demandId: string | null;
  candidateId: string | null; applicationId: string | null; associatedFromIds: string[]; parseStatus: string; candidateDraft: Record<string, unknown> | null;
  files: Array<{ id: string; fileName: string }>; mail: { messageId: string } | null };
type Application = { id: string; candidateId: string; stage: string; revision: number; recruitmentDemandId: string | null;
  recruitmentDemandSnapshot: unknown; hiringRequestedById: string | null; hiringReviewedById: string | null; offerTerminated?: boolean };
type Demand = { id: string; revision: number; occupiedCount: number };
type Fixture = { prefix: string; baseline: unknown; department: { id: string; name: string }; position: { id: string; name: string; code: string };
  secondPosition: { id: string; name: string; code: string }; education: { id: string; name: string };
  actors: Record<'operator' | 'dual' | 'reviewer' | 'confirmer' | 'viewer' | 'outsider' | 'assessor', Actor>;
  parserPlans: Array<{ marker: string; fields: { phone: string } }> };
const { resumePdf } = intakeFixtures as { resumePdf: (marker: string) => Buffer };

function previewNode<T>(body: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'], input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client'); const db=new PrismaClient({log:[],errorFormat:'minimal'});
      const fixtures=require('./test/talent-core/recruitment-intake-fixtures.cjs');
      (async()=>{await require('./test/talent-core/recruitment-demand-preview.cjs').assertFictionalDatabase(db);${body}})()
      .catch(()=>{process.exitCode=1;}).finally(()=>db.$disconnect());` }));
  } catch { throw new Error('Guarded intake fixture operation failed; credential-bearing output suppressed'); }
}
async function as(page: Page, actor: Actor, path: string) {
  await page.goto('/login');
  await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
function response(page: Page, method: string, path: string, action?: string) {
  return page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1' + path && result.request().method() === method
    && (!action || result.request().postDataJSON()?.action === action));
}
async function json<T>(result: Pick<APIResponse, 'status' | 'url' | 'json'>, status: number): Promise<T> {
  expect(result.status(), new URL(result.url()).pathname).toBe(status); const body = await result.json(); expect(body.code).toBe(0); return body.data as T;
}
async function api<T>(page: Page, actor: Actor, method: string, path: string, data?: unknown, status = 200): Promise<T> {
  return json<T>(await page.request.fetch(origin + '/api/v1' + path, { method, headers: { authorization: 'Bearer ' + actor.token }, data }), status);
}
const field = (page: Page, scope: Locator, label: string) => scope.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
async function choose(page: Page, select: Locator, label: string) {
  await select.press('Enter'); const option = page.getByRole('option', { name: label, exact: true });
  await expect(option).toBeVisible(); await option.click();
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`).toBe(true);
  for (const scope of await page.locator('.el-drawer__body:visible, .el-dialog__body:visible').all()) {
    expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: panel overflow`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, animations: 'disabled' });
}
async function demand(page: Page, f: Fixture, position: Fixture['position']) {
  let row = await api<Demand>(page, f.actors.operator, 'POST', '/recruitment-demands/local', { requestId: randomUUID(), deptId: f.department.id,
    positionId: position.id, headcount: 2, reason: `虚构${f.prefix}页面验收需求` }, 201);
  row = await api<Demand>(page, f.actors.operator, 'POST', `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'submit' }, 201);
  return api<Demand>(page, f.actors.reviewer, 'POST', `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'approve' }, 201);
}
async function start(page: Page, f: Fixture, mode: '登记待收简历' | '手工收件', demandId: string, name: string, phone?: string, position = f.position) {
  await page.goto('/recruitment/intakes?demandId=' + demandId);
  await page.getByRole('button', { name: mode, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: mode, exact: true });
  await expect(field(page, drawer, '内部需求')).toContainText(demandId);
  await expect(drawer.getByRole('textbox', { name: '收件意向岗位', exact: true })).toHaveValue(position.name);
  await choose(page, drawer.getByRole('combobox', { name: '实际来源', exact: true }), '招聘网站');
  await drawer.getByRole('textbox', { name: '候选人姓名', exact: true }).fill(name);
  if (phone) await drawer.getByRole('textbox', { name: '候选人手机号', exact: true }).fill(phone);
  await field(page, drawer, '学历').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.education.name, exact: true }).click();
  await drawer.getByRole('textbox', { name: '来源线索', exact: true }).fill(`虚构${f.prefix}允许用于本轮招聘核对的资料_${name}`);
  return drawer;
}
async function save(page: Page, row?: Intake) {
  const button = page.getByRole('dialog').filter({ visible: true }).last().getByRole('button', { name: '保存核对草稿', exact: true });
  await expect(button).toBeEnabled();
  const saved = response(page, row ? 'PATCH' : 'POST', '/recruitment-intakes' + (row ? '/' + row.id : ''));
  await button.click();
  const result = await json<Intake>(await saved, row ? 200 : 201);
  await expect(page.getByRole('dialog', { name: '简历收件详情', exact: true }).getByRole('button', { name: '保存核对草稿', exact: true })).toBeEnabled();
  return result;
}
async function open(page: Page, f: Fixture, mobile: boolean, text: string, keyword = f.prefix) {
  const filter = page.getByRole('textbox', { name: '岗位或来源线索', exact: true }); await filter.fill(keyword);
  const listed = response(page, 'GET', '/recruitment-intakes'); await page.getByRole('button', { name: '查询', exact: true }).click(); await listed;
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ visible: true }).filter({ hasText: text });
  await expect(row).toHaveCount(1); await row.getByRole('button', { name: '办理', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true }); await expect(drawer).toBeVisible(); return drawer;
}
async function parse(page: Page, row: Intake, name: string, expected: 'succeeded' | 'failed') {
  const drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  const terminal = page.waitForResponse(async result => new URL(result.url()).pathname === '/api/v1/recruitment-intakes/' + row.id
    && result.request().method() === 'GET' && (await result.json()).data?.parseStatus === expected, { timeout: 20000 });
  const started = response(page, 'POST', `/recruitment-intakes/${row.id}/parse`);
  await drawer.getByRole('button', { name: row.parseStatus === 'failed' ? '重试解析' : '解析简历', exact: true }).click();
  expect(await json<Intake>(await started, 201)).toMatchObject({ parseStatus: 'processing' });
  await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveValue(name);
  const current = await json<Intake>(await terminal, 200);
  await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveValue(name);
  await expect(drawer.getByRole('button', { name: '核对新版本并保留输入', exact: true })).toHaveCount(0);
  return current;
}

test('real intake pages retain sources, confirm both modes, reuse another job and preserve independent hiring', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  const mobile = info.project.name === 'mobile'; await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900 });
  const f = previewNode<Fixture>(`const f=await fixtures.createIntakeFixture(db, 'RDI_'+require('node:crypto').randomUUID().slice(0,8));
    const owner=await fixtures.configuration(db,f.prefix);owner.parserPlans[0].mode='fail_once';
    await db.systemConfig.update({where:{key:fixtures.namespace+f.prefix},data:{value:owner}}); console.log(JSON.stringify(f));`);
  const proof: Record<string, unknown> = { prefix: f.prefix, realNestHttp: true, realPostgres: true, realMinio: true, routeMocks: false,
    primaryIntakeWrites: 'UI only; approved demands and pre-existing follow-up/application are explicit fixture prerequisites', viewport: page.viewportSize(), cases: [] as string[] };
  const pass = (name: string) => (proof.cases as string[]).push(name);
  const errors: string[] = [], external: string[] = [], narrow: string[] = []; let confirmer = false, stage = 'fixture', passed = false;
  page.on('pageerror', error => errors.push(error.message));
  page.context().on('request', request => {
    const url = new URL(request.url()); if (!['http:', 'https:'].includes(url.protocol)) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) external.push(url.hostname + url.pathname);
    if (confirmer && /^\/api\/v1\/recruitment-(?:intakes|postings|demands)/.test(url.pathname)) narrow.push(url.pathname);
  });
  let other: Page | undefined;
  try {
    const firstDemand = await demand(page, f, f.position), secondDemand = await demand(page, f, f.secondPosition);
    for (const [letter, target] of [['A', firstDemand], ['B', secondDemand]] as const) await api(page, f.actors.operator, 'POST', '/recruitment-postings',
      { requestId: randomUUID(), demandId: target.id, channel: 'job_site', name: `虚构${f.prefix}外部职位${letter}`,
        externalId: f.prefix + '_job_' + letter, url: `https://example.invalid/${f.prefix}/job-${letter.toLowerCase()}`, verifiedIdentity: true,
        active: true, evidence: '虚构职位唯一身份已人工核对', ownerId: f.actors.operator.id }, 201);
    await as(page, f.actors.operator, '/recruitment/intakes');

    stage = 'awaiting_upload_parse_failure_and_retry';
    const personName = `虚构${f.prefix}_保留人工姓名`, firstPhone = `170${randomInt(10000000, 100000000)}`;
    let drawer = await start(page, f, '登记待收简历', firstDemand.id, personName, firstPhone);
    const follow = drawer.getByRole('combobox', { name: '下次跟进时间', exact: true });
    await follow.fill('2037-01-10 09:30:00'); await follow.press('Tab');
    let first = await save(page); expect(first.state).toBe('awaiting_resume'); expect(first.nextFollowUpAt).toBe('2037-01-10T01:30:00.000Z');
    drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
    await capture(page, info, '01-awaiting-resume-with-beijing-followup');
    const pdf = resumePdf(f.parserPlans[0].marker), uploaded = response(page, 'POST', `/recruitment-intakes/${first.id}/files`);
    await expect(drawer.getByLabel('上传简历', { exact: true })).toBeEnabled();
    await drawer.getByLabel('上传简历', { exact: true }).setInputFiles({ name: f.parserPlans[0].marker + '.pdf', mimeType: 'application/pdf', buffer: pdf });
    first = await json<Intake>(await uploaded, 201); expect(first.state).toBe('pending_review');
    const downloading = page.waitForEvent('download'); await drawer.getByRole('button', { name: '下载', exact: true }).click();
    const download = await downloading; expect(await readFile((await download.path())!)).toEqual(pdf); pass('UI_waiting_upload_and_real_MinIO_download_bytes');
    first = await parse(page, first, personName, 'failed'); expect(first.state).toBe('needs_material');
    await expect(drawer.getByRole('button', { name: '重试解析', exact: true })).toBeEnabled(); await capture(page, info, '02-parse-failed-manual-draft-retained');
    first = await parse(page, first, personName, 'succeeded'); expect(first.state).toBe('pending_review');
    await drawer.getByRole('button', { name: '解析建议（逐项核对）', exact: true }).click();
    const phoneSuggestion = drawer.getByRole('checkbox', { name: '手机号 ' + f.parserPlans[0].fields.phone, exact: true });
    await drawer.locator('.el-checkbox').filter({ has: page.getByRole('checkbox', { name: '手机号 ' + f.parserPlans[0].fields.phone, exact: true }) }).click();
    await expect(phoneSuggestion).toBeChecked();
    await drawer.getByRole('button', { name: '采用选中的建议', exact: true }).click();
    await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveValue(personName);
    await expect(drawer.getByRole('textbox', { name: '候选人手机号', exact: true })).toHaveValue(f.parserPlans[0].fields.phone);
    const onlyConfirmed = response(page, 'POST', `/recruitment-intakes/${first.id}/confirm`);
    await drawer.getByRole('button', { name: '仅入库', exact: true }).click();
    first = await json<Intake>(await onlyConfirmed, 201); expect(first.state).toBe('completed'); expect(first.candidateId).toBeTruthy(); expect(first.applicationId).toBeNull();
    await expect(drawer.getByRole('button', { name: '刷新记录', exact: true })).toBeEnabled();
    expect(previewNode<number>(`console.log(await db.talentApplication.count({where:{candidateId:${JSON.stringify(first.candidateId)}}}));`)).toBe(0);
    await capture(page, info, '03-parse-retry-suggestions-and-candidate-only-result'); pass('UI_parse_fail_retry_success_without_false_conflict_and_explicit_candidate_only');
    await drawer.getByRole('button', { name: '查看人才档案', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`candidateId=${first.candidateId}`));

    stage = 'actual_second_editor_conflict_preserves_inputs';
    const conflictName = `虚构${f.prefix}_冲突草稿`;
    drawer = await start(page, f, '手工收件', firstDemand.id, conflictName);
    const conflict = await save(page); drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
    const kept = `虚构${f.prefix}主窗口未保存的来源依据`;
    await drawer.getByRole('textbox', { name: '来源线索', exact: true }).fill(kept);
    await drawer.getByRole('textbox', { name: '候选人姓名', exact: true }).fill(conflictName + '_保留');
    other = await page.context().newPage(); await as(other, f.actors.operator, '/recruitment/intakes?demandId=' + firstDemand.id);
    const otherDrawer = await open(other, f, mobile, conflictName);
    await otherDrawer.getByRole('textbox', { name: '来源线索', exact: true }).fill(`虚构${f.prefix}另一窗口已保存的来源依据`);
    await save(other, conflict);
    const stale = response(page, 'PATCH', '/recruitment-intakes/' + conflict.id);
    await drawer.getByRole('button', { name: '保存核对草稿', exact: true }).click(); expect((await stale).status()).toBe(409);
    await expect(drawer.getByRole('textbox', { name: '来源线索', exact: true })).toHaveValue(kept);
    await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveValue(conflictName + '_保留');
    await capture(page, info, '04-real-business-conflict-retains-input');
    await drawer.getByRole('button', { name: '核对新版本并保留输入', exact: true }).click();
    await page.getByRole('button', { name: '已核对，保留输入', exact: true }).click(); await save(page, conflict);
    await drawer.getByRole('button', { name: '关闭收件', exact: true }).click();
    await drawer.getByRole('textbox', { name: '关闭原因', exact: true }).fill('虚构候选人明确结束沟通');
    const closed = response(page, 'POST', `/recruitment-intakes/${conflict.id}/close`);
    await drawer.getByRole('button', { name: '记录原因并关闭收件', exact: true }).click(); expect((await json<Intake>(await closed, 201)).state).toBe('closed');
    await other.close(); other = undefined; pass('UI_actual_409_preserves_input_explicit_reconfirm_and_close_with_reason');

    stage = 'reuse_existing_person_for_another_job';
    const followUp = await api<{ id: string }>(page, f.actors.operator, 'POST', `/talents/${first.candidateId}/follow-ups`, { channel: 'other',
      summary: `虚构${f.prefix}原跟进记录`, occurredAt: '2037-01-08', nextFollowUpAt: '2037-01-12' }, 201);
    const priorApp = await api<Application>(page, f.actors.operator, 'POST', `/talent-recruitment/candidates/${first.candidateId}/applications`,
      { deptId: f.department.id, positionName: f.position.name }, 201);
    const retained = previewNode(`console.log(JSON.stringify({candidate:await db.talentCandidate.findUnique({where:{id:${JSON.stringify(first.candidateId)}}}),
      followUp:await db.talentFollowUp.findUnique({where:{id:${JSON.stringify(followUp.id)}}}),application:await db.talentApplication.findUnique({where:{id:${JSON.stringify(priorApp.id)}}})}));`);
    drawer = await start(page, f, '手工收件', secondDemand.id, `虚构${f.prefix}_另岗位核对`, f.parserPlans[0].fields.phone, f.secondPosition);
    await drawer.getByRole('button', { name: '核对手机号已有档案', exact: true }).click();
    await expect(drawer.getByText('该手机号已有档案，不会覆盖原资料或跟进。', { exact: true })).toBeVisible();
    await drawer.locator('.el-checkbox').filter({ has: page.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true }) }).click();
    await expect(drawer.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true })).toBeChecked();
    await expect(drawer.getByText(/已有跟进 1 条/)).toBeVisible();
    await expect(field(page, drawer, '应聘岗位')).toContainText(f.secondPosition.name);
    await drawer.getByRole('combobox', { name: '应聘岗位', exact: true }).press('Enter');
    const openedOptions = page.getByRole('option', { name: `${f.secondPosition.code} · ${f.secondPosition.name}`, exact: true });
    await expect(openedOptions).toBeVisible();
    const optionBounds = await openedOptions.boundingBox(); expect(optionBounds!.x).toBeGreaterThanOrEqual(0); expect(optionBounds!.x + optionBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await capture(page, info, '05-existing-profile-and-long-opened-job-options'); await openedOptions.click();
    const second = await save(page); drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
    const reusedResponse = response(page, 'POST', `/recruitment-intakes/${second.id}/confirm`);
    await drawer.getByRole('button', { name: '入库并创建应聘', exact: true }).click();
    const reused = await json<Intake>(await reusedResponse, 201); expect(reused.candidateId).toBe(first.candidateId); expect(reused.applicationId).toBeTruthy(); expect(reused.applicationId).not.toBe(priorApp.id);
    await expect(drawer.getByRole('button', { name: '刷新记录', exact: true })).toBeEnabled();
    const afterReuse = previewNode(`console.log(JSON.stringify({candidate:await db.talentCandidate.findUnique({where:{id:${JSON.stringify(first.candidateId)}}}),
      followUp:await db.talentFollowUp.findUnique({where:{id:${JSON.stringify(followUp.id)}}}),application:await db.talentApplication.findUnique({where:{id:${JSON.stringify(priorApp.id)}}})}));`);
    expect(afterReuse).toEqual(retained); await capture(page, info, '06-existing-person-new-application-result'); pass('UI_explicit_same_phone_reuse_new_job_preserves_profile_followup_and_prior_application');

    stage = 'original_hiring_and_independent_confirmation';
    await drawer.getByRole('button', { name: '查看本次应聘', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`applicationId=${reused.applicationId}`));
    const panel = page.locator('.application-panel');
    const application = await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + reused.applicationId);
    expect(application.recruitmentDemandId).toBeNull(); expect(application.recruitmentDemandSnapshot).toBeNull();
    await panel.getByRole('button', { name: '提交录用', exact: true }).click(); const command = panel.locator('.application-panel__command');
    await command.locator('textarea').fill(`虚构${f.prefix}独立录用意见`);
    await command.getByRole('button', { name: '提交录用', exact: true }).click();
    await expect(field(page, command, '招聘需求单').locator('.el-form-item__error')).toHaveText('请选择已批准且已核对的招聘需求单');
    const options = response(page, 'GET', '/recruitment-demands/options'); await command.getByRole('combobox', { name: '招聘需求单', exact: true }).fill(f.prefix); await options;
    await page.getByRole('option').filter({ hasText: secondDemand.id }).click();
    const submitted = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'submit_hiring');
    await command.getByRole('button', { name: '提交录用', exact: true }).click(); let hiring = await json<Application>(await submitted, 201);
    expect(hiring.recruitmentDemandId).toBe(secondDemand.id); await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
    confirmer = true; await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${hiring.id}`);
    const review = page.locator('.hiring-review__detail'); await expect(review).toContainText(personName);
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    const approved = response(page, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`, 'approve_hiring');
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click(); hiring = await json<Application>(await approved, 201);
    expect(hiring.hiringReviewedById).toBe(f.actors.confirmer.id); expect(hiring.hiringReviewedById).not.toBe(hiring.hiringRequestedById); confirmer = false;
    expect(narrow).toEqual([]);
    await as(page, f.actors.operator, `/talents?candidateId=${hiring.candidateId}&applicationId=${hiring.id}`);
    const acceptedPanel = page.locator('.application-panel'); await acceptedPanel.getByRole('button', { name: '候选人接受', exact: true }).click();
    const accepted = response(page, 'POST', `/talent-recruitment/applications/${hiring.id}/actions`, 'accept_offer');
    await acceptedPanel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click(); hiring = await json<Application>(await accepted, 201);
    expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + secondDemand.id)).occupiedCount).toBe(1);
    await expect(acceptedPanel.getByRole('button', { name: '办理入职', exact: true })).toHaveCount(0); await capture(page, info, '07-original-independent-hiring-and-acceptance-seat');
    pass('UI_original_demand_gate_independent_confirmation_acceptance_and_legacy_onboarding_boundary');

    stage = 'mailbox_replay_and_original_waiting_association';
    drawer = await start(page, f, '登记待收简历', firstDemand.id, `虚构${f.prefix}_邮件原待收`);
    await drawer.getByRole('combobox', { name: '下次跟进时间', exact: true }).fill('2037-01-11 10:00:00');
    await drawer.getByRole('combobox', { name: '下次跟进时间', exact: true }).press('Tab');
    const waiting = await save(page);
    expect(waiting.positionName).toBe(f.position.name); expect(waiting.demandId).toBe(firstDemand.id);
    proof.waitingBeforeAssociation = { id: waiting.id, positionName: waiting.positionName, demandId: waiting.demandId, nextFollowUpAt: waiting.nextFollowUpAt };
    drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    previewNode(`await fixtures.activateMailboxFixture(db,${JSON.stringify(f.prefix)}); console.log(JSON.stringify({active:true}));`);
    await page.goto('/recruitment/intakes');
    async function syncPage() {
      const synced = response(page, 'POST', '/recruitment-intakes/mailbox/sync'); await page.getByRole('button', { name: '读取招聘邮箱', exact: true }).click();
      return json<{ hasMore: boolean; complete: boolean; failed: number }>(await synced, 201);
    }
    const firstPage = await syncPage(); expect(firstPage).toMatchObject({ hasMore: true, failed: 0 });
    await expect(page.getByText(/尚未读完，请核对后继续读取/)).toBeVisible();
    expect(await syncPage()).toMatchObject({ hasMore: false, complete: true, failed: 0 });
    const mailIds = () => previewNode<string[]>(`console.log(JSON.stringify((await db.recruitmentIntake.findMany({where:{messageId:{startsWith:${JSON.stringify(f.prefix + '_')}}},select:{id:true},orderBy:{id:'asc'}})).map(row=>row.id)));`);
    const beforeReplay = mailIds(); expect(beforeReplay).toHaveLength(9); await syncPage(); await syncPage(); expect(mailIds()).toEqual(beforeReplay);
    drawer = await open(page, f, mobile, '姓名待核对', `${f.prefix}招聘收件_body_only`);
    const awaitingSelect = drawer.getByRole('combobox', { name: '原待收简历', exact: true }); await awaitingSelect.fill(f.prefix);
    const waitingOption = page.getByRole('option').filter({ hasText: waiting.id }); await expect(waitingOption).toBeVisible(); await waitingOption.click();
    const associated = response(page, 'POST', '/recruitment-intakes/' + (await api<{ items: Intake[] }>(page, f.actors.operator, 'GET', `/recruitment-intakes?keyword=${f.prefix}招聘收件_body_only&page=1&pageSize=20`)).items[0]!.id + '/associate');
    await drawer.getByRole('button', { name: '关联并保留原跟进', exact: true }).click(); const joined = await json<Intake>(await associated, 201);
    expect(joined.id).toBe(waiting.id); expect(joined.associatedFromIds.length).toBe(1); expect(joined.nextFollowUpAt).toBe(waiting.nextFollowUpAt); expect(joined.ownerId).toBe(waiting.ownerId);
    expect(joined.positionName).toBe(waiting.positionName); expect(joined.demandId).toBe(waiting.demandId);
    await expect(drawer.getByRole('textbox', { name: '收件意向岗位', exact: true })).toHaveValue(f.position.name);
    await expect(drawer.getByRole('textbox', { name: '来源线索', exact: true })).toHaveValue(waiting.sourceNotes!);
    await drawer.getByRole('button', { name: '原始来源与关联记录', exact: true }).click(); await expect(drawer).toContainText(f.prefix + '_resume_C');
    await capture(page, info, '08-mail-replay-association-keeps-original-followup-and-source'); pass('UI_mail_pages_replay_and_association_preserve_original_context');

    stage = 'narrow_role_denial';
    await as(page, f.actors.viewer, '/recruitment/intakes'); await expect(page.getByRole('button', { name: '登记待收简历', exact: true })).toHaveCount(0);
    expect((await page.request.get(origin + '/api/v1/recruitment-intakes/' + first.id, { headers: { authorization: 'Bearer ' + f.actors.viewer.token } })).status()).toBe(403);
    await capture(page, info, '09-viewer-cannot-open-raw-intakes'); pass('UI_reader_has_no_intake_entry_and_direct_raw_API_is_forbidden');
    expect(errors).toEqual([]); expect(external).toEqual([]); passed = true;
  } finally {
    if (other) await other.close(); proof.passed = passed; proof.lastStage = stage; proof.pageErrors = errors; proof.externalCalls = external;
    try {
      proof.cleanup = previewNode(`console.log(JSON.stringify(await fixtures.archiveIntakeFixture(db,${JSON.stringify(f.prefix)})));`);
      expect(proof.cleanup).toMatchObject({ activeActors: 0, activeCandidates: 0, activeDemands: 0, openIntakes: 0, activePostings: 0 });
      previewNode(`await fixtures.assertProtectedBaseline(db,${JSON.stringify(f.baseline)});console.log(JSON.stringify({protected:true}));`); proof.protectedBaselineUnchanged = true;
    } finally { await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2)); }
  }
});
