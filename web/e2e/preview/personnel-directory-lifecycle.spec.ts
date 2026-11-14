import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const origin = 'http://localhost:5173';
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15_000 });
test.setTimeout(240_000);
type OwnedFixture = { suffix: string; kind: 'lifecycle' | 'query'; positionId?: string; employeeId?: string };
const ownedByPage = new WeakMap<Page, OwnedFixture>();

function cleanupOwnedFixtures(fixtures: OwnedFixture[]) {
  for (const fixture of fixtures) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fixture.suffix)) {
      throw new Error('Cleanup requires an exact owned UUID');
    }
  }
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 45_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      const fixtures = ${JSON.stringify(fixtures)};
      (async () => {
        if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
        const results = [];
        for (const f of fixtures) results.push(await db.$transaction(async tx => {
          const names = f.kind === 'query' ? ['虚构目录竞态' + f.suffix]
            : ['虚构岗位' + f.suffix, '虚构岗位' + f.suffix + '改名', '虚构岗位' + f.suffix + '恢复'];
          const employeeName = '虚构目录员工' + f.suffix;
          const familyName = '虚构职系' + f.suffix;
          const positions = await tx.position.findMany({ where: { OR: [{ name: { in: names } }, ...(f.positionId ? [{ id: f.positionId }] : [])] } });
          const users = f.kind === 'query' ? [] : await tx.user.findMany({ where: { OR: [{ name: employeeName }, ...(f.employeeId ? [{ id: f.employeeId }] : [])] } });
          if (positions.length > 1 || positions.some(p => !names.includes(p.name) || (f.positionId && p.id !== f.positionId)
            || (f.kind === 'lifecycle' && p.jobFamily !== familyName))) throw new Error('Position cleanup ownership mismatch');
          if (users.length > 1 || users.some(u => u.name !== employeeName || u.employeeNo !== 'R05_' + f.suffix.slice(0, 18)
            || u.status !== 'resigned' || u.sysRole !== 'employee' || (f.employeeId && u.id !== f.employeeId))) throw new Error('Employee cleanup ownership mismatch');
          const positionIds = positions.map(p => p.id), userIds = users.map(u => u.id);
          if (await tx.user.count({ where: { positionId: { in: positionIds }, id: { notIn: userIds } } })
            || await tx.employmentRecord.count({ where: { positionId: { in: positionIds }, userId: { notIn: userIds } } })) throw new Error('Position used outside owned fixture');
          const families = f.kind === 'query' ? [] : await tx.personnelReferenceData.findMany({ where: { kind: 'job_family', name: familyName } });
          if (families.length && (await tx.position.count({ where: { jobFamily: familyName, id: { notIn: positionIds } } })
            || await tx.employmentRecord.count({ where: { jobFamily: familyName, userId: { notIn: userIds } } }))) throw new Error('Family used outside owned fixture');
          const positionRequests = await tx.positionChangeRequest.findMany({ where: { OR: [{ positionId: { in: positionIds } }, { positionName: { in: names } }] } });
          if (positionRequests.some(r => !names.includes(r.positionName) || !names.includes(r.proposedValue.name)
            || (r.positionId && !positionIds.includes(r.positionId)))) throw new Error('Position request ownership mismatch');
          const employeeRequests = f.kind === 'query' ? [] : await tx.employeeDataChangeRequest.findMany({ where: { OR: [{ employeeName }, { userId: { in: userIds } }] } });
          if (employeeRequests.some(r => r.employeeName !== employeeName || (r.userId && !userIds.includes(r.userId)))) throw new Error('Employee request ownership mismatch');
          const positionRequestIds = positionRequests.map(r => r.id), employeeRequestIds = employeeRequests.map(r => r.id), familyIds = families.map(r => r.id);
          const audits = await tx.auditLog.deleteMany({ where: { OR: [
            { entityType: 'position_change_request', entityId: { in: positionRequestIds } },
            { entityType: 'employee_data_change_request', entityId: { in: employeeRequestIds } },
            { entityType: 'personnel_reference_data', entityId: { in: familyIds } },
          ] } });
          await tx.employeeNumberAssignment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { sourceRequestId: { in: employeeRequestIds } }] } });
          await tx.employeeContract.deleteMany({ where: { userId: { in: userIds } } });
          await tx.employmentRecord.deleteMany({ where: { userId: { in: userIds } } });
          await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: employeeRequestIds } } });
          await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
          await tx.positionChangeRequest.deleteMany({ where: { id: { in: positionRequestIds } } });
          await tx.position.deleteMany({ where: { id: { in: positionIds } } });
          await tx.personnelReferenceData.deleteMany({ where: { id: { in: familyIds } } });
          return { suffix: f.suffix, positionIds, userIds, familyIds, positionRequestIds, employeeRequestIds, audits: audits.count };
        }, { isolationLevel: 'Serializable', timeout: 15_000 }));
        console.log(JSON.stringify(results));
      })().finally(() => db.$disconnect()).catch(error => { console.error('Owned cleanup failed:', error.message); process.exitCode = 1; });`,
  }));
}

test.afterEach(async ({ page }, info) => {
  const fixture = ownedByPage.get(page);
  if (!fixture) return;
  await page.close();
  await attach(info, 'owned-fixture-cleanup', cleanupOwnedFixtures([fixture]));
});

test.beforeAll(() => {
  const containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  const webEnv = containers[1].Config.Env as string[];
  expect(webEnv).toContain('VITE_PREVIEW_MODE=true');
  expect(webEnv).toContain('VITE_DEV_PROXY_TARGET=http://api:3000');
});

function responseFor(page: Page, method: string, path: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}`
    && response.request().method() === method);
}

