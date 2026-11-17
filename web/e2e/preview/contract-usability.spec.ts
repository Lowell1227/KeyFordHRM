import { test as base, expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  assertContractPreview, createContractFixture, previewOrigin, readContractState, removeContractFixture,
  type ContractFixture,
} from './contract-management-fixture';

// Real HR/API/storage integration. The guard refuses production and ordinary E2E setup.
const test = base.extend<{ contractFixture: ContractFixture }>({
  contractFixture: async ({ page }, use, info) => {
    assertContractPreview(info);
    const f = createContractFixture();
    const uploadReads: Promise<void>[] = [];
    const external: string[] = [];
    const errors: string[] = [];
    const draftRequests = new Map<Request, { started: number; path: string; status?: number; elapsedMs?: number }>();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'PATCH' && path.includes(`/employee-archives/${f.employee.id}/draft`)) {
        draftRequests.set(request, { started: Date.now(), path: path.split('/').slice(-2).join('/') });
      }
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== previewOrigin) {
        external.push(new URL(request.url()).origin);
      }
    });
    page.on('response', response => {
      const draft = draftRequests.get(response.request());
      if (draft) Object.assign(draft, { status: response.status(), elapsedMs: Date.now() - draft.started });
      if (new URL(response.url()).pathname === '/api/v1/storage/upload' && response.ok()) {
        uploadReads.push(response.json().then(body => { f.uploads.push(body.data); }));
      }
    });
    try {
      await page.addInitScript(token => localStorage.setItem('token', token), f.token);
      await use(f);
      expect(errors, 'Browser runtime errors').toEqual([]);
      expect(external, 'Preview must not contact external services').toEqual([]);
    } finally {
      const timingsPath = info.outputPath('draft-request-timings.json');
      writeFileSync(timingsPath, JSON.stringify([...draftRequests.values()]));
      await info.attach('draft-request-timings', { path: timingsPath, contentType: 'application/json' });
      if (info.status !== info.expectedStatus && !page.isClosed()) {
        await page.screenshot({ path: info.outputPath('fictional-failure.png'), fullPage: true }).catch(() => {});
      }
      // Stop autosaves before deleting only this run's guarded fictional records/files.
      await page.close();
      try { await Promise.all(uploadReads); }
      finally { removeContractFixture(f); }
    }
  },
});
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(180_000);

