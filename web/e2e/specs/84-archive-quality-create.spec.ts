import { expect, test, type Page } from '@playwright/test';

const companies = [
  { id: 'subject-signing', name: '虚构签约主体', isActive: true },
  { id: 'subject-original', name: '虚构转签原公司', isActive: true },
  { id: 'subject-new', name: '虚构转签新公司（跨区域研发与运营服务合同主体长名称验收）', isActive: true },
  { id: 'subject-inactive', name: '虚构停用公司', isActive: false },
];

async function mockCreate(page: Page) {
  const drafts: Record<string, any>[] = [];
  const otherWrites: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'archive-create-mock');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    let data: unknown = [];
    if (path === '/auth/me') data = { id: 'create-admin', name: '虚构管理员', sysRole: 'system_admin', canViewAll: true };
    else if (path === '/notifications/unread-count') data = 0;
    else if (path === '/departments') data = [{ id: 'create-dept', name: '虚构部门', company: 'fuede', children: [] }];
    else if (path === '/positions') data = [];
    else if (path === '/users' || path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    else if (path === '/contract-subjects') data = companies;
    else if (path === '/employee-archives/drafts' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      drafts.push(payload);
      data = { id: 'create-draft', userId: null, sourceType: 'manual_employee_create', recordStatus: 'draft',
        requestVersion: drafts.length, proposedValue: payload, profileReviewStatus: 'draft', performanceReviewStatus: 'not_required' };
    }
    if (request.method() !== 'GET' && path !== '/employee-archives/drafts') otherWrites.push(path);
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  return { drafts, otherWrites, drawer: page.getByRole('dialog', { name: '新增员工', exact: true }) };
}

for (const width of [1440, 390]) {
  test(`${width}px 办理入职合同公司目录选择保存文本并保留签约主体关联`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { drafts, otherWrites, drawer } = await mockCreate(page);
    await drawer.getByLabel('姓名', { exact: true }).fill('虚构转签新员工');
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
    await drawer.getByRole('button', { name: '合同与附件', exact: true }).click();
    await drawer.getByRole('button', { name: '新增合同', exact: true }).click();
    const card = drawer.locator('.contract-card');
    await card.getByLabel('合同名称', { exact: true }).fill('虚构入职转签合同');
    await card.getByLabel('签订日期', { exact: true }).fill('2026-11-12');
    await card.getByLabel('签订日期', { exact: true }).press('Tab');
    await page.keyboard.press('Escape');

    for (const [label, name] of [
      ['签约公司', companies[0]!.name], ['原公司', companies[1]!.name], ['新公司', companies[2]!.name],
    ]) {
      const field = card.locator('.el-form-item').filter({ has: page.getByText(label!, { exact: true }) });
      const select = field.locator('.el-select');
      await select.getByRole('combobox').click();
      await expect(select.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
      const listboxId = await select.locator('input').getAttribute('aria-controls');
      const options = page.locator(`[id="${listboxId}"]`);
      await expect(options.getByRole('option', { name: companies[3]!.name, exact: true })).toHaveCount(0);
      await options.getByRole('option', { name: name!, exact: true }).click();
    }
    await expect(card.locator('.contract-card__head strong')).toHaveText('虚构入职转签合同 · 2026-11-12 签订');
    await expect.poll(() => drafts.at(-1)?.contracts?.[0]).toMatchObject({
      name: '虚构入职转签合同', signedAt: '2026-11-12',
      contractSubjectId: 'subject-signing', signingCompany: companies[0]!.name,
      originalCompany: companies[1]!.name, newCompany: companies[2]!.name,
    });
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await drawer.screenshot({ path: testInfo.outputPath(`create-contract-companies-${width}.png`), animations: 'disabled' });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(drawer).not.toBeVisible();
    const saved = drafts.at(-1)!.contracts[0];
    expect(saved).toMatchObject({ contractSubjectId: 'subject-signing', originalCompany: companies[1]!.name, newCompany: companies[2]!.name });
    expect(saved).not.toHaveProperty('originalCompanyId');
    expect(saved).not.toHaveProperty('newCompanyId');
    expect(otherWrites).toEqual([]);
  });
}
