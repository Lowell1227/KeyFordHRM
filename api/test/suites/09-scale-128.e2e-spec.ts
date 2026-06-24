import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { createBulkFixture } from '../fixtures/bulk-fixture';
import { login } from '../helpers/auth-helper';
import { SysRole, CycleStatus } from '@prisma/client';
import { LaunchService } from '@/cycles/launch.service';

describe('09-scale-128', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let launchService: LaunchService;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
    launchService = app.app.get(LaunchService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  async function createApproverAndHR(deptId: string) {
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: deptId });
    const approver = await factory.createUser({ employeeNo: 'VP001', name: '审批人', sysRole: SysRole.vp, deptId: deptId });
    await factory.updateDeptApprover(deptId, approver.id);
    return { hr, approver };
  }

  it('128 人 launch 生成任务且事务不超时', async () => {
    const { employeeIds, managerIds, exemptEmployeeId, deptId } = await createBulkFixture(factory);
    const { hr } = await createApproverAndHR(deptId);

    await factory.createStandardTemplate({ name: '128模板', createdBy: hr.id, applicableDepts: [deptId] });
    const cycle = await factory.createCycle({ name: '128周期', createdBy: hr.id, status: CycleStatus.draft });

    const start = Date.now();
    const result = await launchService.launch(cycle.id, {
      id: hr.id,
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });
    const duration = Date.now() - start;

    expect(result.totalTasks).toBe(employeeIds.length + managerIds.length + 2); // + hr + approver
    expect(result.exemptedTasks).toBe(1);
    expect(duration).toBeLessThan(60 * 1000);

    const taskCount = await app.prisma.assessmentTask.count({ where: { cycleId: cycle.id } });
    expect(taskCount).toBe(result.totalTasks);
  });

  it('批量主管评分/校准/审批/公示不超时', async () => {
    const { employeeIds, managerIds, deptId } = await createBulkFixture(factory);
    const { hr, approver } = await createApproverAndHR(deptId);

    await factory.createStandardTemplate({ name: '128模板', createdBy: hr.id, applicableDepts: [deptId] });
    const cycle = await factory.createCycle({ name: '128周期', createdBy: hr.id, status: CycleStatus.draft });
    await launchService.launch(cycle.id, {
      id: hr.id,
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    const tasks = await app.prisma.assessmentTask.findMany({
      where: { cycleId: cycle.id, isExempt: false },
      include: { indicatorInstances: true, employee: { select: { employeeNo: true } } },
    });

    // 所有员工确认指标 + 自评
    for (const task of tasks) {
      if (!task.employee.employeeNo) continue;
      const token = await login(app.http, { employeeNo: task.employee.employeeNo, password: 'test123' });
      await app.http
        .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await app.http
        .post(`/api/v1/tasks/${task.id}/self-eval`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== 'veto')
            .map((i) => ({ id: i.id, selfScore: 80 })),
          summary: {},
        })
        .expect(200);
    }

    // 批量主管评分：每位主管评自己的下属
    const mgrTokens: Record<string, string> = {};
    for (const mgrId of managerIds) {
      const mgr = await app.prisma.user.findUniqueOrThrow({ where: { id: mgrId } });
      mgrTokens[mgrId] = await login(app.http, { employeeNo: mgr.employeeNo!, password: 'test123' });
    }

    const startScore = Date.now();
    for (const task of tasks) {
      if (!task.managerId) continue;
      await app.http
        .post(`/api/v1/tasks/${task.id}/manager-score`)
        .set('Authorization', `Bearer ${mgrTokens[task.managerId]}`)
        .send({
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== 'veto')
            .map((i) => ({ id: i.id, managerScore: 85 })),
          evalSummary: {},
        })
        .expect(200);
    }
    expect(Date.now() - startScore).toBeLessThan(60 * 1000);

    // 由于主管≠部门负责人，批量复核：简化为直接 DB 改状态为 hr_calibration（或每位主管即部门负责人）
    // 为贴近真实，把部门 leader 也设为主管之一
    await factory.updateDeptLeader(deptId, managerIds[0]);

    // 批量校准
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });
    const calibrations = tasks.map((t) => ({ taskId: t.id, calibratedGrade: 'B', calibrationNote: '批量' }));
    const startCalib = Date.now();
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/calibration`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ submit: true, calibrations })
      .expect(200);
    expect(Date.now() - startCalib).toBeLessThan(60 * 1000);

    // 批量审批
    const approverToken = await login(app.http, { employeeNo: 'VP001', password: 'test123' });
    const startApproval = Date.now();
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/approval`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        taskIds: (
          await app.prisma.assessmentTask.findMany({
            where: { cycleId: cycle.id, status: 'approval', isExempt: false },
            select: { id: true },
          })
        ).map((t) => t.id),
      })
      .expect(200);
    expect(Date.now() - startApproval).toBeLessThan(30 * 1000);

    // 批量公示
    const startPublish = Date.now();
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        taskIds: (
          await app.prisma.assessmentTask.findMany({
            where: { cycleId: cycle.id, status: 'approval', isExempt: false },
            select: { id: true },
          })
        ).map((t) => t.id),
      })
      .expect(200);
    expect(Date.now() - startPublish).toBeLessThan(30 * 1000);
  });
});
