import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

type Fixture = { fictional: boolean; prefix: string; actors: Record<string, { id: string; name: string }>;
  cycles: { id: string; taskId: string }[]; candidateId: string; interviewId: string };
function fixture(demo = false): Fixture {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.resolve('../scripts/prepare-permission-preview.cjs'), ...(demo ? ['--demo'] : [])], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
    }));
  } catch { throw Error('Fictional permission fixture unavailable'); }
}
function session(id: string) {
  const code = `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
    (async()=>{const u=await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}});
      if(!u.name.startsWith('PF_')||u.dingtalkId||u.dingtalkUnionId)throw Error('fixture guard');
      const {JwtService}=require('@nestjs/jwt');process.stdout.write(new JwtService({secret:process.env.JWT_SECRET})
        .sign({sub:u.id,employeeNo:u.employeeNo},{expiresIn:'10m'}));
    })().finally(()=>db.$disconnect()).catch(()=>{process.exitCode=1});`;
  try { return execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { input: code, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  catch { throw Error('Fictional permission session unavailable'); }
}

function fictionalRole(id: string, data: { sysRole?: 'employee'; isAssessorOnly?: boolean }) {
  const code = `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
    (async()=>{const u=await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}});
      if(!u.name.startsWith('PF_')||u.dingtalkId||u.dingtalkUnionId)throw Error('fixture guard');
      await db.user.update({where:{id:u.id},data:${JSON.stringify(data)}});
    })().finally(()=>db.$disconnect()).catch(()=>{process.exitCode=1});`;
  try { execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { input: code,
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }); }
  catch { throw Error('Fictional role preparation failed'); }
}

test('narrow cycle owner sees monthly progress and reopens without acquiring scores or files', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const f = fixture(); expect(f.fictional).toBe(true);
  const token = session(f.actors.owner!.id), cycle = f.cycles[0]!;
  await page.addInitScript(value => {
    localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, token);
  const errors: string[] = []; page.on('pageerror', () => errors.push('pageerror'));
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/assessment-periods/cycle/${cycle.id}/monitoring`);
  await page.goto(`/cycles?cycleId=${cycle.id}`);
  const response = await loaded; expect(response.status()).toBe(200);
  const result = (await response.json()).data;
  expect(result.total).toBe(1); expect(result.summary.managerCompleted).toBe(1);
  expect(result.items[0].managerScoreTotal).toBeNull(); expect(result.items[0].managerGrade).toBeNull();
  const panel = page.getByTestId('cycle-monthly-progress-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.monthly-monitor__summary strong').nth(3)).toHaveText('1');
  await expect(panel.getByText(f.actors.employee!.name, { exact: true }).filter({ visible: true })).toBeVisible();
  for (const endpoint of [`/tasks/${cycle.taskId}`, `/employee-archives/${f.actors.employee!.id}`]) {
    const denied = await page.request.get(`/api/v1${endpoint}`, { headers: { authorization: `Bearer ${token}` } });
    expect(denied.status()).toBe(403);
  }
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('owned-monthly-progress.png'), fullPage: true, animations: 'disabled' });
  await panel.getByRole('button', { name: '重新开放月度自评', exact: true }).filter({ visible: true }).click();
  const prompt = page.getByRole('dialog', { name: '重新开放2026-11月度自评' });
  await prompt.getByRole('textbox').fill('隔离虚构验收：本人周期的月度记录重新开放');
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/assessment-periods/${result.items[0].id}/reopen`);
  await prompt.getByRole('button', { name: '确认重新开放', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(panel.locator('.monthly-monitor__summary strong').nth(3)).toHaveText('0');
  await expect(panel.getByRole('button', { name: '重新开放月度自评', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('retained demo is reachable through the existing preview login without consuming it', async ({ page }) => {
  const f = fixture(true);
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/cycles?cycleId=${f.cycles[0]!.id}`);
  const panel = page.getByTestId('cycle-monthly-progress-panel');
  await expect(panel.locator('.monthly-monitor__summary strong').nth(3)).toHaveText('1');
  await page.goto(`/talent-interviews/${f.interviewId}`);
  await expect(page.getByRole('button', { name: '核对钉钉日程', exact: true })).toBeVisible();
});

for (const role of ['hr_user', 'employee'] as const) test(`${role} recruitment editor can reconcile from the original interview page`, async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const f = fixture();
  if (role === 'employee') fictionalRole(f.actors.recruiter!.id, { sysRole: 'employee' });
  const token = session(f.actors.recruiter!.id);
  await page.addInitScript(value => {
    localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, token);
  const errors: string[] = []; page.on('pageerror', () => errors.push('pageerror'));
  await page.goto(`/talent-interviews/${f.interviewId}`);
  const collapse = page.locator('.interview-panel__list .el-collapse-item__header');
  await expect(collapse).toHaveCount(1);
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  const button = page.getByRole('button', { name: '核对钉钉日程', exact: true });
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  const reconciled = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/talent-interviews/${f.interviewId}/reconcile-calendar`);
  await button.click(); const response = await reconciled;
  expect(response.status()).toBe(200); expect((await response.json()).data.status).toBe('unconfigured');
  await expect(page.getByText('日程同步尚未开通，邀约记录仍保留。', { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('recruitment-editor-calendar.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('recruitment reader sees the interview without edit or reconciliation controls', async ({ page }, info) => {
  const f = fixture(), token = session(f.actors.reader!.id);
  await page.addInitScript(value => {
    localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, token);
  await page.goto(`/talent-interviews/${f.interviewId}`);
  await expect(page.getByText('隔离虚构邀约，不发送通知', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核对钉钉日程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '修改邀约', exact: true })).toHaveCount(0);
  const denied = await page.request.post(`/api/v1/talent-interviews/${f.interviewId}/reconcile-calendar`, {
    headers: { authorization: `Bearer ${token}` }, data: { version: 1 },
  });
  expect(denied.status()).toBe(403);
  await page.screenshot({ path: info.outputPath('recruitment-reader.png'), fullPage: true });
});

test('assessor-only residual specialist capabilities do not expose the global goal ledger', async ({ page }, info) => {
  const f = fixture(); fictionalRole(f.actors.owner!.id, { isAssessorOnly: true });
  const token = session(f.actors.owner!.id);
  await page.addInitScript(value => {
    localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, token);
  await page.goto('/dashboard');
  const me = await page.request.get('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(200); expect((await me.json()).data.isAssessorOnly).toBe(true);
  await expect(page.getByRole('button', { name: '目标台账', exact: true })).toHaveCount(0);
  for (const endpoint of [`/goal-plans/${f.cycles[0]!.taskId}`, `/goal-plans?scope=monitor&cycleId=${f.cycles[0]!.id}`,
    `/performance-lifecycle/task/${f.cycles[0]!.taskId}`]) {
    const denied = await page.request.get('/api/v1' + endpoint, { headers: { authorization: `Bearer ${token}` } });
    expect(denied.status()).toBe(403);
  }
  await page.screenshot({ path: info.outputPath('assessor-only-workbench.png'), fullPage: true });
});
