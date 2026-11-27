import { expect, test, type Page } from '@playwright/test';
import type { AssessmentCycle, CycleTerminationPreview } from '../../src/types/api.types';

// Frontend HTTP-contract regression only; all API requests are intercepted, no fixture writes.
const envelope = (data: unknown) => ({ code: 0, data, message: 'success', timestamp: Date.now() });
const cycleFixture = (): AssessmentCycle => ({
  id: 'fictional-termination-cycle', name: '终止周期前端回归（虚构）', type: 'monthly', planVersion: 3,
  startDate: '2038-01-01', endDate: '2038-01-31', status: 'self_eval', workflowVersion: 2,
  scoringFrequency: 'monthly', canTerminate: true, canManagePlan: true,
  openedAt: '2037-12-22T01:00:00Z', reviewStatus: 'approved', periodSchedules: [],
  notificationMode: 'launch_and_reminders',
  publishVisibleFields: { totalScore: true, grade: true, indicatorScores: true, managerComment: true, coefficient: false },
  gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1,
});

async function arrange(page: Page, options: { role?: 'hr' | 'system_admin'; allowed?: boolean; firstWrite?: 403 | 409 | 'timeout'; previewFailure?: boolean; terminated?: boolean } = {}) {
  const cycle = cycleFixture();
  if (options.allowed === false) cycle.canTerminate = false;
  if (options.terminated) Object.assign(cycle, { terminatedAt: '2038-02-01T01:00:00Z', terminationReason: '既有终止原因（虚构）' });
  const reads: string[] = [], writes: unknown[] = [], listQueries: URL[] = [], unexpectedWrites: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let previewCount = 0;
  const impact = (): CycleTerminationPreview => ({
    cycle, canTerminate: !cycle.terminatedAt, previewHash: `fictional-hash-${previewCount}`,
    summary: { total: 22, terminable: 20, protected: 1, alreadyEnded: 1, goalChanges: 2, reminders: 4 },
    tasks: Array.from({ length: 22 }, (_, index) => ({ id: `fictional-task-${index + 1}`, employeeName: `虚构员工${index + 1}`,
      employeeNo: index === 21 ? null : `F-${index + 1}`, status: index === 21 ? 'confirmed' : 'self_eval', lifecycleStatus: 'active',
      disposition: index === 21 ? 'protected' : index === 20 ? 'already_ended' : 'terminate',
      reason: index === 21 ? '已审批结果，继续原公示及申诉流程' : index === 20 ? '任务已经结束' : '本周期未完结任务',
    })),
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'fictional-termination-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    reads.push(url.pathname);
    const ok = (data: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(data)) });
    const fail = (status: number, message: string) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status, message }) });
    if (url.pathname.endsWith('/auth/me')) return ok({ id: 'fictional-hr', name: '虚构授权HR', employeeNo: 'F-HR',
      sysRole: options.role ?? 'hr', isAssessorOnly: false, canViewAll: true, deptId: null,
      hrCapabilities: options.allowed === false ? [] : ['cycle_terminate'] });
    if (url.pathname.endsWith('/notifications/unread-count')) return ok(0);
    if (url.pathname.endsWith('/notification-settings/dingtalk')) return ok({ available: true, enabled: false, effectiveEnabled: false });
    if (url.pathname.endsWith('/termination-preview')) {
      previewCount += 1;
      if (options.previewFailure && previewCount === 1) return fail(503, '清单读取暂时不可用（虚构）');
      return ok(impact());
    }
    if (url.pathname.endsWith('/terminate') && method === 'POST') {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1 && options.firstWrite === 'timeout') return route.abort('timedout');
      if (writes.length === 1 && typeof options.firstWrite === 'number') return fail(options.firstWrite, '状态已变化或权限已撤销（虚构）');
      const body = route.request().postDataJSON();
      Object.assign(cycle, { canTerminate: false, terminatedAt: '2038-02-01T01:00:00Z', terminationReason: body.reason });
      return ok({ id: cycle.id, terminatedAt: cycle.terminatedAt, terminatedCount: 20, protectedCount: 1, alreadyEndedCount: 1, cancelledGoalChangeCount: 2 });
    }
    if (method !== 'GET') { unexpectedWrites.push(`${method} ${url.pathname}`); return fail(500, 'Unexpected mutation'); }
    if (url.pathname === '/api/v1/cycles') {
      listQueries.push(url);
      const items = url.searchParams.get('group') === 'finished' && !cycle.terminatedAt ? [] : [cycle];
      return ok({ items, total: items.length, page: 1, pageSize: 10 });
    }
    if (url.pathname.endsWith(`/cycles/${cycle.id}`)) return ok(cycle);
    if (url.pathname.endsWith('/participant-record')) return ok({ source: 'manual', participants: [] });
    if (url.pathname.endsWith(`/assessment-periods/cycle/${cycle.id}/monitoring`)) return ok({
      cycle: { id: cycle.id, name: cycle.name }, total: 1, page: 1, pageSize: 20,
      summary: { employeePending: 0, employeeOverdue: 0, managerPending: 0, managerCompleted: 1, total: 1 },
      items: [{ id: 'fictional-period', taskId: 'fictional-task', periodKey: '2038-01', sequence: 1, status: 'manager_submitted',
        derivedStatus: 'manager_completed', draftVersion: 1, employeeId: 'fictional-employee', employeeNo: 'F-1', employeeName: '虚构月度记录',
        deptName: '虚构部门', managerName: '虚构主管', selfEvalOpenAt: '2038-02-01T01:00:00Z', selfEvalDueAt: '2038-02-04T01:00:00Z',
        managerDueAt: '2038-02-07T01:00:00Z', employeeSubmittedAt: null, managerSubmittedAt: null, lockedAt: null,
        selfScoreTotal: null, managerScoreTotal: null, selfGrade: null, managerGrade: null, canReopen: true, reopenBlockedReason: null }],
    });
    if (url.pathname === '/api/v1/departments') return ok([]);
    return ok({ items: [], total: 0 });
  });
  return { cycle, reads, writes, listQueries, unexpectedWrites, pageErrors };
}

