import { test, expect, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Opt in only after the owner has prepared and released the fixed preview fixture.
// Run with playwright.preview.config.ts (one worker, no ordinary global setup).
test.skip(process.env.HRM_PAYROLL_UI_ACCEPTANCE !== '1', 'Await payroll fixture and preview-owner authorization');
test.use({ trace: 'off', video: 'off', actionTimeout: 15000 });
test.setTimeout(240000);

const origin = 'http://localhost:5173';
const subjectName = '薪酬隔离甲公司（虚构）';
const month = '2026-11';
type Actor = 'HR001' | 'MGR001' | 'VP001';
type Batch = {
  id: string; version: number; subjectId: string; month: string; purpose: string; status: string;
  versions: Array<{ id: string; version: number; status: string; gross: string | null; reviewerCount: number;
    approvalPath: string[]; approvalStep: number; issues: string[];
    decisions: Array<{ actorId: string; action: string }>;
    lines: Array<{ employeeId: string; itemCode: string; amount: string | null; status: string; evidence: { employeeName?: string } }> }>;
};
type Fixture = { subjectId: string; actors: Record<Actor, string>; baseline: string };
const latest = (batch: Batch) => [...batch.versions].sort((a, b) => b.version - a.version)[0]!;
const apiPath = (response: Response) => new URL(response.url()).pathname;
const touchPages = new WeakMap<Page, boolean>();

async function activate(control: Locator) {
  const page = control.page();
  if (!touchPages.has(page)) touchPages.set(page, await page.evaluate(() => navigator.maxTouchPoints > 0));
  if (touchPages.get(page)) await control.tap();
  else await control.click();
}

function database<T>(body: string): T {
  const result = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 45000, stdio: ['pipe', 'pipe', 'pipe'],
    input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
      const {createHash}=require('node:crypto');
      const fingerprint=async(subjectId)=>createHash('sha256').update(JSON.stringify(await Promise.all([
        db.payrollGrant.findMany({where:{subjectId},orderBy:{id:'asc'}}),db.payrollPolicy.findMany({where:{subjectId},orderBy:{id:'asc'}}),
        db.payrollStandard.findMany({where:{subjectId},orderBy:{id:'asc'}}),db.payrollOpeningBalance.findMany({where:{subjectId},orderBy:{id:'asc'}}),
        db.payrollAdjustment.findMany({where:{subjectId},orderBy:{id:'asc'}})
      ]))).digest('hex');
      (async()=>{
        const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
        if(identity.db!=='hrm_preview'||identity.role!=='hrm_preview')throw Error('Wrong isolated database');
        if(process.env.PAYROLL_ENABLED!=='true'||process.env.PAYROLL_FORMAL_ENABLED==='true')throw Error('Wrong payroll mode');
        if(!await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))throw Error('Missing preview marker');
        const marker=(await db.systemConfig.findUnique({where:{key:'payroll_preview_fixture_v1'}}))?.value;
        if(marker?.fictional!==true||marker.month!=='2026-11')throw Error('Missing payroll fixture');
        const subject=await db.contractSubject.findUniqueOrThrow({where:{name:${JSON.stringify(subjectName)}}});
        if(!marker.subjectIds.includes(subject.id))throw Error('Subject not owned by payroll fixture');
        ${body}
      })().then(value=>process.stdout.write(JSON.stringify(value))).finally(()=>db.$disconnect())
        .catch(error=>{process.stderr.write('Isolated payroll fixture refused: '+(error.code||error.name||'unknown'));process.exitCode=1});`,
  });
  return JSON.parse(result) as T;
}

function preflight(info: TestInfo): Fixture {
  expect(info.config.globalSetup, 'Never run the ordinary data-preparing setup').toBeNull();
  expect(info.config.workers, 'Desktop/mobile share one deliberately empty fictional payroll ledger').toBe(1);
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.project.use.trace).toBe('off');
  expect(info.project.use.video).toBe('off');
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
    encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
  }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(containers[0].Config.Labels['com.docker.compose.service']).toBe('api');
  expect(Object.values(containers[0].NetworkSettings.Ports ?? {}).every(value => value === null)).toBe(true);
  return database<Fixture>(`
    if(await db.payrollBatch.count({where:{subjectId:subject.id,month:'2026-11'}}))
      throw Error('Preserve existing payroll batches; owner must provide an empty fixture');
    if(await db.payrollReservation.count({where:{subjectId:subject.id,attributionMonth:'2026-11'}}))
      throw Error('Do not compete with existing payroll reservations');
    if(await db.payrollAttendanceSnapshot.count({where:{subjectId:subject.id,month:'2026-11'}}))
      throw Error('Preserve existing attendance; this UI run requires an empty fictional month');
    return {subjectId:subject.id,actors:marker.actors,baseline:await fingerprint(subject.id)};
  `);
}

function field(scope: Locator, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scope.locator('.el-form-item').filter({ has: scope.page().locator('.el-form-item__label').filter({ hasText: new RegExp(`^${escaped}$`) }) });
}

async function changed<T>(page: Page, path: string, click: () => Promise<unknown>): Promise<{ data: T; response: Response }> {
  const received = page.waitForResponse(response => apiPath(response) === path && response.request().method() === 'POST');
  await click();
  const response = await received;
  expect(response.status(), `${path} must succeed through the UI`).toBeLessThan(400);
  const result = await response.json();
  expect(result.code, `${path} must return a successful business response`).toBe(0);
  return { data: result.data as T, response };
}

async function login(page: Page, actor: Actor, fixture: Fixture) {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '预览系统', exact: true })).toBeVisible();
  await activate(page.getByTestId('preview-account'));
  await activate(page.getByRole('option', { name: new RegExp(`\\(${actor}\\)$`) }));
  const result = await changed<{ user: { id: string; payrollAccess: { enabled: boolean } } }>(
    page, '/api/v1/auth/test-login', () => activate(page.getByTestId('preview-login')),
  );
  // The app handles its session. The test neither extracts nor injects tokens.
  expect(result.data.user.id).toBe(fixture.actors[actor]);
  expect(result.data.user.payrollAccess.enabled).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

async function payrollMenu(page: Page, label: string, path: string) {
  await activate(page.getByTestId('nav-module-compensation'));
  await activate(page.locator('.menu-panel').getByRole('button', { name: label, exact: true }));
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function selectMonth(input: Locator, value: string, chineseFormat = false) {
  const display = chineseFormat ? `${value.slice(0, 4)}年${value.slice(5)}月` : value;
  await input.fill(display);
  await input.press('Enter');
  await input.press('Tab');
  await expect(input).toHaveValue(display);
}

async function selectScope(page: Page) {
  const scope = page.locator('.payroll-scope');
  await activate(scope.locator('.subject-select'));
  await activate(page.getByRole('option', { name: subjectName, exact: true }));
  await selectMonth(scope.locator('.el-date-editor input'), month, true);
  await activate(scope.getByRole('button', { name: '刷新', exact: true }));
  await expect(page.getByTestId('business-list-page')).toHaveAttribute('aria-busy', 'false');
}

async function noOverflow(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const drawer = page.locator('.business-detail-drawer:visible');
  if (await drawer.count()) {
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

async function syncAttendance(page: Page, corrected: boolean, sourceKey: string) {
  await activate(page.getByRole('button', { name: '接收考勤', exact: true }));
  const drawer = page.getByRole('dialog', { name: '接收考勤', exact: true });
  const loaded = page.waitForResponse(response => apiPath(response) === '/api/v1/payroll/attendance/fixture-response'
    && new URL(response.url()).searchParams.get('corrected') === String(corrected));
  await activate(drawer.getByRole('button', { name: corrected ? '载入虚构更正' : '载入虚构考勤', exact: true }));
  const fixtureResponse = await loaded;
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = (await fixtureResponse.json()).data;
  expect(fixture.complete).toBe(true);
  const source = field(drawer, '考勤来源 JSON').getByRole('textbox');
  await expect(source).toHaveValue(JSON.stringify(fixture.input, null, 2));
  await expect(drawer.getByRole('checkbox', { name: '来源分页已全部完成', exact: true })).toBeChecked();
  expect(JSON.parse(await source.inputValue()).month).toBe(month);
  await field(drawer, '来源标识').getByRole('textbox').fill(sourceKey);
  const result = await changed<{ id: string; version: number; payload: { issues: Array<{ code: string }> } }>(
    page, '/api/v1/payroll/attendance/sync', () => activate(drawer.getByRole('button', { name: '接收并核对', exact: true })),
  );
  expect(result.response.request().postDataJSON().sourceKey).toBe(sourceKey);
  expect(result.response.request().postDataJSON().complete).toBe(true);
  await expect(drawer).not.toBeVisible();
  return result.data;
}

async function reviewAttendance(page: Page, mobile: boolean, snapshotId: string, run: string) {
  await activate(page.getByRole('tab', { name: '异常核对', exact: true }));
  const results = page.locator(mobile ? '.mobile-result-list' : '.desktop-result-table');
  await expect(results.getByText('缺卡尚未被有效补卡或假勤覆盖', { exact: false }).first()).toBeVisible();
  await activate(results.getByRole('button', { name: '日明细', exact: true }).first());
  const drawer = page.locator('.business-detail-drawer:visible');
  await activate(drawer.getByRole('button', { name: '保存核对记录', exact: true }));
  await expect(drawer.getByText('请填写核对结论与依据', { exact: true })).toBeVisible();
  await field(drawer, '核对结论与依据').getByRole('textbox').fill(`${run}：虚构缺卡待补同步，不将核对备注代替有效来源。`);
  await changed(page, `/api/v1/payroll/attendance/${snapshotId}/review`, () => activate(drawer.getByRole('button', { name: '保存核对记录', exact: true })));
  await expect(drawer.getByRole('textbox')).toHaveValue('');
  await activate(drawer.getByRole('button', { name: /关闭|close/i }));
  await expect(drawer).not.toBeVisible();
}

async function sealAttendance(page: Page, id: string, succeeds: boolean) {
  await activate(page.getByRole('button', { name: '封账当前版本', exact: true }));
  const confirmation = page.getByRole('dialog', { name: '考勤封账', exact: true });
  const sealed = page.waitForResponse(response => apiPath(response) === `/api/v1/payroll/attendance/${id}/seal`);
  await activate(confirmation.getByRole('button', { name: '封账', exact: true }));
  const response = await sealed;
  if (!succeeds) {
    expect(response.status()).toBe(409);
    await expect(page.getByText('仍有影响计薪的考勤问题', { exact: false })).toBeVisible();
  } else {
    expect(response.ok()).toBe(true);
    expect((await response.json()).data.status).toBe('sealed');
    await expect(page.getByText('考勤已封账', { exact: true })).toBeVisible();
  }
}

async function createBatch(page: Page, own: { batchId?: string }): Promise<Batch> {
  await payrollMenu(page, '月度工资核算', '/payroll/batches');
  await selectScope(page);
  await activate(page.getByRole('button', { name: '新建核算', exact: true }));
  const dialog = page.getByRole('dialog', { name: '新建工资核算', exact: true });
  await activate(dialog.getByRole('button', { name: '创建核算批次', exact: true }));
  await expect(dialog.getByText('请选择发放月', { exact: true })).toBeVisible();
  await selectMonth(field(dialog, '发放月').locator('input'), '2026-12');
  await activate(field(dialog, '用途').locator('.el-select'));
  await activate(page.getByRole('option', { name: '测试环境验收', exact: true }));
  const result = await changed<Batch>(page, '/api/v1/payroll/batches', () => activate(dialog.getByRole('button', { name: '创建核算批次', exact: true })));
  own.batchId = result.data.id;
  expect(result.data.purpose).toBe('validation');
  expect(result.data.month).toBe(month);
  await expect(page).toHaveURL(new RegExp(`/payroll/batches/${own.batchId}(?:\\?|$)`));
  return result.data;
}

async function openBatch(page: Page, kind: 'approvals' | 'results', batchId: string) {
  await payrollMenu(page, kind === 'approvals' ? '工资审批' : '最终结果与补差', `/payroll/${kind}`);
  await selectScope(page);
  const results = page.locator((page.viewportSize()?.width ?? 1440) <= 768 ? '.mobile-result-list' : '.desktop-result-table');
  await expect(results.getByRole('button', { name: '查看办理', exact: true })).toHaveCount(1);
  await activate(results.getByRole('button', { name: '查看办理', exact: true }));
  await expect(page).toHaveURL(new RegExp(`/payroll/${kind}/${batchId}(?:\\?|$)`));
  await expect(page.locator('.payroll-detail .summary-grid').getByText(subjectName, { exact: true })).toBeVisible();
}

async function approve(page: Page, batch: Batch, note: string): Promise<Batch> {
  const detail = page.locator('.payroll-detail');
  await activate(detail.getByRole('button', { name: '通过当前环节', exact: true }));
  const form = detail.locator('.action-form');
  await field(form, '办理意见与依据').getByRole('textbox').fill(note);
  const result = await changed<Batch>(page, `/api/v1/payroll/batches/${batch.id}/decide`, () => activate(form.getByRole('button', { name: '通过当前环节', exact: true })));
  expect(result.response.request().postDataJSON().expectedVersion).toBe(batch.version);
  return result.data;
}

async function releaseThroughUi(page: Page, id: string, fixture: Fixture, run: string) {
  const state = database<{ status: string }>(`
    const batch=await db.payrollBatch.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}});
    if(batch.subjectId!==subject.id||batch.createdById!==marker.actors.HR001||batch.purpose!=='validation')throw Error('Wrong batch owner');
    return {status:batch.status};
  `);
  if (!['pending', 'approved'].includes(state.status)) return;
  // Approved payment arrangements require the explicit finance capability, not HR editing rights.
  const actor = state.status === 'pending' ? 'HR001' : 'VP001';
  await login(page, actor, fixture);
  const section = state.status === 'pending' ? 'batches' : 'results';
  await page.goto(`/payroll/${section}/${id}?subjectId=${fixture.subjectId}&month=${month}`);
  const detail = page.locator('.payroll-detail');
  const label = state.status === 'pending' ? '撤回重算' : '作废未付款版本';
  await activate(detail.getByRole('button', { name: label, exact: true }));
  const form = detail.locator('.action-form');
  await field(form, '办理意见与依据').getByRole('textbox').fill(`${run}：仅虚构UI验收，无付款，释放本轮支付安排。`);
  if (state.status === 'approved') {
    await activate(form.getByText('已核实此版本尚未付款', { exact: true }));
    await expect(form.getByRole('checkbox', { name: '已核实此版本尚未付款', exact: true })).toBeChecked();
  }
  await changed(page, `/api/v1/payroll/batches/${id}/${state.status === 'pending' ? 'withdraw' : 'void'}`,
    () => activate(form.getByRole('button', { name: label, exact: true })));
}

function cleanup(fixture: Fixture, own: { batchId?: string }, prefix: string) {
  // Only fixture bookkeeping is removed here. Business creation/review/approval/export never uses SQL or direct HTTP.
  const result = database<{ cleaned: boolean; remainingBatches: number; remainingReservations: number; remainingSnapshots: number }>(`
    return db.$transaction(async tx=>{
      const batchId=${JSON.stringify(own.batchId ?? null)};
      if(await tx.payrollBatch.count({where:{subjectId:subject.id,month:'2026-11',...(batchId?{id:{not:batchId}}:{})}}))
        throw Error('Concurrent fixture work detected; preserve all unrelated records');
      if(batchId){
        const batch=await tx.payrollBatch.findUniqueOrThrow({where:{id:batchId}});
        if(batch.subjectId!==subject.id||batch.month!=='2026-11'||batch.createdById!==marker.actors.HR001
          ||batch.purpose!=='validation'||!['draft','calculated','returned','withdrawn','voided'].includes(batch.status))throw Error('Batch not safely released');
        const versions=await tx.payrollVersion.findMany({where:{batchId},select:{id:true}}),versionIds=versions.map(row=>row.id);
        const lines=await tx.payrollLine.findMany({where:{versionId:{in:versionIds}},select:{id:true}}),lineIds=lines.map(row=>row.id);
        if(await tx.payrollReservation.count({where:{lineId:{in:lineIds}}})||await tx.payrollSettlement.count({where:{lineId:{in:lineIds}}}))
          throw Error('Retain unresolved reservations or payments for owner inspection');
        await tx.payrollEvent.deleteMany({where:{batchId,subjectId:subject.id}});
        await tx.payrollExportRecord.deleteMany({where:{versionId:{in:versionIds}}});
        await tx.payrollDecision.deleteMany({where:{versionId:{in:versionIds}}});
        await tx.payrollLine.deleteMany({where:{id:{in:lineIds}}});
        await tx.payrollVersion.deleteMany({where:{id:{in:versionIds}}});
        await tx.payrollBatch.delete({where:{id:batchId}});
      }
      const snapshots=await tx.payrollAttendanceSnapshot.findMany({where:{subjectId:subject.id,month:'2026-11',domain:'validation',
        createdById:marker.actors.HR001,sourceKey:{startsWith:${JSON.stringify(prefix)}}},select:{id:true}});
      for(const row of snapshots)await tx.payrollEvent.deleteMany({where:{subjectId:subject.id,batchId:null,
        actorId:marker.actors.HR001,action:{in:['attendance_sync','attendance_review','attendance_seal']},metadata:{path:['snapshotId'],equals:row.id}}});
      await tx.payrollAttendanceSnapshot.deleteMany({where:{id:{in:snapshots.map(row=>row.id)}}});
      return {cleaned:true,
        remainingBatches:await tx.payrollBatch.count({where:{subjectId:subject.id,month:'2026-11'}}),
        remainingReservations:await tx.payrollReservation.count({where:{subjectId:subject.id,attributionMonth:'2026-11'}}),
        remainingSnapshots:await tx.payrollAttendanceSnapshot.count({where:{subjectId:subject.id,month:'2026-11',sourceKey:{startsWith:${JSON.stringify(prefix)}}}})};
    },{timeout:20000});
  `);
  expect(result).toEqual({ cleaned: true, remainingBatches: 0, remainingReservations: 0, remainingSnapshots: 0 });
  expect(database<string>('return fingerprint(subject.id);'), 'Standards, rules, grants, opening balances and adjustments remain unchanged').toBe(fixture.baseline);
  return { ...result, configurationUnchanged: true };
}

function inspectWorkbook(encrypted: Buffer, password: string) {
  // Use the preview API's installed artifact libraries. The random test password travels only on stdin.
  const result = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node', '-e', `
    const fs=require('node:fs'),office=require('officecrypto-tool'),ExcelJS=require('exceljs');
    (async()=>{
      const input=JSON.parse(fs.readFileSync(0,'utf8')),encrypted=Buffer.from(input.encrypted,'base64');
      const isEncrypted=office.isEncrypted(encrypted);
      if(!isEncrypted)throw Error('Not encrypted');
      const plain=await office.decrypt(encrypted,{password:input.password});
      try{
        const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(plain);
        const sheet=workbook.getWorksheet('税前应发');if(!sheet)throw Error('Missing result sheet');
        const rows=[3,4].map(index=>({name:sheet.getCell(index,3).value,gross:sheet.getCell(index,11).value,
          batchId:sheet.getCell(index,12).value,version:sheet.getCell(index,13).value,
          numeric:Array.from({length:6},(_,offset)=>typeof sheet.getCell(index,offset+6).value==='number').every(Boolean)}));
        return {encrypted:isEncrypted,marker:sheet.getCell('A1').value,headers:sheet.getRow(2).values,rows};
      }finally{plain.fill(0);encrypted.fill(0)}
    })().then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{process.stderr.write('Encrypted fictional workbook validation failed');process.exitCode=1});
  `], { input: JSON.stringify({ encrypted: encrypted.toString('base64'), password }), encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
  return JSON.parse(result) as { encrypted: boolean; marker: string; headers: string[];
    rows: Array<{ name: string; gross: number; batchId: string; version: number; numeric: boolean }> };
}

test('real HR attendance -> calculation -> MGR review -> VP approval and encrypted final export', async ({ page, context }, info) => {
  const fixture = preflight(info);
  const run = `payroll-ui-${info.project.name}-${randomBytes(6).toString('hex')}`;
  const prefix = `${run}:`;
  const own: { batchId?: string } = {};
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  let filePassword = randomBytes(18).toString('base64url');
  const mobile = (page.viewportSize()?.width ?? 1440) <= 768;
  if (mobile) await page.mouse.move(0, 0);
  try {
    await login(page, 'HR001', fixture);
    await payrollMenu(page, '考勤打卡', '/payroll/attendance');
    await selectScope(page);
    const initial = await syncAttendance(page, false, `${prefix}initial`);
    expect(initial.payload.issues.some(issue => issue.code === 'MISSING_PUNCH')).toBe(true);
    await reviewAttendance(page, mobile, initial.id, run);
    await sealAttendance(page, initial.id, false);
    const corrected = await syncAttendance(page, true, `${prefix}corrected`);
    expect(corrected.version).toBeGreaterThan(initial.version);
    expect(corrected.payload.issues).toEqual([]);
    await sealAttendance(page, corrected.id, true);
    await activate(page.getByRole('tab', { name: '封账记录', exact: true }));
    await noOverflow(page, info, 'attendance-sealed');
    console.log(`[payroll-ui:${info.project.name}] attendance sealed`);

    let batch = await createBatch(page, own);
    const detail = page.locator('.payroll-detail');
    const calculated = await changed<Batch>(page, `/api/v1/payroll/batches/${batch.id}/calculate`, () => activate(detail.getByRole('button', { name: '自动核算', exact: true })));
    expect(calculated.response.request().postDataJSON().expectedVersion).toBe(batch.version);
    batch = calculated.data;
    expect(latest(batch).gross).toMatch(/^27900(?:\.0+)?$/);
    expect(latest(batch).issues).toEqual([]);
    expect(latest(batch).approvalPath).toEqual([fixture.actors.MGR001, fixture.actors.VP001]);
    expect(latest(batch).reviewerCount).toBe(1);
    await expect(detail.locator('.summary-grid').filter({ hasText: '税前应发' })).toContainText('27900');
    await expect(detail.getByRole('button', { name: '下载加密工资表' })).toHaveCount(0);
    await noOverflow(page, info, 'hr-calculated');
    console.log(`[payroll-ui:${info.project.name}] payroll calculated`);
    const submitted = await changed<Batch>(page, `/api/v1/payroll/batches/${batch.id}/submit`, () => activate(detail.getByRole('button', { name: '提交复核', exact: true })));
    expect(submitted.response.request().postDataJSON().expectedVersion).toBe(batch.version);
    batch = submitted.data;
    expect(batch.status).toBe('pending');
    await expect(detail.locator('.summary-grid').getByText('待复核', { exact: true })).toBeVisible();

    // Each role signs in through the actual preview form; no test injects an authentication token.
    await context.clearCookies();
    await context.clearPermissions();
    await page.goto('/login');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await login(page, 'MGR001', fixture);
    await openBatch(page, 'approvals', batch.id);
    await expect(detail.locator('.summary-grid').getByText('待复核', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '下载加密工资表' })).toHaveCount(0);
    batch = await approve(page, batch, `${run}：虚构来源与核算依据复核通过。`);
    expect(latest(batch).approvalStep).toBe(1);
    expect(latest(batch).decisions.at(-1)?.actorId).toBe(fixture.actors.MGR001);
    await noOverflow(page, info, 'mgr-reviewed');
    console.log(`[payroll-ui:${info.project.name}] manager reviewed`);

    await page.goto('/login');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await login(page, 'VP001', fixture);
    await openBatch(page, 'approvals', batch.id);
    await expect(detail.locator('.summary-grid').getByText('待审批', { exact: true })).toBeVisible();
    batch = await approve(page, batch, `${run}：虚构工资批准，无真实付款。`);
    expect(batch.status).toBe('approved');
    expect(latest(batch).decisions.map(decision => decision.actorId)).toEqual([fixture.actors.MGR001, fixture.actors.VP001]);
    await noOverflow(page, info, 'vp-approved');
    console.log(`[payroll-ui:${info.project.name}] final approval passed`);
    await activate(page.getByRole('dialog', { name: '工资批次', exact: true }).getByRole('button', { name: /关闭|close/i }));
    await openBatch(page, 'results', batch.id);
    await activate(detail.getByRole('button', { name: '下载加密工资表', exact: true }));
    const exportForm = detail.locator('.action-form');
    await activate(exportForm.getByRole('button', { name: '下载加密工资表', exact: true }));
    await expect(exportForm.getByText('请设置 4 至 64 位的独立文件密码', { exact: true })).toBeVisible();
    await field(exportForm, 'Excel 独立文件密码').locator('input[type=password]').fill(filePassword);
    const downloaded = page.waitForEvent('download');
    const exported = page.waitForResponse(response => apiPath(response) === `/api/v1/payroll/batches/${batch.id}/export`);
    await activate(exportForm.getByRole('button', { name: '下载加密工资表', exact: true }));
    const response = await exported;
    expect(response.ok()).toBe(true);
    expect(response.request().method()).toBe('POST');
    expect(new URL(response.url()).search).toBe('');
    expect(response.request().postDataJSON().expectedVersion).toBe(batch.version);
    expect(response.request().postDataJSON().filePassword === filePassword).toBe(true);
    const download = await downloaded;
    expect(download.suggestedFilename()).toContain('测试环境');
    expect(download.suggestedFilename()).toContain(`V${latest(batch).version}`);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const encrypted = Buffer.concat(chunks);
    const workbook = inspectWorkbook(encrypted, filePassword);
    encrypted.fill(0);
    expect(workbook.encrypted).toBe(true);
    expect(workbook.marker).toBe('测试环境');
    expect(workbook.headers).toContain('税前合计');
    expect(workbook.rows.find(row => row.name === '薪酬样例甲（虚构）')?.gross).toBe(17500);
    expect(workbook.rows.find(row => row.name === '薪酬样例乙（虚构）')?.gross).toBe(10400);
    for (const row of workbook.rows) { expect(row.batchId).toBe(batch.id); expect(row.version).toBe(latest(batch).version); expect(row.numeric).toBe(true); }
    await expect(detail.getByText('已下载当前批准版本，尚未确认入薪', { exact: true })).toBeVisible();
    await expect(detail.locator('input[type=password]')).toHaveCount(0);
    await noOverflow(page, info, 'vp-final-export');
    expect(errors).toEqual([]);
    const resultPath = info.outputPath('payroll-ui-run.json');
    await writeFile(resultPath, JSON.stringify({ run, month, subjectId: fixture.subjectId, batchId: batch.id,
      actorIds: fixture.actors, calculationVersion: latest(batch).version, gross: latest(batch).gross, encrypted: true, lifecyclePassed: true }, null, 2));
    await info.attach('payroll-ui-run.json', { path: resultPath, contentType: 'application/json' });
    console.log(`[payroll-ui:${info.project.name}] encrypted final workbook verified`);
  } finally {
    filePassword = '';
    if (own.batchId) await releaseThroughUi(page, own.batchId, fixture, run);
    const cleaned = cleanup(fixture, own, prefix);
    const cleanupPath = info.outputPath('payroll-ui-cleanup.json');
    await writeFile(cleanupPath, JSON.stringify({ run, ...cleaned }, null, 2));
    await info.attach('payroll-ui-cleanup.json', { path: cleanupPath, contentType: 'application/json' });
    console.log(`[payroll-ui:${info.project.name}] owned ledger cleaned; fixture unchanged`);
  }
});
