import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  assertContractPreview, createContractFixture, previewOrigin, removeContractFixture,
  type ContractFixture,
} from './contract-management-fixture';

const ExcelJS = createRequire(resolve(process.cwd(), '../api/package.json'))('exceljs');

// Real isolated HR/API integration. No routes are mocked and production is refused by the fixture guard.
const test = base.extend<{ personnelFixture: ContractFixture }>({
  personnelFixture: async ({ page }, use, info) => {
    assertContractPreview(info);
    const fixture = createContractFixture();
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== previewOrigin) {
        external.push(new URL(request.url()).origin);
      }
    });
    try {
      await page.addInitScript(token => localStorage.setItem('token', token), fixture.token);
      await use(fixture);
      expect(errors, 'Browser runtime errors').toEqual([]);
      expect(external, 'Preview must not contact external services').toEqual([]);
    } finally {
      // Stop autosaves before deleting this run's ownership-checked fictional HR and employee.
      await page.close();
      removeContractFixture(fixture);
    }
  },
});

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(120_000);

function archiveDrawer(page: Page) {
  return page.getByRole('dialog', { name: '员工档案', exact: true });
}

async function findEmployee(page: Page, fixture: ContractFixture) {
  await page.goto(`${previewOrigin}/users`);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(fixture.employee.employeeNo);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/users' && url.searchParams.get('keyword') === fixture.employee.employeeNo;
  });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  expect((await loaded).status()).toBe(200);
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  const view = page.getByRole('button', { name: '查看档案', exact: true });
  await expect(view).toHaveCount(1);
  await view.click();
  const drawer = archiveDrawer(page);
  await expect(drawer.getByRole('heading', { name: fixture.employee.name, exact: true })).toBeVisible();
  return drawer;
}

async function readArchive(page: Page, fixture: ContractFixture) {
  const response = await page.request.get(`${previewOrigin}/api/v1/employee-archives/${fixture.employee.id}`, {
    headers: { authorization: `Bearer ${fixture.token}` }, maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function editArchive(drawer: Locator) {
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(drawer.locator('.archive-inline-editor')).toBeVisible();
  return drawer.locator('[data-archive-field="employee.employmentType"]');
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const drawer = archiveDrawer(page);
  if (await drawer.isVisible()) {
    expect(await drawer.locator('.el-drawer__body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test('internship survives draft resume, direct archive submission, details and Excel without changing employment status', async ({ page, personnelFixture: fixture }, info) => {
  let drawer = await findEmployee(page, fixture);
  let typeField = await editArchive(drawer);
  await typeField.locator('.el-select__wrapper').click();
  const listboxId = await typeField.getByRole('combobox').getAttribute('aria-controls');
  expect(listboxId).toBeTruthy();
  const options = page.locator(`[id="${listboxId}"]`);
  await expect(options.getByRole('option')).toHaveText(['全职', '兼职', '实习', '返聘', '外部']);

  const saved = page.waitForResponse(response => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === `/api/v1/employee-archives/${fixture.employee.id}/draft/save`);
  await options.getByRole('option', { name: '实习', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const savedDraft = (await savedResponse.json()).data;
  expect(savedDraft.recordStatus).toBe('draft');
  expect(savedDraft.proposedValue.employee).toMatchObject({ employmentType: 'internship', employeeStatus: 'active' });
  await expect(typeField.locator('.el-select')).toContainText('实习');
  await expect(drawer.getByRole('button', { name: '提交', exact: true })).toBeEnabled();

  // Saving a draft must not make it effective before the operator submits it.
  const beforeSubmit = await readArchive(page, fixture);
  expect(beforeSubmit.status).toBe('active');
  expect(beforeSubmit.currentEmployment.employmentType).toBe('full_time');
  expect(beforeSubmit.changeHistory.find((row: { id: string }) => row.id === savedDraft.id)
    .proposedValue.employee.employmentType).toBe('internship');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).not.toBeVisible();

  drawer = await findEmployee(page, fixture);
  typeField = await editArchive(drawer);
  await expect(typeField.locator('.el-select')).toContainText('实习');
  await typeField.scrollIntoViewIfNeeded();
  await snapshot(page, info, 'internship-draft-resumed');

  const submitted = page.waitForResponse(response => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === `/api/v1/employee-archives/${fixture.employee.id}/draft`);
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  const submittedResponse = await submitted;
  expect(submittedResponse.status()).toBe(200);
  expect((await submittedResponse.json()).data.reviewOutcome).toBe('not_required');
  await expect(drawer.locator('.archive-inline-editor')).not.toBeVisible();
  const applied = await readArchive(page, fixture);
  expect(applied.status).toBe('active');
  expect(applied.currentEmployment).toMatchObject({ employmentType: 'internship', employeeStatus: 'active' });

  await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).not.toBeVisible();
  drawer = await findEmployee(page, fixture);
  const displayedType = drawer.locator('.employee-archive__facts > div')
    .filter({ has: page.getByText('用工类型', { exact: true }) }).locator('strong');
  await expect(displayedType).toHaveText('实习');
  await displayedType.scrollIntoViewIfNeeded();
  await snapshot(page, info, 'internship-effective-details');
  await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).not.toBeVisible();

  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: '导出花名册', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
  await expect(dialog.getByText('预计导出 1 条记录', { exact: true })).toBeVisible();
  await expect(dialog.getByText('用工类型', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '清空', exact: true }).click();
  for (const label of ['工号', '姓名', '任职状态', '用工类型']) {
    await dialog.getByText(label, { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  }
  await snapshot(page, info, 'internship-export-fields');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  const workbookPath = info.outputPath('fictional-internship-roster.xlsx');
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet('花名册');
  expect(sheet.rowCount).toBe(3);
  const headers = sheet.getRow(2).values.slice(1) as string[];
  const row = Object.fromEntries(headers.map((header, index) => [header, sheet.getRow(3).getCell(index + 1).value]));
  expect(row).toMatchObject({ 工号: fixture.employee.employeeNo, 姓名: fixture.employee.name, 任职状态: '在职', 用工类型: '实习' });
});
