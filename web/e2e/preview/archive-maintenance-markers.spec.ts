import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
test.setTimeout(120_000);
function db(source: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 25000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
    (async()=>{if(!await p.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))throw Error('Not isolated preview');${source}})()
    .finally(()=>p.$disconnect()).catch(()=>{console.error('Isolated maintenance fixture failed');process.exitCode=1});` }));
}
async function login(page: Page) {
  await page.goto('/login');await page.getByTestId('preview-login').click();await expect(page).toHaveURL(/\/dashboard/);
}
async function get(page: Page, path: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const r = await page.request.get('/api/v1' + path, { headers: { authorization: `Bearer ${token}` } });expect(r.ok()).toBeTruthy();return (await r.json()).data;
}
test('current marker disappears after edit; exemption can be checked and reversed', async ({ page }, info) => {
  const prefix = `AM${randomUUID().slice(0, 8)}`;
  const fixture = db(`const dept=await p.department.findFirstOrThrow({where:{name:'预览业务部'}});const pos=await p.position.findFirstOrThrow({where:{code:'PREVIEW_STAFF'}});
    const subject=await p.contractSubject.create({data:{name:'虚构提醒主体${prefix}',isActive:true}});
    const u=await p.user.create({data:{employeeNo:'${prefix}',name:'虚构待完善${prefix}',accountType:'employee',sysRole:'employee',status:'active',deptId:dept.id,positionId:pos.id,position:pos.name,
      employeeProfile:{create:{childrenCount:0}},employmentHistory:{create:{effectiveFrom:new Date('2020-01-01'),entryDate:null,employeeStatus:'active',deptId:dept.id,positionId:pos.id,position:pos.name,employeeNo:'${prefix}',company:'fuede',companyText:subject.name,contractSubjectId:subject.id,changeType:'onboarding'}},
      employeeContracts:{create:{contractType:'contract',name:'劳动合同',sequence:0,signedAt:new Date('2020-01-01'),effectiveFrom:new Date('2020-01-01'),expiresAt:new Date('2035-01-01'),contractSubjectId:subject.id,signingCompany:subject.name}}}});
    console.log(JSON.stringify({id:u.id,subjectId:subject.id,name:u.name}));`) as { id: string; subjectId: string; name: string };
  try {
    if (info.project.name === 'desktop' && process.env.HRM_MAINTENANCE_WIDTH === '1024') await page.setViewportSize({ width: 1024, height: 900 });
    await login(page);await page.goto('/users');
    await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(prefix);await page.getByRole('button', { name: '查询', exact: true }).click();
    const marker = page.getByRole('button', { name: '待完善 1项', exact: true }).first();await expect(marker).toBeVisible();await marker.click();
    let dialog = page.getByRole('dialog', { name: '档案待完善事项', exact: true });
    await expect(dialog.getByRole('heading', { name: '入职日期待补充', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('pending-maintenance.png'), fullPage: true, animations: 'disabled' });
    await dialog.locator('.el-checkbox').filter({ hasText: '豁免提醒' }).click();
    await expect(dialog.getByText('暂无待完善事项', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();await expect(marker).toHaveCount(0);
    await page.getByRole('button', { name: '查看档案', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await drawer.getByRole('button', { name: '提醒设置', exact: true }).click();dialog = page.getByRole('dialog', { name: '档案待完善事项', exact: true });
    await expect(dialog.getByText('暂无待完善事项', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('exempted-maintenance.png'), fullPage: true, animations: 'disabled' });
    await dialog.getByText(/已豁免.*1项/).click();await dialog.locator('.el-checkbox:visible').filter({ hasText: '豁免提醒' }).click();
    await expect(dialog.getByRole('heading', { name: '入职日期待补充', exact: true })).toBeVisible();
    const formal = await get(page, `/employee-archives/${fixture.id}`);expect(formal.entryDate).toBeNull();
    await dialog.getByRole('button', { name: '去补充', exact: true }).click();
    const date = drawer.locator('[data-archive-field="employee.entryDate"] input');await expect(date).toBeVisible();
    await page.screenshot({ path: info.outputPath('field-maintenance.png'), fullPage: true, animations: 'disabled' });
    await date.fill('2020-01-01');await date.press('Tab');
    await drawer.getByRole('button', { name: '提交', exact: true }).click();
    await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
    await expect(drawer.getByText('入职日期待补充', { exact: true })).toHaveCount(0);
    const corrected = await get(page, `/employee-archives/${fixture.id}`);expect(corrected.entryDate.slice(0, 10)).toBe('2020-01-01');
    const issues = await get(page, `/employee-archives/issues/employee/${fixture.id}`);expect(issues.items).toHaveLength(0);
    expect(corrected.archiveEvents.filter((event: any) => event.action === 'resolve_employee_archive_current_issue')).toHaveLength(2);
    expect(corrected.archiveEvents.find((event: any) => event.action === 'resolve_employee_archive_current_issue').newValue).toMatchObject({ message: '入职日期待补充', currentValue: '未填写入职日期' });
    await drawer.getByRole('tab', { name: '变更记录', exact: true }).click();
    await expect(drawer.getByText('豁免资料提醒', { exact: true })).toBeVisible();
    await expect(drawer.getByText('取消提醒豁免', { exact: true })).toBeVisible();
    await expect(drawer.getByText(/入职日期待补充；未填写入职日期/).first()).toBeVisible();
    await drawer.getByRole('button', { name: '提醒设置', exact: true }).click();dialog = page.getByRole('dialog', { name: '档案待完善事项', exact: true });
    await expect(dialog.getByText('暂无待完善事项', { exact: true })).toBeVisible();await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await drawer.getByRole('button', { name: '关闭此对话框', exact: true }).click();await expect(marker).toHaveCount(0);
    await page.locator('.el-checkbox').filter({ hasText: '仅看待完善' }).click();await expect(page.getByText('暂无匹配员工', { exact: true }).filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('clean-after-maintenance.png'), fullPage: true, animations: 'disabled' });
  } finally {
    db(`const ids=(await p.employeeDataChangeRequest.findMany({where:{userId:'${fixture.id}'},select:{id:true}})).map(r=>r.id);
      await p.$transaction(async tx=>{await tx.auditLog.deleteMany({where:{OR:[{entityId:'${fixture.id}'},{entityId:{in:ids}}]}});
      if(tx.employeeArchiveIssueExemption)await tx.employeeArchiveIssueExemption.deleteMany({where:{userId:'${fixture.id}'}});
      await tx.employeeContract.deleteMany({where:{userId:'${fixture.id}'}});await tx.employeeNumberAssignment.deleteMany({where:{userId:'${fixture.id}'}});
      await tx.employmentRecord.deleteMany({where:{userId:'${fixture.id}'}});await tx.employeeDataChangeRequest.deleteMany({where:{userId:'${fixture.id}'}});
      await tx.employeeProfile.deleteMany({where:{userId:'${fixture.id}'}});await tx.user.delete({where:{id:'${fixture.id}'}});await tx.contractSubject.delete({where:{id:'${fixture.subjectId}'}});});console.log('{}');`);
  }
});

test('real HTTP roles, stale checkbox version, filter and formal-data isolation', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Same HTTP server and roles for all viewports');
  const prefix = `AR${randomUUID().slice(0, 8)}`;
  const result = db(`
    const assert=require('node:assert/strict'),bcrypt=require('bcrypt');
    const password=require('node:crypto').randomBytes(24).toString('hex');const passwordHash=await bcrypt.hash(password,10);
    const operators=[];let target;
    async function http(path,token,method='GET',body){const r=await fetch('http://localhost:3000/api/v1'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
    try{
      for(const [suffix,sysRole,hrCapabilities] of [['E','hr_user',['employee_archive_edit']],['R','hr_user',['employee_archive_review']],['U','employee',[]]]){
        operators.push(await p.user.create({data:{employeeNo:'${prefix}'+suffix,name:'虚构权限'+suffix,accountType:'test',sysRole,hrCapabilities,status:'active',passwordHash,mustChangePassword:false}}));
      }
      target=await p.user.create({data:{employeeNo:'${prefix}T',name:'虚构权限目标',accountType:'employee',status:'resigned',entryDate:null,deptId:(await p.department.findFirstOrThrow({where:{name:'预览业务部'}})).id,
        employeeContracts:{create:{contractType:'contract',name:'虚构协议',isActive:true,effectiveFrom:new Date('2020-01-01'),expiresAt:new Date('2035-01-01')}}}});
      const tokens=[];for(const u of operators){const r=await http('/auth/login',null,'POST',{employeeNo:u.employeeNo,password});assert.equal(r.status,200);tokens.push(r.body.data.token);}
      const endpoint='/employee-archives/issues/employee/'+target.id;
      const open=await http(endpoint,tokens[0]);assert.equal(open.status,200);assert.equal(open.body.data.items.length,1);const issue=open.body.data.items[0];
      assert.equal((await http(endpoint,tokens[1])).status,200);
      assert.equal((await http(endpoint,tokens[2])).status,403);
      const patch=endpoint+'/'+encodeURIComponent(issue.id)+'/exemption';
      const body={fingerprint:issue.fingerprint,isExempt:true,expectedVersion:0};
      assert.equal((await http(patch,tokens[1],'PATCH',body)).status,403);assert.equal((await http(patch,tokens[2],'PATCH',body)).status,403);
      const checked=await http(patch,tokens[0],'PATCH',body);assert.equal(checked.status,200);assert.equal(checked.body.data.version,1);
      assert.equal((await http(endpoint,tokens[0])).body.data.items.length,0);
      const filtered=await http('/users?keyword=${prefix}T&needsMaintenance=true&page=1&pageSize=20',tokens[0]);assert.equal(filtered.status,200);assert.equal(filtered.body.data.total,0);
      const stale=await http(patch,tokens[0],'PATCH',{...body,isExempt:false});assert.equal(stale.status,409);
      assert.equal((await http(patch,tokens[0],'PATCH',{...body,isExempt:false,expectedVersion:1})).status,200);
      assert.equal((await http(endpoint,tokens[0])).body.data.items.length,1);
      assert.equal((await p.user.findUniqueOrThrow({where:{id:target.id}})).entryDate,null);
      assert.equal(await p.employeeArchiveIssueExemption.count({where:{userId:target.id}}),1);
      assert.equal(await p.auditLog.count({where:{entityId:target.id,action:'resolve_employee_archive_current_issue'}}),2);
      await p.user.update({where:{id:target.id},data:{entryDate:new Date('2020-01-01')}});
      assert.equal((await http(endpoint,tokens[0])).body.data.items.length,0);
      console.log(JSON.stringify({rolesVerified:true,staleVersionRejected:true,formalFieldsPreserved:true,correctionClears:true}));
    }finally{
      if(target){await p.auditLog.deleteMany({where:{entityId:target.id}});await p.employeeArchiveIssueExemption.deleteMany({where:{userId:target.id}});await p.employeeContract.deleteMany({where:{userId:target.id}});await p.user.delete({where:{id:target.id}});}
      await p.user.deleteMany({where:{id:{in:operators.map(u=>u.id)}}});
    }
  `);
  expect(result).toEqual({rolesVerified:true,staleVersionRejected:true,formalFieldsPreserved:true,correctionClears:true});
});
