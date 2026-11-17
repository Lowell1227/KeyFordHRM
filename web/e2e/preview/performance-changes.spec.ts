import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, http, login, origin, state, test, transferEmployeeToHead, type Change, type Fixture, type Goal, type Plan, type Role, type Row, type State } from './performance-changes-fixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10_000, navigationTimeout: 20_000 });
test.setTimeout(360_000);

type Context = { canGrant: boolean; tasks: Array<{
  id: string; cycleId: string; employeeId: string; managerId: string; canGrant: boolean; canStart: boolean;
  requestId: string | null; workflowIssue: string | null; grant: { revision: number; state: string } | null;
}> };
type PeriodView = { indicators: Array<{
  indicatorVersionItemId: string; sourceInstanceId: string; name: string; employeeComment: string | null;
  selfScore: number | null; progress: number | null;
}> };
const changePath = (change: Change, action = '') => `/goal-changes/${change.id}${action ? '/' + action : ''}`;
const planPath = (plan: Plan, action = '') => `/improvement-plans/${plan.id}${action ? '/' + action : ''}`;
const original = (s: State) => Object.fromEntries(['tasks', 'periods', 'reviews', 'revisions', 'versions', 'items', 'instances', 'progress', 'grades']
  .map(key => [key, s[key as keyof State]]));
const changedGoals = (f: Fixture, before: Goal[]): Goal[] => [
  { ...before[0], name: `${f.f.prefix} revised delivery`, weight: 0.7 },
  { ...before[0], sourceInstanceId: null, name: `${f.f.prefix} added quality`, weight: 0.3, sortOrder: 2 },
];

async function denied(request: APIRequestContext, fixture: Fixture, role: Role, method: string,
  path: string, status: number, body?: unknown) {
  const before = state(fixture.f);
  await api(request, fixture, role, method, path, status, body);
  expect(state(fixture.f), 'Denied/stale writes leave all owned business records and side effects unchanged').toEqual(before);
}

async function pendingChange(request: APIRequestContext, fixture: Fixture): Promise<Change> {
  await api(request, fixture, 'hr2', 'POST', '/goal-changes/grants', 200, { taskId: fixture.f.taskId });
  let change = await api<Change>(request, fixture, 'employee', 'POST', '/goal-changes', 201, { taskId: fixture.f.taskId });
  change = await api<Change>(request, fixture, 'employee', 'PATCH', changePath(change), 200, {
    expectedRevision: change.revision, reason: `${fixture.f.prefix} synthetic scope adjustment`,
    goals: changedGoals(fixture, change.beforeGoals),
  });
  return api<Change>(request, fixture, 'employee', 'POST', changePath(change, 'submit'), 200, { expectedRevision: change.revision });
}

const goalStages: Array<{ role: Role; status: string; next: string }> = [
  { role: 'manager', status: 'indicator_reviewing', next: 'indicator_dept_reviewing' },
  { role: 'head', status: 'indicator_dept_reviewing', next: 'indicator_confirming' },
  { role: 'employee', status: 'indicator_confirming', next: 'indicator_approving' },
  { role: 'vp', status: 'indicator_approving', next: 'active' },
];

