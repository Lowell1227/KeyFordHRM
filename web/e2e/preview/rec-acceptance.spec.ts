import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
type Actor = { id: string; name: string; token: string };
function fixture(prefix: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt');const db=new PrismaClient();
      (async()=>{
        if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error();
        const dept=await db.department.findFirstOrThrow({where:{name:'预览人事部'}}), result={};
        await db.$transaction(async tx=>{
        for(const [kind,role,caps] of [['editor','hr_user',['employee_archive_edit','talent_hiring_confirm']],['confirmer','employee',['talent_hiring_confirm']],['reviewer','hr',[]],['interviewer','employee',[]],['removed','employee',[]]]){
          const u=await tx.user.create({data:{name:'虚构${prefix}_'+kind,employeeNo:'${prefix}_'+kind,deptId:dept.id,status:'active',sysRole:role,hrCapabilities:caps}});
          await tx.employmentRecord.create({data:{userId:u.id,employeeNo:u.employeeNo,deptId:dept.id,company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
          const token=new JwtService().sign({sub:u.id,employeeNo:u.employeeNo,name:u.name,sysRole:u.sysRole,deptId:u.deptId,hrCapabilities:u.hrCapabilities,isAssessorOnly:false,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'1h'});
          result[kind]={id:u.id,name:u.name,token};
        }
        await tx.contractSubject.upsert({where:{name:'虚构招聘验收公司'},update:{},create:{name:'虚构招聘验收公司',internalCompany:'fuede'}});
        });
        console.log(JSON.stringify(result));
      })().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  })) as Record<string, Actor>;
}
function cleanup(prefix: string) {
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();
      (async()=>{
        const owned=await db.user.findMany({where:{employeeNo:{startsWith:'${prefix}_'}},select:{id:true}}), ids=owned.map(u=>u.id);
        const candidates=await db.talentCandidate.findMany({where:{createdById:{in:ids},name:{startsWith:'虚构闭环${prefix}'}},select:{id:true,convertedUserId:true}}), cids=candidates.map(c=>c.id);
        await db.talentApplication.updateMany({where:{candidateId:{in:cids},stage:{not:'hired'}},data:{stage:'withdrawn'}});
        await db.talentCandidate.updateMany({where:{id:{in:cids}},data:{deletedAt:new Date()}});
        await db.user.updateMany({where:{id:{in:[...ids,...candidates.map(c=>c.convertedUserId).filter(Boolean)]}},data:{archivedAt:new Date()}});
      })().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  });
}
async function as(page: Page, actor: Actor, path: string) {
  await page.goto('/login');
  await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
function response(page: Page, method: string, path: string) {
  return page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1' + path && r.request().method() === method);
}
async function value(input: Locator, text: string) { await input.fill(text); await input.press('Tab'); }
async function command(panel: Locator, name: string, note = '') {
  await panel.getByRole('button', { name, exact: true }).click();
  if (note) await panel.locator('textarea').fill(note);
  await panel.getByRole('button', { name, exact: true }).click();
  await expect(panel.locator('.application-panel__command')).toHaveCount(0);
}
async function application(panel: Locator, page: Page, candidateId: string, position: string) {
  await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
  await panel.getByLabel('岗位名称', { exact: true }).fill(position);
  const saved = response(page, 'POST', `/talent-recruitment/candidates/${candidateId}/applications`);
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
  const result = await saved; expect(result.status()).toBe(201); return (await result.json()).data;
}
async function submitIntake(page: Page, intake: Locator) {
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.locator('[data-archive-field="employee.companyText"] .el-select').click();
  await page.getByRole('option', { name: '虚构招聘验收公司', exact: true }).click();
  await intake.locator('[data-archive-field="employee.deptId"] .el-select').click();
  await page.getByRole('treeitem').filter({ hasText: '预览业务部' }).click();
  await intake.locator('[data-archive-field="employee.positionId"] .el-select').click();
  await page.getByRole('option', { name: /^预览岗位(?:（.*）)?$/ }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  for (const field of ['entryDate', 'effectiveFrom']) await value(intake.locator(`[data-archive-field="employee.${field}"] input`), today);
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  await intake.getByRole('button', { name: '下一步', exact: true }).click();
  const saved = response(page, 'POST', '/employee-archives');
  await intake.getByRole('button', { name: '提交', exact: true }).click();
  const result = await saved; expect(result.status()).toBe(201); return (await result.json()).data;
}

for (const width of [1440, 1024, 390]) test(`REC actual page closure ${width}`, async ({ page, browser }, info) => {
  expect(info.config.globalSetup).toBeNull();
  await page.setViewportSize({ width, height: 900 });
  const prefix = `RC${width}_${randomUUID().slice(0, 5)}`, name = `虚构闭环${prefix}`;
  let actors: Record<string, Actor>;
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message));
  try {
    actors = fixture(prefix);
    await as(page, actors.editor!, '/talents');
    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    await page.getByPlaceholder('候选人姓名').fill(name);
    await page.getByPlaceholder('11 位手机号').fill(`170${Date.now().toString().slice(-8)}`);
    await page.getByTestId('talent-form-source').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const created = response(page, 'POST', '/talents');
    await page.getByRole('button', { name: '加入人才库', exact: true }).click();
    const result = await created; expect(result.status()).toBe(201); const candidate = (await result.json()).data;
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(name);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    if (width < 768) await page.locator('.mobile-result-card').filter({ hasText: name }).getByRole('button', { name: '打开详情', exact: true }).click();
    else await page.getByText(name, { exact: true }).first().click();
    const detail = page.locator('.talent-detail-drawer'), follow = detail.locator('.talent-follow-ups'), panel = detail.locator('.application-panel');
    await follow.getByRole('button', { name: '补充记录', exact: true }).click();
    await follow.getByPlaceholder('本次沟通要点（必填）').fill('虚构初次沟通并安排跟进');
    await value(follow.getByPlaceholder('不设置', { exact: true }), '2035-12-01');
    await follow.getByRole('button', { name: '保存跟进', exact: true }).click();
    await expect(follow.getByRole('region', { name: '当前跟进安排' })).toContainText('2035-12-01');
    await follow.getByRole('button', { name: '补充记录', exact: true }).click();
    await follow.getByPlaceholder('本次沟通要点（必填）').fill('仅补充，不结束安排');
    await follow.getByRole('button', { name: '保存跟进', exact: true }).click();
    await expect(follow.getByRole('region', { name: '当前跟进安排' })).toContainText('2035-12-01');
    await follow.getByRole('button', { name: '完成并记录', exact: true }).click();
    await follow.getByPlaceholder('本次沟通要点（必填）').fill('完成旧安排，安排下次');
    await value(follow.getByPlaceholder('不设置', { exact: true }), '2035-12-02');
    await follow.getByRole('button', { name: '完成并保存', exact: true }).click();
    await expect(follow.getByRole('region', { name: '当前跟进安排' })).toContainText('2035-12-02');
    await follow.getByRole('button', { name: '取消安排', exact: true }).click();
    await page.getByRole('dialog', { name: '取消跟进安排', exact: true }).getByRole('button', { name: '取消安排', exact: true }).click();
    await expect(follow.getByRole('region', { name: '当前跟进安排' })).toHaveCount(0);

    const first = await application(panel, page, candidate.id, '虚构岗位A');
    await command(panel, '提交录用', '岗位A等待独立确认');
    const second = await application(panel, page, candidate.id, '虚构岗位B');
    await command(panel, '进入面试');
    await panel.getByRole('button', { name: '安排面试', exact: true }).click();
    const editor = detail.locator('.interview-panel__editor');
    await value(editor.locator('.interview-panel__times input').nth(0), '2035-12-01 10:00:00');
    await value(editor.locator('.interview-panel__times input').nth(1), '2035-12-01 11:00:00');
    for (const actor of [actors.interviewer!, actors.removed!]) {
      await editor.getByRole('combobox').last().fill(actor.name);
      await page.getByRole('option').filter({ hasText: actor.name }).click();
    }
    await page.keyboard.press('Escape');
    await editor.getByLabel('会议邀请内容').fill('虚构面试 https://meeting.tencent.com/dm/synthetic-rec');
    const invitationCreated = response(page, 'POST', '/talent-interviews');
    await editor.getByRole('button', { name: '保存邀约', exact: true }).click();
    const invitation = (await (await invitationCreated).json()).data; expect(invitation.applicationId).toBe(second.id);
    await detail.locator('.interview-panel__summary').click();
    await detail.getByRole('button', { name: '修改邀约', exact: true }).click();
    await expect(editor.getByRole('button', { name: '保存邀约', exact: true })).toBeEnabled();
    await editor.locator('.el-tag').filter({ hasText: actors.removed!.name }).locator('.el-tag__close').click();
    await value(editor.locator('.interview-panel__times input').nth(1), '2035-12-01 11:30:00');
    const edited = response(page, 'PATCH', `/talent-interviews/${invitation.id}`);
    await editor.getByRole('button', { name: '保存邀约', exact: true }).click(); expect((await edited).ok()).toBe(true);
    await detail.getByRole('button', { name: '完成面试', exact: true }).click();
    const completedInterview = response(page, 'POST', `/talent-interviews/${invitation.id}/complete`);
    await page.getByRole('dialog', { name: '面试邀约', exact: true }).getByRole('button', { name: '完成面试', exact: true }).click();
    expect((await completedInterview).status()).toBe(201);
    const participantContext = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' }); contexts.push(participantContext);
    const participantPage = await participantContext.newPage();
    participantPage.on('pageerror', error => browserErrors.push(error.message));
    await as(participantPage, actors.interviewer!, '/dashboard');
    const workbench = participantPage.getByTestId('dashboard-recruitment');
    await workbench.getByRole('tab', { name: /待补反馈 1/ }).click();
    await workbench.getByRole('button').filter({ hasText: name }).click();
    await expect(participantPage).toHaveURL(`/talent-interviews/${invitation.id}`);
    await participantPage.locator('.interview-feedback__form .el-radio-button').filter({ hasText: /^通过$/ }).click();
    await participantPage.getByLabel('面试意见', { exact: true }).fill('虚构岗位B反馈');
    await participantPage.getByRole('button', { name: '提交反馈', exact: true }).click();
    await expect(participantPage.locator('.interview-feedback__record').first()).toContainText('已提交');
    const denied = await participantPage.request.get(`/api/v1/talent-interviews/${invitation.id}`, { headers: { authorization: `Bearer ${actors.removed!.token}` } }); expect(denied.status()).toBe(404);
    await command(panel, '提交录用', '岗位B虚构面试通过');
    await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
    await expect(panel.getByRole('button', { name: '录用确认', exact: true })).toHaveCount(0);
    const current = await page.request.get(`/api/v1/talent-recruitment/applications/${second.id}`, { headers: { authorization: `Bearer ${actors.editor!.token}` } }); expect(current.ok()).toBe(true);
    const self = await page.request.post(`/api/v1/talent-recruitment/applications/${second.id}/actions`, { headers: { authorization: `Bearer ${actors.editor!.token}` }, data: { action: 'approve_hiring', expectedRevision: (await current.json()).data.revision } }); expect(self.status()).toBe(403);
    const reviewContext = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' }); contexts.push(reviewContext);
    const reviewPage = await reviewContext.newPage();
    reviewPage.on('pageerror', error => browserErrors.push(error.message));
    await as(reviewPage, actors.confirmer!, `/talent-hiring?applicationId=${second.id}`);
    const review = reviewPage.locator('.hiring-review__detail');
    await expect(review).toContainText('虚构岗位B'); await expect(review).not.toContainText('岗位A等待独立确认');
    await review.getByRole('button', { name: '退回经办', exact: true }).click();
    await review.locator('textarea').fill('补充岗位B录用意见');
    await review.getByRole('button', { name: '提交退回', exact: true }).click();
    await expect(review).toContainText('已退回经办');
    await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
    await command(panel, '提交录用', '岗位B补充后重提');
    await reviewPage.reload();
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    await expect(review).toContainText('已确认录用');
    await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
    await command(panel, '候选人接受');
    await page.goto('/dashboard');
    const own = page.getByTestId('dashboard-recruitment');
    await own.getByRole('tab', { name: /待办入职 1/ }).click();
    await own.getByRole('button').filter({ hasText: name }).click();
    const intake = page.getByRole('dialog', { name: '办理入职', exact: true });
    await expect(intake.getByLabel('姓名', { exact: true })).toHaveValue(name);
    const request = await submitIntake(page, intake); expect(request.talentApplicationId).toBe(second.id);
    await as(page, actors.reviewer!, `/entry-exit?applicationId=${request.id}`);
    const processing = page.getByRole('dialog', { name: /办理详情$/ });
    await processing.getByRole('button', { name: '通过', exact: true }).click();
    await expect(processing.getByRole('button', { name: '确认到岗', exact: true })).toBeVisible();
    const latestRequest = await page.request.get(`/api/v1/employee-archives/applications/${request.id}`, { headers: { authorization: `Bearer ${actors.reviewer!.token}` } });
    expect(latestRequest.ok()).toBe(true);
    const pendingUserId = (await latestRequest.json()).data.userId;
    expect(pendingUserId).toBeTruthy();
    const pending = await page.request.get(`/api/v1/users/${pendingUserId}`, { headers: { authorization: `Bearer ${actors.reviewer!.token}` } });
    expect(pending.ok()).toBe(true); expect((await pending.json()).data.status).toBe('pending_entry');
    const arrived = response(page, 'POST', `/employee-archives/applications/${request.id}/confirm-arrival`);
    await processing.getByRole('button', { name: '确认到岗', exact: true }).click();
    expect((await (await arrived).json()).data.onboardingStatus).toBe('effective');
    await processing.getByRole('button', { name: '查看员工档案', exact: true }).click();
    await expect(page).toHaveURL(`/users?employeeId=${pendingUserId}`);
    await expect(page.getByRole('dialog', { name: '员工档案', exact: true })).toContainText(name);
    await page.goto(`/talents?candidateId=${candidate.id}&applicationId=${first.id}`);
    await expect(page.locator('.application-panel__stage')).toHaveText('待录用确认');
    await expect(panel.locator('.el-select').first()).toContainText('虚构岗位A · 待录用确认');
    await page.screenshot({ path: info.outputPath(`rec-closure-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(browserErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    cleanup(prefix);
  }
});
