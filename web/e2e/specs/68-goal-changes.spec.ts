import { expect, test, type Page } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5193';
const envelope = (data: unknown) => ({ code: 0, message: 'success', data });
const original = {
  sourceInstanceId: 'instance-1', name: '交付质量与客户验收记录', description: null,
  scoringStandard: '按季度验收评分', targetValue: 12, targetValueText: null, unit: '项',
  weight: 1, indicatorType: 'kpi', dimensionName: '业务结果', dimensionWeight: 0.6, sortOrder: 7,
};
function row(id = 'change-a', taskId = 'task-self') {
  return { id, taskId, employeeId: id === 'change-a' ? 'employee' : 'team-employee',
    managerId: id === 'change-a' ? 'manager' : 'employee', canGrant: false, creatorId: 'employee', workflowIssue: null,
    employeeName: id === 'change-a' ? '合成员工' : '合成团队员工',
    cycleName: '合成季度', status: 'draft', revision: 4, creatorName: '合成发起人',
    reason: '业务范围调整', updatedAt: '2026-11-17T10:00:00Z', currentOwnerId: 'employee',
    allowedActions: ['edit', 'submit'] };
}
function detail(id = 'change-a', taskId = 'task-self') {
  return { ...row(id, taskId), beforeGoals: [{ ...original }], goals: [{ ...original }],
    protectedPeriodKeys: ['2026-10'], records: [{ id: 'record-1', action: 'create',
      actorName: '合成发起人', createdAt: '2026-11-17T10:00:00Z', newValue: null }] };
}
async function setup(page: Page, actor = 'employee', canGrant = false, isAssessorOnly = false) {
  const writes: Array<{ path: string; method: string; body: any }> = [];
  const tasks = [
    { id: 'task-self', cycleId: 'cycle-1', cycleName: '合成季度', employeeId: 'employee', employeeName: '合成员工',
      employeeNo: 'S001', managerId: 'manager', managerName: '冻结绩效上级', grant: { state: canGrant ? 'revoked' : 'open', revision: 3 },
      requestId: canGrant ? null : 'change-a', canStart: false, canGrant },
    { id: 'task-team', cycleId: 'cycle-1', cycleName: '合成季度', employeeId: 'team-employee', employeeName: '合成团队员工',
      employeeNo: 'S002', managerId: 'employee', managerName: '合成员工', grant: null, canStart: true, canGrant },
  ];
  let current = detail();
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-goal-change');
    localStorage.setItem('expiresAt', String(Date.now() + 3600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    let data: unknown = [];
    if (p === '/auth/me') data = { id: actor, name: '合成测试人', sysRole: canGrant ? 'hr_user' : 'employee',
      isAssessorOnly, hrCapabilities: canGrant ? ['cycle_plan_edit'] : [], businessCapabilities: { canManageTeam: false }, canViewAll: false };
    else if (p === '/tasks/mine' || p === '/goal-plans') data = { items: [], total: 0, page: 1, pageSize: 10 };
    else if (p === '/notifications/unread-count') data = 0;
    else if (p === '/goal-changes/context') data = { canGrant, tasks };
    else if (p === '/goal-changes/entry') data = { visible: !isAssessorOnly };
    else if (p === '/goal-changes/my-pending') data = [];
    else if (p === '/goal-changes/page') {
      const params = new URL(route.request().url()).searchParams;
      const scope = params.get('scope') || 'self';
      const all = [row(), row('change-b', 'task-team')];
      const filtered = all.filter(item => (scope === 'all' || scope === 'review'
        || (scope === 'self' ? item.employeeId === actor : item.managerId === actor && item.employeeId !== actor))
        && (!params.get('status') || item.status === params.get('status'))
        && (!params.get('keyword') || `${item.employeeName} ${item.cycleName} ${item.reason}`.includes(params.get('keyword')!)));
      const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 10);
      data = { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
    }
    else if (p.startsWith('/goal-changes') && method !== 'GET') {
      const body = route.request().postDataJSON();
      writes.push({ path: p, method, body });
      if (p === '/goal-changes') data = detail('change-new', body.taskId);
      else if (p.startsWith('/goal-changes/grants')) {
        tasks[0].grant = { state: p.endsWith('/revoke') ? 'revoked' : 'open', revision: tasks[0].grant!.revision + 1 };
        data = { canGrant, tasks };
      }
      else {
        current = { ...current, ...body, revision: current.revision + 1 };
        data = current;
      }
    } else if (p === '/goal-changes') data = [row(), row('change-b', 'task-team')];
    else if (p === '/goal-changes/change-a') data = current;
    else if (p.startsWith('/goal-changes/')) data = detail(p.split('/').pop(), 'task-team');
    return route.fulfill({ json: envelope(data) });
  });
  return { writes, tasks };
}
async function go(page: Page, path = '/goal-changes') { await page.goto(new URL(path, baseURL).href); }