async function readPositions(page: Page, keyword: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.get(`${origin}/api/v1/positions`, {
    headers: { authorization: `Bearer ${token}` }, params: { includeInactive: true, keyword },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as { id: string; name: string; jobFamily: string | null; isActive: boolean }[];
}

async function readEmployeeSnapshot(page: Page, id: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.get(`${origin}/api/v1/employee-archives/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const archive = (await response.json()).data;
  return { id: archive.id, status: archive.status, employmentHistory: archive.employmentHistory.map((record: {
    id: string; positionId: string; position: string; jobFamily: string; employeeStatus: string;
  }) => ({ id: record.id, positionId: record.positionId, position: record.position,
    jobFamily: record.jobFamily, employeeStatus: record.employeeStatus })) };
}

async function attach(info: TestInfo, name: string, data: unknown) {
  const path = info.outputPath(`${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

function resultRow(page: Page, info: TestInfo, name: string) {
  return page.locator(info.project.name === 'mobile' ? '.mobile-result-card:visible' : '.el-table__row:visible')
    .filter({ hasText: name });
}

async function directory(page: Page, keyword: string) {
  const initial = responseFor(page, 'GET', '/positions');
  await page.goto(`${origin}/basic-data?tab=positions`);
  await (await initial).finished();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  await page.getByPlaceholder('搜索岗位或职系').fill(keyword);
  const filtered = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/v1/positions'
      && url.searchParams.get('keyword') === keyword && url.searchParams.get('includeInactive') === 'true';
  });
  await page.locator('label.el-checkbox').filter({ hasText: '含已停用' }).click();
  await (await filtered).finished();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
}

async function approve(page: Page, info: TestInfo, requestId: string, name: string) {
  await page.goto(`${origin}/entry-exit?tab=reviews&category=position`);
  const row = resultRow(page, info, name);
  await expect(row).toHaveCount(1);
  const response = responseFor(page, 'POST', `/positions/change-requests/${requestId}/approve`);
  await row.getByRole('button', { name: '通过', exact: true }).click();
  expect((await response).status()).toBe(201);
}

async function createPosition(page: Page, name: string, family: string, createFamily = false, status = 201) {
  await page.getByRole('button', { name: '新增岗位', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增岗位', exact: true });
  await drawer.getByLabel('岗位名称', { exact: true }).fill(name);
  await drawer.getByRole('combobox', { name: '职系', exact: true }).click();
  if (createFamily) {
    await page.getByRole('button', { name: '新增职系', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增职系', exact: true });
    await dialog.getByRole('textbox', { name: '职系名称', exact: true }).fill(family);
    await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } else await page.getByRole('option', { name: family, exact: true }).click();
  const response = responseFor(page, 'POST', '/positions');
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(status);
  const body = await saved.json();
  if (status === 201) await expect(drawer).not.toBeVisible();
  else {
    await expect(drawer.getByLabel('岗位名称', { exact: true })).toHaveValue(name);
    await expect(page.getByText('相同岗位已有变更审核中，请先处理现有申请', { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
  }
  return body.data;
}

function seedHistoricalEmployee(positionId: string, suffix: string, oldName: string, oldFamily: string) {
  const fixture = { id: randomUUID(), name: `虚构目录员工${suffix}`, employeeNo: `R05_${suffix.slice(0, 18)}`,
    positionId, oldName, oldFamily };
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      const f = ${JSON.stringify(fixture)};
      (async () => {
        if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
        const dept = await db.department.findFirstOrThrow({ where: { name: '预览业务部' } });
        const position = await db.position.findUniqueOrThrow({ where: { id: f.positionId } });
        if (!position.name.includes('${suffix}')) throw new Error('Fixture ownership mismatch');
        await db.user.create({ data: { id: f.id, name: f.name, employeeNo: f.employeeNo, status: 'resigned',
          sysRole: 'employee', deptId: dept.id, positionId: f.positionId, position: f.oldName,
          entryDate: new Date('2024-01-01'), employmentHistory: { create: {
            employeeNo: f.employeeNo, effectiveFrom: new Date('2024-01-01'), effectiveTo: new Date('2024-12-31'),
            entryDate: new Date('2024-01-01'), company: 'fuede', deptId: dept.id, positionId: f.positionId,
            position: f.oldName, jobFamily: f.oldFamily, employeeStatus: 'resigned', employmentType: 'full_time',
            changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      })().finally(() => db.$disconnect()).catch(error => { console.error('R05 isolated fixture failed', error.code, error.meta?.column_name); process.exitCode = 1; });`,
  });
  return fixture;
}

async function openReentry(page: Page, name: string) {
  await page.goto(`${origin}/entry-exit`);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const create = page.getByRole('dialog', { name: '办理入职', exact: true });
  await create.getByLabel('姓名', { exact: true }).fill(name);
  await create.getByRole('region', { name: '同名离职员工' }).getByRole('button', { name: /^选择 .* 再入职$/ }).click();
  const drawer = page.getByRole('dialog', { name: '办理再入职', exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  return drawer;
}

test('R05 own directory lifecycle and historical reentry selector against the real preview', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const suffix = randomUUID();
  const owned: OwnedFixture = { suffix, kind: 'lifecycle' };
  ownedByPage.set(page, owned);
  await attach(info, 'owned-fixture-identity', owned);
  const name = `虚构岗位${suffix}`;
  const renamed = `${name}改名`;
  const restored = `${name}恢复`;
  const family = `虚构职系${suffix}`;
  const oldFamily = `虚构旧职系${suffix}`;
  const writes: { method: string; path: string; status: number }[] = [];
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      external.push(url.origin); return route.abort();
    }
    return route.continue();
  });
  page.on('response', response => {
    const request = response.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(),
      path: new URL(response.url()).pathname, status: response.status() });
  });
  try {
    await page.goto(`${origin}/login`);
    await page.getByTestId('preview-login').click();
    await expect(page).toHaveURL(`${origin}/dashboard`);
    await directory(page, suffix);
    const created = await createPosition(page, name, family, true);
    expect(created.status).toBe('pending');
    await createPosition(page, name, family, false, 409);
    await approve(page, info, created.id, name);
    const [position] = await readPositions(page, suffix);
    owned.positionId = position.id;
    expect(position).toMatchObject({ name, jobFamily: family, isActive: true });
    await attach(info, 'created-position-after-ui-approval', position);

    // Existing names warn, not reject; the separate pending-duplicate rule was verified above.
    await directory(page, suffix);
    const sameName = await createPosition(page, name, family);
    expect(sameName.warnings).toContain(`已存在相似岗位：${name}`);
    await page.goto(`${origin}/entry-exit?tab=reviews&category=position`);
    await resultRow(page, info, name).getByRole('button', { name: '退回', exact: true }).click();
    const reject = page.getByRole('dialog', { name: '退回岗位变更', exact: true });
    await reject.getByRole('textbox').fill('虚构重名规则验证完成，不创建第二个岗位');
    const rejected = responseFor(page, 'POST', `/positions/change-requests/${sameName.id}/reject`);
    await reject.getByRole('button', { name: '确认退回', exact: true }).click();
    expect((await rejected).status()).toBe(201);

    await directory(page, suffix);
    await resultRow(page, info, name).getByRole('button', { name: '编辑', exact: true }).click();
    let edit = page.getByRole('dialog', { name: '编辑岗位', exact: true });
    await edit.getByLabel('岗位名称', { exact: true }).fill(renamed);
    let pending = responseFor(page, 'PATCH', `/positions/${position.id}`);
    await edit.getByRole('button', { name: '提交审核', exact: true }).click();
    let updated = (await (await pending).json()).data;
    await approve(page, info, updated.id, name);
    expect((await readPositions(page, suffix))[0]).toMatchObject({ id: position.id, name: renamed, jobFamily: family });
    const employee = seedHistoricalEmployee(position.id, suffix, name, oldFamily);
    owned.employeeId = employee.id;
    await attach(info, 'database-fixture-only-not-ui-onboarding', employee);
    const employeeBefore = await readEmployeeSnapshot(page, employee.id);
    expect(employeeBefore).toMatchObject({ id: employee.id, status: 'resigned', employmentHistory: [
      { positionId: position.id, position: name, jobFamily: oldFamily, employeeStatus: 'resigned' },
    ] });

    await directory(page, suffix);
    await resultRow(page, info, renamed).getByRole('button', { name: '停用', exact: true }).click();
    const stopped = responseFor(page, 'DELETE', `/positions/${position.id}`);
    await page.getByRole('dialog', { name: '停用岗位', exact: true }).getByRole('button', { name: '提交停用', exact: true }).click();
    const stopping = (await (await stopped).json()).data;
    await approve(page, info, stopping.id, renamed);
    expect((await readPositions(page, suffix))[0].isActive).toBe(false);
    let reentry = await openReentry(page, employee.name);
    await expect(reentry.getByLabel('岗位', { exact: true })).toHaveValue('');
    await expect(reentry).toContainText(`${name}（已停用）`);
    await expect(reentry.getByLabel('职系', { exact: true })).toHaveValue(oldFamily);
    await expect(reentry.getByLabel('职系', { exact: true })).toHaveAttribute('readonly', '');
    await expect(reentry).toContainText('历史岗位已停用或不可用，请重新选择启用岗位或清空。');
    await reentry.getByLabel('岗位', { exact: true }).click();
    await expect(page.getByRole('option', { name: `${name}（已停用）`, exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await snapshot(page, info, 'disabled-history-visible');
    const selector = reentry.locator('.el-form-item').filter({ has: page.locator('label').filter({ hasText: /^岗位$/ }) }).locator('.el-select');
    await reentry.getByLabel('岗位', { exact: true }).click();
    await selector.locator('.el-select__clear').click();
    await expect(reentry.getByLabel('岗位名称', { exact: true })).toHaveValue('');
    await reentry.getByLabel('岗位', { exact: true }).click();
    await expect(page.getByRole('option').filter({ hasText: suffix })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await reentry.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();

    await directory(page, suffix);
    const inactive = resultRow(page, info, renamed);
    await expect(inactive).toContainText('已停用');
    await expect(inactive.getByRole('button', { name: '申请启用', exact: true })).toBeVisible();
    await inactive.getByRole('button', { name: '编辑', exact: true }).click();
    edit = page.getByRole('dialog', { name: '编辑岗位', exact: true });
    await edit.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect(page.getByText('未检测到变更，无需提交审核', { exact: true })).toBeVisible();
    await edit.getByLabel('岗位名称', { exact: true }).fill(restored);
    pending = responseFor(page, 'PATCH', `/positions/${position.id}`);
    await edit.getByRole('button', { name: '提交审核', exact: true }).click();
    updated = (await (await pending).json()).data;
    expect(updated.proposedValue.isActive).toBe(false);
    expect(updated.proposedValue.activationRequested).toBeUndefined();
    await approve(page, info, updated.id, renamed);
    expect((await readPositions(page, suffix))[0]).toMatchObject({ id: position.id, name: restored, isActive: false });

    await directory(page, suffix);
    await resultRow(page, info, restored).getByRole('button', { name: '申请启用', exact: true }).click();
    const activationDialog = page.getByRole('dialog', { name: '申请启用岗位', exact: true });
    await expect(activationDialog).toContainText('HR 管理员审核通过后生效，员工与历史任职不变');
    pending = responseFor(page, 'PATCH', `/positions/${position.id}`);
    await activationDialog.getByRole('button', { name: '提交启用审核', exact: true }).click();
    const activationResponse = await pending;
    expect(activationResponse.request().postDataJSON()).toEqual({ activationRequested: true });
    updated = (await activationResponse.json()).data;
    expect(updated).toMatchObject({ status: 'pending', action: 'update',
      proposedValue: { activationRequested: true, isActive: true } });
    expect((await readPositions(page, suffix))[0].isActive).toBe(false);
    await expect(resultRow(page, info, restored)).toContainText('已停用');
    await snapshot(page, info, 'activation-awaiting-review');
    await approve(page, info, updated.id, restored);
    const [active] = await readPositions(page, suffix);
    await attach(info, 'reactivation-proposal-versus-persisted-position', {
      requestId: updated.id, proposedValue: updated.proposedValue, persistedPosition: active,
      operations: 'UI request activation, UI confirmation, UI approve; authenticated GET for persistence assertion',
    });
    expect(active).toMatchObject({ id: position.id, name: restored, jobFamily: family, isActive: true });
    expect(await readEmployeeSnapshot(page, employee.id)).toEqual(employeeBefore);
    reentry = await openReentry(page, employee.name);
    await expect(reentry.getByLabel('职系', { exact: true })).toHaveValue(oldFamily);
    const activeSelect = reentry.locator('.el-form-item').filter({ has: page.locator('label').filter({ hasText: /^岗位$/ }) }).locator('.el-select');
    await reentry.getByLabel('岗位', { exact: true }).click();
    await activeSelect.locator('.el-select__clear').click();
    await reentry.getByLabel('岗位', { exact: true }).click();
    const option = page.getByRole('option', { name: restored, exact: true });
    await expect(option).not.toHaveAttribute('aria-disabled', 'true');
    await option.click();
    await expect(activeSelect).toContainText(restored);
    await expect(reentry.getByLabel('职系', { exact: true })).toHaveValue(active.jobFamily!);
    await expect(reentry.getByLabel('职系', { exact: true })).toHaveAttribute('readonly', '');
    await expect(reentry.getByText('历史岗位已停用或不可用，请重新选择启用岗位或清空。')).toHaveCount(0);
    await expect(option).not.toBeVisible();
    await snapshot(page, info, 'reactivated-directory-choice');
    await attach(info, 'coverage-and-owned-fixtures', { position: active, employee, sameNameRule: 'existing name warns; identical pending name/family rejects',
      reactivation: 'Explicit UI activation followed by UI approval', employeeSnapshotUnchanged: employeeBefore, reentrySubmitted: false });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  } finally {
    await attach(info, 'browser-boundaries', { writes, errors, external });
  }
});

test('directory query ordering technical regression with delayed real responses', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  const suffix = randomUUID();
  const fixture = { id: randomUUID(), name: `虚构目录竞态${suffix}`, code: `POS-${randomUUID()}` };
  ownedByPage.set(page, { suffix, kind: 'query', positionId: fixture.id });
  // A directory-only fixture for timing verification, not evidence of UI creation or approval.
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 20_000,
    input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      (async () => {
        if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
        await db.position.create({ data: { ...${JSON.stringify(fixture)}, isActive: false } });
      })().finally(() => db.$disconnect()).catch(() => { console.error('R05 query-order fixture failed'); process.exitCode = 1; });`,
  });
  await attach(info, 'query-order-fixture-only', fixture);
  await page.goto(`${origin}/login`);
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await directory(page, fixture.name);
  const row = resultRow(page, info, fixture.name);
  await expect(row).toContainText('已停用');

  for (const order of ['latest-first', 'old-first'] as const) {
    const gate = () => {
      let resolve!: () => void;
      return { promise: new Promise<void>(done => { resolve = done; }), release: () => resolve() };
    };
    const old = { ready: gate(), response: gate(), body: null as any };
    const latest = { ready: gate(), response: gate(), body: null as any };
    const matches = (url: URL) => url.pathname === '/api/v1/positions' && url.searchParams.get('keyword') === fixture.name;
    const waitResponse = (includeInactive: boolean) => page.waitForResponse(response => {
      const url = new URL(response.url());
      return matches(url) && url.searchParams.get('includeInactive') === String(includeInactive);
    });
    await page.route(`${origin}/api/v1/positions?*`, async route => {
      const url = new URL(route.request().url());
      if (!matches(url)) return route.continue();
      const held = url.searchParams.get('includeInactive') === 'true' ? latest : old;
      const response = await route.fetch();
      held.body = await response.json();
      held.ready.release();
      await held.response.promise;
      await route.fulfill({ response });
    });
    try {
      const oldFinished = waitResponse(false);
      await page.locator('label.el-checkbox').filter({ hasText: '含已停用' }).click();
      await old.ready.promise;
      const latestFinished = waitResponse(true);
      await page.locator('label.el-checkbox').filter({ hasText: '含已停用' }).click();
      await latest.ready.promise;
      expect(old.body.data).toEqual([]);
      expect(latest.body.data).toEqual([expect.objectContaining({ id: fixture.id, isActive: false })]);
      await attach(info, `query-order-${order}`, { old: old.body, latest: latest.body, timing: order });
      if (order === 'old-first') {
        old.response.release();
        await (await oldFinished).finished();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await expect(page.locator('.position-directory .el-loading-mask:visible').first()).toBeVisible();
        latest.response.release();
        await (await latestFinished).finished();
      } else {
        latest.response.release();
        await (await latestFinished).finished();
        await expect(row).toContainText('已停用');
        old.response.release();
        await (await oldFinished).finished();
      }
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
      await expect(row).toContainText('已停用');
      await snapshot(page, info, `query-order-${order}`);
    } finally {
      old.response.release(); latest.response.release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});
