import { expect, test, type Page } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

const employee = { id: 'daily-person', name: '合成日常办理员工', employeeNo: 'DAY001',
  sysRole: 'employee', status: 'active', employmentType: 'full_time',
  hrCapabilities: [], businessIdentities: [], archivedAt: null, dingtalkBindingState: 'unbound' };
const department = { id: 'official-dept', name: '合成正式部门', company: 'fuede', children: [] };

async function setup(page: Page, contracts: any[] = []) {
  const state = { officialDepartment: false, failNextArchive: false, draft: null as any,
    saves: [] as any[], submissions: [] as any[], resignations: [] as any[] };
  await page.clock.setFixedTime(new Date('2026-11-01T16:30:00Z')); // 北京时间已是 11 月 2 日。
  await page.addInitScript(() => {
    localStorage.setItem('token', 'SYNTHETIC-DAILY-ONLY');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = [];
    if (path.endsWith('/auth/me')) data = { id: 'hr-daily', name: '合成 HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/departments')) data = [department];
    else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
    else if (path.endsWith(`/employee-archives/${employee.id}`)) {
      if (state.failNextArchive) {
        state.failNextArchive = false;
        await route.fulfill({ status: 503, json: { code: 503, message: '合成读取失败，请重试' } });
        return;
      }
      const employment = { id: 'daily-employment', company: 'fuede', companyText: null,
        deptId: state.officialDepartment ? department.id : null, positionId: null,
        employeeStatus: 'active', employmentType: 'full_time', effectiveFrom: '2026-01-01', entryDate: '2026-01-01' };
      data = { ...employee, archiveVersion: 'daily-version', dept: state.officialDepartment ? department : null,
        currentEmployment: employment, employmentHistory: [employment], employeeProfile: {},
        employeeContracts: contracts, changeHistory: state.draft ? [state.draft] : [], latestResignationReview: null };
    } else if (path.endsWith(`/${employee.id}/draft/save`) || path.endsWith(`/${employee.id}/draft`)) {
      const submitted = path.endsWith('/draft'), body = route.request().postDataJSON();
      (submitted ? state.submissions : state.saves).push(body);
      state.draft = { id: 'daily-draft', userId: employee.id, employeeName: employee.name,
        requestVersion: state.saves.length + state.submissions.length, sourceType: 'manual_archive_change',
        recordStatus: submitted ? 'submitted' : 'draft', profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required', baseValue: {}, proposedValue: body, validationErrors: [],
        createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' };
      data = state.draft;
    } else if (path.endsWith(`/${employee.id}/employments`)) {
      const body = route.request().postDataJSON();
      state.resignations.push(body);
      data = { id: 'daily-resignation', profileReviewStatus: 'pending', proposedValue: { employee: body }, createdAt: '2026-11-02T00:00:00Z' };
    } else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  return state;
}

test('补充部门读取失败返回原离职表单并保留输入', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/users');
  await page.getByRole('button', { name: '办理离职', exact: true }).filter({ visible: true }).click();
  const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
  await resignation.getByRole('textbox', { name: '离职原因', exact: true }).fill('读取失败仍需保留');
  state.failNextArchive = true;
  await resignation.getByRole('button', { name: '补充部门', exact: true }).click();
  await expect(page.getByText('档案读取未完成，已保留离职信息，请重试补充部门。', { exact: true })).toBeVisible();
  await expect(resignation).toBeVisible();
  await expect(resignation.getByRole('textbox', { name: '离职原因', exact: true })).toHaveValue('读取失败仍需保留');
  await expect(resignation.getByRole('button', { name: '补充部门', exact: true })).toBeVisible();
  expect(state.resignations).toHaveLength(0);
});

test('补充部门仅存草稿关闭也返回离职，草稿部门不生效', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/users');
  await page.getByRole('button', { name: '办理离职', exact: true }).filter({ visible: true }).click();
  const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
  await resignation.getByRole('textbox', { name: '离职原因', exact: true }).fill('暂存部门后继续离职');
  await resignation.getByRole('button', { name: '补充部门', exact: true }).click();
  const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
  await archive.locator('[data-archive-field="employee.deptId"]').getByRole('combobox').click();
  await page.getByRole('treeitem', { name: department.name, exact: true }).click();
  await archive.getByRole('button', { name: '保存后关闭', exact: true }).click();
  await expect(resignation).toBeVisible();
  await expect(resignation.getByRole('textbox', { name: '离职原因', exact: true })).toHaveValue('暂存部门后继续离职');
  await expect(resignation.getByRole('textbox', { name: '当前部门', exact: true })).toHaveValue('未设置');
  expect(state.saves.at(-1)?.employee.deptId).toBe(department.id);
  expect(state.submissions).toHaveLength(0);
  expect(state.resignations).toHaveLength(0);
});

