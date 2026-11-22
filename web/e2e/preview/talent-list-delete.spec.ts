import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function database(body: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client');const {JwtService}=require('@nestjs/jwt');const db=new PrismaClient();
      (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional preview');
      ${body}})().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  }));
}
async function login(page: Page, token: string) {
  await page.goto('/login');
  await page.evaluate(value => { localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, token);
  await page.goto('/talents');
}

test('list single/bulk confirmation and detail deletion use real backend; review-only HR is denied', async ({ page }, info) => {
  const prefix = `DEL_${randomUUID().slice(0, 8)}`;
  const data = database(`
    const dept=await db.department.findFirstOrThrow({where:{name:'预览人事部'}}), actors={};
    for(const [kind,caps] of [['editor',['employee_archive_edit']],['reader',['employee_archive_review']]]){
      const u=await db.user.create({data:{name:'虚构${prefix}'+kind,employeeNo:'${prefix}_'+kind,deptId:dept.id,status:'active',sysRole:'hr_user',hrCapabilities:caps}});
      await db.employmentRecord.create({data:{userId:u.id,employeeNo:u.employeeNo,deptId:dept.id,company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
      actors[kind]={id:u.id,token:new JwtService().sign({sub:u.id,employeeNo:u.employeeNo,name:u.name,sysRole:u.sysRole,deptId:u.deptId,hrCapabilities:caps,isAssessorOnly:false,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'1h'})};
    }
    const candidates=[];
    for(let i=0;i<4;i++)candidates.push(await db.talentCandidate.create({data:{name:'虚构${prefix}'+i,phone:'170'+String(Date.now()+i).slice(-8),sourceChannel:'other',createdById:actors.editor.id}}));
    const interview=await db.talentInterview.create({data:{candidateId:candidates[0].id,candidateNameSnapshot:candidates[0].name,startsAt:new Date('2035-01-01T02:00:00Z'),endsAt:new Date('2035-01-01T03:00:00Z'),invitationText:'虚构面试，不发送日程',createdById:actors.editor.id}});
    console.log(JSON.stringify({actors,candidates:candidates.map(({id,name})=>({id,name})),interviewId:interview.id}));
  `);
  const errors: string[] = [], deleted: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (request.method() === 'DELETE') deleted.push(new URL(request.url()).pathname); });
  const mobile = info.project.name === 'mobile';
  const row = (name: string) => page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true });
  try {
    await login(page, data.actors.editor.token);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(prefix);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    const bulk = page.getByRole('button', { name: '批量删除', exact: true });
    await expect(bulk).toBeDisabled();
    for (const item of data.candidates.slice(0, 2)) await row(item.name).getByLabel(`选择${item.name}`, { exact: true }).check();
    await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible();
    await bulk.click();
    const confirmation = page.getByRole('dialog', { name: '删除人才', exact: true });
    await expect(confirmation).toContainText('待进行面试 1 项');
    await page.screenshot({ path: info.outputPath('delete-confirmation.png'), fullPage: true, animations: 'disabled' });
    if (!mobile) {
      await page.setViewportSize({ width: 1024, height: 768 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: info.outputPath('delete-confirmation-1024.png'), fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    expect(deleted).toEqual([]);
    await expect(row(data.candidates[0].name)).toBeVisible();
    await bulk.click();
    await expect(confirmation.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
    // Another operator changes the linked fictional interview after confirmation was loaded.
    database(`await db.talentInterview.update({where:{id:'${data.interviewId}'},data:{version:{increment:1}}});console.log('{}');`);
    const conflict = page.waitForResponse(r => r.request().method() === 'DELETE' && r.status() === 409);
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    await conflict;
    await expect(confirmation).toContainText('已删除 1 项，剩余 1 项未完成');
    await expect(confirmation).toContainText('关联影响已变化');
    await expect(row(data.candidates[0].name)).toBeVisible();
    await page.screenshot({ path: info.outputPath('delete-partial-result.png'), fullPage: true, animations: 'disabled' });
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    for (const item of data.candidates.slice(0, 2)) await expect(row(item.name)).toHaveCount(0);
    expect(deleted).toHaveLength(3); // Two successful deletions plus one conflict, never auto-retried.
    await row(data.candidates[2].name).getByLabel(`选择${data.candidates[2].name}`, { exact: true }).check();
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    await expect(bulk).toBeDisabled();
    await row(data.candidates[2].name).getByRole('button', { name: '删除', exact: true }).click();
    await expect(confirmation).toContainText(data.candidates[2].name);
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await row(data.candidates[3].name).getByRole('button', { name: mobile ? '打开详情' : '打开', exact: true }).click();
    const detail = page.locator('.talent-detail-drawer');
    await detail.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('dialog', { name: '删除人才记录', exact: true }).getByRole('button', { name: '仍然删除', exact: true }).click();
    await expect(detail).not.toBeVisible();
    await expect(page.getByText('已选 0 项', { exact: true })).not.toBeVisible();
    const evidence = database(`
      const ids=${JSON.stringify(data.candidates.map((x: { id: string }) => x.id))};
      console.log(JSON.stringify({deleted:await db.talentCandidate.count({where:{id:{in:ids},deletedAt:{not:null}}}),
        audit:await db.auditLog.count({where:{entityId:{in:ids},action:'delete_talent_candidate'}}),
        interview:await db.talentInterview.findUnique({where:{id:'${data.interviewId}'},select:{status:true,syncStatus:true}})}));
    `);
    expect(evidence).toMatchObject({ deleted: 4, audit: 4, interview: { status: 'scheduled', syncStatus: 'unconfigured' } });
    await login(page, data.actors.reader.token);
    await expect(page.locator('.talent-filter-bar')).toBeVisible();
    await expect(bulk).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: '全选本页', exact: true })).toHaveCount(0);
    const denied = await page.request.delete(`/api/v1/talents/${data.candidates[0].id}`, {
      headers: { authorization: `Bearer ${data.actors.reader.token}` }, data: { impactVersion: 'v1', force: true },
    });
    expect(denied.status()).toBe(403);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath('delete-readonly.png'), fullPage: true });
  } finally {
    database(`await db.talentCandidate.updateMany({where:{id:{in:${JSON.stringify(data.candidates.map((x: { id: string }) => x.id))}},deletedAt:null},data:{deletedAt:new Date()}}); console.log('{}');`);
  }
});