function listAction(page: Page, name: 'terminate' | 'primary', id: string) {
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  return page.getByTestId(`cycle-${name}-${mobile ? 'mobile-' : ''}${id}`);
}
async function openDialog(page: Page, id: string) {
  await page.goto('/cycles');
  await listAction(page, 'terminate', id).click();
  await expect(page.getByTestId('cycle-termination-summary')).toBeVisible();
  return page.getByTestId('cycle-termination-dialog');
}
async function confirmTermination(page: Page) {
  await page.getByTestId('cycle-termination-submit').click();
  const confirmation = page.getByRole('dialog', { name: '再次确认终止周期' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '终止周期并保留记录', exact: true }).click();
  await expect(confirmation).toBeHidden();
}

test('完整分页、原因校验、取消、409重核和成功后只读及已结束查询', async ({ page }, testInfo) => {
  const f = await arrange(page, { firstWrite: 409 });
  const dialog = await openDialog(page, f.cycle.id);
  const initialBounds = await dialog.boundingBox();
  expect(initialBounds!.y).toBeGreaterThanOrEqual(0);
  expect(initialBounds!.y + initialBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(dialog.getByText('保留结果及原流程', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('将取消的目标变更', { exact: true })).toBeVisible();
  await expect(dialog.getByText('将取消的待发提醒', { exact: true })).toBeVisible();
  await dialog.locator('.el-pager li').filter({ hasText: /^3$/ }).click();
  await expect(dialog.getByRole('cell', { name: '虚构员工22 无工号', exact: true })).toBeVisible();
  await expect(dialog.getByText('已审批结果，继续原公示及申诉流程', { exact: true })).toBeAttached();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('impact-protected-page.png'), fullPage: true });
  await page.getByTestId('cycle-termination-submit').click();
  await expect(dialog.getByText('请填写终止原因', { exact: true })).toBeVisible();
  await page.getByTestId('cycle-termination-reason').fill('虚构终止原因：业务演练，保留已审批结果');
  await page.getByTestId('cycle-termination-submit').click();
  await page.getByRole('dialog', { name: '再次确认终止周期' }).getByRole('button', { name: '返回核对' }).click();
  expect(f.writes).toHaveLength(0);
  await confirmTermination(page);
  await expect(page.getByTestId('cycle-termination-error')).toContainText('重新核对');
  await expect(page.getByTestId('cycle-termination-reason')).toHaveValue('虚构终止原因：业务演练，保留已审批结果');
  expect(f.reads.filter(url => url.endsWith('/termination-preview'))).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('impact-rechecked.png'), fullPage: true });
  await confirmTermination(page);
  await expect(dialog).toBeHidden();
  expect(f.writes).toEqual([
    { reason: '虚构终止原因：业务演练，保留已审批结果', expectedPreviewHash: 'fictional-hash-1' },
    { reason: '虚构终止原因：业务演练，保留已审批结果', expectedPreviewHash: 'fictional-hash-2' },
  ]);
  await expect(listAction(page, 'terminate', f.cycle.id)).toHaveCount(0);
  await listAction(page, 'primary', f.cycle.id).click();
  await expect(page.getByTestId('cycle-termination-record')).toContainText('虚构终止原因');
  await expect(page.getByTestId('cycle-workspace-edit')).toHaveCount(0);
  await expect(page.getByTestId('cycle-workspace-terminate')).toHaveCount(0);
  await expect(page.getByTestId('cycle-monthly-progress-panel')).toContainText('虚构月度记录');
  await expect(page.getByRole('button', { name: '重新开放月度自评' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('terminated-record.png'), fullPage: true });
  await page.getByTestId('cycle-workspace-back').click();
  await page.getByRole('button', { name: '已结束', exact: true }).click();
  await expect.poll(() => f.listQueries.at(-1)?.searchParams.get('group')).toBe('finished');
  await expect(listAction(page, 'primary', f.cycle.id)).toHaveText('查看记录');
  expect(f.unexpectedWrites).toEqual([]);
  expect(f.pageErrors).toEqual([]);
});

