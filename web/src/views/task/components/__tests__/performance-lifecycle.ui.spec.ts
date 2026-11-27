import { expect, test, type Page } from '@playwright/test';

const stamp = '2037-01-01T00:00:00.000Z';
const fixtures = {
  task: { id: 'fictional-task', employeeName: '虚构员工', deptName: '虚构部门', cycleName: '虚构周期',
    status: 'indicator_setting', currentStep: 'employee_drafting', currentHandlerName: '虚构员工', indicatorInstances: [], flowRecords: [] },
  goal_change: { id: 'fictional-change', taskId: 'fictional-task', employeeName: '虚构员工', cycleName: '虚构周期', creatorName: '虚构发起人',
    status: 'draft', revision: 4, reason: '原变更原因', goals: [], beforeGoals: [], records: [], protectedPeriodKeys: [], workflowIssue: null },
  improvement_plan: { id: 'fictional-plan', employeeId: 'fictional-employee', employeeName: '虚构员工', cycleName: '虚构周期',
    status: 'completed', revision: 4, workflowVersion: 3, goals: [], measures: [], records: [], finalScore: 87,
    completedAt: stamp, improvementNeed: '保留的改进背景', selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null },
  confirmation: { id: 'fictional-confirmation', employeeId: 'fictional-employee', employee: { name: '虚构员工' },
    status: 'approved', workflowVersion: 2, submissionVersion: 2, actualRegularDate: '2037-01-01',
    summary: '保留的工作小结', history: [], steps: [], roster: {}, canApprove: false,
    voteResult: 'pass', canViewInternalMeeting: true, hrId: 'fictional-manager', meetingDate: null },
};
type Kind = keyof typeof fixtures;
const paths: Record<Kind, string> = { task: '/tasks', goal_change: '/goal-changes', improvement_plan: '/improvement-plans', confirmation: '/confirmation-manage' };
const endpoints: Record<Kind, string> = { task: '/goal-plans', goal_change: '/goal-changes/page', improvement_plan: '/improvement-plans', confirmation: '/confirmation-applications' };
const envelope = (data: unknown) => ({ code: 0, data });