function expectActivation(fixture: Fixture, before: State, after: State, change: Change, protectedIds = [fixture.f.periodIds[0]]) {
  const { f } = fixture;
  expect(change.status).toBe('active');
  expect(change.effectiveVersionId).toBeTruthy();
  expect(after.versions).toHaveLength(2);
  expect(after.versions.find(row => row.id === f.versionId)).toMatchObject({ status: 'retired', version: 1 });
  expect(after.versions.find(row => row.id === change.effectiveVersionId)).toMatchObject({ status: 'active', version: 2 });
  expect(after.items.filter(row => row.indicatorVersionId === f.versionId)).toEqual(before.items);
  expect(after.grants).toEqual([expect.objectContaining({ taskId: f.taskId, state: 'consumed' })]);
  for (const id of f.periodIds) {
    const old = before.periods.find(row => row.id === id)!;
    const current = after.periods.find(row => row.id === id)!;
    if (protectedIds.includes(id)) {
      expect(current).toEqual(old);
      expect(after.reviews.filter(row => row.periodId === id)).toEqual(before.reviews.filter(row => row.periodId === id));
      expect(after.revisions.filter(row => row.periodId === id)).toEqual(before.revisions.filter(row => row.periodId === id));
    } else expect(current).toMatchObject({ indicatorVersionId: change.effectiveVersionId, draftVersion: Number(old.draftVersion) + 1 });
  }
  expect(after.progress).toEqual(before.progress);
  expect(after.grades).toEqual(before.grades);
  expect(after.instances).toHaveLength(3);
  expect(after.instances.find(row => row.id === f.sourceIds[1])).toEqual({
    ...before.instances.find(row => row.id === f.sourceIds[1]), retiredAt: expect.any(String), updatedAt: expect.any(String),
  });
  for (const field of ['retiredAt', 'updatedAt']) {
    const at = Date.parse(String(after.instances.find(row => row.id === f.sourceIds[1])![field]));
    expect(Number.isFinite(at), `Retired indicator ${field} is a real timestamp`).toBe(true);
    expect(at).toBeGreaterThan(Date.parse(String(before.instances.find(row => row.id === f.sourceIds[1])!.updatedAt)));
  }
  expect(after.instances.filter(row => row.retiredAt === null).map(row => row.name).sort())
    .toEqual([`${f.prefix} revised delivery`, `${f.prefix} added quality`].sort());
  // Remap retained draft content by source; the removed goal's draft stays on its old item.
  const draftId = f.periodIds[1];
  if (!protectedIds.includes(draftId)) {
    const oldRows = before.reviews.filter(row => row.periodId === draftId);
    const removedDraft = oldRows.find(row => row.indicatorVersionItemId === f.itemIds[1])!;
    expect(after.reviews.find(row => row.id === removedDraft.id)).toEqual(removedDraft);
    const newItem = after.items.find(row => row.indicatorVersionId === change.effectiveVersionId && row.sourceInstanceId === f.sourceIds[0])!;
    const copied = after.reviews.find(row => row.periodId === draftId && row.indicatorVersionItemId === newItem.id)!;
    const content = ({ id: _id, indicatorVersionItemId: _item, createdAt: _created, updatedAt: _updated, ...rest }: Row) => rest;
    expect(copied, 'Retained self-evaluation draft is mapped by sourceInstanceId').toBeTruthy();
    expect(content(copied)).toEqual(content(oldRows.find(row => row.indicatorVersionItemId === f.itemIds[0])!));
    expect(after.reviews.some(row => row.periodId === draftId && row.indicatorVersionItemId === f.itemIds[1])).toBe(true);
  }
}

