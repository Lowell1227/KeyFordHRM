import { test, expect, type APIResponse, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

const origin = 'http://localhost:5173';
type Actor = { id: string; name: string; token: string };
type Application = { id: string; candidateId: string; revision: number; stage: string; recruitmentDemandId: string | null;
  recruitmentDemandRevision: number | null; hiringRequestedById: string | null; hiringReviewedById: string | null };
type SeatCounts = { approvedHeadcount: number; occupiedCount: number; acceptedCount: number; hiredCount: number; remainingCount: number; overCount: number };
type Demand = Omit<SeatCounts, 'approvedHeadcount' | 'remainingCount' | 'overCount'> & { id: string; revision: number;
  instanceId: string; sourceState: string; usable: boolean; approvedHeadcount: number | null; remainingCount: number | null; overCount: number | null };
type SyncProgress = { complete: boolean; failed: number; synced: number; remaining: number; cursor: string | null; requestId: string };
const unoccupiedSeats: SeatCounts = { approvedHeadcount: 2, occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2, overCount: 0 };
const acceptedSeats: SeatCounts = { ...unoccupiedSeats, occupiedCount: 1, acceptedCount: 1, remainingCount: 1 };
const hiredSeats: SeatCounts = { ...acceptedSeats, acceptedCount: 0, hiredCount: 1 };
type Fixture = { prefix: string; department: { id: string; name: string }; position: { id: string; name: string };
  education: { id: string; name: string }; subject: { id: string; name: string }; instanceId: string;
  manualCreatorIds?: string[];
  actors: Record<'operator' | 'confirmer' | 'personnel' | 'participant' | 'viewer' | 'archiveReviewer', Actor> };

function previewNode<T>(body: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
        require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client');
        const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
        (async () => {
          const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview') throw Error('Wrong preview database');
          if ((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional !== true) throw Error('Not fictional preview');
          ${body}
        })().catch(() => { process.exitCode = 1; }).finally(() => db.$disconnect());`,
    }));
  } catch {
    throw new Error('Guarded recruitment-demand fixture operation failed; credential-bearing output suppressed');
  }
}

function createFixture(project: string): Fixture {
  const prefix = `RDL_${project === 'mobile' ? 'm' : 'd'}_${randomUUID().slice(0, 8)}`;
  return previewNode<Fixture>(`
    const { JwtService } = require('@nestjs/jwt');
    const { fixtureNamespace, scope } = require('./test/talent-core/recruitment-demand-preview.cjs');
    const result = await db.$transaction(async tx => {
      const department = await tx.department.create({data:{name:'虚构需求部门_${prefix}'}});
      const position = await tx.position.create({data:{code:'${prefix}',name:'虚构需求岗位_${prefix}'}});
      const education = await tx.personnelReferenceData.create({data:{kind:'education',name:'虚构学历_${prefix}'}});
      const subject = await tx.contractSubject.create({data:{name:'虚构入职主体_${prefix}',internalCompany:'fuede'}});
      const actors = {};
      for (const [kind,hrCapabilities] of [
        ['operator',['recruitment_edit','recruitment_view']], ['confirmer',['talent_hiring_confirm']],
        ['personnel',['employee_archive_edit']], ['participant',[]], ['viewer',['recruitment_view']], ['archiveReviewer',['employee_archive_review']],
      ]) {
        const user = await tx.user.create({data:{name:'虚构${prefix}_'+kind,employeeNo:'${prefix}_'+kind,
          deptId:department.id,status:'active',accountType:'employee',sysRole:kind==='participant'?'employee':'hr_user',
          hrCapabilities,isAssessorOnly:false,mustChangePassword:false}});
        await tx.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:department.id,
          company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),
          employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture',reason:'${prefix}'}});
        const token = new JwtService().sign({sub:user.id,employeeNo:user.employeeNo,name:user.name,
          sysRole:user.sysRole,deptId:user.deptId,hrCapabilities:user.hrCapabilities,isAssessorOnly:false,canViewAll:false},
          {secret:process.env.JWT_SECRET,expiresIn:'1h'});
        actors[kind] = {id:user.id,name:user.name,token};
      }
      const now = new Date().toISOString();
      await tx.systemConfig.create({data:{key:fixtureNamespace+'${prefix}',value:{fictional:true,prefix:'${prefix}',sources:[{
        ...scope,instanceId:'${prefix}_approved',status:'approved',rawDepartment:department.name,rawPosition:position.name,
        rawHeadcount:'两名（原文待核对）',approvedAt:now,sourceCreatedAt:now,sourceUpdatedAt:now,
        sourceLink:'https://example.invalid/${prefix}_approved',mainInstanceId:null,bizAction:null,
      }]}}});
      return {prefix:'${prefix}',department:{id:department.id,name:department.name},
        position:{id:position.id,name:position.name},education:{id:education.id,name:education.name},
        subject:{id:subject.id,name:subject.name},instanceId:'${prefix}_approved',actors};
    });
    console.log(JSON.stringify(result));`);
}

async function as(page: Page, actor: Actor, path: string) {
  await page.goto('/login');
  await page.evaluate(token => {
    localStorage.setItem('token', token);
    localStorage.setItem('expiresAt', String(Date.now() + 3500000));
  }, actor.token);
  await page.goto(path);
}

function response(page: Page, method: string, path: string, action?: string) {
  return page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1${path}`
    && result.request().method() === method && (!action || result.request().postDataJSON()?.action === action));
}

async function json<T>(result: Pick<APIResponse, 'status' | 'url' | 'json'>, status: number): Promise<T> {
  expect(result.status(), new URL(result.url()).pathname).toBe(status);
  const body = await result.json();
  expect(body.code).toBe(0);
  return body.data as T;
}

async function assertDemandSeats(page: Page, f: Fixture, demandId: string, expected: SeatCounts) {
  const result = await page.request.get(`${origin}/api/v1/recruitment-demands/${demandId}`,
    { headers: { authorization: `Bearer ${f.actors.operator.token}` } });
  const demand = await json<Demand>(result, 200);
  expect(demand).toMatchObject(expected);
  return Object.fromEntries(Object.keys(expected).map(key => [key, demand[key as keyof SeatCounts]]));
}

