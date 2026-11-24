import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { assertContractPreview, createContractFixture, readContractState, removeContractFixture, type ContractFixture } from './contract-management-fixture';

test.setTimeout(120000);
test.use({ trace: 'off', video: 'off', screenshot: 'only-on-failure', actionTimeout: 15000 });

function seedImportedTransfer(f: ContractFixture) {
  try {
    execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { stdio: 'pipe', timeout: 20000, input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
      (async()=>{await p.user.findFirstOrThrow({where:{id:${JSON.stringify(f.employee.id)},employeeNo:${JSON.stringify(f.employee.employeeNo)}}});
        await p.employeeContract.create({data:{userId:${JSON.stringify(f.employee.id)},contractType:'transfer',sequence:0,
          name:${JSON.stringify(f.prefix + '_虚构导入转签')},contractSubjectId:${JSON.stringify(f.subjects[1].id)},signingCompany:null,
          originalCompany:${JSON.stringify(f.subjects[0].name)},newCompany:${JSON.stringify(f.subjects[1].name)},
          signedAt:new Date('2020-01-01'),effectiveFrom:new Date('2020-01-01'),expiresAt:new Date('2099-12-31'),termType:'固定期限'}});
      })().finally(()=>p.$disconnect()).catch(()=>process.exitCode=1);` });
  } catch { throw new Error('Owned fictional transfer fixture failed'); }
}

async function open(page: Page, f: ContractFixture) {
  await page.goto('/users');
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(f.employee.employeeNo);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users' && new URL(r.url()).searchParams.get('keyword') === f.employee.employeeNo);
  await page.getByRole('button', { name: '查询', exact: true }).click(); expect((await loaded).status()).toBe(200);
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '查看档案', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await drawer.getByRole('tab', { name: '合同材料', exact: true }).click();
  await expect(drawer.locator('.employee-archive__contract-card')).toHaveCount(1);
  return drawer;
}

test('imported transfer subject stays visible through edit, save and reopening', async ({ page }, info) => {
  assertContractPreview(info);
  const f = createContractFixture();
  try {
    seedImportedTransfer(f);
    const before = readContractState(f).contracts[0]!;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.name));
    await page.addInitScript(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 600000)); }, f.token);
    let drawer = await open(page, f);
    let card = drawer.locator('.employee-archive__contract-card');
    await expect(card.locator('.contract-quick-facts')).toContainText(f.subjects[1].name);
    await card.getByRole('button', { name: '查看详情', exact: true }).click();
    await expect(card.locator('.employee-archive__facts > div').filter({ hasText: /^签约公司/ }).locator('strong')).toHaveText(f.subjects[1].name);
    await card.getByRole('button', { name: '修改信息', exact: true }).click();
    const field = drawer.locator('[data-archive-field="contracts.0.signingCompany"]');
    await expect(field).toContainText(f.subjects[1].name);
    await field.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: f.subjects[0].name, exact: true }).click();
    await expect(field).toContainText(f.subjects[0].name);
    const submitted = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft`);
    await drawer.getByRole('button', { name: '保存并生效', exact: true }).click();
    const response = await submitted; expect(response.status()).toBe(200); expect((await response.json()).data.reviewOutcome).toBe('not_required');
    await expect(drawer.locator('.archive-inline-editor')).not.toBeVisible();
    drawer = await open(page, f); card = drawer.locator('.employee-archive__contract-card');
    await expect(card.locator('.contract-quick-facts')).toContainText(f.subjects[0].name);
    const after = readContractState(f).contracts[0]!;
    expect(after.id).toBe(before.id); expect(after.newCompany).toBe(f.subjects[0].name); expect(after.signingCompany).toBe(f.subjects[0].name);
    for (const key of ['signedAt', 'effectiveFrom', 'expiresAt', 'originalCompany'] as const) expect(after[key]).toBe(before[key]);
    await card.getByRole('button', { name: '修改信息', exact: true }).click();
    await expect(drawer.locator('[data-archive-field="contracts.0.signingCompany"]')).toContainText(f.subjects[0].name);
    expect(await drawer.locator('.el-drawer__body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('transfer-company.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  } finally { await page.close(); removeContractFixture(f); }
});