test('返回离职时正式档案响应晚到，不覆盖后来打开的档案', async ({ page }) => {
  await setup(page);
  await page.goto('/users');
  await page.getByRole('button', { name: '办理离职', exact: true }).filter({ visible: true }).click();
  const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
  await resignation.getByRole('button', { name: '补充部门', exact: true }).click();
  const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(archive.getByRole('button', { name: '提交审核', exact: true })).toBeVisible();
  let waitingReturn = false, releaseReturn: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { releaseReturn = resolve; });
  await page.route(`**/api/v1/employee-archives/${employee.id}`, async route => {
    if (!waitingReturn) {
      waitingReturn = true;
      await gate;
    }
    await route.fallback();
  });
  await archive.getByRole('button', { name: '返回离职办理', exact: true }).click();
  await expect.poll(() => waitingReturn).toBe(true);
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).click();
  await expect(archive.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
  const response = page.waitForResponse(response => response.url().endsWith(`/employee-archives/${employee.id}`));
  releaseReturn?.();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(resignation).not.toBeVisible();
  await expect(archive).toBeVisible();
});

const contractCases = [
  { name: '旧到期日', effectiveFrom: '2025-01-01', expiresAt: '2026-10-25', want: '已到期' },
  { name: '北京时间昨天', effectiveFrom: '2025-01-01', expiresAt: '2026-11-01', want: '已到期' },
  { name: '到期当天', effectiveFrom: '2025-01-01', expiresAt: '2026-11-02', want: '正常' },
  { name: '明日到期', effectiveFrom: '2025-01-01', expiresAt: '2026-11-03', want: '正常' },
  { name: '今日开始', effectiveFrom: '2026-11-02', expiresAt: '2027-11-01', want: '正常' },
  { name: '未来开始', effectiveFrom: '2026-11-03', expiresAt: '2027-11-01', want: '待生效' },
  { name: '无固定期限文本', effectiveFrom: '2025-01-01', expiresAt: null, termType: '无固定期限合同', want: '无固定期限' },
  { name: '有到期日优先于期限文本', effectiveFrom: '2025-01-01', expiresAt: '2026-10-25', termType: '无固定期限', want: '已到期' },
  { name: '真实未来到期日优先', effectiveFrom: '2025-01-01', expiresAt: '2027-10-25', termType: '无固定期限', want: '正常' },
  { name: '空生效日仍可判断已到期', effectiveFrom: null, expiresAt: '2026-10-25', want: '已到期' },
  { name: '空到期日', effectiveFrom: '2025-01-01', expiresAt: null, want: '期限待补' },
  { name: '空生效日', effectiveFrom: null, expiresAt: '2027-01-01', want: '期限待补' },
  { name: '全部日期为空', effectiveFrom: null, expiresAt: null, want: '期限待补' },
  { name: '未来的无固定期限合同', effectiveFrom: '2027-01-01', expiresAt: null, termType: '无固定期限', want: '待生效' },
  { name: '日期格式异常', effectiveFrom: '2025-01-01', expiresAt: '2026-2-3', want: '日期待核' },
  { name: '不存在的日期', effectiveFrom: '2025-01-01', expiresAt: '2026-02-30', want: '日期待核' },
  { name: '生效日期异常', effectiveFrom: '待核实', expiresAt: '2027-01-01', want: '日期待核' },
  { name: '无固定期限仍核实异常日期', effectiveFrom: '2025-01-01', expiresAt: '异常', termType: '无固定期限', want: '日期待核' },
  { name: '日期时间形式', signedAt: '2025-01-02T00:00:00.000Z', effectiveFrom: '2025-01-01T00:00:00.000Z', expiresAt: '2026-11-02T00:00:00.000Z', want: '正常' },
  { name: '起止颠倒', effectiveFrom: '2027-01-01', expiresAt: '2026-01-01', want: '日期待核' },
  { name: '历史保留', isActive: false, effectiveFrom: '2025-01-01', expiresAt: '2027-01-01', want: '旧版本/已移除' },
];