async function expectSeatDisplay(page: Page, scope: Locator, expected: SeatCounts) {
  const display = scope.locator('.demand-seats');
  for (const [label, value] of [['已接受待到岗', expected.acceptedCount], ['已到岗', expected.hiredCount], ['剩余名额', expected.remainingCount]] as const) {
    await expect(display.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(String(value));
  }
}

function field(page: Page, scope: Locator, label: string) {
  return scope.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
}

async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: page overflow`).toBe(true);
  for (const drawer of await page.locator('.el-drawer__body:visible').all()) {
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: drawer overflow`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

async function openTalent(page: Page, name: string, mobile: boolean) {
  await page.goto('/talents');
  const search = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await search.fill(name); await search.press('Enter');
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  if (mobile) await row.getByRole('button', { name: '打开详情', exact: true }).click();
  else await row.getByText(name, { exact: true }).click();
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
}

async function createCandidateAndApplication(page: Page, f: Fixture, mobile: boolean, operator = f.actors.operator, name = `虚构${f.prefix}_候选人`) {
  await as(page, operator, '/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const talent = page.locator('.talent-form');
  await talent.getByPlaceholder('候选人姓名').fill(name);
  await talent.getByPlaceholder('11 位手机号').fill(`170${randomInt(10000000, 100000000)}`);
  await page.getByTestId('talent-form-source').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  await field(page, talent, '学历').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.education.name, exact: true }).click();
  const created = response(page, 'POST', '/talents');
  await page.getByRole('button', { name: '加入人才库', exact: true }).click();
  const candidate = await json<{ id: string }>(await created, 201);
  await openTalent(page, name, mobile);
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
  expect(application.stage).toBe('screening');
  expect(application.recruitmentDemandId).toBeNull();
  return { candidate, application, name };
}

async function arrangeInterviewWithoutDemand(page: Page, f: Fixture, applicationId: string) {
  const detail = page.locator('.talent-detail-drawer');
  await detail.locator('.application-panel').getByRole('button', { name: '安排面试', exact: true }).click();
  const form = detail.locator('.interview-panel__editor');
  for (const [index, value] of ['2037-01-15 10:00:00', '2037-01-15 11:00:00'].entries()) {
    const input = form.locator('.interview-panel__times input').nth(index);
    await input.fill(value); await input.press('Tab');
  }
  await field(page, form, '内部参与人').getByRole('combobox').fill(f.actors.participant.name);
  const person = page.getByRole('option').filter({ hasText: f.actors.participant.name });
  await expect(person).toBeVisible(); await person.click(); await page.keyboard.press('Escape');
  await field(page, form, '会议邀请内容（候选人版）').locator('textarea').fill(`虚构${f.prefix}面试，不发送真实通知。`);
  const arranged = response(page, 'POST', '/talent-interviews');
  await form.getByRole('button', { name: '保存邀约', exact: true }).click();
  const interview = await json<{ id: string; applicationId: string; syncStatus: string }>(await arranged, 201);
  expect(interview.applicationId).toBe(applicationId);
  expect(interview.syncStatus).toBe('unconfigured');
  return interview;
}

function archiveFixture(f: Fixture) {
  const safe = { prefix: f.prefix, departmentId: f.department.id, positionId: f.position.id, educationId: f.education.id,
    subjectId: f.subject.id, actorIds: Object.values(f.actors).map(actor => actor.id), manualCreatorIds: f.manualCreatorIds || [] };
  return previewNode<Record<string, number>>(`
    const f = ${JSON.stringify(safe)};
    const { fixtureNamespace, prefixPattern } = require('./test/talent-core/recruitment-demand-preview.cjs');
    if (!prefixPattern.test(f.prefix)) throw Error('Invalid cleanup prefix');
    const actors = await db.user.findMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},select:{id:true}});
    if (actors.length !== f.actorIds.length) throw Error('Fixture ownership mismatch');
    const where = {createdById:{in:[...f.actorIds,...f.manualCreatorIds]},name:{startsWith:'虚构'+f.prefix}};
    const candidates = await db.talentCandidate.findMany({where,select:{id:true,name:true}}), ids = candidates.map(row=>row.id);
    const intakes = await db.employeeDataChangeRequest.findMany({where:{talentCandidateId:{in:ids}},select:{id:true,userId:true,employeeName:true}});
    const convertedIds = intakes.filter(row=>row.userId && row.employeeName.startsWith('虚构'+f.prefix)).map(row=>row.userId);
    await db.$transaction(async tx => {
      const now = new Date();
      await tx.talentApplication.updateMany({where:{candidateId:{in:ids},stage:'hiring_review'},data:{stage:'withdrawn',revision:{increment:1}}});
      await tx.talentCandidate.updateMany({where,data:{deletedAt:now}});
      await tx.user.updateMany({where:{id:{in:convertedIds},name:{startsWith:'虚构'+f.prefix}},data:{archivedAt:now,deletedAt:now,status:'resigned'}});
      await tx.employeeDataChangeRequest.updateMany({where:{id:{in:intakes.map(row=>row.id)},employeeName:{startsWith:'虚构'+f.prefix}},data:{archivedAt:now}});
      await tx.user.updateMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},data:{archivedAt:now,deletedAt:now,status:'resigned'}});
      await tx.department.updateMany({where:{id:f.departmentId,name:'虚构需求部门_'+f.prefix},data:{isActive:false}});
      await tx.position.updateMany({where:{id:f.positionId,code:f.prefix},data:{isActive:false}});
      await tx.contractSubject.updateMany({where:{id:f.subjectId,name:'虚构入职主体_'+f.prefix},data:{isActive:false}});
      await tx.personnelReferenceData.updateMany({where:{id:f.educationId,name:'虚构学历_'+f.prefix},data:{isActive:false}});
      await tx.recruitmentDemand.updateMany({where:{instanceId:{startsWith:f.prefix+'_'}},data:{sourceState:'withdrawn',mappedFingerprint:null}});
      await tx.systemConfig.deleteMany({where:{key:fixtureNamespace+f.prefix}});
    });
    console.log(JSON.stringify({actors:actors.length,candidates:ids.length,
      activeActors:await db.user.count({where:{id:{in:f.actorIds},archivedAt:null}}),
      activeCandidates:await db.talentCandidate.count({where:{...where,deletedAt:null}}),
      activeConverted:await db.user.count({where:{id:{in:convertedIds},archivedAt:null}}),
      pendingHiringReviews:await db.talentApplication.count({where:{candidateId:{in:ids},stage:'hiring_review'}}),
      usableDemands:await db.recruitmentDemand.count({where:{instanceId:{startsWith:f.prefix+'_'},sourceState:'approved'}}),
      upstreamFixtures:await db.systemConfig.count({where:{key:fixtureNamespace+f.prefix}}),
      retainedSyncRuns:await db.recruitmentDemandSyncRun.count({where:{actorId:{in:f.actorIds}}}),
      retainedSyncItems:await db.recruitmentDemandSyncItem.count({where:{run:{actorId:{in:f.actorIds}}}}),
      retainedDemandEvents:await db.recruitmentDemandEvent.count({where:{demand:{instanceId:{startsWith:f.prefix+'_'}}}})}));`);
}

