import { Prisma, SysRole, UserStatus } from "@prisma/client";
import { AuthService } from "@/auth/auth.service";
import { FixtureFactory } from "../fixtures/fixture-factory";
import { buildTestApp, closeTestApp, TestApp } from "../test-app";

describe("Performance workflow v2 foundation", () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let originalFinalApproverConfig: unknown;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
    originalFinalApproverConfig = (
      await app.prisma.systemConfig.findUnique({
        where: { key: "performance_company_final_approver" },
        select: { value: true },
      })
    )?.value;
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  afterEach(async () => {
    await factory.resetDataTables();
    await app.prisma.systemConfig.update({
      where: { key: "performance_company_final_approver" },
      data: { value: originalFinalApproverConfig as Prisma.InputJsonValue },
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it("persists the v2 launch foundation and keeps workflow v1 launch-compatible", async () => {
    const dept = await factory.getSeedDept();
    const topLeader = await factory.createUser({
      employeeNo: "V2-TOP-001",
      name: "李宏",
      sysRole: SysRole.chairman,
      deptId: dept.id,
      canViewAll: true,
    });
    const replacementTopLeader = await factory.createUser({
      employeeNo: "V2-TOP-002",
      name: "李宏（新配置）",
      sysRole: SysRole.chairman,
      deptId: dept.id,
      canViewAll: true,
    });
    const hrAdministrator = await factory.createUser({
      employeeNo: "V2-HRA-001",
      name: "HR管理员",
      sysRole: SysRole.hr,
      deptId: dept.id,
      directManagerId: topLeader.id,
    });
    const cycleHr = await factory.createUser({
      employeeNo: "V2-HR-001",
      name: "周期HR",
      sysRole: SysRole.hr_user,
      deptId: dept.id,
      directManagerId: topLeader.id,
    });
    const hr = await app.prisma.user.update({
      where: { id: cycleHr.id },
      data: { hrCapabilities: ["cycle_plan_edit"] },
    });
    const departmentHead = await factory.createUser({
      employeeNo: "V2-HEAD-001",
      name: "部门负责人",
      sysRole: SysRole.dept_head,
      deptId: dept.id,
      directManagerId: topLeader.id,
    });
    const directManager = await factory.createUser({
      employeeNo: "V2-MGR-001",
      name: "直属上级",
      sysRole: SysRole.manager,
      deptId: dept.id,
      directManagerId: departmentHead.id,
    });
    const employee = await factory.createUser({
      employeeNo: "V2-EMP-001",
      name: "正式员工",
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: directManager.id,
    });
    const probationUser = await factory.createUser({
      employeeNo: "V2-PRO-001",
      name: "试用期员工",
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: directManager.id,
    });
    await app.prisma.user.update({
      where: { id: probationUser.id },
      data: { status: UserStatus.probation },
    });
    await factory.updateDeptLeader(dept.id, departmentHead.id);
    await factory.updateDeptApprover(dept.id, topLeader.id);
    await app.prisma.systemConfig.update({
      where: { key: "performance_company_final_approver" },
      data: { value: { userId: null } },
    });

    const authService = app.app.get(AuthService);
    const hrToken = (await authService.issueToken(hr)).token;
    const reviewerToken = (await authService.issueToken(hrAdministrator)).token;

    const createdV2 = await app.http
      .post("/api/v1/cycles")
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        name: "2027年第一季度绩效（工作流V2）",
        type: "quarterly",
        workflowVersion: 2,
        scoringFrequency: "monthly",
        startDate: "2027-01-01T00:00:00+08:00",
        endDate: "2027-03-31T00:00:00+08:00",
        goalSettingOpenAt: "2026-01-01T09:00:00+08:00",
        hrOwnerId: hr.id,
        reviewerId: hrAdministrator.id,
        participantUserIds: [employee.id, probationUser.id],
        periodSchedules: [
          {
            periodKey: "2027-01",
            selfEvalOpenAt: "2027-02-01T09:00:00+08:00",
            selfEvalDueAt: "2027-02-03T18:00:00+08:00",
            managerDueAt: "2027-02-08T18:00:00+08:00",
          },
          {
            periodKey: "2027-02",
            selfEvalOpenAt: "2027-03-01T09:00:00+08:00",
            selfEvalDueAt: "2027-03-03T18:00:00+08:00",
            managerDueAt: "2027-03-08T18:00:00+08:00",
          },
          {
            periodKey: "2027-03",
            selfEvalOpenAt: "2027-04-01T09:00:00+08:00",
            selfEvalDueAt: "2027-04-06T18:00:00+08:00",
            managerDueAt: "2027-04-09T18:00:00+08:00",
          },
        ],
      })
      .expect(201);

    const v2CycleId = createdV2.body.data.id as string;
    expect(createdV2.body.data).toMatchObject({
      id: v2CycleId,
      workflowVersion: 2,
      scoringFrequency: "monthly",
      reviewFrequency: "cycle",
      planVersion: 1,
      companyFinalApprover: null,
    });
    expect(createdV2.body.data.periodSchedules).toHaveLength(3);
    expect(
      await app.prisma.cyclePeriodSchedule.count({
        where: { cycleId: v2CycleId },
      }),
    ).toBe(3);

    await app.prisma.systemConfig.update({
      where: { key: "performance_company_final_approver" },
      data: { value: { userId: topLeader.id } },
    });

    await app.http
      .post(`/api/v1/cycles/${v2CycleId}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        action: "approve",
        expectedPlanVersion: createdV2.body.data.planVersion,
        comment: "计划审核通过",
      })
      .expect(201);

    const preflightV2 = await app.http
      .get(`/api/v1/cycles/${v2CycleId}/preflight`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);

    expect(preflightV2.body.data).toMatchObject({
      ready: true,
      participantCount: 2,
      companyFinalApprover: { id: topLeader.id, name: "李宏" },
      blockers: [],
    });
    expect(preflightV2.body.data.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preflightV2.body.data.participants).toHaveLength(2);
    expect(
      preflightV2.body.data.participants
        .map((participant: { employeeId: string }) => participant.employeeId)
        .sort(),
    ).toEqual([employee.id, topLeader.id].sort());
    expect(
      preflightV2.body.data.participants.filter(
        (participant: { participantDisposition: string }) =>
          participant.participantDisposition === "active",
      ),
    ).toHaveLength(1);
    expect(
      preflightV2.body.data.participants.filter(
        (participant: { participantDisposition: string }) =>
          participant.participantDisposition === "top_leader_exempt",
      ),
    ).toHaveLength(1);
    expect(preflightV2.body.data.participants).toContainEqual(
      expect.objectContaining({
        employeeId: employee.id,
        managerId: directManager.id,
        participantDisposition: "active",
        isExempt: false,
      }),
    );
    expect(preflightV2.body.data.participants).toContainEqual(
      expect.objectContaining({
        employeeId: topLeader.id,
        managerId: null,
        participantDisposition: "top_leader_exempt",
        isExempt: true,
        exemptReason: "最高负责人豁免",
      }),
    );
    expect(preflightV2.body.data.exclusions).toHaveLength(1);
    expect(preflightV2.body.data.exclusions).toEqual([
      {
        employeeId: probationUser.id,
        employeeName: probationUser.name,
        reasonCode: "PROBATION_NOT_IN_PLAN",
        reason: "试用期员工不进入本绩效计划",
      },
    ]);

    await app.prisma.systemConfig.update({
      where: { key: "performance_company_final_approver" },
      data: { value: { userId: replacementTopLeader.id } },
    });
    await app.http
      .post(`/api/v1/cycles/${v2CycleId}/launch`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ expectedPlanHash: preflightV2.body.data.planHash })
      .expect(409);

    const refreshedPreflightV2 = await app.http
      .get(`/api/v1/cycles/${v2CycleId}/preflight`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    expect(refreshedPreflightV2.body.data).toMatchObject({
      ready: true,
      companyFinalApprover: { id: replacementTopLeader.id, name: replacementTopLeader.name },
    });
    expect(refreshedPreflightV2.body.data.planHash).not.toBe(preflightV2.body.data.planHash);

    const launchedV2 = await app.http
      .post(`/api/v1/cycles/${v2CycleId}/launch`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ expectedPlanHash: refreshedPreflightV2.body.data.planHash })
      .expect(201);
    expect(launchedV2.body.data).toEqual({
      cycleId: v2CycleId,
      totalTasks: 2,
      exemptedTasks: 1,
      activeTasks: 1,
      periodCount: 3,
      indicatorVersionCount: 1,
    });

    const v2Tasks = await app.prisma.assessmentTask.findMany({
      where: { cycleId: v2CycleId },
      orderBy: { employeeId: "asc" },
    });
    expect(v2Tasks.map(({ employeeId }) => employeeId).sort()).toEqual(
      [employee.id, replacementTopLeader.id].sort(),
    );
    const employeeTask = v2Tasks.find(
      (task) => task.employeeId === employee.id,
    )!;
    const topLeaderTask = v2Tasks.find(
      (task) => task.employeeId === replacementTopLeader.id,
    )!;
    expect(employeeTask).toMatchObject({
      managerId: directManager.id,
      participantDisposition: "active",
      isExempt: false,
    });
    expect(topLeaderTask).toMatchObject({
      managerId: null,
      participantDisposition: "top_leader_exempt",
      status: "exempted",
      isExempt: true,
      exemptReason: "最高负责人豁免",
    });
    expect(await app.prisma.assessmentCycle.findUniqueOrThrow({
      where: { id: v2CycleId },
      select: { companyFinalApproverId: true },
    })).toEqual({ companyFinalApproverId: replacementTopLeader.id });
    expect(
      await app.prisma.assessmentPeriod.count({
        where: { taskId: employeeTask.id },
      }),
    ).toBe(3);
    expect(
      await app.prisma.assessmentPeriod.findMany({
        where: { taskId: employeeTask.id },
        orderBy: { sequence: "asc" },
        select: { periodKey: true, managerId: true },
      }),
    ).toEqual([
      { periodKey: "2027-01", managerId: directManager.id },
      { periodKey: "2027-02", managerId: directManager.id },
      { periodKey: "2027-03", managerId: directManager.id },
    ]);
    expect(
      await app.prisma.indicatorVersion.findUnique({
        where: { taskId_version: { taskId: employeeTask.id, version: 1 } },
      }),
    ).toMatchObject({ status: "draft", effectiveFromPeriodKey: "2027-01" });
    expect(
      await app.prisma.assessmentPeriod.count({
        where: { taskId: topLeaderTask.id },
      }),
    ).toBe(0);
    expect(
      await app.prisma.indicatorVersion.count({
        where: { taskId: topLeaderTask.id },
      }),
    ).toBe(0);
    expect(
      await app.prisma.assessmentTask.count({
        where: { cycleId: v2CycleId, employeeId: probationUser.id },
      }),
    ).toBe(0);

    const createdV1 = await app.http
      .post("/api/v1/cycles")
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        name: "2027年第二季度绩效（历史工作流V1）",
        type: "quarterly",
        startDate: "2027-04-01T00:00:00+08:00",
        endDate: "2027-06-30T00:00:00+08:00",
        goalSettingOpenAt: "2026-01-01T09:00:00+08:00",
        hrOwnerId: hr.id,
        reviewerId: hrAdministrator.id,
        participantUserIds: [employee.id],
      })
      .expect(201);
    const v1CycleId = createdV1.body.data.id as string;

    expect(createdV1.body.data).toMatchObject({
      id: v1CycleId,
      workflowVersion: 1,
      scoringFrequency: "cycle",
      reviewFrequency: "cycle",
      periodSchedules: [],
    });
    await app.http
      .get(`/api/v1/cycles/${v1CycleId}`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: v1CycleId,
          workflowVersion: 1,
          scoringFrequency: "cycle",
          periodSchedules: [],
        });
      });
    await app.http
      .post(`/api/v1/cycles/${v1CycleId}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ action: "approve", expectedPlanVersion: createdV1.body.data.planVersion })
      .expect(201);
    const preflightV1 = await app.http
      .get(`/api/v1/cycles/${v1CycleId}/preflight`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    expect(preflightV1.body.data).toMatchObject({
      ready: true,
      participantCount: 1,
      blockers: [],
    });
    expect(preflightV1.body.data).not.toHaveProperty("exclusions");
    await app.http
      .post(`/api/v1/cycles/${v1CycleId}/launch`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ expectedPlanHash: preflightV1.body.data.planHash })
      .expect(201);

    const v1Task = await app.prisma.assessmentTask.findUniqueOrThrow({
      where: {
        cycleId_employeeId: { cycleId: v1CycleId, employeeId: employee.id },
      },
    });
    expect(v1Task.managerId).toBe(directManager.id);
    expect(
      await app.prisma.cyclePeriodSchedule.count({
        where: { cycleId: v1CycleId },
      }),
    ).toBe(0);
    expect(
      await app.prisma.assessmentPeriod.count({
        where: { task: { cycleId: v1CycleId } },
      }),
    ).toBe(0);
    expect(
      await app.prisma.indicatorVersion.count({
        where: { task: { cycleId: v1CycleId } },
      }),
    ).toBe(0);
  });
});