test.describe('HTTP/DB evidence (not UI acceptance)', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'HTTP/DB only; viewport is not UI evidence'));

  test('goal grant scope, no-grant denial, concurrent employee/manager start, stale CAS and HR revoke', async ({ request, changes }) => {
    const { f } = changes;
    const employee = await api<{ id: string; directManagerId: string; deptId: string }>(request, changes, 'employee', 'GET', '/auth/me');
    expect(employee).toMatchObject({ id: f.actors.employee.id, directManagerId: f.actors.manager.id, deptId: f.departmentId });
    for (const role of ['employee', 'manager'] as const) {
      await denied(request, changes, role, 'POST', '/goal-changes', 403, { taskId: f.taskId });
    }
    for (const role of ['employee', 'manager', 'head', 'vp', 'outsider', 'admin'] as const) {
      await denied(request, changes, role, 'POST', '/goal-changes/grants', 403, { taskId: f.taskId });
    }
    await denied(request, changes, 'hr2', 'POST', '/goal-changes/grants', 403, { taskId: f.foreignTaskId });
    const context = await api<Context>(request, changes, 'hr2', 'POST', '/goal-changes/grants', 200, { taskId: f.taskId });
    expect(context.tasks.find(row => row.id === f.taskId)).toMatchObject({ employeeId: f.actors.employee.id,
      managerId: f.actors.manager.id, canGrant: true, grant: { state: 'open', revision: 0 } });
    expect(state(f).grants).toHaveLength(1);
    await denied(request, changes, 'outsider', 'POST', '/goal-changes', 403, { taskId: f.taskId });
    const results = await Promise.all((['employee', 'manager'] as const).map(role =>
      http<Change>(request, changes, role, 'POST', '/goal-changes', { taskId: f.taskId })));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(state(f).changes).toHaveLength(1);
    let change = results.find(result => result.status === 201)!.data;
    const creator: Role = change.creatorId === f.actors.employee.id ? 'employee' : 'manager';
    await denied(request, changes, 'outsider', 'GET', changePath(change), 403);
    const originalState = original(state(f));
    const saved = { expectedRevision: change.revision, reason: `${f.prefix} adjustment`, goals: changedGoals(changes, change.goals) };
    change = await api<Change>(request, changes, creator, 'PATCH', changePath(change), 200, saved);
    await denied(request, changes, creator, 'PATCH', changePath(change), 409, saved);
    await denied(request, changes, creator, 'POST', changePath(change, 'submit'), 409, { expectedRevision: saved.expectedRevision });
    await denied(request, changes, creator === 'employee' ? 'manager' : 'employee', 'PATCH', changePath(change), 403, {
      ...saved, expectedRevision: change.revision,
    });
    await denied(request, changes, creator, 'PATCH', changePath(change), 400, {
      ...saved, expectedRevision: change.revision, goals: saved.goals.map(goal => ({ ...goal, weight: 0.8 })),
    });
    change = await api<Change>(request, changes, creator, 'POST', changePath(change, 'submit'), 200, { expectedRevision: change.revision });
    change = await api<Change>(request, changes, 'manager', 'POST', changePath(change, 'decide'), 200, {
      expectedRevision: change.revision, approve: false, comment: `${f.prefix} return supporting detail`,
    });
    expect(change).toMatchObject({ status: 'revision', currentOwnerId: f.actors[creator].id });
    change = await api<Change>(request, changes, creator, 'POST', changePath(change, 'submit'), 200, { expectedRevision: change.revision });
    expect(original(state(f))).toEqual(originalState);
    await denied(request, changes, 'admin', 'POST', changePath(change, 'revoke'), 403, { expectedRevision: change.revision });
    const revoked = await api<Change>(request, changes, 'hr1', 'POST', changePath(change, 'revoke'), 200, { expectedRevision: change.revision });
    expect(revoked.status).toBe('revoked');
    expect(state(f).grants[0]).toMatchObject({ state: 'revoked' });
    expect(original(state(f))).toEqual(originalState);
    await denied(request, changes, creator, 'POST', '/goal-changes', 403, { taskId: f.taskId });
    const grantRevision = state(f).grants[0].revision;
    await api(request, changes, 'hr2', 'POST', '/goal-changes/grants', 200, { taskId: f.taskId, expectedRevision: grantRevision });
    await denied(request, changes, 'hr2', 'POST', `/goal-changes/grants/${f.taskId}/revoke`, 409, { expectedRevision: grantRevision });
    await api(request, changes, 'hr1', 'POST', `/goal-changes/grants/${f.taskId}/revoke`, 200, {
      expectedRevision: state(f).grants[0].revision,
    });
    expect(state(f).grants[0]).toMatchObject({ state: 'revoked' });
  });

  test('goal original frozen chain activates only unsubmitted periods and retains snapshots/draft content', async ({ request, changes }) => {
    const before = state(changes.f);
    let change = await pendingChange(request, changes);
    for (const stage of goalStages) {
      expect(change).toMatchObject({ status: stage.status, currentOwnerId: changes.f.actors[stage.role].id });
      expect(original(state(changes.f))).toEqual(original(before));
      await denied(request, changes, 'outsider', 'POST', changePath(change, 'decide'), 403, { expectedRevision: change.revision, approve: true });
      const detail = await api<Change>(request, changes, stage.role, 'GET', changePath(change));
      expect(detail.allowedActions).toContain('decide');
      expect(detail.protectedPeriodKeys).toEqual(['2090-01']);
      change = await api<Change>(request, changes, stage.role, 'POST', changePath(change, 'decide'), 200, {
        expectedRevision: change.revision, approve: true,
      });
      expect(change.status).toBe(stage.next);
    }
    expectActivation(changes, before, state(changes.f), change);
    const view = await api<PeriodView>(request, changes, 'employee', 'GET', `/assessment-periods/${changes.f.periodIds[1]}/review`);
    expect(view.indicators).toHaveLength(2);
    expect(view.indicators.map(row => row.name).sort()).toEqual(changedGoals(changes, change.beforeGoals).map(row => row.name).sort());
    expect(view.indicators.find(row => row.sourceInstanceId === changes.f.sourceIds[0]))
      .toMatchObject({ employeeComment: `${changes.f.prefix} protected content 0`, selfScore: 71, progress: 45 });
    expect(view.indicators.some(row => changes.f.itemIds.includes(row.indicatorVersionItemId))).toBe(false);
    await denied(request, changes, 'employee', 'POST', '/goal-changes', 403, { taskId: changes.f.taskId });
    await denied(request, changes, 'employee', 'PUT', `/assessment-periods/${changes.f.periodIds[1]}/employee-draft`, 409, {
      expectedVersion: 1, selfGrade: 'B', indicators: view.indicators.map(row => ({ indicatorVersionItemId: row.indicatorVersionItemId, selfScore: 10 })),
    });
  });

  test('a month submitted during goal review is rechecked and protected by final activation', async ({ request, changes }) => {
    let change = await pendingChange(request, changes);
    for (const stage of goalStages.slice(0, 3)) change = await api<Change>(request, changes, stage.role, 'POST', changePath(change, 'decide'), 200, {
      expectedRevision: change.revision, approve: true,
    });
    await api(request, changes, 'employee', 'POST', `/assessment-periods/${changes.f.periodIds[1]}/employee-submit`, 200, {
      expectedVersion: 1, idempotencyKey: randomUUID(), selfGrade: 'B', indicators: changes.f.itemIds.map(id => ({
        indicatorVersionItemId: id, selfScore: 73, progress: 80, healthStatus: 'on_track', employeeComment: `${changes.f.prefix} submitted during review`,
      })),
    });
    const beforeFinal = state(changes.f);
    change = await api<Change>(request, changes, 'vp', 'POST', changePath(change, 'decide'), 200, { expectedRevision: change.revision, approve: true });
    expectActivation(changes, beforeFinal, state(changes.f), change, changes.f.periodIds.slice(0, 2));
    const view = await api<PeriodView>(request, changes, 'employee', 'GET', `/assessment-periods/${changes.f.periodIds[1]}/review`);
    expect(view.indicators.map(row => row.indicatorVersionItemId).sort()).toEqual([...changes.f.itemIds].sort());
  });

  test('PIP V3 exact-manager initiation, revision on every write, shared HR race and full persisted stage order', async ({ request, changes }) => {
    const { f } = changes;
    const draft = { employeeId: f.actors.employee.id, cycleId: f.cycleId,
      improvementNeed: `${f.prefix} synthetic improvement`, goals: [{ id: 'delivery', name: 'Delivery quality', description: 'Verify every fictional delivery', weight: 100 }] };
    const eligible = await api<Array<{ id: string }>>(request, changes, 'manager', 'GET', '/improvement-plans/eligible-employees');
    expect(eligible.map(row => row.id)).toContain(f.actors.employee.id);
    expect(eligible.map(row => row.id)).not.toContain(f.actors.outsider.id);
    for (const role of ['employee', 'head', 'vp', 'hr1', 'hr2', 'outsider', 'admin'] as const) {
      await denied(request, changes, role, 'POST', '/improvement-plans', 403, draft);
    }
    let plan = await api<Plan>(request, changes, 'manager', 'POST', '/improvement-plans', 201, draft);
    expect(plan).toMatchObject({ workflowVersion: 3, status: 'draft', revision: 0, workflowIssue: null });
    await denied(request, changes, 'outsider', 'GET', planPath(plan), 403);
    await denied(request, changes, 'manager', 'PATCH', planPath(plan), 400, { improvementNeed: draft.improvementNeed });
    plan = await api<Plan>(request, changes, 'manager', 'PATCH', planPath(plan), 200, { expectedRevision: plan.revision, improvementNeed: draft.improvementNeed });
    await denied(request, changes, 'manager', 'PATCH', planPath(plan), 409, { expectedRevision: 0, improvementNeed: `${f.prefix} stale` });
    await denied(request, changes, 'manager', 'POST', planPath(plan, 'submit-goals'), 400, {});
    plan = await api<Plan>(request, changes, 'manager', 'POST', planPath(plan, 'submit-goals'), 200, { expectedRevision: plan.revision });
    for (const [role, status, next] of [
      ['employee', 'goal_employee_confirm', 'goal_dept_review'], ['head', 'goal_dept_review', 'goal_hr_review'],
    ] as const) {
      expect(plan.status).toBe(status);
      await denied(request, changes, role, 'POST', planPath(plan, 'decide-goals'), 400, { approve: true });
      plan = await api<Plan>(request, changes, role, 'POST', planPath(plan, 'decide-goals'), 200, { expectedRevision: plan.revision, approve: true });
      expect(plan.status).toBe(next);
    }
    for (const role of ['hr1', 'hr2'] as const) {
      const shared = await api<Plan>(request, changes, role, 'GET', planPath(plan));
      expect(shared).toMatchObject({ currentOwnerId: null, allowedActions: ['decide_goals'] });
      const pending = await api<Plan[]>(request, changes, role, 'GET', '/improvement-plans/my-pending');
      expect(pending.map(row => row.id)).toContain(plan.id);
    }
    for (const role of ['admin', 'outsider'] as const) {
      await denied(request, changes, role, 'POST', planPath(plan, 'decide-goals'), 403, { expectedRevision: plan.revision, approve: true });
    }
    expect((await api<Plan>(request, changes, 'admin', 'GET', planPath(plan))).allowedActions).toEqual([]);
    const sharedRevision = plan.revision;
    const results = await Promise.all((['hr1', 'hr2'] as const).map(role => http<Plan>(request, changes, role,
      'POST', planPath(plan, 'decide-goals'), { expectedRevision: sharedRevision, approve: true })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    plan = await api<Plan>(request, changes, 'vp', 'GET', planPath(plan));
    expect(plan).toMatchObject({ status: 'goal_vp_review', revision: sharedRevision + 1, currentOwnerId: f.actors.vp.id });
    expect(state(f).audits.filter(row => row.entityId === plan.id && row.action === 'confirm_goals'
      && [f.actors.hr1.id, f.actors.hr2.id].includes(String(row.userId)))).toHaveLength(1);
    plan = await api<Plan>(request, changes, 'vp', 'POST', planPath(plan, 'decide-goals'), 200, { expectedRevision: plan.revision, approve: true });
    for (const [role, status, next, score] of [
      ['employee', 'self_eval', 'manager_review', 70], ['manager', 'manager_review', 'dept_review', 80], ['head', 'dept_review', 'vp_review', 90],
    ] as const) {
      expect(plan.status).toBe(status);
      const evaluation = { items: plan.goals.map(goal => ({ goalId: goal.id, score, comment: `${f.prefix} ${role} evidence` })), overallComment: `${f.prefix} ${role} overall` };
      await denied(request, changes, role, 'POST', planPath(plan, 'save-evaluation'), 400, evaluation);
      const oldRevision = plan.revision;
      plan = await api<Plan>(request, changes, role, 'POST', planPath(plan, 'save-evaluation'), 200, { ...evaluation, expectedRevision: oldRevision });
      await denied(request, changes, role, 'POST', planPath(plan, 'save-evaluation'), 409, { ...evaluation, expectedRevision: oldRevision });
      await denied(request, changes, role, 'POST', planPath(plan, 'evaluate'), 400, evaluation);
      await denied(request, changes, role, 'POST', planPath(plan, 'evaluate'), 409, { ...evaluation, expectedRevision: oldRevision });
      plan = await api<Plan>(request, changes, role, 'POST', planPath(plan, 'evaluate'), 200, { ...evaluation, expectedRevision: plan.revision });
      expect(plan.status).toBe(next);
    }
    await denied(request, changes, 'vp', 'POST', planPath(plan, 'decide-final'), 400, { approve: true });
    plan = await api<Plan>(request, changes, 'vp', 'POST', planPath(plan, 'decide-final'), 200, { expectedRevision: plan.revision, approve: true });
    expect(plan).toMatchObject({ status: 'completed', finalScore: 90, allowedActions: [] });
    expect(state(f).plans.find(row => row.id === plan.id)).toMatchObject({ workflowVersion: 3, status: 'completed', finalScore: 90 });
    const employeeView = await api<Plan>(request, changes, 'employee', 'GET', planPath(plan));
    expect(employeeView.finalScore).toBe(90);
    expect(employeeView.departmentEvaluation).toBeTruthy();
  });
});