async function syncThroughPage(page: Page, f: Fixture, returningToApplication = true) {
  if (new URL(page.url()).pathname !== '/recruitment/demands') await page.goto('/recruitment/demands');
  if (returningToApplication) await expect(page.getByRole('button', { name: '返回当前应聘', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '同步钉钉需求', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '同步钉钉需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '同步钉钉招聘需求', exact: true });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  for (const placeholder of ['开始日期', '结束日期']) {
    const input = dialog.getByPlaceholder(placeholder, { exact: true });
    await input.fill(today); await input.press('Tab');
  }
  const synced = response(page, 'POST', '/recruitment-demands/sync');
  await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
  let result = await json<SyncProgress>(await synced, 201);
  const progress = [result], intent = result.requestId, cursor = result.cursor, total = result.synced + result.remaining;
  expect(result.failed, JSON.stringify(result)).toBe(0);
  for (let batch = 0; !result.complete && batch < 20; batch++) {
    expect(result.cursor).toBe(cursor); expect(result.requestId).toBe(intent);
    expect(result.cursor).not.toBeNull();
    const continuation = response(page, 'POST', '/recruitment-demands/sync');
    await dialog.getByRole('button', { name: /^(继续同步|恢复本次)$/ }).click();
    const next = await json<SyncProgress>(await continuation, 201);
    expect(next.requestId).toBe(intent); expect(next.synced).toBeGreaterThan(result.synced);
    expect(next.remaining).toBeLessThan(result.remaining); expect(next.synced + next.remaining).toBe(total);
    expect(next.failed, JSON.stringify(next)).toBe(0);
    result = next; progress.push(result);
  }
  expect(result.complete, JSON.stringify(progress)).toBe(true); expect(result.cursor).toBeNull(); expect(result.remaining).toBe(0);
  await expect(dialog).not.toBeVisible();
  await page.getByPlaceholder('部门、岗位或单号').fill(f.instanceId);
  const listed = response(page, 'GET', '/recruitment-demands');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const rows = await json<{ items: Demand[] }>(await listed, 200);
  expect(rows.items).toHaveLength(1); expect(rows.items[0]?.instanceId).toBe(f.instanceId);
  expect(rows.items[0]?.usable).toBe(false);
  return { ...rows.items[0]!, syncBatches: progress };
}

async function mapThroughPage(page: Page, f: Fixture, mobile: boolean, reason: string) {
  const list = page.locator(mobile ? '.mobile-result-list' : '.desktop-result-table');
  const row = list.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: f.instanceId });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: mobile ? '查看需求' : '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toContainText(f.instanceId);
  await detail.getByRole('button', { name: '核对部门、岗位和人数', exact: true }).click();
  const form = detail.locator('form');
  await form.getByRole('combobox', { name: 'HRM 部门', exact: true }).fill(f.department.name);
  const department = page.getByRole('option', { name: f.department.name, exact: true });
  await expect(department).toBeVisible(); await department.click();
  await form.getByRole('combobox', { name: 'HRM 岗位', exact: true }).fill(f.position.name);
  const position = page.getByRole('option', { name: `${f.prefix} · ${f.position.name}`, exact: true });
  await expect(position).toBeVisible(); await position.click();
  await form.getByRole('spinbutton', { name: '批准人数', exact: true }).fill('2');
  await form.locator('textarea').fill(reason);
  const saved = page.waitForResponse(result => result.request().method() === 'PATCH'
    && /^\/api\/v1\/recruitment-demands\/[^/]+\/mapping$/.test(new URL(result.url()).pathname));
  await detail.getByRole('button', { name: '保存核对结果', exact: true }).click();
  const demand = await json<Demand>(await saved, 200);
  expect(demand.usable).toBe(true); await expect(detail).toContainText('已核对，可供选用');
  return { detail, demand };
}

async function submitHiring(page: Page, applicationId: string, status: number, warningExpected = true) {
  const result = response(page, 'POST', `/talent-recruitment/applications/${applicationId}/actions`, 'submit_hiring');
  await page.locator('.application-panel__command').getByRole('button', { name: '提交录用', exact: true }).click();
  const warning = page.getByRole('dialog', { name: '本次应聘仍有待处理事项', exact: true });
  if (warningExpected) {
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '仍然继续', exact: true }).click();
  } else await expect(warning).toHaveCount(0);
  const received = await result;
  expect(received.status()).toBe(status);
  return received;
}

function changeFictionalUpstream(f: Fixture, replacementInstanceId?: string) {
  return previewNode<{ instanceId: string }>(`
    const { fixtureNamespace, prefixPattern } = require('./test/talent-core/recruitment-demand-preview.cjs');
    const prefix = ${JSON.stringify(f.prefix)}, id = ${JSON.stringify(f.instanceId)}, nextId = ${JSON.stringify(replacementInstanceId || null)};
    if (!prefixPattern.test(prefix) || !id.startsWith(prefix+'_') || (nextId && !nextId.startsWith(prefix+'_'))) throw Error('Unowned source');
    const row = await db.systemConfig.findUniqueOrThrow({where:{key:fixtureNamespace+prefix}});
    if (row.value.fictional !== true || row.value.prefix !== prefix) throw Error('Invalid source namespace');
    const original = row.value.sources.find(source=>source.instanceId===id);
    if (!original) throw Error('Missing owned source');
    const source = {...original,instanceId:nextId||id,status:nextId?'approved':'withdrawn',sourceUpdatedAt:new Date().toISOString(),
      sourceLink:'https://example.invalid/'+(nextId||id)};
    const sources = row.value.sources.filter(source=>source.instanceId!==(nextId||id)); sources.push(source);
    await db.systemConfig.update({where:{key:row.key},data:{value:{...row.value,sources}}});
    console.log(JSON.stringify({instanceId:source.instanceId}));`);
}

