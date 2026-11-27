import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

type Demo = { fictional: boolean; prefix: string; employeeId: string; employeeName: string;
  taskId: string; changeId: string; changeParentId: string; improvementId: string; confirmationId: string };
test.setTimeout(180000);
const origin = 'http://localhost:5173';
async function login(page: Page, employeeNo = 'HR001') {
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  if (employeeNo !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${employeeNo})` }).click();
  }
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/test-login');
  await page.getByTestId('preview-login').click();
  expect((await response).ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function read(page: Page, endpoint: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const result = await page.request.get(`/api/v1${endpoint}`, { headers: { authorization: `Bearer ${token}` } });
  expect(result.status(), endpoint).toBe(200);
  return (await result.json()).data;
}
function prepare(): Demo {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.resolve('../scripts/prepare-lifecycle-preview.cjs')], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
    }));
  } catch { throw new Error('Guarded fictional lifecycle fixture could not be prepared'); }
}
function fictionalEmployeeToken(id: string) {
  const code = `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client'); const db=new PrismaClient();
    (async()=>{const u=await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}});
      if(!u.name.startsWith('LC_')||u.dingtalkId||u.dingtalkUnionId)throw Error('fixture guard');
      const {JwtService}=require('@nestjs/jwt');process.stdout.write(new JwtService({secret:process.env.JWT_SECRET})
        .sign({sub:u.id,employeeNo:u.employeeNo,sysRole:u.sysRole},{expiresIn:'15m'}));
    })().finally(()=>db.$disconnect()).catch(()=>{process.exitCode=1});`;
  try { return execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { input: code, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  catch { throw Error('Fictional role session could not be established'); }
}
async function manage(page: Page, kind: string, id: string, action: 'terminate' | 'delete') {
  const title = action === 'terminate' ? '终止流程' : '删除记录';
  await page.getByRole('button', { name: title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('操作原因', { exact: true }).fill('隔离虚构验收：测试流程管理，不修改真实资料');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/performance-lifecycle/${kind}/${id}/${action}` && r.request().method() === 'POST');
  await expect(dialog.getByRole('button', { name: title, exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: title, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
}

test('list operations terminate and delete the exact four fictional records without opening a detail', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  const f = prepare(); expect(f.fictional).toBe(true);
  const errors: string[] = []; page.on('pageerror', () => errors.push('pageerror'));
  await login(page);
  const records = [
    { kind: 'task', id: f.taskId, route: `/tasks?goalView=monitor&employeeName=${encodeURIComponent(f.employeeName)}` },
    { kind: 'goal_change', id: f.changeId, route: '/goal-changes?scope=all' },
    { kind: 'improvement_plan', id: f.improvementId, route: '/improvement-plans' },
    { kind: 'confirmation', id: f.confirmationId, route: '/confirmation-applications/manage' },
  ];
  for (const row of records) {
    await page.goto(row.route);
    const before = await read(page, `/performance-lifecycle/${row.kind}/${row.id}`);
    expect(before.allowedActions).toContain('lifecycle_terminate');
    const controls = page.locator(`.lifecycle-actions--compact[data-record-id="${row.id}"]:visible`);
    await expect(controls.getByRole('button', { name: '终止', exact: true })).toBeVisible();
    for (const action of ['terminate', 'delete'] as const) {
      await controls.getByRole('button', { name: action === 'terminate' ? '终止' : '删除', exact: true }).click();
      const title = action === 'terminate' ? '终止流程' : '删除记录';
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('操作原因', { exact: true }).fill('隔离虚构验收：从原列表操作列办理');
      const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/performance-lifecycle/${row.kind}/${row.id}/${action}` && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: title, exact: true }).click();
      expect((await response).status()).toBe(201);
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(origin + row.route);
    }
    await expect(controls).toHaveCount(0);
    const history = await read(page, `/performance-lifecycle/${row.kind}/${row.id}`);
    expect(history.lifecycleStatus).toBe('deleted');
    expect(history.events.filter((event: { action: string }) => event.action === 'lifecycle_terminated')).toHaveLength(1);
    expect(history.events.filter((event: { action: string }) => event.action === 'lifecycle_deleted')).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${row.kind}-list-after-delete.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('HR terminates and logically removes all four record kinds; original facts and audit remain', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  const f = prepare(); expect(f.fictional).toBe(true);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  const records = [
    { kind: 'task', id: f.taskId, route: `/tasks/${f.taskId}?goalView=monitor` },
    { kind: 'goal_change', id: f.changeId, route: `/goal-changes/${f.changeId}` },
    { kind: 'improvement_plan', id: f.improvementId, route: `/improvement-plans/${f.improvementId}` },
    { kind: 'confirmation', id: f.confirmationId, route: `/confirmation-applications/manage/${f.confirmationId}` },
  ];
  for (const row of records) {
    await page.goto(row.route);
    const before = await read(page, `/performance-lifecycle/${row.kind}/${row.id}`);
    expect(before.allowedActions).toContain('lifecycle_terminate');
    await manage(page, row.kind, row.id, 'terminate');
    await expect(page.getByText('已终止 · 仅供查阅，既有业务事实保留', { exact: true })).toBeVisible();
    const stopped = await read(page, `/performance-lifecycle/${row.kind}/${row.id}`);
    expect(stopped.lifecycleStatus).toBe('terminated');
    expect(stopped.events.some((e: { action: string }) => e.action === 'lifecycle_terminated')).toBe(true);
    await manage(page, row.kind, row.id, 'delete');
    const removed = await read(page, `/performance-lifecycle/${row.kind}/${row.id}`);
    expect(removed.lifecycleStatus).toBe('deleted');
    expect(removed.events.filter((e: { action: string }) => e.action === 'lifecycle_deleted')).toHaveLength(1);
    await page.reload();
    await expect(page.getByText('已删除 · 仅供查阅，既有业务事实保留', { exact: true })).toBeVisible();
  }
  const parent = await read(page, `/goal-plans/${f.changeParentId}`);
  expect(parent.status).toBe('goal_confirmed'); expect(parent.lifecycleStatus).toBe('active');
  await page.goto('/dashboard');
  await expect(page.locator('.workbench-section')).not.toHaveCount(0);
  await expect(page.locator('.workbench-section[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.workbench-section').filter({ hasText: f.employeeName })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('workbench-after-termination.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('dashboard remembers folds, keeps errors visible while folded, and only opens the pending team scope', async ({ page }, info) => {
  const f = prepare();
  await login(page, 'MGR001');
  const heading = page.locator('.workbench-section').filter({ has: page.getByRole('heading', { name: '绩效事项', exact: true }) });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveAttribute('aria-busy', 'false');
  const toggle = heading.getByRole('button', { name: /绩效事项/ }).first();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await toggle.click();
  await page.reload(); await expect(heading).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.route('**/api/v1/goal-plans?**', route => route.abort('failed'));
  await heading.getByRole('button', { name: '刷新绩效事项', exact: true }).click();
  await expect(heading.getByRole('alert')).toContainText('暂时无法读取');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.unroute('**/api/v1/goal-plans?**');
  await heading.getByRole('button', { name: '重试', exact: true }).click();
  await expect(heading.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('workbench-folded.png'), fullPage: true });
  await toggle.click();
  const plan = page.locator('.plan-entry').filter({ hasText: `${f.prefix} 目标台账` });
  await expect(plan).toHaveCount(1);
  await plan.getByTestId('manager-goal-review-open').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('stageState')).toBe('pending');
  await expect.poll(() => new URL(page.url()).searchParams.get('cycleId')).toBe(f.cycleId);
});

test('termination alone removes employee tasks and own confirmation from current work, retaining history', async ({ page }, info) => {
  const f = prepare();
  await login(page);
  await page.goto(`/tasks/${f.taskId}?goalView=monitor`);
  await manage(page, 'task', f.taskId, 'terminate');
  await page.goto(`/confirmation-applications/manage/${f.confirmationId}`);
  await manage(page, 'confirmation', f.confirmationId, 'terminate');
  const token = fictionalEmployeeToken(f.employeeId);
  await page.evaluate(value => { localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 600000)); }, token);
  await page.goto('/dashboard');
  const region = page.getByRole('region', { name: '绩效事项', exact: true });
  await expect(region).toHaveAttribute('aria-busy', 'false');
  await expect(region.getByTestId('employee-current-task-open')).toHaveText('查看进度');
  const mine = await read(page, '/tasks/mine?lifecycleStatus=active&page=1&pageSize=100');
  expect(mine.items.some((item: { id: string }) => item.id === f.taskId)).toBe(false);
  const operations = await read(page, '/workbench/operations?page=1&pageSize=5');
  expect(operations.groups.performance.status).toBe('ready');
  const queues = operations.groups.performance;
  expect(queues.actionable.total).toBeLessThanOrEqual(5); expect(queues.attention.total).toBeLessThanOrEqual(5);
  expect([...queues.actionable.items, ...queues.attention.items].some((item: { requestId?: string }) => item.requestId === f.confirmationId)).toBe(false);
  const history = await read(page, `/performance-lifecycle/confirmation/${f.confirmationId}`);
  expect(history.lifecycleStatus).toBe('terminated'); expect(history.allowedActions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('employee-after-termination.png'), fullPage: true });
});
