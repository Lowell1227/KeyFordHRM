import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test.use({ timezoneId: 'Asia/Shanghai' });

type Fixture = {
  actorId: string;
  token: string;
  candidates: Array<{ id: string; name: string }>;
  interviewId: string;
  requestId: string;
};

function database(body: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt');
      const db=new PrismaClient();
      (async()=>{
        if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional preview');
        ${body}
      })().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  }));
}

function fixture(prefix: string, withImpact = false): Fixture {
  return database(`
    const result=await db.$transaction(async tx=>{
      const dept=await tx.department.findFirstOrThrow({where:{name:'预览人事部'}});
      const actor=await tx.user.create({data:{name:'虚构${prefix}经办',employeeNo:'${prefix}',deptId:dept.id,
        status:'active',sysRole:'hr_user',hrCapabilities:['employee_archive_edit']}});
      await tx.employmentRecord.create({data:{userId:actor.id,employeeNo:actor.employeeNo,deptId:dept.id,
        company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),
        employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
      const candidates=[];
      for(const suffix of ['A','B'])candidates.push(await tx.talentCandidate.create({data:{
        name:'虚构${prefix}'+suffix,phone:'170'+String(Date.now()+candidates.length).slice(-8),
        sourceChannel:'other',ownerId:actor.id,createdById:actor.id,note:'已保存的虚构备注'+suffix}}));
      let interviewId='',requestId='';
      if(${withImpact}){
        const interview=await tx.talentInterview.create({data:{candidateId:candidates[1].id,
          candidateNameSnapshot:candidates[1].name,startsAt:new Date('2035-01-01T02:00:00Z'),
          endsAt:new Date('2035-01-01T03:00:00Z'),invitationText:'仅虚构预览，无外部邀请',createdById:actor.id}});
        interviewId=interview.id;
        // Legacy intake fixture exercises delete impact, not onboarding approval.
        const request=await tx.employeeDataChangeRequest.create({data:{employeeName:candidates[1].name,
          sourceType:'preview_fixture',sourceSystem:'${prefix}',sourceReference:'delete-impact',
          intakeType:'new_hire',onboardingStatus:'draft',recordStatus:'draft',
          talentCandidateId:candidates[1].id,proposedValue:{fictional:true},createdById:actor.id}});
        requestId=request.id;
      }
      const token=new JwtService().sign({sub:actor.id,employeeNo:actor.employeeNo,name:actor.name,
        sysRole:actor.sysRole,deptId:actor.deptId,hrCapabilities:actor.hrCapabilities,isAssessorOnly:false,canViewAll:false},
        {secret:process.env.JWT_SECRET,expiresIn:'1h'});
      return {actorId:actor.id,token,candidates:candidates.map(({id,name})=>({id,name})),interviewId,requestId};
    });console.log(JSON.stringify(result));
  `);
}

function cleanup(data: Fixture) {
  database(`
    const actorId=${JSON.stringify(data.actorId)}, ids=${JSON.stringify(data.candidates.map(item => item.id))};
    await db.$transaction(async tx=>{
      if(${JSON.stringify(data.requestId)})await tx.employeeDataChangeRequest.updateMany({
        where:{id:${JSON.stringify(data.requestId)},createdById:actorId,talentCandidateId:ids[1]},
        data:{archivedAt:new Date(),recordStatus:'archived'}});
      if(${JSON.stringify(data.interviewId)})await tx.talentInterview.updateMany({
        where:{id:${JSON.stringify(data.interviewId)},createdById:actorId,candidateId:ids[1]},data:{status:'cancelled'}});
      await tx.talentCandidate.updateMany({where:{id:{in:ids},createdById:actorId},data:{deletedAt:new Date()}});
      await tx.user.updateMany({where:{id:actorId},data:{archivedAt:new Date()}});
    });console.log('{}');
  `);
}

async function login(page: Page, data: Fixture, path: string) {
  await page.goto('/login');
  await page.evaluate(token => {
    localStorage.setItem('token', token);
    localStorage.setItem('expiresAt', String(Date.now() + 3500000));
    localStorage.removeItem('kayford.sidebar.collapsedGroups');
  }, data.token);
  await page.goto(path);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

function row(page: Page, info: TestInfo, name: string) {
  return page.locator(info.project.name === 'mobile' ? '.mobile-result-card' : '.el-table__row')
    .filter({ hasText: name }).filter({ visible: true });
}

async function search(page: Page, prefix: string) {
  const input = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/talents'
    && response.request().method() === 'GET' && new URL(response.url()).searchParams.get('keyword') === prefix);
  await input.fill(prefix); await input.press('Enter');
  expect((await loaded).ok()).toBe(true);
}