async function selectHiringDemand(page: Page, f: Fixture, note: string) {
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await command.locator('textarea').fill(note);
  const selector = command.getByRole('combobox', { name: '招聘需求单', exact: true });
  await expect(selector).toBeEnabled();
  const options = response(page, 'GET', '/recruitment-demands/options');
  await selector.fill(f.instanceId);
  const available = await json<{ items: Demand[] }>(await options, 200);
  expect(available.items.some(row => row.instanceId === f.instanceId && row.usable)).toBe(true);
  const option = page.getByRole('option').filter({ hasText: f.instanceId });
  await expect(option).toBeVisible(); await option.click();
  await expect(command).toContainText(`已选 ${f.instanceId}`);
  return command;
}

async function confirmHiring(page: Page, f: Fixture, application: Application, name: string) {
  await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${application.id}`);
  const review = page.locator('.hiring-review__detail');
  await expect(review.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(review.locator('.demand-summary')).toContainText(f.instanceId);
  await review.getByRole('button', { name: '确认录用', exact: true }).click();
  const confirmed = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'approve_hiring');
  await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
  const offer = await json<Application>(await confirmed, 201);
  expect(offer.hiringReviewedById).not.toBe(offer.hiringRequestedById);
  return offer;
}

async function acceptOffer(page: Page, f: Fixture, application: Application) {
  await as(page, f.actors.operator, `/talents?candidateId=${application.candidateId}&applicationId=${application.id}`);
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '候选人接受', exact: true }).click();
  const accepted = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'accept_offer');
  await panel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click();
  return json<Application>(await accepted, 201);
}

async function openDemandProgress(page: Page, f: Fixture, mobile: boolean, actor = f.actors.operator) {
  await as(page, actor, '/recruitment/demands');
  await page.getByPlaceholder('部门、岗位或单号').fill(f.instanceId);
  const listed = page.waitForResponse(result => result.request().method() === 'GET'
    && new URL(result.url()).pathname === '/api/v1/recruitment-demands'
    && new URL(result.url()).searchParams.get('keyword') === f.instanceId);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const result = await json<{ items: Demand[] }>(await listed, 200);
  expect(result.items).toHaveLength(1); expect(result.items[0]?.instanceId).toBe(f.instanceId);
  const list = page.locator(mobile ? '.mobile-result-list' : '.desktop-result-table');
  await list.getByRole('button', { name: mobile ? '查看需求' : '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toContainText(f.instanceId);
  return detail.getByRole('region', { name: '需求应聘流程', exact: true });
}

async function progressCategory(page: Page, region: Locator, demandId: string, category: string, label: string) {
  const loaded = page.waitForResponse(result => result.request().method() === 'GET'
    && new URL(result.url()).pathname === `/api/v1/recruitment-demands/${demandId}/applications`
    && new URL(result.url()).searchParams.get('category') === category);
  await region.getByRole('tab', { name: label, exact: true }).click();
  const result = await loaded;
  expect(new URL(result.url()).searchParams.get('category')).toBe(category);
  return json<{ total: number; items: Array<{ id: string; candidateId: string; candidateName: string | null;
    occupied: boolean; category: string; onboardingRequest: { id: string } | null }> }>(result, 200);
}

async function previewAccount(page: Page, account: 'ADMIN' | 'HR001') {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.removeItem('token'); localStorage.removeItem('expiresAt'); });
  await page.goto('/login');
  await page.getByTestId('preview-account').locator('.el-select__wrapper').click();
  await page.getByRole('option').filter({ hasText: `(${account})` }).click();
  const loggedIn = response(page, 'POST', '/auth/test-login');
  await page.getByTestId('preview-login').click();
  const result = await json<{ token: string; user: { id: string; name: string; sysRole: string } }>(await loggedIn, 200);
  expect(result.user.sysRole).toBe(account === 'ADMIN' ? 'system_admin' : 'hr');
  return { ...result.user, token: result.token };
}

async function existingAccountWorkflow(page: Page, f: Fixture, mobile: boolean, demandId: string) {
  const admin = await previewAccount(page, 'ADMIN'); f.manualCreatorIds = [admin.id];
  const { application, name } = await createCandidateAndApplication(page, f, mobile, admin, `虚构${f.prefix}_固定账号候选人`);
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await command.locator('textarea').fill(`虚构${f.prefix}固定预览账号办理验证，不修改现有账号能力`);
  const options = response(page, 'GET', '/recruitment-demands/options');
  await command.getByRole('combobox', { name: '招聘需求单', exact: true }).fill(f.prefix); await options;
  await page.getByRole('option').filter({ hasText: f.instanceId }).click();
  const submitted = await json<Application>(await submitHiring(page, application.id, 201, false), 201);
  expect(submitted).toMatchObject({ stage: 'hiring_review', recruitmentDemandId: demandId, hiringRequestedById: admin.id });
  await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
  const forbidden = await page.request.get(`${origin}/api/v1/talent-recruitment/hiring-reviews`, { headers: { authorization: `Bearer ${admin.token}` } });
  expect(forbidden.status()).toBe(403);
  const hr = await previewAccount(page, 'HR001');
  await page.goto(`/talent-hiring?applicationId=${application.id}`);
  const review = page.locator('.hiring-review__detail');
  await expect(review.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(review.locator('.demand-summary')).toContainText(f.instanceId);
  await review.getByRole('button', { name: '确认录用', exact: true }).click();
  const approved = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'approve_hiring');
  await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
  expect(await json<Application>(await approved, 201)).toMatchObject({ stage: 'offered', hiringRequestedById: admin.id, hiringReviewedById: hr.id });
  expect(admin.id).not.toBe(hr.id);
  await assertDemandSeats(page, f, demandId, hiredSeats);
  return { operator: 'ADMIN', operatorRole: admin.sysRole, confirmer: 'HR001', confirmerRole: hr.sysRole,
    submitted: true, independentlyConfirmed: true, administratorConfirmationDenied: 403 };
}

async function completeOriginalOnboarding(page: Page, f: Fixture, application: Application, name: string, demandId: string) {
  await as(page, f.actors.personnel, `/talents?candidateId=${application.candidateId}&applicationId=${application.id}`);
  await page.locator('.application-panel').getByRole('button', { name: '办理入职', exact: true }).click();
  const intake = page.getByRole('dialog', { name: '办理入职', exact: true });
  await expect(intake.getByLabel('姓名', { exact: true })).toHaveValue(name);
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await page.getByRole('option', { name: f.subject.name, exact: true }).click();
  await intake.locator('[data-archive-field="employee.deptId"] .el-select').click();
  await page.getByRole('treeitem').filter({ hasText: f.department.name }).click();
  await intake.locator('[data-archive-field="employee.positionId"] .el-select').click();
  await page.getByRole('option', { name: new RegExp(f.position.name) }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  for (const key of ['entryDate', 'effectiveFrom']) {
    const input = intake.locator(`[data-archive-field="employee.${key}"] input`);
    await input.fill(today); await input.press('Tab');
  }
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  const submitted = response(page, 'POST', '/employee-archives');
  await intake.getByRole('button', { name: '提交', exact: true }).click();
  const request = await json<{ id: string; talentApplicationId: string }>(await submitted, 201);
  expect(request.talentApplicationId).toBe(application.id);
  await as(page, f.actors.archiveReviewer, `/entry-exit?applicationId=${request.id}`);
  const processing = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(processing).toContainText(name);
  await processing.getByRole('button', { name: '通过', exact: true }).click();
  await expect(processing.getByRole('button', { name: '确认到岗', exact: true })).toBeVisible();
  await as(page, f.actors.personnel, `/entry-exit?applicationId=${request.id}`);
  await processing.getByRole('button', { name: '取消本次入职', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: '取消本次入职', exact: true });
  await prompt.locator('input').fill(`虚构${f.prefix}取消单次安排，仍保留录用并准备重提`);
  const cancelled = response(page, 'POST', `/employee-archives/applications/${request.id}/cancel`);
  await prompt.getByRole('button', { name: '确认取消', exact: true }).click();
  expect(await json<{ onboardingStatus: string }>(await cancelled, 201)).toMatchObject({ onboardingStatus: 'cancelled' });
  const afterCancellation = await assertDemandSeats(page, f, demandId, acceptedSeats);
  await expect(processing.getByRole('button', { name: '重新办理入职', exact: true })).toBeVisible();
  await processing.getByRole('button', { name: '重新办理入职', exact: true }).click();
  const resubmitted = response(page, 'PATCH', `/employee-archives/applications/${request.id}/arrival-date`);
  await processing.getByRole('button', { name: '重新提交审核', exact: true }).click();
  expect(await json<{ id: string; onboardingStatus: string }>(await resubmitted, 200)).toMatchObject({ id: request.id, onboardingStatus: 'submitted' });
  const afterResubmission = await assertDemandSeats(page, f, demandId, acceptedSeats);
  await as(page, f.actors.archiveReviewer, `/entry-exit?applicationId=${request.id}`);
  await processing.getByRole('button', { name: '通过', exact: true }).click();
  await expect(processing.getByRole('button', { name: '确认到岗', exact: true })).toBeVisible();
  const arrived = response(page, 'POST', `/employee-archives/applications/${request.id}/confirm-arrival`);
  await processing.getByRole('button', { name: '确认到岗', exact: true }).click();
  expect(await json<{ onboardingStatus: string }>(await arrived, 201)).toMatchObject({ onboardingStatus: 'effective' });
  const afterArrival = await assertDemandSeats(page, f, demandId, hiredSeats);
  return { id: request.id, onboardingStatus: 'effective', afterCancellation, afterResubmission, afterArrival };
}

test('real upstream fixture sync, demand mapping, hiring gate, independent confirmation and original arrival', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  expect(['desktop', 'mobile']).toContain(info.project.name);
  const f = createFixture(info.project.name), mobile = info.project.name === 'mobile';
  const errors: string[] = [], externalCalls: string[] = [], writes: Array<{ method: string; path: string }> = [];
  const narrowLedgerRequests: string[] = []; let narrowConfirmation = false;
  const proof: Record<string, unknown> = { prefix: f.prefix, viewport: info.project.use.viewport,
    upstream: 'guarded fictional adapter override, not actual DingTalk access', hrm: 'real full Nest/PostgreSQL HTTP and pages',
    mockRoutes: false, workflowWrites: 'UI only', sourceLink: 'example.invalid intentionally hidden, not proof of a real DingTalk link' };
  const watch = (target: Page) => {
    target.on('pageerror', error => errors.push(error.message));
  };
  page.context().on('request', request => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) externalCalls.push(`${request.method()} ${url.hostname}${url.pathname}`);
    if (request.method() !== 'GET' && url.pathname.startsWith('/api/v1/')) writes.push({ method: request.method(), path: url.pathname });
    if (narrowConfirmation && url.pathname.startsWith('/api/v1/recruitment-demands')) narrowLedgerRequests.push(url.pathname);
  });
  page.context().on('page', watch);
  watch(page);
  let demandPage: Page | undefined;
  try {
    const { candidate, application, name } = await createCandidateAndApplication(page, f, mobile);
    proof.candidateId = candidate.id; proof.applicationId = application.id;
    proof.interview = await arrangeInterviewWithoutDemand(page, f, application.id);
    const panel = page.locator('.application-panel');
    await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
    await panel.getByRole('button', { name: '提交录用', exact: true }).click();
    const command = panel.locator('.application-panel__command'), note = `虚构${f.prefix}完整保留的录用意见`;
    await command.locator('textarea').fill(note);
    const beforeMissing = writes.filter(row => row.path.endsWith('/actions')).length;
    await command.getByRole('button', { name: '提交录用', exact: true }).click();
    await expect(field(page, command, '招聘需求单').locator('.el-form-item__error')).toHaveText('请选择已批准且已核对的招聘需求单');
    expect(writes.filter(row => row.path.endsWith('/actions')).length).toBe(beforeMissing);
    await expect(command.locator('textarea')).toHaveValue(note);
    await capture(page, info, '01-missing-demand-inline-no-write');

    const opened = page.context().waitForEvent('page');
    await command.getByRole('link', { name: '前往招聘需求核对', exact: true }).click();
    demandPage = await opened;
    await expect(demandPage).toHaveURL(new RegExp(`applicationId=${application.id}`));
    const firstSynced = await syncThroughPage(demandPage, f); proof.syncedDemand = firstSynced;
    const mapped = await mapThroughPage(demandPage, f, mobile, `虚构${f.prefix}逐项核对原文、目录与人数`);
    proof.mappedDemand = mapped.demand;
    proof.seatsAfterMapping = await assertDemandSeats(page, f, mapped.demand.id, unoccupiedSeats);
    await expectSeatDisplay(demandPage, mapped.detail, unoccupiedSeats);
    await capture(demandPage, info, '02-real-http-sync-and-ui-mapping');

    const selector = command.getByRole('combobox', { name: '招聘需求单', exact: true });
    await expect(selector).toBeEnabled();
    const options = response(page, 'GET', '/recruitment-demands/options');
    await selector.fill(f.prefix); await options;
    const option = page.getByRole('option').filter({ hasText: f.instanceId });
    await expect(option).toBeVisible(); await option.click();
    await expect(command).toContainText(`已选 ${f.instanceId}`);
    const selectedRevision = mapped.demand.revision;

    await mapped.detail.getByRole('button', { name: '关闭', exact: true }).click();
    const remapped = await mapThroughPage(demandPage, f, mobile, `虚构${f.prefix}另一个页面更新核对版本`);
    expect(remapped.demand.revision).toBeGreaterThan(selectedRevision);
    const stale = await submitHiring(page, application.id, 409);
    expect(stale.request().postDataJSON()).toMatchObject({ recruitmentDemandId: mapped.demand.id, expectedDemandRevision: selectedRevision });
    await expect(command.locator('textarea')).toHaveValue(note);
    await expect(command).toContainText(f.instanceId);
    await expect(command.getByRole('button', { name: '提交录用', exact: true })).toBeDisabled();
    await capture(page, info, '03-real-409-preserves-note-and-selection');
    await panel.getByRole('button', { name: '刷新记录，保留输入', exact: true }).click();
    await expect(command.locator('textarea')).toHaveValue(note);
    await expect(command).toContainText(`已选 ${f.instanceId} · 版本 ${remapped.demand.revision}`);
    const submitted = await submitHiring(page, application.id, 201);
    let current = await json<Application>(submitted, 201);
    expect(current).toMatchObject({ stage: 'hiring_review', recruitmentDemandId: mapped.demand.id,
      recruitmentDemandRevision: remapped.demand.revision, hiringRequestedById: f.actors.operator.id });
    proof.seatsAfterSubmit = await assertDemandSeats(page, f, mapped.demand.id, unoccupiedSeats);
    await expectSeatDisplay(page, panel, unoccupiedSeats);
    await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
    await demandPage.close(); demandPage = undefined;

    narrowConfirmation = true;
    await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${application.id}`);
    const review = page.locator('.hiring-review__detail');
    await expect(review.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(review.locator('.demand-summary')).toContainText(f.instanceId);
    await expectSeatDisplay(page, review, unoccupiedSeats);
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    const approved = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'approve_hiring');
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    current = await json<Application>(await approved, 201);
    expect(narrowLedgerRequests).toEqual([]); narrowConfirmation = false;
    proof.narrowConfirmerLedgerRequests = narrowLedgerRequests;
    expect(current.stage).toBe('offered'); expect(current.hiringReviewedById).toBe(f.actors.confirmer.id);
    expect(current.hiringReviewedById).not.toBe(current.hiringRequestedById);
    proof.seatsAfterConfirmation = await assertDemandSeats(page, f, mapped.demand.id, unoccupiedSeats);
    await capture(page, info, '04-independent-hiring-confirmation');
    await as(page, f.actors.operator, `/talents?candidateId=${candidate.id}&applicationId=${application.id}`);
    await expect(panel.locator('.application-panel__stage')).toHaveText('已确认录用');
    await panel.getByRole('button', { name: '候选人接受', exact: true }).click();
    const accept = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'accept_offer');
    await panel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click();
    current = await json<Application>(await accept, 201); expect(current.stage).toBe('accepted');
    proof.seatsAfterAcceptance = await assertDemandSeats(page, f, mapped.demand.id, acceptedSeats);
    await expectSeatDisplay(page, panel, acceptedSeats);
    await expect(panel).toContainText('候选人已接受录用，下一步交人事办理入职。');
    proof.onboarding = await completeOriginalOnboarding(page, f, current, name, mapped.demand.id);
    await as(page, f.actors.operator, `/talents?candidateId=${candidate.id}&applicationId=${application.id}`);
    await expect(panel.locator('.application-panel__stage')).toHaveText('已入职');
    await expect(panel.locator('.demand-summary')).toContainText(f.instanceId);
    await expectSeatDisplay(page, panel, hiredSeats);
    await capture(page, info, '05-original-arrival-and-demand-snapshot');
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1024, height: 768 });
    await capture(page, info, mobile ? '06-layout-only-390' : '06-layout-only-1024');
    proof.layoutOnly = mobile ? '390x844, not another workflow' : '1024x768, not another workflow';

    await as(page, f.actors.viewer, '/recruitment/demands');
    await expect(page.getByRole('button', { name: '同步钉钉需求', exact: true })).toHaveCount(0);
    const denied = await page.request.post(`${origin}/api/v1/recruitment-demands/${mapped.demand.id}/refresh`,
      { headers: { authorization: `Bearer ${f.actors.viewer.token}` }, data: {} });
    expect(denied.status()).toBe(403); proof.viewerRefresh = 403;
    if (info.project.use.viewport) await page.setViewportSize(info.project.use.viewport);
    proof.existingPreviewAccounts = await existingAccountWorkflow(page, f, mobile, mapped.demand.id);
    await capture(page, info, '07-existing-admin-submits-hr001-confirms');
    expect(errors).toEqual([]); expect(externalCalls).toEqual([]);
    proof.final = { stage: 'hired', demandId: mapped.demand.id, revision: remapped.demand.revision,
      requester: current.hiringRequestedById, confirmer: current.hiringReviewedById };
    proof.workflowPassed = true;
  } catch (cause) {
    proof.failure = { name: cause instanceof Error ? cause.name : 'UnknownError', message: cause instanceof Error ? cause.message : String(cause) };
    throw cause;
  } finally {
    if (demandPage) await demandPage.close();
    proof.assertionFailures = info.errors.length; proof.pageErrors = errors; proof.externalCalls = externalCalls; proof.httpWrites = writes;
    try {
      proof.cleanup = archiveFixture(f);
      expect(proof.cleanup).toMatchObject({ actors: 6, activeActors: 0, activeCandidates: 0, activeConverted: 0, pendingHiringReviews: 0, usableDemands: 0, upstreamFixtures: 0 });
      proof.cleanupPassed = true;
    } finally {
      proof.passed = proof.workflowPassed === true && proof.cleanupPassed === true && info.errors.length === 0;
      proof.assertionFailures = proof.passed ? 0 : Math.max(1, info.errors.length);
      await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2));
      await info.attach('recruitment-demand-proof', { path: info.outputPath('proof.json'), contentType: 'application/json' });
    }
  }
});

