import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, message: 'success', data });
const employee = { id: 'quality-employee', name: '虚构档案员工', employeeNo: 'Q001', status: 'active',
  deptId: null, positionId: 'quality-position', position: '测试岗位', employmentType: 'full_time',
  sysRole: 'employee', directManagerId: 'quality-manager', archivedAt: null, businessIdentities: [] };
const manager = { ...employee, id: 'quality-manager', name: '虚构上级', employeeNo: 'Q002' };

function archiveRequest(recordStatus = 'draft', reviewStatus = 'pending') {
  return { id: 'quality-existing-request', userId: employee.id, sourceType: 'manual_archive_change',
    recordStatus, archivedAt: null, requestVersion: 7, profileReviewStatus: reviewStatus,
    performanceReviewStatus: 'not_required', canResume: recordStatus === 'draft' || reviewStatus === 'rejected',
    createdById: 'quality-other-hr', createdBy: { id: 'quality-other-hr', name: '虚构其他HR' },
    createdAt: '2026-11-13T00:00:00Z', employeeName: employee.name, employeeNo: employee.employeeNo,
    baseValue: { employee: { name: employee.name }, profile: {}, contracts: [] },
    proposedValue: { employee: { name: '另一位HR刚保存的姓名' }, profile: {}, contracts: [] }, events: [],
  };
}

// Same fully intercepted archive/identity/position fixture as spec 83; never contacts a real API.
async function openArchive(page: Page, initialRequest: ReturnType<typeof archiveRequest> | null = null,
  profileOverrides: Record<string, unknown> = {}) {
  let currentRequest = initialRequest;
  let rejectSave = false;
  let rejectSubmit = false;
  let rejectArchiveRead = false;
  const saved: any[] = [];
  const submitted: any[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  const archive = { ...employee, phone: null, archiveVersion: 'quality-baseline', dept: null,
    entryDate: '2024-01-01', performanceManager: manager, rosterManager: manager,
    employeeProfile: { phone: null, gender: '女', ...profileOverrides },
    currentEmployment: { company: 'fuede', positionId: 'quality-position', directManagerId: manager.id },
    employmentHistory: [], employeeContracts: [], externalIdentityBindings: [] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'quality-mock-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'GET') reads.push(path);
    else writes.push(`${request.method()} ${path}`);
    let data: unknown = [];
    if (path === '/auth/me') data = { id: 'quality-admin', name: '虚构管理员', sysRole: 'system_admin', canViewAll: true };
    else if (path === '/notifications/unread-count') data = 0;
    else if (path === '/users') data = { items: [employee, manager], total: 2, page: 1, pageSize: 20 };
    else if (path === '/users/quality-manager') data = manager;
    else if (path === '/positions') data = [{ id: 'quality-position', name: '测试岗位', isActive: true }];
    else if (path === '/contract-subjects') data = [{ id: 'subject-a', name: '目录公司甲', isActive: true }];
    else if (path === '/employee-archives/quality-employee') {
      if (rejectArchiveRead) {
        await route.fulfill({ status: 503, json: { code: 5001, message: '暂时无法读取最新档案', data: null } });
        return;
      }
      data = { ...archive, changeHistory: currentRequest ? [currentRequest] : [] };
    }
    else if (path === '/employee-archives/applications/quality-existing-request') data = currentRequest;
    else if (path === '/employee-archives/quality-employee/draft/save') {
      const payload = request.postDataJSON();
      saved.push(payload);
      if (rejectSave) {
        await route.fulfill({ status: 409, json: { code: 4009,
          message: '员工已有待核草稿或待审申请，请打开原单继续维护', data: null } });
        return;
      }
      currentRequest = { ...archiveRequest(), requestVersion: (currentRequest?.requestVersion ?? 0) + 1, proposedValue: payload };
      data = currentRequest;
    } else if (path === '/employee-archives/quality-employee/draft') {
      submitted.push(request.postDataJSON());
      if (rejectSubmit) {
        await route.fulfill({ status: 409, json: { code: 4009,
          message: '正式档案已发生变化，请保留当前输入并重新核对最新档案', data: null } });
        return;
      }
      data = { request: currentRequest, directApplied: [], reviewOutcome: 'pending' };
    } else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: response(data) });
  });
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  return { drawer, writes, reads, saved, submitted,
    setRequest: (value: ReturnType<typeof archiveRequest> | null) => { currentRequest = value; },
    rejectSaves: () => { rejectSave = true; },
    rejectSubmits: () => { rejectSubmit = true; },
    failArchiveReads: (value: boolean) => { rejectArchiveRead = value; },
    archiveReadCount: () => reads.filter(path => path === '/employee-archives/quality-employee').length,
  };
}