function businessDay(offset: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function fixtureQuery<T>(f: ContractFixture, source: string): T {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 30_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
        const employee = await prisma.user.findFirstOrThrow({ where: ${JSON.stringify({ id: f.employee.id, employeeNo: f.employee.employeeNo })} });
        if (!employee.employeeNo.startsWith(${JSON.stringify(f.prefix + '_')})) throw new Error('Fixture mismatch');
        ${source}
      })().finally(() => prisma.$disconnect()).catch(() => {
        console.error('Isolated contract usability fixture operation failed'); process.exitCode = 1;
      });`,
  })) as T;
}

type SeedContract = {
  suffix: string; contractType?: string; isActive?: boolean; termType?: string;
  effectiveFrom?: string | null; expiresAt?: string | null;
};

function seedContracts(f: ContractFixture, records: SeedContract[]) {
  return fixtureQuery<Array<{ id: string; name: string }>>(f, `
    if (await prisma.employeeContract.count({ where: { userId: employee.id } })) throw new Error('Expected fresh fixture');
    const inputs = ${JSON.stringify(records)};
    const contracts = [];
    for (const [sequence, row] of inputs.entries()) {
      contracts.push(await prisma.employeeContract.create({ data: {
        userId: employee.id, name: ${JSON.stringify(f.prefix + '_')} + row.suffix,
        contractType: row.contractType || 'contract', sequence,
        signingCompany: ${JSON.stringify(f.subjects[0].name)}, contractSubjectId: ${JSON.stringify(f.subjects[0].id)},
        effectiveFrom: row.effectiveFrom ? new Date(row.effectiveFrom + 'T00:00:00Z') : null,
        expiresAt: row.expiresAt ? new Date(row.expiresAt + 'T00:00:00Z') : null,
        termType: row.termType || '固定期限', isActive: row.isActive !== false,
        endedAt: row.isActive === false ? new Date() : null, createdById: ${JSON.stringify(f.operator.id)},
      }, select: { id: true, name: true } }));
    }
    console.log(JSON.stringify(contracts));
  `);
}

function drawerFor(page: Page) { return page.getByRole('dialog', { name: '员工档案', exact: true }); }
function shownEditor(drawer: Locator) { return drawer.locator('.contract-card:visible'); }
function field(card: Locator, key: string) { return card.locator(`[data-archive-field$=".${key}"]`); }
function detailCard(drawer: Locator, id: string) { return drawer.locator(`.employee-archive__contract-card[data-contract-id="${id}"]`); }
function group(drawer: Locator, name: string) { return drawer.locator(`[data-contract-group="${name}"]`); }

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
  const drawer = drawerFor(page);
  await expect(drawer.getByRole('heading', { name: f.employee.name, exact: true })).toBeVisible();
  await showContracts(drawer);
  return drawer;
}

async function showContracts(drawer: Locator) {
  await drawer.getByRole('tab', { name: '合同材料', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '合同记录', exact: true })).toBeVisible();
}

async function selectOption(page: Page, target: Locator, name: string, custom = false) {
  const combobox = target.getByRole('combobox');
  await target.locator('.el-select__wrapper').click();
  if (custom) await combobox.fill(name);
  const listboxId = await combobox.getAttribute('aria-controls');
  expect(listboxId).toBeTruthy();
  await page.locator(`[id="${listboxId}"]`).getByRole('option', { name, exact: true }).click();
  await expect(target.locator('.el-select')).toContainText(name);
}

async function fillDate(card: Locator, key: string, value: string) {
  const input = field(card, key).locator('input');
  await input.fill(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function fillContract(page: Page, drawer: Locator, values: { name: string; start: number; end: number }) {
  const card = shownEditor(drawer);
  await expect(card).toHaveCount(1);
  await selectOption(page, field(card, 'name'), values.name, true);
  await selectOption(page, field(card, 'termType'), '固定期限');
  await fillDate(card, 'signedAt', businessDay(-1));
  await fillDate(card, 'effectiveFrom', businessDay(values.start));
  await fillDate(card, 'expiresAt', businessDay(values.end));
  return card;
}

function isSubmit(request: Request, f: ContractFixture) {
  return request.method() === 'PATCH'
    && new URL(request.url()).pathname === `/api/v1/employee-archives/${f.employee.id}/draft`;
}

async function saveContract(page: Page, drawer: Locator, f: ContractFixture) {
  const button = drawer.getByRole('button', { name: '保存并生效', exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toBeInViewport();
  const submitted = page.waitForResponse(response => isSubmit(response.request(), f));
  await button.click();
  const response = await submitted;
  const body = await response.json();
  expect(response.status(), JSON.stringify({ message: body.message, fieldErrors: body.data?.fieldErrors })).toBe(200);
  expect(body.data.reviewOutcome).toBe('not_required');
  await expect(drawer.locator('.archive-inline-editor')).not.toBeVisible();
  await showContracts(drawer);
}

async function archive(page: Page, f: ContractFixture): Promise<Record<string, any>> {
  const response = await page.request.get(`${previewOrigin}/api/v1/employee-archives/${f.employee.id}`, {
    headers: { Authorization: `Bearer ${f.token}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

function employmentAndProfile(record: Record<string, any>) {
  const normalize = (value: unknown): unknown => {
    if (value === undefined || value === '') return null;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['createdAt', 'updatedAt'].includes(key)).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return Object.fromEntries(['name', 'employeeNo', 'phone', 'status', 'position', 'positionId', 'entryDate', 'dept',
    'performanceManager', 'rosterManager', 'currentEmployment', 'pendingEmployment', 'employmentHistory',
    'employeeNumberAssignments'].map(key => [key, normalize(record[key])]).concat(
    ['education', 'maritalStatus', 'emergencyContactName', 'socialSecurityStatus', 'bankName'].map(key => [
      `profile.${key}`, normalize(record.employeeProfile?.[key]),
    ])));
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const body = drawerFor(page).locator('.el-drawer__body');
  const geometry = await body.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return { width: el.clientWidth, scrollWidth: el.scrollWidth,
      overflowing: Array.from(el.querySelectorAll('*')).filter(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.right > bounds.right + 1 || box.left < bounds.left - 1);
      }).slice(0, 20).map(node => ({ tag: node.tagName, class: node.className, field: node.getAttribute('data-archive-field'),
        left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })) };
  });
  expect(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled', scale: 'css' });
}

