import { test, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

const origin = 'http://localhost:5173';
const resumeBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6+AAAAABJRU5ErkJggg==', 'base64');
type Actor = { id: string; name: string; token: string };
type Fixture = { prefix: string; departmentId: string; actors: Record<string, Actor> };

function previewNode(body: string) {
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
    throw new Error('Isolated preview fixture operation refused or failed; credential-bearing output suppressed');
  }
}

function createFixture(project: string): Fixture {
  const prefix = `RCB_${project[0]}_${randomUUID().slice(0, 8)}`;
  return previewNode(`
    if (!require('fs').readFileSync('dist/src/auth/hr-capabilities.js','utf8').includes('recruitment_view')) throw Error('Preview API not refreshed');
    const { JwtService } = require('@nestjs/jwt');
    const result = await db.$transaction(async tx => {
    const department = await tx.department.create({data:{name:'虚构招聘协作_${prefix}'}});
    const actors = {};
    for (const [kind, sysRole, hrCapabilities, isAssessorOnly] of [
      ['editor','hr',[],false],
      ['employee','employee',['recruitment_view'],false],
      ['performance','hr_user',['cycle_plan_edit','cycle_plan_review','performance_calibration','performance_publish','confirmation_manage','recruitment_view'],false],
      ['participant','employee',[],false],
      ['mixed','hr',['employee_archive_edit','employee_archive_review','recruitment_view'],true],
      ['approver','hr',[],false],
    ]) {
      const user = await tx.user.create({data:{name:'虚构${prefix}_'+kind,employeeNo:'${prefix}_'+kind,
        deptId:department.id,status:'active',sysRole,hrCapabilities,isAssessorOnly}});
      await tx.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:department.id,company:'fuede',
        effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture',reason:'${prefix}'}});
      actors[kind] = {id:user.id,name:user.name,token:new JwtService().sign({sub:user.id,employeeNo:user.employeeNo,
        name:user.name,sysRole:user.sysRole,deptId:user.deptId,hrCapabilities:user.hrCapabilities,isAssessorOnly:user.isAssessorOnly,canViewAll:false},
        {secret:process.env.JWT_SECRET,expiresIn:'1h'})};
    }
    return {prefix:'${prefix}',departmentId:department.id,actors};
    });
    console.log(JSON.stringify(result));`);
}

function archiveFixture(fixture: Fixture, objectKeys: string[]) {
  const safe = { prefix: fixture.prefix, departmentId: fixture.departmentId, actorIds: Object.values(fixture.actors).map(actor => actor.id), objectKeys };
  return previewNode(`
    const f = ${JSON.stringify(safe)};
    if (!/^RCB_[dm]_[a-f0-9]{8}$/.test(f.prefix)) throw Error('Invalid fixture prefix');
    const actors = await db.user.findMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},select:{id:true}});
    if (actors.length !== f.actorIds.length) throw Error('Fixture ownership changed');
    const where = {createdById:{in:f.actorIds},name:{startsWith:'虚构'+f.prefix}};
    const candidates = await db.talentCandidate.findMany({where,select:{id:true}});
    const ids = candidates.map(row=>row.id);
    await db.$transaction(async tx => {
      await tx.talentShare.updateMany({where:{candidateId:{in:ids}},data:{revokedAt:new Date()}});
      await tx.talentCandidate.updateMany({where,data:{deletedAt:new Date()}});
      await tx.user.updateMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},data:{archivedAt:new Date(),deletedAt:new Date()}});
      await tx.department.updateMany({where:{id:f.departmentId,name:'虚构招聘协作_'+f.prefix},data:{isActive:false}});
    });
    const Minio = require('minio');
    const client = new Minio.Client({endPoint:process.env.MINIO_ENDPOINT,port:Number(process.env.MINIO_PORT),useSSL:false,
      accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY});
    for (const key of f.objectKeys) {
      if (!key.startsWith('talent-resume/') || !key.endsWith(f.prefix+'-resume.png')) throw Error('Not an owned object');
      await client.removeObject(process.env.MINIO_BUCKET,key);
    }
    console.log(JSON.stringify({archivedActors:actors.length,archivedCandidates:ids.length,
      activeActors:await db.user.count({where:{id:{in:f.actorIds},deletedAt:null}}),
      activeCandidates:await db.talentCandidate.count({where:{...where,deletedAt:null}}),removedObjects:f.objectKeys.length}));`);
}