test('工作区可终止，成功后保留月度数据且不能重新开放', async ({ page }) => {
  const f = await arrange(page); await page.goto(`/cycles?cycleId=${f.cycle.id}`);
  const panel = page.getByTestId('cycle-monthly-progress-panel');
  await expect(panel).toContainText('虚构月度记录');
  await expect(page.getByRole('button', { name: '重新开放月度自评', exact: true })).toBeVisible();
  await page.getByTestId('cycle-workspace-terminate').click();
  await expect(page.getByTestId('cycle-termination-summary')).toBeVisible();
  await page.getByTestId('cycle-termination-reason').fill('工作区终止（虚构）');
  await confirmTermination(page);
  await expect(page.getByTestId('cycle-termination-record')).toContainText('工作区终止');
  await expect(panel).toContainText('虚构月度记录');
  await expect(page.getByRole('button', { name: '重新开放月度自评', exact: true })).toHaveCount(0);
  expect(f.writes).toHaveLength(1); expect(f.unexpectedWrites).toEqual([]); expect(f.pageErrors).toEqual([]);
});

test('403保留原因、停止提交且不提供权限重试', async ({ page }) => {
  const f = await arrange(page, { firstWrite: 403 }); await openDialog(page, f.cycle.id);
  await page.getByTestId('cycle-termination-reason').fill('权限撤回时保留（虚构）');
  await confirmTermination(page);
  await expect(page.getByTestId('cycle-termination-error')).toContainText('不能重试提交');
  await expect(page.getByTestId('cycle-termination-submit')).toBeDisabled();
  await expect(page.getByTestId('cycle-termination-refresh')).toHaveCount(0);
  await expect(page.getByTestId('cycle-termination-reason')).toHaveValue('权限撤回时保留（虚构）');
  expect(f.writes).toHaveLength(1); expect(f.unexpectedWrites).toEqual([]);
});

test('超时保留原因并要求重新读取影响清单', async ({ page }) => {
  const f = await arrange(page, { firstWrite: 'timeout' }); await openDialog(page, f.cycle.id);
  await page.getByTestId('cycle-termination-reason').fill('超时草稿（虚构）');
  await confirmTermination(page);
  await expect(page.getByTestId('cycle-termination-submit')).toBeDisabled();
  await expect(page.getByTestId('cycle-termination-reason')).toHaveValue('超时草稿（虚构）');
  await page.getByTestId('cycle-termination-refresh').click();
  await expect(page.getByTestId('cycle-termination-summary')).toBeVisible();
  await expect(page.getByTestId('cycle-termination-submit')).toBeEnabled();
  expect(f.writes).toHaveLength(1);
});

for (const role of ['hr', 'system_admin'] as const) test(`${role}无显式授权不出现终止动作`, async ({ page }) => {
  const f = await arrange(page, { role, allowed: false }); await page.goto('/cycles');
  await expect(listAction(page, 'primary', f.cycle.id)).toBeVisible();
  await expect(listAction(page, 'terminate', f.cycle.id)).toHaveCount(0);
  await listAction(page, 'primary', f.cycle.id).click();
  await expect(page.getByTestId('cycle-workspace')).toBeVisible();
  await expect(page.getByTestId('cycle-workspace-terminate')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('历史已终止周期不受原业务状态影响且管理动作只读', async ({ page }) => {
  const f = await arrange(page, { terminated: true }); f.cycle.status = 'scheduled';
  await page.goto(`/cycles?cycleId=${f.cycle.id}&group=finished`);
  await expect(page.getByTestId('cycle-termination-record')).toContainText('既有终止原因');
  await expect(page.getByTestId('cycle-preflight-primary-action')).toHaveCount(0);
  await expect(page.getByTestId('cycle-workspace-terminate')).toHaveCount(0);
  expect(f.reads.filter(url => url.endsWith('/preflight'))).toEqual([]);
  expect(f.writes).toEqual([]);
});
