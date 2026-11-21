import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const origin = 'http://localhost:5173';
type Actor = { id: string; employeeNo: string; token: string };
type Application = { id: string; revision: number; stage: string; allowedActions: string[] };
type Candidate = { id: string; status: string; email: string | null };
test.use({ trace: 'off', video: 'off', screenshot: 'off', timezoneId: 'Asia/Shanghai' });
test.setTimeout(120_000);

function previewFixture<T>(operation: string): T {
  try {
    const docker = (args: string[], input?: string) =>
      execFileSync('docker', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 25_000 });
    if (docker(['inspect', 'hrm-api-1', '--format', '{{index .Config.Labels "com.docker.compose.project"}}']).trim() !== 'hrm') {
      throw new Error('Compose project mismatch');
    }
    const output = docker(['exec', '-i', 'hrm-api-1', 'node'], `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'), db = new PrismaClient();
      (async () => {
        const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
        const fixture = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
        if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview' || fixture?.value?.fictional !== true) throw new Error();
        ${operation}
      })().finally(() => db.$disconnect()).catch(() => { process.exitCode = 1; });
    `);
    return JSON.parse(output) as T;
  } catch {
    throw new Error('Guarded fictional preview fixture operation failed');
  }
}

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
  test(`real follow-up arrangements and responsibility filters at ${width}px`, async ({ page }, info) => {
    const mobile = width === 390;
    test.skip(info.project.name !== (mobile ? 'mobile' : 'desktop'), 'Each viewport runs in its matching device project');
    expect(info.project.use.baseURL).toBe(origin);
    expect(info.config.globalSetup).toBeNull();
    const prefix = `FP_${randomUUID().slice(0, 8)}`;
    const editor = createActor(prefix + '_a');
    const candidates: Candidate[] = [];
    let other: Actor | undefined;
    const blocked: string[] = [], pageErrors: string[] = [];
    type Plan = { id: string; summary: string; planStatus: string; planClosedById: string | null };
    const api = <T>(method: string, path: string, status: number, body?: unknown) => previewApi<T>(page, editor, method, path, status, body);
    const responseFor = (method: string, path: string) => page.waitForResponse(r =>
      r.request().method() === method && new URL(r.url()).pathname === '/api/v1' + path);
    const row = (name: string) => page.locator(mobile ? '.mobile-result-card:visible' : '.el-table:visible .el-table__row').filter({ hasText: name });
    const choose = async (filter: Locator, label: string) => {
      await filter.click();
      const response = responseFor('GET', '/talents');
      await page.getByRole('option', { name: label, exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(200);
      return ((await result.json()).data.items as Array<Candidate & { latestApplication?: Application }>).map(item => ({
        id: item.id, latestId: item.latestApplication?.id,
      }));
    };
    const dateIn = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format();
    try {
      other = createActor(prefix + '_b');
      await page.setViewportSize({ width, height });
      await page.addInitScript(token => localStorage.setItem('token', token), editor.token);
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || (url.pathname.startsWith('/api/v1/talent-resume/') && request.method() !== 'GET')) {
          blocked.push(url.pathname);
          return route.abort();
        }
        return route.continue();
      });
      page.on('pageerror', error => pageErrors.push(error.name));
      const followName = `虚构跟进人才${prefix}`, appName = `虚构应聘人才${prefix}`;
      const follow = await api<Candidate>('POST', '/talents', 201, { name: followName, phone: phone(), sourceChannel: 'other' });
      candidates.push(follow);
      const app = await api<Candidate>('POST', '/talents', 201, { name: appName, phone: phone(), sourceChannel: 'other', ownerId: other.id });
      candidates.push(app);
      const applicationPath = `/talent-recruitment/candidates/${app.id}/applications`;
      const oldPosition = `虚构本人历史岗位${prefix}`, newPosition = `虚构他人最新岗位${prefix}`;
      const owned = await api<Application>('POST', applicationPath, 201, { positionName: oldPosition });
      await api('POST', `/talent-recruitment/applications/${owned.id}/actions`, 201, { action: 'reserve', expectedRevision: owned.revision });
      await api<Application>('POST', applicationPath, 201, { positionName: newPosition, ownerId: other.id });
      await page.goto('/talents');
      const keyword = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
      await keyword.fill(prefix); await keyword.press('Enter');
      await expect(row(followName)).toBeVisible();
      await expect(row(appName)).toContainText(newPosition);
      const scope = page.locator('.talent-filter-bar__scope');
      expect(await choose(scope, '我负责的人才')).toEqual([{ id: follow.id, latestId: undefined }]);
      await expect(row(appName)).toHaveCount(0);
      expect(await choose(scope, '我负责的应聘')).toEqual([{ id: app.id, latestId: owned.id }]);
      await expect(row(appName)).toContainText(oldPosition + ' · 人才储备');
      const position = page.getByTestId('talent-filter-application-position'), stage = page.getByTestId('talent-filter-application-stage');
      expect(await choose(position, newPosition)).toEqual([]);
      expect(await choose(position, oldPosition)).toEqual([{ id: app.id, latestId: owned.id }]);
      expect(await choose(stage, '初筛')).toEqual([]);
      expect(await choose(stage, '人才储备')).toEqual([{ id: app.id, latestId: owned.id }]);
      const exportResponse = responseFor('GET', '/talents/export'), downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出应聘记录', exact: true }).click();
      expect((await exportResponse).status()).toBe(200);
      const file = await (await downloading).path();
      const ExcelJS = createRequire(new URL('../../../api/package.json', import.meta.url))('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file!);
      const sheet = workbook.getWorksheet('人才应聘记录');
      expect(sheet.rowCount).toBe(2);
      const columns: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell: { text: string }, index: number) => { columns[cell.text] = index; });
      expect(sheet.getRow(2).getCell(columns['姓名']).text).toBe(appName);
      expect(sheet.getRow(2).getCell(columns['应聘岗位']).text).toBe(oldPosition);
      expect(sheet.getRow(2).getCell(columns['应聘阶段']).text).toBe('人才储备');
      await row(appName).getByRole('button', { name: mobile ? '打开详情' : '打开', exact: true }).click();
      const drawer = page.locator('.talent-detail-drawer'), panel = drawer.locator('.application-panel');
      await expect(panel.locator('.el-select').first()).toContainText(oldPosition + ' · 人才储备');
      await expect(panel.getByText('应聘负责人', { exact: true })).toBeVisible();
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`follow-up-matched-application-${width}.png`), animations: 'disabled' });
      await drawer.locator('.el-drawer__close-btn').click();

      await page.getByRole('button', { name: '重置', exact: true }).click();
      await keyword.fill(followName); await keyword.press('Enter');
      const dueSwitch = page.getByRole('switch', { name: '仅看待跟进', exact: true });
      await dueSwitch.locator('..').click();
      await expect(dueSwitch).toBeChecked();
      await row(followName).getByRole('button', { name: mobile ? '打开详情' : '打开', exact: true }).click();
      const timeline = drawer.locator('.talent-follow-ups'), current = timeline.getByLabel('当前跟进安排', { exact: true });
      const form = timeline.locator('form'), summary = form.getByPlaceholder('本次沟通要点（必填）');
      const next = form.getByPlaceholder('不设置', { exact: true });
      const followPath = `/talents/${follow.id}/follow-ups`;
      const history = () => api<Plan[]>('GET', followPath, 200);
      const enterNextDate = async (date: string) => { await next.fill(date); await next.press('Tab'); };
      const record = async (text: string, plannedDate?: string) => {
        await timeline.getByRole('button', { name: '补充记录', exact: true }).click();
        await summary.fill(text);
        if (plannedDate) await enterNextDate(plannedDate);
        else await expect(next).toHaveCount(0);
        const response = responseFor('POST', followPath);
        await form.getByRole('button', { name: '保存跟进', exact: true }).click();
        expect((await response).status()).toBe(201);
        await expect(form).toHaveCount(0);
      };
      await record('虚构首次联系并安排下次', dateIn(30));
      await expect(current).toContainText(dateIn(30));
      await expect(current).toContainText('未来');
      const first = (await history()).find(plan => plan.planStatus === 'pending')!;
      expect(first).toBeTruthy();
      await record('虚构历史补充沟通');
      expect((await history()).find(plan => plan.planStatus === 'pending')?.id).toBe(first.id);
      const login = await page.request.post('/api/v1/auth/test-login', { data: { employeeNo: 'EMP001' } });
      expect(login.ok()).toBe(true);
      const { user, token } = (await login.json()).data;
      const employee: Actor = { id: user.id, employeeNo: 'EMP001', token };
      await previewApi(page, employee, 'POST', `${followPath}/${first.id}/cancel`, 403);
      expect((await history()).find(plan => plan.planStatus === 'pending')?.id).toBe(first.id);
      await current.getByRole('button', { name: '完成并记录', exact: true }).click();
      await summary.fill('冲突后仍需保存的虚构沟通');
      await enterNextDate(dateIn(60));
      const replacement = await previewApi<Plan>(page, other, 'POST', followPath, 201,
        { occurredAt: today, channel: 'phone', summary: '第二位虚构HR更新安排', nextFollowUpAt: dateIn(45), expectedPlanId: first.id });
      const complete = form.getByRole('button', { name: '完成并保存', exact: true });
      const conflict = responseFor('POST', followPath);
      await complete.click();
      expect((await conflict).status()).toBe(409);
      await timeline.getByRole('button', { name: '刷新安排，保留输入', exact: true }).click();
      await expect(current).toContainText(dateIn(45));
      await expect(summary).toHaveValue('冲突后仍需保存的虚构沟通');
      await expect(next).toHaveValue(dateIn(60));
      await expect(complete).toBeDisabled();
      expect((await history()).find(plan => plan.planStatus === 'pending')?.id).toBe(replacement.id);
      await timeline.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`follow-up-conflict-${width}.png`), animations: 'disabled' });
      await current.getByRole('button', { name: '完成并记录', exact: true }).click();
      await complete.click();
      await expect(current).toContainText(dateIn(60));
      expect((await history()).find(plan => plan.id === replacement.id)).toMatchObject({ planStatus: 'completed', planClosedById: editor.id });
      await current.getByRole('button', { name: '完成并记录', exact: true }).click();
      await summary.fill('虚构跟进已完成');
      await complete.click();
      await expect(current).toHaveCount(0);
      await expect(timeline).toContainText('已替换 ' + dateIn(30));
      await expect(timeline).toContainText('已完成 ' + dateIn(60));
      await expect(row(followName)).toHaveCount(0);
      await expect(drawer.getByText('人才库状态：新入库', { exact: true })).toBeVisible();
      await record('虚构重新安排联络', dateIn(90));
      await expect(current).toContainText(dateIn(90));
      await expect(row(followName)).toHaveCount(1);
      const before = await history(), toCancel = before.find(plan => plan.planStatus === 'pending')!;
      await current.getByRole('button', { name: '取消安排', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '取消跟进安排' });
      await expect(dialog).toContainText(dateIn(90));
      await page.screenshot({ path: info.outputPath(`follow-up-cancel-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: '取消安排', exact: true }).click();
      await expect(current).toHaveCount(0);
      await expect(timeline).toContainText('已取消 ' + dateIn(90));
      await expect(row(followName)).toHaveCount(0);
      const after = await history();
      expect(after).toHaveLength(before.length);
      expect(after.find(plan => plan.id === toCancel.id)).toMatchObject({ planStatus: 'cancelled', planClosedById: editor.id });
      expect(after.every(plan => plan.planStatus !== 'pending')).toBe(true);
      expect(await timeline.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(blocked).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      try {
        for (const candidate of candidates) {
          const path = `/talents/${candidate.id}`;
          const impact = await api<{ version: string; requiresForce: boolean }>('GET', path + '/delete-impact', 200);
          await api('DELETE', path, 200, { impactVersion: impact.version, force: impact.requiresForce });
        }
      } finally {
        archiveActor(editor);
        if (other) archiveActor(other);
      }
    }
  });
}

function createActor(prefix: string) {
  return previewFixture<Actor>(`
    const prefix = ${JSON.stringify(prefix)};
    const user = await db.$transaction(async tx => {
      const dept = await tx.department.findFirstOrThrow({ where: { name: '预览人事部' } });
      const actor = await tx.user.create({ data: {
        name: '虚构评审经办' + prefix, employeeNo: prefix, accountType: 'employee', sysRole: 'hr_user',
        status: 'active', deptId: dept.id, hrCapabilities: ['employee_archive_edit'],
      } });
      await tx.employmentRecord.create({ data: {
        userId: actor.id, employeeNo: prefix, deptId: dept.id, company: 'fuede', effectiveFrom: new Date('2000-01-01'),
        entryDate: new Date('2000-01-01'), employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture',
        reason: prefix, createdById: actor.id,
      } });
      return actor;
    });
    const { JwtService } = require('@nestjs/jwt');
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: user.id, employeeNo: prefix }, { expiresIn: '20m' });
    console.log(JSON.stringify({ id: user.id, employeeNo: prefix, token }));
  `);
}

function archiveActor(actor: Actor) {
  const archived = previewFixture<number>(`
    const actor = ${JSON.stringify({ id: actor.id, employeeNo: actor.employeeNo })};
    const now = new Date();
    const result = await db.user.updateMany({ where: actor, data: { status: 'resigned', archivedAt: now, deletedAt: now } });
    console.log(JSON.stringify(result.count));
  `);
  expect(archived).toBe(1);
}

async function previewApi<T>(page: Page, actor: Actor, method: string, path: string, status: number, data?: unknown) {
  const response = await page.request.fetch(`${origin}/api/v1${path}`, {
    method, headers: { Authorization: `Bearer ${actor.token}` }, data,
  }).catch(() => { throw new Error('Fictional preview API transport failed'); });
  if (response.status() !== status) throw new Error(`${method} ${path} returned HTTP ${response.status()}, expected ${status}`);
  return (await response.json()).data as T;
}

function phone() {
  return `100${String(randomInt(100_000_000)).padStart(8, '0')}`;
}

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
  test(`real preview preserves the application target, unsaved fields and email validation at ${width}px`, async ({ page }, info) => {
    const mobile = width === 390;
    test.skip(info.project.name !== (mobile ? 'mobile' : 'desktop'), 'This viewport runs once in its matching device project');
    expect(info.project.use.baseURL).toBe(origin);
    expect(info.config.globalSetup).toBeNull();
    const prefix = `XF_${randomUUID().slice(0, 8)}`, actor = createActor(prefix);
    const candidateIds: string[] = [], applications: string[] = [];
    const candidateName = `虚构评审人才${prefix}`, oldPosition = `虚构历史岗位${prefix}`, newPosition = `虚构最新岗位${prefix}`;
    const blocked: string[] = [], pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.name));
    try {
      await page.setViewportSize({ width, height });
      await page.addInitScript(token => localStorage.setItem('token', token), actor.token);
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || (url.pathname.startsWith('/api/v1/talent-resume/') && request.method() !== 'GET')) {
          blocked.push(url.pathname);
          return route.abort();
        }
        return route.continue();
      });
      const api = <T>(method: string, path: string, status: number, body?: unknown) => previewApi<T>(page, actor, method, path, status, body);
      const candidate = await api<Candidate>('POST', '/talents', 201, { name: candidateName, phone: phone(), sourceChannel: 'other' });
      candidateIds.push(candidate.id);
      const base = `/talent-recruitment/candidates/${candidate.id}/applications`;
      const historical = await api<Application>('POST', base, 201, { positionName: oldPosition });
      applications.push(historical.id);
      await api<Application>('POST', `/talent-recruitment/applications/${historical.id}/actions`, 201, { action: 'reserve', expectedRevision: historical.revision });
      const latest = await api<Application>('POST', base, 201, { positionName: newPosition });
      applications.push(latest.id);
      await page.goto('/talents');
      const keyword = page.getByPlaceholder('姓名 / 手机 / 公司 / 职位');
      await keyword.fill(candidateName); await keyword.press('Enter');
      await page.getByTestId('talent-filter-application-position').click();
      await page.getByRole('option', { name: oldPosition, exact: true }).click();
      await page.getByTestId('talent-filter-application-stage').click();
      await page.getByRole('option', { name: '人才储备', exact: true }).click();
      const row = page.locator(mobile ? '.mobile-result-card' : '.el-table:visible .el-table__row').filter({ hasText: candidateName });
      await expect(row).toContainText(`${oldPosition} · 人才储备`);
      await row.getByRole('button', { name: mobile ? '打开详情' : '打开', exact: true }).click();
      const detail = page.locator('.talent-detail-drawer'), panel = detail.locator('.application-panel');
      await expect(panel.locator('.el-select').first()).toContainText(`${oldPosition} · 人才储备`);
      await expect(panel.getByText('本次应聘阶段', { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
      const command = panel.locator('.application-panel__command');
      await command.locator('textarea').fill('虚构评审验证本次应聘独立淘汰');
      const rejected = page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/talent-recruitment/applications/${historical.id}/actions`);
      await command.getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
      expect((await rejected).status()).toBe(201);
      await expect(panel.locator('.application-panel__stage')).toHaveText('已淘汰');
      await expect(detail.getByText('人才库状态：新入库', { exact: true })).toBeVisible();
      expect((await api<Application>('GET', `/talent-recruitment/applications/${latest.id}`, 200)).stage).toBe('screening');
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`application-context-${width}.png`), animations: 'disabled' });
      await detail.locator('.el-drawer__close-btn').click();

      const create = page.getByRole('button', { name: '新增人才', exact: true }), drawer = page.locator('.talent-form-drawer');
      const name = drawer.getByPlaceholder('候选人姓名');
      const closeEditedForm = async () => {
        if (mobile) await page.keyboard.press('Escape');
        else if (width === 1024) await page.mouse.click(10, 80);
        else await drawer.locator('.el-drawer__close-btn').click();
      };
      await create.click();
      await name.fill(`虚构未保存${prefix}`);
      await closeEditedForm();
      const discard = page.getByRole('dialog', { name: '放弃未保存修改？' });
      await expect(discard).toBeVisible();
      await page.screenshot({ path: info.outputPath(`discard-${width}.png`), animations: 'disabled' });
      await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
      await expect(discard).not.toBeVisible();
      await expect(name).toHaveValue(`虚构未保存${prefix}`);
      await closeEditedForm();
      await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      await create.click();
      await expect(name).toHaveValue('');

      const emailCandidate = `虚构邮箱${prefix}`;
      await name.fill(emailCandidate);
      await drawer.getByPlaceholder('11 位手机号').fill(phone());
      await drawer.getByTestId('talent-form-source').click();
      await page.getByRole('option', { name: '其他', exact: true }).click();
      const email = drawer.getByLabel('邮箱', { exact: true });
      const rejectedEmail = width === 1024 ? 'invalid-email' : 'hr@[127.0.0.1]';
      await email.fill(rejectedEmail);
      const submit = drawer.getByRole('button', { name: '加入人才库', exact: true });
      const listenForSave = () => page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/talents', { timeout: 6000 });
      const [invalidResponse] = await Promise.all([listenForSave(), submit.click()]);
      expect(invalidResponse.status()).toBe(400);
      const emailField = drawer.locator('.el-form-item').filter({ has: page.getByLabel('邮箱', { exact: true }) });
      await expect(emailField.locator('.el-form-item__error')).toHaveText('邮箱格式不正确');
      await expect(page.getByText('邮箱格式不正确', { exact: true })).toHaveCount(1);
      await expect(email).toHaveValue(rejectedEmail);
      expect((await api<{ total: number }>('GET', `/talents?keyword=${encodeURIComponent(emailCandidate)}`, 200)).total).toBe(0);
      await emailField.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: info.outputPath(`email-inline-${width}.png`), animations: 'disabled' });
      const validEmail = width === 1024 ? null : 'hr@example.xn--fiqs8s';
      await email.fill(validEmail ? ` ${validEmail} ` : '   ');
      await expect(page.getByText('邮箱格式不正确', { exact: true })).toHaveCount(0);
      const [saveResponse] = await Promise.all([listenForSave(), submit.click()]);
      expect(saveResponse.status()).toBe(201);
      const created = (await saveResponse.json()).data as Candidate;
      candidateIds.push(created.id);
      expect((await api<Candidate>('GET', `/talents/${created.id}`, 200)).email).toBe(validEmail);
      await expect(drawer).not.toBeVisible();
      await expect(discard).toHaveCount(0);
      if (mobile) {
        await create.click();
        await name.fill('虚构空白邮箱' + prefix);
        await drawer.getByPlaceholder('11 位手机号').fill(phone());
        await drawer.getByTestId('talent-form-source').click();
        await page.getByRole('option', { name: '其他', exact: true }).click();
        await email.fill('   ');
        const [blankResponse] = await Promise.all([listenForSave(), submit.click()]);
        expect(blankResponse.status()).toBe(201);
        const blank = (await blankResponse.json()).data as Candidate;
        candidateIds.push(blank.id);
        expect((await api<Candidate>('GET', '/talents/' + blank.id, 200)).email).toBeNull();
      }
      expect(blocked).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally {
      try {
        for (const id of applications) {
          const path = `/talent-recruitment/applications/${id}`;
          const application = await previewApi<Application>(page, actor, 'GET', path, 200);
          if (application.allowedActions.includes('withdraw')) {
            await previewApi(page, actor, 'POST', `${path}/actions`, 201, { action: 'withdraw', expectedRevision: application.revision, note: '虚构回归清理' });
          }
        }
        for (const id of candidateIds) {
          const impact = await previewApi<{ version: string; requiresForce: boolean }>(page, actor, 'GET', `/talents/${id}/delete-impact`, 200);
          await previewApi(page, actor, 'DELETE', `/talents/${id}`, 200, { impactVersion: impact.version, force: impact.requiresForce });
        }
      } finally {
        archiveActor(actor);
      }
    }
  });
}
