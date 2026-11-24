import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

test.setTimeout(240000);
test.use({ actionTimeout: 15000 });
type Actor = { id: string; token: string; talent: boolean; hiring: boolean; admin: boolean };
type Fixture = { actors: Record<string, Actor>; deptId: string; candidateId: string; candidateName: string; pendingCandidateName: string; interviewId: string; applicationId: string; share: string };
let fixture: Fixture;
function database(body: string) {
  const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], input: `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client');const {JwtService}=require('@nestjs/jwt');const db=new PrismaClient();
    (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional preview');
    ${body}})().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`,
  });
  return JSON.parse(output);
}
async function login(page: Page, actor: Actor, path = '/dashboard') {
  await page.goto('/login');
  await page.evaluate(token => {
    localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000));
    localStorage.removeItem('kayford.sidebar.collapsedGroups');
  }, actor.token);
  await page.goto(path);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}
async function get(page: Page, actor: Actor, path: string) {
  return page.request.get(`/api/v1${path}`, { headers: { authorization: `Bearer ${actor.token}` } });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
}

test.beforeAll(() => {
  const prefix = `IA_${randomUUID().slice(0, 6)}`, share = randomBytes(32).toString('hex');
  fixture = database(`
    const dept=await db.department.create({data:{name:'虚构${prefix}部门'}}), actors={};
    const definitions=[['employee','employee',[],false,false],['manager','manager',[],false,false],['approver','vp',[],false,false],
      ['personnel','hr_user',['organization_edit'],false,false],['reader','hr_user',['employee_archive_review'],true,false],
      ['recruiter','hr_user',['employee_archive_edit'],true,false],['interviewer','employee',[],false,false],
      ['confirmer','employee',['talent_hiring_confirm'],false,true],['performance','hr_user',['cycle_plan_edit','performance_publish'],false,false],
      ['hr','hr',[],true,true],['admin','system_admin',[],true,false],['assessor','employee',[],false,false]];
    for(const [kind,role,caps,talent,hiring] of definitions){
      const u=await db.user.create({data:{name:'虚构${prefix}'+kind,employeeNo:'${prefix}_'+kind,deptId:dept.id,status:'active',sysRole:role,hrCapabilities:caps,isAssessorOnly:kind==='assessor'}});
      await db.employmentRecord.create({data:{userId:u.id,employeeNo:u.employeeNo,deptId:dept.id,company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
      actors[kind]={id:u.id,talent,hiring,admin:kind==='admin',token:new JwtService().sign({sub:u.id,employeeNo:u.employeeNo,name:u.name,sysRole:u.sysRole,deptId:u.deptId,hrCapabilities:caps,isAssessorOnly:u.isAssessorOnly,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'1h'})};
    }
    await db.user.update({where:{id:actors.employee.id},data:{directManagerId:actors.manager.id}});
    await db.department.update({where:{id:dept.id},data:{approverId:actors.approver.id}});
    const candidates=[];
    for(let i=0;i<2;i++)candidates.push(await db.talentCandidate.create({data:{name:'虚构${prefix}人才'+i,phone:'170'+String(Date.now()+i).slice(-8),sourceChannel:'other',createdById:actors.recruiter.id}}));
    const accepted=await db.talentApplication.create({data:{candidateId:candidates[0].id,positionName:'虚构入职衔接岗位',ownerId:actors.recruiter.id,stage:'accepted',createdById:actors.recruiter.id}});
    await db.talentApplication.create({data:{candidateId:candidates[1].id,positionName:'虚构待确认岗位',ownerId:actors.recruiter.id,stage:'hiring_review',hiringRequestedById:actors.recruiter.id,hiringRequestedAt:new Date(),createdById:actors.recruiter.id}});
    const interview=await db.talentInterview.create({data:{candidateId:candidates[1].id,candidateNameSnapshot:candidates[1].name,startsAt:new Date('2035-01-01T02:00:00Z'),endsAt:new Date('2035-01-01T03:00:00Z'),invitationText:'虚构面试，无外部日程',createdById:actors.recruiter.id,
      participants:{create:[{userId:actors.interviewer.id,userNameSnapshot:'虚构面试官'}]}}});
    await db.notificationLog.create({data:{userId:actors.interviewer.id,type:'talent_interview',title:'虚构面试深链',content:'仅预览导航验收',channel:'in_app',status:'sent',extraData:{invitationId:interview.id}}});
    await db.talentShare.create({data:{candidateId:candidates[0].id,token:'${share}',recipientIds:[],isPublicLink:true,includeResume:false,expiresAt:new Date(Date.now()+3600000),createdById:actors.recruiter.id}});
    console.log(JSON.stringify({actors,deptId:dept.id,candidateId:candidates[0].id,candidateName:candidates[0].name,pendingCandidateName:candidates[1].name,interviewId:interview.id,applicationId:accepted.id,share:'${share}'}));
  `);
});
test.afterAll(() => {
  if (!fixture) return;
  database(`
    await db.talentShare.updateMany({where:{token:'${fixture.share}'},data:{revokedAt:new Date()}});
    await db.talentApplication.updateMany({where:{createdById:{in:${JSON.stringify(Object.values(fixture.actors).map(actor => actor.id))}}},data:{stage:'withdrawn'}});
    await db.talentCandidate.updateMany({where:{createdById:{in:${JSON.stringify(Object.values(fixture.actors).map(actor => actor.id))}}},data:{deletedAt:new Date()}});
    await db.user.updateMany({where:{id:{in:${JSON.stringify(Object.values(fixture.actors).map(actor => actor.id))}}},data:{archivedAt:new Date()}});
    await db.department.update({where:{id:'${fixture.deptId}'},data:{isActive:false,approverId:null}});console.log('{}');
  `);
});