async function as(page: Page, actor: Actor, path: string) {
  await page.goto('/login');
  await page.evaluate(token => {
    localStorage.setItem('token', token);
    localStorage.setItem('expiresAt', String(Date.now() + 3500000));
  }, actor.token);
  await page.goto(path);
}

function response(page: Page, method: string, path: string) {
  return page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1${path}` && result.request().method() === method);
}

async function api(request: APIRequestContext, actor: Actor, method: string, path: string, data?: unknown) {
  return request.fetch(`${origin}/api/v1${path}`, { method, headers: { authorization: `Bearer ${actor.token}` }, data });
}

async function data(request: APIRequestContext, actor: Actor, method: string, path: string, input?: unknown, status = 200) {
  const result = await api(request, actor, method, path, input);
  expect(result.status(), `${method} ${path}`).toBe(status);
  return (await result.json()).data;
}

function field(page: Page, form: Locator, label: string) {
  return form.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function finishFixture(fixture: Fixture, objectKeys: string[], page: Page, info: TestInfo, proof: Record<string, unknown>) {
  proof.assertionFailures = info.errors.length;
  proof.lastPath = new URL(page.url()).pathname;
  proof.lastQuery = Object.fromEntries(new URL(page.url()).searchParams);
  try {
    let attempts = 0;
    await expect.poll(() => {
      attempts += 1;
      try { proof.cleanup = archiveFixture(fixture, objectKeys); return true; }
      catch { return false; }
    }, { message: 'Owned preview fixtures must be archived, including after an API refresh', timeout: 90000, intervals: [1000, 3000, 5000] }).toBe(true);
    proof.cleanupAttempts = attempts;
    expect(proof.cleanup).toMatchObject({ archivedActors: 6, activeActors: 0, activeCandidates: 0, removedObjects: objectKeys.length });
  } finally {
    await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2));
    await info.attach('real-preview-proof', { path: info.outputPath('proof.json'), contentType: 'application/json' });
  }
}

async function openTalent(page: Page, name: string, mobile: boolean) {
  await page.goto('/talents');
  const keyword = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
  await keyword.fill(name);
  await keyword.press('Enter');
  const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  if (mobile) await row.getByRole('button', { name: '打开详情', exact: true }).click();
  else await row.getByText(name, { exact: true }).click();
  await expect(page.locator('.talent-detail-drawer')).toBeVisible();
}

test('shared recruitment read boundaries, demographic editing and independent hiring on real preview', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const fixture = createFixture(info.project.name), { actors, prefix } = fixture;
  const editor = actors.editor!, employee = actors.employee!, performance = actors.performance!, mixed = actors.mixed!, participant = actors.participant!;
  const mobile = info.project.name === 'mobile', name = `虚构${prefix}_候选人`, objectKeys: string[] = [];
  const browserErrors: string[] = [], externalBusinessCalls: string[] = [];
  const proof: Record<string, unknown> = { prefix, viewport: info.project.use.viewport, guard: 'hrm isolated fictional preview', mockRoutes: false };
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/dingtalk\.com$|openai\.com$|deepseek\.com$/.test(url.hostname)) externalBusinessCalls.push(url.hostname);
  });
  try {
    await as(page, editor, '/talents');
    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    const form = page.locator('.talent-form');
    await form.getByPlaceholder('候选人姓名').fill(name);
    await form.getByPlaceholder('11 位手机号').fill(`170${randomInt(10000000, 99999999)}`);
    await field(page, form, '性别').locator('.el-radio-button').filter({ hasText: /^女$/ }).click();
    await field(page, form, '出生年份').locator('input').fill('2000');
    await field(page, form, '出生月份').locator('.el-select__wrapper').click();
    await expect(page.getByRole('option', { name: '5 月', exact: true })).toBeVisible();
    await page.getByRole('option', { name: '5 月', exact: true }).click();
    await field(page, form, '简历注明年龄').locator('input').fill('26');
    await form.getByTestId('talent-form-source').locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const created = response(page, 'POST', '/talents');
    await page.getByRole('button', { name: '加入人才库', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const candidate = (await createdResponse.json()).data;
    expect(candidate).toMatchObject({ gender: 'female', birthYear: 2000, birthMonth: 5, reportedAge: 26 });
    expect(candidate.reportedAgeRecordedAt).toBeTruthy();
    await openTalent(page, name, mobile);
    let detail = page.locator('.talent-detail-drawer');
    await detail.getByText('人才资料与简历', { exact: true }).click();
    await expect(detail).toContainText('2000年5月');
    await expect(detail).toContainText('26岁');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('01-demographics-reopened.png'), fullPage: true });
    proof.demographics = { gender: candidate.gender, birthYear: candidate.birthYear, birthMonth: candidate.birthMonth, reportedAge: candidate.reportedAge, recordedAtPresent: true };

    let application = await data(page.request, editor, 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`, {
      requestId: randomUUID(), positionName: `虚构岗位_${prefix}`, recruitmentBatch: prefix,
    }, 201);
    const meetingUrl = `https://meeting.tencent.com/dm/${prefix}`;
    const interviewBody = {
      candidateId: candidate.id, applicationId: application.id, startsAt: '2035-12-01T02:00:00Z', endsAt: '2035-12-01T03:00:00Z',
      participantIds: [employee.id, participant.id], meetingUrl,
      invitationText: `${name}，您好！\n面试时间：2035-12-01 10:00 至 2035-12-01 11:00（北京时间）\n会议链接：${meetingUrl}`,
      note: `虚构内部安排_${prefix}`,
    };
    const interview = await data(page.request, editor, 'POST', '/talent-interviews', interviewBody, 201);
    const otherInterview = await data(page.request, editor, 'POST', '/talent-interviews', { ...interviewBody,
      invitationText: interviewBody.invitationText.replaceAll('2035-12-01', '2035-12-02'),
      participantIds: [participant.id], startsAt: '2035-12-02T02:00:00Z', endsAt: '2035-12-02T03:00:00Z' }, 201);

    await test.step('application detail opens a populated editable candidate form and saves', async () => {
    await as(page, editor, `/talent-interviews?keyword=${prefix}&candidateId=${candidate.id}&applicationId=${application.id}`);
    detail = page.locator('.talent-detail-drawer');
    await expect(detail.locator('.application-panel__stage')).toHaveText('初筛');
    await detail.locator('.talent-detail__actions').getByRole('button', { name: '编辑', exact: true }).click();
    await expect(form).toBeVisible();
    await expect(field(page, form, '出生年份').locator('input')).toHaveValue('2000');
    await expect(field(page, form, '简历注明年龄').locator('input')).toHaveValue('26');
    await expect(field(page, form, '出生月份')).toContainText('5 月');
    await field(page, form, '当前职位').locator('input').fill(`虚构已编辑_${prefix}`);
    const edited = response(page, 'PATCH', `/talents/${candidate.id}`);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    expect((await edited).status()).toBe(200);
    await expect(detail).toBeVisible();
    const panel = detail.locator('.application-panel');
    await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
    await panel.getByLabel('招聘批次', { exact: true }).fill(`${prefix}_已编辑`);
    const savedApplication = response(page, 'PATCH', `/talent-recruitment/applications/${application.id}`);
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    const applicationResponse = await savedApplication;
    expect(applicationResponse.status()).toBe(200);
    application = (await applicationResponse.json()).data;
    const reopened = await data(page.request, editor, 'GET', `/talents/${candidate.id}`);
    expect(reopened).toMatchObject({ currentPosition: `虚构已编辑_${prefix}`, gender: 'female', birthYear: 2000, birthMonth: 5, reportedAge: 26 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('02-application-edit-saved.png'), fullPage: true });
    proof.applicationEdit = 'candidate form and application save both persisted on real API';
    }).catch(async error => {
      proof.applicationEditFailure = { message: (error as Error).message, url: page.url() };
      await page.screenshot({ path: info.outputPath('02-application-edit-failed.png'), fullPage: true });
      expect.soft(false, 'Application-detail editing must remain open, populated and save successfully').toBe(true);
    });

    const uploadedResponse = await page.request.post(`${origin}/api/v1/storage/upload?purpose=talent-resume`, {
      headers: { authorization: `Bearer ${editor.token}` }, multipart: { file: { name: `${prefix}-resume.png`, mimeType: 'image/png', buffer: resumeBytes } },
    });
    expect(uploadedResponse.status()).toBe(201);
    const uploaded = (await uploadedResponse.json()).data;
    const objectKey = new URL(uploaded.url, origin).searchParams.get('key')!;
    objectKeys.push(objectKey);
    await data(page.request, editor, 'POST', `/talents/${candidate.id}/files`, {
      objectKey, fileName: `${prefix}-resume.png`, mimeType: 'image/png', fileSize: resumeBytes.length,
    }, 201);

    const sharing: unknown[] = [];
    for (const [kind, actor, mineCount] of [['employee', employee, 1], ['performance', performance, 0]] as const) {
      const queueLoaded = response(page, 'GET', '/talent-recruitment/applications');
      await as(page, actor, `/talent-interviews?keyword=${prefix}`);
      const queue = await queueLoaded;
      expect(new URL(queue.url()).searchParams.get('scope')).toBe('all');
      expect((await queue.json()).data.items.map((row: { id: string }) => row.id)).toEqual([application.id]);
      await expect(page.getByRole('tab', { name: '应聘办理', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('button', { name: '新增应聘', exact: true })).toHaveCount(0);
      const interviewQueueLoaded = response(page, 'GET', '/talent-interviews/queue');
      await page.getByRole('tab', { name: '面试安排', exact: true }).click();
      const interviewQueue = await interviewQueueLoaded;
      expect(new URL(interviewQueue.url()).searchParams.get('scope')).toBe('all');
      const sharedIds = (await interviewQueue.json()).data.items.map((row: { id: string }) => row.id).sort();
      expect(sharedIds).toEqual([interview.id, otherInterview.id].sort());
      await expect(page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: name }).filter({ visible: true })).toHaveCount(2);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`03-${kind}-all-shared.png`), fullPage: true });
      const scope = page.getByRole('combobox', { name: '负责范围' });
      await scope.focus(); await scope.press('Enter');
      await expect(page.getByRole('option', { name: '我参与的面试', exact: true })).toBeVisible();
      await page.getByRole('option', { name: '我参与的面试', exact: true }).click();
      const mineLoaded = response(page, 'GET', '/talent-interviews/queue');
      await page.getByRole('button', { name: '查询', exact: true }).click();
      const mine = await mineLoaded;
      expect(new URL(mine.url()).searchParams.get('scope')).toBe('mine');
      expect((await mine.json()).data.items).toHaveLength(mineCount);
      const writableAttempts: Array<[string, string, unknown]> = [
        ['PATCH', `/talents/${candidate.id}`, { name: `${name}_禁止` }],
        ['DELETE', `/talents/${candidate.id}`, { impactVersion: 'invalid', force: false }],
        ['POST', `/talent-recruitment/candidates/${candidate.id}/applications`, { positionName: '不可新建' }],
        ['PATCH', `/talent-interviews/${interview.id}`, { version: interview.version, note: '不可修改' }],
        ['POST', `/talent-recruitment/applications/${application.id}/actions`, { action: 'approve_hiring', expectedRevision: application.revision }],
      ];
      for (const [method, path, input] of writableAttempts) expect((await api(page.request, actor, method, path, input)).status()).toBe(403);
      expect((await api(page.request, actor, 'GET', '/employee-archives/diagnostics')).status()).toBe(403);
      const workbook = await api(page.request, actor, 'GET', `/talents/export?keyword=${prefix}`);
      expect.soft(workbook.status(), `${kind} recruitment-only grant must not export the full table`).toBe(403);
      await page.goto(`/talents?keyword=${prefix}`);
      await expect.soft(page.getByRole('button', { name: '导出应聘记录', exact: true })).toHaveCount(0);
      await openTalent(page, name, mobile);
      detail = page.locator('.talent-detail-drawer');
      await expect(detail.locator('.talent-detail__actions')).toHaveCount(0);
      await expect(detail.getByRole('button', { name: '修改应聘', exact: true })).toHaveCount(0);
      await detail.getByText('人才资料与简历', { exact: true }).click();
      const download = page.waitForEvent('download');
      await detail.locator('.talent-file-list').getByRole('button', { name: '下载', exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`${prefix}-resume.png`);
      expect(await readFile((await file.path())!)).toEqual(resumeBytes);
      await as(page, actor, `/talent-interviews/${interview.id}`);
      const content = page.locator('.interview-content');
      await expect(content).toContainText(name);
      const candidateCopy = await content.locator('.interview-invitation-text').first().innerText();
      if (kind === 'employee') await page.screenshot({ path: info.outputPath('04-employee-candidate-invitation.png'), fullPage: true });
      await content.locator('.el-radio-button').filter({ hasText: /^面试官版$/ }).click();
      const interviewerCopy = await content.locator('.interview-invitation-text').first().innerText();
      for (const copy of [candidateCopy, interviewerCopy]) {
        expect(copy).toContain(meetingUrl); expect(copy).toContain('2035-12-01 10:00'); expect(copy).toContain('2035-12-01 11:00');
      }
      expect(candidateCopy).not.toContain(`/talent-interviews/${interview.id}`);
      expect(candidateCopy).not.toContain(interviewBody.note);
      expect(interviewerCopy).toContain(`/talent-interviews/${interview.id}`);
      await expect(content.getByRole('link', { name: '打开腾讯会议', exact: true })).toHaveAttribute('href', meetingUrl);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`04-${kind}-internal-invitation.png`), fullPage: true });
      sharing.push({ kind, sharedIds, defaultScope: 'all', mineCount, deniedWriteRequests: writableAttempts.length, resumeBytesMatched: true,
        tableExportStatus: workbook.status(), tableExportDenied: workbook.status() === 403, bothInvitationsMatched: true });
    }
    proof.sharing = sharing;

    for (const path of [`/talents?keyword=${prefix}`, `/talents/${candidate.id}`, `/talents/export?keyword=${prefix}`,
      '/talent-recruitment/applications?scope=all', '/talent-interviews/queue?scope=all', `/storage/download?key=${encodeURIComponent(objectKey)}`]) {
      expect((await api(page.request, mixed, 'GET', path)).status(), path).toBe(403);
    }
    const ownInvitation = await data(page.request, participant, 'GET', `/talent-interviews/${interview.id}`);
    for (const key of ['candidateId', 'applicationId', 'participants', 'application', 'syncStatus']) expect(ownInvitation).not.toHaveProperty(key);
    expect((await api(page.request, participant, 'GET', `/talents/${candidate.id}`)).status()).toBe(403);
    expect((await api(page.request, participant, 'GET', `/storage/download?key=${encodeURIComponent(objectKey)}`)).status()).toBe(403);
    proof.denials = { mixedAssessorFullReads: 6, ordinaryParticipantMinimal: true };

    application = await data(page.request, editor, 'POST', `/talent-recruitment/applications/${application.id}/actions`, {
      action: 'submit_hiring', expectedRevision: application.revision, note: `虚构独立录用_${prefix}`,
    }, 201);
    const selfApproval = await api(page.request, editor, 'POST', `/talent-recruitment/applications/${application.id}/actions`, {
      action: 'approve_hiring', expectedRevision: application.revision,
    });
    expect(selfApproval.status()).toBe(403);
    expect((await selfApproval.json()).message).toContain('不能确认本人提交');
    await as(page, actors.approver!, `/talent-hiring?applicationId=${application.id}`);
    const review = page.locator('.hiring-review__detail');
    await expect(review).toContainText(name);
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    const approved = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`);
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    const approvedResponse = await approved;
    expect(approvedResponse.status()).toBe(201);
    const finalApplication = (await approvedResponse.json()).data;
    expect(finalApplication).toMatchObject({ stage: 'offered', hiringRequestedById: editor.id, hiringReviewedById: actors.approver!.id });
    await expect(review).toContainText('已确认录用');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('05-independent-hiring-approved.png'), fullPage: true });
    proof.hiring = { selfStatus: 403, otherApproved: true, submitterPreserved: true };
    expect(browserErrors).toEqual([]);
    expect(externalBusinessCalls).toEqual([]);
    proof.browserErrors = browserErrors; proof.externalBusinessCalls = externalBusinessCalls;
  } finally {
    await finishFixture(fixture, objectKeys, page, info, proof);
  }
});

test('application detail editor survives drawer transitions and reopens saved demographics', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const fixture = createFixture(info.project.name), { actors, prefix } = fixture, editor = actors.editor!;
  const name = `虚构${prefix}_候选人`, errors: string[] = [];
  const proof: Record<string, unknown> = { prefix, viewport: info.project.use.viewport, scope: 'application detail edit/save/reopen only', mockRoutes: false };
  page.on('pageerror', error => errors.push(error.message));
  try {
    const candidate = await data(page.request, editor, 'POST', '/talents', {
      name, phone: `170${randomInt(10000000, 99999999)}`, sourceChannel: 'other', gender: 'female', birthYear: 2000, birthMonth: 5, reportedAge: 26,
    }, 201);
    const application = await data(page.request, editor, 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`, {
      requestId: randomUUID(), positionName: `虚构岗位_${prefix}`, recruitmentBatch: prefix,
    }, 201);
    await as(page, editor, `/talent-interviews?keyword=${prefix}&candidateId=${candidate.id}&applicationId=${application.id}`);
    const detail = page.locator('.talent-detail-drawer'), form = page.locator('.talent-form');
    await expect(detail.locator('.application-panel__stage')).toHaveText('初筛');
    const populated = response(page, 'GET', `/talents/${candidate.id}`);
    await detail.locator('.talent-detail__actions').getByRole('button', { name: '编辑', exact: true }).click();
    expect((await populated).status()).toBe(200);
    await expect(form).toBeVisible();
    const birthYear = field(page, form, '出生年份').locator('input');
    await expect(birthYear).toHaveValue('2000');
    const numericState = await birthYear.evaluate((element: HTMLInputElement) => ({
      disabled: element.disabled, ariaDisabled: element.getAttribute('aria-disabled'),
      wrapperDisabled: element.closest('.el-input-number')?.classList.contains('is-disabled'),
    }));
    proof.numericControlBeforeInput = numericState;
    expect(numericState.disabled).toBe(false);
    expect(numericState.wrapperDisabled).toBe(false);
    await expect(field(page, form, '出生月份')).toContainText('5 月');
    await expect(field(page, form, '简历注明年龄').locator('input')).toHaveValue('26');
    await expect(field(page, form, '性别').getByRole('radio', { name: '女', exact: true })).toBeChecked();
    await birthYear.fill('1999', { timeout: 3000 });
    await birthYear.press('Tab');
    await expect(birthYear).toHaveValue('1999');
    await expect(birthYear).toBeEnabled();
    await expect(birthYear).toHaveAttribute('aria-disabled', 'false');
    const position = `虚构已修复编辑_${prefix}`;
    await field(page, form, '当前职位').locator('input').fill(position);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('01-populated-editor.png'), fullPage: true, animations: 'disabled' });
    const saved = response(page, 'PATCH', `/talents/${candidate.id}`);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect((await savedResponse.json()).data).toMatchObject({ currentPosition: position, gender: 'female', birthYear: 1999, birthMonth: 5, reportedAge: 26 });
    await expect(form).not.toBeVisible();
    await expect(detail).toBeVisible();
    expect(new URL(page.url()).searchParams.get('candidateId')).toBe(candidate.id);
    expect(new URL(page.url()).searchParams.get('applicationId')).toBe(application.id);
    await expect(detail.locator('.application-panel__stage')).toHaveText('初筛');
    await detail.getByText('人才资料与简历', { exact: true }).click();
    await expect(detail).toContainText(position);
    await expect(detail).toContainText('1999年5月');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('02-saved-detail.png'), fullPage: true, animations: 'disabled' });
    await detail.locator('.talent-detail__actions').getByRole('button', { name: '编辑', exact: true }).click();
    await expect(field(page, form, '当前职位').locator('input')).toHaveValue(position);
    await expect(field(page, form, '出生年份').locator('input')).toHaveValue('1999');
    await expect(field(page, form, '出生年份').locator('input')).toBeEnabled();
    await expect(field(page, form, '出生月份')).toContainText('5 月');
    await expect(field(page, form, '简历注明年龄').locator('input')).toHaveValue('26');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(detail).toBeVisible();
    expect(new URL(page.url()).searchParams.get('applicationId')).toBe(application.id);
    const reread = await data(page.request, editor, 'GET', `/talents/${candidate.id}`);
    expect(reread).toMatchObject({ currentPosition: position, birthYear: 1999, birthMonth: 5, reportedAge: 26 });
    expect(errors).toEqual([]);
    proof.editor = { populated: true, savedStatus: 200, numericFillSavedYear: 1999, demographicFieldsPreserved: true, applicationDeepLinkPreserved: true, reopened: true, cancelRestoredDetail: true };
    proof.browserErrors = errors;
  } finally {
    await finishFixture(fixture, [], page, info, proof);
  }
});
