import { test, expect, type Page } from '@playwright/test';

const original = {
  id: '11111111-1111-4111-8111-111111111111', editVersion: 'v1', name: '虚构薪资核对人才', phone: '17000000000',
  status: 'new', sourceChannel: 'other', gender: 'unknown', tags: [], files: [], followUps: [], shares: [],
  updatedAt: '2026-11-20T00:00:00Z', createdAt: '2026-11-20T00:00:00Z', appliedPosition: null,
  expectSalaryMin: 10, expectSalaryMax: 15, nextFollowUpAt: null, fileCount: 0,
};
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
async function install(page: Page, changes = {}) {
  const candidate = { ...original, ...changes };
  const writes: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => localStorage.setItem('token', 'fictional-salary-ui'));
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr', name: '虚构HR', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/check-phone')) return route.fulfill(envelope({ exists: false }));
    if (path.endsWith('/talents') && request.method() === 'GET') return route.fulfill(envelope({ items: [candidate], total: 1 }));
    if (path.endsWith('/talents') && request.method() === 'POST') {
      writes.push(request.postDataJSON()); return route.fulfill({ ...envelope(candidate), status: 201 });
    }
    if (path.endsWith('/talents/' + candidate.id)) {
      if (request.method() === 'PATCH') writes.push(request.postDataJSON());
      return route.fulfill(envelope(candidate));
    }
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [], total: 0 }));
    if (path.endsWith('/talent-resume/status')) return route.fulfill(envelope({ enabled: false, configured: false }));
    if (path.endsWith('/tasks/current')) return route.fulfill(envelope(null));
    return route.fulfill(envelope([]));
  });
  return writes;
}
async function createForm(page: Page) {
  await page.goto('/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const form = page.locator('.talent-form-drawer');
  await form.getByPlaceholder('候选人姓名', { exact: true }).fill('虚构精确金额');
  await form.getByPlaceholder('11 位手机号', { exact: true }).fill('17000000001');
  await form.getByTestId('talent-form-source').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  return form;
}
for (const width of [1440, 390]) {
  test(`${width}px exact yuan values survive input and submit without legacy K fields`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = await install(page);
    const form = await createForm(page);
    await form.getByPlaceholder('最低', { exact: true }).fill('5501');
    await form.getByPlaceholder('最高', { exact: true }).fill('6809');
    await form.getByPlaceholder('最高', { exact: true }).press('Tab');
    await expect(form.getByPlaceholder('最低', { exact: true })).toHaveValue('5501');
    await expect(form.getByPlaceholder('最高', { exact: true })).toHaveValue('6809');
    await expect(form).toContainText('期望薪资（元/月）');
    await form.getByRole('button', { name: '加入人才库', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809 });
    expect(writes[0]).not.toHaveProperty('expectSalaryMin');
    expect(writes[0]).not.toHaveProperty('expectSalaryMax');
  });
}
test('historical suspicious 999 remains pending review on an unrelated edit', async ({ page }) => {
  const writes = await install(page, { expectSalaryMin: 999, expectSalaryMax: 999, salaryNeedsReview: true, expectSalaryMinYuan: null, expectSalaryMaxYuan: null });
  await page.goto('/talents');
  await page.getByRole('button', { name: '编辑', exact: true }).filter({ visible: true }).first().click();
  const form = page.locator('.talent-form-drawer');
  await expect(form).toContainText('历史薪资待核对');
  await expect(form.getByPlaceholder('最低', { exact: true })).toHaveValue('');
  await form.getByPlaceholder('候选人姓名', { exact: true }).fill('虚构只改姓名');
  await form.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  for (const field of ['expectSalaryMin', 'expectSalaryMax', 'expectSalaryMinYuan', 'expectSalaryMaxYuan']) expect(writes[0]).not.toHaveProperty(field);
});
test('negative or fractional yuan is refused without silently rounding and a valid range can be corrected', async ({ page }) => {
  const writes = await install(page);
  const form = await createForm(page);
  await form.getByPlaceholder('最低', { exact: true }).fill('5500.5');
  await form.getByPlaceholder('最高', { exact: true }).fill('6800');
  await form.getByRole('button', { name: '加入人才库', exact: true }).click();
  await expect(form.getByText('薪资请填写非负整数元/月', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await expect(form.getByPlaceholder('最低', { exact: true })).toHaveValue('5500.5');
  await form.getByPlaceholder('最低', { exact: true }).fill('5501');
  await form.getByRole('button', { name: '加入人才库', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
});