test('HR records, renews, transfers, corrects and removes one contract without changing employment', async ({ page, contractFixture: f }, info) => {
  const baseline = employmentAndProfile(await archive(page, f));
  const drawer = await findEmployee(page, f);
  await drawer.getByRole('button', { name: '录入合同', exact: true }).click();
  await expect(field(shownEditor(drawer), 'signingCompany')).toContainText(f.subjects[0].name);
  await fillContract(page, drawer, { name: `${f.prefix}_首签`, start: -100, end: 100 });
  await saveContract(page, drawer, f);
  const original = readContractState(f).contracts[0]!;
  await expect(group(drawer, '期限内合同')).toContainText(original.name);

  await detailCard(drawer, original.id).getByRole('button', { name: '续签', exact: true }).click();
  await expect(field(shownEditor(drawer), 'contractType')).toContainText('续签');
  await expect(field(shownEditor(drawer), 'name')).toContainText(original.name);
  await expect(field(shownEditor(drawer), 'signingCompany')).toContainText(f.subjects[0].name);
  await fillContract(page, drawer, { name: `${f.prefix}_未来续签`, start: 101, end: 465 });
  await saveContract(page, drawer, f);
  const renewal = readContractState(f).contracts.find(item => item.contractType === 'renewal')!;
  await expect(group(drawer, '待生效合同')).toContainText(renewal.name);
  await expect(group(drawer, '期限内合同')).toContainText(original.name);
  expect(readContractState(f).contracts.find(item => item.id === original.id)).toEqual(original);

  await detailCard(drawer, original.id).getByRole('button', { name: '转签', exact: true }).click();
  await expect(field(shownEditor(drawer), 'contractType')).toContainText('转签');
  await expect(field(shownEditor(drawer), 'originalCompany')).toContainText(f.subjects[0].name);
  await selectOption(page, field(shownEditor(drawer), 'signingCompany'), f.subjects[1].name);
  await fillContract(page, drawer, { name: `${f.prefix}_转签`, start: 0, end: 365 });
  await expect(shownEditor(drawer).getByText('与其他合同的期限有重叠，请核对；不影响保存。')).toBeVisible();
  await snapshot(page, info, 'single-transfer-edit');
  await saveContract(page, drawer, f);
  const transfer = readContractState(f).contracts.find(item => item.contractType === 'transfer')!;
  expect(transfer).toMatchObject({ signingCompany: f.subjects[1].name, newCompany: f.subjects[1].name, originalCompany: f.subjects[0].name });
  expect(readContractState(f).contracts.find(item => item.id === original.id)).toEqual(original);
  await expect(group(drawer, '期限内合同').locator('.employee-archive__contract-card')).toHaveCount(2);

  await detailCard(drawer, transfer.id).getByRole('button', { name: '修改信息', exact: true }).click();
  await fillDate(shownEditor(drawer), 'signedAt', businessDay(-2));
  await saveContract(page, drawer, f);
  expect(readContractState(f).contracts.find(item => item.id === transfer.id)?.signedAt).toBe(`${businessDay(-2)}T00:00:00.000Z`);
  expect(readContractState(f).contracts.find(item => item.id === renewal.id)).toEqual(renewal);

  await detailCard(drawer, transfer.id).getByRole('button', { name: '删除合同', exact: true }).click();
  await expect(shownEditor(drawer)).toContainText('待删除');
  expect(readContractState(f).contracts.find(item => item.id === transfer.id)?.isActive).toBe(true);
  await shownEditor(drawer).getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(field(shownEditor(drawer), 'name')).toBeVisible();
  await shownEditor(drawer).getByRole('button', { name: '删除合同', exact: true }).click();
  await saveContract(page, drawer, f);
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(3);
  expect(state.contracts.find(item => item.id === transfer.id)?.isActive).toBe(false);
  expect(state.contracts.find(item => item.id === original.id)).toEqual(original);
  expect(state.contracts.find(item => item.id === renewal.id)).toEqual(renewal);
  const retained = group(drawer, '历史保留记录');
  await expect(retained.getByRole('button', { name: /历史保留记录/ })).toHaveAttribute('aria-expanded', 'false');
  await retained.getByRole('button', { name: /历史保留记录/ }).click();
  await expect(detailCard(drawer, transfer.id)).toContainText('已删除');
  await expect(detailCard(drawer, transfer.id).getByRole('button', { name: '修改信息', exact: true })).toHaveCount(0);
  expect(employmentAndProfile(await archive(page, f))).toEqual(baseline);
  await snapshot(page, info, 'saved-contracts-and-removal-history');
});

