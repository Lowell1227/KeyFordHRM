import { buildTestApp, closeTestApp, TestApp } from "../test-app";
import { FixtureFactory } from "../fixtures/fixture-factory";
import { createBulkFixture } from "../fixtures/bulk-fixture";
import { login } from "../helpers/auth-helper";
import { SysRole, CycleStatus } from "@prisma/client";
import { LaunchService } from "@/cycles/launch.service";

describe("09-scale-128", () => {
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

  async function createApproverAndHR(deptId: string, deptHeadId: string) {
    const hr = await factory.createUser({
      employeeNo: "HR001",
      name: "HR",
      sysRole: SysRole.hr,
      deptId,
      directManagerId: deptHeadId,
    });
    const approver = await factory.createUser({
      employeeNo: "VP001",
      name: "审批人",
      sysRole: SysRole.vp,
      deptId,
      directManagerId: deptHeadId,
    });
    await factory.updateDeptApprover(deptId, approver.id);
    return { hr, approver };
  }

  it("128 人 launch 生成任务且事务不超时", async () => {
    const { employeeIds, managerIds, exemptEmployeeId, deptId, deptHeadId } =
      await createBulkFixture(factory);
    const { hr } = await createApproverAndHR(deptId, deptHeadId);

    await factory.createStandardTemplate({
      name: "128模板",
      createdBy: hr.id,
      applicableDepts: [deptId],
    });
    const cycle = await factory.createCycle({
      name: "128周期",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });

    const start = Date.now();
    const result = await launchService.launch(cycle.id, {
      id: hr.id,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });
    const duration = Date.now() - start;

    expect(result.totalTasks).toBe(employeeIds.length + managerIds.length + 2); // + hr + approver
    expect(result.exemptedTasks).toBe(1);
    expect(duration).toBeLessThan(60 * 1000);

    const taskCount = await app.prisma.assessmentTask.count({
      where: { cycleId: cycle.id },
    });
    expect(taskCount).toBe(result.totalTasks);
  });

  it("批量主管评分/校准/审批/公示不超时", async () => {
    const { employeeIds, managerIds, deptId, deptHeadId } =
      await createBulkFixture(factory);
    const { hr, approver } = await createApproverAndHR(deptId, deptHeadId);

    await factory.createStandardTemplate({
      name: "128模板",
      createdBy: hr.id,
      applicableDepts: [deptId],
    });
    const cycle = await factory.createCycle({
      name: "128周期",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    await launchService.launch(cycle.id, {
      id: hr.id,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    const tasks = await app.prisma.assessmentTask.findMany({
      where: { cycleId: cycle.id, isExempt: false },
      include: {
        indicatorInstances: true,
        employee: { select: { employeeNo: true } },
      },
    });
    await app.prisma.assessmentTask.updateMany({
      where: { id: { in: tasks.map((task) => task.id) } },
      data: { status: "indicator_confirming" },
    });

    // 所有员工确认指标 + 自评
    for (const task of tasks) {
      if (!task.employee.employeeNo) continue;
      const token = await login(app.http, {
        employeeNo: task.employee.employeeNo,
        password: "test123",
      });
      await app.http
        .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      await app.http
        .post(`/api/v1/tasks/${task.id}/self-eval`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== "veto")
            .map((i) => ({ id: i.id, selfScore: 80 })),
          summary: {},
        })
        .expect(200);
    }

    // 批量主管评分：每位主管评自己的下属
    const mgrTokens: Record<string, string> = {};
    for (const mgrId of managerIds) {
      const mgr = await app.prisma.user.findUniqueOrThrow({
        where: { id: mgrId },
      });
      mgrTokens[mgrId] = await login(app.http, {
        employeeNo: mgr.employeeNo!,
        password: "test123",
      });
    }
    const deptHead = await app.prisma.user.findUniqueOrThrow({
      where: { id: deptHeadId },
    });
    mgrTokens[deptHeadId] = await login(app.http, {
      employeeNo: deptHead.employeeNo!,
      password: "test123",
    });

    const managerTaskIds = tasks
      .filter((task) => task.managerId)
      .map((task) => task.id);
    const managerScoreVersions = new Map(
      (
        await app.prisma.assessmentTask.findMany({
          where: { id: { in: managerTaskIds } },
          select: { id: true, updatedAt: true },
        })
      ).map((task) => [task.id, task.updatedAt]),
    );
    expect(managerScoreVersions.size).toBe(managerTaskIds.length);

    const startScore = Date.now();
    for (const task of tasks) {
      if (!task.managerId) continue;
      const managerScoreVersion = managerScoreVersions.get(task.id);
      if (!managerScoreVersion)
        throw new Error(`Missing manager score version for task ${task.id}`);
      await app.http
        .post(`/api/v1/tasks/${task.id}/manager-score`)
        .set("Authorization", `Bearer ${mgrTokens[task.managerId]}`)
        .send({
          expectedUpdatedAt: managerScoreVersion.toISOString(),
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== "veto")
            .map((i) => ({ id: i.id, managerScore: 85 })),
          evalSummary: {},
        })
        .expect(200);
    }
    expect(Date.now() - startScore).toBeLessThan(60 * 1000);

    // 本用例只测大批量节点性能；部门复核的权限与流转由生命周期 E2E 单独覆盖。
    await app.prisma.assessmentTask.updateMany({
      where: { cycleId: cycle.id, status: "dept_review", isExempt: false },
      data: { status: "hr_calibration" },
    });

    // 批量校准
    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });
    const calibrations = tasks.map((t) => ({
      taskId: t.id,
      calibratedGrade: "B",
      calibrationNote: "批量",
    }));
    const startCalib = Date.now();
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/calibration`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ submit: true, calibrations })
      .expect(200);
    expect(Date.now() - startCalib).toBeLessThan(60 * 1000);

    // 批量审批
    const approverToken = await login(app.http, {
      employeeNo: "VP001",
      password: "test123",
    });
    const startApproval = Date.now();
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/approval`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({
        taskIds: (
          await app.prisma.assessmentTask.findMany({
            where: { cycleId: cycle.id, status: "approval", isExempt: false },
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
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        taskIds: (
          await app.prisma.assessmentTask.findMany({
            where: { cycleId: cycle.id, status: "approval", isExempt: false },
            select: { id: true },
          })
        ).map((t) => t.id),
      })
      .expect(200);
    expect(Date.now() - startPublish).toBeLessThan(30 * 1000);
  });
});
