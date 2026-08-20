import {
  AccountType,
  PrismaClient,
  SysRole,
  CycleStatus,
  TaskStatus,
  IndicatorType,
  DimensionType,
  PerfGrade,
  type AssessmentCycle,
  type Department,
  type User,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();
const E2E_PASSWORD = "000000";
const E2E_CYCLE_PREFIX = "E2E-acceptance-";
const E2E_TEMPLATE_PREFIX = "E2E-template-";
const E2E_TEMPLATE_MARKER = "E2E_FIXTURE: manager team workspace acceptance";
const E2E_ACTIONABLE_NOTIFICATION_ID = "00000000-0000-4000-8000-000000000411";

const ROOT_DEPARTMENT = {
  dingtalkDeptId: "E2E_DEPT_ROOT",
  name: "E2E 验收组织",
  fullPath: "E2E_FIXTURE_ROOT",
  sortOrder: 9000,
};
const TEAM_DEPARTMENT = {
  dingtalkDeptId: "E2E_DEPT_TEAM",
  name: "E2E 验收团队",
  fullPath: "E2E_FIXTURE_ROOT/E2E_FIXTURE_TEAM",
  sortOrder: 9010,
};

const CYCLE_NAMES = [
  `${E2E_CYCLE_PREFIX}indicator-confirm`,
  `${E2E_CYCLE_PREFIX}indicator-reject`,
  `${E2E_CYCLE_PREFIX}goal-review`,
  `${E2E_CYCLE_PREFIX}self-eval`,
  `${E2E_CYCLE_PREFIX}manager-score`,
  `${E2E_CYCLE_PREFIX}hr-calibration`,
  `${E2E_CYCLE_PREFIX}approval`,
];

const CYCLE_STATUS_BY_NAME: Record<string, CycleStatus> = {
  [`${E2E_CYCLE_PREFIX}indicator-confirm`]: CycleStatus.indicator_setting,
  [`${E2E_CYCLE_PREFIX}indicator-reject`]: CycleStatus.indicator_setting,
  [`${E2E_CYCLE_PREFIX}goal-review`]: CycleStatus.indicator_setting,
  [`${E2E_CYCLE_PREFIX}self-eval`]: CycleStatus.self_eval,
  [`${E2E_CYCLE_PREFIX}manager-score`]: CycleStatus.manager_score,
  [`${E2E_CYCLE_PREFIX}hr-calibration`]: CycleStatus.hr_calibration,
  [`${E2E_CYCLE_PREFIX}approval`]: CycleStatus.approval,
};

type DepartmentFixture = typeof ROOT_DEPARTMENT;

interface UserFixture {
  employeeNo: string;
  name: string;
  sysRole: SysRole;
  position: string;
  canViewAll?: boolean;
}

function fixtureEmail(employeeNo: string) {
  return `${employeeNo.toLowerCase().replaceAll("_", "-")}@fixture.e2e.invalid`;
}

function collisionError(entity: string, key: string) {
  return new Error(
    `E2E fixture collision: ${entity} ${key} exists without the expected fixture marker`,
  );
}

async function ensureDepartment(
  fixture: DepartmentFixture,
  parentId: string | null,
): Promise<Department> {
  const existing = await prisma.department.findUnique({
    where: { dingtalkDeptId: fixture.dingtalkDeptId },
  });
  if (
    existing &&
    (existing.name !== fixture.name ||
      existing.fullPath !== fixture.fullPath ||
      existing.parentId !== parentId)
  ) {
    throw collisionError("department", fixture.dingtalkDeptId);
  }

  const data = {
    name: fixture.name,
    fullPath: fixture.fullPath,
    parentId,
    sortOrder: fixture.sortOrder,
    isActive: true,
  };
  if (existing) {
    return prisma.department.update({ where: { id: existing.id }, data });
  }
  return prisma.department.create({
    data: { dingtalkDeptId: fixture.dingtalkDeptId, ...data },
  });
}

async function ensureUser(
  fixture: UserFixture,
  deptId: string,
  passwordHash: string,
  directManagerId: string | null = null,
): Promise<User> {
  const email = fixtureEmail(fixture.employeeNo);
  const existing = await prisma.user.findUnique({
    where: { employeeNo: fixture.employeeNo },
  });
  if (existing && existing.email !== email) {
    throw collisionError("user", fixture.employeeNo);
  }

  const data = {
    name: fixture.name,
    email,
    passwordHash,
    sysRole: fixture.sysRole,
    status: "active" as const,
    deptId,
    position: fixture.position,
    directManagerId,
    canViewAll: fixture.canViewAll ?? false,
    isAssessorOnly: false,
    accountType: AccountType.test,
    deletedAt: null,
  };
  if (existing) {
    return prisma.user.update({ where: { id: existing.id }, data });
  }
  return prisma.user.create({
    data: { employeeNo: fixture.employeeNo, ...data },
  });
}

async function removeOwnedAssessmentFixtures(hrId: string) {
  const cycles = await prisma.assessmentCycle.findMany({
    where: { name: { in: CYCLE_NAMES } },
    select: { id: true, name: true, createdBy: true },
  });
  const foreignCycle = cycles.find((cycle) => cycle.createdBy !== hrId);
  if (foreignCycle) throw collisionError("assessment cycle", foreignCycle.name);

  for (const cycle of cycles) {
    await prisma.assessmentTask.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.assessmentTemplateSnapshot.deleteMany({
      where: { cycleId: cycle.id },
    });
    await prisma.assessmentCycle.delete({ where: { id: cycle.id } });
  }

  const templateNames = CYCLE_NAMES.map(
    (name) => `${E2E_TEMPLATE_PREFIX}${name}`,
  );
  const templates = await prisma.assessmentTemplate.findMany({
    where: { name: { in: templateNames } },
    select: { id: true, name: true, description: true, createdBy: true },
  });
  const foreignTemplate = templates.find(
    (template) =>
      template.createdBy !== hrId ||
      template.description !== E2E_TEMPLATE_MARKER,
  );
  if (foreignTemplate)
    throw collisionError("assessment template", foreignTemplate.name);
  if (templates.length > 0) {
    await prisma.assessmentTemplate.deleteMany({
      where: { id: { in: templates.map((template) => template.id) } },
    });
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
  const rootDept = await ensureDepartment(ROOT_DEPARTMENT, null);
  const teamDept = await ensureDepartment(TEAM_DEPARTMENT, rootDept.id);

  await ensureUser(
    {
      employeeNo: "E2E_ADMIN",
      name: "E2E 系统管理员",
      sysRole: SysRole.system_admin,
      position: "E2E_SYSTEM_ADMIN",
      canViewAll: true,
    },
    rootDept.id,
    passwordHash,
  );
  const hr = await ensureUser(
    {
      employeeNo: "E2E_HR",
      name: "E2E 验收 HR",
      sysRole: SysRole.hr,
      position: "E2E_HR",
      canViewAll: true,
    },
    teamDept.id,
    passwordHash,
  );
  const manager = await ensureUser(
    {
      employeeNo: "E2E_MGR",
      name: "E2E 直属主管",
      sysRole: SysRole.manager,
      position: "E2E_MANAGER",
    },
    teamDept.id,
    passwordHash,
  );
  const deptHead = await ensureUser(
    {
      employeeNo: "E2E_DEPT_HEAD",
      name: "E2E 部门负责人",
      sysRole: SysRole.dept_head,
      position: "E2E_DEPT_HEAD",
    },
    teamDept.id,
    passwordHash,
  );
  await ensureUser(
    {
      employeeNo: "E2E_VP",
      name: "E2E 分管领导",
      sysRole: SysRole.vp,
      position: "E2E_VP",
      canViewAll: true,
    },
    rootDept.id,
    passwordHash,
  );
  await ensureUser(
    {
      employeeNo: "E2E_CHAIRMAN",
      name: "E2E 董事长",
      sysRole: SysRole.chairman,
      position: "E2E_CHAIRMAN",
      canViewAll: true,
    },
    rootDept.id,
    passwordHash,
  );
  const approver = await ensureUser(
    {
      employeeNo: "E2E_APPROVER",
      name: "E2E 审批人",
      sysRole: SysRole.vp,
      position: "E2E_APPROVER",
    },
    rootDept.id,
    passwordHash,
  );
  const employee1 = await ensureUser(
    {
      employeeNo: "E2E_EMP",
      name: "E2E 员工甲",
      sysRole: SysRole.employee,
      position: "E2E_EMPLOYEE",
    },
    teamDept.id,
    passwordHash,
    manager.id,
  );
  const employee2 = await ensureUser(
    {
      employeeNo: "E2E_EMP_B",
      name: "E2E 员工乙",
      sysRole: SysRole.employee,
      position: "E2E_EMPLOYEE",
    },
    teamDept.id,
    passwordHash,
    manager.id,
  );

  await prisma.department.update({
    where: { id: teamDept.id },
    data: { leaderId: deptHead.id, approverId: approver.id },
  });
  await removeOwnedAssessmentFixtures(hr.id);

  const cycles: Record<string, AssessmentCycle> = {};
  for (const name of CYCLE_NAMES) {
    cycles[name] = await prisma.assessmentCycle.create({
      data: {
        name,
        type: "quarterly",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-03-31"),
        status: CYCLE_STATUS_BY_NAME[name],
        createdBy: hr.id,
        gradeAMaxRatio: 0.2,
        gradeBMaxRatio: 0.4,
        gradeCMaxRatio: 0.3,
        gradeDMaxRatio: 0.1,
      },
    });
  }

  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}indicator-confirm`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.indicator_confirming,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}indicator-reject`],
    hr.id,
    employee2,
    manager,
    deptHead,
    approver,
    TaskStatus.indicator_confirming,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}goal-review`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.indicator_reviewing,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}self-eval`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.self_eval,
  );
  const actionableNotificationTask = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}manager-score`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.manager_scoring,
    true,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}hr-calibration`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.hr_calibration,
    true,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}hr-calibration`],
    hr.id,
    employee2,
    manager,
    deptHead,
    approver,
    TaskStatus.hr_calibration,
    true,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}approval`],
    hr.id,
    employee1,
    manager,
    deptHead,
    approver,
    TaskStatus.approval,
    true,
    PerfGrade.B,
  );
  await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}approval`],
    hr.id,
    employee2,
    manager,
    deptHead,
    approver,
    TaskStatus.approval,
    true,
    PerfGrade.C,
  );

  await prisma.notificationLog.upsert({
    where: { id: E2E_ACTIONABLE_NOTIFICATION_ID },
    update: {
      userId: manager.id,
      senderId: employee1.id,
      taskId: actionableNotificationTask.id,
      cycleId: actionableNotificationTask.cycleId,
      type: "self_eval_submitted",
      title: "员工自评待评",
      content: "员工已提交自评，请进行主管评价。",
      channel: "dingtalk",
      status: "sent",
      isRead: false,
      readAt: null,
      sentAt: new Date(),
      createdAt: new Date(),
    },
    create: {
      id: E2E_ACTIONABLE_NOTIFICATION_ID,
      userId: manager.id,
      senderId: employee1.id,
      taskId: actionableNotificationTask.id,
      cycleId: actionableNotificationTask.cycleId,
      type: "self_eval_submitted",
      title: "员工自评待评",
      content: "员工已提交自评，请进行主管评价。",
      channel: "dingtalk",
      status: "sent",
      isRead: false,
      readAt: null,
      sentAt: new Date(),
    },
  });

  console.log("✓ E2E acceptance fixtures created");
  console.log(
    "  E2E_ADMIN / E2E_HR / E2E_MGR / E2E_EMP / E2E_VP / E2E_CHAIRMAN / E2E_APPROVER; password 000000",
  );
}

async function createTaskWithStatus(
  cycle: AssessmentCycle,
  hrId: string,
  employee: User,
  manager: User,
  deptHead: User,
  approver: User,
  status: TaskStatus,
  hasManagerScore = false,
  calibratedGrade?: PerfGrade,
) {
  const template = await prisma.assessmentTemplate.create({
    data: {
      name: `${E2E_TEMPLATE_PREFIX}${cycle.name}`,
      description: E2E_TEMPLATE_MARKER,
      applicableDepts: employee.deptId ? [employee.deptId] : [],
      applicableUsers: [employee.id],
      maxScore: 100,
      isActive: true,
      createdBy: hrId,
      dimensions: {
        create: [
          {
            name: "业绩维度",
            type: DimensionType.kpi,
            weight: 0.8,
            sortOrder: 0,
            indicators: {
              create: [
                {
                  name: "销售额完成率",
                  scoringStandard: "按实际销售额/目标销售额 * 100 评分",
                  targetValue: 100,
                  unit: "%",
                  weight: 0.5,
                  sortOrder: 0,
                },
                {
                  name: "客户满意度",
                  scoringStandard: "按客户评分",
                  targetValue: 90,
                  unit: "分",
                  weight: 0.3,
                  sortOrder: 1,
                },
              ],
            },
          },
          {
            name: "加减分",
            type: DimensionType.bonus,
            weight: 0.2,
            sortOrder: 1,
            indicators: {
              create: [
                {
                  name: "加分项",
                  scoringStandard: "突出贡献加分",
                  weight: 0.1999,
                  sortOrder: 0,
                },
                {
                  name: "一票否决项",
                  scoringStandard: "重大失误一票否决",
                  weight: 0.0001,
                  sortOrder: 1,
                },
              ],
            },
          },
        ],
      },
    },
    include: {
      dimensions: { include: { indicators: true } },
    },
  });

  const snapshotData = {
    maxScore: template.maxScore,
    dimensions: template.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      type: dimension.type,
      weight: dimension.weight,
      indicators: dimension.indicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name,
        scoringStandard: indicator.scoringStandard,
        targetValue: indicator.targetValue,
        unit: indicator.unit,
        weight: indicator.weight,
        indicatorType: inferIndicatorType(indicator.name),
      })),
    })),
  };

  const snapshot = await prisma.assessmentTemplateSnapshot.create({
    data: {
      cycleId: cycle.id,
      templateId: template.id,
      snapshotData,
    },
  });

  const task = await prisma.assessmentTask.create({
    data: {
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      employeeId: employee.id,
      deptId: employee.deptId,
      managerId: manager.id,
      deptHeadId: deptHead.id,
      approverId: approver.id,
      status,
    },
  });

  const instances = snapshotData.dimensions.flatMap(
    (dimension, dimensionIndex) =>
      dimension.indicators.map((indicator, indicatorIndex) => ({
        taskId: task.id,
        templateIndicatorId: indicator.id,
        name: indicator.name,
        description: indicator.scoringStandard,
        scoringStandard: indicator.scoringStandard,
        targetValue: indicator.targetValue,
        unit: indicator.unit,
        weight: indicator.weight,
        indicatorType: indicator.indicatorType,
        dimensionName: dimension.name,
        dimensionWeight: dimension.weight,
        sortOrder: dimensionIndex * 100 + indicatorIndex,
      })),
  );
  await prisma.indicatorInstance.createMany({ data: instances });

  if (hasManagerScore) {
    await prisma.indicatorInstance.updateMany({
      where: { taskId: task.id },
      data: { managerScore: 85, managerComment: "主管评语" },
    });
    await prisma.managerEvalSummary.create({
      data: {
        taskId: task.id,
        strengths: "业绩稳定",
        improvements: "需加强协作",
      },
    });
  }

  if (status === TaskStatus.hr_calibration || status === TaskStatus.approval) {
    const calculatedScore =
      status === TaskStatus.approval
        ? calibratedGrade === PerfGrade.A
          ? 95
          : calibratedGrade === PerfGrade.B
            ? 85
            : calibratedGrade === PerfGrade.C
              ? 75
              : 55
        : 85;
    await prisma.gradeResult.create({
      data: {
        taskId: task.id,
        calculatedScore,
        rawGrade:
          calculatedScore >= 90
            ? PerfGrade.A
            : calculatedScore >= 75
              ? PerfGrade.B
              : calculatedScore >= 60
                ? PerfGrade.C
                : PerfGrade.D,
        coefficient: 1.0,
      },
    });
  }

  if (status === TaskStatus.approval && calibratedGrade) {
    await prisma.gradeResult.update({
      where: { taskId: task.id },
      data: {
        calibratedGrade,
        calibrationNote: "校准说明",
        hrCalibratedAt: new Date(),
      },
    });
    await prisma.assessmentTask.update({
      where: { id: task.id },
      data: { hrCalibratedAt: new Date() },
    });
  }

  return task;
}

function inferIndicatorType(name: string): IndicatorType {
  if (name.includes("否决")) return IndicatorType.veto;
  if (name.includes("加分")) return IndicatorType.bonus;
  if (name.includes("减分")) return IndicatorType.penalty;
  return IndicatorType.kpi;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
