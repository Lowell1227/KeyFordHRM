import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

type FixtureTask = { id: string; periodId: string; employeeNo: string; protected: boolean; alreadyEnded: boolean };
type CycleFixture = { prefix: string; cycleId: string; cycleName: string; tasks: FixtureTask[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

// Each project consumes its own fresh prepare-cycle-termination-preview.cjs result.
// The private JSON is { desktop: fixture, mobile: fixture }; never retain operator credentials.
function fixtureFor(project: string): CycleFixture {
  if (!['desktop', 'mobile'].includes(project)) throw new Error('Expected the desktop/mobile isolated-preview projects');
  const filename = process.env.HRM_CYCLE_FIXTURE_FILE;
  if (!filename || !isAbsolute(filename)) throw new Error('HRM_CYCLE_FIXTURE_FILE must name an absolute private fixture JSON');
  let source: unknown;
  try { source = JSON.parse(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Private cycle fixture JSON could not be read; source details withheld'); }
  if (!object(source) || !object(source.desktop) || !object(source.mobile)
    || source.desktop.cycleId === source.mobile.cycleId) {
    throw new Error('Private fixture JSON must provide distinct desktop/mobile cycles');
  }
  const row = source[project];
  if (!object(row) || row.fictional !== true || typeof row.prefix !== 'string' || !/^CT_[0-9a-f]{10}$/.test(row.prefix)
    || typeof row.cycleId !== 'string' || !uuid.test(row.cycleId) || typeof row.cycleName !== 'string'
    || !row.cycleName.startsWith(`${row.prefix} `) || !row.cycleName.includes('虚构')
    || !Array.isArray(row.tasks) || row.tasks.length !== 4) throw new Error('Invalid fictional cycle fixture metadata');
  const tasks = row.tasks.map((task: unknown): FixtureTask => {
    if (!object(task) || typeof task.id !== 'string' || !uuid.test(task.id)
      || typeof task.periodId !== 'string' || !uuid.test(task.periodId) || typeof task.employeeNo !== 'string'
      || !['EMP001', 'EMP002', 'EMP003', 'EMP004'].includes(task.employeeNo)
      || typeof task.protected !== 'boolean' || typeof task.alreadyEnded !== 'boolean'
      || (task.protected && task.alreadyEnded)) throw new Error('Invalid fictional cycle task metadata');
    return { id: task.id, periodId: task.periodId, employeeNo: task.employeeNo,
      protected: task.protected, alreadyEnded: task.alreadyEnded };
  });
  if (new Set(tasks.map(task => task.id)).size !== 4 || new Set(tasks.map(task => task.employeeNo)).size !== 4
    || tasks.filter(task => task.protected).length !== 1 || tasks.filter(task => task.alreadyEnded).length !== 1
    || tasks[0]?.employeeNo !== 'EMP001' || tasks[0].protected || tasks[0].alreadyEnded) {
    throw new Error('Expected four fictional tasks: two terminable, one protected, one already ended');
  }
  return { prefix: row.prefix, cycleId: row.cycleId, cycleName: row.cycleName, tasks };
}

function assertPreview(info: TestInfo) {
  if (!['http://localhost:5173', 'http://localhost:5174'].includes(info.project.use.baseURL ?? '')
    || info.config.globalSetup !== null || process.env.DEBUG || process.env.PWDEBUG) {
    throw new Error('Real cycle UI verification requires the local isolated-preview config without debug/global setup');
  }
}

function contextOptions(info: TestInfo) {
  const use = info.project.use;
  return { baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile, hasTouch: use.hasTouch, locale: use.locale, storageState: { cookies: [], origins: [] } };
}

async function quickLogin(page: Page, employeeNo: 'HR001' | 'EMP001' | 'ADMIN') {
  await page.goto('/login');
  await expect(page.getByTestId('preview-login')).toBeEnabled();
  await page.getByTestId('preview-account').locator('.el-select__wrapper').click();
  const choice = page.getByRole('option').filter({ hasText: `(${employeeNo})` });
  await expect(choice).toBeVisible();
  await choice.click();
  const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/test-login'
    && response.request().method() === 'POST');
  await page.getByTestId('preview-login').click();
  expect((await loggedIn).ok(), 'UI quick login must succeed').toBe(true);
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  const identity = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', { headers: { authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } });
    if (!response.ok) return { status: response.status, employeeNo: '', sysRole: '', hrCapabilities: [] as string[] };
    const { data } = await response.json();
    return { status: response.status, employeeNo: data.employeeNo as string, sysRole: data.sysRole as string,
      hrCapabilities: (data.hrCapabilities ?? []) as string[] };
  });
  expect(identity.status).toBe(200);
  expect(identity.employeeNo).toBe(employeeNo);
  return identity;
}

function observeWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      && path !== '/api/v1/auth/test-login') writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