test('mapping save reloads its timeline after one real write', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  const f = createFixture(info.project.name), mobile = info.project.name === 'mobile';
  const reason = `虚构${f.prefix}保存后逐项核对时间线`, errors: string[] = [];
  let mappingWrites = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'PATCH' && /^\/api\/v1\/recruitment-demands\/[^/]+\/mapping$/.test(new URL(request.url()).pathname)) mappingWrites++;
  });
  const proof: Record<string, unknown> = { prefix: f.prefix, viewport: info.project.use.viewport, fictionalUpstream: true, realHrmRequests: true };
  try {
    await as(page, f.actors.operator, '/recruitment/demands');
    await syncThroughPage(page, f, false);
    const { detail, demand } = await mapThroughPage(page, f, mobile, reason);
    const timeline = detail.getByRole('region', { name: '需求时间线', exact: true });
    await expect(timeline.getByText(reason, { exact: true })).toBeVisible();
    await expect(timeline.getByText('核对部门、岗位和人数', { exact: false })).toBeVisible();
    await expect(timeline.getByText('暂无变更记录', { exact: true })).toHaveCount(0);
    expect(mappingWrites).toBe(1); expect(errors).toEqual([]);
    await expectSeatDisplay(page, detail, unoccupiedSeats);
    await capture(page, info, 'mapping-timeline-after-one-write');
    proof.result = { demandId: demand.id, revision: demand.revision, mappingWrites, timelineReason: reason, passed: true };
  } catch (cause) {
    proof.failure = cause instanceof Error ? cause.message : String(cause); throw cause;
  } finally {
    try {
      proof.cleanup = archiveFixture(f);
      expect(proof.cleanup).toMatchObject({ activeActors: 0, activeCandidates: 0, pendingHiringReviews: 0, usableDemands: 0, upstreamFixtures: 0 });
    } finally {
      proof.pageErrors = errors;
      await writeFile(info.outputPath('mapping-proof.json'), JSON.stringify(proof, null, 2));
    }
  }
});

