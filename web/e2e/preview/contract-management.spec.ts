import { test as base, expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  assertContractPreview, createContractFixture, previewOrigin, readContractState, removeContractFixture, seedLegacyContractDates,
  type ContractFixture,
} from './contract-management-fixture';

const ExcelJS = createRequire(resolve(process.cwd(), '../api/package.json'))('exceljs');
const test = base.extend<{ contractFixture: ContractFixture }>({
  contractFixture: async ({ page }, use, info) => {
    assertContractPreview(info);
    const f = createContractFixture();
    const uploadReads: Promise<void>[] = [];
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== previewOrigin) {
        external.push(new URL(request.url()).origin);
      }
    });
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/v1/storage/upload' && response.ok()) {
        uploadReads.push(response.json().then(body => { f.uploads.push(body.data); }));
      }
    });
    try {
      await page.setViewportSize(info.project.name === 'mobile'
        ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await page.addInitScript(token => localStorage.setItem('token', token), f.token);
      await use(f);
      expect(errors, 'Browser runtime errors').toEqual([]);
      expect(external, 'Preview must not contact external services').toEqual([]);
    } finally {
      if (info.status !== info.expectedStatus && !page.isClosed()) {
        await page.screenshot({ path: info.outputPath('contract-failure.png'), fullPage: true }).catch(() => {});
      }
      // Stop autosave and late uploads before deleting only this run's fictional records.
      await page.close();
      try { for (const read of uploadReads) await read; }
      finally { removeContractFixture(f); }
    }
  },
});
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(180_000);

type ContractInput = {
  name: string; type: '首签' | '续签' | '转签'; company: string;
  signedAt: string; effectiveFrom: string; expiresAt: string;
  originalCompany?: string; newCompany?: string;
};

function businessDay(offset: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function firstContract(f: ContractFixture): ContractInput {
  return { name: `${f.prefix}_虚构补签劳动合同`, type: '首签', company: f.subjects[0].name,
    signedAt: businessDay(-2), effectiveFrom: businessDay(-365), expiresAt: businessDay(700) };
}

function archiveDrawer(page: Page) {
  return page.getByRole('dialog', { name: '员工档案', exact: true });
}

async function findEmployee(page: Page, f: ContractFixture) {
  await page.goto(`${previewOrigin}/users`);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(f.employee.employeeNo);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/users' && url.searchParams.get('keyword') === f.employee.employeeNo;
  });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  expect((await loaded).status()).toBe(200);
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  const view = page.getByRole('button', { name: '查看档案', exact: true });
  await expect(view).toHaveCount(1);
  await view.click();
  const drawer = archiveDrawer(page);
  await expect(drawer.getByRole('heading', { name: f.employee.name, exact: true })).toBeVisible();
  return drawer;
}

async function editContracts(drawer: Locator) {
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(drawer.locator('.archive-inline-editor')).toBeVisible();
  await drawer.getByRole('navigation', { name: '档案分区' }).getByRole('button', { name: '合同记录', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '新增合同', exact: true })).toBeVisible();
}

function contractField(card: Locator, field: string) {
  return card.locator(`[data-archive-field$=".${field}"]`);
}

async function selectOption(page: Page, field: Locator, name: string) {
  const combobox = field.getByRole('combobox');
  await field.locator('.el-select__wrapper').click();
  const listboxId = await combobox.getAttribute('aria-controls');
  expect(listboxId).toBeTruthy();
  const listbox = page.locator(`[id="${listboxId}"]`);
  if ((await field.getAttribute('data-archive-field'))?.endsWith('.contractType')) {
    await expect(listbox.getByRole('option')).toHaveText(['首签', '续签', '转签']);
  }
  await listbox.getByRole('option', { name, exact: true }).click();
  await expect(field.locator('.el-select')).toContainText(name);
}

