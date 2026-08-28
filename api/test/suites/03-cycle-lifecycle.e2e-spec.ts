import { buildTestApp, closeTestApp, TestApp } from "../test-app";
import { FixtureFactory } from "../fixtures/fixture-factory";
import { login } from "../helpers/auth-helper";
import {
  CompanyCode,
  CycleStatus,
  CycleType,
  EmploymentType,
  SysRole,
  TaskStatus,
  UserStatus,
} from "@prisma/client";
import { LaunchService } from "@/cycles/launch.service";
import { SchedulerService } from "@/scheduler/scheduler.service";
import { AuthService } from "@/auth/auth.service";

describe("03-cycle-lifecycle", () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let launchService: LaunchService;

  async function launchChecked(cycleId: string, operator: Parameters<LaunchService['launch']>[1]) {
    const checked = await launchService.preflight(cycleId);
    return launchService.launch(cycleId, operator, { expectedPlanHash: checked.planHash! });
  }

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

  async function createRoleSet() {
    const dept = await factory.getSeedDept();
    const topSupervisor = await factory.createUser({
      employeeNo: "TOP001",
      name: "考核链顶层负责人",
      sysRole: SysRole.chairman,
      deptId: dept.id,
      isAssessorOnly: true,
    });
    const hr = await factory.createUser({
      employeeNo: "HR001",
      name: "HR",
      sysRole: SysRole.hr,
      deptId: dept.id,
      directManagerId: topSupervisor.id,
    });
    const deptHead = await factory.createUser({
      employeeNo: "DEPT001",
      name: "部门负责人",
      sysRole: SysRole.dept_head,
      deptId: dept.id,
      directManagerId: topSupervisor.id,
    });
    const manager = await factory.createUser({
      employeeNo: "MGR001",
      name: "主管",
      sysRole: SysRole.manager,
      deptId: dept.id,
      directManagerId: deptHead.id,
    });
    const approver = await factory.createUser({
      employeeNo: "VP001",
      name: "审批人",
      sysRole: SysRole.vp,
      deptId: dept.id,
      directManagerId: topSupervisor.id,
    });
    const employee = await factory.createUser({
      employeeNo: "EMP001",
      name: "员工",
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });

    await factory.updateDeptLeader(dept.id, deptHead.id);
    await factory.updateDeptApprover(dept.id, approver.id);

    await app.prisma.employmentRecord.createMany({
      data: [hr, deptHead, manager, approver, employee].map((user) => ({
        userId: user.id,
        effectiveFrom: new Date("2020-01-01"),
        effectiveTo: null,
        company: CompanyCode.fuede,
        deptId: dept.id,
        directManagerId: user.directManagerId,
        employmentType: EmploymentType.full_time,
        employeeStatus: UserStatus.active,
        entryDate: new Date("2020-01-01"),
        changeType: "e2e_fixture",
        reason: "03-cycle-lifecycle current employment",
        sourceType: "e2e_fixture",
      })),
    });

    return { dept, hr, manager, deptHead, approver, employee };
  }

  async function createLaunchedCycle(hrId: string, deptId: string) {
    const template = await factory.createStandardTemplate({
      name: "生命周期模板",
      createdBy: hrId,
      applicableDepts: [deptId],
    });

    const cycle = await factory.createCycle({
      name: "生命周期周期",
      createdBy: hrId,
      status: CycleStatus.draft,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-03-31"),
      deadlineIndicatorSetting: new Date("2026-01-15"),
      deadlineIndicatorConfirm: new Date("2026-01-20"),
      deadlineSelfEval: new Date("2026-01-25"),
      deadlineManagerScore: new Date("2026-01-30"),
      deadlineHrCalibration: new Date("2026-02-05"),
      deadlineApproval: new Date("2026-02-10"),
      deadlinePublish: new Date("2026-02-15"),
    });
    await app.prisma.assessmentCycle.update({
      where: { id: cycle.id },
      data: {
        reviewerId: hrId,
        reviewStatus: "approved",
        reviewedAt: new Date("2025-12-31T00:00:00.000Z"),
      },
    });

    const launchResult = await launchChecked(cycle.id, {
      id: hrId,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    return { cycle, template, launchResult };
  }

  async function getTask(cycleId: string, employeeId: string) {
    const task = await app.prisma.assessmentTask.findFirst({
      where: { cycleId, employeeId },
      include: { indicatorInstances: true },
    });
    if (!task) throw new Error("task not found");
    return task;
  }

  async function prepareEmployeeIndicatorConfirmation(taskId: string) {
    await app.prisma.assessmentTask.update({
      where: { id: taskId },
      data: { status: TaskStatus.indicator_confirming },
    });
  }

  it("半年周期可通过 API 创建、读取、筛选并修改滚动期间", async () => {
    const enumValues = await app.prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'cycle_type'
      ORDER BY enumsortorder
    `;
    expect(enumValues.slice(0, 2).map((item) => item.enumlabel)).toEqual([
      "quarterly",
      "semiannual",
    ]);

    const { hr } = await createRoleSet();
    await factory.createCycle({
      name: "对照季度周期",
      createdBy: hr.id,
      type: CycleType.quarterly,
    });
    const hrToken = (await app.app.get(AuthService).issueToken(hr)).token;

    const created = await app.http
      .post("/api/v1/cycles")
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        name: "2027年03月—08月半年绩效考核",
        type: "semiannual",
        startDate: "2027-03-01T00:00:00.000Z",
        endDate: "2027-08-31T00:00:00.000Z",
        hrOwnerId: hr.id,
      })
      .expect(201);

    const cycleId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      type: "semiannual",
      name: "2027年03月—08月半年绩效考核",
      startDate: "2027-03-01T00:00:00.000Z",
      endDate: "2027-08-31T00:00:00.000Z",
    });

    const detail = await app.http
      .get(`/api/v1/cycles/${cycleId}`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    expect(detail.body.data.type).toBe("semiannual");

    const filtered = await app.http
      .get("/api/v1/cycles?type=semiannual&page=1&pageSize=20")
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items).toEqual([
      expect.objectContaining({ id: cycleId, type: "semiannual" }),
    ]);

    const updated = await app.http
      .patch(`/api/v1/cycles/${cycleId}`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        name: "2027年11月—2028年04月半年绩效考核",
        startDate: "2027-11-01T00:00:00.000Z",
        endDate: "2028-04-30T00:00:00.000Z",
        goalSettingOpenAt: "2027-10-20T01:00:00.000Z",
        selfEvalOpenAt: "2028-05-01T01:00:00.000Z",
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      id: cycleId,
      type: "semiannual",
      name: "2027年11月—2028年04月半年绩效考核",
      startDate: "2027-11-01T00:00:00.000Z",
      endDate: "2028-04-30T00:00:00.000Z",
    });
  });

  it("建周期→launch→全员生成任务 + 快照绑定 + exempt 标记", async () => {
    const { dept, hr, employee } = await createRoleSet();
    const exemptEmp = await factory.createUser({
      employeeNo: "EXEMPT001",
      name: "豁免员工",
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: employee.directManagerId ?? undefined,
      entryDate: new Date("2026-03-20"),
    });

    const { cycle, launchResult } = await createLaunchedCycle(hr.id, dept.id);

    expect(launchResult.totalTasks).toBe(6); // hr + manager + deptHead + approver + employee + exemptEmp
    expect(launchResult.exemptedTasks).toBe(1);

    const task = await getTask(cycle.id, employee.id);
    expect(task.status).toBe("indicator_drafting");
    expect(task.snapshotId).toBeDefined();

    const exemptTask = await app.prisma.assessmentTask.findFirst({
      where: { cycleId: cycle.id, employeeId: exemptEmp.id },
    });
    expect(exemptTask?.status).toBe("exempted");
    expect(exemptTask?.isExempt).toBe(true);
  });

  it("指标确认→退回→确认 正常流转", async () => {
    const { dept, hr, employee } = await createRoleSet();
    const { cycle } = await createLaunchedCycle(hr.id, dept.id);
    const task = await getTask(cycle.id, employee.id);
    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    await prepareEmployeeIndicatorConfirmation(task.id);

    // 退回
    const rejectRes = await app.http
      .post(`/api/v1/tasks/${task.id}/indicators/reject`)
      .set("Authorization", `Bearer ${empToken}`)
      .send({ comment: "指标不合理" })
      .expect(200);
    expect(rejectRes.body.data.status).toBe("indicator_reviewing");

    // 主管复核完成后，员工重新确认。主管审核接口由团队工作区 E2E 单独覆盖。
    await prepareEmployeeIndicatorConfirmation(task.id);
    const confirmRes = await app.http
      .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);
    expect(confirmRes.body.data.status).toBe("self_eval");
  });

  it("完整 happy path：自评→主管评分→部门复核→HR校准→审批→公示→员工确认", async () => {
    const { dept, hr, manager, deptHead, approver, employee } =
      await createRoleSet();
    const { cycle } = await createLaunchedCycle(hr.id, dept.id);
    const task = await getTask(cycle.id, employee.id);
    await prepareEmployeeIndicatorConfirmation(task.id);

    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    const mgrToken = await login(app.http, {
      employeeNo: "MGR001",
      password: "test123",
    });
    const headToken = await login(app.http, {
      employeeNo: "DEPT001",
      password: "test123",
    });
    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });
    const approverToken = await login(app.http, {
      employeeNo: "VP001",
      password: "test123",
    });

    // 1. 指标确认
    await app.http
      .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);

    // 2. 自评
    const instances = task.indicatorInstances;
    await app.http
      .post(`/api/v1/tasks/${task.id}/self-eval`)
      .set("Authorization", `Bearer ${empToken}`)
      .send({
        indicators: instances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({ id: i.id, selfScore: 80, selfComment: "自评说明" })),
        summary: { achievements: "完成目标" },
      })
      .expect(200);

    // 3. 主管评分
    const managerScoreVersion =
      await app.prisma.assessmentTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { updatedAt: true },
      });
    const scoreRes = await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({
        expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(),
        indicators: instances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({
            id: i.id,
            managerScore: 85,
            managerComment: "主管评语",
          })),
        evalSummary: { strengths: "表现好" },
      })
      .expect(200);
    expect(scoreRes.body.data.status).toBe("dept_review");

    // 4. 部门复核通过
    const reviewRes = await app.http
      .post(`/api/v1/tasks/${task.id}/dept-review`)
      .set("Authorization", `Bearer ${headToken}`)
      .send({ action: "approve", comment: "通过" })
      .expect(200);
    expect(reviewRes.body.data.status).toBe("hr_calibration");

    // 5. HR 校准并提交
    const calibrateRes = await app.http
      .post(`/api/v1/cycles/${cycle.id}/calibration`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        submit: true,
        calibrations: [
          {
            taskId: task.id,
            calibratedGrade: "B",
            calibrationNote: "校准说明",
          },
        ],
      })
      .expect(200);
    expect(calibrateRes.body.data.submit).toBe(true);

    const taskAfterCalibrate = await app.prisma.assessmentTask.findUnique({
      where: { id: task.id },
    });
    expect(taskAfterCalibrate?.status).toBe("approval");

    // 6. 审批人通过
    const approvalRes = await app.http
      .post(`/api/v1/cycles/${cycle.id}/approval`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ taskIds: [task.id], comment: "同意" })
      .expect(200);
    expect(approvalRes.body.data.approved).toBe(1);

    // 7. 公示
    const publishRes = await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ taskIds: [task.id], sendDingtalkNotification: false })
      .expect(200);
    expect(publishRes.body.data.published).toBe(1);

    // 8. 员工确认
    const confirmRes = await app.http
      .post(`/api/v1/tasks/${task.id}/employee-confirm`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);
    expect(confirmRes.body.data.status).toBe("confirmed");
  });

  it("部门复核退回回到 manager_scoring", async () => {
    const { dept, hr, manager, deptHead, employee } = await createRoleSet();
    const { cycle } = await createLaunchedCycle(hr.id, dept.id);
    const task = await getTask(cycle.id, employee.id);
    await prepareEmployeeIndicatorConfirmation(task.id);

    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    const mgrToken = await login(app.http, {
      employeeNo: "MGR001",
      password: "test123",
    });
    const headToken = await login(app.http, {
      employeeNo: "DEPT001",
      password: "test123",
    });

    await app.http
      .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);

    await app.http
      .post(`/api/v1/tasks/${task.id}/self-eval`)
      .set("Authorization", `Bearer ${empToken}`)
      .send({
        indicators: task.indicatorInstances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({ id: i.id, selfScore: 80 })),
        summary: {},
      })
      .expect(200);

    const managerScoreVersion =
      await app.prisma.assessmentTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { updatedAt: true },
      });
    await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({
        expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(),
        indicators: task.indicatorInstances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({ id: i.id, managerScore: 85 })),
        evalSummary: {},
      })
      .expect(200);

    const rejectRes = await app.http
      .post(`/api/v1/tasks/${task.id}/dept-review`)
      .set("Authorization", `Bearer ${headToken}`)
      .send({ action: "reject", comment: "退回" })
      .expect(200);
    expect(rejectRes.body.data.status).toBe("manager_scoring");
  });

  it("关周期：完成任务归档，无等级任务跳过，重复跑幂等", async () => {
    const { dept, hr, manager, deptHead, approver, employee } =
      await createRoleSet();
    const { cycle } = await createLaunchedCycle(hr.id, dept.id);
    const task = await getTask(cycle.id, employee.id);
    await prepareEmployeeIndicatorConfirmation(task.id);

    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    const mgrToken = await login(app.http, {
      employeeNo: "MGR001",
      password: "test123",
    });
    const headToken = await login(app.http, {
      employeeNo: "DEPT001",
      password: "test123",
    });
    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });
    const approverToken = await login(app.http, {
      employeeNo: "VP001",
      password: "test123",
    });

    // 推到公示
    await app.http
      .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);
    await app.http
      .post(`/api/v1/tasks/${task.id}/self-eval`)
      .set("Authorization", `Bearer ${empToken}`)
      .send({
        indicators: task.indicatorInstances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({ id: i.id, selfScore: 80 })),
        summary: {},
      })
      .expect(200);
    const managerScoreVersion =
      await app.prisma.assessmentTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { updatedAt: true },
      });
    await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({
        expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(),
        indicators: task.indicatorInstances
          .filter((i) => i.indicatorType !== "veto")
          .map((i) => ({ id: i.id, managerScore: 85 })),
        evalSummary: {},
      })
      .expect(200);
    await app.http
      .post(`/api/v1/tasks/${task.id}/dept-review`)
      .set("Authorization", `Bearer ${headToken}`)
      .send({ action: "approve" })
      .expect(200);
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/calibration`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        submit: true,
        calibrations: [{ taskId: task.id, calibratedGrade: "B" }],
      })
      .expect(200);
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/approval`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ taskIds: [task.id] })
      .expect(200);
    await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ taskIds: [task.id] })
      .expect(200);

    // 把申诉截止日改到过去，触发关周期
    await app.prisma.assessmentCycle.update({
      where: { id: cycle.id },
      data: { deadlineAppeal: new Date("2026-01-01") },
    });

    const scheduler = app.app.get(SchedulerService);
    await scheduler.runAutoCloseCycles();

    const closedCycle = await app.prisma.assessmentCycle.findUnique({
      where: { id: cycle.id },
    });
    expect(closedCycle?.status).toBe("closed");

    const closedTask = await app.prisma.assessmentTask.findUnique({
      where: { id: task.id },
    });
    expect(closedTask?.status).toBe("closed");

    const archive = await app.prisma.performanceArchive.findFirst({
      where: { cycleId: cycle.id, employeeId: employee.id },
    });
    expect(archive).toBeTruthy();
    expect(archive?.grade).toBe("B");

    // 幂等：再跑一次不报错、不新增 archive
    const archiveCountBefore = await app.prisma.performanceArchive.count({
      where: { cycleId: cycle.id },
    });
    await scheduler.runAutoCloseCycles();
    const archiveCountAfter = await app.prisma.performanceArchive.count({
      where: { cycleId: cycle.id },
    });
    expect(archiveCountAfter).toBe(archiveCountBefore);
  });
});