async function observeErrorToasts(page: Page) {
  await page.evaluate(() => {
    (window as any).__archiveErrorToasts = [];
    new MutationObserver(() => {
      document.querySelectorAll('.el-message--error').forEach(node => {
        const errors = (window as any).__archiveErrorToasts as string[];
        if (!errors.includes(node.textContent || '')) errors.push(node.textContent || '');
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
}

for (const state of ['pending', 'applying']) {
  test(`${state} 原申请存在时编辑入口只提示查看原申请，不启动新单或写请求`, async ({ page }) => {
    const fixture = await openArchive(page, archiveRequest('submitted', state));
    await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    await expect(fixture.drawer.getByText('已有待处理的档案变更', { exact: true })).toBeVisible();
    await expect(fixture.drawer.locator('.archive-inline-editor')).toHaveCount(0);
    await page.waitForTimeout(1100); // Exceeds the 700 ms autosave debounce.
    expect(fixture.writes).toEqual([]);
    await fixture.drawer.getByRole('button', { name: '查看原申请', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /办理详情$/ })).toBeVisible();
    expect(fixture.reads).toContain('/employee-archives/applications/quality-existing-request');
    expect(fixture.writes).toEqual([]);
  });
}

test('详情打开后新增的其他HR草稿在编辑前重新读取，并携原ID及版本续写', async ({ page }) => {
  const fixture = await openArchive(page);
  const previousReads = fixture.archiveReadCount();
  fixture.setRequest(archiveRequest());
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect.poll(fixture.archiveReadCount).toBeGreaterThan(previousReads);
  const name = fixture.drawer.locator('[data-archive-field="employee.name"] input');
  await expect(name).toHaveValue('另一位HR刚保存的姓名');
  await page.waitForTimeout(1100);
  expect(fixture.writes).toEqual([]);
  await name.fill('在最新草稿上继续修改');
  await expect.poll(() => fixture.saved.at(-1)).toMatchObject({
    draftId: 'quality-existing-request', expectedVersion: 7, employee: { name: '在最新草稿上继续修改' },
  });
});

test('保存409只展示一条页内提示并保留输入，重新加载必须先让用户选择', async ({ page }) => {
  const fixture = await openArchive(page, archiveRequest());
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await observeErrorToasts(page);
  fixture.rejectSaves();
  const name = fixture.drawer.locator('[data-archive-field="employee.name"] input');
  await name.fill('尚未保存且必须保留的输入');
  const error = fixture.drawer.locator('.archive-save-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveCount(1);
  await expect(error).toContainText('已保留');
  expect(await page.evaluate(() => (window as any).__archiveErrorToasts)).toEqual([]);
  await expect(name).toHaveValue('尚未保存且必须保留的输入');

  const readsBeforeReload = fixture.archiveReadCount();
  await error.getByRole('button', { name: '重新加载', exact: true }).click();
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '放弃修改并加载', exact: true }) });
  await expect(confirmation.getByRole('button', { name: '保留当前输入', exact: true })).toBeVisible();
  expect(fixture.archiveReadCount()).toBe(readsBeforeReload);
  await confirmation.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(name).toHaveValue('尚未保存且必须保留的输入');
  expect(fixture.archiveReadCount()).toBe(readsBeforeReload);

  fixture.setRequest({ ...archiveRequest(), requestVersion: 9,
    proposedValue: { employee: { name: '最新正式恢复草稿' }, profile: {}, contracts: [] } });
  await error.getByRole('button', { name: '重新加载', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并加载', exact: true }).click();
  await expect.poll(fixture.archiveReadCount).toBeGreaterThan(readsBeforeReload);
  await expect(name).toHaveValue('最新正式恢复草稿');
});

test('未修改进入编辑并等待不发送自动保存或提交', async ({ page }) => {
  const fixture = await openArchive(page);
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await expect(fixture.drawer.locator('[data-archive-field="employee.name"] input')).toHaveValue(employee.name);
  await page.waitForTimeout(1600);
  expect(fixture.writes).toEqual([]);
});

test('字符串子女数量挂载归一化不算修改，未编辑直接提交只提示无变更且零写入', async ({ page }) => {
  const fixture = await openArchive(page, null, { childrenCount: '2' });
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  const childrenCount = fixture.drawer.locator('.el-form-item').filter({ has: page.getByText('子女数量', { exact: true }) }).locator('input');
  await expect(childrenCount).toHaveValue('2');
  await page.waitForTimeout(1100);
  expect(fixture.writes).toEqual([]);
  await fixture.drawer.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('未检测到变更，无需提交', { exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  expect(fixture.writes).toEqual([]);
});

test('提交409只保留一条页内冲突提示和当前输入，禁用再次提交并允许确认后加载原草稿', async ({ page }) => {
  const fixture = await openArchive(page, archiveRequest());
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  await observeErrorToasts(page);
  fixture.rejectSubmits();
  const name = fixture.drawer.locator('[data-archive-field="employee.name"] input');
  await name.fill('提交发生冲突也必须保留');
  await fixture.drawer.getByRole('button', { name: '提交', exact: true }).click();
  await expect.poll(() => fixture.submitted.length).toBe(1);
  const error = fixture.drawer.locator('.archive-save-error');
  await expect(error).toHaveCount(1);
  await expect(error).toContainText('已保留');
  await expect(fixture.drawer.locator('[role="alert"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__archiveErrorToasts)).toEqual([]);
  await expect(name).toHaveValue('提交发生冲突也必须保留');
  await expect(fixture.drawer.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
  await page.waitForTimeout(1100);
  expect(fixture.submitted).toHaveLength(1);
  expect(fixture.saved).toEqual([]);

  fixture.setRequest({ ...archiveRequest(), requestVersion: 12,
    proposedValue: { employee: { name: '提交冲突后加载的最新草稿' }, profile: {}, contracts: [] } });
  await error.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并加载', exact: true }).click();
  await expect(name).toHaveValue('提交冲突后加载的最新草稿');
  await expect(fixture.drawer.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
});

test('重新加载最新档案失败保留未保存输入，随后能重试恢复最新草稿', async ({ page }) => {
  const fixture = await openArchive(page, archiveRequest());
  await fixture.drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  fixture.rejectSaves();
  const name = fixture.drawer.locator('[data-archive-field="employee.name"] input');
  await name.fill('读取失败也不能丢失的输入');
  const error = fixture.drawer.locator('.archive-save-error');
  await expect(error).toBeVisible();
  fixture.failArchiveReads(true);
  await error.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并加载', exact: true }).click();
  await expect(error).toContainText('最新记录暂时读取失败，输入已保留，请重试加载。');
  await expect(fixture.drawer.locator('[role="alert"]')).toHaveCount(1);
  await expect(name).toHaveValue('读取失败也不能丢失的输入');

  fixture.failArchiveReads(false);
  fixture.setRequest({ ...archiveRequest(), requestVersion: 14,
    proposedValue: { employee: { name: '读取重试成功后的最新草稿' }, profile: {}, contracts: [] } });
  await error.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并加载', exact: true }).click();
  await expect(name).toHaveValue('读取重试成功后的最新草稿');
  await expect(fixture.drawer.getByText('最新记录暂时读取失败，输入已保留，请重试加载。', { exact: true })).toHaveCount(0);
  expect(fixture.saved).toHaveLength(1);
});