for (const width of [1440, 390]) {
  test(`${width}px 当前合同按北京时间日期显示，保留状态不能冒充有效`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, contractCases.map((contract, index) => ({ id: `contract-${index}`, contractType: 'contract',
      isActive: true, signedAt: '2025-01-01', termType: '固定期限', images: [], attachments: [], ...contract })));
    await page.goto('/users');
    await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await drawer.getByRole('tab', { name: '合同材料', exact: true }).click();
    await expect(drawer.locator('.employee-archive__contract-card').filter({ visible: true })).toHaveCount(1);
    await drawer.getByRole('button', { name: /历史合同/ }).click();
    for (const contract of contractCases) {
      const card = drawer.locator('.employee-archive__contract-card').filter({ has: page.getByText(contract.name, { exact: true }) });
      await expect(card.locator('.el-tag')).toHaveText(contract.want);
    }
    const isoContract = drawer.locator('.employee-archive__contract-card').filter({ has: page.getByText('日期时间形式', { exact: true }) });
    for (const [label, date] of [['签订日期', '2025-01-02'], ['生效日期', '2025-01-01'], ['到期日期', '2026-11-02']]) {
      await expect(isoContract.locator('.employee-archive__facts > div').filter({ has: page.getByText(label, { exact: true }) }).locator('strong')).toHaveText(date);
    }
    await expect(drawer.getByText('有效', { exact: true })).toHaveCount(0);
    await drawer.locator('.el-drawer__body').evaluate(body => { body.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`contract-status-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });

  test(`${width}px 缺部门从离职进入现有档案审核并返回，不丢输入、不提前使用草稿部门`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page);
    await page.goto('/users');
    await page.getByRole('button', { name: '办理离职', exact: true }).filter({ visible: true }).click();
    const resignation = page.getByRole('dialog', { name: '办理离职', exact: true });
    await expect(resignation.locator('..')).not.toHaveClass(/enter-active/);
    await resignation.getByRole('combobox', { name: '最后工作日', exact: true }).fill('2026-11-20');
    await resignation.getByRole('combobox', { name: '最后工作日', exact: true }).press('Tab');
    await resignation.getByRole('textbox', { name: '离职原因', exact: true }).fill('合成离职原因，返回后仍保留');
    await expect(resignation.getByText('当前档案未设置部门，请先补充并审核生效后再提交离职。', { exact: true })).toBeVisible();
    await expect.poll(async () => (await resignation.boundingBox())?.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`resignation-missing-department-${width}.png`), fullPage: true });
    await resignation.getByRole('button', { name: '补充部门', exact: true }).click();
    const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
    await expect(archive).toBeVisible();
    await expect(resignation).not.toBeVisible();
    const departmentField = archive.locator('[data-archive-field="employee.deptId"]');
    await departmentField.getByRole('combobox').click();
    await page.getByRole('treeitem', { name: department.name, exact: true }).click();
    await archive.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect.poll(() => state.submissions.length).toBe(1);
    await archive.getByRole('tab', { name: '任职历史', exact: true }).click();
    await expect(archive.getByRole('button', { name: '新增任职记录', exact: true })).toBeDisabled();
    await archive.getByRole('button', { name: '返回离职办理', exact: true }).click();
    await expect(archive).not.toBeVisible();
    await expect(resignation).toBeVisible();
    await expect(resignation.getByRole('combobox', { name: '最后工作日', exact: true })).toHaveValue('2026-11-20');
    await expect(resignation.getByRole('textbox', { name: '离职原因', exact: true })).toHaveValue('合成离职原因，返回后仍保留');
    await expect(resignation.getByRole('textbox', { name: '当前部门', exact: true })).toHaveValue('未设置');
    await resignation.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect(page.getByText('员工档案缺少当前部门，暂不能提交', { exact: true })).toBeVisible();
    expect(state.resignations).toHaveLength(0);
    // 模拟既有审核流程批准后的正式档案响应，不将草稿等同于正式部门。
    state.officialDepartment = true;
    await resignation.getByRole('button', { name: '刷新部门', exact: true }).click();
    await expect(resignation.getByRole('textbox', { name: '当前部门', exact: true })).toHaveValue(department.name);
    await expect(resignation.getByRole('combobox', { name: '最后工作日', exact: true })).toHaveValue('2026-11-20');
    await resignation.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect.poll(() => state.resignations.length).toBe(1);
    expect(state.resignations[0]).toMatchObject({ deptId: department.id, leaveDate: '2026-11-20', reason: '合成离职原因，返回后仍保留', changeType: 'resignation' });
    await expect(resignation.getByText('待 HR 审核', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
