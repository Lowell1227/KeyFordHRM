import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { assertContractPreview, createContractFixture, removeContractFixture, previewOrigin } from './contract-management-fixture';

test('HR saves and filters the new project and ecommerce tags', async ({ page }, info) => {
  assertContractPreview(info);
  const fixture = createContractFixture(), name = fixture.prefix + '_虚构标签人才';
  try {
    await page.addInitScript(token => localStorage.setItem('token', token), fixture.token);
    await page.goto('/talents');
    await page.getByRole('button', { name: '新增人才', exact: true }).click();
    const drawer = page.locator('.talent-form-drawer');
    await drawer.getByPlaceholder('候选人姓名').fill(name);
    await drawer.getByPlaceholder('11 位手机号').fill('100' + String(randomInt(100000000)).padStart(8, '0'));
    await drawer.getByTestId('talent-form-source').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const tags = drawer.locator('.el-form-item').filter({ has: page.locator('label', { hasText: '标签（最多 5 个）' }) }).locator('.el-select');
    await tags.click();
    await page.getByRole('option', { name: '项目管理', exact: true }).click();
    await page.getByRole('option', { name: '电商运营', exact: true }).click();
    await page.keyboard.press('Escape');
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/talents' && r.request().method() === 'POST');
    await drawer.getByRole('button', { name: '加入人才库', exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(drawer).not.toBeVisible();
    for (const [key, label] of [['project_management', '项目管理'], ['ecommerce_operations', '电商运营']]) {
      const filter = page.getByTestId('talent-filter-tag'); await filter.click();
      const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/talents' && new URL(r.url()).searchParams.get('tag') === key);
      await page.getByRole('option', { name: label, exact: true }).click();
      const result = await loaded; expect(result.status()).toBe(200);
      const data = (await result.json()).data;
      expect(data.items.find((candidate: any) => candidate.name === name)?.tags).toEqual(['project_management', 'ecommerce_operations']);
      const results = info.project.name === 'mobile' ? page.locator('.mobile-result-card') : page.locator('.el-table');
      await expect(results.getByText(name, { exact: true }).first()).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    await page.close();
    execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { stdio: 'pipe', input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
      db.talentCandidate.deleteMany({where:{name:${JSON.stringify(name)},createdById:${JSON.stringify(fixture.operator.id)}}})
        .finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);` });
    removeContractFixture(fixture);
  }
});
