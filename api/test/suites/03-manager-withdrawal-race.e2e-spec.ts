import { SysRole, TaskStatus } from '@prisma/client';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Manager withdrawal transition race', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  it('allows only withdrawal or department review to commit for one PostgreSQL row version', async () => {
    const dept = await factory.getSeedDept();
    const manager = await factory.createUser({
      employeeNo: 'RACE-MGR',
      name: 'Race Manager',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const deptHead = await factory.createUser({
      employeeNo: 'RACE-HEAD',
      name: 'Race Department Head',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const employee = await factory.createUser({
      employeeNo: 'RACE-EMP',
      name: 'Race Employee',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    const managerToken = await login(app.http, {
      employeeNo: 'RACE-MGR',
      password: 'test123',
    });
    const headToken = await login(app.http, {
      employeeNo: 'RACE-HEAD',
      password: 'test123',
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const task = await factory.createTaskInStatus({
        employeeId: employee.id,
        managerId: manager.id,
        deptHeadId: deptHead.id,
        status: TaskStatus.dept_review,
        deptId: dept.id,
        hasManagerScore: true,
      });
      const managerScoredAt = new Date(Date.now() - 1000);
      await app.prisma.gradeResult.update({
        where: { taskId: task.id },
        data: {
          calibratedGrade: null,
          calibrationNote: null,
          coefficient: null,
          hrCalibratorId: null,
          hrCalibratedAt: null,
        },
      });
      await app.prisma.managerEvalSummary.create({
        data: { taskId: task.id, submittedAt: managerScoredAt },
      });
      await app.prisma.assessmentTask.update({
        where: { id: task.id },
        data: { managerScoredAt },
      });

      const detail = await app.http
        .get(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const expectedUpdatedAt = detail.body.data.updatedAt as string;

      const [withdrawal, review] = await Promise.all([
        app.http
          .post(`/api/v1/tasks/${task.id}/manager-score/withdraw`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ expectedUpdatedAt }),
        app.http
          .post(`/api/v1/tasks/${task.id}/dept-review`)
          .set('Authorization', `Bearer ${headToken}`)
          .send({ action: 'approve', comment: 'Concurrent approval' }),
      ]);

      expect([withdrawal.status, review.status].sort()).toEqual([200, 409]);
      const conflict = withdrawal.status === 409 ? withdrawal : review;
      expect(conflict.body.code).toBe(4009);

      const persisted = await app.prisma.assessmentTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { status: true },
      });
      const [withdrawFlows, reviewFlows] = await Promise.all([
        app.prisma.flowRecord.count({
          where: {
            taskId: task.id,
            nodeType: 'manager_score',
            action: 'withdraw',
          },
        }),
        app.prisma.flowRecord.count({
          where: {
            taskId: task.id,
            nodeType: 'dept_review',
            action: 'approve',
          },
        }),
      ]);

      if (withdrawal.status === 200) {
        expect(persisted.status).toBe(TaskStatus.manager_scoring);
        expect([withdrawFlows, reviewFlows]).toEqual([1, 0]);
      } else {
        expect(persisted.status).toBe(TaskStatus.hr_calibration);
        expect([withdrawFlows, reviewFlows]).toEqual([0, 1]);
      }
    }
  });
});