test.use({ trace: 'off', video: 'off', screenshot: 'off', storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

test('真实周期终止：完整清单、取消后办理、历史只读、员工输入保留及管理员显式授权边界', async ({ page, browser }, info) => {
  assertPreview(info);
  const fixture = fixtureFor(info.project.name);
  const employeeTask = fixture.tasks[0]!;
  const reason = `${fixture.prefix} 隔离验收：终止虚构周期，保留已审批结果和历史输入`;
  const draftText = `${fixture.prefix} 未保存的月度自评描述，终止后仍应保留在当前页面`;
  const hrWrites = observeWrites(page);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const hr = await quickLogin(page, 'HR001');
  expect(hr.hrCapabilities).toContain('cycle_terminate');
  const query = new URLSearchParams({ cycleId: fixture.cycleId, keyword: fixture.prefix });
  await page.goto(`/cycles?${query}`);
  await expect(page.getByTestId('cycle-workspace')).toContainText(fixture.cycleName);
  await expect(page.getByTestId('cycle-workspace-terminate')).toBeEnabled();

  let approvedPreviewHash = '';
  const employeeContext = await browser.newContext(contextOptions(info));
  try {
    const employeePage = await employeeContext.newPage();
    employeePage.on('pageerror', error => pageErrors.push(error.message));
    const employeeWrites = observeWrites(employeePage);
    await quickLogin(employeePage, 'EMP001');
    await employeePage.goto(`/tasks/${employeeTask.id}?stage=self-eval&periodId=${employeeTask.periodId}`);
    const review = employeePage.getByTestId('monthly-review-workspace');
    const comment = review.getByPlaceholder('简要说明本月进展和结果', { exact: true });
    const saveDraft = review.getByRole('button', { name: '保存草稿', exact: true });
    await expect(comment).toBeEditable();
    await comment.fill(draftText);
    await expect(saveDraft).toBeEnabled();
    expect(employeeWrites, 'Typing must not save the employee draft').toEqual([]);

    const impactRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/cycles/${fixture.cycleId}/termination-preview`
      && response.request().method() === 'GET');
    await page.getByTestId('cycle-workspace-terminate').click();
    const impactResponse = await impactRead;
    expect(impactResponse.status()).toBe(200);
    const impact = (await impactResponse.json()).data;
    expect(impact.cycle.id).toBe(fixture.cycleId);
    expect(typeof impact.previewHash).toBe('string');
    approvedPreviewHash = impact.previewHash;
    expect(approvedPreviewHash).toMatch(/^[a-f0-9]{64}$/);
    const dialog = page.getByTestId('cycle-termination-dialog');
    const summary = page.getByTestId('cycle-termination-summary');
    await expect(dialog).toBeVisible();
    for (const [label, count] of [['任务总人数', '4'], ['将终止', '2'], ['保留结果及原流程', '1'], ['已经结束', '1']]) {
      await expect(summary.locator('div').filter({ has: page.getByText(label!, { exact: true }) }).locator('dd')).toHaveText(count!);
    }
    await expect(summary.getByText('将取消的目标变更', { exact: true })).toBeVisible();
    await expect(summary.getByText('将取消的待发提醒', { exact: true })).toBeVisible();
    const tasks = page.getByTestId('cycle-termination-tasks');
    await expect(tasks.locator('.el-table__body-wrapper tbody tr')).toHaveCount(4);
    for (const task of fixture.tasks) await expect(tasks.getByText(task.employeeNo, { exact: true })).toBeVisible();
    // Capture only fictional business surfaces, never login screens or private fixture JSON.
    await dialog.screenshot({ path: info.outputPath('impact-open.png') });

    await page.getByTestId('cycle-termination-submit').click();
    await expect(dialog.getByText('请填写终止原因', { exact: true })).toBeVisible();
    await page.getByTestId('cycle-termination-reason').fill(reason);
    await page.getByTestId('cycle-termination-submit').click();
    const confirmation = page.getByRole('dialog', { name: '再次确认终止周期', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByTestId('cycle-termination-reason')).toHaveValue(reason);
    expect(hrWrites, 'Cancelling confirmation must not terminate or write anything').toEqual([]);
    await expect(comment).toHaveValue(draftText);

    const terminated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/cycles/${fixture.cycleId}/terminate`
      && response.request().method() === 'POST');
    await page.getByTestId('cycle-termination-submit').click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '终止周期并保留记录', exact: true }).click();
    expect((await terminated).ok(), 'The UI termination request must succeed').toBe(true);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cycle-termination-record')).toContainText(reason);
    expect(hrWrites).toEqual([`POST /api/v1/cycles/${fixture.cycleId}/terminate`]);

    // Keep the employee editor open: no reload or API-based save may replace its inputs.
    await expect(comment).toHaveValue(draftText);
    const rejectedSave = employeePage.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/assessment-periods/${employeeTask.periodId}/employee-draft`
      && response.request().method() === 'PUT');
    await saveDraft.click();
    expect((await rejectedSave).status()).toBe(409);
    const notice = employeePage.getByTestId('employee-period-write-notice');
    await expect(notice).toContainText('已终止');
    await expect(notice).toContainText('未保存输入仍保留');
    await expect(comment).toHaveValue(draftText);
    await expect(employeePage.getByTestId('employee-period-preserved-form')).toHaveJSProperty('disabled', true);
    await expect(saveDraft).toBeDisabled();
    await expect(employeePage.getByTestId('employee-period-saved-records')).toBeVisible();
    await review.screenshot({ path: info.outputPath('employee-blocked-form.png') });
    const expectedWrites = [`PUT /api/v1/assessment-periods/${employeeTask.periodId}/employee-draft`];
    expect(employeeWrites).toEqual(expectedWrites);
    // A physical second click must remain a native-disabled no-op, not another rejected write.
    await saveDraft.scrollIntoViewIfNeeded();
    const bounds = await saveDraft.boundingBox();
    expect(bounds).not.toBeNull();
    await employeePage.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect(notice).toContainText('已终止');
    await expect(comment).toHaveValue(draftText);
    expect(employeeWrites).toEqual(expectedWrites);
  } finally { await employeeContext.close(); }

  await page.reload();
  await expect(page.getByTestId('cycle-termination-record')).toContainText(reason);
  await expect(page.getByTestId('cycle-termination-record')).toContainText('终止时间');
  await expect(page.getByTestId('cycle-workspace-terminate')).toHaveCount(0);
  await expect(page.getByTestId('cycle-workspace-edit')).toHaveCount(0);
  await expect(page.getByTestId('cycle-preflight-primary-action')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新开放月度自评', exact: true })).toHaveCount(0);
  await page.getByTestId('cycle-termination-record').screenshot({ path: info.outputPath('cycle-terminated-record.png') });
  await page.getByTestId('cycle-workspace-back').click();
  await page.getByRole('button', { name: '已结束', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('group')).toBe('finished');
  const mobilePart = (info.project.use.viewport?.width ?? 1440) < 768 ? 'mobile-' : '';
  const viewRecords = page.getByTestId(`cycle-primary-${mobilePart}${fixture.cycleId}`);
  await expect(viewRecords).toHaveText('查看记录');
  await expect(page.getByTestId(`cycle-terminate-${mobilePart}${fixture.cycleId}`)).toHaveCount(0);
  await expect(page.getByTestId(`cycle-edit-${mobilePart}${fixture.cycleId}`)).toHaveCount(0);
  await expect(viewRecords.locator('..').getByRole('button', { name: '更多操作', exact: true })).toHaveCount(0);

  await page.goto(`/tasks?${new URLSearchParams({ goalView: 'monitor', cycleId: fixture.cycleId })}`);
  const ledger = page.getByTestId('goal-plan-list');
  await expect(ledger).toBeVisible();
  const recordRange = ledger.getByRole('combobox', { name: '记录范围', exact: true });
  await recordRange.focus();
  await recordRange.press('Enter');
  const terminatedOption = page.getByRole('option', { name: '已终止', exact: true });
  await expect(terminatedOption).toBeVisible();
  const ledgerRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/v1/goal-plans'
      && url.searchParams.get('scope') === 'monitor' && url.searchParams.get('cycleId') === fixture.cycleId
      && url.searchParams.get('lifecycleStatus') === 'terminated';
  });
  await terminatedOption.click();
  const ledgerResponse = await ledgerRead;
  expect(ledgerResponse.status()).toBe(200);
  const ledgerItems = (await ledgerResponse.json()).data.items as Array<{
    id: string; employeeName: string; cycleName: string; lifecycleStatus: string;
  }>;
  const retainedTask = ledgerItems.find(item => item.id === employeeTask.id);
  expect(retainedTask, 'The terminated ledger must retain the same employee task ID').toBeDefined();
  expect(retainedTask!.lifecycleStatus).toBe('terminated');
  expect(retainedTask!.cycleName).toBe(fixture.cycleName);
  const retainedRow = mobilePart
    ? ledger.locator('.goal-mobile:visible').filter({ hasText: retainedTask!.employeeName }).filter({ hasText: fixture.cycleName })
    : ledger.locator('.el-table:visible .el-table__body-wrapper tbody tr')
      .filter({ has: page.getByText(retainedTask!.employeeName, { exact: true }) });
  await expect(retainedRow).toHaveCount(1);
  await expect(retainedRow).toContainText('已终止');
  await expect(retainedRow).toContainText(fixture.cycleName);
  await retainedRow.getByRole('button', { name: '查看计划', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/tasks/${employeeTask.id}`);
  await expect(page.getByTestId('goal-monitor-detail')).toContainText(fixture.cycleName);
  await expect(page.getByTestId('goal-monitor-detail')).toContainText(retainedTask!.employeeName);
  await expect(page.locator('.lifecycle-actions')).toContainText('已终止');
  expect(hrWrites, 'Viewing the ended ledger must not add business writes').toEqual([`POST /api/v1/cycles/${fixture.cycleId}/terminate`]);

  const adminContext = await browser.newContext(contextOptions(info));
  try {
    const adminPage = await adminContext.newPage();
    adminPage.on('pageerror', error => pageErrors.push(error.message));
    const admin = await quickLogin(adminPage, 'ADMIN');
    expect(admin.sysRole).toBe('system_admin');
    expect(admin.hrCapabilities).not.toContain('cycle_terminate');
    await adminPage.goto(`/cycles?${query}`);
    await expect(adminPage.getByTestId('cycle-termination-record')).toContainText(reason);
    await expect(adminPage.getByTestId('cycle-workspace-terminate')).toHaveCount(0);
    // Only forbidden-operation probes use direct HTTP; successful business actions above use UI buttons.
    const denial = await adminPage.evaluate(async ({ cycleId, hash }) => {
      const headers = { authorization: `Bearer ${localStorage.getItem('token') ?? ''}`, 'content-type': 'application/json' };
      const preview = await fetch(`/api/v1/cycles/${cycleId}/termination-preview`, { headers });
      const terminate = await fetch(`/api/v1/cycles/${cycleId}/terminate`, { method: 'POST', headers,
        body: JSON.stringify({ reason: '隔离管理员无独立授权拒绝验证', expectedPreviewHash: hash }) });
      return { preview: preview.status, terminate: terminate.status };
    }, { cycleId: fixture.cycleId, hash: approvedPreviewHash });
    expect(denial).toEqual({ preview: 403, terminate: 403 });
  } finally { await adminContext.close(); }
  expect(pageErrors).toEqual([]);
});
