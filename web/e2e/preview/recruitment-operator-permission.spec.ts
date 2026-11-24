import { test, expect, type APIResponse, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

const origin = 'http://localhost:5173';
type Actor = { id: string; name: string; token: string };
type Fixture = { prefix: string; departmentId: string; departmentName: string;
  education: { id: string; name: string; owned: boolean };
  actors: Record<'operator' | 'confirmer' | 'personnel' | 'participant', Actor> };
type Application = { id: string; revision: number; stage: string; ownerId: string; deptId: string | null };

function previewNode<T>(body: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
        require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client');
        const db = new PrismaClient();
        (async () => {
          if ((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional !== true) throw Error('Not fictional preview');
          ${body}
        })().catch(() => { process.exitCode = 1; }).finally(() => db.$disconnect());`,
    }));
  } catch {
    throw new Error('Guarded isolated recruitment fixture operation failed; credential-bearing output suppressed');
  }
}

function createFixture(project: string): Fixture {
  const prefix = `ROP_${project === 'mobile' ? 'm' : 'd'}_${randomUUID().slice(0, 8)}`;
  return previewNode<Fixture>(`
    if (!require('fs').readFileSync('dist/src/auth/hr-capabilities.js','utf8').includes('recruitment_edit')) throw Error('Refresh preview API before this test');
    const { JwtService } = require('@nestjs/jwt');
    const result = await db.$transaction(async tx => {
      const department = await tx.department.create({data:{name:'虚构招聘经办_${prefix}'}});
      const existingEducation = await tx.personnelReferenceData.findFirst({where:{kind:'education',isActive:true},
        orderBy:{createdAt:'asc'},select:{id:true,name:true}});
      const education = existingEducation || await tx.personnelReferenceData.create({
        data:{kind:'education',name:'虚构学历_${prefix}'},select:{id:true,name:true}});
      const actors = {};
      for (const [kind,sysRole,hrCapabilities] of [
        ['operator','hr_user',['recruitment_edit','recruitment_view']],
        ['confirmer','hr',[]], ['personnel','hr_user',['employee_archive_edit']], ['participant','employee',[]],
      ]) {
        const user = await tx.user.create({data:{name:'虚构${prefix}_'+kind,employeeNo:'${prefix}_'+kind,
          deptId:department.id,status:'active',accountType:'employee',sysRole,hrCapabilities,isAssessorOnly:false}});
        await tx.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:department.id,
          company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),
          employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture',reason:'${prefix}'}});
        const token = new JwtService().sign({sub:user.id,employeeNo:user.employeeNo,name:user.name,
          sysRole:user.sysRole,deptId:user.deptId,hrCapabilities:user.hrCapabilities,isAssessorOnly:false,canViewAll:false},
          {secret:process.env.JWT_SECRET,expiresIn:'1h'});
        actors[kind] = {id:user.id,name:user.name,token};
      }
      return {prefix:'${prefix}',departmentId:department.id,departmentName:department.name,actors,
        education:{...education,owned:!existingEducation}};
    });
    console.log(JSON.stringify(result));`);
}

function ownedState(f: Fixture) {
  const safe = { prefix: f.prefix, actorIds: Object.values(f.actors).map(actor => actor.id) };
  return previewNode<Record<string, unknown>>(`
    const f = ${JSON.stringify(safe)};
    if (!/^ROP_[dm]_[a-f0-9]{8}$/.test(f.prefix)) throw Error('Invalid ownership prefix');
    const candidates = await db.talentCandidate.findMany({where:{createdById:{in:f.actorIds},name:{startsWith:'虚构'+f.prefix}},
      orderBy:{id:'asc'},select:{id:true,status:true,deletedAt:true,convertedUserId:true}});
    const candidateIds = candidates.map(row=>row.id);
    const applications = await db.talentApplication.findMany({where:{candidateId:{in:candidateIds}},orderBy:{id:'asc'},
      select:{id:true,stage:true,revision:true,ownerId:true,deptId:true,hiringRequestedById:true,hiringReviewedById:true}});
    console.log(JSON.stringify({candidates,applications,
      shares:await db.talentShare.count({where:{candidateId:{in:candidateIds}}}),
      intakes:await db.employeeDataChangeRequest.count({where:{talentCandidateId:{in:candidateIds}}})}));`);
}

function archiveFixture(f: Fixture) {
  const safe = { prefix: f.prefix, departmentId: f.departmentId, departmentName: f.departmentName,
    education: f.education, actorIds: Object.values(f.actors).map(actor => actor.id) };
  return previewNode<{ actors: number; candidates: number; activeActors: number; activeCandidates: number; educationActive: boolean }>(`
    const f = ${JSON.stringify(safe)};
    if (!/^ROP_[dm]_[a-f0-9]{8}$/.test(f.prefix)) throw Error('Invalid ownership prefix');
    const actors = await db.user.findMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},select:{id:true}});
    if (actors.length !== f.actorIds.length) throw Error('Fixture ownership mismatch');
    const where = {createdById:{in:f.actorIds},name:{startsWith:'虚构'+f.prefix}};
    const candidates = await db.talentCandidate.findMany({where,select:{id:true}}), ids = candidates.map(row=>row.id);
    if (f.education.owned && f.education.name !== '虚构学历_'+f.prefix) throw Error('Education fixture ownership mismatch');
    await db.$transaction(async tx => {
      await tx.talentShare.updateMany({where:{candidateId:{in:ids}},data:{revokedAt:new Date()}});
      await tx.employeeDataChangeRequest.updateMany({where:{createdById:{in:f.actorIds},talentCandidateId:{in:ids},
        employeeName:{startsWith:'虚构'+f.prefix},recordStatus:'draft'},data:{recordStatus:'archived',archivedAt:new Date()}});
      await tx.talentCandidate.updateMany({where,data:{deletedAt:new Date()}});
      await tx.user.updateMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},data:{archivedAt:new Date(),deletedAt:new Date()}});
      await tx.department.updateMany({where:{id:f.departmentId,name:f.departmentName},data:{isActive:false}});
      if (f.education.owned) await tx.personnelReferenceData.updateMany({where:{id:f.education.id,kind:'education',name:'虚构学历_'+f.prefix},data:{isActive:false}});
    });
    console.log(JSON.stringify({actors:actors.length,candidates:ids.length,
      activeActors:await db.user.count({where:{id:{in:f.actorIds},archivedAt:null}}),
      activeCandidates:await db.talentCandidate.count({where:{...where,deletedAt:null}}),
      educationActive:(await db.personnelReferenceData.findUniqueOrThrow({where:{id:f.education.id}})).isActive}));`);
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

function field(page: Page, scope: Locator, label: string) {
  return scope.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
}

async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: page overflow`).toBe(true);
  const drawer = page.locator('.talent-detail-drawer .el-drawer__body');
  if (await drawer.isVisible()) {
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: drawer overflow`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

async function noManagementEntries(page: Page, detail?: Locator) {
  for (const name of ['导出应聘记录', '批量删除', '确认录用', '录用确认']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  if (detail) for (const name of ['删除', '转发', '办理入职', '查看入职申请', '查看历史入职']) {
    await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}

async function openTalent(page: Page, name: string, mobile: boolean) {
  await page.goto('/talents');
  const search = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await search.fill(name); await search.press('Enter');
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row')
    .filter({ hasText: name }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  if (mobile) await row.getByRole('button', { name: '打开详情', exact: true }).click();
  else await row.getByText(name, { exact: true }).click();
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
}

async function command(page: Page, panel: Locator, applicationId: string, label: string, action: string, note = '') {
  await panel.getByRole('button', { name: label, exact: true }).click();
  const form = panel.locator('.application-panel__command');
  await expect(form).toBeVisible();
  if (note) await form.locator('textarea').fill(note);
  const result = response(page, 'POST', `/talent-recruitment/applications/${applicationId}/actions`, action);
  await form.getByRole('button', { name: label, exact: true }).click();
  if (action === 'submit_hiring') {
    const warning = page.getByRole('dialog', { name: '本次应聘仍有待处理事项', exact: true });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '仍然继续', exact: true }).click();
  }
  return json<Application>(await result, 201);
}

test('independent recruitment operator creates and submits through UI for separate hiring confirmation', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  expect(['desktop', 'mobile']).toContain(info.project.name);
  const f = createFixture(info.project.name), { operator, confirmer, personnel, participant } = f.actors;
  const mobile = info.project.name === 'mobile', name = `虚构${f.prefix}_候选人`;
  const errors: string[] = [], prohibitedCalls: string[] = [];
  const proof: Record<string, unknown> = { prefix: f.prefix, viewport: info.project.use.viewport,
    guard: 'hrm_preview fictional marker and isolated environment', mockRoutes: false, workflowWrites: 'UI only' };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/dingtalk\.com$|deepseek\.com$|openai\.com$/.test(url.hostname)
      || (request.method() !== 'GET' && /\/api\/v1\/(?:talent-resume|notifications|dingtalk)/.test(url.pathname))) {
      prohibitedCalls.push(`${request.method()} ${url.pathname}`);
    }
  });
  try {
    await as(page, operator, '/talents');
    const identity = await page.request.get(`${origin}/api/v1/auth/me`, { headers: { authorization: `Bearer ${operator.token}` } });
    const me = await json<{ sysRole: string; hrCapabilities: string[] }>(identity, 200);
    expect(me.sysRole).toBe('hr_user');
    expect([...me.hrCapabilities].sort()).toEqual(['recruitment_edit', 'recruitment_view']);
    await noManagementEntries(page);

    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    const talentForm = page.locator('.talent-form');
    await talentForm.getByPlaceholder('候选人姓名').fill(name);
    await talentForm.getByPlaceholder('11 位手机号').fill(`170${randomInt(10000000, 100000000)}`);
    await talentForm.getByTestId('talent-form-source').locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const educationListed = response(page, 'GET', '/personnel-reference-data/education');
    await field(page, talentForm, '学历').locator('.el-select__wrapper').click();
    const educationOptions = await json<Array<{ id: string; isActive: boolean }>>(await educationListed, 200);
    expect(educationOptions.every(item => item.isActive)).toBe(true);
    expect(educationOptions.some(item => item.id === f.education.id)).toBe(true);
    await expect(page.getByRole('button', { name: '新增学历', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '管理学历', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: f.education.name, exact: true }).click();
    const created = response(page, 'POST', '/talents');
    await page.getByRole('button', { name: '加入人才库', exact: true }).click();
    const createdResponse = await created;
    const candidate = await json<{ id: string; createdById: string; education: string; educationReferenceDataId: string }>(createdResponse, 201);
    expect(createdResponse.request().postDataJSON()).toMatchObject({ education: f.education.name, educationReferenceDataId: f.education.id });
    expect(candidate).toMatchObject({ education: f.education.name, educationReferenceDataId: f.education.id });
    proof.candidateId = candidate.id;
    await openTalent(page, name, mobile);
    const detail = page.locator('.talent-detail-drawer'), panel = detail.locator('.application-panel');
    await expect(detail.locator('.talent-detail__actions').getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await noManagementEntries(page, detail);
    const reloaded = response(page, 'GET', `/talents/${candidate.id}`);
    await detail.locator('.talent-detail__actions').getByRole('button', { name: '编辑', exact: true }).click();
    expect(await json<{ education: string; educationReferenceDataId: string }>(await reloaded, 200))
      .toMatchObject({ education: f.education.name, educationReferenceDataId: f.education.id });
    const reopenedForm = page.getByRole('dialog', { name: '编辑人才', exact: true });
    await expect(field(page, reopenedForm, '学历')).toContainText(f.education.name);
    await capture(page, info, '00-education-saved-and-reopened');
    await reopenedForm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(reopenedForm).not.toBeVisible();
    proof.education = { ...f.education, selectedInUi: true, persistedId: candidate.educationReferenceDataId, reopenedInUi: true };
    await openTalent(page, name, mobile);

    await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
    const applicationForm = panel.locator('.application-panel__form');
    await applicationForm.getByLabel('岗位名称', { exact: true }).fill(`虚构招聘岗位_${f.prefix}`);
    await applicationForm.getByLabel('招聘批次', { exact: true }).fill(f.prefix);
    const department = field(page, applicationForm, '部门（选填）');
    const owner = field(page, applicationForm, '应聘负责人');
    await expect(department).not.toHaveClass(/is-required/);
    await expect(owner).not.toHaveClass(/is-required/);
    await department.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: f.departmentName, exact: true }).click();
    await owner.getByRole('combobox').fill(operator.name);
    const ownerOption = page.getByRole('option').filter({ hasText: operator.name });
    await expect(ownerOption).toBeVisible(); await ownerOption.click();
    const applied = response(page, 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`);
    await applicationForm.getByRole('button', { name: '保存应聘', exact: true }).click();
    let application = await json<Application>(await applied, 201);
    expect(application).toMatchObject({ ownerId: operator.id, deptId: f.departmentId, stage: 'screening' });
    proof.applicationId = application.id;
    await panel.getByRole('button', { name: '安排面试', exact: true }).click();
    const interviewForm = detail.locator('.interview-panel__editor');
    await expect(interviewForm).toBeVisible();
    for (const [index, value] of ['2037-01-15 10:00:00', '2037-01-15 11:00:00'].entries()) {
      const input = interviewForm.locator('.interview-panel__times input').nth(index);
      await input.fill(value); await input.press('Tab');
    }
    const participants = field(page, interviewForm, '内部参与人').getByRole('combobox');
    const listedPeople = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/talent-interviews/participants'
      && new URL(result.url()).searchParams.get('keyword') === participant.name && result.request().method() === 'GET');
    await participants.fill(participant.name);
    const people = await json<{ items: Array<{ id: string; name: string }> }>(await listedPeople, 200);
    expect(people.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: participant.id, name: participant.name })]));
    const personOption = page.getByRole('option').filter({ hasText: participant.name });
    await expect(personOption).toBeVisible(); await personOption.click(); await page.keyboard.press('Escape');
    await field(page, interviewForm, '会议邀请内容（候选人版）').locator('textarea').fill(`虚构测试面试，不实际发送。${name}，请于2037年1月15日10:00到虚构测试地点参加面试。`);
    await capture(page, info, '01-operator-selects-real-fixture-participant');
    const arranged = response(page, 'POST', '/talent-interviews');
    await interviewForm.getByRole('button', { name: '保存邀约', exact: true }).click();
    const invitation = await json<{ id: string; applicationId: string; participants: Array<{ userId: string }>; syncStatus: string }>(await arranged, 201);
    expect(invitation.applicationId).toBe(application.id);
    expect(invitation.participants.map(person => person.userId)).toEqual([participant.id]);
    expect(invitation.syncStatus).toBe('unconfigured');
    proof.interview = { id: invitation.id, participantId: participant.id, picker: '/talent-interviews/participants', syncStatus: invitation.syncStatus };
    await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
    application = await command(page, panel, application.id, '提交录用', 'submit_hiring', `虚构${f.prefix}录用意见；测试安排不发送通知。`);
    expect(application.stage).toBe('hiring_review');
    await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
    await noManagementEntries(page, detail);
    const beforeDenied = ownedState(f);
    const denied: Array<[string, string, unknown?]> = [
      ['GET', '/users'], ['GET', `/employee-archives/${personnel.id}`], ['GET', '/talents/export'],
      ['DELETE', `/talents/${candidate.id}`, { impactVersion: 'invalid-fixture-only', force: false }],
      ['POST', `/talents/${candidate.id}/shares`, { recipientIds: [participant.id], expiresInDays: 7, includeResume: false }],
      ['POST', `/talent-recruitment/applications/${application.id}/actions`, { action: 'approve_hiring', expectedRevision: application.revision }],
    ];
    for (const [method, path, data] of denied) {
      const result = await page.request.fetch(`${origin}/api/v1${path}`, {
        method, headers: { authorization: `Bearer ${operator.token}` }, ...(data === undefined ? {} : { data }),
      });
      expect(result.status(), `${method} ${path}`).toBe(403);
    }
    expect(ownedState(f)).toEqual(beforeDenied);
    proof.denied = denied.map(([method, path]) => ({ method, path, status: 403 }));
    await capture(page, info, '02-operator-awaits-independent-confirmation');

    await as(page, confirmer, '/talent-hiring');
    if (mobile) await page.getByRole('button', { name: '返回待确认列表', exact: true }).click();
    await page.locator('.hiring-review__item').filter({ hasText: name }).click();
    const review = page.locator('.hiring-review__detail');
    await expect(review.getByRole('heading', { name, exact: true })).toBeVisible();
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    await review.locator('textarea').fill(`虚构${f.prefix}独立确认`);
    const approved = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'approve_hiring');
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    application = await json<Application>(await approved, 201);
    expect(application.stage).toBe('offered');
    const applicationPath = `/talent-interviews?keyword=${f.prefix}&candidateId=${candidate.id}&applicationId=${application.id}`;
    await as(page, operator, applicationPath);
    await expect(panel.locator('.application-panel__stage')).toHaveText('已确认录用');
    application = await command(page, panel, application.id, '候选人接受', 'accept_offer', '虚构候选人接受答复，仅供隔离验收。');
    expect(application.stage).toBe('accepted');
    await expect(panel).toContainText(/(?:交|联系|请).*人事.*(?:办理|入职)/);
    await noManagementEntries(page, detail);
    await capture(page, info, '03-confirmed-accepted-and-handed-to-personnel');
    const final = ownedState(f);
    expect(final.intakes).toBe(0);
    expect(final.candidates).toEqual([expect.objectContaining({ id: candidate.id, convertedUserId: null, deletedAt: null })]);
    expect(final.applications).toEqual([expect.objectContaining({ id: application.id, stage: 'accepted',
      hiringRequestedById: operator.id, hiringReviewedById: confirmer.id })]);
    proof.final = final;
    expect(errors).toEqual([]);
    expect(prohibitedCalls).toEqual([]);
  } finally {
    proof.assertionFailures = info.errors.length;
    proof.pageErrors = errors; proof.prohibitedCalls = prohibitedCalls;
    try {
      proof.cleanup = archiveFixture(f);
      expect(proof.cleanup).toMatchObject({ actors: 4, activeActors: 0, activeCandidates: 0, educationActive: !f.education.owned });
    } finally {
      await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2));
      await info.attach('recruitment-operator-proof', { path: info.outputPath('proof.json'), contentType: 'application/json' });
    }
  }
});