test('REC P2 real history back preserves B on cancel and opens only A on discard', async ({ page, baseURL }, info) => {
  expect(baseURL).toBe('http://localhost:5173');
  expect(info.config.globalSetup).toBeNull();
  const prefix = `RCP2_${randomUUID().slice(0, 8)}`, data = fixture(prefix);
  const [a, b] = data.candidates;
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/v1/talents/')) writes.push(request.method());
  });
  try {
    await login(page, data, '/dashboard');
    const workbench = page.getByTestId('dashboard-recruitment');
    await workbench.getByRole('tab', { name: '待跟进 2', exact: true }).click();
    await workbench.getByRole('button').filter({ hasText: a.name }).click();
    await expect(page).toHaveURL(`${baseURL}/talents?candidateId=${a.id}`);
    const detail = page.locator('.talent-detail-drawer');
    await expect(detail).toContainText(a.name);
    await detail.locator('.el-drawer__close-btn').click();
    await expect(detail).not.toBeVisible();
    await page.locator('.app-sidebar').getByRole('button', { name: '人才库', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/talents`);
    await search(page, prefix);
    await row(page, info, b.name).getByRole('button', {
      name: info.project.name === 'mobile' ? '打开详情' : '打开', exact: true,
    }).click();
    await detail.getByRole('button', { name: '编辑', exact: true }).click();
    const edit = page.locator('.talent-form-drawer'), note = edit.getByLabel('备注', { exact: true });
    await expect(edit.getByPlaceholder('候选人姓名')).toHaveValue(b.name);
    await note.fill(`未保存的${prefix}B备注`);
    const discard = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true });
    const cancelledBack = page.goBack();
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
    await cancelledBack;
    await expect(page).toHaveURL(`${baseURL}/talents`);
    await expect(note).toHaveValue(`未保存的${prefix}B备注`);
    await expect(edit.getByPlaceholder('候选人姓名')).toHaveValue(b.name);
    await expect(detail).not.toBeVisible();
    await page.screenshot({ path: info.outputPath('rec-p2-back-cancel.png'), animations: 'disabled' });
    const confirmedBack = page.goBack();
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
    await confirmedBack;
    await expect(page).toHaveURL(`${baseURL}/talents?candidateId=${a.id}`);
    await expect(edit).not.toBeVisible();
    await expect(detail).toBeVisible();
    await expect(detail.locator('.el-drawer__title')).toHaveText(a.name);
    await expect(page.locator('.el-drawer:visible')).toHaveCount(1);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('rec-p2-back-discard.png'), animations: 'disabled' });
  } finally { cleanup(data); }
});

test('REC P2 bulk 409 displays the changed real impact and waits for another click', async ({ page, baseURL }, info) => {
  expect(baseURL).toBe('http://localhost:5173');
  expect(info.config.globalSetup).toBeNull();
  const prefix = `RCD2_${randomUUID().slice(0, 8)}`, data = fixture(prefix, true);
  const [a, b] = data.candidates;
  const deletes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname);
  });
  try {
    await login(page, data, '/talents');
    await search(page, prefix);
    for (const candidate of [a, b]) {
      const candidateRow = row(page, info, candidate.name);
      await candidateRow.locator('label.el-checkbox').click();
      await expect(candidateRow.getByRole('checkbox', { name: `选择${candidate.name}`, exact: true })).toBeChecked();
    }
    await page.getByRole('button', { name: '批量删除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除人才', exact: true });
    const remove = dialog.getByRole('button', { name: '删除', exact: true });
    await expect(remove).toBeEnabled();
    await expect(dialog).toContainText('2035-01-01 10:00:00（北京时间）');
    await expect(dialog).toContainText('待面试');
    await expect(dialog).toContainText(`入职申请 ${data.requestId.slice(0, 8)}：草稿`);
    // Only this test's fixtures change concurrently; neither DELETE nor selection is bypassed.
    database(`await db.$transaction(async tx=>{
      await tx.talentInterview.update({where:{id:${JSON.stringify(data.interviewId)},candidateId:${JSON.stringify(b.id)}},
        data:{startsAt:new Date('2035-01-02T07:00:00Z'),endsAt:new Date('2035-01-02T08:00:00Z'),version:{increment:1}}});
      await tx.employeeDataChangeRequest.update({where:{id:${JSON.stringify(data.requestId)},talentCandidateId:${JSON.stringify(b.id)}},
        data:{onboardingStatus:'submitted',recordStatus:'submitted',requestVersion:{increment:1},updatedAt:new Date()}});
    });console.log('{}');`);
    const conflict = page.waitForResponse(response => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/v1/talents/${b.id}` && response.status() === 409);
    await remove.click(); await conflict;
    await expect(dialog).toContainText('已删除 1 项，剩余 1 项未完成');
    await expect(dialog).toContainText('关联影响已变化，请重新核对后删除');
    await expect(dialog).toContainText('2035-01-02 15:00:00（北京时间）');
    await expect(dialog).not.toContainText('2035-01-01 10:00:00');
    await expect(dialog).toContainText(`入职申请 ${data.requestId.slice(0, 8)}：审核中`);
    await expect(remove).toBeEnabled();
    expect(deletes).toHaveLength(2);
    const remaining = database(`console.log(JSON.stringify(await db.talentCandidate.findUnique({
      where:{id:${JSON.stringify(b.id)}},select:{deletedAt:true}})));`);
    expect(remaining.deletedAt).toBeNull();
    await page.screenshot({ path: info.outputPath('rec-p2-delete-409-details.png'), animations: 'disabled' });
    expect(deletes).toHaveLength(2);
    await remove.click();
    await expect(dialog).not.toBeVisible();
    expect(deletes).toHaveLength(3);
    const result = database(`console.log(JSON.stringify({
      deleted:await db.talentCandidate.count({where:{id:{in:${JSON.stringify([a.id, b.id])}},deletedAt:{not:null}}}),
      interview:await db.talentInterview.findUnique({where:{id:${JSON.stringify(data.interviewId)}},select:{status:true}}),
      intake:await db.employeeDataChangeRequest.findUnique({where:{id:${JSON.stringify(data.requestId)}},select:{onboardingStatus:true,archivedAt:true}})
    }));`);
    expect(result).toMatchObject({ deleted: 2, interview: { status: 'scheduled' }, intake: { onboardingStatus: 'submitted', archivedAt: null } });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  } finally { cleanup(data); }
});