test('HR resumes an automatically saved contract draft and corrects a field before immediate application', async ({ page, contractFixture: f }, info) => {
  const baseline = employmentAndProfile(await archive(page, f));
  let drawer = await findEmployee(page, f);
  await drawer.getByRole('button', { name: '补录合同', exact: true }).click();
  const name = `${f.prefix}_中断后继续补录`;
  await fillContract(page, drawer, { name, start: -365, end: -1 });
  await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
  const savedArchive = await archive(page, f);
  const savedDraft = savedArchive.changeHistory?.find((item: Record<string, any>) => item.recordStatus === 'draft');
  const draftScopesPath = info.outputPath('fictional-draft-scopes.json');
  writeFileSync(draftScopesPath, JSON.stringify({
    changedFields: savedDraft?.changedFields, proposed: {
      employee: savedDraft?.proposedValue?.employee, profile: savedDraft?.proposedValue?.profile,
      performance: savedDraft?.proposedValue?.performance,
    }, baseline: employmentAndProfile(savedArchive),
  }));
  await info.attach('fictional-draft-scopes', { path: draftScopesPath, contentType: 'application/json' });
  expect(readContractState(f).contracts).toHaveLength(0);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  drawer = await findEmployee(page, f);
  await drawer.getByRole('button', { name: '继续草稿', exact: true }).click();
  await expect(shownEditor(drawer)).toHaveCount(1);
  await expect(field(shownEditor(drawer), 'name')).toContainText(name);
  await expect(field(shownEditor(drawer), 'effectiveFrom').locator('input')).toHaveValue(businessDay(-365));
  await fillDate(shownEditor(drawer), 'expiresAt', businessDay(-366));
  await drawer.getByRole('button', { name: '保存并生效', exact: true }).click();
  await expect(field(shownEditor(drawer), 'expiresAt').locator('.el-form-item__error')).toContainText(/不能早于/);
  expect(readContractState(f).contracts).toHaveLength(0);
  await fillDate(shownEditor(drawer), 'expiresAt', businessDay(-1));
  await saveContract(page, drawer, f);
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(1);
  expect(state.appliedRequests).toBe(1);
  const history = group(drawer, '已到期合同');
  await expect(history.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await history.getByRole('button').click();
  await expect(history).toContainText(name);
  await expect(history.locator('.el-tag')).toHaveText('已到期');
  expect(employmentAndProfile(await archive(page, f))).toEqual(baseline);
  await snapshot(page, info, 'resumed-historical-contract');
});

function fictionalPdf(prefix: string) {
  const stream = `BT /F1 12 Tf 20 70 Td (${prefix} FICTIONAL CONTRACT ONLY) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('material-only maintenance preserves contract fields and validates real uploaded/downloaded PDF bytes', async ({ page, contractFixture: f }, info) => {
  const [seeded] = seedContracts(f, [{ suffix: '待补材料', effectiveFrom: businessDay(-30), expiresAt: businessDay(335) }]);
  const original = readContractState(f).contracts[0]!;
  const baseline = employmentAndProfile(await archive(page, f));
  let drawer = await findEmployee(page, f);
  await detailCard(drawer, seeded!.id).getByRole('button', { name: '补充材料', exact: true }).click();
  const card = shownEditor(drawer);
  await expect(card).toHaveCount(1);
  await expect(field(card, 'name')).toHaveCount(0);
  const fileInput = card.locator('input[type="file"][accept=".pdf,.doc,.docx,.xls,.xlsx"]');
  const failedName = `${f.prefix}_invalid.pdf`;
  const failedUpload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/upload');
  await fileInput.setInputFiles({ name: failedName, mimeType: 'application/pdf', buffer: Buffer.from('FICTIONAL INVALID PDF') });
  expect((await failedUpload).status()).toBe(400);
  const failedTask = card.locator('.contract-upload-task').filter({ hasText: failedName });
  await expect(failedTask).toContainText('上传失败');
  await expect(drawer.getByRole('button', { name: '保存并生效', exact: true })).toBeDisabled();
  expect(readContractState(f).contracts[0]).toEqual(original);
  await failedTask.getByRole('button', { name: '移除', exact: true }).click();

  const filename = `${f.prefix}_fictional.pdf`;
  const buffer = fictionalPdf(f.prefix);
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/upload'
    && new URL(response.url()).searchParams.get('purpose') === 'employee-contract-attachment');
  await fileInput.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer });
  expect((await uploaded).status()).toBe(201);
  await expect(card.getByRole('button', { name: filename, exact: true })).toBeVisible();
  await saveContract(page, drawer, f);
  const saved = readContractState(f).contracts[0]!;
  expect({ ...saved, attachments: [] }).toEqual(original);
  expect(saved.attachments).toHaveLength(1);
  expect(saved.attachments[0]).toMatchObject({ name: filename, mimeType: 'application/pdf', size: buffer.length });
  drawer = await findEmployee(page, f);
  await detailCard(drawer, seeded!.id).getByRole('button', { name: '查看详情', exact: true }).click();
  const attachment = detailCard(drawer, seeded!.id).getByRole('button', { name: filename, exact: true });
  await expect(attachment).toBeVisible();
  const downloaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/storage/download');
  await attachment.click();
  const response = await downloaded;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(await response.body()).toEqual(buffer);
  expect(employmentAndProfile(await archive(page, f))).toEqual(baseline);
  await snapshot(page, info, 'persisted-materials');
});

test('date groups keep current, future, uncertain, expired and retained records distinct at desktop and phone widths', async ({ page, contractFixture: f }, info) => {
  const seeded = seedContracts(f, [
    { suffix: '期限内', effectiveFrom: businessDay(-10), expiresAt: businessDay(10) },
    { suffix: '无固定期限', effectiveFrom: businessDay(-5), termType: '无固定期限' },
    { suffix: '未来续签', contractType: 'renewal', effectiveFrom: businessDay(11), expiresAt: businessDay(375) },
    { suffix: '缺少日期' },
    { suffix: '倒置日期', effectiveFrom: businessDay(-1), expiresAt: businessDay(-2) },
    { suffix: '过去到期', effectiveFrom: businessDay(-365), expiresAt: businessDay(-30) },
    { suffix: '旧版本保留', effectiveFrom: businessDay(-365), expiresAt: businessDay(-30), isActive: false },
  ]);
  const original = readContractState(f);
  const drawer = await findEmployee(page, f);
  await expect(group(drawer, '期限内合同').locator('.employee-archive__contract-card')).toHaveCount(2);
  await expect(group(drawer, '待生效合同')).toContainText(seeded[2]!.name);
  await expect(group(drawer, '待核实合同').locator('.employee-archive__contract-card')).toHaveCount(2);
  await expect(detailCard(drawer, seeded[1]!.id)).toContainText('期限内');
  await expect(detailCard(drawer, seeded[1]!.id)).toContainText('无固定期限');
  await expect(detailCard(drawer, seeded[3]!.id).locator('.contract-advisory')).toContainText(/缺少|待补充|未填写/);
  await expect(detailCard(drawer, seeded[4]!.id).locator('.contract-advisory')).toContainText(/早于|晚于/);
  await expect(group(drawer, '已到期合同').getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(group(drawer, '历史保留记录').getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(detailCard(drawer, seeded[5]!.id)).toHaveCount(0);
  await expect(detailCard(drawer, seeded[6]!.id)).toHaveCount(0);
  await snapshot(page, info, 'date-groups-collapsed');
  await group(drawer, '已到期合同').getByRole('button').click();
  await group(drawer, '历史保留记录').getByRole('button').click();
  await expect(detailCard(drawer, seeded[5]!.id).locator('.el-tag')).toHaveText('已到期');
  await expect(detailCard(drawer, seeded[6]!.id).locator('.el-tag')).toHaveText('历史保留记录');
  await expect(detailCard(drawer, seeded[6]!.id)).not.toContainText('已终止');
  await expect(detailCard(drawer, seeded[6]!.id).getByRole('button', { name: '删除合同', exact: true })).toHaveCount(0);
  expect(readContractState(f)).toEqual(original);
  await snapshot(page, info, 'date-groups-expanded');
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 768 });
    await snapshot(page, info, 'date-groups-tablet');
  }
});

test('ordinary employees cannot read or edit private contracts and stale submissions preserve the newer HR change', async ({ page, contractFixture: f }) => {
  seedContracts(f, [{ suffix: '并发更正', effectiveFrom: businessDay(-30), expiresAt: businessDay(335) }]);
  const before = await archive(page, f);
  const employeeToken = fixtureQuery<string>(f, `
    const { JwtService } = require('@nestjs/jwt');
    console.log(JSON.stringify(new JwtService({ secret: process.env.JWT_SECRET }).sign({
      sub: employee.id, employeeNo: employee.employeeNo,
    }, { expiresIn: '5m' })));
  `);
  const url = `${previewOrigin}/api/v1/employee-archives/${f.employee.id}`;
  const deniedRead = await page.request.get(url, { headers: { Authorization: `Bearer ${employeeToken}` } });
  expect(deniedRead.status()).toBe(403);
  const contract = before.employeeContracts[0];
  const payload = { baseVersion: before.archiveVersion, employee: {}, profile: {}, performance: {}, contracts: [{
    ...contract, signedAt: businessDay(-1),
  }] };
  const deniedWrite = await page.request.patch(`${url}/draft`, {
    headers: { Authorization: `Bearer ${employeeToken}` }, data: payload,
  });
  expect(deniedWrite.status()).toBe(403);
  expect(readContractState(f).appliedRequests).toBe(0);
  const firstWrite = await page.request.patch(`${url}/draft`, {
    headers: { Authorization: `Bearer ${f.token}` }, data: payload,
  });
  expect(firstWrite.status()).toBe(200);
  expect((await firstWrite.json()).data.reviewOutcome).toBe('not_required');
  const accepted = readContractState(f);
  const staleWrite = await page.request.patch(`${url}/draft`, {
    headers: { Authorization: `Bearer ${f.token}` }, data: {
      ...payload, contracts: [{ ...payload.contracts[0], signedAt: businessDay(-2) }],
    },
  });
  expect(staleWrite.status()).toBe(409);
  expect(readContractState(f)).toEqual(accepted);
  expect(accepted.contracts[0]?.signedAt).toBe(`${businessDay(-1)}T00:00:00.000Z`);
  expect(employmentAndProfile(await archive(page, f))).toEqual(employmentAndProfile(before));
});

test('resuming a draft with other archive changes exposes the whole archive before saving', async ({ page, contractFixture: f }, info) => {
  seedContracts(f, [{ suffix: '原合同', effectiveFrom: businessDay(-365), expiresAt: businessDay(-30) }]);
  const original = readContractState(f).contracts[0]!;
  let drawer = await findEmployee(page, f);
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  const changedName = `${f.prefix}_虚构姓名更正`;
  await drawer.locator('[data-archive-field="employee.name"] input').fill(changedName);
  await drawer.getByRole('navigation', { name: '档案分区' }).getByRole('button', { name: '合同记录', exact: true }).click();
  await drawer.getByRole('button', { name: '录入合同', exact: true }).click();
  // Whole-archive mode keeps other rows collapsed; target the one expanded row.
  const expanded = drawer.locator('.contract-card').filter({ has: page.locator('.contract-fields') });
  await expect(expanded).toHaveCount(1);
  await selectOption(page, field(expanded, 'name'), `${f.prefix}_一并恢复合同`, true);
  await selectOption(page, field(expanded, 'termType'), '固定期限');
  await fillDate(expanded, 'effectiveFrom', businessDay(-10));
  await fillDate(expanded, 'expiresAt', businessDay(355));
  await expect(drawer.locator('.archive-footer-state')).toContainText('草稿已保存');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect((await archive(page, f)).name).toBe(f.employee.name);
  expect(readContractState(f).contracts).toEqual([original]);

  drawer = await findEmployee(page, f);
  await drawer.getByRole('button', { name: '继续草稿', exact: true }).click();
  await expect(drawer.getByRole('navigation', { name: '档案分区' })).toBeVisible();
  await expect(drawer.locator('.draft-scope-note')).toContainText('已恢复未完成的档案草稿');
  await expect(drawer.locator('[data-archive-field="employee.name"] input')).toHaveValue(changedName);
  await expect(drawer.getByRole('button', { name: '保存并生效', exact: true })).toHaveCount(0);
  const submitted = page.waitForResponse(response => isSubmit(response.request(), f));
  await drawer.getByRole('button', { name: '提交', exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(200);
  expect((await response.json()).data.reviewOutcome).toBe('not_required');
  await expect(drawer.locator('.archive-inline-editor')).not.toBeVisible();
  expect((await archive(page, f)).name).toBe(changedName);
  const state = readContractState(f);
  expect(state.contracts).toHaveLength(2);
  expect(state.contracts.find(item => item.id === original.id)).toEqual(original);
  expect(state.appliedRequests).toBe(1);
  await showContracts(drawer);
  await snapshot(page, info, 'restored-whole-archive-draft');
});
