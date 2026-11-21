import { test, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Real fixed-preview API and UI only. No mocked responses, external providers, or shared seed changes.
test.setTimeout(240000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000, trace: 'off', video: 'off', screenshot: 'off' });
const origin = 'http://localhost:5173';
type Actor = { id: string; employeeNo: string; token: string };
type Fixture = { prefix: string; name: string; phone: string; active: { id: string; name: string }; inactive: { id: string; name: string }; editor: Actor; confirmer: Actor; extraActorIds?: string[] };
type Share = { id: string; token: string; url: string };
class SafePreviewFailure extends Error {}

function fixtureQuery<T>(source: string): T {
  let stage = 'inspect project';
  try {
    const project = execFileSync('docker', ['inspect', 'hrm-api-1', '--format', '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (project !== 'hrm') throw new Error('Preview Compose project mismatch');
    stage = 'execute guarded transaction';
    const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
        require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        if (process.env.AI_RESUME_PARSING_ENABLED !== 'false') throw Error('Ordinary fixture requires AI disabled');
        const {PrismaClient}=require('@prisma/client'); const db=new PrismaClient();
        (async()=>{
          const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
          const marker=await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}});
          if(identity.db!=='hrm_preview'||identity.role!=='hrm_preview'||marker?.value?.fictional!==true)throw Error('Preview data guard refused');
          ${source}
        })().finally(()=>db.$disconnect()).catch(error=>{
          process.stderr.write('HRM_FIXTURE_ERROR:'+JSON.stringify({name:error.name,code:error.code??null})+'\\n');process.exitCode=1;
        });`,
    });
    stage = 'decode in-memory fixture';
    return JSON.parse(output) as T;
  } catch (error) {
    // stdout may contain a JWT: never expose subprocess errors or raw output.
    const stderr = String((error as { stderr?: Buffer }).stderr ?? '');
    const marker = stderr.match(/HRM_FIXTURE_ERROR:(\{[^\r\n]+\})/);
    let reason = error instanceof Error ? error.name : 'unknown';
    if (marker) {
      try { const parsed = JSON.parse(marker[1]!); reason = `${String(parsed.name).replace(/[^A-Za-z]/g, '')}/${String(parsed.code).replace(/[^A-Za-z0-9]/g, '')}`; } catch { /* Do not reveal unrecognized child output. */ }
    }
    throw new SafePreviewFailure(`Guarded fictional preview fixture failed at ${stage} (${reason})`);
  }
}

function createFixture(project: string): Fixture {
  const prefix = `TF_${project === 'desktop' ? 'pc' : 'm'}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const phone = `100${String(randomInt(100000000)).padStart(8, '0')}`;
  return fixtureQuery<Fixture>(`
    const prefix=${JSON.stringify(prefix)},phone=${JSON.stringify(phone)};
    const result=await db.$transaction(async tx=>{
      const active=await tx.department.create({data:{name:'虚构反馈有效部_'+prefix,isActive:true},select:{id:true,name:true}});
      const inactive=await tx.department.create({data:{name:'虚构反馈停用部_'+prefix,isActive:false},select:{id:true,name:true}});
      const result={prefix,phone,name:'虚构反馈人才_'+prefix,active,inactive};
      for(const [kind,capability] of [['editor','employee_archive_edit'],['confirmer','talent_hiring_confirm']]){
        const user=await tx.user.create({data:{name:'虚构反馈_'+prefix+'_'+kind,employeeNo:prefix+'_'+kind,
          accountType:'employee',sysRole:'hr_user',status:'active',deptId:active.id,hrCapabilities:[capability]}});
        await tx.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:active.id,
          company:'fuede',effectiveFrom:new Date('2000-01-01'),entryDate:new Date('2000-01-01'),employeeStatus:'active',
          changeType:'onboarding',sourceType:'preview_fixture',reason:prefix,createdById:user.id}});
        const {JwtService}=require('@nestjs/jwt');
        const token=new JwtService({secret:process.env.JWT_SECRET}).sign({sub:user.id,employeeNo:user.employeeNo},{expiresIn:'20m'});
        result[kind]={id:user.id,employeeNo:user.employeeNo,token};
      }
      return result;
    });
    console.log(JSON.stringify(result));
  `);
}

