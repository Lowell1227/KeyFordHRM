import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

type Actor = { id: string; name: string; token: string };
let fixture: { appId: string; departmentIds: string[]; companyIds: string[]; actors: Record<string, Actor> };

function database(body: string) {
  const source = `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt'),db=new PrismaClient();
    (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional preview');
    ${body}})().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`;
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      input: source, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch { throw new Error('Isolated confirmation fixture operation failed'); }
}

test.beforeAll(() => {
  const prefix = `CONF_${randomUUID().slice(0, 8)}`;
  fixture = database(`const result=await db.$transaction(async tx=>{
    const companyA=await tx.contractSubject.create({data:{name:'虚构${prefix}甲公司'}});
    const companyB=await tx.contractSubject.create({data:{name:'虚构${prefix}乙公司'}});
    const deptA=await tx.department.create({data:{name:'虚构${prefix}业务部',company:'fuede'}});
    const deptB=await tx.department.create({data:{name:'虚构${prefix}人事部',company:'fansibao'}});
    const actors={},records={};
    const definitions={handler:['hr_user',['confirmation_manage']],admin:['hr',[]],unauthorized:['hr_user',[]],employee:['employee',[]],manager:['employee',[]],approver:['hr_user',['confirmation_manage']]};
    for(const [kind,[role,caps]] of Object.entries(definitions)){
      const employee=kind==='employee',personnel=['handler','admin','unauthorized'].includes(kind);
      const dept=personnel?deptB:deptA,company=personnel?companyB:companyA;
      const user=await tx.user.create({data:{name:'虚构${prefix}'+kind,employeeNo:'${prefix}_'+kind,
        sysRole:role,hrCapabilities:caps,status:employee?'probation':'active',deptId:dept.id,entryDate:new Date('2026-01-01')}});
      records[kind]=await tx.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:dept.id,
        contractSubjectId:company.id,companyText:company.name,effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),
        employeeStatus:user.status,changeType:'onboarding',sourceType:'preview_fixture'}});
      actors[kind]={id:user.id,name:user.name,token:new JwtService().sign({sub:user.id,employeeNo:user.employeeNo},
        {secret:process.env.JWT_SECRET,expiresIn:'30m'})};
    }
    const app=await tx.confirmationApplication.create({data:{employeeId:actors.employee.id,
      employmentRecordId:records.employee.id,managerId:actors.manager.id,companyApproverId:actors.approver.id,
      workflowVersion:2,submissionVersion:1,status:'submitted',summary:'仅用于隔离预览的虚构工作小结'}});
    return {appId:app.id,departmentIds:[deptA.id,deptB.id],companyIds:[companyA.id,companyB.id],actors};
  });console.log(JSON.stringify(result));`);
});

test.afterAll(() => {
  if (!fixture) return;
  const ids = JSON.stringify(Object.values(fixture.actors).map(actor => actor.id));
  database(`await db.$transaction(async tx=>{
    await tx.notificationLog.deleteMany({where:{userId:{in:${ids}}}});
    await tx.auditLog.deleteMany({where:{entityType:'confirmation_application',entityId:'${fixture.appId}'}});
    await tx.confirmationApplication.delete({where:{id:'${fixture.appId}'}});
    await tx.employmentRecord.deleteMany({where:{userId:{in:${ids}},sourceType:'preview_fixture'}});
    await tx.user.deleteMany({where:{id:{in:${ids}},deptId:{in:${JSON.stringify(fixture.departmentIds)}}}});
    await tx.department.deleteMany({where:{id:{in:${JSON.stringify(fixture.departmentIds)}}}});
    await tx.contractSubject.deleteMany({where:{id:{in:${JSON.stringify(fixture.companyIds)}}}});
  });console.log('{}');`);
});

test('cross-company HR can list and submit while administrator and unauthorized roles cannot', async ({ page }, info) => {
  const { appId, actors } = fixture;
  const headers = (kind: string) => ({ authorization: `Bearer ${actors[kind]!.token}` });
  const approve = `/api/v1/confirmation-applications/${appId}/approve`;
  const manager = await page.request.post(approve, { headers: headers('manager'),
    data: { submissionVersion: 1, recommendation: true, comment: '虚构主管评价通过' } });
  expect(manager.status()).toBe(201);
  expect((await manager.json()).data.status).toBe('manager_approved');
  const notices = database(`console.log(JSON.stringify(await db.notificationLog.findMany({where:{
    userId:{in:${JSON.stringify(Object.values(actors).map(actor => actor.id))}},type:'confirmation_hr_pending',
    extraData:{path:['applicationId'],equals:'${appId}'}},select:{userId:true}})));`);
  expect(notices.map((notice: { userId: string }) => notice.userId)).toEqual([actors.handler!.id]);

  const list = await page.request.get('/api/v1/confirmation-applications?pageSize=100', { headers: headers('handler') });
  expect(list.status()).toBe(200);
  expect((await list.json()).data.items.map((item: { id: string }) => item.id)).toContain(appId);
  const pending = await page.request.get('/api/v1/confirmation-applications/pending?pageSize=100', { headers: headers('handler') });
  expect((await pending.json()).data.items.map((item: { id: string }) => item.id)).toContain(appId);
  for (const kind of ['admin', 'unauthorized', 'employee', 'approver']) {
    const detail = await page.request.get(`/api/v1/confirmation-applications/${appId}`, { headers: headers(kind) });
    expect(detail.status()).toBe(kind === 'unauthorized' ? 403 : 200);
    if (detail.ok()) expect((await detail.json()).data.canApprove).toBe(false);
    expect((await page.request.post(approve, { headers: headers(kind), data: { submissionVersion: 1 } })).status()).toBe(403);
  }

  async function login(kind: string) {
    await page.goto('/login');
    await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 1200000)); }, actors[kind]!.token);
  }
  await login('admin');
  await page.goto(`/confirmation-applications/manage/${appId}`);
  await expect(page.locator('.confirmation-detail')).toBeVisible();
  await expect(page.getByRole('button', { name: '办理', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('administrator-readonly.png'), fullPage: true });

  await login('handler');
  await page.goto('/confirmation-applications/manage');
  await expect(page.locator(`:text-is("${actors.employee!.name}"):visible`).first()).toBeVisible();
  await page.goto(`/confirmation-applications/manage/${appId}`);
  await page.getByTestId('business-detail-drawer').getByRole('button', { name: '办理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'HR 线下评议' });
  await expect(dialog).toBeVisible();
  await dialog.locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '建议转正', exact: true }).click();
  await dialog.getByPlaceholder('简述结论依据；也可只上传附件').fill('仅用于预览的虚构评议依据');
  await dialog.getByPlaceholder('拟生效日期（必填）').fill('2026-12-01');
  await dialog.getByPlaceholder('拟生效日期（必填）').press('Tab');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('cross-company-hr-action.png'), fullPage: true });
  const submitted = page.waitForResponse(response => response.url().endsWith(approve) && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '提交公司审批', exact: true }).click();
  expect((await submitted).status()).toBe(201);
  await expect(dialog).not.toBeVisible();
  const detail = await page.request.get(`/api/v1/confirmation-applications/${appId}`, { headers: headers('handler') });
  expect((await detail.json()).data).toMatchObject({ status: 'hr_approved', hrId: actors.handler!.id, canApprove: false });
});