async function setup(page: Page, kind: Kind, options: { lastPage?: boolean; list?: boolean; conflict?: boolean; denied?: boolean; ended?: boolean; editable?: boolean; revoke?: boolean; viewer?: boolean; lifecycleViewer?: boolean; mine?: boolean; direct?: 'goal' | 'employee-period' | 'manager-period' | 'result' } = {}) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [], queries: URLSearchParams[] = [], lifecycleReads: string[] = [];
  let lifecycle = { lifecycleStatus: options.ended ? 'terminated' : 'active', lifecycleVersion: 2, updatedAt: stamp,
    terminatedAt: options.ended ? stamp : null, terminatedById: null, terminationReason: options.ended ? '虚构终止原因' : null,
    deletedAt: null as string | null, deletedById: null, deletionReason: null as string | null,
    allowedActions: options.denied ? [] : [...(options.editable ? ['edit', 'submit', 'submit_goals'] : []),
      options.ended || (!options.editable && ['improvement_plan', 'confirmation'].includes(kind)) ? 'lifecycle_delete' : 'lifecycle_terminate'] };
  let attempts = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '');
    if (path.startsWith('/performance-lifecycle/')) {
      if (request.method() === 'GET') lifecycleReads.push(path);
      if (request.method() === 'POST') {
        writes.push({ path, body: request.postDataJSON() }); attempts++;
        if (options.revoke) {
          lifecycle.allowedActions = [];
          return route.fulfill({ status: 403, json: { message: '无权执行此操作' } });
        }
        if (options.conflict && attempts === 1) {
          lifecycle = { ...lifecycle, lifecycleVersion: 3, updatedAt: '2037-01-02T00:00:00.000Z' };
          return route.fulfill({ status: 409, json: { message: '记录已变化，请重新核对' } });
        }
        lifecycle = { ...lifecycle, lifecycleVersion: lifecycle.lifecycleVersion + 1,
          lifecycleStatus: path.endsWith('/delete') ? 'deleted' : 'terminated', allowedActions: [],
          terminationReason: String(request.postDataJSON().reason), deletionReason: String(request.postDataJSON().reason) };
      }
      return route.fulfill({ json: envelope({ ...lifecycle, events: options.ended ? [{ id: 'fictional-audit',
        action: 'lifecycle_terminated', createdAt: stamp, actorName: '虚构经办人', reason: '审计中的虚构办理原因' }] : [] }) });
    }
    const period = { id: 'fictional-period', taskId: fixtures.task.id, periodKey: '2037-01', periodType: 'month', sequence: 1,
      status: options.direct === 'manager-period' ? 'manager_scoring' : 'self_eval', employeeSubmittedAt: null, managerSubmittedAt: null,
      periodStart: '2037-01-01', periodEnd: '2037-01-31', selfEvalDueAt: stamp, managerDueAt: stamp, draftVersion: 0,
      selfScoreTotal: null, managerScoreTotal: null, selfGrade: 'B', managerGrade: 'B', attachments: [] };
    const taskFields = options.direct ? { cycleId: 'fictional-cycle', employeeId: options.direct === 'manager-period' ? 'fictional-employee' : 'fictional-manager',
      managerId: options.direct === 'manager-period' ? 'fictional-manager' : 'fictional-other', isExempt: false, goalWorkflowVersion: 2,
      status: options.direct === 'goal' ? 'indicator_drafting' : options.direct === 'result' ? 'approval' : period.status,
      approvedAt: options.direct === 'result' ? stamp : null, workflowVersion: options.direct.includes('period') ? 2 : 1,
      selfEvalSummary: '保留的员工自评', gradeResult: { calculatedScore: 87, rawGrade: 'B' },
      periods: options.direct.includes('period') ? [period] : [],
      indicatorInstances: [{ id: 'fictional-indicator', name: '保留的目标快照', description: '原目标说明', indicatorType: 'kpi',
        weight: 1, dimensionWeight: 1, visibilityScopes: ['department'], visibleDepartmentIds: [], visibleUserIds: [], alignedObjectives: [], alignedParentIndicators: [] }],
    } : {};
    const item = { ...fixtures[kind], ...lifecycle, ...(options.editable ? { status: 'draft' } : {}), ...taskFields,
      ...(options.lifecycleViewer ? { canViewInternalMeeting: false } : {}) };
    if (path === '/assessment-periods/fictional-period/review') return route.fulfill({ json: envelope({ period,
      context: { cycleName: '虚构周期', employeeName: '虚构员工', managerName: '虚构上级', statusLabel: '原评分环节' },
      permissions: { canEditEmployee: true, canEditManager: true }, indicators: [] }) });
    if (path === '/cycles/fictional-cycle') return route.fulfill({ json: envelope({ id: 'fictional-cycle', name: '虚构周期', goalWorkflowVersion: 2 }) });
    if (path === (options.mine ? '/confirmation-applications/mine' : endpoints[kind])) {
      queries.push(url.searchParams);
      if (options.lastPage) {
        const current = Number(url.searchParams.get('page') ?? 1), total = lifecycle.lifecycleStatus === 'deleted' ? 10 : 11;
        const items = current === 1 ? Array.from({ length: 10 }, (_, n) => ({ ...item, id: `first-page-${n}`,
          lifecycleStatus: 'active', deletedAt: null, allowedActions: ['lifecycle_delete'] })) : total === 11 ? [item] : [];
        return route.fulfill({ json: envelope({ items, total, page: current, pageSize: 10 }) });
      }
      return route.fulfill({ json: envelope({ items: [item], total: 1, page: 1, pageSize: 10 }) });
    }
    if (path.endsWith(`/${fixtures[kind].id}`)) return route.fulfill({ json: envelope(item) });
    if (path === '/goal-changes/context') return route.fulfill({ json: envelope({ canGrant: false, tasks: [] }) });
    if (path === '/goal-plans/options') return route.fulfill({ json: envelope({ cycles: [], departments: [] }) });
    return route.fulfill({ json: envelope(path.includes('/tasks') ? { items: [], total: 0 } : []) });
  });
  const path = (options.mine ? '/confirmation-mine' : paths[kind]) + (options.list ? '' : `/${fixtures[kind].id}`)
    + (options.direct ? `?stage=${options.direct === 'goal' ? 'goal-setting' : options.direct === 'result' ? 'result' : 'self-eval'}` : '');
  await page.goto(`/src/views/task/components/__tests__/performance-lifecycle.harness.html?path=${encodeURIComponent(path)}&role=${options.viewer ? 'viewer' : options.lifecycleViewer ? 'lifecycle-viewer' : 'manager'}${options.direct ? '&direct=true' : ''}`);
  return { writes, queries, lifecycleReads };
}