function archiveFixture(f: Fixture) {
  // Only this test's generated IDs and prefix are eligible. Keep files, audit, events and applications.
  const owned = { prefix: f.prefix, name: f.name, actorIds: [f.editor.id, f.confirmer.id, ...(f.extraActorIds ?? [])], editorId: f.editor.id, departmentIds: [f.active.id, f.inactive.id] };
  return fixtureQuery<{ archivedActors: number; activeCandidates: number; activeShares: number }>(`
    const f=${JSON.stringify(owned)};
    const result=await db.$transaction(async tx=>{
      if(await tx.user.count({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}}})!==f.actorIds.length
        ||await tx.department.count({where:{id:{in:f.departmentIds},name:{endsWith:f.prefix}}})!==2)throw Error('Fixture ownership mismatch');
      const candidates=await tx.talentCandidate.findMany({where:{name:{startsWith:f.name},createdById:f.editorId},select:{id:true,deletedAt:true}});
      const candidateIds=candidates.map(row=>row.id), now=new Date();
      await tx.talentShare.updateMany({where:{candidateId:{in:candidateIds},createdById:f.editorId,revokedAt:null},data:{revokedAt:now}});
      for(const row of candidates.filter(row=>!row.deletedAt)){
        await tx.talentCandidate.update({where:{id:row.id},data:{deletedAt:now,updatedById:f.editorId}});
        await tx.auditLog.create({data:{userId:f.editorId,action:'preview_fixture_cleanup',entityType:'talent_candidate',entityId:row.id,newValue:{deleted:true,fixture:f.prefix}}});
      }
      await tx.user.updateMany({where:{id:{in:f.actorIds},employeeNo:{startsWith:f.prefix+'_'}},data:{status:'resigned',archivedAt:now,deletedAt:now}});
      await tx.department.updateMany({where:{id:{in:f.departmentIds},name:{endsWith:f.prefix}},data:{isActive:false}});
      return {
        archivedActors:await tx.user.count({where:{id:{in:f.actorIds},archivedAt:{not:null},deletedAt:{not:null}}}),
        activeCandidates:await tx.talentCandidate.count({where:{id:{in:candidateIds},deletedAt:null}}),
        activeShares:await tx.talentShare.count({where:{candidateId:{in:candidateIds},revokedAt:null}})
      };
    });
    console.log(JSON.stringify(result));
  `);
}

async function api(request: APIRequestContext, method: string, path: string, data?: unknown) {
  try { return await request.fetch(`${origin}/api/v1${path}`, { method, ...(data === undefined ? {} : { data }) }); }
  catch { throw new Error('Fixed preview API transport failed'); }
}

async function dataOf<T>(request: APIRequestContext, method: string, path: string, expectedStatus: number, data?: unknown): Promise<T> {
  const response = await api(request, method, path, data);
  if (response.status() !== expectedStatus) throw new SafePreviewFailure(`API status ${response.status()}, expected ${expectedStatus}`);
  const body = await response.json();
  expect(body.code).toBe(0);
  return body.data as T;
}

async function go(page: Page, path: string) {
  try { await page.goto(path); } catch { throw new Error('Fixed preview page navigation failed'); }
}

function response(page: Page, method: string, path: string) {
  return page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === `/api/v1${path}`);
}

