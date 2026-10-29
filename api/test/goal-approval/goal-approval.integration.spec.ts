import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import express from 'express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Five step goals: isolated real HTTP/JWT/Prisma', () => {
  let app: TestApp;
  let deptId: string;
  const actors: Record<string, { id: string; token: string }> = {};
  const db = () => app.prisma;
  const auth = (actor: string) => ({ Authorization: `Bearer ${actors[actor].token}` });
  const item = { name: '虚拟目标', weight: 1, dimensionWeight: 1, indicatorType: 'kpi', targetValue: 10,
    visibilityScopes: ['supervisors'], visibleDepartmentIds: [], visibleUserIds: [], alignedObjectiveIds: [] };
  const state = (id: string) => db().assessmentTask.findUniqueOrThrow({ where: { id } });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!process.env.GOAL_TEST_RUN_ID || url.hostname !== '127.0.0.1' || url.pathname !== '/hrm_goal_approval_test'
      || !process.env.REDIS_URL?.startsWith('redis://127.0.0.1:')) throw new Error('Run only with run-isolated.cjs');
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach(job => job.stop());
    expect(await db().assessmentTask.count()).toBe(0);
    expect(await db().user.count()).toBe(0);
    deptId = (await db().department.create({ data: { name: '虚拟目标验收部门' } })).id;
    for (const name of ['employee', 'manager', 'head', 'leader', 'specialist', 'ordinaryHr', 'stranger', 'admin']) {
      const user = await db().user.create({ data: { name: `虚拟-${name}`, employeeNo: `GOAL-${name}`, deptId,
        accountType: 'service', status: 'active', sysRole: name === 'admin' ? 'hr' : ['specialist', 'ordinaryHr'].includes(name) ? 'hr_user' : 'employee',
        hrCapabilities: name === 'specialist' ? ['cycle_plan_edit', 'performance_publish'] : [] } });
      actors[name] = { id: user.id, token: (await app.app.get(AuthService).issueToken(user)).token };
    }
  });
  afterAll(async () => { if (app) await closeTestApp(app); });
  // Direct synthetic fixtures intentionally isolate state-machine edge cases from launch configuration.
  async function fixture(version = 2, overrides: Record<string, any> = {}) {
    const cycle = await db().assessmentCycle.create({ data: { name: `虚拟周期-${randomUUID()}`, startDate: new Date('2026-01-01'),
      endDate: new Date('2099-12-31'), selfEvalOpenAt: new Date('2026-01-01'), status: 'indicator_setting', workflowVersion: 2, goalWorkflowVersion: version } });
    const task = await db().assessmentTask.create({ data: { cycleId: cycle.id, employeeId: actors.employee.id, deptId,
      managerId: actors.manager.id, deptHeadId: actors.head.id, approverId: actors.leader.id, status: 'indicator_drafting', ...overrides } });
    await db().indicatorVersion.create({ data: { taskId: task.id, version: 1, effectiveFromPeriodKey: '2026-10' } });
    const period = await db().assessmentPeriod.create({ data: { taskId: task.id, periodKey: '2026-10', periodType: 'month', sequence: 1,
      periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'), selfEvalOpenAt: new Date('2026-01-01'),
      selfEvalDueAt: new Date('2099-12-01'), managerDueAt: new Date('2099-12-31'), managerId: actors.manager.id } });
    return { id: task.id, periodId: period.id, cycleId: cycle.id };
  }
  async function set(id: string, actor = 'employee', action = 'submit') {
    const r = await app.http.put(`/api/v1/tasks/${id}/indicators`).set(auth(actor)).send({ instances: [item], action,
      expectedUpdatedAt: (await state(id)).updatedAt.toISOString() });
    if (r.status !== 200) throw new Error('set: ' + r.status + ' ' + r.body.message);
    return state(id);
  }
  async function approve(id: string, actor: string, expected?: string) {
    return app.http.post(`/api/v1/tasks/${id}/indicators/approve`).set(auth(actor))
      .send({ expectedUpdatedAt: expected ?? (await state(id)).updatedAt.toISOString() });
  }
  async function okApprove(id: string, actor: string, status: string) {
    const r = await approve(id, actor);
    expect({ status: r.status, body: r.body }).toMatchObject({ status: 200, body: { data: { status } } });
  }
  async function employeePageVersion(id: string): Promise<string> {
    const page = await app.http.get(`/api/v1/tasks/${id}`).set(auth('employee')).expect(200);
    return page.body.data.updatedAt;
  }
  async function confirm(id: string, expectedUpdatedAt: string | undefined, status = 200) {
    return app.http.post(`/api/v1/tasks/${id}/indicators/confirm`).set(auth('employee'))
      .send(expectedUpdatedAt ? { expectedUpdatedAt } : {}).expect(status);
  }
  async function toLeader(id: string) {
    await set(id); await okApprove(id, 'manager', 'indicator_dept_reviewing');
    await okApprove(id, 'head', 'indicator_confirming'); await confirm(id, await employeePageVersion(id));
  }
  it('creates cycles through HTTP with new immutable goal workflow version', async () => {
    const r = await app.http.post('/api/v1/cycles').set(auth('admin')).send({ name: '虚拟新建周期', type: 'quarterly',
      startDate: '2035-01-01', endDate: '2035-03-31', goalWorkflowVersion: 1 }).expect(201);
    expect((await db().assessmentCycle.findUniqueOrThrow({ where: { id: r.body.data.id } })).goalWorkflowVersion).toBe(2);
  });
  it('runs all distinct actors, blocks execution before final approval, activates V1 and period bindings only finally', async () => {
    const f = await fixture();
    await set(f.id, 'employee', 'save');
    expect((await state(f.id)).status).toBe('indicator_drafting');
    await toLeader(f.id);
    expect(await state(f.id)).toMatchObject({ status: 'indicator_approving', indicatorConfirmedAt: expect.any(Date), goalApprovedAt: null });
    expect(await db().indicatorVersion.findFirst({ where: { taskId: f.id } })).toMatchObject({ status: 'draft' });
    expect(await db().assessmentPeriod.findUnique({ where: { id: f.periodId } })).toMatchObject({ indicatorVersionId: null });
    const indicator = await db().indicatorInstance.findFirstOrThrow({ where: { taskId: f.id } });
    await app.http.post(`/api/v1/tasks/${f.id}/self-eval`).set(auth('employee'))
      .send({ indicators: [{ id: indicator.id, selfScore: 90 }], summary: {} }).expect(409);
    await app.http.put(`/api/v1/assessment-periods/${f.periodId}/employee-draft`).set(auth('employee'))
      .send({ expectedVersion: 0, indicators: [] }).expect(409);
    await app.http.post(`/api/v1/assessment-periods/${f.periodId}/employee-submit`).set(auth('employee'))
      .send({ expectedVersion: 0, idempotencyKey: randomUUID(), selfGrade: 'B',
        indicators: [{ indicatorVersionItemId: randomUUID(), selfScore: 80 }] }).expect(409);
    await app.http.patch(`/api/v1/objectives/tracking/indicators/${indicator.id}/progress`).set(auth('employee'))
      .send({ periodId: f.periodId, progress: 50, healthStatus: 'on_track', content: '虚拟进展' }).expect(409);
    await okApprove(f.id, 'leader', 'self_eval');
    expect((await state(f.id)).goalApprovedAt).toBeInstanceOf(Date);
    const baseline = await db().indicatorVersion.findFirstOrThrow({ where: { taskId: f.id } });
    expect(baseline.status).toBe('active');
    expect(await db().indicatorVersionItem.count({ where: { indicatorVersionId: baseline.id } })).toBe(1);
    expect((await db().assessmentPeriod.findUniqueOrThrow({ where: { id: f.periodId } })).indicatorVersionId).toBe(baseline.id);
    // A narrow HTTP result-flow smoke: final goal approval still hands off to employee self-evaluation and manager scoring.
    const selfEval = await app.http.post(`/api/v1/tasks/${f.id}/self-eval`).set(auth('employee'))
      .send({ indicators: [{ id: indicator.id, selfScore: 90 }], summary: { achievements: '虚拟结果冒烟' } }).expect(200);
    expect(selfEval.body.data.status).toBe('manager_scoring');
  });
  it('manager rejection returns to employee, employee rejection returns to manager, and blank reasons are rejected', async () => {
    const f = await fixture(); await set(f.id);
    await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth('manager')).send({ comment: '   ' }).expect(400);
    await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth('manager')).send({ comment: '虚拟重填原因' }).expect(200);
    expect((await state(f.id)).status).toBe('indicator_drafting');
    await set(f.id); await okApprove(f.id, 'manager', 'indicator_dept_reviewing');
    await okApprove(f.id, 'head', 'indicator_confirming');
    await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth('employee')).send({ comment: '虚拟员工意见' }).expect(200);
    expect(await state(f.id)).toMatchObject({ status: 'indicator_reviewing', indicatorConfirmedAt: null });
  });
  it('department and leader rejection return to manager and require fresh downstream employee confirmation', async () => {
    for (const rejector of ['head', 'leader']) {
      const f = await fixture(); await set(f.id); await okApprove(f.id, 'manager', 'indicator_dept_reviewing');
      if (rejector === 'leader') { await okApprove(f.id, 'head', 'indicator_confirming'); await confirm(f.id, await employeePageVersion(f.id)); }
      await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth(rejector)).send({ comment: '虚拟调整原因' }).expect(200);
      expect(await state(f.id)).toMatchObject({ status: 'indicator_reviewing', indicatorConfirmedAt: null, goalApprovedAt: null });
      await set(f.id, 'manager', 'save');
      await okApprove(f.id, 'manager', 'indicator_dept_reviewing'); await okApprove(f.id, 'head', 'indicator_confirming');
      expect((await approve(f.id, 'leader')).status).toBe(403);
      await confirm(f.id, await employeePageVersion(f.id)); await okApprove(f.id, 'leader', 'self_eval');
    }
  });
  it('merges adjacent reviewer with both audit nodes, skips self reviewer, preserves nonconsecutive same reviewer', async () => {
    const merged = await fixture(2, { deptHeadId: actors.manager.id }); await set(merged.id);
    await okApprove(merged.id, 'manager', 'indicator_confirming');
    const records = await db().flowRecord.findMany({ where: { taskId: merged.id, actorId: actors.manager.id } });
    expect(records.map(r => r.nodeType)).toEqual(expect.arrayContaining(['indicator_setting', 'indicator_dept_review']));
    const self = await fixture(2, { managerId: actors.employee.id }); await set(self.id);
    expect((await state(self.id)).status).toBe('indicator_dept_reviewing');
    expect((await approve(self.id, 'employee')).status).toBe(403);
    const separated = await fixture(2, { approverId: actors.head.id }); await toLeader(separated.id);
    expect((await state(separated.id)).goalApprovedAt).toBeNull();
    await okApprove(separated.id, 'head', 'self_eval');
  });
  it('enforces frozen reviewer and refuses HR/admin substitute and nonreviewer edits', async () => {
    const f = await fixture(); await set(f.id);
    await db().user.update({ where: { id: actors.employee.id }, data: { directManagerId: actors.stranger.id } });
    for (const who of ['stranger', 'head', 'leader', 'specialist', 'ordinaryHr', 'admin']) expect((await approve(f.id, who)).status).toBe(403);
    await okApprove(f.id, 'manager', 'indicator_dept_reviewing');
    for (const who of ['head', 'leader', 'specialist', 'admin']) {
      await app.http.put(`/api/v1/tasks/${f.id}/indicators`).set(auth(who)).send({ action: 'save', instances: [item],
        expectedUpdatedAt: (await state(f.id)).updatedAt.toISOString() }).expect(403);
    }
  });
  it('rejects an old confirmation page after leader return and a new review round', async () => {
    const f = await fixture(); await set(f.id);
    await okApprove(f.id, 'manager', 'indicator_dept_reviewing');
    await okApprove(f.id, 'head', 'indicator_confirming');
    const roundAPageVersion = await employeePageVersion(f.id);
    await confirm(f.id, undefined, 400);
    await confirm(f.id, roundAPageVersion);
    await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth('leader'))
      .send({ comment: '虚拟第二轮修改' }).expect(200);
    await set(f.id, 'manager', 'save');
    await okApprove(f.id, 'manager', 'indicator_dept_reviewing');
    await okApprove(f.id, 'head', 'indicator_confirming');
    const roundBPageVersion = await employeePageVersion(f.id);
    expect(roundBPageVersion).not.toBe(roundAPageVersion);
    // Deliberately retain the first page version: never refresh it in the submit helper.
    await confirm(f.id, roundAPageVersion, 409);
    expect(await state(f.id)).toMatchObject({ status: 'indicator_confirming', indicatorConfirmedAt: null, goalApprovedAt: null });
    await confirm(f.id, roundBPageVersion);
    await okApprove(f.id, 'leader', 'self_eval');
  });
  it('self-manager return is editable by employee and resubmission skips self-review again', async () => {
    const f = await fixture(2, { managerId: actors.employee.id }); await set(f.id);
    expect((await state(f.id)).status).toBe('indicator_dept_reviewing');
    await app.http.post(`/api/v1/tasks/${f.id}/indicators/reject`).set(auth('head'))
      .send({ comment: '虚拟本人兼主管修改' }).expect(200);
    expect((await state(f.id)).status).toBe('indicator_drafting');
    await set(f.id, 'employee', 'save'); await set(f.id);
    expect((await state(f.id)).status).toBe('indicator_dept_reviewing');
    expect((await approve(f.id, 'employee')).status).toBe(403);
    await okApprove(f.id, 'head', 'indicator_confirming');
    await confirm(f.id, await employeePageVersion(f.id));
    await okApprove(f.id, 'leader', 'self_eval');
  });
  it('specialist sees saved drafts with goal-only projection; ordinary HR and unrelated employee cannot read', async () => {
    const f = await fixture(); await set(f.id, 'employee', 'save');
    await db().indicatorInstance.updateMany({ where: { taskId: f.id }, data: { selfScore: 88, selfComment: 'PRIVATE_RESULT_SENTINEL', managerScore: 90 } });
    await db().flowRecord.create({ data: { cycleId: f.cycleId, taskId: f.id, actorId: actors.employee.id, nodeType: 'self_eval', action: 'submit', comment: 'PRIVATE_RESULT_SENTINEL' } });
    const detail = await app.http.get(`/api/v1/goal-plans/${f.id}`).set(auth('specialist')).expect(200);
    expect(detail.body.data.permissions).toEqual({ canEdit: false, canApprove: false, canConfirm: false, canReject: false });
    expect(detail.body.data.indicatorInstances).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toMatch(/PRIVATE_RESULT_SENTINEL|selfScore|managerScore|gradeResult|selfEvalSummary/);
    const list = await app.http.get(`/api/v1/goal-plans?scope=monitor&cycleId=${f.cycleId}`).set(auth('specialist')).expect(200);
    expect(list.body.data.items.map((x: any) => x.id)).toContain(f.id);
    for (const who of ['ordinaryHr', 'stranger']) {
      await app.http.get('/api/v1/goal-plans?scope=monitor').set(auth(who)).expect(403);
      await app.http.get(`/api/v1/goal-plans/${f.id}`).set(auth(who)).expect(403);
    }
  });
  it('legacy goal version keeps manager then employee confirmation chain', async () => {
    const f = await fixture(1); await set(f.id); await set(f.id, 'manager');
    expect((await state(f.id)).status).toBe('indicator_confirming');
    await confirm(f.id, undefined);
    expect(await state(f.id)).toMatchObject({ status: 'self_eval', goalApprovedAt: null, indicatorConfirmedAt: expect.any(Date) });
    expect((await db().indicatorVersion.findFirstOrThrow({ where: { taskId: f.id } })).status).toBe('active');
  });
  it('concurrent same-stage approvals allow one success without skipping department', async () => {
    const f = await fixture(); await set(f.id);
    const timestamp = (await state(f.id)).updatedAt.toISOString();
    const responses = await Promise.all([approve(f.id, 'manager', timestamp), approve(f.id, 'manager', timestamp)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await state(f.id)).status).toBe('indicator_dept_reviewing');
  });
  it('built Web uses real specialist projection and leader approval at desktop/mobile widths', async () => {
    const { chromium } = require(resolve(__dirname, '../../../web/node_modules/playwright'));
    const dist = resolve(__dirname, '../../../web/dist');
    const output = resolve(__dirname, '../../../tmp/goal-five-step-real');
    mkdirSync(output, { recursive: true });
    const frontend = express();
    frontend.use(express.static(dist));
    frontend.get(['/tasks', '/tasks/:id'], (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    // Same-origin static shell delegates every API request to the real initialized Nest Express instance.
    frontend.use(app.app.getHttpAdapter().getInstance());
    const server = createServer(frontend);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    let browser: any;
    try {
      browser = await chromium.launch({ headless: true });
      const draft = await fixture(); await set(draft.id, 'employee', 'save');
      await db().indicatorInstance.updateMany({ where: { taskId: draft.id }, data: { selfScore: 88, selfComment: 'PRIVATE_BROWSER_RESULT_SENTINEL' } });
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        try {
          await context.addInitScript((token: string) => {
            (globalThis as any).localStorage.setItem('token', token);
            (globalThis as any).localStorage.setItem('expiresAt', String(Date.now() + 3600000));
          }, actors.specialist.token);
          const page = await context.newPage();
          const reads: string[] = [];
          page.on('request', (r: any) => { if (new URL(r.url()).pathname.startsWith('/api/v1/')) reads.push(new URL(r.url()).pathname); });
          await page.goto(`${origin}/tasks?goalView=monitor&cycleId=${draft.cycleId}`);
          await page.getByTestId('goal-plan-list').waitFor();
          const open = page.getByRole('button', { name: '查看计划', exact: true }).first();
          await open.waitFor();
          expect(await page.getByTestId('goal-plan-list').innerText()).toContain('虚拟-employee');
          await page.screenshot({ path: resolve(output, `monitor-list-${width}.png`), fullPage: true });
          await open.click();
          await page.getByTestId('goal-current-handler').waitFor();
          const detail = page.getByTestId('goal-monitor-detail');
          expect(await detail.innerText()).toContain('虚拟目标');
          expect(await detail.innerText()).not.toMatch(/PRIVATE_BROWSER_RESULT_SENTINEL|自评分|主管评分|最终得分/);
          expect(await page.getByRole('button', { name: /目标审核通过|确认指标|退回绩效上级修改|保存指标/ }).count()).toBe(0);
          expect(reads).toContain(`/api/v1/goal-plans/${draft.id}`);
          expect(reads.filter(path => path.startsWith(`/api/v1/tasks/${draft.id}`))).toEqual([]);
          expect(await page.evaluate(() => (globalThis as any).document.documentElement.scrollWidth <= (globalThis as any).innerWidth)).toBe(true);
          await page.screenshot({ path: resolve(output, `monitor-detail-${width}.png`), fullPage: true });
        } finally { await context.close(); }

      }
      for (const width of [1440, 390]) {
        const goal = await fixture(); await toLeader(goal.id);
        const leaderContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        try {
          await leaderContext.addInitScript((token: string) => {
            (globalThis as any).localStorage.setItem('token', token);
            (globalThis as any).localStorage.setItem('expiresAt', String(Date.now() + 3600000));
          }, actors.leader.token);
          const page = await leaderContext.newPage();
          const failures: string[] = [];
          page.on('response', (r: any) => { if (r.status() >= 400) failures.push(`${r.status()} ${new URL(r.url()).pathname}`); });
          page.on('pageerror', (error: Error) => failures.push(error.message));
          await page.goto(`${origin}/tasks/${goal.id}?stage=goal-confirmation`);
          const approveButton = page.getByRole('button', { name: '目标审核通过', exact: true });
          try { await approveButton.waitFor({ timeout: 10000 }); }
          catch {
            await page.screenshot({ path: resolve(output, `leader-failure-${width}.png`), fullPage: true });
            throw new Error(`Leader page: ${JSON.stringify(failures)}; text: ${(await page.locator('body').innerText()).slice(-3500)}`);
          }
          expect(await page.getByTestId('goal-stage-status').innerText()).toContain('待分管领导审核');
          expect(await page.evaluate(() => (globalThis as any).document.documentElement.scrollWidth <= (globalThis as any).innerWidth)).toBe(true);
          await page.screenshot({ path: resolve(output, `leader-before-${width}.png`), fullPage: true });
          await approveButton.click();
          const response = page.waitForResponse((r: any) => r.url().endsWith(`/tasks/${goal.id}/indicators/approve`) && r.request().method() === 'POST');
          await page.getByRole('dialog').getByRole('button', { name: '目标审核通过', exact: true }).click();
          expect((await response).status()).toBe(200);
          expect(await state(goal.id)).toMatchObject({ status: 'self_eval', goalApprovedAt: expect.any(Date) });
          await page.getByRole('dialog').waitFor({ state: 'hidden' });
          await page.screenshot({ path: resolve(output, `leader-after-${width}.png`), fullPage: true });
        } finally { await leaderContext.close(); }
      }
    } finally {
      if (browser) await browser.close();
      await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    }
  }, 120000);
});