test('goal change history requests only the selected server page and filters stale responses', async ({ page }) => {
  await setup(page);
  const requestedPages: number[] = [];
  await page.route('**/api/v1/goal-changes/page?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const currentPage = Number(params.get('page') || 1);
    requestedPages.push(currentPage);
    const items = Array.from({ length: 10 }, (_, index) => ({
      ...row(`change-${(currentPage - 1) * 10 + index}`),
      employeeId: 'employee', employeeName: `第${(currentPage - 1) * 10 + index + 1}位员工`,
    }));
    await route.fulfill({ json: envelope({ items, total: 25, page: currentPage, pageSize: 10 }) });
  });
  await go(page);
  await expect(page.locator('.el-table__body').getByText('第1位员工', { exact: true })).toBeVisible();
  await expect(page.locator('.el-table__body').getByText('第11位员工')).toHaveCount(0);
  await page.locator('.el-pagination').getByRole('listitem', { name: '第 2 页' }).click();
  await expect(page.locator('.el-table__body').getByText('第11位员工', { exact: true })).toBeVisible();
  await expect(page.locator('.el-table__body').getByText('第1位员工', { exact: true })).toHaveCount(0);
  expect(requestedPages).toContain(2);
});

for (const width of [1440, 390]) {
  test(`four performance sections keep one navigation baseline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, 'employee', true);
    const baselines: number[] = [];
    for (const path of ['/action-items', '/objectives', '/tasks', '/goal-changes']) {
      await go(page, path);
      const navigation = page.getByTestId('performance-secondary-nav');
      await expect(navigation, path).toBeVisible({ timeout: 15000 });
      const header = page.locator('.performance-workspace__header');
      await expect(header).toHaveCount(1);
      const headerBox = await header.boundingBox();
      const navigationBox = await navigation.boundingBox();
      expect(headerBox?.height).toBe(width === 390 ? 52 : 56);
      expect(navigationBox).not.toBeNull();
      if (path === '/action-items') await expect(header.getByTestId('goal-tracking-cycle')).toBeVisible();
      if (path === '/objectives') await expect(header.getByTestId('objective-map-cycle')).toBeVisible();
      if (path === '/tasks') await expect(header.getByTestId('task-cycle-filter')).toBeVisible();
      if (path === '/goal-changes') await expect(header.getByText('变更申请与记录')).toBeVisible();
      baselines.push(navigationBox!.y);
    }
    expect(Math.max(...baselines) - Math.min(...baselines)).toBeLessThanOrEqual(1);
  });
}

test('workspace exposes goal changes; self and frozen-team scopes keep their own rows', async ({ page }) => {
  await setup(page);
  await go(page);
  await expect(page.getByRole('link', { name: '目标变更', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开放变更', exact: true })).toHaveCount(0);
  const table = page.locator('.desktop-result-table');
  await expect(table.getByText('合成员工', { exact: true })).toBeVisible();
  await expect(table.getByText('合成团队员工', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '团队变更' }).click();
  await expect(table.getByText('合成团队员工', { exact: true })).toBeVisible();
  await expect(table.getByText('合成员工', { exact: true })).toHaveCount(0);
});

test('entry is hidden without a grant or history and remains for related history', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/goal-changes/entry', route => route.fulfill({ json: envelope({ visible: false }) }));
  await go(page, '/tasks');
  await expect(page.getByRole('link', { name: '目标变更', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/goal-changes/entry');
  await go(page, '/tasks');
  await expect(page.getByRole('link', { name: '目标变更', exact: true })).toBeVisible();
});

test('ordinary employee can open the read-only goal map', async ({ page }) => {
  await setup(page);
  await go(page, '/tasks');
  await expect(page.getByRole('link', { name: '目标地图', exact: true })).toBeVisible();
});

test('HR grant ledger is separate from applications and employee cannot open it', async ({ page }) => {
  await setup(page, 'hr', true);
  await go(page, '/goal-changes');
  await expect(page.getByRole('button', { name: '开放变更', exact: true })).toHaveCount(0);
  await go(page, '/goal-change-grants');
  await expect(page.getByText('按考核周期为员工开放目标变更')).toBeVisible();
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: envelope({
    id: 'employee', name: '合成员工', sysRole: 'employee', hrCapabilities: [], isAssessorOnly: false,
    businessCapabilities: { canManageTeam: false }, canViewAll: false,
  }) }));
  await go(page, '/goal-change-grants');
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const path of ['/tasks', '/action-items']) {
  test(`related user reaches changes from ${path}, while an unrelated assessor has no entry`, async ({ page }) => {
    await setup(page);
    await go(page, path);
    await expect(page.getByRole('link', { name: '目标变更', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '目标变更', exact: true }).click();
    await expect(page).toHaveURL(/\/goal-changes$/);
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: envelope({ id: 'assessor', name: '合成审核人',
      sysRole: 'employee', isAssessorOnly: true, businessCapabilities: { canManageTeam: false }, hrCapabilities: [] }) }));
    await page.route('**/api/v1/goal-changes/entry', route => route.fulfill({ json: envelope({ visible: false }) }));
    await go(page, path);
    await expect(page.getByTestId('performance-secondary-nav')).toBeVisible();
    await expect(page.getByRole('link', { name: '目标变更', exact: true })).toHaveCount(0);
  });
}

test('manager team and goal-plan modes expose one change entry, not for an unrelated assessor', async ({ page }) => {
  const { writes } = await setup(page);
  let isAssessorOnly = false;
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: envelope({
    id: 'employee', name: '合成冻结绩效上级', sysRole: 'employee', isAssessorOnly,
    businessCapabilities: { canManageTeam: true }, hrCapabilities: [], canViewAll: false,
  }) }));
  const paths = ['/tasks?scope=team&stage=manager-eval&taskId=team-entry',
    '/tasks?goalView=mine', '/tasks?goalView=review', '/tasks?goalView=monitor'];
  const topNavigation = page.getByRole('navigation', { name: '目标计划视图', exact: true });
  for (const path of paths) {
    await go(page, path);
    await expect(page.getByTestId('performance-secondary-nav')).toHaveCount(0);
    const entry = topNavigation.getByRole('button', { name: '目标变更', exact: true });
    await expect(entry).toBeVisible();
    await expect(page.getByRole('button', { name: '目标变更', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: '目标变更', exact: true })).toHaveCount(0);
    await entry.click();
    await expect(page).toHaveURL(/\/goal-changes$/);
  }
  await go(page, '/tasks?scope=team&stage=manager-eval');
  await expect(page.getByTestId('performance-secondary-nav')).toBeVisible();
  await expect(topNavigation.getByRole('button', { name: '目标变更', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '目标变更', exact: true })).toHaveCount(1);
  isAssessorOnly = true;
  await page.route('**/api/v1/goal-changes/entry', route => route.fulfill({ json: envelope({ visible: false }) }));
  for (const path of paths) {
    await go(page, path);
    await expect(topNavigation).toBeVisible();
    await expect(page.getByRole('button', { name: '目标变更', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '目标变更', exact: true })).toHaveCount(0);
  }
  expect(writes).toHaveLength(0);
});

test('dashboard improvement entries name the HR and leadership goal stages', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/improvement-plans/my-pending', route => route.fulfill({ json: envelope([
    { id: 'plan-hr', employeeName: '合成HR环节员工', status: 'goal_hr_review', targetDate: null },
    { id: 'plan-vp', employeeName: '合成领导环节员工', status: 'goal_vp_review', targetDate: null },
  ]) }));
  await go(page, '/dashboard');
  await expect(page.getByRole('link', { name: /合成HR环节员工.*HR确认/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /合成领导环节员工.*分管领导确认目标/ })).toBeVisible();
});

test('a returned manager-created change appears in both the dashboard and change pending tab', async ({ page }) => {
  await setup(page);
  const returned = { ...row('change-b', 'task-team'), creatorId: 'employee', status: 'revision',
    currentOwnerId: 'employee', allowedActions: ['edit', 'submit'] };
  await page.route('**/api/v1/goal-changes/my-pending', route => route.fulfill({ json: envelope([returned]) }));
  await go(page, '/dashboard');
  const dashboardEntry = page.getByRole('link', { name: /合成团队员工.*修改目标变更/ });
  await expect(dashboardEntry).toBeVisible();
  await dashboardEntry.click();
  await expect(page).toHaveURL(/\/goal-changes\/change-b$/);
  await go(page, '/goal-changes');
  await page.getByRole('tab', { name: '待我处理' }).click();
  await expect(page.locator('.desktop-result-table').getByText('合成团队员工', { exact: true })).toBeVisible();
});

for (const { actualUpdatedAt, retryAfterFailure } of [
  { actualUpdatedAt: undefined, retryAfterFailure: false },
  { actualUpdatedAt: '2026-11-17T10:01:00.000Z', retryAfterFailure: false },
  { actualUpdatedAt: '2026-11-17T10:01:00.000Z', retryAfterFailure: true },
]) {
test(`legacy self-evaluation uses ${actualUpdatedAt ? 'returned' : 'loaded'} task version ${retryAfterFailure ? 'on retry after failure' : 'after saving actual values'}`, async ({ page }) => {
  await setup(page);
  const requests: Array<{ method: string; body: any }> = [];
  const updatedAt = '2026-11-17T10:00:00.000Z';
  await page.route('**/api/v1/tasks/amended-legacy**', route => {
    const request = route.request();
    if (request.method() !== 'GET') {
      requests.push({ method: request.method(), body: request.postDataJSON() });
      if (retryAfterFailure && requests.length === 2) return route.fulfill({ status: 500, json: { message: '暂时无法提交自评' } });
      return route.fulfill({ json: envelope({ id: 'amended-legacy', status: 'manager_scoring', updatedCount: 1, updatedAt: actualUpdatedAt }) });
    }
    return route.fulfill({ json: envelope({ id: 'amended-legacy', cycleId: 'legacy-cycle', cycleName: '合成旧周期',
      employeeId: 'employee', employeeName: '合成员工', managerId: 'manager', managerName: '冻结绩效上级',
      deptId: 'dept', status: 'self_eval', isExempt: false, updatedAt,
      indicatorInstances: [{ ...original, id: 'amended-item', taskId: 'amended-legacy', actualValue: null,
        actualNote: null, selfScore: null, selfComment: null, visibilityScope: 'supervisors',
        visibleDepartmentIds: [], visibleUserIds: [], alignedObjectives: [] }], flowRecords: [] }) });
  });
  await page.route('**/api/v1/cycles/legacy-cycle', route => route.fulfill({ json: envelope({ id: 'legacy-cycle', name: '合成旧周期',
    workflowVersion: 1, scoringFrequency: 'cycle', status: 'self_eval', type: 'quarterly',
    startDate: '2026-10-01', endDate: '2026-12-31', publishVisibleFields: {} }) }));
  await go(page, '/tasks/amended-legacy?stage=self-eval');
  const card = page.getByTestId('self-eval-card').first();
  await card.getByPlaceholder('填写关键结果或完成比例').fill('完成验收');
  await card.getByPlaceholder('0-100').fill('90');
  await page.getByRole('button', { name: '检查并提交', exact: true }).click();
  await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].method).toBe('PUT');
  expect(requests[0].body.expectedUpdatedAt).toBe(updatedAt);
  expect(requests[1].body.expectedUpdatedAt).toBe(actualUpdatedAt ?? updatedAt);
  if (retryAfterFailure) {
    await expect(page.getByText('自评尚未提交，实际完成信息已保存，请稍后重试', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await page.getByRole('dialog', { name: '提交前检查' }).getByRole('button', { name: '确认提交', exact: true }).click();
    await expect.poll(() => requests.length).toBe(4);
    expect(requests[2].body.expectedUpdatedAt).toBe(actualUpdatedAt);
    expect(requests[3].body.expectedUpdatedAt).toBe(actualUpdatedAt);
  }
});
}

test('HR opens and revokes a task grant using the read revision and frozen manager', async ({ page }) => {
  const { writes } = await setup(page, 'hr', true);
  await go(page, '/goal-change-grants');
  await expect(page.getByText('冻结绩效上级', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开放变更', exact: true }).first().click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: '/goal-changes/grants', method: 'POST', body: { taskId: 'task-self', expectedRevision: 3 } });
  await page.getByRole('button', { name: '撤销授权', exact: true }).first().click();
  await expect(page.getByText('撤销授权会同时撤销办理中的变更申请', { exact: false })).toBeVisible();
  await page.getByRole('dialog', { name: '撤销变更授权' }).getByRole('button', { name: '撤销授权', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toEqual({ expectedRevision: 4 });
  expect(writes[1].path).toBe('/goal-changes/grants/task-self/revoke');
});

test('start uses the selected eligible task and opens the server-prepopulated draft', async ({ page }) => {
  const { writes } = await setup(page);
  await go(page);
  await page.getByRole('tab', { name: '团队变更' }).click();
  await page.getByRole('button', { name: '发起变更', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发起目标变更' });
  await dialog.getByRole('combobox', { name: '考核任务' }).click({ force: true });
  await page.getByRole('option', { name: /合成团队员工/ }).click();
  await dialog.getByRole('button', { name: '开始填写', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page).toHaveURL(/goal-changes\/change-new$/);
  expect(writes[0].body).toEqual({ taskId: 'task-team' });
  await expect(page.getByRole('textbox', { name: '目标名称 1' })).toHaveValue(original.name);
});

test('the header does not present a concurrency revision as a goal version', async ({ page }) => {
  await setup(page);
  await go(page, '/goal-changes/change-a');
  await expect(page.locator('.change-summary')).toContainText('合成发起人');
  await expect(page.locator('.change-summary')).not.toContainText('版本');
});

test('edit converts percentages, preserves hidden metadata and submits the newly saved revision', async ({ page }) => {
  const { writes } = await setup(page);
  await go(page, '/goal-changes/change-a');
  const drawer = page.getByTestId('business-detail-drawer');
  await expect(drawer.getByText('变更前', { exact: true })).toBeVisible();
  await expect(drawer.getByText('2026-10', { exact: false })).toBeVisible();
  await drawer.getByRole('textbox', { name: '目标名称 1' }).fill('调整后的交付质量');
  await drawer.getByRole('spinbutton', { name: '目标权重 1' }).fill('75');
  await drawer.getByRole('button', { name: '添加目标', exact: true }).click();
  await drawer.getByRole('textbox', { name: '目标名称 2' }).fill('新增交付目标');
  await drawer.getByRole('spinbutton', { name: '目标权重 2' }).fill('25');
  await drawer.getByRole('textbox', { name: '变更原因' }).fill('新业务范围');
  await drawer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: '/goal-changes/change-a', method: 'PATCH', body: {
    expectedRevision: 4, reason: '新业务范围', goals: [{ ...original, name: '调整后的交付质量', weight: 0.75 },
      { sourceInstanceId: null, name: '新增交付目标', description: null, scoringStandard: null, targetValue: null,
        targetValueText: null, unit: null, weight: 0.25, indicatorType: 'kpi', dimensionName: '业务结果', dimensionWeight: 0.6, sortOrder: 8 }],
  } });
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ path: '/goal-changes/change-a/submit', method: 'POST', body: { expectedRevision: 5, reason: '新业务范围' } });
});

test('delete retains the original in the diff; total weight must equal 100 percent', async ({ page }) => {
  const { writes } = await setup(page);
  await go(page, '/goal-changes/change-a');
  await page.getByRole('button', { name: '删除目标 1', exact: true }).click();
  await expect(page.getByTestId('goal-change-before')).toContainText(original.name);
  await expect(page.getByTestId('goal-change-before')).toContainText('已删除');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('至少保留一项目标', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: '添加目标', exact: true }).click();
  await page.getByRole('textbox', { name: '目标名称 1' }).fill('替换后的目标');
  await page.getByRole('spinbutton', { name: '目标权重 1' }).fill('80');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(/权重合计必须为 100%/)).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('spinbutton', { name: '目标权重 1' }).fill('100');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.goals).toHaveLength(1);
  expect(writes[0].body.goals[0]).toMatchObject({ sourceInstanceId: null, weight: 1, description: null });
});

test('field errors stop invalid edits; failed save keeps input and explicit error', async ({ page }) => {
  const { writes } = await setup(page);
  await go(page, '/goal-changes/change-a');
  await page.getByRole('textbox', { name: '变更原因' }).fill('');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('请填写变更原因', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('textbox', { name: '变更原因' }).fill('保留这段输入');
  await page.route('**/api/v1/goal-changes/change-a', (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, json: { message: '版本已更新' } }) : route.fallback());
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('goal-change-write-error')).toContainText('版本');
  await expect(page.getByRole('textbox', { name: '变更原因' })).toHaveValue('保留这段输入');
  await expect(page.getByRole('button', { name: '重新加载详情', exact: true })).toBeVisible();
});

test('employee confirmation is approval only, including return reason and expected revision', async ({ page }) => {
  const { writes } = await setup(page);
  await page.route('**/api/v1/goal-changes/change-a', (route) => route.fulfill({ json: envelope({
    ...detail(), status: 'indicator_confirming', allowedActions: ['decide'],
  }) }));
  await go(page, '/goal-changes/change-a');
  await expect(page.getByRole('textbox', { name: '目标名称 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '退回修改', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '退回修改' });
  await dialog.getByRole('button', { name: '退回发起人', exact: true }).click();
  await expect(dialog.getByText('请填写退回原因', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: '审核意见' }).fill('请补充交付标准');
  await dialog.getByRole('button', { name: '退回发起人', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toEqual({ expectedRevision: 4, approve: false, comment: '请补充交付标准' });
});

test('history uses frozen row actors even when no tasks are eligible', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/goal-changes/context', route => route.fulfill({ json: envelope({ canGrant: false, tasks: [] }) }));
  await go(page);
  await expect(page.locator('.desktop-result-table').getByText('合成员工', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '团队变更' }).click();
  await expect(page.locator('.desktop-result-table').getByText('合成团队员工', { exact: true })).toBeVisible();
});

test('HR task selection excludes cycles without per-task grant permission', async ({ page }) => {
  const { tasks } = await setup(page, 'hr', true);
  await page.route('**/api/v1/goal-changes/context', route => route.fulfill({ json: envelope({ canGrant: true,
    tasks: [tasks[0], { ...tasks[1], cycleId: 'other-cycle', cycleName: '无管理权限周期', canGrant: false }] }) }));
  await go(page, '/goal-change-grants');
  await expect(page.getByText('合成季度', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('无管理权限周期', { exact: true })).toHaveCount(0);
});

test('dirty submit writes content and transition once without a draft save', async ({ page }) => {
  const { writes } = await setup(page);
  await go(page, '/goal-changes/change-a');
  await page.getByRole('textbox', { name: '变更原因' }).fill('直接提交修改');
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ path: '/goal-changes/change-a/submit', method: 'POST', body: { expectedRevision: 4, reason: '直接提交修改' } });
});

test('submitted change shows one business submission node despite draft audit events', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/goal-changes/change-a', route => route.request().method() === 'GET'
    ? route.fulfill({ json: envelope({ ...detail(), status: 'indicator_reviewing', allowedActions: [], records: [
      { id: 'r1', action: 'create', actorName: '合成员工', createdAt: '2026-11-17T10:00:00Z' },
      { id: 'r2', action: 'save_draft', actorName: '合成员工', createdAt: '2026-11-17T10:01:00Z' },
      { id: 'r3', action: 'submit', actorName: '合成员工', createdAt: '2026-11-17T10:02:00Z' },
    ] }) }) : route.fallback());
  await go(page, '/goal-changes/change-a');
  const records = page.locator('.records');
  await expect(records.getByText('目标变更提交 · 合成员工 · 提交目标变更')).toBeVisible();
  await expect(records.locator('.el-timeline-item')).toHaveCount(1);
});

test('read-only change summarizes changed goals and names employee confirmation in history', async ({ page }) => {
  await setup(page);
  const updated = { ...original, name: '调整后的交付目标', weight: 1 };
  await page.route('**/api/v1/goal-changes/change-a', route => route.request().method() === 'GET'
    ? route.fulfill({ json: envelope({ ...detail(), status: 'active', allowedActions: [], goals: [updated], records: [
      { id: 'r1', action: 'approve', actorName: '合成员工', createdAt: '2026-11-18T10:00:00Z', newValue: { previousStatus: 'indicator_confirming' } },
      { id: 'r2', action: 'submit', actorName: '合成员工', createdAt: '2026-11-17T10:00:00Z', newValue: {} },
    ] }) }) : route.fallback());
  await go(page, '/goal-changes/change-a');
  await expect(page.getByRole('region', { name: '变更摘要' })).toContainText('调整 1 项');
  await expect(page.getByText('调整 · 调整后的交付目标')).toBeVisible();
  await expect(page.locator('.records .el-timeline-item').first()).toContainText('员工确认 · 合成员工 · 员工确认');
  await expect(page.getByText('查看完整目标对比')).toBeVisible();
});

test('zero-weight veto metadata survives save, and backend workflow warning keeps HR revoke', async ({ page }) => {
  const { writes } = await setup(page);
  const veto = { ...original, sourceInstanceId: 'veto-1', name: '否决事项', weight: 0, indicatorType: 'veto' };
  await page.route('**/api/v1/goal-changes/change-a', route => route.request().method() === 'GET'
    ? route.fulfill({ json: envelope({ ...detail(), goals: [original, veto], beforeGoals: [original, veto] }) }) : route.fallback());
  await go(page, '/goal-changes/change-a');
  await page.getByRole('textbox', { name: '变更原因' }).fill('保留否决项');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.goals[1]).toEqual(veto);
  await page.route('**/api/v1/goal-changes/change-a', route => route.fulfill({ json: envelope({ ...detail(),
    workflowIssue: '已无尚未提交自评或评分的月份，不能变更目标', allowedActions: ['revoke'] }) }));
  await page.reload();
  await expect(page.getByTestId('goal-change-workflow-issue')).toContainText('已无尚未提交');
  await expect(page.getByRole('button', { name: '撤销变更', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审核', exact: true })).toHaveCount(0);
});

test('409 shows the backend business reason instead of assuming stale revision', async ({ page }) => {
  await setup(page);
  await go(page, '/goal-changes/change-a');
  await page.route('**/api/v1/goal-changes/change-a', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, json: { message: '员工已不在本周期有效参与范围' } }) : route.fallback());
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('goal-change-write-error')).toContainText('员工已不在本周期有效参与范围');
  await expect(page.getByTestId('goal-change-write-error')).not.toContainText('版本已更新');
});

test('rejected validation preserves edits and allows correction without reloading', async ({ page }) => {
  const { writes } = await setup(page);
  let rejected = false;
  await page.route('**/api/v1/goal-changes/change-a', route => {
    if (route.request().method() !== 'PATCH' || rejected) return route.fallback();
    rejected = true;
    return route.fulfill({ status: 400, json: { message: '目标内容格式或长度不合法' } });
  });
  await go(page, '/goal-changes/change-a');
  await page.getByRole('textbox', { name: '变更原因' }).fill('保留待修正原因');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('goal-change-write-error')).toContainText('目标内容格式或长度不合法');
  await expect(page.getByRole('textbox', { name: '变更原因' })).toHaveValue('保留待修正原因');
  await page.getByRole('textbox', { name: '目标名称 1' }).fill('修正后的目标');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ expectedRevision: 4, reason: '保留待修正原因', goals: [{ name: '修正后的目标' }] });
  await expect(page.getByTestId('goal-change-write-error')).toHaveCount(0);
});

test('new targets can only choose original dimension and type combinations', async ({ page }) => {
  const { writes } = await setup(page);
  const attitude = { ...original, sourceInstanceId: 'attitude-1', name: '协作态度', weight: 0,
    dimensionName: '团队协作', dimensionWeight: 0.4, indicatorType: 'attitude' };
  await page.route('**/api/v1/goal-changes/change-a', route => route.request().method() === 'GET'
    ? route.fulfill({ json: envelope({ ...detail(), goals: [original, attitude], beforeGoals: [original, attitude] }) }) : route.fallback());
  await go(page, '/goal-changes/change-a');
  await expect(page.getByRole('combobox', { name: '目标维度 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '添加目标', exact: true }).click();
  await page.getByRole('textbox', { name: '目标名称 3' }).fill('新增协作目标');
  await page.getByRole('combobox', { name: '目标维度 3', exact: true }).click({ force: true });
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: /团队协作/ }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.goals[0]).toEqual(original);
  expect(writes[0].body.goals[1]).toEqual(attitude);
  expect(writes[0].body.goals[2]).toMatchObject({ sourceInstanceId: null, dimensionName: '团队协作', dimensionWeight: 0.4, indicatorType: 'attitude' });
});

test('busy direct submit blocks navigation and uses the original revision', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const submissions: any[] = [];
  await page.route('**/api/v1/goal-changes/change-a/submit', async route => {
    submissions.push(route.request().postDataJSON());
    await hold;
    return route.fulfill({ json: envelope({ ...detail(), reason: '等待保存', revision: 19 }) });
  });
  await go(page);
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('textbox', { name: '变更原因' }).fill('等待保存');
  const saveStarted = page.waitForRequest(request => request.url().endsWith('/submit') && request.method() === 'POST');
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await saveStarted;
  await page.goBack();
  await expect(page).toHaveURL(/change-a$/);
  await expect(page.getByText('正在办理，请稍候', { exact: true })).toBeVisible();
  release();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ expectedRevision: 4, reason: '等待保存' });
});

test('cancelled grant revocation cannot write', async ({ page }) => {
  const { writes, tasks } = await setup(page, 'hr', true);
  tasks[0].grant = { state: 'open', revision: 3 };
  await go(page, '/goal-change-grants');
  await page.getByRole('button', { name: '撤销授权', exact: true }).first().click();
  await page.getByRole('dialog', { name: '撤销变更授权' }).getByRole('button', { name: '保留授权', exact: true }).click();
  expect(writes).toHaveLength(0);
});

test('closing the detail never loads an undefined record', async ({ page }) => {
  await setup(page);
  const invalidReads: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/goal-changes/undefined')) invalidReads.push(request.url()); });
  await go(page);
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '目标名称 1' })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('business-detail-drawer')).toHaveCount(0);
  expect(invalidReads).toHaveLength(0);
});

test('relevant review queue and action visibility use allowedActions, not global role', async ({ page }) => {
  await setup(page, 'reviewer');
  await page.route('**/api/v1/goal-changes/my-pending', (route) => route.fulfill({ json: envelope([
    { ...row('review', 'unknown-task'), status: 'indicator_reviewing', allowedActions: ['decide'] },
    { ...row('read-only', 'another-task'), status: 'active', allowedActions: [] },
  ]) }));
  await go(page);
  await page.getByRole('tab', { name: '待我审核' }).click();
  await expect(page.getByRole('button', { name: '查看', exact: true })).toHaveCount(1);
});

test('context and list failures are retryable, never shown as empty success', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/goal-changes/context', (route) => route.fulfill({ status: 403, json: { message: '无权限' } }));
  await page.route('**/api/v1/goal-changes/page*', (route) => route.fulfill({ status: 500, json: { message: '读取失败' } }));
  await go(page);
  await expect(page.getByTestId('goal-change-context-error')).toContainText('无权');
  await expect(page.getByTestId('goal-change-list-error')).toContainText('失败');
  await expect(page.getByText('暂无目标变更', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/goal-changes/context');
  await page.unroute('**/api/v1/goal-changes/page*');
  await page.getByRole('button', { name: '重试任务范围', exact: true }).click();
  await page.getByRole('button', { name: '重试变更列表', exact: true }).click();
  await expect(page.getByTestId('goal-change-context-error')).toHaveCount(0);
  await expect(page.getByTestId('goal-change-list-error')).toHaveCount(0);
});

test('late detail response cannot replace another routed record', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/goal-changes/change-a', async (route) => {
    await hold;
    await route.fulfill({ json: envelope(detail()) });
  });
  await go(page);
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page).toHaveURL(/change-a$/);
  await page.goBack();
  await page.getByRole('tab', { name: '团队变更' }).click();
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByTestId('goal-change-detail')).toContainText('合成团队员工');
  release();
  await expect(page.getByRole('textbox', { name: '目标名称 1' })).toHaveValue(original.name);
  await expect(page.getByTestId('goal-change-detail')).not.toContainText('合成员工 ·');
});

test('unsaved edits protect close and browser back; direct URL and reload work', async ({ page }) => {
  await setup(page);
  await go(page, '/goal-changes/change-a');
  await page.reload();
  await page.getByRole('textbox', { name: '变更原因' }).fill('未保存原因');
  await page.getByTestId('business-detail-drawer').getByRole('button', { name: '关闭此对话框' }).click();
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page).toHaveURL(/change-a$/);
  await page.getByTestId('business-detail-drawer').getByRole('button', { name: '关闭此对话框' }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page).toHaveURL(/\/goal-changes$/);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`goal changes fit ${viewport.width}px with usable diff and fixed actions`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await go(page);
    const mobile = viewport.width === 390;
    await expect(page.locator(mobile ? '.mobile-result-list' : '.desktop-result-table')).toBeVisible();
    await page.getByRole('button', { name: '查看', exact: true }).click();
    const drawer = page.getByTestId('business-detail-drawer');
    await expect(drawer.getByRole('textbox', { name: '目标名称 1' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: '删除目标 1', exact: true }).locator('svg')).toHaveCount(1);
    await expect.poll(async () => {
      const box = await drawer.boundingBox();
      return Boolean(box && box.x >= -1 && box.x + box.width <= viewport.width + 1);
    }).toBe(true);
    await expect(drawer.getByRole('button', { name: '保存草稿', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`goal-changes-${viewport.width}.png`) });
  });
}
