import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AssessmentPeriod, Prisma, SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { DataScopeService } from '@/common/services/data-scope.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ObjectivesService } from '@/objectives/objectives.service';
import { shanghaiMonthKey } from '@/objectives/goal-tracking-progress';
import { PeriodReviewsService } from '@/period-reviews/period-reviews.service';
import { PeriodAggregationService } from '@/period-reviews/period-aggregation.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FlowService } from '@/tasks/flow.service';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { FinalGradeService } from '@/final-grade/final-grade.service';
import { TeamTasksService } from '@/tasks/team-tasks.service';
import { TeamTaskQueryDto } from '@/tasks/dto/team-task-query.dto';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Owns every database connection; never reads or migrates an external DATABASE_URL. */
describe('Monthly progress references (isolated PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let factory: FixtureFactory;
  let objectives: ObjectivesService;
  let reviews: PeriodReviewsService;
  let flow: FlowService;
  let manager: AuthUser;
  let deptId: string;
  let sequence = 0;
  const notifications = { create: jest.fn(async () => undefined) } as unknown as NotificationsService;
  const referenceDate = new Date();
  const [currentYear, currentMonth] = shanghaiMonthKey(referenceDate).split('-').map(Number);
  const months = [-2, -1, 0].map((offset) => {
    const start = new Date(Date.UTC(currentYear, currentMonth - 1 + offset, 1));
    const end = new Date(Date.UTC(currentYear, currentMonth + offset, 0));
    return { periodKey: start.toISOString().slice(0, 7), start, end };
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_monthly_progress_reference')
      .withStartupTimeout(60000)
      .start();
    const databaseUrl = container.getConnectionUri();
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch {
      // Migration output can contain connection credentials; keep diagnostics safe.
      throw new Error('Migrations failed in the disposable monthly-progress database');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    factory = new FixtureFactory(prisma);
    flow = new FlowService(prisma);
    objectives = new ObjectivesService(prisma, new DataScopeService(prisma));
    reviews = new PeriodReviewsService(prisma, notifications, new PeriodAggregationService(flow), flow);
    const dept = await factory.createDept({ name: 'Virtual monthly reference department' });
    deptId = dept.id;
    const user = await factory.createUser({
      employeeNo: 'MONTHLY-REF-MANAGER', name: 'Virtual direct manager',
      sysRole: SysRole.manager, deptId, password: randomUUID(),
    });
    manager = { id: user.id, name: user.name, sysRole: user.sysRole, deptId, isAssessorOnly: false, canViewAll: false };
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function fixture() {
    sequence += 1;
    const user = await factory.createUser({
      employeeNo: `MONTHLY-REF-${sequence}`, name: `Virtual employee ${sequence}`,
      sysRole: SysRole.employee, deptId, directManagerId: manager.id, password: randomUUID(),
    });
    const employee: AuthUser = { id: user.id, name: user.name, sysRole: user.sysRole, deptId, isAssessorOnly: false, canViewAll: false };
    const cycle = await factory.createCycle({
      name: `Isolated monthly references ${sequence}`, createdBy: manager.id, status: 'self_eval',
      startDate: months[0].start, endDate: months[2].end,
    });
    await prisma.assessmentCycle.update({
      where: { id: cycle.id },
      data: { workflowVersion: 2, scoringFrequency: 'monthly', monthlyFollowUpRequired: true, openedAt: months[0].start, notificationMode: 'off' },
    });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id, employeeId: employee.id, managerId: manager.id, deptId, status: 'self_eval',
    });
    await prisma.assessmentTask.update({ where: { id: task.id }, data: { indicatorConfirmedAt: months[0].start } });
    const indicator = await prisma.indicatorInstance.findFirstOrThrow({
      where: { taskId: task.id, indicatorType: 'kpi' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const version = await prisma.indicatorVersion.create({
      data: {
        taskId: task.id, version: 1, status: 'active', effectiveFromPeriodKey: months[0].periodKey,
        createdById: employee.id, activatedAt: months[0].start,
        items: { create: {
          sourceInstanceId: indicator.id, name: indicator.name, description: indicator.description,
          scoringStandard: indicator.scoringStandard, weight: new Prisma.Decimal(1),
          indicatorType: 'kpi', dimensionWeight: new Prisma.Decimal(1), sortOrder: 0,
        } },
      },
      include: { items: true },
    });
    const periods: AssessmentPeriod[] = [];
    for (const [index, month] of months.entries()) {
      periods.push(await prisma.assessmentPeriod.create({
        data: {
          taskId: task.id, periodKey: month.periodKey, periodType: 'month', sequence: index + 1,
          periodStart: month.start, periodEnd: month.end, managerId: manager.id, indicatorVersionId: version.id,
          status: 'self_eval', openedAt: months[0].start,
          selfEvalOpenAt: month.start, selfEvalDueAt: months[2].end, managerDueAt: months[2].end,
        },
      }));
    }
    return { employee, cycle, task, indicator, item: version.items[0], periods };
  }

  it('counts cycle grading as pending until submitted and persists comments through a returned re-evaluation', async () => {
    const data = await fixture();
    const doneAt = new Date();
    await prisma.assessmentTask.update({where:{id:data.task.id},data:{status:'manager_scoring'}});
    for (const [index, period] of data.periods.entries()) {
      await prisma.assessmentPeriod.update({where:{id:period.id},data:{status:'completed',employeeSubmittedAt:doneAt,managerSubmittedAt:doneAt,
        lockedAt:doneAt,selfScoreTotal:80 + index,managerScoreTotal:[80,85,90][index],selfGrade:'B',managerGrade:'B'}});
    }
    const team = new TeamTasksService(prisma, flow, notifications);
    const final = new FinalGradeService(prisma, flow, notifications);
    const query = (stageState?: string) => Object.assign(new TeamTaskQueryDto(), {stage:'manager-eval',cycleId:data.cycle.id,stageState,page:1,pageSize:20});
    const pending = await team.findAll(query('pending'),manager);
    expect(pending.counts).toEqual({all:1,pending:1,completed:0,notStarted:0,exempted:0});
    expect(pending.items[0].id).toBe(data.task.id);
    expect((await team.findAll(query(),data.employee)).items).toEqual([]);
    expect((await final.getFinalGrade(data.task.id,manager)).comment).toBeNull();
    const comment = '稳定交付。\n下周期加强风险沟通。';
    await final.submitFinalGrade(data.task.id,{grade:'A',comment},manager);
    const submitted = await final.getFinalGrade(data.task.id,manager);
    expect(submitted).toMatchObject({currentGrade:'A',calculatedScore:85,comment,canSubmit:false});
    expect((await team.findAll(query('pending'),manager)).items).toEqual([]);
    expect((await team.findAll(query('completed'),manager)).items[0].id).toBe(data.task.id);
    const completedTask = await prisma.assessmentTask.findUniqueOrThrow({where:{id:data.task.id}});
    await flow.transition({task:completedTask,action:'reject',targetStatus:'manager_scoring',actorId:manager.id,comment:'补充周期说明'});
    expect((await team.findAll(query('pending'),manager)).items[0].id).toBe(data.task.id);
    expect(await final.getFinalGrade(data.task.id,manager)).toMatchObject({currentGrade:'A',comment,canSubmit:true});
    await final.submitFinalGrade(data.task.id,{grade:'B',comment:''},manager);
    expect(await final.getFinalGrade(data.task.id,manager)).toMatchObject({currentGrade:'B',comment:null,canSubmit:false});
    expect(await prisma.flowRecord.count({where:{taskId:data.task.id,extraData:{path:['type'],equals:'final_grade_submitted'}}})).toBe(2);
    expect((await prisma.assessmentPeriod.findMany({where:{taskId:data.task.id},orderBy:{sequence:'asc'}})).map(period=>period.managerScoreTotal?.toNumber())).toEqual([80,85,90]);
  });

  it('keeps current progress current, syncs historical references without replacing grades, and freezes submitted months', async () => {
    const data = await fixture();
    const [oldest, previous, current] = data.periods;
    const startTime = Date.now();
    const currentUpdate = await objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: current.id, progress: 80, healthStatus: 'on_track', content: 'Current month delivery', expectedLatestUpdateAt: null,
    }, data.employee);
    const previousUpdate = await objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: previous.id, progress: 50, healthStatus: 'on_track', content: 'Previous month delivery', expectedLatestUpdateAt: null,
    }, data.employee);
    const oldestUpdate = await objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: oldest.id, progress: 25, healthStatus: 'at_risk', content: 'Earlier month backfill', expectedLatestUpdateAt: null,
    }, data.employee);

    const detail = await objectives.findTrackingIndicator(data.indicator.id, data.employee);
    expect(detail.progressUpdates.map((update) => update.id)).toEqual([currentUpdate.id, previousUpdate.id, oldestUpdate.id]);
    expect(detail.progressUpdates[0]).toMatchObject({ progress: 80, businessPeriodKey: current.periodKey });
    const storedBackfill = await prisma.indicatorProgressUpdate.findUniqueOrThrow({ where: { id: oldestUpdate.id } });
    expect(storedBackfill).toMatchObject({ periodId: oldest.id, periodReviewRevisionId: null });
    expect(storedBackfill.createdAt.getTime()).toBeGreaterThanOrEqual(startTime - 1000);
    expect(storedBackfill.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const historicalReview = await reviews.getReview(oldest.id, data.employee);
    expect(historicalReview.period.selfGrade).toBeNull();
    expect(historicalReview.indicators[0]).toMatchObject({
      monthlyProgressSource: 'active_progress', progress: 25, healthStatus: 'at_risk',
      employeeComment: 'Earlier month backfill', selfScore: null,
      latestProgress: { content: 'Earlier month backfill' },
    });
    expect(historicalReview.indicators[0].progressReferences.map((reference) => reference.id))
      .toEqual([currentUpdate.id, previousUpdate.id, oldestUpdate.id]);
    const currentReview = await reviews.getReview(current.id, data.employee);
    expect(currentReview.indicators[0]).toMatchObject({ progress: 80, employeeComment: 'Current month delivery', selfScore: null });

    const scoredDraft = await reviews.saveEmployeeDraft(oldest.id, {
      expectedVersion: historicalReview.period.draftVersion, selfGrade: 'B',
      indicators: [{ indicatorVersionItemId: data.item.id, selfScore: 88 }],
    }, data.employee);
    const reference = historicalReview.indicators[0].progressReferences.find((entry) => entry.id === oldestUpdate.id)!;
    const synchronizedDraft = await reviews.saveEmployeeDraft(oldest.id, {
      expectedVersion: scoredDraft.draftVersion,
      indicators: [{ indicatorVersionItemId: data.item.id,
        progress: reference.progress, healthStatus: reference.healthStatus, employeeComment: reference.content }],
    }, data.employee);
    const rereadDraft = await reviews.getReview(oldest.id, data.employee);
    expect(rereadDraft.period.selfGrade).toBe('B');
    expect(rereadDraft.indicators[0]).toMatchObject({
      monthlyProgressSource: 'draft_or_result', progress: 25, healthStatus: 'at_risk',
      employeeComment: 'Earlier month backfill', selfScore: 88,
    });

    const submitted = await reviews.submitEmployeeReview(oldest.id, {
      expectedVersion: synchronizedDraft.draftVersion, idempotencyKey: randomUUID(), selfGrade: 'B',
      indicators: [{ indicatorVersionItemId: data.item.id,
        progress: 25, healthStatus: 'at_risk', employeeComment: 'Earlier month backfill', selfScore: 88 }],
    }, data.employee);
    expect(submitted.status).toBe('manager_scoring');
    await expect(objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: oldest.id, progress: 30, healthStatus: 'on_track', content: 'Forbidden post-submit backfill',
    }, data.employee)).rejects.toBeInstanceOf(ConflictException);
    const afterSubmit = await reviews.getReview(oldest.id, data.employee);
    expect(afterSubmit.indicators[0].progressReferences.map((entry) => entry.id))
      .toEqual([currentUpdate.id, previousUpdate.id, oldestUpdate.id]);
    expect(await prisma.indicatorProgressUpdate.count({
      where: { indicatorInstanceId: data.indicator.id, periodReviewRevisionId: { not: null } },
    })).toBe(1);
    expect(await prisma.indicatorProgressUpdate.count({
      where: { indicatorInstanceId: data.indicator.id, periodReviewRevisionId: null },
    })).toBe(3);
  });

  it('allows the frozen manager to read references but rejects manager backfills', async () => {
    const data = await fixture();
    const update = await objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: data.periods[0].id, progress: 35, healthStatus: 'on_track', content: 'Owner reference for manager',
    }, data.employee);
    const result = await reviews.getReview(data.periods[0].id, manager);
    expect(result.permissions.canEditEmployee).toBe(false);
    expect(result.indicators[0].progressReferences.map((entry) => entry.id)).toEqual([update.id]);
    await expect(objectives.updateIndicatorProgress(data.indicator.id, {
      periodId: data.periods[0].id, progress: 40, healthStatus: 'on_track', content: 'Manager cannot enter owner progress',
    }, manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: data.indicator.id } })).toBe(1);
  });

  it('rejects a period from another task without writing progress or an audit entry', async () => {
    const own = await fixture();
    const other = await fixture();
    await expect(objectives.updateIndicatorProgress(own.indicator.id, {
      periodId: other.periods[0].id, progress: 40, healthStatus: 'on_track', content: 'Wrong task month',
    }, own.employee)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: own.indicator.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: own.indicator.id, action: 'progress_update' } })).toBe(0);
  });

  it('rereads a period after a real submission lock wait and rejects the losing backfill', async () => {
    const data = await fixture();
    const period = data.periods[0];
    const locked = signal();
    const finishSubmission = signal();
    let submissionPid: number | undefined;
    // Delay only after the real UPDATE has acquired the period lock; all service
    // checks, PostgreSQL writes, and submission side effects remain real.
    const submittingPrisma = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property);
        return (handler: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async (tx) => {
          const transaction = new Proxy(tx, {
            get(client, member) {
              if (member !== 'assessmentPeriod') return Reflect.get(client, member);
              return new Proxy(client.assessmentPeriod, {
                get(delegate, action) {
                  if (action !== 'updateMany') return Reflect.get(delegate, action);
                  return async (args: Prisma.AssessmentPeriodUpdateManyArgs) => {
                    const result = await delegate.updateMany(args);
                    if (args.where?.id === period.id) {
                      const backend = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
                      submissionPid = backend[0].pid;
                      locked.resolve();
                      await finishSubmission.promise;
                    }
                    return result;
                  };
                },
              });
            },
          });
          return handler(transaction);
        }, { timeout: 10000, maxWait: 3000 });
      },
    });
    const submittingReviews = new PeriodReviewsService(submittingPrisma, notifications, new PeriodAggregationService(flow), flow);
    const submission = submittingReviews.submitEmployeeReview(period.id, {
      expectedVersion: 0, idempotencyKey: randomUUID(), selfGrade: 'B',
      indicators: [{ indicatorVersionItemId: data.item.id, progress: 60, healthStatus: 'on_track',
        employeeComment: 'Submitted while another entry waits', selfScore: 86 }],
    }, data.employee);
    // Keep failures handled even if submission fails before reaching the lock.
    const submissionOutcome = submission.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => { locked.resolve(); return { status: 'rejected' as const, reason }; },
    );
    try {
      await locked.promise;
      expect(submissionPid).toBeDefined();
      const backfill = objectives.updateIndicatorProgress(data.indicator.id, {
        periodId: period.id, progress: 70, healthStatus: 'on_track', content: 'Backfill must lose to submitted review',
      }, data.employee);
      const outcomes = Promise.allSettled([submission, backfill]);
      try {
        const deadline = Date.now() + 2500;
        let blockedBySubmission = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND ${submissionPid!}::int = ANY(pg_blocking_pids(pid))
          `;
          if (Number(rows[0].count) > 0) { blockedBySubmission = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blockedBySubmission).toBe(true);
      } finally {
        finishSubmission.resolve();
      }
      const [submitted, rejectedBackfill] = await outcomes;
      expect(submitted.status).toBe('fulfilled');
      expect(rejectedBackfill.status).toBe('rejected');
      if (rejectedBackfill.status === 'rejected') expect(rejectedBackfill.reason).toBeInstanceOf(ConflictException);
      const stored = await prisma.assessmentPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(stored.status).toBe('manager_scoring');
      expect(stored.employeeSubmittedAt).not.toBeNull();
      expect(await prisma.indicatorProgressUpdate.count({
        where: { indicatorInstanceId: data.indicator.id, periodReviewRevisionId: null },
      })).toBe(0);
      expect(await prisma.indicatorProgressUpdate.count({
        where: { indicatorInstanceId: data.indicator.id, periodReviewRevisionId: { not: null } },
      })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(0);
      const result = await reviews.getReview(period.id, data.employee);
      expect(result.indicators[0].progressReferences).toEqual([]);
    } finally {
      finishSubmission.resolve();
      await submissionOutcome;
    }
  });
});
