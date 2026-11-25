import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

test.setTimeout(120000); test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
type Actor = { id: string; token: string };
type Fixture = { prefix: string; baseline: unknown; position: { id: string; name: string }; secondPosition: { id: string; name: string };
  department: { id: string }; actors: Record<string, Actor> };
type Demand = { id: string; revision: number };
function node<T>(body: string): T {
  try { return JSON.parse(execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'], input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);const {PrismaClient}=require('@prisma/client');
    const db=new PrismaClient({log:[],errorFormat:'minimal'});const fixtures=require('./test/talent-core/recruitment-intake-fixtures.cjs');
    (async()=>{await require('./test/talent-core/recruitment-demand-preview.cjs').assertFictionalDatabase(db);${body}})().catch(()=>{process.exitCode=1}).finally(()=>db.$disconnect());` })); }
  catch { throw new Error('Guarded posting fixture failed; credential-bearing output suppressed'); }
}
async function api<T>(page: Page, actor: Actor, path: string, data: unknown): Promise<T> {
  const result = await page.request.post('http://localhost:5173/api/v1' + path, { headers: { authorization: 'Bearer ' + actor.token }, data });
  expect(result.status()).toBe(201); return (await result.json()).data;
}
test('posting manager UI creates, verifies, remaps with history and opens the matching intake context', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const mobile = info.project.name === 'mobile'; await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900 });
  const f = node<Fixture>(`console.log(JSON.stringify(await fixtures.createIntakeFixture(db,'RDI_'+require('node:crypto').randomUUID().slice(0,8))));`);
  const proof: Record<string, unknown> = { prefix: f.prefix, actualUI: true, realNestPostgres: true, routeMocks: false, viewport: page.viewportSize() };
  let passed = false;
  async function createDemand(position: Fixture['position']) {
    let row = await api<Demand>(page, f.actors.operator, '/recruitment-demands/local', { requestId: randomUUID(), deptId: f.department.id,
      positionId: position.id, headcount: 2, reason: '虚构外部职位页面验收需求' });
    row = await api<Demand>(page, f.actors.operator, `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'submit' });
    return api<Demand>(page, f.actors.reviewer, `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'approve' });
  }
  async function open(position: Fixture['position']) {
    await page.goto('/recruitment/demands'); const search = page.getByPlaceholder('部门、岗位或单号'); await search.fill(f.prefix);
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/recruitment-demands' && response.request().method() === 'GET');
    await page.getByRole('button', { name: '查询', exact: true }).click(); await loaded;
    const row = page.locator(mobile ? '.mobile-result-card' : '.el-table__row').filter({ hasText: position.name }).filter({ visible: true });
    await expect(row).toHaveCount(1); await row.getByRole('button', { name: mobile ? '查看需求' : '查看', exact: true }).click();
    const panel = page.getByRole('region', { name: '外部职位与收件', exact: true }); await expect(panel).toBeVisible(); return panel;
  }
  try {
    const first = await createDemand(f.position), second = await createDemand(f.secondPosition);
    await page.goto('/login'); await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, f.actors.operator.token);
    let panel = await open(f.position); await panel.getByRole('button', { name: '登记外部职位', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '登记外部职位', exact: true });
    await dialog.getByRole('textbox', { name: '外部职位渠道', exact: true }).fill('job_site');
    const name = `虚构${f.prefix}职位页面登记`; await dialog.getByRole('textbox', { name: '外部职位名称', exact: true }).fill(name);
    await dialog.getByRole('textbox', { name: '外部职位链接', exact: true }).fill(`https://example.invalid/${f.prefix}/ui-job`);
    await dialog.getByRole('textbox', { name: '稳定外部职位ID', exact: true }).fill(f.prefix + '_UI');
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/recruitment-postings' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存职位归属', exact: true }).click(); expect((await created).status()).toBe(201);
    const posting = (await (await created).json()).data; expect(posting).toMatchObject({ verifiedIdentity: false, demandId: first.id });
    await expect(dialog).not.toBeVisible(); await expect(panel.getByRole('button', { name: '登记外部职位', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '查看 / 修改归属', exact: true }).click(); dialog = page.getByRole('dialog', { name: '核对外部职位', exact: true });
    const demandSelect = dialog.getByRole('combobox', { name: '外部职位所属需求', exact: true }); await demandSelect.fill(f.prefix);
    const option = page.getByRole('option').filter({ hasText: second.id }); await expect(option).toBeVisible(); await option.click();
    await dialog.locator('.el-checkbox').click();
    await dialog.getByRole('textbox', { name: '身份核实依据', exact: true }).fill('虚构渠道唯一职位ID及链接已核对');
    const reason = '虚构经办明确更换归属，旧来源保持原依据'; await dialog.getByRole('textbox', { name: '更换归属原因', exact: true }).fill(reason);
    const changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/recruitment-postings/' + posting.id && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: '保存职位归属', exact: true }).click();
    await page.getByRole('button', { name: '已核对，更换归属', exact: true }).click();
    expect((await changed).status()).toBe(200); const current = (await (await changed).json()).data;
    expect(current).toMatchObject({ verifiedIdentity: true, demandId: second.id, revision: posting.revision + 1 });
    await expect(dialog).not.toBeVisible();
    panel = await open(f.secondPosition); await expect(panel).toContainText(name);
    await panel.getByRole('button', { name: '查看 / 修改归属', exact: true }).click(); dialog = page.getByRole('dialog', { name: '核对外部职位', exact: true });
    await dialog.getByRole('button', { name: '职位归属历史', exact: true }).click();
    const history = dialog.getByRole('region', { name: '职位归属历史', exact: true });
    await expect(history.getByRole('button', { name: first.id.slice(0, 8), exact: true })).toHaveCount(2);
    await expect(history.getByRole('button', { name: second.id.slice(0, 8), exact: true })).toHaveCount(1);
    await expect(history).toContainText(reason);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('posting-create-verified-remap-history.png'), fullPage: true, animations: 'disabled' });
    await history.getByRole('button', { name: first.id.slice(0, 8), exact: true }).last().click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('demandId=' + first.id));
    expect(new URL(page.url()).searchParams.get('demandId')).toBe(first.id);
    proof.exactHistoryTargetURL = page.url();
    panel = await open(f.secondPosition);
    await panel.getByRole('button', { name: '登记该职位收件', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('postingId=' + posting.id)); expect(new URL(page.url()).searchParams.get('demandId')).toBe(second.id);
    await page.getByRole('button', { name: '手工收件', exact: true }).click(); const intake = page.getByRole('dialog', { name: '手工收件', exact: true });
    await expect(intake.getByRole('textbox', { name: '收件意向岗位', exact: true })).toHaveValue(f.secondPosition.name);
    await expect(intake.locator('.el-form-item').filter({ has: page.getByText('外部职位', { exact: true }) })).toContainText(name);
    await page.screenshot({ path: info.outputPath('posting-opens-corresponding-intake-context.png'), fullPage: true, animations: 'disabled' });
    proof.postingId = posting.id; proof.initialDemand = first.id; proof.currentDemand = second.id; passed = true;
  } finally {
    proof.passed = passed;
    try { proof.cleanup = node(`console.log(JSON.stringify(await fixtures.archiveIntakeFixture(db,${JSON.stringify(f.prefix)})));`);
      node(`await fixtures.assertProtectedBaseline(db,${JSON.stringify(f.baseline)});console.log(JSON.stringify({protected:true}));`); proof.protectedBaselineUnchanged = true;
    } finally { await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2)); }
  }
});
