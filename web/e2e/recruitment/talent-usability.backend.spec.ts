import { test, expect, type APIResponse, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:5189';
const container = 'hrm-recruitment-api-check';
type Actor = { id: string; name: string; token: string };
type Candidate = { id: string; name: string; applicationA: { id: string; positionName: string }; applicationB: { id: string; positionName: string } };
type Fixture = { prefix: string; hr: Actor; employee: Actor; candidates: Record<string, Candidate> };
let fixture: Fixture;

function isolatedQuery(source: string) {
  try {
    const output = execFileSync('docker', ['exec', '-i', container, 'node'], {
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt'); const db=new PrismaClient();
        (async()=>{
          const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if(identity.db!=='hrm_preview'||identity.role!=='hrm_preview'||!(await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional)throw Error('Preview guard');
          ${source}
        })().finally(()=>db.$disconnect()).catch(()=>{process.exitCode=1});`,
      encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch {
    // Captured subprocess output can contain session tokens; never include it in an error or report.
    throw new Error('Guarded recruitment fixture operation failed');
  }
}

test.beforeAll(() => {
  const prefix = `RUB${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  fixture = isolatedQuery(`
    const result=await db.$transaction(async tx=>{
      const dept=await tx.department.findFirst({where:{name:'预览人事部'},select:{id:true}});
      const hr=await tx.user.create({data:{name:'虚构招聘HR${prefix}',employeeNo:'${prefix}_hr',accountType:'test',status:'active',sysRole:'hr',mustChangePassword:false,deptId:dept?.id}});
      const employee=await tx.user.create({data:{name:'虚构面试官${prefix}',employeeNo:'${prefix}_person',accountType:'employee',status:'active',sysRole:'employee',mustChangePassword:false,deptId:dept?.id}});
      await tx.employmentRecord.create({data:{userId:employee.id,employeeNo:employee.employeeNo,deptId:dept?.id,company:'fuede',effectiveFrom:new Date('2020-01-01'),entryDate:new Date('2020-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture',reason:'${prefix}',createdById:hr.id}});
      const session=u=>({id:u.id,name:u.name,token:new JwtService().sign({sub:u.id,employeeNo:u.employeeNo,name:u.name,sysRole:u.sysRole,deptId:u.deptId,hrCapabilities:u.hrCapabilities,isAssessorOnly:false,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'1h'})});
      const candidates={};
      for(const width of [1440,1024,390]){
        const candidate=await tx.talentCandidate.create({data:{name:'虚构招聘${prefix}_'+width,phone:'100'+String(width).padStart(8,'0'),sourceChannel:'other',createdById:hr.id,ownerId:hr.id}});
        const app=letter=>tx.talentApplication.create({data:{candidateId:candidate.id,positionName:'虚构岗位'+letter+'_${prefix}_'+width,recruitmentBatch:'${prefix}',ownerId:hr.id,createdById:hr.id,stage:'interviewing'}});
        const applicationA=await app('A'),applicationB=await app('B');
        candidates[width]={id:candidate.id,name:candidate.name,applicationA:{id:applicationA.id,positionName:applicationA.positionName},applicationB:{id:applicationB.id,positionName:applicationB.positionName}};
      }
      return {prefix:'${prefix}',hr:session(hr),employee:session(employee),candidates};
    });console.log(JSON.stringify(result));
  `) as Fixture;
});

test.afterAll(() => {
  if (!fixture) return;
  const ids = [fixture.hr.id, fixture.employee.id], candidates = Object.values(fixture.candidates).map(candidate => candidate.id);
  const result = isolatedQuery(`
    const ids=${JSON.stringify(ids)},candidates=${JSON.stringify(candidates)},prefix=${JSON.stringify(fixture.prefix)};
    const result=await db.$transaction(async tx=>{
      if(await tx.user.count({where:{id:{in:ids},employeeNo:{startsWith:prefix+'_'},name:{startsWith:'虚构'}}})!==2
        ||await tx.talentCandidate.count({where:{id:{in:candidates},createdById:ids[0],name:{contains:prefix}}})!==3)throw Error('Fixture ownership mismatch');
      const applications=(await tx.talentApplication.findMany({where:{candidateId:{in:candidates}},select:{id:true}})).map(row=>row.id);
      const interviews=(await tx.talentInterview.findMany({where:{candidateId:{in:candidates}},select:{id:true}})).map(row=>row.id);
      const external=await tx.talentInterview.count({where:{id:{in:interviews},OR:[{calendarEventId:{not:null}},{externalCalendarId:{not:null}},{syncStatus:{not:'unconfigured'}}]}});
      const pending=await tx.talentInterviewSync.count({where:{interviewId:{in:interviews},status:{in:['pending','processing','synced']}}});
      const externalNotifications=await tx.notificationLog.count({where:{userId:{in:ids},channel:{not:'system'}}});
      if(external||pending||externalNotifications)throw Error('External side-effect invariant');
      await tx.talentInterviewFeedbackEvent.deleteMany({where:{interviewId:{in:interviews}}});await tx.talentInterviewFeedback.deleteMany({where:{interviewId:{in:interviews}}});
      await tx.talentInterviewSync.deleteMany({where:{interviewId:{in:interviews}}});await tx.talentInterviewParticipant.deleteMany({where:{interviewId:{in:interviews}}});
      await tx.talentInterview.deleteMany({where:{id:{in:interviews}}});await tx.talentApplicationEvent.deleteMany({where:{applicationId:{in:applications}}});
      await tx.talentApplication.deleteMany({where:{id:{in:applications}}});await tx.talentCandidate.deleteMany({where:{id:{in:candidates},createdById:ids[0]}});
      await tx.notificationLog.deleteMany({where:{userId:{in:ids}}});await tx.auditLog.deleteMany({where:{userId:{in:ids}}});
      await tx.employmentRecord.deleteMany({where:{userId:ids[1],sourceType:'preview_fixture',reason:prefix}});await tx.user.deleteMany({where:{id:{in:ids},employeeNo:{startsWith:prefix+'_'}}});
      return {removedCandidates:candidates.length,removedApplications:applications.length,removedInterviews:interviews.length,externalCalendarWrites:external,pendingSyncs:pending,externalNotifications};
    });console.log(JSON.stringify({...result,remainingUsers:await db.user.count({where:{id:{in:ids}}}),remainingCandidates:await db.talentCandidate.count({where:{id:{in:candidates}}})}));
  `);
  expect(result).toMatchObject({ remainingUsers: 0, remainingCandidates: 0, externalCalendarWrites: 0, pendingSyncs: 0, externalNotifications: 0 });
  console.log(`Owned fixture cleanup: ${JSON.stringify(result)}`);
});

async function signIn(page: Page, actor: Actor, path: string) {
  await page.addInitScript(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
const authorization = (actor: Actor) => ({ authorization: `Bearer ${actor.token}` });
async function localApi(send: () => Promise<APIResponse>) {
  try { return await send(); } catch { throw new Error('Dedicated localhost API request failed'); }
}
function response(page: Page, method: string, path: string) {
  return page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1${path}` && result.request().method() === method);
}
async function fillDate(input: Locator, value: string) { await input.fill(value); await input.press('Tab'); }
async function discard(page: Page) {
  await page.getByRole('dialog', { name: '未保存的内容', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容', exact: true })).toHaveCount(0);
}
async function keepEditing(page: Page) {
  await page.getByRole('dialog', { name: '未保存的内容', exact: true }).getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容', exact: true })).toHaveCount(0);
}

for (const width of [1440, 1024, 390]) test(`real backend recruitment workflow and recovery at ${width}px`, async ({ page, browser }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  await page.setViewportSize({ width, height: 900 });
  const candidate = fixture.candidates[String(width)]!;
  const errors: string[] = [], outsideWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).origin !== origin) outsideWrites.push(request.method()); });
  await signIn(page, fixture.hr, `/talent-interviews?keyword=${encodeURIComponent(candidate.name)}&scope=owned`);
  const headers = authorization(fixture.hr);
  const firstPage = await localApi(() => page.request.get(`${origin}/api/v1/talent-recruitment/applications`, { headers, params: { keyword: candidate.name, scope: 'owned', page: 1, pageSize: 1 } }));
  const secondPage = await localApi(() => page.request.get(`${origin}/api/v1/talent-recruitment/applications`, { headers, params: { keyword: candidate.name, scope: 'owned', page: 2, pageSize: 1 } }));
  expect(firstPage.status()).toBe(200); expect(secondPage.status()).toBe(200);
  const first = (await firstPage.json()).data, second = (await secondPage.json()).data;
  expect(first.total).toBe(2); expect(second.total).toBe(2); expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
  expect(first.items[0].id).not.toBe(second.items[0].id);
  const queueRow = page.locator(width <= 768 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: candidate.applicationA.positionName }).filter({ visible: true });
  await queueRow.getByRole('button', { name: '办理', exact: true }).click();
  const application = page.locator('.application-panel'), panel = page.locator('.interview-panel');
  await expect(application.locator('.application-panel__stage')).toHaveText('面试中');
  await expect(panel).toContainText('暂无面试邀约');
  await panel.getByRole('button', { name: '新增面试', exact: true }).click();
  const editor = panel.locator('.interview-panel__editor');
  await fillDate(editor.locator('.interview-panel__times input').nth(0), '2020-02-01 10:00:00');
  await fillDate(editor.locator('.interview-panel__times input').nth(1), '2020-02-01 11:00:00');
  const participants = editor.locator('.el-form-item').filter({ hasText: '内部参与人' }).getByRole('combobox');
  await participants.fill(fixture.employee.name);
  await page.getByRole('option').filter({ hasText: fixture.employee.name }).click();
  await editor.getByLabel('会议邀请内容').fill(`虚构面试邀请 ${candidate.name} ${candidate.applicationA.positionName} 北京时间2020-02-01 10:00，现场面试。`);
  const created = response(page, 'POST', '/talent-interviews');
  await editor.getByRole('button', { name: '保存邀约', exact: true }).click();
  const createResponse = await created; expect(createResponse.status()).toBe(201);
  let interview = (await createResponse.json()).data;
  expect(interview.applicationId).toBe(candidate.applicationA.id); expect(interview.syncStatus).toBe('unconfigured');
  await expect(editor).toHaveCount(0);
  await expect(panel).toContainText('钉钉日程未开通');
  await expect(panel.getByRole('button', { name: '重试日程同步' })).toHaveCount(0);

  await application.getByRole('button', { name: '修改应聘', exact: true }).click();
  await application.getByLabel('岗位名称').fill(`未保存的虚构岗位_${width}`);
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '修改邀约', exact: true }).click();
  await editor.getByLabel('安排备注（内部参与人可见）').fill('虚构内部安排调整');
  const saved = response(page, 'PATCH', `/talent-interviews/${interview.id}`);
  await editor.getByRole('button', { name: '保存邀约', exact: true }).click();
  const savedResponse = await saved; expect(savedResponse.status()).toBe(200); interview = (await savedResponse.json()).data;
  await expect(editor).toHaveCount(0);
  await expect(application.getByLabel('岗位名称')).toHaveValue(`未保存的虚构岗位_${width}`);
  await application.getByRole('button', { name: '取消编辑', exact: true }).click(); await discard(page);

  const selector = application.getByRole('combobox', { name: '选择应聘记录' });
  await selector.press('ArrowDown'); await page.getByRole('option').filter({ hasText: candidate.applicationB.positionName }).click();
  await expect(panel.locator('.interview-panel__list')).toHaveCount(0);
  await selector.press('ArrowDown'); await page.getByRole('option').filter({ hasText: candidate.applicationA.positionName }).click();
  await expect(panel.locator('.interview-panel__list')).toContainText(candidate.applicationA.positionName);

  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '修改邀约', exact: true }).click();
  await editor.getByLabel('会议邀请内容').fill('真实后端409后保留的虚构邀请');
  const concurrent = await localApi(() => page.request.patch(`${origin}/api/v1/talent-interviews/${interview.id}`, { headers, data: { version: interview.version, note: '另一位经办保存的虚构备注' } }));
  expect(concurrent.status()).toBe(200);
  const conflictResponse = response(page, 'PATCH', `/talent-interviews/${interview.id}`);
  await editor.getByRole('button', { name: '保存邀约', exact: true }).click();
  expect((await conflictResponse).status()).toBe(409);
  await panel.getByRole('button', { name: '刷新邀约，保留输入', exact: true }).click();
  await expect(editor.getByLabel('会议邀请内容')).toHaveValue('真实后端409后保留的虚构邀请');
  await editor.getByRole('button', { name: '最新已保存内容（核对后重提）', exact: true }).click();
  await expect(editor.locator('.interview-panel__latest')).toContainText('另一位经办保存的虚构备注');
  const recovered = response(page, 'PATCH', `/talent-interviews/${interview.id}`);
  await editor.getByRole('button', { name: '保存邀约', exact: true }).click(); expect((await recovered).status()).toBe(200);

  await application.getByRole('button', { name: '提交录用', exact: true }).click();
  await application.getByLabel('原因 / 意见').fill('尚未提交的虚构录用意见');
  await page.locator('.talent-detail-drawer .el-drawer__close-btn').click(); await keepEditing(page);
  await expect(application.getByLabel('原因 / 意见')).toHaveValue('尚未提交的虚构录用意见');
  await page.goBack(); await keepEditing(page);
  await expect(application.getByLabel('原因 / 意见')).toHaveValue('尚未提交的虚构录用意见');
  await application.getByRole('button', { name: '取消操作', exact: true }).click(); await discard(page);
  await page.screenshot({ path: info.outputPath(`real-application-${width}.png`), animations: 'disabled' });
  expect(await page.locator('.el-drawer__body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.locator('.talent-detail-drawer .el-drawer__close-btn').click();
  await expect(page).not.toHaveURL(/candidateId=/);
  await expect(page.getByPlaceholder('搜索候选人或应聘岗位')).toHaveValue(candidate.name);
  await page.getByRole('button', { name: '人才库', exact: true }).click();
  await expect(page).toHaveURL(/\/talents$/);

  let employeeContext: BrowserContext | undefined;
  try {
    employeeContext = await browser.newContext({ baseURL: origin, viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' });
    const employeePage = await employeeContext.newPage();
    await signIn(employeePage, fixture.employee, `/talent-interviews?work=interviews&scope=mine&bucket=feedback&keyword=${encodeURIComponent(candidate.name)}`);
    for (const path of ['/talents', '/talent-recruitment/applications?scope=all', '/talent-interviews/queue?scope=all']) {
      const denied = await localApi(() => employeePage.request.get(`${origin}/api/v1${path}`, { headers: authorization(fixture.employee) })); expect(denied.status()).toBe(403);
    }
    const row = employeePage.locator(width <= 768 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: candidate.name }).filter({ visible: true });
    await row.getByRole('button', { name: '填写本人反馈', exact: true }).click();
    const feedback = employeePage.locator('.interview-feedback');
    await feedback.locator('.el-radio-button').filter({ hasText: /^通过$/ }).click();
    await feedback.getByLabel('面试意见', { exact: true }).fill(`虚构真实后端反馈_${width}`);
    await employeePage.getByRole('button', { name: '返回面试安排', exact: true }).click(); await keepEditing(employeePage);
    await expect(feedback.getByLabel('面试意见', { exact: true })).toHaveValue(`虚构真实后端反馈_${width}`);
    const submitted = response(employeePage, 'PUT', `/talent-recruitment/interviews/${interview.id}/feedback`);
    await feedback.getByRole('button', { name: '提交反馈', exact: true }).click(); expect((await submitted).status()).toBe(200);
    await expect(feedback.locator('.interview-feedback__record')).toContainText('已提交');
    await employeePage.screenshot({ path: info.outputPath(`real-feedback-${width}.png`), animations: 'disabled' });
    expect(await employeePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await employeeContext?.close(); }
  expect(errors).toEqual([]); expect(outsideWrites).toEqual([]);
});
