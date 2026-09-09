import { expect, test, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ code: 0, message: 'success', data });
const saved = (page: Page) => page.getByTestId('saved-scope').textContent().then((value) => JSON.parse(value!));
const department = (page: Page, name: string) => page.getByTestId('cycle-scope-department-tree')
  .locator('.el-tree-node__content').filter({ hasText: name }).getByRole('checkbox');
async function open(page: Page) { await page.getByTestId('cycle-scope-picker-open').click(); }
async function apply(page: Page) { await page.getByRole('button', { name: '确定', exact: true }).click(); }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope({ items: [], total: 0, page: 1, pageSize: 50 }) }));
  await page.route('**/api/v1/cycles/participant-preview', async (route) => {
    const body = route.request().postDataJSON() as { scope: 'all' | 'custom'; departmentIds?: string[]; userIds?: string[] };
    const sizes: Record<string, number> = { parent: 4, child: 3, peer: 2 };
    const departmentIds = body.scope === 'all' ? Object.keys(sizes) : body.departmentIds ?? [];
    const total = departmentIds.reduce((sum, id) => sum + (sizes[id] ?? 0), 0) + (body.userIds?.length ?? 0);
    await route.fulfill({ json: envelope({ items: [], total, departmentCount: departmentIds.length, page: 1, pageSize: 1 }) });
  });
});

test('sole child selection excludes parent direct employees and survives editing', async ({ page }) => {
  await page.goto('/e2e/fixtures/cycle-participant-harness.html');
  await open(page);
  await department(page, '人事组').locator('..').click();
  await apply(page);
  expect((await saved(page)).departmentIds).toEqual(['child']);
  await expect(page.getByTestId('cycle-scope-summary')).toContainText('共 3 人');
  await open(page);
  await expect(department(page, '人事部')).not.toBeChecked();
  await expect(department(page, '人事组')).toBeChecked();
  await apply(page);
  expect((await saved(page)).departmentIds).toEqual(['child']);
});

test('parent selection includes subtree, but child deselection survives apply and reopen', async ({ page }) => {
  await page.goto('/e2e/fixtures/cycle-participant-harness.html');
  await open(page);
  await department(page, '人事部').locator('..').click();
  await expect(department(page, '人事组')).toBeChecked();
  await apply(page);
  expect((await saved(page)).departmentIds).toEqual(['parent', 'child']);
  await open(page);
  await department(page, '人事组').locator('..').click();
  await apply(page);
  expect((await saved(page)).departmentIds).toEqual(['parent']);
  await expect(page.getByTestId('cycle-scope-summary')).toContainText('共 4 人');
  await open(page);
  await expect(department(page, '人事部')).toBeChecked();
  await expect(department(page, '人事组')).not.toBeChecked();
});

test('applying a department selection preserves explicit employee and department exemptions', async ({ page }) => {
  const initial = { scope: 'custom', departmentIds: ['parent', 'child'], userIds: [], excludedDepartmentIds: ['child'], excludedUserIds: ['exempt-employee'] };
  await page.goto(`/e2e/fixtures/cycle-participant-harness.html?saved=${encodeURIComponent(JSON.stringify(initial))}`);
  await open(page);
  await apply(page);
  expect((await saved(page)).excludedDepartmentIds).toEqual(['child']);
  expect((await saved(page)).excludedUserIds).toEqual(['exempt-employee']);
});

test('participant search and saved labels use cycle candidates without employee archive access', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/v1/cycles/participant-candidates**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ json: envelope({ items: [{ id: 'employee-1', name: '测试人事甲', employeeNo: 'HRZ001', deptName: '人事组', deptId: 'child', position: '专员' }], total: 1, page: 1, pageSize: 50 }) });
  });
  await page.goto('/e2e/fixtures/cycle-participant-harness.html');
  await open(page);
  await page.getByRole('tab', { name: '按人员' }).click();
  await page.getByTestId('cycle-scope-user-select').getByRole('combobox').fill('测试人事甲');
  await page.getByRole('option', { name: /测试人事甲/ }).click();
  await apply(page);
  expect((await saved(page)).userIds).toEqual(['employee-1']);
  const state = await saved(page);
  await page.goto(`/e2e/fixtures/cycle-participant-harness.html?saved=${encodeURIComponent(JSON.stringify(state))}`);
  await open(page);
  await page.getByRole('tab', { name: '按人员' }).click();
  await expect(page.getByTestId('cycle-scope-user-select')).toContainText('测试人事甲');
  expect(calls.some((url) => new URL(url).searchParams.get('ids') === 'employee-1')).toBe(true);
});