async function fillDate(card: Locator, field: string, value: string) {
  const input = contractField(card, field).locator('input');
  await input.fill(value);
  await input.press('Enter');
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function addContract(page: Page, drawer: Locator, value: ContractInput) {
  const cards = drawer.locator('.contract-card');
  const count = await cards.count();
  await drawer.getByRole('button', { name: '新增合同', exact: true }).click();
  await expect(cards).toHaveCount(count + 1);
  const card = cards.nth(count);
  await selectOption(page, contractField(card, 'contractType'), value.type);
  await contractField(card, 'name').locator('input').fill(value.name);
  await selectOption(page, contractField(card, 'signingCompany'), value.company);
  for (const key of ['signedAt', 'effectiveFrom', 'expiresAt'] as const) await fillDate(card, key, value[key]);
  if (value.originalCompany) await selectOption(page, contractField(card, 'originalCompany'), value.originalCompany);
  if (value.newCompany) await selectOption(page, contractField(card, 'newCompany'), value.newCompany);
  return card;
}

function isSubmit(request: Request, f: ContractFixture) {
  return request.method() === 'PATCH'
    && new URL(request.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft`;
}

async function submitContracts(page: Page, drawer: Locator, f: ContractFixture, doubleClick = false) {
  const button = drawer.getByRole('button', { name: '提交', exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toBeInViewport();
  const submitted = page.waitForResponse(response => isSubmit(response.request(), f));
  await button.click({ clickCount: doubleClick ? 2 : 1 });
  const response = await submitted;
  const body = await response.json();
  await test.info().attach('contract-submit-response', {
    body: JSON.stringify({ status: response.status(), contracts: response.request().postDataJSON().contracts,
      code: body.code, message: body.message, fieldErrors: body.data?.fieldErrors }), contentType: 'application/json',
  });
  expect(response.status(), JSON.stringify({ message: body.message, fieldErrors: body.data?.fieldErrors })).toBe(200);
  const result = body.data;
  expect(result.reviewOutcome).toBe('not_required');
  await expect(drawer.locator('.archive-inline-editor')).not.toBeVisible();
  await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  return response;
}

async function contractDetails(drawer: Locator) {
  await drawer.getByRole('tab', { name: '合同材料', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '合同记录', exact: true })).toBeVisible();
}

function currentCard(drawer: Locator) {
  return drawer.locator('.contract-history-group').filter({
    has: drawer.page().getByRole('heading', { name: '当前合同', exact: true }),
  }).locator('.employee-archive__contract-card');
}

function detailValue(card: Locator, label: string) {
  return card.locator('.employee-archive__facts > div').filter({
    has: card.page().getByText(label, { exact: true }),
  }).locator('strong');
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const drawer = archiveDrawer(page);
  if (await drawer.isVisible()) {
    expect(await drawer.locator('.el-drawer__body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

function sheetRows(sheet: any): Array<Record<string, unknown>> {
  expect(sheet, 'Expected worksheet').toBeDefined();
  const headers = sheet.getRow(2).values.slice(1) as string[];
  return Array.from({ length: Math.max(0, sheet.rowCount - 2) }, (_, index) =>
    Object.fromEntries(headers.map((header, column) => [header, sheet.getRow(index + 3).getCell(column + 1).value])));
}

async function exportWorkbook(page: Page, info: TestInfo, history: boolean) {
  await page.mouse.move(10, 10);
  await expect(page.getByTestId('header-account-summary')).not.toBeVisible();
  await page.getByRole('button', { name: '导出花名册', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
  await expect(dialog.getByText('预计导出 1 条记录', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '选择当前合同模块', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '合同状态', exact: true })).toBeChecked();
  const historyField = dialog.getByRole('checkbox', { name: '历史合同明细', exact: true });
  await expect(historyField).not.toBeChecked();
  if (history) {
    await dialog.getByText('历史合同明细', { exact: true }).click();
    await expect(historyField).toBeChecked();
  }
  const button = dialog.getByRole('button', { name: '导出 Excel', exact: true });
  await expect(button).toBeInViewport();
  await snapshot(page, info, history ? 'export-history-selected' : 'export-current-default');
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^花名册-\d{8}\.xlsx$/);
  expect(await download.failure()).toBeNull();
  const path = info.outputPath(history ? 'fictional-contract-history.xlsx' : 'fictional-current-contract.xlsx');
  await download.saveAs(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  await expect(dialog).not.toBeVisible();
  return workbook;
}

function fictionalPdf(prefix: string) {
  const stream = `BT /F1 12 Tf 20 70 Td (${prefix} FICTIONAL CONTRACT ONLY) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('real first signing and transfer use effective date, collapsed history and opt-in historical Excel', async ({ page, contractFixture: f }, info) => {
  const first = firstContract(f);
  const transfer: ContractInput = { name: `${f.prefix}_虚构转签劳动合同`, type: '转签', company: f.subjects[1].name,
    signedAt: businessDay(-30), effectiveFrom: businessDay(60), expiresAt: businessDay(790),
    originalCompany: f.subjects[0].name, newCompany: f.subjects[1].name };
  expect(first.signedAt > transfer.signedAt && first.effectiveFrom < transfer.effectiveFrom).toBe(true);
  let drawer = await findEmployee(page, f);
  await editContracts(drawer);
  await addContract(page, drawer, first);
  await submitContracts(page, drawer, f);
  await contractDetails(drawer);
  await expect(detailValue(currentCard(drawer), '类型')).toHaveText('首签');
  await expect(currentCard(drawer).locator('.el-tag')).toHaveText('正常');
  await editContracts(drawer);
  await addContract(page, drawer, transfer);
  await submitContracts(page, drawer, f);

  // Re-select the employee through the actual list, proving persistence beyond editor state.
  drawer = await findEmployee(page, f);
  await contractDetails(drawer);
  const current = currentCard(drawer);
  await expect(current).toHaveCount(1);
  await expect(detailValue(current, '合同名称')).toHaveText(transfer.name);
  await expect(detailValue(current, '类型')).toHaveText('转签');
  await expect(detailValue(current, '原公司')).toHaveText(f.subjects[0].name);
  await expect(detailValue(current, '新公司')).toHaveText(f.subjects[1].name);
  await expect(current.locator('.el-tag')).toHaveText('待生效');
  await expect(drawer.locator('.contract-history-group')).toHaveCount(2);
  await expect(drawer.getByRole('heading', { name: /待生效合同|未来合同/ })).toHaveCount(0);
  const toggle = drawer.getByRole('button', { name: /^历史合同/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer.locator('.employee-archive__contract-card')).toHaveCount(1);
  await snapshot(page, info, 'current-transfer-history-collapsed');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const history = drawer.locator('.contract-history-group').filter({
    has: page.getByRole('button', { name: /^历史合同/ }),
  }).locator('.employee-archive__contract-card');
  await expect(history).toHaveCount(1);
  await expect(detailValue(history, '合同名称')).toHaveText(first.name);
  await expect(detailValue(history, '类型')).toHaveText('首签');
  await expect(detailValue(history, '签订日期')).toHaveText(first.signedAt);
  await expect(detailValue(history, '到期日期')).toHaveText(first.expiresAt);
  await history.scrollIntoViewIfNeeded();
  await snapshot(page, info, 'history-retains-original-dates');
  await toggle.click();
  await expect(drawer.locator('.employee-archive__contract-card')).toHaveCount(1);
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(2);
  expect(state.contracts.every(contract => contract.isActive)).toBe(true);
  expect(state.appliedRequests).toBe(2);

  await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).not.toBeVisible();
  const defaults = await exportWorkbook(page, info, false);
  expect(defaults.worksheets.map((sheet: any) => sheet.name)).toEqual(['花名册']);
  const rows = sheetRows(defaults.getWorksheet('花名册'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ '姓名': f.employee.name, '工号': f.employee.employeeNo,
    '合同类型': '转签', '合同名称': transfer.name, '合同状态': '待生效',
    '签订日期': new Date(`${transfer.signedAt}T00:00:00Z`),
    '生效日期': new Date(`${transfer.effectiveFrom}T00:00:00Z`),
    '到期日期': new Date(`${transfer.expiresAt}T00:00:00Z`) });
  expect(defaults.getWorksheet('历史合同')).toBeUndefined();
  const withHistory = await exportWorkbook(page, info, true);
  expect(sheetRows(withHistory.getWorksheet('花名册'))).toEqual(rows);
  const historicalRows = sheetRows(withHistory.getWorksheet('历史合同'));
  expect(historicalRows).toHaveLength(1);
  expect(historicalRows[0]).toMatchObject({ '工号': f.employee.employeeNo, '合同类型': '首签', '合同名称': first.name,
    '签订日期': new Date(`${first.signedAt}T00:00:00Z`), '生效日期': new Date(`${first.effectiveFrom}T00:00:00Z`),
    '到期日期': new Date(`${first.expiresAt}T00:00:00Z`) });
});

test('new inverted dates need correction while unchanged legacy date errors do not block saving', async ({ page, contractFixture: f }, info) => {
  seedLegacyContractDates(f);
  const legacy = readContractState(f);
  expect(legacy.contracts).toHaveLength(1);
  expect(legacy.appliedRequests).toBe(0);
  let drawer = await findEmployee(page, f);
  await editContracts(drawer);
  await expect(drawer.locator('.contract-card .el-form-item__error')).toHaveCount(0);
  const input = { ...firstContract(f), effectiveFrom: businessDay(-30), expiresAt: businessDay(-31) };
  const correctedExpiry = businessDay(-1);
  const card = await addContract(page, drawer, input);
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  await expect(contractField(card, 'expiresAt').locator('.el-form-item__error')).toContainText(/到期.*不能早于.*生效/);
  await expect(contractField(card, 'name').locator('input')).toHaveValue(input.name);
  await expect(contractField(card, 'expiresAt').locator('input')).toHaveValue(input.expiresAt);
  expect(readContractState(f)).toEqual(legacy);
  await snapshot(page, info, 'invalid-contract-dates');
  await fillDate(card, 'expiresAt', correctedExpiry);
  for (const invalid of ['2026-02-31', '2026-02-29']) {
    const field = contractField(card, 'signedAt');
    await field.locator('input').fill(invalid);
    await field.locator('input').press('Tab');
    const observed = { typed: invalid, displayed: await field.locator('input').inputValue(),
      errors: await field.locator('.el-form-item__error').allTextContents() };
    await info.attach(`invalid-calendar-${invalid}`, { body: JSON.stringify(observed), contentType: 'application/json' });
    expect.soft(observed.displayed, 'An impossible date must not silently become another calendar day').toBe(invalid);
    await expect.soft(field.locator('.el-form-item__error')).toContainText(/有效日期|日期无效|不存在/);
    expect(readContractState(f)).toEqual(legacy);
    await fillDate(card, 'signedAt', input.signedAt);
  }
  await submitContracts(page, drawer, f);
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(2);
  expect(state.contracts.find(contract => contract.id === legacy.contracts[0]!.id)).toEqual(legacy.contracts[0]);
  expect(state.contracts.find(contract => contract.name === input.name)).toMatchObject({ effectiveFrom: `${input.effectiveFrom}T00:00:00.000Z`,
    expiresAt: `${correctedExpiry}T00:00:00.000Z` });
  expect(state.appliedRequests).toBe(1);
  drawer = await findEmployee(page, f);
  await contractDetails(drawer);
  await expect(currentCard(drawer).locator('.el-tag')).toHaveText('已到期');
  await expect(drawer.getByRole('button', { name: /^历史合同/ })).toHaveAttribute('aria-expanded', 'false');
  await snapshot(page, info, 'corrected-expired-contract');
});

test('double submit creates one contract and a second identical contract is rejected without changing the original', async ({ page, contractFixture: f }, info) => {
  const input = firstContract(f);
  let drawer = await findEmployee(page, f);
  await editContracts(drawer);
  await addContract(page, drawer, input);
  const submitted: Request[] = [];
  page.on('request', request => { if (isSubmit(request, f)) submitted.push(request); });
  await submitContracts(page, drawer, f, true);
  drawer = await findEmployee(page, f);
  const original = readContractState(f);
  expect(original.contracts).toHaveLength(1);
  expect(original.appliedRequests).toBe(1);
  expect(submitted).toHaveLength(1);
  await editContracts(drawer);
  const duplicate = await addContract(page, drawer, input);
  const rejected = page.waitForResponse(response => isSubmit(response.request(), f));
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  const response = await rejected;
  expect(response.status()).toBe(400);
  expect((await response.json()).data.fieldErrors['contracts.1.name']).toMatch(/重复/);
  await expect(contractField(duplicate, 'name').locator('.el-form-item__error')).toContainText(/重复|相同/);
  await expect(duplicate).toBeVisible();
  await expect(contractField(duplicate, 'name').locator('input')).toHaveValue(input.name);
  expect(readContractState(f)).toEqual(original);
  await snapshot(page, info, 'duplicate-contract-rejected');
});

test('failed uploads block submission; a recovered real PDF survives reload and opens with the original bytes', async ({ page, contractFixture: f }, info) => {
  let drawer = await findEmployee(page, f);
  await editContracts(drawer);
  const card = await addContract(page, drawer, firstContract(f));
  const filename = `${f.prefix}_fictional.pdf`;
  const buffer = fictionalPdf(f.prefix);
  const fileInput = card.locator('input[type="file"][accept=".pdf,.doc,.docx,.xls,.xlsx"]');
  const failedName = `${f.prefix}_broken.pdf`;
  const invalidUpload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/upload');
  await fileInput.setInputFiles({ name: failedName, mimeType: 'application/pdf', buffer: Buffer.from('FICTIONAL INVALID PDF') });
  expect((await invalidUpload).status()).toBe(400);
  const failedTask = card.locator('.contract-upload-task').filter({ hasText: failedName });
  await expect(failedTask).toContainText('上传失败');
  await expect(drawer.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
  expect(readContractState(f)).toEqual({ contracts: [], appliedRequests: 0 });
  await failedTask.scrollIntoViewIfNeeded();
  await snapshot(page, info, 'failed-upload-blocks-submit');
  await failedTask.getByRole('button', { name: '移除', exact: true }).click();
  await expect(failedTask).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/upload'
    && new URL(response.url()).searchParams.get('purpose') === 'employee-contract-attachment');
  await fileInput.setInputFiles({
    name: filename, mimeType: 'application/pdf', buffer,
  });
  const upload = await uploaded;
  expect(upload.status()).toBe(201);
  await expect(card.getByRole('button', { name: filename, exact: true })).toBeVisible();
  await submitContracts(page, drawer, f);
  drawer = await findEmployee(page, f);
  await contractDetails(drawer);
  const attachment = currentCard(drawer).getByRole('button', { name: filename, exact: true });
  await expect(attachment).toBeVisible();
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(1);
  expect(state.contracts[0]!.attachments).toHaveLength(1);
  expect(state.contracts[0]!.attachments[0]).toMatchObject({ name: filename, mimeType: 'application/pdf', size: buffer.length });
  await snapshot(page, info, 'uploaded-contract-pdf');
  const downloaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/download');
  await attachment.click();
  const response = await downloaded;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(await response.body()).toEqual(buffer);
});