async function openTalent(page: Page, name: string, mobile: boolean) {
  await go(page, '/talents');
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(name);
  const found = response(page, 'GET', '/talents');
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
  expect((await found).status()).toBe(200);
  if (mobile) await page.locator('.mobile-result-card').filter({ hasText: name }).getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(name, { exact: true }).first().click();
  const drawer = page.locator('.talent-detail-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

async function action(panel: Locator, label: string, note: string) {
  await panel.getByRole('button', { name: label, exact: true }).click();
  await panel.locator('.application-panel__command textarea').fill(note);
  await panel.locator('.application-panel__command').getByRole('button', { name: label, exact: true }).click();
}

async function createShare(page: Page, drawer: Locator, candidateId: string): Promise<Share> {
  const created = response(page, 'POST', `/talents/${candidateId}/shares`);
  await drawer.getByRole('button', { name: '生成分享链接', exact: true }).click();
  const result = await created;
  if (result.status() !== 201) throw new SafePreviewFailure(`Share creation status ${result.status()}, expected 201`);
  const share = (await result.json()).data as Share;
  expect(Boolean(share.id && /^[a-f0-9]{64}$/.test(share.token) && share.url === `/talents/s/${share.token}`)).toBe(true);
  await expect(drawer.locator('.talent-share__result')).toBeVisible();
  return share;
}

async function revokeShare(page: Page, drawer: Locator, id: string, withOriginal: boolean) {
  const row = drawer.locator('.talent-share__history-item').filter({ hasText: '免登录外链' }).filter({ hasNotText: '已撤销' });
  const target = withOriginal ? row.filter({ hasText: '附简历' }) : row.filter({ hasNotText: '附简历' });
  await target.getByRole('button', { name: '撤销', exact: true }).click();
  const revoked = response(page, 'DELETE', `/talents/shares/${id}`);
  await page.getByRole('dialog', { name: '撤销分享', exact: true }).getByRole('button', { name: '撤销分享', exact: true }).click();
  expect((await revoked).status()).toBe(200);
}

test('real talent feedback: exact salary, valid department, independent hiring and guest share revocation', async ({ browser }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const f = createFixture(info.project.name), mobile = info.project.name === 'mobile';
  const contexts: BrowserContext[] = [], external: string[] = [], browserErrors: string[] = [];
  const proof: Record<string, unknown> = { project: info.project.name, fixture: f.prefix, checks: {}, stages: [] };
  const shareStatuses: number[] = []; proof.shareCreationStatuses = shareStatuses;
  let phase = 'open guarded preview', candidateId = '';
  const applicationIds: string[] = [];
  let editorContext: BrowserContext | undefined;
  let editorPage: Page | undefined;
  const open = async (actor?: Actor) => {
    const device = info.project.use;
    const context = await browser.newContext({ baseURL: origin, viewport: device.viewport, isMobile: device.isMobile,
      hasTouch: device.hasTouch, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
      timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', ...(actor ? { extraHTTPHeaders: { Authorization: `Bearer ${actor.token}` } } : {}) });
    contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (url.protocol === 'ws:' && url.host === 'localhost:5173') { socket.connectToServer(); return; }
      external.push(url.origin); socket.close();
    });
    if (actor) await context.addInitScript(token => {
      if (location.origin !== 'http://localhost:5173') return;
      localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 1100000));
    }, actor.token);
    const page = await context.newPage();
    page.on('pageerror', () => browserErrors.push('pageerror'));
    page.on('console', message => { if (message.text().includes('Unhandled Vue error')) browserErrors.push('Vue error'); });
    page.on('response', result => {
      const path = new URL(result.url()).pathname;
      if (result.request().method() === 'POST' && /^\/api\/v1\/talents\/[^/]+\/shares$/.test(path)) shareStatuses.push(result.status());
    });
    return { page, context };
  };
  try {
    const editor = await open(f.editor); editorContext = editor.context;
    const page = editor.page; editorPage = page;
    await go(page, '/talents');
    phase = 'create exact yuan candidate with real image upload';
    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    const form = page.locator('.talent-form-drawer');
    await form.getByPlaceholder('候选人姓名').fill(f.name);
    await form.getByPlaceholder('11 位手机号').fill(f.phone);
    await form.getByTestId('talent-form-source').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    await form.getByPlaceholder('最低', { exact: true }).fill('5501');
    await form.getByPlaceholder('最高', { exact: true }).fill('6809');
    await form.locator('#talent-form-file-input').setInputFiles({ name: `fictional-${f.prefix}.png`, mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') });
    const created = response(page, 'POST', '/talents');
    await form.getByRole('button', { name: '加入人才库', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    candidateId = (await createdResponse.json()).data.id;
    proof.candidateId = candidateId;
    await expect(form).not.toBeVisible();
    const persisted = await dataOf<any>(editor.context.request, 'GET', `/talents/${candidateId}`, 200);
    expect({ min: persisted.expectSalaryMinYuan, max: persisted.expectSalaryMaxYuan, unit: persisted.expectSalaryUnit }).toEqual({ min: 5501, max: 6809, unit: 'yuan' });
    expect(persisted.files.length).toBe(1);
    const file = persisted.files[0];

    phase = 'create application using active department and save dated follow-up';
    const detail = await openTalent(page, f.name, mobile), panel = detail.locator('.application-panel');
    await detail.getByRole('button', { name: '补充记录', exact: true }).click();
    await detail.getByPlaceholder('本次沟通要点（必填）').fill(`虚构私密跟进_${f.prefix}`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    await detail.getByPlaceholder('不设置', { exact: true }).fill(today);
    await detail.getByPlaceholder('不设置', { exact: true }).press('Tab');
    const followed = response(page, 'POST', `/talents/${candidateId}/follow-ups`);
    await detail.getByRole('button', { name: '保存跟进', exact: true }).click();
    expect((await followed).status()).toBe(201);
    await expect(detail.locator('.talent-follow-ups__timeline')).toContainText(`下次跟进 ${today}`);
    await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
    const positionName = `虚构应聘岗位_${f.prefix}`;
    await panel.getByLabel('岗位名称', { exact: true }).fill(positionName);
    await panel.getByLabel('招聘批次', { exact: true }).fill(f.prefix);
    await panel.getByLabel('部门（选填）', { exact: true }).click();
    await expect(page.getByRole('option', { name: f.inactive.name, exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: f.active.name, exact: true }).click();
    const applicationCreated = response(page, 'POST', `/talent-recruitment/candidates/${candidateId}/applications`);
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    const appResponse = await applicationCreated;
    expect(appResponse.status()).toBe(201);
    const application = (await appResponse.json()).data;
    applicationIds.push(application.id);
    expect(application.deptId).toBe(f.active.id);
    proof.applicationId = application.id;
    await expect(panel.locator('.application-panel__stage')).toHaveText('初筛');

    phase = 'submit hiring and show next step without self-approval';
    await action(panel, '提交录用', '虚构候选人，交由独立确认人办理');
    await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
    await expect(panel).toContainText('人员 → 录用确认');
    await expect(panel).toContainText('提交人不能确认本人提交的申请');
    await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
    const pending = await dataOf<any>(editor.context.request, 'GET', `/talent-recruitment/applications/${application.id}`, 200);
    expect(pending.allowedActions.includes('approve_hiring')).toBe(false);
    expect((await api(editor.context.request, 'POST', `/talent-recruitment/applications/${application.id}/actions`, { action: 'approve_hiring', expectedRevision: pending.revision })).status()).toBe(403);
    await page.screenshot({ path: info.outputPath('hiring-next-step.png'), animations: 'disabled', fullPage: true });

    phase = 'independent capability holder confirms without talent-library permission';
    const confirmer = await open(f.confirmer);
    await go(confirmer.page, '/talent-hiring');
    await confirmer.page.getByRole('button').filter({ hasText: f.name }).click();
    const review = confirmer.page.locator('.hiring-review__detail');
    await review.getByRole('button', { name: '确认录用', exact: true }).click();
    await review.getByRole('button', { name: '提交录用确认', exact: true }).click();
    await expect(review).toContainText('已确认录用');
    expect((await api(confirmer.context.request, 'GET', '/talents')).status()).toBe(403);
    await panel.getByRole('button', { name: '刷新应聘记录', exact: true }).click();
    await expect(panel).toContainText('由经办记录候选人接受或拒绝');

    phase = 'open external share drawer';
    await detail.getByRole('button', { name: '转发', exact: true }).click();
    const sharing = page.locator('.talent-share-drawer');
    await expect(sharing).toBeVisible();
    phase = 'verify default share controls';
    await expect(sharing.getByTestId('talent-share-recipients')).toHaveCount(0);
    await expect(sharing.getByRole('switch')).not.toBeChecked();
    phase = 'create summary share and show generated result';
    const summary = await createShare(page, sharing, candidateId);
    proof.summaryShareId = summary.id;
    await page.screenshot({ path: info.outputPath('external-share-default.png'), animations: 'disabled', fullPage: true, mask: [sharing.locator('.talent-share__result')] });
    const guest = await open();
    await go(guest.page, summary.url);
    await expect(guest.page.getByRole('heading', { name: f.name, exact: true })).toBeVisible();
    await expect(guest.page.locator('.app-shell')).toHaveCount(0);
    expect(await guest.page.evaluate(() => localStorage.getItem('token') === null)).toBe(true);
    const shared = await dataOf<any>(guest.context.request, 'GET', `/talents/shares/${summary.token}`, 200);
    expect(Object.keys(shared.candidate).sort()).toEqual(['name', 'gender', 'genderLabel', 'age', 'currentCompany', 'currentPosition', 'yearsOfExperience', 'education', 'school', 'major', 'expectCity', 'appliedPosition', 'tags', 'status', 'statusLabel'].sort());
    expect(shared.files.length).toBe(0);
    expect((await api(guest.context.request, 'GET', '/talents')).status()).toBe(401);
    expect((await api(guest.context.request, 'GET', `/talents/${candidateId}`)).status()).toBe(401);
    expect((await api(guest.context.request, 'GET', `/talents/shares/${summary.token}/file/${file.id}`)).status()).toBe(403);
    expect(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await guest.page.screenshot({ path: info.outputPath('guest-summary.png'), animations: 'disabled', fullPage: true });

    phase = 'focus editor and enable original switch';
    await page.bringToFront();
    // Element Plus gives its zero-sized checkbox the switch role; people click the visible wrapper.
    await sharing.locator('.el-switch').click();
    await expect(sharing.getByRole('switch')).toBeChecked();
    phase = 'select 30-day original share expiry';
    await sharing.getByText('30 天', { exact: true }).click();
    phase = 'generate original-enabled external share';
    const original = await createShare(page, sharing, candidateId);
    proof.originalShareId = original.id;
    phase = 'validate scoped original download bytes';
    const originalView = await dataOf<any>(guest.context.request, 'GET', `/talents/shares/${original.token}`, 200);
    expect(originalView.files.length).toBe(1);
    expect(Object.hasOwn(originalView.files[0], 'objectKey')).toBe(false);
    const guestFile = await api(guest.context.request, 'GET', `/talents/shares/${original.token}/file/${file.id}`);
    const editorFile = await api(editor.context.request, 'GET', `/storage/download?key=${encodeURIComponent(file.objectKey)}`);
    expect(guestFile.status()).toBe(200); expect(editorFile.status()).toBe(200);
    expect((await guestFile.body()).equals(await editorFile.body())).toBe(true);
    expect(guestFile.headers()['cache-control'].includes('no-store')).toBe(true);
    expect((await api(guest.context.request, 'GET', `/talents/shares/${original.token}/file/${randomUUID()}`)).status()).toBe(403);
    expect((await api(guest.context.request, 'GET', `/storage/download?key=${encodeURIComponent(file.objectKey)}`)).status()).toBe(401);

    phase = 'revoke both UI-generated external links and block guests immediately';
    await revokeShare(page, sharing, original.id, true);
    expect((await api(guest.context.request, 'GET', `/talents/shares/${original.token}`)).status()).toBe(403);
    expect((await api(guest.context.request, 'GET', `/talents/shares/${original.token}/file/${file.id}`)).status()).toBe(403);
    await revokeShare(page, sharing, summary.id, false);
    await go(guest.page, summary.url);
    await expect(guest.page.getByRole('heading', { name: '链接已失效或无权查看', exact: true })).toBeVisible();
    await expect(guest.page.locator('.talent-shared')).toHaveCount(0);

    phase = 'legacy recipient share still requires current recipient login';
    const legacy = await dataOf<Share>(editor.context.request, 'POST', `/talents/${candidateId}/shares`, 201,
      { recipientIds: [f.confirmer.id], expiresInDays: 7, includeResume: true });
    proof.legacyShareId = legacy.id;
    expect((await api(guest.context.request, 'GET', `/talents/shares/${legacy.token}`)).status()).toBe(403);
    expect((await api(guest.context.request, 'GET', `/talents/shares/${legacy.token}/file/${file.id}`)).status()).toBe(403);
    expect((await api(editor.context.request, 'GET', `/talents/shares/${legacy.token}`)).status()).toBe(403);
    expect((await api(confirmer.context.request, 'GET', `/talents/shares/${legacy.token}`)).status()).toBe(200);

    let exportPosition = positionName, exportStage = 'offered', exportStageLabel = '已确认录用';
    if (!mobile) {
      phase = 'create and withdraw a second historical application through real UI';
      const historyDetail = await openTalent(page, f.name, false), historyPanel = historyDetail.locator('.application-panel');
      await historyPanel.getByRole('button', { name: '新增应聘', exact: true }).click();
      const historyPosition = `虚构历史岗位_${f.prefix}`;
      await historyPanel.getByLabel('岗位名称', { exact: true }).fill(historyPosition);
      await historyPanel.getByLabel('招聘批次', { exact: true }).fill(f.prefix);
      const historyCreated = response(page, 'POST', `/talent-recruitment/candidates/${candidateId}/applications`);
      await historyPanel.getByRole('button', { name: '保存应聘', exact: true }).click();
      const historyResponse = await historyCreated;
      expect(historyResponse.status()).toBe(201);
      const history = (await historyResponse.json()).data;
      applicationIds.push(history.id); proof.historyApplicationId = history.id;
      await action(historyPanel, '撤回应聘', '虚构历史岗位，用于验证同一次应聘的筛选口径');
      await expect(historyPanel.locator('.application-panel__stage')).toHaveText('已撤回');
      exportPosition = historyPosition; exportStage = 'withdrawn'; exportStageLabel = '已撤回';
    }

    phase = 'same application filters drive a real XLSX download';
    await go(page, '/talents');
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(f.name);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    await page.getByTestId('talent-filter-application-position').click();
    await page.getByRole('option', { name: positionName, exact: true }).click();
    await page.getByTestId('talent-filter-application-stage').click();
    const filtered = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname === '/api/v1/talents' && url.searchParams.get('applicationPosition') === positionName && url.searchParams.get('applicationStage') === exportStage;
    });
    await page.getByRole('option', { name: exportStageLabel, exact: true }).click();
    const filteredResponse = await filtered;
    expect(filteredResponse.status()).toBe(200);
    if (!mobile) {
      phase = 'cross-application position and stage cannot be stitched into one match';
      expect((await filteredResponse.json()).data.total).toBe(0);
      await expect(page.locator('.el-table__row').filter({ hasText: f.name })).toHaveCount(0);
      await page.getByTestId('talent-filter-application-position').click();
      const historicalMatch = page.waitForResponse(r => {
        const url = new URL(r.url());
        return url.pathname === '/api/v1/talents' && url.searchParams.get('applicationPosition') === exportPosition && url.searchParams.get('applicationStage') === 'withdrawn';
      });
      await page.getByRole('option', { name: exportPosition, exact: true }).click();
      const historicalResponse = await historicalMatch;
      expect(historicalResponse.status()).toBe(200);
      const matched = (await historicalResponse.json()).data;
      expect(matched.total).toBe(1); expect(matched.items[0].id).toBe(candidateId);
    }
    phase = 'verify filtered candidate in the visible viewport result list';
    const results = page.locator(mobile ? '.mobile-result-card' : '.el-table');
    await expect(results.getByText(f.name, { exact: true }).first()).toBeVisible();
    if (mobile) {
      phase = 'mobile follow-up label and date survive real filter reload';
      const card = page.locator('.mobile-result-card').filter({ hasText: f.name });
      const next = card.locator('.mobile-result-field').filter({ has: page.locator('.mobile-result-field__label', { hasText: '下次跟进' }) });
      await expect(next.locator('.mobile-result-field__label')).toHaveText('下次跟进');
      await expect(next.locator('.mobile-result-field__value')).toHaveText(today);
    }
    phase = 'download actual filtered XLSX';
    const download = page.waitForEvent('download'), exported = response(page, 'GET', '/talents/export');
    await page.getByRole('button', { name: '导出应聘记录', exact: true }).click();
    const exportedResponse = await exported;
    expect(exportedResponse.status()).toBe(200);
    expect((exportedResponse.headers()['content-type'] ?? '').includes('spreadsheetml')).toBe(true);
    const params = new URL(exportedResponse.url()).searchParams;
    expect(params.get('applicationPosition')).toBe(exportPosition);
    expect(params.get('applicationStage')).toBe(exportStage);
    const bytes = await exportedResponse.body();
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    const downloaded = await download;
    expect(downloaded.suggestedFilename().endsWith('.xlsx')).toBe(true);
    if (!mobile) {
      phase = 'ExcelJS reads actual downloaded history row and exact numeric yuan cells';
      // Reuse the installed API dependency; no new Web dependency or server-generated fixture workbook.
      const ExcelJS = createRequire(new URL('../../../api/package.json', import.meta.url))('exceljs');
      const workbook = new ExcelJS.Workbook();
      const downloadPath = await downloaded.path();
      expect(Boolean(downloadPath)).toBe(true);
      await workbook.xlsx.readFile(downloadPath!);
      const sheet = workbook.getWorksheet('人才应聘记录');
      expect(Boolean(sheet)).toBe(true);
      const rows: Array<Record<string, unknown>> = [];
      sheet.eachRow((row: any, index: number) => {
        if (index === 1) return;
        const record: Record<string, unknown> = {};
        sheet.getRow(1).eachCell((cell: any, column: number) => { record[cell.text] = row.getCell(column).value; });
        rows.push(record);
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!['姓名']).toBe(f.name);
      expect({ position: rows[0]!['应聘岗位'], stage: rows[0]!['应聘阶段'], min: rows[0]!['期望薪资下限（元/月）'], max: rows[0]!['期望薪资上限（元/月）'] })
        .toEqual({ position: exportPosition, stage: exportStageLabel, min: 5501, max: 6809 });
      proof.xlsxReadback = { verified: true, rowCount: rows.length, applicationId: proof.historyApplicationId, stage: exportStage };
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(browserErrors).toEqual([]); expect(external).toEqual([]);
    proof.stages = ['screening', 'hiring_review', 'offered'];
    proof.checks = { exactYuan: true, imageUploaded: true, activeDepartmentOnly: true, followUpPersisted: true,
      noSelfApproval: true, independentConfirmer: true, anonymousSummaryOnly: true, scopedOriginalBytes: true,
      revokedGuestsDenied: true, legacyRecipientOnly: true, realXlsxDownload: true, responsive: true };
  } catch (error) {
    // Preserve a useful phase without writing JWTs, share URLs, raw payloads, or header dumps.
    proof.failedPhase = phase;
    if (editorPage && !editorPage.isClosed()) {
      proof.safeUi = await editorPage.evaluate(() => {
        const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
        const drawers = [...document.querySelectorAll('.talent-share-drawer')];
        const switches = [...document.querySelectorAll('.talent-share-drawer [role="switch"]')];
        return { shareDrawers: drawers.length, visibleShareDrawers: drawers.filter(visible).length,
          switches: switches.length, visibleSwitches: switches.filter(visible).length,
          disabledSwitches: switches.filter(element => element.getAttribute('aria-disabled') === 'true').length,
          loginPage: location.pathname === '/login' };
      });
    }
    const reason = error instanceof SafePreviewFailure ? error.message : (error instanceof Error ? error.name : 'unknown error');
    const uiReason = error instanceof Error ? ['intercepts pointer events', 'not visible', 'not enabled', 'outside of the viewport', 'strict mode violation'].filter(text => error.message.includes(text)).join(',') : '';
    throw new Error(`Real preview feedback failed at: ${phase} (${reason}; ${uiReason}); share HTTP statuses=[${shareStatuses.join(',')}]; UI=${JSON.stringify(proof.safeUi ?? {})}`);
  } finally {
    try {
      if (candidateId && editorContext) {
        for (const applicationId of applicationIds) {
          const current = await dataOf<any>(editorContext.request, 'GET', `/talent-recruitment/applications/${applicationId}`, 200);
          if (current.allowedActions.includes('withdraw')) {
            await dataOf(editorContext.request, 'POST', `/talent-recruitment/applications/${applicationId}/actions`, 201,
              { action: 'withdraw', expectedRevision: current.revision, note: '虚构验收结束，撤回本轮应聘并保留历史' });
          }
        }
        const impact = await dataOf<any>(editorContext.request, 'GET', `/talents/${candidateId}/delete-impact`, 200);
        await dataOf(editorContext.request, 'DELETE', `/talents/${candidateId}`, 200, { impactVersion: impact.version, force: impact.requiresForce });
      }
    } finally {
      await Promise.all(contexts.map(context => context.close()));
      const cleanup = archiveFixture(f);
      proof.cleanup = cleanup;
      await writeFile(info.outputPath('talent-feedback-proof.json'), JSON.stringify(proof, null, 2));
      expect(cleanup).toEqual({ archivedActors: 2, activeCandidates: 0, activeShares: 0 });
    }
  }
});

test('remaining feedback real preview: scheduled follow-ups, cumulative reserve reasons and current employee display', async ({ browser }, info) => {
  test.setTimeout(300000);
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
  const f = createFixture(info.project.name), mobile = info.project.name === 'mobile', device = info.project.use;
  const context = await browser.newContext({ baseURL: origin, viewport: device.viewport, isMobile: device.isMobile,
    hasTouch: device.hasTouch, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
    timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', extraHTTPHeaders: { Authorization: `Bearer ${f.editor.token}` } });
  const external: string[] = [], errors: string[] = [], candidateIds: string[] = [], applicationIds: string[] = [];
  const proof: Record<string, unknown> = { project: info.project.name, fixture: f.prefix, displayFixtureOnly: true };
  let phase = 'create guarded synthetic candidates';
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await context.addInitScript(token => {
    if (location.origin === 'http://localhost:5173') { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 1100000)); }
  }, f.editor.token);
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', message => { if (message.text().includes('Unhandled Vue error')) errors.push('Vue error'); });
  const create = async (suffix: string) => {
    const candidate = await dataOf<any>(context.request, 'POST', '/talents', 201, { name: `${f.name}_${suffix}`,
      phone: `100${String(randomInt(100000000)).padStart(8, '0')}`, sourceChannel: 'other', expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809 });
    candidateIds.push(candidate.id); return candidate;
  };
  const reserve = async (panel: Locator, labels: string[]) => {
    await panel.getByRole('button', { name: '转储备', exact: true }).click();
    const command = panel.locator('.application-panel__command');
    for (const label of labels) {
      await command.locator('.el-checkbox').filter({ hasText: label }).click();
      await expect(command.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
    }
    await command.locator('textarea').fill('虚构储备原因验收，保留本次应聘历史');
    await command.getByRole('button', { name: '转储备', exact: true }).click();
    await expect(panel.locator('.application-panel__stage')).toHaveText('人才储备');
  };
  const newApplication = async (panel: Locator, position: string) => {
    await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
    await panel.getByLabel('岗位名称', { exact: true }).fill(position);
    await panel.getByLabel('招聘批次', { exact: true }).fill(f.prefix);
    const created = page.waitForResponse(r => r.request().method() === 'POST' && /\/talent-recruitment\/candidates\/[^/]+\/applications$/.test(new URL(r.url()).pathname));
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    const result = await created; expect(result.status()).toBe(201);
    const application = (await result.json()).data; applicationIds.push(application.id); return application;
  };
  const downloadRows = async (keyword: string): Promise<Array<Record<string, unknown>>> => {
    await go(page, '/talents');
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(keyword);
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/talents' && new URL(r.url()).searchParams.get('keyword') === keyword);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    expect((await loaded).status()).toBe(200);
    const download = page.waitForEvent('download'), exported = response(page, 'GET', '/talents/export');
    await page.getByRole('button', { name: '导出应聘记录', exact: true }).click();
    expect((await exported).status()).toBe(200);
    const path = await (await download).path(); expect(Boolean(path)).toBe(true);
    const ExcelJS = createRequire(new URL('../../../api/package.json', import.meta.url))('exceljs');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path!);
    const sheet = workbook.getWorksheet('人才应聘记录'); expect(Boolean(sheet)).toBe(true);
    const rows: Array<Record<string, unknown>> = [];
    sheet.eachRow((row: any, index: number) => {
      if (index === 1) return; const record: Record<string, unknown> = {};
      sheet.getRow(1).eachCell((cell: any, column: number) => { record[cell.text] = row.getCell(column).value; }); rows.push(record);
    });
    return rows;
  };
  try {
    const untouched = await create('未跟进'), future = await create('未来安排'), completed = await create('有跟进无日期');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await dataOf(context.request, 'POST', `/talents/${future.id}/follow-ups`, 201, { occurredAt: today, channel: 'phone', summary: '虚构已安排未来跟进', nextFollowUpAt: futureDate });
    await dataOf(context.request, 'POST', `/talents/${completed.id}/follow-ups`, 201, { occurredAt: today, channel: 'phone', summary: '虚构沟通完成，未安排下次' });
    phase = 'real dueOnly includes untouched and future date but excludes communication without next date';
    await go(page, '/talents');
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(f.name);
    await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
    const due = page.waitForResponse(r => { const url = new URL(r.url()); return url.pathname === '/api/v1/talents' && url.searchParams.get('dueOnly') === 'true' && url.searchParams.get('keyword') === f.name; });
    await page.getByRole('switch', { name: '仅看待跟进', exact: true }).locator('..').click();
    const dueResponse = await due; expect(dueResponse.status()).toBe(200);
    const dueData = (await dueResponse.json()).data;
    expect(dueData.items.map((row: any) => row.id).sort()).toEqual([untouched.id, future.id].sort());
    const visibleResults = page.locator(mobile ? '.mobile-result-card' : '.el-table');
    await expect(visibleResults.getByText(untouched.name, { exact: true })).toBeVisible();
    await expect(visibleResults.getByText(future.name, { exact: true })).toBeVisible();
    await expect(visibleResults.getByText(completed.name, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('scheduled-follow-ups.png'), fullPage: true, animations: 'disabled' });

    phase = 'same application reserves twice with overlapping reasons';
    const detail = await openTalent(page, untouched.name, mobile), panel = detail.locator('.application-panel');
    const positionA = `虚构累计岗位_${f.prefix}`, positionB = `虚构独立原因岗位_${f.prefix}`;
    const applicationA = await newApplication(panel, positionA);
    await reserve(panel, ['通勤距离', '薪资期望']);
    await action(panel, '重开应聘', '虚构再次招聘，保留第一次储备原因');
    await expect(panel.locator('.application-panel__stage')).toHaveText('初筛');
    await reserve(panel, ['薪资期望', '工作制偏好']);
    const actualA = await dataOf<any>(context.request, 'GET', `/talent-recruitment/applications/${applicationA.id}`, 200);
    const eventsA = actualA.events.filter((event: any) => event.action === 'reserve');
    expect(eventsA.length).toBe(2);
    expect(eventsA.map((event: any) => [...event.reserveReasons].sort())).toEqual(expect.arrayContaining([
      ['commute_distance', 'salary_expectation'], ['salary_expectation', 'work_schedule'],
    ]));
    await expect(panel.locator('.application-panel__event-reasons').filter({ hasText: '通勤距离' })).toBeVisible();
    const applicationB = await newApplication(panel, positionB);
    await reserve(panel, ['其他']);

    phase = 'guarded hired-history display fixture starts with a resigned virtual employee';
    // Display projection only: this does not claim to execute resignation or re-employment workflows.
    const display = fixtureQuery<{ employeeId: string; candidateId: string; applicationId: string; name: string }>(`
      const f=${JSON.stringify({ prefix: f.prefix, name: f.name, editorId: f.editor.id, deptId: f.active.id })};
      const result=await db.$transaction(async tx=>{
        if(!await tx.user.findFirst({where:{id:f.editorId,employeeNo:f.prefix+'_editor',deletedAt:null}}))throw Error('Owner mismatch');
        const user=await tx.user.create({data:{name:'虚构显示员工_'+f.prefix,employeeNo:f.prefix+'_display',sysRole:'employee',status:'resigned',deptId:f.deptId}});
        const candidate=await tx.talentCandidate.create({data:{name:f.name+'_履历显示',phone:${JSON.stringify(`100${String(randomInt(100000000)).padStart(8, '0')}`)},sourceChannel:'other',status:'hired',convertedUserId:user.id,createdById:f.editorId,ownerId:f.editorId}});
        const application=await tx.talentApplication.create({data:{candidateId:candidate.id,positionName:'虚构已入职历史_'+f.prefix,stage:'hired',ownerId:f.editorId,createdById:f.editorId}});
        return {employeeId:user.id,candidateId:candidate.id,applicationId:application.id,name:candidate.name};
      });console.log(JSON.stringify(result));
    `);
    f.extraActorIds = [display.employeeId]; candidateIds.push(display.candidateId); applicationIds.push(display.applicationId);
    let displayDetail = await openTalent(page, display.name, mobile);
    await expect(displayDetail.getByTestId('talent-current-employment')).toHaveText('员工当前：已离职');
    await expect(displayDetail.locator('.application-panel__stage')).toHaveText('已入职');
    const stored = await dataOf<any>(context.request, 'GET', `/talents/${display.candidateId}`, 200);
    expect({ status: stored.status, current: stored.employmentStatus }).toEqual({ status: 'hired', current: 'resigned' });

    phase = 'actual Excel accumulates and deduplicates reasons within each application';
    const exportedRows = await downloadRows(f.name);
    const rowA = exportedRows.find(row => row['应聘岗位'] === positionA), rowB = exportedRows.find(row => row['应聘岗位'] === positionB);
    expect(Boolean(rowA && rowB)).toBe(true);
    expect(String(rowA!['储备原因（累计）']).split('、')).toEqual(['通勤距离', '薪资期望', '工作制偏好']);
    expect(new Set(String(rowA!['储备原因（累计）']).split('、')).size).toBe(3);
    expect(rowB!['储备原因（累计）']).toBe('其他');
    expect(exportedRows.find(row => row['姓名'] === display.name)!['员工当前状态']).toBe('已离职');

    phase = 'virtual current status changes to active while original hired history remains frozen';
    const change = fixtureQuery<{ status: string; candidateStatus: string; applicationStage: string }>(`
      const f=${JSON.stringify({ prefix: f.prefix, editorId: f.editor.id, ...display })};
      if(!await db.talentCandidate.findFirst({where:{id:f.candidateId,createdById:f.editorId,convertedUserId:f.employeeId,name:f.name}})
        ||!await db.user.findFirst({where:{id:f.employeeId,employeeNo:f.prefix+'_display'}}))throw Error('Display fixture ownership mismatch');
      await db.user.update({where:{id:f.employeeId},data:{status:'active'}});
      console.log(JSON.stringify({status:(await db.user.findUniqueOrThrow({where:{id:f.employeeId}})).status,
        candidateStatus:(await db.talentCandidate.findUniqueOrThrow({where:{id:f.candidateId}})).status,
        applicationStage:(await db.talentApplication.findUniqueOrThrow({where:{id:f.applicationId}})).stage}));
    `);
    expect(change).toEqual({ status: 'active', candidateStatus: 'hired', applicationStage: 'hired' });
    displayDetail = await openTalent(page, display.name, mobile);
    await expect(displayDetail.getByTestId('talent-current-employment')).toHaveText('员工当前：在职');
    await expect(displayDetail.locator('.application-panel__stage')).toHaveText('已入职');
    const activeRows = await downloadRows(display.name);
    expect(activeRows.length).toBe(1);
    expect({ stage: activeRows[0]!['应聘阶段'], current: activeRows[0]!['员工当前状态'] }).toEqual({ stage: '已入职', current: '在职' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
    proof.candidateIds = candidateIds; proof.applicationIds = applicationIds;
    proof.checks = { untouchedAndFutureIncluded: true, followedWithoutDateExcluded: true, reserveEventsPreserved: true,
      reasonsAccumulatedDeduplicatedPerApplication: true, currentStatusProjected: true, hiredHistoryPreserved: true, xlsxReadback: true };
  } catch (error) {
    proof.failedPhase = phase;
    throw new Error(`Remaining real preview feedback failed at ${phase} (${error instanceof SafePreviewFailure ? error.message : error instanceof Error ? error.name : 'unknown'})`);
  } finally {
    try {
      for (const id of applicationIds) {
        const current = await dataOf<any>(context.request, 'GET', `/talent-recruitment/applications/${id}`, 200);
        if (current.allowedActions.includes('withdraw')) await dataOf(context.request, 'POST', `/talent-recruitment/applications/${id}/actions`, 201,
          { action: 'withdraw', expectedRevision: current.revision, note: '虚构验收结束，撤回应聘并保留历史' });
      }
      for (const id of candidateIds) {
        const impact = await dataOf<any>(context.request, 'GET', `/talents/${id}/delete-impact`, 200);
        await dataOf(context.request, 'DELETE', `/talents/${id}`, 200, { impactVersion: impact.version, force: impact.requiresForce });
      }
    } finally {
      await context.close();
      const cleanup = archiveFixture(f); proof.cleanup = cleanup;
      await writeFile(info.outputPath('remaining-feedback-proof.json'), JSON.stringify(proof, null, 2));
      expect(cleanup).toEqual({ archivedActors: 2 + (f.extraActorIds?.length ?? 0), activeCandidates: 0, activeShares: 0 });
    }
  }
});