test('fresh source preflight, explicit termination and demand progress use real pages', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  const f = createFixture(info.project.name), mobile = info.project.name === 'mobile';
  const errors: string[] = [], externalCalls: string[] = [], actions: string[] = [], narrowLedgerRequests: string[] = [];
  let narrow = false;
  page.on('pageerror', error => errors.push(error.message));
  page.context().on('request', request => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) externalCalls.push(`${request.method()} ${url.hostname}${url.pathname}`);
    if (request.method() === 'POST' && url.pathname.endsWith('/actions')) actions.push(request.postDataJSON()?.action);
    if (narrow && url.pathname.startsWith('/api/v1/recruitment-demands')) narrowLedgerRequests.push(url.pathname);
  });
  const proof: Record<string, unknown> = { prefix: f.prefix, viewport: info.project.use.viewport,
    fictionalUpstream: true, realHrmHttpAndPages: true, mockedRoutes: false,
    sourceControl: 'owned test namespace only; no HRM ledger source-ingest endpoint',
    sourceLink: 'example.invalid hidden, not proof of a real DingTalk link' };
  try {
    await as(page, f.actors.operator, '/recruitment/demands');
    await syncThroughPage(page, f, false);
    const first = await mapThroughPage(page, f, mobile, `虚构${f.prefix}新鲜校验前核对`);
    await first.detail.getByRole('button', { name: '关闭', exact: true }).click();
    const created = await createCandidateAndApplication(page, f, mobile);
    const note = `虚构${f.prefix}上游已撤销仍保留本次意见`;
    const command = await selectHiringDemand(page, f, note);
    changeFictionalUpstream(f);
    await submitHiring(page, created.application.id, 409, false);
    await expect(command.locator('textarea')).toHaveValue(note);
    await expect(command).toContainText(f.instanceId);
    await expect(field(page, command, '招聘需求单').locator('.el-form-item__error')).toBeVisible();
    await expect(command.getByRole('button', { name: '提交录用', exact: true })).toBeDisabled();
    const invalidated = await json<Demand>(await page.request.get(`${origin}/api/v1/recruitment-demands/${first.demand.id}`,
      { headers: { authorization: `Bearer ${f.actors.operator.token}` } }), 200);
    expect(invalidated.sourceState).toBe('withdrawn'); expect(invalidated.usable).toBe(false);
    proof.freshWithdrawal = { status: 409, sourcePersisted: invalidated.sourceState, notePreserved: true };
    await capture(page, info, 'closure-01-fresh-withdrawal-preserves-input');

    const next = { ...f, ...changeFictionalUpstream(f, `${f.prefix}_next`) };
    await as(page, f.actors.operator, '/recruitment/demands');
    await syncThroughPage(page, next, false);
    const mapped = await mapThroughPage(page, next, mobile, `虚构${f.prefix}另一张有效需求独立核对`);
    await mapped.detail.getByRole('button', { name: '关闭', exact: true }).click();
    await as(page, f.actors.operator, `/talents?candidateId=${created.candidate.id}&applicationId=${created.application.id}`);
    await selectHiringDemand(page, next, `虚构${f.prefix}重新选用当前有效依据`);
    const submitted = await json<Application>(await submitHiring(page, created.application.id, 201, false), 201);
    narrow = true;
    await confirmHiring(page, next, submitted, created.name);
    narrow = false; expect(narrowLedgerRequests).toEqual([]);
    const awaiting = await openDemandProgress(page, next, mobile);
    await expect(awaiting.getByRole('button', { name: `查看应聘 ${created.name}`, exact: true }).filter({ visible: true })).toBeVisible();
    await capture(page, info, 'closure-02-awaiting-reply-progress');
    let current = await acceptOffer(page, next, submitted);
    const accepted = await openDemandProgress(page, next, mobile);
    const progress = await progressCategory(page, accepted, mapped.demand.id, 'accepted', '已接受待到岗');
    expect(progress.items).toHaveLength(1); expect(progress.items[0]).toMatchObject({ id: current.id, occupied: true });
    await accepted.getByRole('button', { name: `查看应聘 ${created.name}`, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`candidateId=${created.candidate.id}.*applicationId=${current.id}`));
    const panel = page.locator('.application-panel');
    await expect(panel.locator('.application-panel__stage')).toHaveText('已接受录用');
    await expect(panel.getByRole('button', { name: '撤回应聘', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: '终止录用', exact: true }).click();
    const termination = panel.locator('.application-panel__command');
    const beforeTermination = actions.filter(action => action === 'terminate_offer').length;
    await termination.getByRole('button', { name: '终止录用', exact: true }).click();
    await expect(field(page, termination, '终止原因').locator('.el-form-item__error')).toHaveText('请填写终止录用原因');
    expect(actions.filter(action => action === 'terminate_offer')).toHaveLength(beforeTermination);
    const reason = `虚构${f.prefix}双方明确结束本次录用`;
    await termination.locator('textarea').fill(reason);
    await termination.getByRole('button', { name: '终止录用', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '终止录用并释放名额', exact: true });
    await expect(confirmation).toContainText('不会代办撤回入职申请');
    await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
    await expect(termination.locator('textarea')).toHaveValue(reason);
    expect(actions.filter(action => action === 'terminate_offer')).toHaveLength(beforeTermination);
    await assertDemandSeats(page, f, mapped.demand.id, acceptedSeats);
    await termination.getByRole('button', { name: '终止录用', exact: true }).click();
    const ended = response(page, 'POST', `/talent-recruitment/applications/${current.id}/actions`, 'terminate_offer');
    await confirmation.getByRole('button', { name: '终止录用并释放名额', exact: true }).click();
    current = await json<Application>(await ended, 201);
    expect(current.stage).toBe('withdrawn');
    expect(actions.filter(action => action === 'terminate_offer')).toHaveLength(beforeTermination + 1);
    await expect(panel.getByRole('alert').filter({ hasText: '已终止本次录用。' })).toBeVisible();
    await assertDemandSeats(page, f, mapped.demand.id, unoccupiedSeats);
    await expectSeatDisplay(page, panel, unoccupiedSeats);
    await capture(page, info, 'closure-03-explicit-termination-once');
    const terminated = await openDemandProgress(page, next, mobile);
    const terminatedRows = await progressCategory(page, terminated, mapped.demand.id, 'terminated', '已终止');
    expect(terminatedRows.items).toHaveLength(1); expect(terminatedRows.items[0]).toMatchObject({ id: current.id, occupied: false });
    await terminated.getByRole('button', { name: `查看应聘 ${created.name}`, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`candidateId=${created.candidate.id}.*applicationId=${current.id}`));
    await expect(panel.locator('.application-panel__stage')).toHaveText('录用已终止');
    proof.termination = { applicationId: current.id, actionRequests: actions.filter(action => action === 'terminate_offer').length,
      blankReasonBlocked: true, cancelledConfirmationDidNotWrite: true, releasedTo: 2 };

    const arrival = await createCandidateAndApplication(page, next, mobile, f.actors.operator, `虚构${f.prefix}_到岗候选人`);
    await selectHiringDemand(page, next, `虚构${f.prefix}独立到岗链路`);
    const arrivalSubmitted = await json<Application>(await submitHiring(page, arrival.application.id, 201, false), 201);
    await confirmHiring(page, next, arrivalSubmitted, arrival.name);
    const arrivalAccepted = await acceptOffer(page, next, arrivalSubmitted);
    proof.onboarding = await completeOriginalOnboarding(page, next, arrivalAccepted, arrival.name, mapped.demand.id);
    // This temporary fixture combines archive maintenance and recruitment read, never production accounts.
    previewNode(`
      const actor = await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(f.actors.personnel.id)}}});
      if (actor.employeeNo !== ${JSON.stringify(f.prefix + '_personnel')}) throw Error('Unowned fixture actor');
      await db.user.update({where:{id:actor.id},data:{hrCapabilities:[...new Set([...actor.hrCapabilities,'recruitment_view'])]}});
      console.log('null');`);
    const hired = await openDemandProgress(page, next, mobile, f.actors.personnel);
    const hiredRows = await progressCategory(page, hired, mapped.demand.id, 'hired', '已到岗');
    expect(hiredRows.items).toHaveLength(1);
    const intake = proof.onboarding as { id: string };
    expect(hiredRows.items[0]).toMatchObject({ id: arrivalAccepted.id, occupied: true, onboardingRequest: { id: intake.id } });
    await capture(page, info, 'closure-04-hired-progress-original-application');
    await hired.getByRole('button', { name: `查看应聘 ${arrival.name}`, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`candidateId=${arrival.candidate.id}.*applicationId=${arrivalAccepted.id}`));
    await panel.getByRole('button', { name: '查看历史入职', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/entry-exit\\?applicationId=${intake.id}`));
    await expect(page.getByRole('dialog', { name: /办理详情$/ })).toContainText(arrival.name);
    const latest = await json<Application>(await page.request.get(`${origin}/api/v1/talent-recruitment/applications/${arrivalAccepted.id}`,
      { headers: { authorization: `Bearer ${f.actors.operator.token}` } }), 200);
    const denied = await page.request.post(`${origin}/api/v1/talent-recruitment/applications/${latest.id}/actions`, {
      headers: { authorization: `Bearer ${f.actors.operator.token}` },
      data: { action: 'terminate_offer', expectedRevision: latest.revision, note: `虚构${f.prefix}到岗不可释放` },
    });
    expect(denied.status()).toBe(400);
    await assertDemandSeats(page, f, mapped.demand.id, hiredSeats);
    await capture(page, info, 'closure-05-exact-original-intake-handoff');
    expect(errors).toEqual([]); expect(externalCalls).toEqual([]); proof.workflowPassed = true;
  } catch (cause) {
    proof.failure = cause instanceof Error ? cause.message : String(cause); throw cause;
  } finally {
    try {
      proof.cleanup = archiveFixture(f);
      expect(proof.cleanup).toMatchObject({ activeActors: 0, activeCandidates: 0, activeConverted: 0, pendingHiringReviews: 0, usableDemands: 0, upstreamFixtures: 0 });
      proof.cleanupPassed = true;
    } finally {
      proof.pageErrors = errors; proof.externalCalls = externalCalls; proof.actions = actions;
      proof.narrowConfirmerLedgerRequests = narrowLedgerRequests;
      proof.passed = proof.workflowPassed === true && proof.cleanupPassed === true;
      await writeFile(info.outputPath('closure-proof.json'), JSON.stringify(proof, null, 2));
    }
  }
});