test('deleting the sole improvement plan on the last page returns to a valid page without resetting filters', async ({ page }) => {
  const { queries } = await setup(page, 'improvement_plan', { list: true, lastPage: true });
  await page.locator('.el-pager li').filter({ hasText: /^2$/ }).click();
  await expect.poll(() => queries[queries.length - 1]?.get('page')).toBe('2');
  const control = page.locator('.lifecycle-actions--compact:visible').first();
  await control.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除记录', exact: true });
  await dialog.getByRole('textbox', { name: '操作原因', exact: true }).fill('末页删除虚构验收');
  await dialog.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => queries[queries.length - 1]?.get('page')).toBe('1');
  await expect(page.locator('.lifecycle-actions--compact:visible')).toHaveCount(10);
});

for (const kind of Object.keys(fixtures) as Kind[]) {
  for (const width of [1440, 1024, 390]) {
  test(`${kind} list operation offers the authorized lifecycle action without navigating to details at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { writes, lifecycleReads } = await setup(page, kind, { list: true });
    const operation = ['improvement_plan', 'confirmation'].includes(kind) ? '删除' : '终止';
    const controls = page.locator('.lifecycle-actions--compact:visible').first();
    await expect(controls.getByRole('button', { name: operation, exact: true })).toBeVisible();
    expect(lifecycleReads).toHaveLength(0);
    await controls.getByRole('button', { name: operation, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: operation === '删除' ? '删除记录' : '终止流程', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: '操作原因', exact: true }).fill('列表内核定的虚构办理原因');
    await dialog.getByRole('button', { name: operation === '删除' ? '删除记录' : '终止流程', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe(`/performance-lifecycle/${kind}/${fixtures[kind].id}/${operation === '删除' ? 'delete' : 'terminate'}`);
    expect(writes[0].body).toEqual({ expectedUpdatedAt: stamp, expectedLifecycleVersion: 2, reason: '列表内核定的虚构办理原因' });
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  }

  test(`${kind} list hides lifecycle actions from a viewer`, async ({ page }) => {
    const { writes, lifecycleReads } = await setup(page, kind, { list: true, denied: true });
    await expect(page.getByRole('button', { name: /^(终止|删除)$/ })).toHaveCount(0);
    expect(writes).toHaveLength(0); expect(lifecycleReads).toHaveLength(0);
  });
}

test('ended list rows do not eagerly load an audit request for every compact control', async ({ page }) => {
  const { lifecycleReads } = await setup(page, 'task', { list: true, ended: true });
  const controls = page.locator('.lifecycle-actions--compact:visible').first();
  await expect(controls.getByRole('button', { name: '删除', exact: true })).toBeVisible();
  expect(lifecycleReads).toHaveLength(0);
  await controls.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除记录', exact: true })).toBeVisible();
  expect(lifecycleReads).toHaveLength(1);
});

for (const kind of Object.keys(fixtures) as Kind[]) {
  test(`${kind} list retains existing scope and adds server lifecycle filter`, async ({ page }) => {
    const { queries } = await setup(page, kind, { list: true });
    const select = page.getByRole('combobox', { name: '记录范围', exact: true });
    await expect(select).toBeVisible();
    await select.focus(); await select.press('Enter');
    await page.getByRole('option', { name: '历史记录（含已删除）', exact: true }).click();
    if (['improvement_plan', 'confirmation'].includes(kind)) await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect.poll(() => queries[queries.length - 1]?.get('lifecycleStatus')).toBe('all');
    if (kind === 'task') expect(queries[queries.length - 1]?.get('scope')).toBe('monitor');
    if (kind === 'goal_change') expect(queries[queries.length - 1]?.get('scope')).toBe('self');
    if (kind === 'task') await expect(page.getByText('目标台账 · 目标内容与审批进度')).toBeVisible();
  });

  test(`${kind} only API-authorized action requires reason and preserves snapshots`, async ({ page }) => {
    const { writes } = await setup(page, kind);
    const action = ['improvement_plan', 'confirmation'].includes(kind) ? '删除记录' : '终止流程';
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action, exact: true });
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(dialog.getByText('请填写操作原因', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    await dialog.getByRole('textbox', { name: '操作原因', exact: true }).fill('  虚构验收原因  ');
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toEqual({ expectedUpdatedAt: stamp, expectedLifecycleVersion: 2, reason: '虚构验收原因' });
    expect(writes[0].path).toBe(`/performance-lifecycle/${kind}/${fixtures[kind].id}/${action === '删除记录' ? 'delete' : 'terminate'}`);
    await expect(dialog).toBeHidden();
    if (kind === 'improvement_plan') await expect(page.getByText('最终综合分：87')).toBeVisible();
    if (kind === 'confirmation') await expect(page.getByText('保留的工作小结', { exact: true })).toBeVisible();
  });

  test(`${kind} viewer is not given management actions`, async ({ page }) => {
    const { writes } = await setup(page, kind, { denied: true });
    await expect(page.getByRole('button', { name: '终止流程', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '删除记录', exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(0);
  });
}

test('terminated confirmation has no mutable meeting backfill and keeps the approved date', async ({ page }) => {
  await setup(page, 'confirmation', { ended: true });
  await expect(page.getByRole('button', { name: '保存会议日期', exact: true })).toHaveCount(0);
  await expect(page.getByText('2037-01-01', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('虚构终止原因', { exact: false })).toBeVisible();
});

for (const kind of ['goal_change', 'improvement_plan'] as const) {
  test(`${kind} unsaved edits block destructive lifecycle management`, async ({ page }) => {
    const { writes } = await setup(page, kind, { editable: true });
    const input = page.getByRole('textbox', { name: kind === 'goal_change' ? '变更原因' : '改进背景', exact: true });
    await input.fill('仍未保存的虚构修改');
    await expect(page.getByRole('button', { name: '终止流程', exact: true })).toBeDisabled();
    expect(writes).toHaveLength(0);
    await expect(input).toHaveValue('仍未保存的虚构修改');
  });
}

test('revocation rejects a previously authorized action without losing its reason', async ({ page }) => {
  const { writes } = await setup(page, 'task', { revoke: true });
  await page.getByRole('button', { name: '终止流程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '终止流程', exact: true });
  await dialog.getByRole('textbox', { name: '操作原因', exact: true }).fill('撤权前填写的虚构原因');
  await dialog.getByRole('button', { name: '终止流程', exact: true }).click();
  await expect(dialog.getByText('无权执行此操作，请重新核对权限')).toBeVisible();
  await dialog.getByRole('button', { name: '重新核对记录', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '终止流程', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: '操作原因', exact: true })).toHaveValue('撤权前填写的虚构原因');
  expect(writes).toHaveLength(1);
});

test('original participant can request history without gaining global management', async ({ page }) => {
  await setup(page, 'task', { list: true, viewer: true, denied: true });
  const select = page.getByRole('combobox', { name: '记录范围', exact: true });
  await select.focus(); await select.press('Enter');
  await expect(page.getByRole('option', { name: '历史记录（含已删除）', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '已删除', exact: true })).toBeVisible();
});

test('employee confirmation history stays in mine scope and ended drafts are not editable', async ({ page }) => {
  const { queries } = await setup(page, 'confirmation', { mine: true, list: true, viewer: true, denied: true, ended: true, editable: true });
  await expect(page.getByRole('button', { name: '继续填写', exact: true })).toHaveCount(0);
  const select = page.getByRole('combobox', { name: '记录范围', exact: true });
  await select.focus(); await select.press('Enter');
  await page.getByRole('option', { name: '历史记录（含已删除）', exact: true }).click();
  await expect.poll(() => queries[queries.length - 1]?.get('lifecycleStatus')).toBe('all');
});

test('ended record exposes the original authorized actor and reason in its retained audit timeline', async ({ page }) => {
  await setup(page, 'task', { ended: true });
  await page.locator('.lifecycle-history summary').click();
  await expect(page.locator('.lifecycle-history')).toContainText('虚构经办人');
  await expect(page.locator('.lifecycle-history')).toContainText('审计中的虚构办理原因');
});

test('lifecycle-only confirmation viewer reads management metadata but gains no HR-internal content', async ({ page }) => {
  const { queries } = await setup(page, 'confirmation', { list: true, lifecycleViewer: true, denied: true });
  await expect.poll(() => queries.length).toBe(1);
  await page.locator('.desktop-result-table').getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByText('保留的工作小结', { exact: true })).toBeVisible();
  await expect(page.getByText('线下评议记录（内部）', { exact: true })).toHaveCount(0);
  await expect(page.getByText('转正后薪资', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '办理', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('confirmation-attention-trigger')).toHaveCount(0);
});

for (const stage of ['goal', 'employee-period', 'manager-period', 'result'] as const) {
  test(`original task ${stage} is read-only after termination and retains visible facts`, async ({ page }) => {
    await setup(page, 'task', { ended: true, direct: stage });
    await expect(page.getByTestId('personal-performance-detail')).toBeVisible();
    await expect(page.getByRole('button', { name: /提交上级审核|提交自评|提交评分|确认结果|进入整周期结果评定|催办/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
    await expect(page.getByText('虚构终止原因', { exact: false })).toBeVisible();
    if (stage === 'goal') await expect(page.getByText('保留的目标快照', { exact: true }).first()).toBeVisible();
    if (stage === 'result') await expect(page.getByText('87', { exact: true })).toBeVisible();
    const editableInputs = page.locator('.performance-detail__main').locator('input:not([disabled]):not([readonly]):not([type=hidden]), textarea:not([disabled]):not([readonly])');
    await expect(editableInputs).toHaveCount(0);
  });
}

for (const width of [1440, 1024, 390]) {
  test(`conflict retains reason, refreshes exact version and fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { writes } = await setup(page, 'task', { conflict: true });
    await page.getByRole('button', { name: '终止流程', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '终止流程', exact: true });
    await dialog.getByRole('textbox', { name: '操作原因', exact: true }).fill('冲突后保留的虚构原因');
    await dialog.getByRole('button', { name: '终止流程', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: '操作原因', exact: true })).toHaveValue('冲突后保留的虚构原因');
    await expect(dialog.getByRole('button', { name: '终止流程', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`lifecycle-confirm-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: '重新核对记录', exact: true }).click();
    await dialog.getByRole('button', { name: '终止流程', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].body).toMatchObject({ expectedLifecycleVersion: 3, expectedUpdatedAt: '2037-01-02T00:00:00.000Z' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`lifecycle-${width}.png`), fullPage: true });
  });
}