// Exact page labels are escaped so these new source files remain ASCII.
const L = {
  changes: '\u76ee\u6807\u53d8\u66f4',
  teamChanges: '\u56e2\u961f\u53d8\u66f4',
  grant: '\u5f00\u653e\u53d8\u66f4', cycle: '\u8003\u6838\u5468\u671f', employee: '\u5458\u5de5',
  grantNow: '\u5f00\u653e\u53d8\u66f4', start: '\u53d1\u8d77\u53d8\u66f4',
  startTitle: '\u53d1\u8d77\u76ee\u6807\u53d8\u66f4', task: '\u8003\u6838\u4efb\u52a1',
  createChange: '\u5f00\u59cb\u586b\u5199', reason: '\u53d8\u66f4\u539f\u56e0',
  add: '\u6dfb\u52a0\u76ee\u6807', remove2: '\u5220\u9664\u76ee\u6807 2',
  name1: '\u76ee\u6807\u540d\u79f0 1', name2: '\u76ee\u6807\u540d\u79f0 2',
  weight1: '\u76ee\u6807\u6743\u91cd 1', weight2: '\u76ee\u6807\u6743\u91cd 2',
  description1: '\u76ee\u6807\u63cf\u8ff0 1', save: '\u4fdd\u5b58\u8349\u7a3f',
  submitChange: '\u63d0\u4ea4\u5ba1\u6838', approve: '\u5ba1\u6838\u901a\u8fc7', confirmChange: '\u786e\u8ba4\u53d8\u66f4',
  newPip: '\u65b0\u5efa\u6539\u8fdb\u8ba1\u5212', createPip: '\u521b\u5efa\u6539\u8fdb\u8ba1\u5212',
  background: '\u6539\u8fdb\u80cc\u666f', linkedCycle: '\u5173\u8054\u7ee9\u6548\u5468\u671f\u8ba1\u5212',
  submitGoals: '\u63d0\u4ea4\u76ee\u6807', confirmGoals: '\u786e\u8ba4\u76ee\u6807',
  score1: '\u76ee\u6807\u8bc4\u5206 1', comment1: '\u76ee\u6807\u8bc4\u4ef7 1', overall: '\u603b\u4f53\u8bc4\u4ef7\u5185\u5bb9',
  employeeEval: '\u63d0\u4ea4\u5458\u5de5\u81ea\u8bc4', managerEval: '\u63d0\u4ea4\u76f4\u5c5e\u4e0a\u7ea7\u8bc4\u4ef7',
  headEval: '\u63d0\u4ea4\u90e8\u95e8\u8d1f\u8d23\u4eba\u8bc4\u4ef7', final: '\u786e\u8ba4\u7ed3\u679c',
  confirmFinal: '\u786e\u8ba4\u7ed3\u679c',
};