test('real role matrix: menus, real recruitment defaults, URLs and backend permissions', async ({ page }) => {
  for (const [kind, actor] of Object.entries(fixture.actors)) await test.step(kind, async () => {
    await login(page, actor);
    await expect(page.getByTestId('app-route-title')).toHaveText('全局工作台');
    const module = page.getByTestId('nav-module-recruitment');
    if (actor.talent || actor.hiring) {
      await expect(module).toBeVisible();
      await expect(page.getByTestId('module-status-recruitment')).toHaveCount(0);
      await module.click();
      await expect(page).toHaveURL(actor.talent ? /\/talents$/ : /\/talent-hiring$/);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '人才库', exact: true })).toHaveCount(actor.talent ? 1 : 0);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '应聘与面试', exact: true })).toHaveCount(actor.talent ? 1 : 0);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '录用确认', exact: true })).toHaveCount(actor.hiring ? 1 : 0);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '建设规划', exact: true })).toHaveCount(actor.admin ? 1 : 0);
    } else await expect(module).toHaveCount(0);
    const talent = await get(page, actor, '/talents?pageSize=1');
    expect(talent.status()).toBe(actor.talent ? 200 : 403);
    const hiring = await get(page, actor, '/talent-recruitment/hiring-reviews');
    expect(hiring.status()).toBe(actor.hiring ? 200 : 403);
    await page.goto('/talents');
    await expect(page).toHaveURL(actor.talent ? /\/talents$/ : /\/dashboard$/);
    await page.goto('/talent-hiring');
    await expect(page).toHaveURL(actor.hiring ? /\/talent-hiring$/ : /\/dashboard$/);
    for (const url of ['/recruitment/planning', '/compensation']) {
      await page.goto(url);
      await expect(page).toHaveURL(actor.admin ? new RegExp(`${url}$`) : /\/dashboard$/);
    }
    await noOverflow(page);
  });
  const manager = await (await get(page, fixture.actors.manager!, '/auth/me')).json();
  const approver = await (await get(page, fixture.actors.approver!, '/auth/me')).json();
  expect(manager.data.businessCapabilities.canManageTeam).toBe(true);
  expect(approver.data.businessCapabilities.canViewPerformanceApproval).toBe(true);
});

