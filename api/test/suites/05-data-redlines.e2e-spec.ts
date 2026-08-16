import { buildTestApp, closeTestApp, TestApp } from "../test-app";
import { FixtureFactory } from "../fixtures/fixture-factory";
import { login } from "../helpers/auth-helper";
import { assertNoCoefficientKey } from "../helpers/scoring-assertions";
import { SysRole, TaskStatus, CycleStatus, PerfGrade } from "@prisma/client";
import { LaunchService } from "@/cycles/launch.service";

describe("05-data-redlines", () => {
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

    return { dept, hr, manager, deptHead, approver, employee };
  }

  it("D18：公示前员工拉任务详情无 managerScore/总分/等级字段", async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({
      name: "D18测试",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.self_eval,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: "B",
    });

    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    const res = await app.http
      .get(`/api/v1/tasks/${task.id}`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.data.totalScore).toBeNull();
    expect(res.body.data.rawGrade).toBeNull();
    expect(res.body.data.gradeResult).toBeNull();
    for (const inst of res.body.data.indicatorInstances) {
      expect(inst.managerScore).toBeNull();
      expect(inst.finalScore).toBeNull();
    }
  });

  it("D18：公示后默认配置 coefficient 不在响应中，勾选后才出现", async () => {
    const { dept, hr, manager, employee } = await createRoleSet();

    // 默认 coefficient=false
    const cycleNoCoef = await factory.createCycle({
      name: "D18无系数",
      createdBy: hr.id,
      status: CycleStatus.draft,
      publishVisibleFields: {
        total_score: true,
        grade: true,
        coefficient: false,
      },
    });
    const taskNoCoef = await factory.createTaskInStatus({
      cycleId: cycleNoCoef.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: "B",
      calibratedGrade: "B",
    });
    await app.prisma.gradeResult.updateMany({
      where: { taskId: taskNoCoef.id },
      data: { isPublished: true, coefficient: 1.0 },
    });

    const empToken = await login(app.http, {
      employeeNo: "EMP001",
      password: "test123",
    });
    const res1 = await app.http
      .get(`/api/v1/tasks/${taskNoCoef.id}`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);
    expect(res1.body.data.gradeResult).toBeTruthy();
    expect(res1.body.data.gradeResult.coefficient).toBeNull();

    // coefficient=true
    const cycleWithCoef = await factory.createCycle({
      name: "D18有系数",
      createdBy: hr.id,
      status: CycleStatus.draft,
      publishVisibleFields: {
        total_score: true,
        grade: true,
        coefficient: true,
      },
    });
    const taskWithCoef = await factory.createTaskInStatus({
      cycleId: cycleWithCoef.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: "B",
      calibratedGrade: "B",
    });
    await app.prisma.gradeResult.updateMany({
      where: { taskId: taskWithCoef.id },
      data: { isPublished: true, coefficient: 1.0 },
    });

    const res2 = await app.http
      .get(`/api/v1/tasks/${taskWithCoef.id}`)
      .set("Authorization", `Bearer ${empToken}`)
      .expect(200);
    expect(res2.body.data.gradeResult.coefficient).toBeDefined();
    expect(Number(res2.body.data.gradeResult.coefficient)).toBe(1);
  });

  it("D13：/calibration 响应无 coefficient 字段", async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({
      name: "D13校准",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    await factory.createStandardTemplate({
      name: "D13模板",
      createdBy: hr.id,
      applicableDepts: [dept.id],
    });
    await launchChecked(cycle.id, {
      id: hr.id,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });
    const res = await app.http
      .get(`/api/v1/cycles/${cycle.id}/calibration`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    assertNoCoefficientKey(res.body.data);
  });

  it("D13：/approval 响应无 coefficient 字段", async () => {
    const { dept, hr, manager, deptHead, approver, employee } =
      await createRoleSet();
    const cycle = await factory.createCycle({
      name: "D13审批",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    await factory.createStandardTemplate({
      name: "D13模板",
      createdBy: hr.id,
      applicableDepts: [dept.id],
    });
    await launchChecked(cycle.id, {
      id: hr.id,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });
    const task = await app.prisma.assessmentTask.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId: employee.id },
    });
    await app.prisma.assessmentTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.approval },
    });
    await app.prisma.gradeResult.create({
      data: {
        taskId: task.id,
        calculatedScore: 82,
        rawGrade: "B",
        calibratedGrade: "B",
        coefficient: 1.0,
      },
    });

    const approverToken = await login(app.http, {
      employeeNo: "VP001",
      password: "test123",
    });
    const res = await app.http
      .get(`/api/v1/cycles/${cycle.id}/approval`)
      .set("Authorization", `Bearer ${approverToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    assertNoCoefficientKey(res.body.data);
  });

  it("D13：/reports/* 响应无 coefficient 字段", async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({
      name: "D13报表",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    await factory.createStandardTemplate({
      name: "D13模板",
      createdBy: hr.id,
      applicableDepts: [dept.id],
    });
    await launchChecked(cycle.id, {
      id: hr.id,
      name: "HR",
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });

    const summary = await app.http
      .get(`/api/v1/reports/cycle/${cycle.id}/summary`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    assertNoCoefficientKey(summary.body.data);

    const progress = await app.http
      .get(`/api/v1/reports/cycle/${cycle.id}/progress`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    assertNoCoefficientKey(progress.body.data);

    const gradeList = await app.http
      .get(`/api/v1/reports/cycle/${cycle.id}/grade-list`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    assertNoCoefficientKey(gradeList.body.data);
  });

  it("D13：/appeals/* 响应无 coefficient 字段", async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({
      name: "D13申诉",
      createdBy: hr.id,
      status: CycleStatus.draft,
    });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: "B",
      calibratedGrade: "B",
    });

    const hrToken = await login(app.http, {
      employeeNo: "HR001",
      password: "test123",
    });
    const createRes = await app.http
      .post("/api/v1/appeals")
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ taskId: task.id, reason: "测试申诉" })
      .expect(200);

    const appealId = createRes.body.data.id;
    const detail = await app.http
      .get(`/api/v1/appeals/${appealId}`)
      .set("Authorization", `Bearer ${hrToken}`)
      .expect(200);
    assertNoCoefficientKey(detail.body.data);
  });
});
