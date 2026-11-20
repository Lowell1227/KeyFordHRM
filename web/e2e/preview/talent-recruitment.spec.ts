import { test, expect, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test.setTimeout(240000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });
const origin = 'http://localhost:5173';
function response(page: Page, method: string, path: string) {
  return page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1${path}` && r.request().method() === method);
}
function fixture(prefix: string) {
  const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client');const {JwtService}=require('@nestjs/jwt');const db=new PrismaClient();
      (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error();
        const dept=await db.department.findFirstOrThrow({where:{name:'预览人事部'}});
        const result={};
        for(const [kind,role,caps] of [['editor','hr_user',['employee_archive_edit']],['confirmer','hr_user',['talent_hiring_confirm']],['reviewer','hr',[]],['interviewer','employee',[]]]){
          const u=await db.user.create({data:{name:'虚构${prefix}'+kind,employeeNo:'${prefix}_'+kind,deptId:dept.id,status:'active',sysRole:role,hrCapabilities:caps}});
          await db.employmentRecord.create({data:{userId:u.id,employeeNo:u.employeeNo,deptId:dept.id,company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
          const token=new JwtService().sign({sub:u.id,employeeNo:u.employeeNo,name:u.name,sysRole:u.sysRole,deptId:u.deptId,hrCapabilities:u.hrCapabilities,isAssessorOnly:false,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'1h'});
          result[kind]={id:u.id,name:u.name,token};
        }
        if(!await db.contractSubject.findUnique({where:{name:'虚构招聘验收公司'}})) await db.contractSubject.create({data:{name:'虚构招聘验收公司',internalCompany:'fuede'}});
        console.log(JSON.stringify(result));
      })().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  });
  return JSON.parse(output) as Record<string, { id: string; name: string; token: string }>;
}
async function as(page: Page, actor: { token: string }, path: string) {
  await page.goto('/login');
  await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
async function date(input: Locator, value: string) { await input.fill(value); await input.press('Tab'); }
async function openTalent(page: Page, name: string, mobile: boolean) {
  await page.goto('/talents');
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(name);
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
  if (mobile) await page.locator('.mobile-result-card').filter({ hasText: name }).getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
}
async function command(panel: Locator, action: string, note = '') {
  await panel.getByRole('button', { name: action, exact: true }).click();
  if (note) await panel.locator('textarea').fill(note);
  await panel.getByRole('button', { name: action, exact: true }).click();
}

async function submitFirstHire(page: Page, intake: Locator) {
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await page.getByRole('option', { name: '虚构招聘验收公司', exact: true }).click();
  await intake.locator('[data-archive-field="employee.deptId"] .el-select').click();
  await page.getByRole('treeitem').filter({ hasText: '预览业务部' }).click();
  await intake.locator('[data-archive-field="employee.positionId"] .el-select').click();
  await page.getByRole('option', { name: /^预览岗位(?:（.*）)?$/ }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  for (const field of ['entryDate', 'effectiveFrom']) await date(intake.locator(`[data-archive-field="employee.${field}"] input`), today);
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  const submitted = response(page, 'POST', '/employee-archives');
  await intake.getByRole('button', { name: '提交', exact: true }).click();
  const result = await submitted;
  expect(result.status()).toBe(201);
  return (await result.json()).data;
}

test('administrator grants only hiring confirmation without changing an employee role', async ({ page }, info) => {
  const prefix = `GRANT_${randomUUID().slice(0, 6)}`, actors = fixture(prefix);
  await page.goto('/login');
  await page.getByTestId('preview-account').click();
  await page.getByRole('option').filter({ hasText: '(ADMIN)' }).click();
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/users');
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号', { exact: true }).fill(actors.interviewer!.name);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const row = page.locator(info.project.name === 'mobile' ? '.mobile-result-card' : '.el-table__row').filter({ hasText: actors.interviewer!.name }).filter({ visible: true });
  await row.getByRole('button', { name: '人员设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '人员设置', exact: true });
  await dialog.getByTestId('talent-hiring-confirm-capability').click();
  await expect(dialog.getByTestId('talent-hiring-confirm-capability').locator('input')).toBeChecked();
  const saved = page.waitForResponse(r => r.url().includes(`/users/${actors.interviewer!.id}/settings`) && r.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: '保存权限', exact: true }).click();
  const result = await saved;
  expect(result.ok()).toBe(true);
  expect(result.request().postDataJSON()).toMatchObject({ sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] });
  await expect(dialog).not.toBeVisible();
  await as(page, actors.interviewer!, '/talent-hiring');
  await expect(page.locator('.hiring-review__toolbar')).toBeVisible();
  const denied = await page.request.get(`${origin}/api/v1/talents`, { headers: { authorization: `Bearer ${actors.interviewer!.token}` } });
  expect(denied.status()).toBe(403);
});

test('real recruitment pages: interviewer feedback, independent hiring, intake review and arrival', async ({ page, context }, info) => {
  expect(info.config.globalSetup).toBeNull();
  const prefix = `RC_${info.project.name}_${randomUUID().slice(0, 6)}`;
  const actors = fixture(prefix), name = `虚构人才${prefix}`, phone = `170${Date.now().toString().slice(-8)}`;
  const mobile = info.project.name === 'mobile';
  const browserErrors: string[] = [];
  page.on('pageerror', e => browserErrors.push(e.message));
  await as(page, actors.editor!, '/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  await page.getByPlaceholder('候选人姓名').fill(name);
  await page.getByPlaceholder('11 位手机号').fill(phone);
  await page.getByTestId('talent-form-source').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  const created = response(page, 'POST', '/talents');
  await page.getByRole('button', { name: '加入人才库', exact: true }).click();
  expect((await created).status()).toBe(201);
  await openTalent(page, name, mobile);
  const detail = page.locator('.talent-detail-drawer'), panel = detail.locator('.application-panel');
  await detail.getByRole('button', { name: '记一条', exact: true }).click();
  await detail.getByPlaceholder('本次沟通要点（必填）').fill('虚构候选人沟通，准备安排面试');
  await detail.getByRole('button', { name: '保存跟进', exact: true }).click();
  await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
  await panel.getByLabel('岗位名称', { exact: true }).fill('虚构研发岗位');
  await panel.getByLabel('招聘批次', { exact: true }).fill(prefix);
  const applicationCreated = page.waitForResponse(r => r.url().includes('/talent-recruitment/candidates/') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
  const application = (await (await applicationCreated).json()).data;
  await expect(panel.locator('.application-panel__stage')).toHaveText('初筛');
  await command(panel, '进入面试');
  await panel.getByRole('button', { name: '安排面试', exact: true }).click();
  const editor = detail.locator('.interview-panel__editor');
  await expect(editor).toBeVisible();
  await date(editor.locator('.interview-panel__times input').nth(0), '2035-12-01 10:00:00');
  await date(editor.locator('.interview-panel__times input').nth(1), '2035-12-01 11:00:00');
  await editor.getByRole('combobox').last().fill(actors.interviewer!.name);
  await page.getByRole('option').filter({ hasText: actors.interviewer!.name }).click();
  await page.keyboard.press('Escape');
  await editor.getByLabel('会议邀请内容').fill('虚构面试邀请 https://meeting.tencent.com/dm/fictional-review');
  const interviewCreated = response(page, 'POST', '/talent-interviews');
  await editor.getByRole('button', { name: '保存邀约', exact: true }).click();
  const interview = (await (await interviewCreated).json()).data;
  expect(interview.applicationId).toBe(application.id);
  const interviewContext = await context.browser()!.newContext({ viewport: page.viewportSize()!, timezoneId: 'Asia/Shanghai' });
  const interviewPage = await interviewContext.newPage();
  await as(interviewPage, actors.interviewer!, `/talent-interviews/${interview.id}`);
  await interviewPage.locator('.interview-feedback__form .el-radio-button').filter({ hasText: /^通过$/ }).click();
  await interviewPage.getByLabel('面试意见', { exact: true }).fill('虚构面试评价，符合本次岗位要求');
  await interviewPage.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(interviewPage.locator('.interview-feedback__record')).toContainText('已提交');
  await interviewContext.close();
  await detail.locator('.interview-panel__summary').click();
  await detail.getByRole('button', { name: '完成面试', exact: true }).click();
  await page.getByRole('dialog', { name: '面试邀约', exact: true }).getByRole('button', { name: '完成面试', exact: true }).click();
  await command(panel, '提交录用', '虚构面试通过，提交独立HR确认');
  await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
  await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
  const reviewerContext = await context.browser()!.newContext({ viewport: page.viewportSize()!, timezoneId: 'Asia/Shanghai' });
  const reviewerPage = await reviewerContext.newPage();
  await as(reviewerPage, actors.confirmer!, '/talent-hiring');
  await reviewerPage.getByRole('button').filter({ hasText: name }).click();
  const review = reviewerPage.locator('.hiring-review__detail');
  await review.getByRole('button', { name: '确认录用', exact: true }).click();
  await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
  await expect(review).toContainText('已确认录用');
  const forbidden = await reviewerPage.request.get(`${origin}/api/v1/talents`, { headers: { authorization: `Bearer ${actors.confirmer!.token}` } });
  expect(forbidden.status()).toBe(403);
  await reviewerContext.close();
  await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
  await command(panel, '候选人接受');
  await panel.getByRole('button', { name: '办理入职', exact: true }).click();
  const intake = page.getByRole('dialog', { name: '办理入职', exact: true });
  await expect(intake.getByLabel('姓名', { exact: true })).toHaveValue(name);
  const request = await submitFirstHire(page, intake);
  expect(request.talentApplicationId).toBe(application.id);
  await as(page, actors.reviewer!, `/entry-exit?applicationId=${request.id}`);
  const processing = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(processing).toContainText(name);
  await processing.getByRole('button', { name: '通过', exact: true }).click();
  await expect(processing.getByRole('button', { name: '确认到岗', exact: true })).toBeVisible();
  const arrived = response(page, 'POST', `/employee-archives/applications/${request.id}/confirm-arrival`);
  await processing.getByRole('button', { name: '确认到岗', exact: true }).click();
  const completed = (await (await arrived).json()).data;
  expect(completed.onboardingStatus).toBe('effective');
  await processing.getByRole('button', { name: '查看员工档案', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '员工档案', exact: true })).toContainText(name);
  await as(page, actors.editor!, '/talents');
  await openTalent(page, name, mobile);
  await expect(page.locator('.application-panel__stage')).toHaveText('已入职');
  await page.screenshot({ path: info.outputPath('recruitment-complete.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

for (const restoreEarlier of [false, true]) test(restoreEarlier
  ? 'two cancelled first hires open their own original applications and only A is restored'
  : 'a cancelled first hire can complete under a new accepted application on the same archive', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  const prefix = 'RF2_' + randomUUID().slice(0, 8), name = '虚构首次入职_' + prefix;
  const actors = fixture(prefix), mobile = info.project.name === 'mobile';
  const post = async (actor: string, path: string, data: unknown) => {
    const response = await page.request.post(origin + '/api/v1' + path, { headers: { authorization: 'Bearer ' + actors[actor]!.token }, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };
  try {
    const candidate = await post('editor', '/talents', { name, phone: '100' + Date.now().toString().slice(-8), sourceChannel: 'other' });
    let a = await post('editor', '/talent-recruitment/candidates/' + candidate.id + '/applications', { positionName: '虚构岗位 A' });
    for (const action of ['submit_hiring', 'approve_hiring', 'accept_offer']) {
      a = await post(action === 'approve_hiring' ? 'confirmer' : 'editor', '/talent-recruitment/applications/' + a.id + '/actions',
        { action, expectedRevision: a.revision, note: '虚构录用准备' });
    }
    await as(page, actors.editor!, '/talents');
    await openTalent(page, name, mobile);
    const panel = page.locator('.application-panel');
    const intake = page.getByRole('dialog', { name: '办理入职', exact: true });
    const processing = page.getByRole('dialog', { name: /办理详情$/ });
    const approve = async (id: string) => {
      await as(page, actors.reviewer!, '/entry-exit?applicationId=' + id);
      await processing.getByRole('button', { name: '通过', exact: true }).click();
      await expect(processing.getByRole('button', { name: '确认到岗', exact: true })).toBeVisible();
    };
    await panel.getByRole('button', { name: '办理入职', exact: true }).click();
    await expect(intake.getByLabel('姓名', { exact: true })).toHaveValue(name);
    const first = await submitFirstHire(page, intake);
    await approve(first.id);
    await processing.getByRole('button', { name: '取消本次入职', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: '取消本次入职', exact: true });
    await prompt.locator('input').fill('虚构首轮未到岗');
    const cancelled = response(page, 'POST', '/employee-archives/applications/' + first.id + '/cancel');
    await prompt.getByRole('button', { name: '确认取消', exact: true }).click();
    const old = (await (await cancelled).json()).data;
    expect(old.onboardingStatus).toBe('cancelled');
    expect(old.userId).toBeTruthy();

    await as(page, actors.editor!, '/talents');
    await openTalent(page, name, mobile);
    if (!restoreEarlier) {
      await command(panel, '撤回应聘');
      await expect(panel.locator('.application-panel__stage')).toHaveText('已撤回');
    }
    await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
    await panel.getByLabel('岗位名称', { exact: true }).fill('虚构岗位 B');
    const created = response(page, 'POST', '/talent-recruitment/candidates/' + candidate.id + '/applications');
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    const b = (await (await created).json()).data;
    await command(panel, '提交录用', '新的虚构岗位录用确认');
    await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
    await as(page, actors.confirmer!, '/talent-hiring');
    await page.getByRole('button').filter({ hasText: name }).click();
    const review = page.locator('.hiring-review__detail');
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    await expect(review).toContainText('已确认录用');
    await as(page, actors.editor!, '/talents');
    await openTalent(page, name, mobile);
    await command(panel, '候选人接受');
    await panel.getByRole('button', { name: '办理入职', exact: true }).click();
    await expect(intake.getByText('沿用原待入职档案办理本次首次入职', { exact: true })).toBeVisible();
    await expect(intake.getByRole('button', { name: '查看入职流程' })).toHaveCount(0);
    const second = await submitFirstHire(page, intake);
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ talentApplicationId: b.id, onboardingStatus: 'submitted', intakeType: 'new_hire' });
    await approve(second.id);
    if (restoreEarlier) {
      await processing.getByRole('button', { name: '取消本次入职', exact: true }).click();
      await prompt.locator('input').fill('虚构第二轮未到岗');
      const stopped = response(page, 'POST', '/employee-archives/applications/' + second.id + '/cancel');
      await prompt.getByRole('button', { name: '确认取消', exact: true }).click();
      expect((await (await stopped).json()).data.userId).toBe(old.userId);
      for (const [positionName, reqId] of [['虚构岗位 B', second.id], ['虚构岗位 A', first.id]]) {
        await as(page, actors.editor!, '/talents');
        await openTalent(page, name, mobile);
        await panel.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '选择应聘记录' }) }).click();
        await page.getByRole('option', { name: new RegExp('^' + positionName) }).click();
        await panel.getByRole('button', { name: '办理入职', exact: true }).click();
        await expect(processing.getByRole('button', { name: '重新办理入职', exact: true })).toBeVisible();
        await expect(page).toHaveURL(new RegExp('requestId=' + reqId));
      }
      await processing.getByRole('button', { name: '重新办理入职', exact: true }).click();
      const resubmitted = response(page, 'PATCH', '/employee-archives/applications/' + first.id + '/arrival-date');
      await processing.getByRole('button', { name: '重新提交审核', exact: true }).click();
      expect((await (await resubmitted).json()).data).toMatchObject({ id: first.id, talentApplicationId: a.id, onboardingStatus: 'submitted' });
      const read = async (path: string) => {
        const response = await page.request.get(origin + '/api/v1' + path, { headers: { authorization: 'Bearer ' + actors.editor!.token } });
        expect(response.status()).toBe(200);
        return (await response.json()).data;
      };
      expect(await read('/talent-recruitment/applications/' + b.id)).toMatchObject({ stage: 'accepted' });
      expect(await read('/employee-archives/applications/' + second.id)).toMatchObject({ onboardingStatus: 'cancelled', userId: old.userId });
      await post('editor', '/employee-archives/applications/' + first.id + '/cancel', { reason: '虚构验收收尾' });
      return;
    }
    const arrived = response(page, 'POST', '/employee-archives/applications/' + second.id + '/confirm-arrival');
    await processing.getByRole('button', { name: '确认到岗', exact: true }).click();
    expect((await (await arrived).json()).data).toMatchObject({ userId: old.userId, onboardingStatus: 'effective' });
    await processing.getByRole('button', { name: '查看员工档案', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '员工档案', exact: true })).toContainText(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await info.attach('first-hire-result', { body: JSON.stringify({ sameIdentity: true, oldRequest: 'cancelled', newRequest: 'effective' }), contentType: 'application/json' });
  } finally {
    const owned = { prefix, name, actorIds: Object.values(actors).map(a => a.id), editorId: actors.editor!.id };
    execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'], input: [
      "require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);",
      "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();",
      'const f=' + JSON.stringify(owned) + ';',
      '(async()=>{if((await db.systemConfig.findUnique({where:{key:"local_preview_fixture_v1"}}))?.value?.fictional!==true)throw Error("Fixture marker missing");',
      'await db.$transaction(async tx=>{const now=new Date();',
      'const candidates=await tx.talentCandidate.findMany({where:{name:f.name,createdById:f.editorId},select:{id:true}});',
      'const subjects=await tx.employeeDataChangeRequest.findMany({where:{talentCandidateId:{in:candidates.map(c=>c.id)},userId:{not:null}},select:{userId:true}});',
      'await tx.user.updateMany({where:{id:{in:subjects.map(x=>x.userId)},name:f.name},data:{archivedAt:now,deletedAt:now,status:"resigned"}});',
      'await tx.talentCandidate.updateMany({where:{id:{in:candidates.map(c=>c.id)},name:f.name,createdById:f.editorId},data:{deletedAt:now,updatedById:f.editorId}});',
      'await tx.user.updateMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+"_"}},data:{archivedAt:now,deletedAt:now,status:"resigned"}});',
      '});})().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);',
    ].join('\n') });
  }
});
