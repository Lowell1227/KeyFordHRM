import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';

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
