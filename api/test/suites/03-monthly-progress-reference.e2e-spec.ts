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
import { CalibrationService } from '@/calibration/calibration.service';
import { ApprovalService } from '@/approval/approval.service';
import { PublishService } from '@/publish/publish.service';

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
  let cycleOwner: AuthUser;
  let approver: AuthUser;
  let administrator: AuthUser;
  let publisher: AuthUser;
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
    [cycleOwner, approver, administrator, publisher] = await Promise.all([
      createRole('CYCLE-OWNER', SysRole.employee), createRole('APPROVER', SysRole.employee),
      createRole('ADMIN', SysRole.system_admin), createRole('PUBLISHER', SysRole.hr),
    ]);
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function createRole(label: string, sysRole: SysRole): Promise<AuthUser> {
    const user = await factory.createUser({ employeeNo: `MONTHLY-REF-${label}`, name: `Virtual ${label}`, sysRole, deptId, password: randomUUID() });
    return { id: user.id, name: user.name, sysRole, deptId, isAssessorOnly: false, canViewAll: false };
  }

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

  async function completedMonthlyFixture() {
    const data = await fixture();
    const completedAt = new Date();
    await prisma.assessmentCycle.update({ where: { id: data.cycle.id }, data: { status: 'manager_score', hrOwnerId: cycleOwner.id } });
    await prisma.assessmentTask.update({ where: { id: data.task.id }, data: { status: 'manager_scoring', deptHeadId: manager.id, approverId: approver.id } });
    for (const [index, period] of data.periods.entries()) {
      await prisma.assessmentPeriod.update({ where: { id: period.id }, data: {
        status: 'completed', employeeSubmittedAt: completedAt, managerSubmittedAt: completedAt, lockedAt: completedAt,
        selfScoreTotal: 80 + index, managerScoreTotal: [80, 85, 90][index], selfGrade: 'B', managerGrade: 'B',
      } });
    }
    return data;
  }

  async function taskEvidence(taskId: string) {
    const [task, periods, records] = await Promise.all([
      prisma.assessmentTask.findUniqueOrThrow({ where: { id: taskId }, include: { gradeResult: true } }),
      prisma.assessmentPeriod.findMany({ where: { taskId }, orderBy: { sequence: 'asc' } }),
      prisma.flowRecord.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { task, periods, records };
  }

  async function expectBlockedBy(backendPid: number) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${backendPid}::int = ANY(pg_blocking_pids(pid))
      `;
      if (Number(rows[0].count) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected the competing operation to wait on the isolated task lock');
  }

  it.each(['manager', 'administrator'])('persists both combined-review flow records with the actual %s actor and leaves months unchanged', async (actorRole) => {
    const data = await completedMonthlyFixture();
    const before = await taskEvidence(data.task.id);
    const actor = actorRole === 'manager' ? manager : administrator;
    const final = new FinalGradeService(prisma, flow, notifications);
    expect(await final.getFinalGrade(data.task.id, actor)).toMatchObject({ departmentReview: { combined: true, reviewerName: manager.name } });
    expect(await final.submitFinalGrade(data.task.id, { grade: 'C', comment: '独立周期判断，保留月度依据。' }, actor)).toMatchObject({ status: 'hr_calibration', grade: 'C' });
    const after = await taskEvidence(data.task.id);
    expect(after.periods).toEqual(before.periods);
    expect(after.task).toMatchObject({ status: 'hr_calibration', approvedAt: null, publishedAt: null });
    expect(after.task.deptReviewedAt).toBeInstanceOf(Date);
    expect(after.task.managerScoredAt).toBeInstanceOf(Date);
    expect(after.task.gradeResult).toMatchObject({ rawGrade: 'C', calculatedScore: new Prisma.Decimal(85), hrCalibratedAt: null, approvedAt: null, isPublished: false });
    expect(after.records).toHaveLength(2);
    expect(after.records.find(record => record.nodeType === 'manager_score')).toMatchObject({ actorId: actor.id, action: 'submit', extraData: { type: 'final_grade_submitted', grade: 'C', calculatedScore: 85, comment: '独立周期判断，保留月度依据。' } });
    expect(after.records.find(record => record.nodeType === 'dept_review')).toMatchObject({ actorId: actor.id, action: 'approve', extraData: { type: 'combined_department_review', managerId: manager.id, deptHeadId: manager.id } });
  });

  it('rolls back both real transitions, the grade and cycle stage when the second audit insert violates its actor foreign key', async () => {
    const data = await completedMonthlyFixture();
    const before = await taskEvidence(data.task.id);
    const beforeCycle = await prisma.assessmentCycle.findUniqueOrThrow({ where: { id: data.cycle.id } });
    const absentActor = randomUUID();
    // Inject a real PostgreSQL FK failure only at the second audit insert. Every
    // preceding task, grade and cycle write runs through the real transaction.
    const failingPrisma = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property);
        return (handler: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => handler(new Proxy(tx, {
          get(client, member) {
            if (member !== 'flowRecord') return Reflect.get(client, member);
            return new Proxy(client.flowRecord, {
              get(delegate, action) {
                if (action !== 'create') return Reflect.get(delegate, action);
                return (args: Omit<Prisma.FlowRecordCreateArgs, 'data'> & { data: Prisma.FlowRecordUncheckedCreateInput }) => delegate.create({ ...args, data: args.data.nodeType === 'dept_review' ? { ...args.data, actorId: absentActor } : args.data });
              },
            });
          },
        })));
      },
    });
    await expect(new FinalGradeService(failingPrisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'C' }, manager)).rejects.toMatchObject({ code: 'P2003' });
    expect(await taskEvidence(data.task.id)).toEqual(before);
    expect(await prisma.assessmentCycle.findUniqueOrThrow({ where: { id: data.cycle.id } })).toEqual(beforeCycle);
  });

  it('serializes concurrent combined submissions so one grade and exactly two flow records commit', async () => {
    const data = await completedMonthlyFixture();
    const before = await taskEvidence(data.task.id);
    const locked = signal();
    const release = signal();
    let backendPid: number | undefined;
    const holdingPrisma = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property);
        return (handler: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => handler(new Proxy(tx, {
          get(client, member) {
            if (member !== 'assessmentTask') return Reflect.get(client, member);
            return new Proxy(client.assessmentTask, {
              get(delegate, action) {
                if (action !== 'updateMany') return Reflect.get(delegate, action);
                return async (args: Prisma.AssessmentTaskUpdateManyArgs) => {
                  const result = await delegate.updateMany(args);
                  if (args.where?.id === data.task.id) {
                    backendPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
                    locked.resolve();
                    await release.promise;
                  }
                  return result;
                };
              },
            });
          },
        })), { timeout: 10000, maxWait: 3000 });
      },
    });
    const winner = new FinalGradeService(holdingPrisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'B' }, manager);
    const winnerOutcome = winner.then(value => ({ status: 'fulfilled' as const, value }), reason => { locked.resolve(); return { status: 'rejected' as const, reason }; });
    let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await locked.promise;
      expect(backendPid).toBeDefined();
      const loser = new FinalGradeService(prisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'A' }, manager);
      outcomes = Promise.allSettled([winner, loser]);
      await expectBlockedBy(backendPid!);
      release.resolve();
      const [submitted, conflicted] = await outcomes;
      expect(submitted.status).toBe('fulfilled');
      expect(conflicted.status).toBe('rejected');
      if (conflicted.status === 'rejected') expect(conflicted.reason).toBeInstanceOf(ConflictException);
      const after = await taskEvidence(data.task.id);
      expect(after.records).toHaveLength(2);
      expect(after.task.gradeResult?.rawGrade).toBe('B');
      expect(after.task.status).toBe('hr_calibration');
      expect(after.periods).toEqual(before.periods);
    } finally {
      release.resolve();
      await winnerOutcome;
      await outcomes;
    }
  });

  it('lets an assigned ordinary cycle owner confirm another employee and keeps approval and publication independent', async () => {
    const data = await completedMonthlyFixture();
    const final = new FinalGradeService(prisma, flow, notifications);
    const calibration = new CalibrationService(prisma, flow, notifications);
    const approval = new ApprovalService(prisma, flow, notifications);
    const publication = new PublishService(prisma, flow, notifications);
    await final.submitFinalGrade(data.task.id, { grade: 'C' }, manager);
    expect(cycleOwner.sysRole).toBe('employee');
    expect(await calibration.getCandidateDetail(data.cycle.id, data.task.id, cycleOwner)).toMatchObject({ calculatedScore: 85, finalGrade: 'C' });
    expect((await calibration.getWorkbench(data.cycle.id, cycleOwner)).items[0]).toMatchObject({ taskId: data.task.id, canCalibrate: true, canViewDetail: true });
    const beforePeriods = (await taskEvidence(data.task.id)).periods;
    expect(await calibration.confirm(data.cycle.id, { taskIds: [data.task.id] }, cycleOwner)).toMatchObject({ updated: 1 });
    const calibrated = await taskEvidence(data.task.id);
    expect(calibrated.task).toMatchObject({ status: 'approval', approvedAt: null, publishedAt: null });
    expect(calibrated.task.gradeResult).toMatchObject({ rawGrade: 'C', calculatedScore: new Prisma.Decimal(85), hrCalibratorId: cycleOwner.id, approvedAt: null, isPublished: false });
    expect(calibrated.records.filter(record => record.nodeType === 'hr_calibration')).toHaveLength(1);
    expect(calibrated.records.some(record => record.nodeType === 'approval' || record.nodeType === 'publish')).toBe(false);
    await expect(publication.publishCycle(data.cycle.id, { taskIds: [data.task.id], sendDingtalkNotification: false }, publisher)).rejects.toBeInstanceOf(ConflictException);
    await expect(approval.approveTasks(data.cycle.id, { taskIds: [data.task.id] }, cycleOwner)).rejects.toBeInstanceOf(ConflictException);
    expect(await approval.approveTasks(data.cycle.id, { taskIds: [data.task.id] }, approver)).toEqual({ approved: 1 });
    const approved = await taskEvidence(data.task.id);
    expect(approved.task).toMatchObject({ status: 'approval', publishedAt: null });
    expect(approved.task.approvedAt).toBeInstanceOf(Date);
    expect(approved.task.gradeResult).toMatchObject({ approverId: approver.id, isPublished: false });
    expect(approved.records.some(record => record.nodeType === 'publish')).toBe(false);
    expect(await publication.publishCycle(data.cycle.id, { taskIds: [data.task.id], sendDingtalkNotification: false }, publisher)).toMatchObject({ published: 1 });
    const published = await taskEvidence(data.task.id);
    expect(published.task.status).toBe('published');
    expect(published.task.gradeResult).toMatchObject({ rawGrade: 'C', isPublished: true });
    expect(published.records.find(record => record.nodeType === 'publish')).toMatchObject({ actorId: publisher.id, action: 'approve' });
    expect(published.periods).toEqual(beforePeriods);
  });

  it('redacts the cycle owner own result and rejects own or mixed-batch decisions without any writes', async () => {
    const data = await completedMonthlyFixture();
    await new FinalGradeService(prisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'B' }, manager);
    const ownTask = await factory.createTaskInStatus({ cycleId: data.cycle.id, employeeId: cycleOwner.id, managerId: manager.id, deptHeadId: manager.id, approverId: approver.id, deptId, status: 'hr_calibration', hasManagerScore: true, rawGrade: 'A', calculatedScore: 99 });
    const calibration = new CalibrationService(prisma, flow, notifications);
    const workbench = await calibration.getWorkbench(data.cycle.id, cycleOwner);
    expect(workbench.items.find(row => row.taskId === ownTask.id)).toMatchObject({ canCalibrate: false, canViewDetail: false, calculatedScore: null, rawGrade: null });
    expect(workbench.gradeDistribution.A.count).toBe(0);
    expect(workbench.gradeDistribution.B.count).toBe(1);
    expect(await calibration.getGradeDistribution(data.cycle.id, cycleOwner)).toMatchObject({ total: 1, A: { count: 0 }, B: { count: 1 } });
    const beforeOwn = await taskEvidence(ownTask.id);
    const beforeOther = await taskEvidence(data.task.id);
    await expect(calibration.getCandidateDetail(data.cycle.id, ownTask.id, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    for (const taskIds of [[ownTask.id], [data.task.id, ownTask.id]]) {
      await expect(calibration.confirm(data.cycle.id, { taskIds }, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(calibration.reject(data.cycle.id, { taskIds, reason: '测试边界' }, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await taskEvidence(ownTask.id)).toEqual(beforeOwn);
    expect(await taskEvidence(data.task.id)).toEqual(beforeOther);
  });

  it('rejects every calibration read and write for an unrelated cycle even when the viewer created it', async () => {
    const data = await completedMonthlyFixture();
    await prisma.assessmentCycle.update({ where: { id: data.cycle.id }, data: { createdBy: cycleOwner.id, hrOwnerId: manager.id } });
    await new FinalGradeService(prisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'B' }, manager);
    const calibration = new CalibrationService(prisma, flow, notifications);
    const before = await taskEvidence(data.task.id);
    expect((await calibration.listCycles(cycleOwner)).some(cycle => cycle.id === data.cycle.id)).toBe(false);
    await expect(calibration.getWorkbench(data.cycle.id, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(calibration.getGradeDistribution(data.cycle.id, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(calibration.getCandidateDetail(data.cycle.id, data.task.id, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(calibration.confirm(data.cycle.id, { taskIds: [data.task.id] }, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(calibration.reject(data.cycle.id, { taskIds: [data.task.id], reason: '无关周期不可退回' }, cycleOwner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await taskEvidence(data.task.id)).toEqual(before);
  });

  it('lets the cycle owner return another employee to re-evaluation while preserving monthly scores and the submitted grade', async () => {
    const data = await completedMonthlyFixture();
    await new FinalGradeService(prisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'C', comment: '需要补充周期依据' }, manager);
    const before = await taskEvidence(data.task.id);
    const calibration = new CalibrationService(prisma, flow, notifications);
    expect(await calibration.reject(data.cycle.id, { taskIds: [data.task.id], reason: '请补充周期评语' }, cycleOwner)).toMatchObject({ updated: 1 });
    const after = await taskEvidence(data.task.id);
    expect(after.task.status).toBe('manager_scoring');
    expect(after.task.gradeResult).toEqual(before.task.gradeResult);
    expect(after.periods).toEqual(before.periods);
    expect(after.records.find(record => record.nodeType === 'hr_calibration')).toMatchObject({ actorId: cycleOwner.id, action: 'reject', comment: '请补充周期评语' });
    expect(await new FinalGradeService(prisma, flow, notifications).getFinalGrade(data.task.id, manager)).toMatchObject({ currentGrade: 'C', comment: '需要补充周期依据', canSubmit: true });
  });

  it('revokes a waiting calibration request when the cycle owner changes before its task lock is acquired', async () => {
    const data = await completedMonthlyFixture();
    await new FinalGradeService(prisma, flow, notifications).submitFinalGrade(data.task.id, { grade: 'B' }, manager);
    const before = await taskEvidence(data.task.id);
    const locked = signal();
    const release = signal();
    let backendPid: number | undefined;
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "assessment_tasks" WHERE "id" = ${data.task.id}::uuid FOR NO KEY UPDATE`;
      backendPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      locked.resolve();
      await release.promise;
    }, { timeout: 10000 });
    const blockerOutcome = blocker.catch(reason => { locked.resolve(); throw reason; });
    let confirmationOutcome: Promise<unknown> | undefined;
    try {
      await locked.promise;
      expect(backendPid).toBeDefined();
      const confirmation = new CalibrationService(prisma, flow, notifications).confirm(data.cycle.id, { taskIds: [data.task.id] }, cycleOwner);
      confirmationOutcome = confirmation.then(value => ({ value }), reason => ({ reason }));
      await expectBlockedBy(backendPid!);
      await prisma.assessmentCycle.update({ where: { id: data.cycle.id }, data: { hrOwnerId: manager.id } });
      release.resolve();
      await expect(confirmation).rejects.toBeInstanceOf(ForbiddenException);
      expect(await taskEvidence(data.task.id)).toEqual(before);
    } finally {
      release.resolve();
      await blockerOutcome;
      await confirmationOutcome;
    }
  });

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