test('three-size navigation, collapse/reload, real queues, notification/share and talent-to-intake deep links', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, fixture.actors.hr!);
  const sizes = info.project.name === 'mobile' ? [{ width: 390, height: 844 }] : [{ width: 1440, height: 900 }, { width: 1024, height: 768 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.getByTestId('nav-module-performance').click();
    await expect(page.getByTestId('app-route-title')).toHaveText('绩效任务');
    await expect(page.locator('.menu-group__title')).toHaveText(['绩效任务', '绩效运营', '试用期与转正', '绩效分析', '绩效设置']);
    const settings = page.getByRole('button', { name: '绩效设置', exact: true });
    if (size.width > 768) {
      await settings.click(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
      await page.reload(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
      await settings.click(); await expect(settings).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: '指标库', exact: true }).click();
      await expect(page).toHaveURL(/\/indicators$/);
      await expect(page.getByTestId('app-route-title')).toHaveText('指标库');
    } else {
      // Mobile intentionally flattens groups; desktop collapse must never hide mobile links.
      await expect(settings).toHaveCount(0);
      await page.evaluate(() => localStorage.setItem('kayford.sidebar.collapsedGroups', JSON.stringify({ 'performance-settings': true })));
      await page.reload();
      await expect(page.locator('.menu-group__title').filter({ hasText: '绩效设置' })).toHaveAttribute('aria-expanded', 'false');
      const template = page.getByRole('button', { name: '考核模板', exact: true });
      await template.scrollIntoViewIfNeeded();
      await template.tap();
      await expect(page).toHaveURL(/\/templates$/);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '考核模板', exact: true })).toHaveClass(/is-active/);
    }
    await page.getByTestId('nav-module-people').click();
    await expect(page.locator('.menu-panel').getByRole('button', { name: '人才库', exact: true })).toHaveCount(0);
    await expect(page.locator('.menu-panel').getByRole('button', { name: '人事基础资料', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '转正管理', exact: true })).toHaveCount(0);
    await page.getByTestId('nav-module-performance').click();
    await page.getByRole('button', { name: '转正管理', exact: true }).click();
    await expect(page.getByTestId('nav-module-performance')).toHaveClass(/is-active/);
    await page.getByTestId('nav-module-recruitment').click();
    await expect(page).toHaveURL(/\/talents$/);
    await page.getByRole('button', { name: '应聘与面试', exact: true }).click();
    await expect(page.locator('.interview-page')).toBeVisible();
    await page.getByRole('tab', { name: '我发起的', exact: true }).click();
    await page.getByRole('button', { name: '录用确认', exact: true }).click();
    await expect(page.locator('.hiring-review__toolbar')).toBeVisible();
    await page.locator('.hiring-review__item').filter({ hasText: fixture.pendingCandidateName }).click();
    await expect(page.locator('.hiring-review__detail').getByRole('button', { name: '确认录用', exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`navigation-${size.width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.goto('/recruitment?from=bookmark#saved');
  await expect(page).toHaveURL(/\/talents\?from=bookmark#saved$/);
  await page.goto('/personnel-processing?tab=reviews#history');
  await expect(page).toHaveURL(/\/entry-exit\?tab=reviews#history$/);
  await expect(page.getByTestId('nav-module-people')).toHaveClass(/is-active/);
  await page.goto('/confirmation-applications/approvals?from=bookmark#history');
  await expect(page).toHaveURL(/\/confirmation-applications\/manage\?from=bookmark#history$/);
  await expect(page.getByTestId('nav-module-people')).toHaveClass(/is-active/);
  await login(page, fixture.actors.interviewer!);
  await page.getByRole('button', { name: '通知' }).click();
  await page.getByText('虚构面试深链', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/talent-interviews/${fixture.interviewId}$`));
  await expect(page.locator('.interview-page')).toContainText('虚构面试');
  await expect(page.getByTestId('nav-module-recruitment')).toHaveCount(0);
  const foreign = await get(page, fixture.actors.employee!, `/talent-interviews/${fixture.interviewId}`);
  expect(foreign.status()).toBe(404);
  await login(page, fixture.actors.recruiter!, '/talents');
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(fixture.candidateName);
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
  const row = page.locator(info.project.name === 'mobile' ? '.mobile-result-card' : '.el-table__row').filter({ hasText: fixture.candidateName }).filter({ visible: true });
  await row.getByRole('button', { name: info.project.name === 'mobile' ? '打开详情' : '打开', exact: true }).click();
  await page.locator('.application-panel').getByRole('button', { name: '办理入职', exact: true }).click();
  await expect(page).toHaveURL(/\/entry-exit\?/);
  await expect(page.getByRole('dialog', { name: '办理入职', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '办理入职', exact: true }).getByLabel('姓名', { exact: true })).toHaveValue(fixture.candidateName);
  const anonymous = await context.browser()!.newContext({ viewport: page.viewportSize()! });
  try {
    const shared = await anonymous.newPage();
    await shared.goto(`http://localhost:5173/talents/s/${fixture.share}`);
    await expect(shared.getByText(fixture.candidateName, { exact: true })).toBeVisible();
    await expect(shared.getByTestId('nav-module-recruitment')).toHaveCount(0);
    expect(new URL(shared.url()).pathname).not.toBe('/login');
  } finally { await anonymous.close(); }
  expect(errors).toEqual([]);
});

test('overview GET-only notification states and admin planning remain separate from business data', async ({ page }, info) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/notification-settings/') && request.method() !== 'GET') writes.push(request.method());
  });
  await login(page, fixture.actors.admin!, '/system');
  const runtime = page.getByTestId('dingtalk-notification-runtime');
  await expect(runtime).toContainText('平台不可用或未启用'); // Real isolated backend, external channel disabled.
  for (const state of [
    { data: { available: true, enabled: true, effectiveEnabled: true }, label: '已启用' },
    { data: { available: true, enabled: false, effectiveEnabled: false }, label: '业务开关已关闭' },
    { data: { available: false, enabled: false, effectiveEnabled: false }, label: '平台不可用或未启用' },
    { data: null, label: '读取失败' },
  ]) {
    // Only simulate this read response: never change preview or production notification switches.
    await page.route('**/api/v1/notification-settings/dingtalk', route => route.fulfill({
      status: state.data ? 200 : 503, contentType: 'application/json', body: JSON.stringify({ code: state.data ? 0 : 5030, data: state.data, message: 'synthetic read state' }),
    }));
    await page.reload(); await expect(runtime).toContainText(state.label);
    await page.unroute('**/api/v1/notification-settings/dingtalk');
  }
  await page.getByTestId('nav-module-recruitment').click();
  await expect(page).toHaveURL(/\/talents$/);
  await page.getByRole('button', { name: '建设规划', exact: true }).click();
  await expect(page.getByTestId('recruitment-planning')).toContainText('招聘需求与编制');
  await expect(page.getByTestId('recruitment-planning').locator('button,input,select,textarea')).toHaveCount(0);
  await page.getByTestId('nav-module-compensation').click();
  await expect(page.getByTestId('compensation-overview')).toContainText('自然月 1 日至月底');
  await expect(page.getByTestId('compensation-overview').locator('button,input,select,textarea')).toHaveCount(0);
  await noOverflow(page); expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath('compensation-planning.png'), fullPage: true, animations: 'disabled' });
});