async function pick(page: Page, scope: Locator, label: string, option: string) {
  // Non-searchable Element Plus inputs live in an is-hidden layer; click their visible control.
  await scope.locator('.el-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function uiWrite<T>(page: Page, method: string, path: string, action: () => Promise<unknown>,
  status = 200, expectedRevision?: number): Promise<T> {
  const pending = page.waitForResponse(response => response.url() === `${origin}/api/v1${path}` && response.request().method() === method);
  await action();
  const response = await pending;
  expect(response.status(), `Actual page ${method} ${path}`).toBe(status);
  if (expectedRevision !== undefined) expect(response.request().postDataJSON().expectedRevision).toBe(expectedRevision);
  return (await response.json()).data as T;
}

async function fits(page: Page, scope: Locator, button: string) {
  await expect(scope).toBeVisible();
  const action = scope.getByRole('button', { name: button, exact: true });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await scope.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

test('HTTP/DB: a new manager who is also department head must confirm goals they did not submit', async ({ request, changes }) => {
  let plan = await api<Plan>(request, changes, 'manager', 'POST', '/improvement-plans', 201, {
    employeeId: changes.f.actors.employee.id, improvementNeed: `${changes.f.prefix} fictional transfer check`,
    goals: [{ id: randomUUID(), name: 'Fictional quality', description: 'Check handover', weight: 100 }],
  });
  plan = await api<Plan>(request, changes, 'manager', 'POST', planPath(plan, 'submit-goals'), 200, { expectedRevision: plan.revision });
  transferEmployeeToHead(changes.f);
  plan = await api<Plan>(request, changes, 'employee', 'POST', planPath(plan, 'decide-goals'), 200, { approve: true, expectedRevision: plan.revision });
  expect(plan.status).toBe('goal_dept_review');
  expect(plan.currentOwnerId).toBe(changes.f.actors.head.id);
  await denied(request, changes, 'hr1', 'POST', planPath(plan, 'decide-goals'), 403, { approve: true, expectedRevision: plan.revision });
  plan = await api<Plan>(request, changes, 'head', 'POST', planPath(plan, 'decide-goals'), 200, { approve: true, expectedRevision: plan.revision });
  expect(plan.status).toBe('goal_hr_review');
});

test.describe('Real UI evidence (all transitions through pages; desktop and mobile)', () => {
  test('goal HR grant -> employee real selects/add/delete -> frozen manager/head/employee/VP approvals', async ({ page, request, changes }, info) => {
    const { f } = changes;
    const before = state(f);
    await login(page, changes, 'hr2', '/goal-changes');
    await page.getByRole('button', { name: L.grant, exact: true }).click();
    const grantDialog = page.getByRole('dialog', { name: L.grant, exact: true });
    await pick(page, grantDialog, L.cycle, `${f.prefix}_main`);
    await pick(page, grantDialog, L.employee, `${f.actors.employee.name} \u00b7 ${f.actors.employee.employeeNo}`);
    const context = await uiWrite<Context>(page, 'POST', '/goal-changes/grants', () => grantDialog.getByRole('button', { name: L.grantNow }).click());
    expect(context.tasks.find(row => row.id === f.taskId)?.grant?.state).toBe('open');
    await login(page, changes, 'manager', '/tasks?scope=team');
    // This covers a real manager entry, not the separately tested team-only layout.
    await page.getByRole('button', { name: L.changes, exact: true })
      .or(page.getByRole('link', { name: L.changes, exact: true })).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(`${origin}/goal-changes`);
    await page.getByRole('tab', { name: L.teamChanges, exact: true }).click();
    await expect(page.getByRole('button', { name: L.start, exact: true })).toBeVisible();
    await login(page, changes, 'employee', '/goal-changes');
    await page.getByRole('button', { name: L.start, exact: true }).click();
    const startDialog = page.getByRole('dialog', { name: L.startTitle, exact: true });
    await pick(page, startDialog, L.task, `${f.actors.employee.name} \u00b7 ${f.prefix}_main`);
    let change = await uiWrite<Change>(page, 'POST', '/goal-changes', () => startDialog.getByRole('button', { name: L.createChange }).click(), 201);
    expect(change.taskId).toBe(f.taskId);
    const drawer = page.getByTestId('business-detail-drawer');
    await expect(drawer.getByRole('textbox', { name: L.reason })).toBeVisible();
    await drawer.getByRole('textbox', { name: L.reason }).fill(`${f.prefix} synthetic scope adjustment with a long fictional delivery explanation`);
    await drawer.getByRole('button', { name: L.remove2, exact: true }).click();
    await drawer.getByRole('button', { name: L.add, exact: true }).click();
    await drawer.getByRole('textbox', { name: L.name1, exact: true }).fill(`${f.prefix} revised delivery`);
    await drawer.getByRole('spinbutton', { name: L.weight1, exact: true }).fill('70');
    await drawer.getByRole('textbox', { name: L.name2, exact: true }).fill(`${f.prefix} added quality`);
    await drawer.getByRole('spinbutton', { name: L.weight2, exact: true }).fill('30');
    await fits(page, drawer, L.save);
    change = await uiWrite<Change>(page, 'PATCH', changePath(change), () => drawer.getByRole('button', { name: L.save, exact: true }).click(), 200, change.revision);
    await expect(drawer.getByRole('button', { name: L.submitChange, exact: true })).toBeEnabled();
    expect(original(state(f))).toEqual(original(before));
    // Crop to the owned drawer, never the global HR list, user menu, or a credential-bearing trace.
    await expect(drawer.getByTestId('goal-change-detail')).toContainText(f.actors.employee.name);
    await drawer.screenshot({ path: info.outputPath(`performance-changes-goal-${info.project.name}.png`) });
    change = await uiWrite<Change>(page, 'POST', changePath(change, 'submit'), () => drawer.getByRole('button', { name: L.submitChange, exact: true }).click(), 200, change.revision);
    for (const stage of goalStages) {
      await login(page, changes, stage.role, changePath(change));
      const detail = await api<Change>(request, changes, stage.role, 'GET', changePath(change));
      expect(detail).toMatchObject({ status: stage.status, currentOwnerId: f.actors[stage.role].id });
      const label = stage.role === 'employee' ? L.confirmChange : L.approve;
      await fits(page, drawer, label);
      await drawer.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      change = await uiWrite<Change>(page, 'POST', changePath(change, 'decide'), () => dialog.getByRole('button', { name: label, exact: true }).click(), 200, detail.revision);
      expect(change.status).toBe(stage.next);
      await expect(dialog).toBeHidden();
    }
    expectActivation(changes, before, state(f), change);
    await expect(drawer.getByTestId('goal-change-detail')).toContainText(`${f.prefix} added quality`);
    await drawer.screenshot({ path: info.outputPath(`performance-changes-goal-approved-${info.project.name}.png`) });
  });

  test('PIP actual employee/cycle selects and every V3 role action through final result', async ({ page, request, changes }, info) => {
    const { f } = changes;
    await login(page, changes, 'manager', '/improvement-plans');
    await page.getByRole('button', { name: L.newPip, exact: true }).click();
    const create = page.getByRole('dialog', { name: L.createPip, exact: true });
    await pick(page, create, L.employee, `${f.actors.employee.name} \u00b7 ${f.actors.employee.employeeNo} \u00b7 ${f.prefix}`);
    await pick(page, create, L.linkedCycle, `${f.prefix}_main`);
    await create.getByRole('textbox', { name: L.background, exact: true }).fill(`${f.prefix} synthetic improvement with long fictional delivery background`);
    await create.getByRole('textbox', { name: L.name1, exact: true }).fill(`${f.prefix} delivery quality`);
    await create.getByRole('textbox', { name: L.description1, exact: true }).fill('Verify every fictional delivery against the synthetic checklist');
    await create.getByRole('spinbutton', { name: L.weight1, exact: true }).fill('100');
    await fits(page, create, L.save);
    let plan = await uiWrite<Plan>(page, 'POST', '/improvement-plans', () => create.getByRole('button', { name: L.save, exact: true }).click(), 201);
    expect(plan).toMatchObject({ workflowVersion: 3, status: 'draft', revision: 0, workflowIssue: null });
    const drawer = page.getByTestId('business-detail-drawer');
    await expect(drawer.getByRole('textbox', { name: L.background, exact: true })).toHaveValue(`${f.prefix} synthetic improvement with long fictional delivery background`);
    await fits(page, drawer, L.submitGoals);
    const saved = page.waitForResponse(response => response.url() === `${origin}/api/v1${planPath(plan)}` && response.request().method() === 'PATCH');
    plan = await uiWrite<Plan>(page, 'POST', planPath(plan, 'submit-goals'), () => drawer.getByRole('button', { name: L.submitGoals, exact: true }).click(), 200, plan.revision + 1);
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().postDataJSON().expectedRevision).toBe(0);
    expect(plan.status).toBe('goal_employee_confirm');
    for (const [role, status, next] of [
      ['employee', 'goal_employee_confirm', 'goal_dept_review'], ['head', 'goal_dept_review', 'goal_hr_review'],
      ['hr2', 'goal_hr_review', 'goal_vp_review'], ['vp', 'goal_vp_review', 'self_eval'],
    ] as const) {
      await login(page, changes, role, planPath(plan));
      const detail = await api<Plan>(request, changes, role, 'GET', planPath(plan));
      expect(detail.status).toBe(status);
      expect(detail.allowedActions).toContain('decide_goals');
      await fits(page, drawer, L.confirmGoals);
      await drawer.getByRole('button', { name: L.confirmGoals, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: L.confirmGoals, exact: true });
      plan = await uiWrite<Plan>(page, 'POST', planPath(plan, 'decide-goals'), () => dialog.getByRole('button', { name: L.confirmGoals, exact: true }).click(), 200, detail.revision);
      expect(plan.status).toBe(next);
      await expect(dialog).toBeHidden();
    }
    for (const [role, status, next, button, score] of [
      ['employee', 'self_eval', 'manager_review', L.employeeEval, 70],
      ['manager', 'manager_review', 'dept_review', L.managerEval, 80],
      ['head', 'dept_review', 'vp_review', L.headEval, 90],
    ] as const) {
      await login(page, changes, role, planPath(plan));
      const detail = await api<Plan>(request, changes, role, 'GET', planPath(plan));
      expect(detail.status).toBe(status);
      await drawer.getByRole('spinbutton', { name: L.score1, exact: true }).fill(String(score));
      await drawer.getByRole('textbox', { name: L.comment1, exact: true }).fill(`${f.prefix} ${role} synthetic evidence`);
      await drawer.getByRole('textbox', { name: L.overall, exact: true }).fill(`${f.prefix} ${role} overall synthetic evaluation`);
      await fits(page, drawer, button);
      plan = await uiWrite<Plan>(page, 'POST', planPath(plan, 'evaluate'), () => drawer.getByRole('button', { name: button, exact: true }).click(), 200, detail.revision);
      expect(plan.status).toBe(next);
    }
    await login(page, changes, 'vp', planPath(plan));
    await fits(page, drawer, L.final);
    await drawer.getByRole('button', { name: L.final, exact: true }).click();
    const finalDialog = page.getByRole('dialog', { name: L.final, exact: true });
    plan = await uiWrite<Plan>(page, 'POST', planPath(plan, 'decide-final'), () => finalDialog.getByRole('button', { name: L.confirmFinal, exact: true }).click(), 200, plan.revision);
    expect(plan).toMatchObject({ status: 'completed', finalScore: 90 });
    await expect(finalDialog).toBeHidden();
    await login(page, changes, 'employee', planPath(plan));
    await expect(drawer).toContainText(f.actors.employee.name);
    await expect(drawer).toContainText(`${f.prefix} delivery quality`);
    await expect(drawer.getByRole('button', { name: L.employeeEval, exact: true })).toHaveCount(0);
    const completed = await api<Plan>(request, changes, 'employee', 'GET', planPath(plan));
    expect(completed).toMatchObject({ status: 'completed', finalScore: 90 });
    expect(state(f).plans.find(row => row.id === plan.id)).toMatchObject({ status: 'completed', workflowVersion: 3, finalScore: 90 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await drawer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await drawer.screenshot({ path: info.outputPath(`performance-changes-pip-completed-${info.project.name}.png`) });
  });
});
