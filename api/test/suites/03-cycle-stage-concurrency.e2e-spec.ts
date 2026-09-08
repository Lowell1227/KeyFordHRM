import 'reflect-metadata';
import { execFileSync } from 'child_process';
import path from 'path';
import { ConflictException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AssessmentTask, SysRole, TaskStatus } from '@prisma/client';
import { FlowService } from '@/tasks/flow.service';
import { CalibrationService } from '@/calibration/calibration.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { FixtureFactory } from '../fixtures/fixture-factory';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Owns its database: never reads or migrates an externally supplied DATABASE_URL. */
describe('Cycle stage synchronization concurrency (isolated PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let flow: FlowService;
  let calibration: CalibrationService;
  let factory: FixtureFactory;
  let viewer: AuthUser;
  let deptId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_cycle_stage_concurrency')
      .withStartupTimeout(60000)
      .start();
    const databaseUrl = container.getConnectionUri();
    const apiRoot = path.resolve(__dirname, '../..');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch {
      // Child output can contain a connection URI; only report a safe diagnosis.
      throw new Error('Migrations failed in the disposable cycle-stage database');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    factory = new FixtureFactory(prisma);
    flow = new FlowService(prisma);
    calibration = new CalibrationService(prisma, flow, {
      create: async () => undefined,
    } as unknown as NotificationsService);
    const dept = await factory.createDept({ name: 'Isolated concurrency department' });
    deptId = dept.id;
    const hr = await factory.createUser({ employeeNo: 'CYCLE-RACE-HR', name: 'Virtual HR', sysRole: SysRole.hr, deptId });
    viewer = { id: hr.id, name: hr.name, sysRole: SysRole.hr, deptId, isAssessorOnly: false, canViewAll: false };
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function fixture(status: TaskStatus, count: number) {
    const cycle = await factory.createCycle({ name: `Cycle concurrency ${++sequence}`, createdBy: viewer.id, status: 'indicator_setting' });
    const tasks: AssessmentTask[] = [];
    for (let index = 0; index < count; index += 1) {
      const employee = await factory.createUser({ employeeNo: `CYCLE-RACE-${sequence}-${index}`, name: `Virtual employee ${index}`, sysRole: SysRole.employee, deptId });
      tasks.push(await factory.createTaskInStatus({ cycleId: cycle.id, employeeId: employee.id, managerId: viewer.id, deptId, status, hasManagerScore: true }));
    }
    return { cycle, tasks };
  }

  async function assertStage(cycleId: string, status: string, taskStatuses: string[]) {
    const cycle = await prisma.assessmentCycle.findUniqueOrThrow({ where: { id: cycleId } });
    const tasks = await prisma.assessmentTask.findMany({ where: { cycleId }, select: { status: true } });
    expect(cycle.status).toBe(status);
    expect(tasks.map((task) => task.status).sort()).toEqual([...taskStatuses].sort());
  }

  it('aggregates after concurrent task updates and FK inserts commit, including the last transition', async () => {
    const { cycle, tasks } = await fixture('hr_calibration', 2);
    await prisma.assessmentCycle.update({ where: { id: cycle.id }, data: { status: 'hr_calibration' } });
    const bothReady = signal();
    let arrivals = 0;
    await Promise.all(tasks.map((task) => prisma.$transaction(async (tx) => {
      const synchronizedTx = new Proxy(tx, {
        get(target, property) {
          if (property !== '$queryRaw') return Reflect.get(target, property);
          return async (...args: unknown[]) => {
            arrivals += 1;
            if (arrivals === 2) bothReady.resolve();
            await bothReady.promise;
            return (target.$queryRaw as any)(...args);
          };
        },
      });
      await flow.transitionTx(synchronizedTx, { task, action: 'submit', targetStatus: 'approval', actorId: viewer.id });
    }, { timeout: 10000, maxWait: 3000 })));
    expect(arrivals).toBe(2);
    await assertStage(cycle.id, 'approval', ['approval', 'approval']);
    expect(await prisma.flowRecord.count({ where: { cycleId: cycle.id } })).toBe(2);
  });

  it('commits a batch and a separate task without deadlock and reaches approval', async () => {
    const { cycle, tasks } = await fixture('hr_calibration', 3);
    const [batch] = await Promise.all([
      calibration.confirm(cycle.id, { taskIds: [tasks[1].id, tasks[0].id] }, viewer),
      flow.transition({ task: tasks[2], action: 'submit', targetStatus: 'approval', actorId: viewer.id }),
    ]);
    expect(batch.updated).toBe(2);
    await assertStage(cycle.id, 'approval', ['approval', 'approval', 'approval']);
    expect(await prisma.flowRecord.count({ where: { cycleId: cycle.id } })).toBe(3);
  });

  it('prelocks the batch before the cycle so an overlapping single-task winner causes a version conflict, never a deadlock', async () => {
    const { cycle, tasks } = await fixture('hr_calibration', 2);
    const ordered = [...tasks].sort((left, right) => left.id.localeCompare(right.id));
    const locked = signal();
    const finishSingle = signal();
    const single = prisma.$transaction(async (tx) => {
      await tx.assessmentTask.update({ where: { id: ordered[1].id }, data: { updatedAt: new Date(Date.now() + 1) } });
      locked.resolve();
      await finishSingle.promise;
      await flow.transitionTx(tx, { task: ordered[1], action: 'submit', targetStatus: 'approval', actorId: viewer.id });
    }, { timeout: 10000, maxWait: 3000 });
    await locked.promise;
    const batch = calibration.confirm(cycle.id, { taskIds: ordered.map((task) => task.id) }, viewer);
    // Attach rejection handlers immediately while observing the database wait graph.
    const outcomes = Promise.allSettled([single, batch]);
    try {
      const deadline = Date.now() + 2500;
      let blocked = false;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
        if (Number(rows[0].count) > 0) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      finishSingle.resolve();
    }
    const [singleResult, batchResult] = await outcomes;
    expect(singleResult.status).toBe('fulfilled');
    expect(batchResult.status).toBe('rejected');
    if (batchResult.status === 'rejected') expect(batchResult.reason).toBeInstanceOf(ConflictException);
    await assertStage(cycle.id, 'hr_calibration', ['hr_calibration', 'approval']);
    expect(await prisma.flowRecord.count({ where: { cycleId: cycle.id } })).toBe(1);
  });
});
