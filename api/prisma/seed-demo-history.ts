import {
  AccountType,
  ActionItemStatus,
  CompanyCode,
  CycleStatus,
  DimensionType,
  FlowAction,
  FlowNodeType,
  IndicatorType,
  InterviewStatus,
  ObjectiveLevel,
  ObjectiveStatus,
  PerfGrade,
  PrismaClient,
  SysRole,
  TaskStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { TEST_ACCOUNT_MANIFEST } from '../src/auth/test-accounts';
import { requireDemoHistorySeed } from './demo-history/guards';
import { ACCEPTANCE_TASK_PLAN, TEST_ACCEPTANCE_CYCLE_NAME } from './demo-history/acceptance-plan';

const prisma = new PrismaClient();
const DEMO_ROOT_DEPARTMENT = '测试组织（演示）';

type DemoUser = {
  employeeNo: string;
  name: string;
  role: SysRole;
  position: string;
  deptName: string;
  managerNo?: string;
  canViewAll?: boolean;
};

const demoProfile: Record<string, Omit<DemoUser, 'employeeNo' | 'name' | 'role'>> = {
  ADMIN: { position: '测试系统管理员', deptName: '测试人力资源部', canViewAll: true },
  HR001: { position: '测试 HRBP', deptName: '测试人力资源部', managerNo: 'VP001', canViewAll: true },
  VP001: { position: '测试分管副总', deptName: '测试总经办', managerNo: 'ADMIN', canViewAll: true },
  MGR001: { position: '测试研发主管', deptName: '测试研发部', managerNo: 'VP001' },
  EMP001: { position: '测试后端工程师', deptName: '测试研发部', managerNo: 'MGR001' },
  EMP002: { position: '测试前端工程师', deptName: '测试研发部', managerNo: 'MGR001' },
  EMP003: { position: '测试销售经理', deptName: '测试销售部', managerNo: 'MGR001' },
  EMP004: { position: '测试运营专员', deptName: '测试运营部', managerNo: 'MGR001' },
};

const users: DemoUser[] = TEST_ACCOUNT_MANIFEST.map((account) => ({
  employeeNo: account.employeeNo,
  name: account.name,
  role: account.sysRole as SysRole,
  ...demoProfile[account.employeeNo],
}));

const cycleSpecs = [
  { name: '测试·2025 Q3 绩效考核（历史）', start: '2025-07-01', end: '2025-09-30' },
  { name: '测试·2025 Q4 绩效考核（历史）', start: '2025-10-01', end: '2025-12-31' },
  { name: '测试·2026 Q1 绩效考核（历史）', start: '2026-01-01', end: '2026-03-31' },
];

const scoreBook: Record<string, Array<{ no: string; score: number; grade: PerfGrade; confirmed: boolean }>> = {
  '测试·2025 Q3 绩效考核（历史）': [
    { no: 'EMP001', score: 84, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP002', score: 91, grade: PerfGrade.A, confirmed: true },
    { no: 'EMP003', score: 88, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP004', score: 72, grade: PerfGrade.C, confirmed: true },
  ],
  '测试·2025 Q4 绩效考核（历史）': [
    { no: 'EMP001', score: 87, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP002', score: 89, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP003', score: 94, grade: PerfGrade.A, confirmed: true },
    { no: 'EMP004', score: 68, grade: PerfGrade.C, confirmed: true },
  ],
  '测试·2026 Q1 绩效考核（历史）': [
    { no: 'EMP001', score: 86, grade: PerfGrade.B, confirmed: false },
    { no: 'EMP002', score: 92, grade: PerfGrade.A, confirmed: true },
    { no: 'EMP003', score: 78, grade: PerfGrade.C, confirmed: false },
    { no: 'EMP004', score: 58, grade: PerfGrade.D, confirmed: false },
  ],
};

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function gradeCoefficient(grade: PerfGrade): number {
  return { A: 1.2, B: 1.0, C: 0.8, D: 0.6 }[grade];
}

async function ensureDepartment(name: string, parentId?: string | null) {
  const existing = await prisma.department.findFirst({
    where: { name, parentId: parentId ?? null, dingtalkDeptId: null },
  });
  if (existing) return existing;
  return prisma.department.create({
    data: {
      name,
      parentId,
      company: CompanyCode.fuede,
      isActive: true,
    },
  });
}

async function ensureUsers(password: string) {
  const existingAccounts = await prisma.user.findMany({
    where: { employeeNo: { in: users.map((user) => user.employeeNo) } },
    select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true },
  });
  const collision = existingAccounts.find((user) => user.dingtalkId || user.dingtalkUnionId);
  if (collision) {
    throw new Error(`测试工号 ${collision.employeeNo} 已绑定真实钉钉身份，已停止演示数据写入`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const root = await ensureDepartment(DEMO_ROOT_DEPARTMENT);
  const deptMap = new Map<string, string>();

  for (const deptName of new Set(users.map((u) => u.deptName))) {
    const dept = await ensureDepartment(deptName, root.id);
    deptMap.set(deptName, dept.id);
  }

  const created = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>();
  for (const user of users) {
    const saved = await prisma.user.upsert({
      where: { employeeNo: user.employeeNo },
      update: {
        name: user.name,
        passwordHash,
        sysRole: user.role,
        position: user.position,
        deptId: deptMap.get(user.deptName),
        status: 'active',
        accountType: AccountType.test,
        canViewAll: user.canViewAll ?? false,
        deletedAt: null,
        dingtalkId: null,
        dingtalkUnionId: null,
        dingtalkManagerId: null,
        directManagerId: null,
        phone: null,
        email: null,
      },
      create: {
        employeeNo: user.employeeNo,
        name: user.name,
        passwordHash,
        sysRole: user.role,
        position: user.position,
        deptId: deptMap.get(user.deptName),
        status: 'active',
        accountType: AccountType.test,
        canViewAll: user.canViewAll ?? false,
        dingtalkId: null,
        dingtalkUnionId: null,
      },
    });
    created.set(user.employeeNo, saved);
  }

  for (const user of users) {
    if (!user.managerNo) continue;
    const employee = created.get(user.employeeNo);
    const manager = created.get(user.managerNo);
    if (employee && manager) {
      await prisma.user.update({
        where: { id: employee.id },
        data: { directManagerId: manager.id },
      });
    }
  }

  const hr = created.get('HR001');
  const vp = created.get('VP001');
  const manager = created.get('MGR001');
  if (hr) await prisma.department.updateMany({ where: { name: '测试人力资源部', parentId: root.id }, data: { leaderId: hr.id } });
  if (manager) await prisma.department.updateMany({ where: { name: '测试研发部', parentId: root.id }, data: { leaderId: manager.id } });
  if (vp) await prisma.department.updateMany({ where: { name: { in: ['测试研发部', '测试销售部', '测试运营部'] }, parentId: root.id }, data: { approverId: vp.id } });

  return created;
}

async function isolateFixedTestAccounts(
  userMap: Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>,
) {
  const employeeIds = [...userMap.values()].map((user) => user.id);
  const nonTestCycles = await prisma.assessmentCycle.findMany({
    where: { name: { not: { startsWith: '测试·' } } },
    select: { id: true, participantUserIds: true },
  });

  for (const cycle of nonTestCycles) {
    await prisma.performanceArchive.deleteMany({
      where: { cycleId: cycle.id, employeeId: { in: employeeIds } },
    });
    await prisma.assessmentTask.deleteMany({
      where: { cycleId: cycle.id, employeeId: { in: employeeIds } },
    });
    const participantUserIds = cycle.participantUserIds.filter((id) => !employeeIds.includes(id));
    if (participantUserIds.length !== cycle.participantUserIds.length) {
      await prisma.assessmentCycle.update({
        where: { id: cycle.id },
        data: { participantUserIds },
      });
    }
  }
}

async function ensureTemplate(hrId: string) {
  const existing = await prisma.assessmentTemplate.findFirst({
    where: { name: '测试·固定账号绩效模板' },
    include: { dimensions: { include: { indicators: true } } },
  });
  if (existing) return existing;

  return prisma.assessmentTemplate.create({
    data: {
      name: '测试·固定账号绩效模板',
      description: '仅用于固定测试账号验收：业绩、能力态度、加减分组合模板',
      applicableDepts: [],
      applicableUsers: [],
      maxScore: 100,
      isActive: true,
      createdBy: hrId,
      dimensions: {
        create: [
          {
            name: '业绩目标',
            type: DimensionType.kpi,
            weight: 0.7,
            sortOrder: 0,
            indicators: {
              create: [
                { name: '核心项目交付', scoringStandard: '按里程碑、质量、交付及时性综合评分', targetValue: 100, unit: '分', weight: 0.45, sortOrder: 0 },
                { name: '业务指标达成', scoringStandard: '按目标完成率和贡献度评分', targetValue: 100, unit: '%', weight: 0.25, sortOrder: 1 },
              ],
            },
          },
          {
            name: '能力态度',
            type: DimensionType.attitude,
            weight: 0.3,
            sortOrder: 1,
            indicators: {
              create: [
                { name: '协作与责任心', scoringStandard: '按跨部门协作、响应及时性和责任承担评分', targetValue: 100, unit: '分', weight: 0.2, sortOrder: 0 },
                { name: '创新改进', scoringStandard: '有效改进建议或流程优化可加分', targetValue: 100, unit: '分', weight: 0.1, sortOrder: 1 },
              ],
            },
          },
        ],
      },
    },
    include: { dimensions: { include: { indicators: true } } },
  });
}

async function ensureCycle(spec: (typeof cycleSpecs)[number], hrId: string) {
  const existing = await prisma.assessmentCycle.findFirst({ where: { name: spec.name } });
  const data = {
    type: 'quarterly' as const,
    startDate: date(spec.start),
    endDate: date(spec.end),
    status: CycleStatus.published,
    createdBy: hrId,
    publishedAt: new Date(),
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.5,
    gradeCMaxRatio: 0.25,
    gradeDMaxRatio: 0.05,
  };

  if (existing) return prisma.assessmentCycle.update({ where: { id: existing.id }, data });
  return prisma.assessmentCycle.create({ data: { name: spec.name, ...data } });
}

async function ensureSnapshot(cycleId: string, template: Awaited<ReturnType<typeof ensureTemplate>>) {
  const existing = await prisma.assessmentTemplateSnapshot.findFirst({
    where: { cycleId, templateId: template.id },
  });
  if (existing) return existing;

  const snapshotData = {
    maxScore: 100,
    dimensions: template.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      type: dimension.type,
      weight: Number(dimension.weight),
      indicators: dimension.indicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name,
        scoringStandard: indicator.scoringStandard,
        targetValue: indicator.targetValue ? Number(indicator.targetValue) : null,
        unit: indicator.unit,
        weight: Number(indicator.weight),
        indicatorType: indicator.name.includes('加分') ? IndicatorType.bonus : IndicatorType.kpi,
      })),
    })),
  };

  return prisma.assessmentTemplateSnapshot.create({
    data: {
      cycleId,
      templateId: template.id,
      snapshotData,
    },
  });
}

async function ensureAcceptanceCycle(
  userMap: Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>,
) {
  const hr = userMap.get('HR001')!;
  const participantUserIds = ACCEPTANCE_TASK_PLAN.map((item) => userMap.get(item.employeeNo)!.id);
  const existing = await prisma.assessmentCycle.findFirst({ where: { name: TEST_ACCEPTANCE_CYCLE_NAME } });
  if (existing && existing.createdBy !== hr.id) {
    throw new Error(`测试周期 ${TEST_ACCEPTANCE_CYCLE_NAME} 已被非测试数据占用`);
  }

  const data = {
    type: 'quarterly' as const,
    startDate: date('2026-07-01'),
    endDate: date('2026-09-30'),
    goalSettingOpenAt: date('2026-07-01'),
    selfEvalOpenAt: date('2026-09-20'),
    deadlineIndicatorSetting: date('2026-07-08'),
    deadlineIndicatorConfirm: date('2026-07-12'),
    deadlineSelfEval: date('2026-09-24'),
    deadlineManagerScore: date('2026-09-26'),
    deadlineHrCalibration: date('2026-09-27'),
    deadlineApproval: date('2026-09-28'),
    deadlinePublish: date('2026-09-29'),
    status: CycleStatus.manager_score,
    createdBy: hr.id,
    hrOwnerId: hr.id,
    participantDeptIds: [],
    participantUserIds,
    explicitExemptUserIds: [],
    openedAt: date('2026-07-01'),
    openSource: 'demo-seed',
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  };

  return existing
    ? prisma.assessmentCycle.update({ where: { id: existing.id }, data })
    : prisma.assessmentCycle.create({ data: { name: TEST_ACCEPTANCE_CYCLE_NAME, ...data } });
}

function statusHasSelfEvaluation(status: TaskStatus): boolean {
  return ([
    TaskStatus.manager_scoring,
    TaskStatus.dept_review,
    TaskStatus.hr_calibration,
    TaskStatus.approval,
    TaskStatus.published,
    TaskStatus.confirmed,
    TaskStatus.closed,
  ] as TaskStatus[]).includes(status);
}

function statusHasManagerEvaluation(status: TaskStatus): boolean {
  return ([
    TaskStatus.dept_review,
    TaskStatus.hr_calibration,
    TaskStatus.approval,
    TaskStatus.published,
    TaskStatus.confirmed,
    TaskStatus.closed,
  ] as TaskStatus[]).includes(status);
}

async function ensureAcceptanceTask(args: {
  cycle: Awaited<ReturnType<typeof ensureAcceptanceCycle>>;
  template: Awaited<ReturnType<typeof ensureTemplate>>;
  snapshotId: string;
  employee: Awaited<ReturnType<typeof prisma.user.upsert>>;
  manager: Awaited<ReturnType<typeof prisma.user.upsert>>;
  hrId: string;
  approverId: string;
  status: TaskStatus;
}) {
  const hasSelfEvaluation = statusHasSelfEvaluation(args.status);
  const hasManagerEvaluation = statusHasManagerEvaluation(args.status);
  const isPublished = ([TaskStatus.published, TaskStatus.confirmed, TaskStatus.closed] as TaskStatus[]).includes(args.status);
  const indicatorSetAt = args.status === TaskStatus.indicator_drafting ? null : date('2026-07-05');
  const indicatorConfirmedAt = ([
    TaskStatus.goal_confirmed,
    TaskStatus.self_eval,
    TaskStatus.manager_scoring,
    TaskStatus.dept_review,
    TaskStatus.hr_calibration,
    TaskStatus.approval,
    TaskStatus.published,
    TaskStatus.confirmed,
    TaskStatus.closed,
  ] as TaskStatus[]).includes(args.status) ? date('2026-07-10') : null;

  const existing = await prisma.assessmentTask.findFirst({
    where: { cycleId: args.cycle.id, employeeId: args.employee.id },
  });
  const taskData = {
    snapshotId: args.snapshotId,
    deptId: args.employee.deptId,
    managerId: args.manager.id,
    deptHeadId: args.manager.id,
    approverId: args.approverId,
    status: args.status,
    indicatorSetAt,
    indicatorConfirmedAt,
    selfEvalSubmittedAt: hasSelfEvaluation ? date('2026-09-22') : null,
    managerScoredAt: hasManagerEvaluation ? date('2026-09-25') : null,
    hrCalibratedAt: isPublished ? date('2026-09-27') : null,
    approvedAt: isPublished ? date('2026-09-28') : null,
    publishedAt: isPublished ? date('2026-09-29') : null,
    employeeConfirmedAt: args.status === TaskStatus.confirmed ? date('2026-09-30') : null,
  };
  const task = existing
    ? await prisma.assessmentTask.update({ where: { id: existing.id }, data: taskData })
    : await prisma.assessmentTask.create({
        data: {
          cycleId: args.cycle.id,
          employeeId: args.employee.id,
          ...taskData,
        },
      });

  await prisma.indicatorInstance.deleteMany({ where: { taskId: task.id } });
  const indicators = args.template.dimensions.flatMap((dimension, dimensionIndex) =>
    dimension.indicators.map((indicator, indicatorIndex) => ({
      taskId: task.id,
      templateIndicatorId: indicator.id,
      name: indicator.name,
      description: `测试验收指标：${indicator.name}`,
      scoringStandard: indicator.scoringStandard,
      dataSource: '测试验收数据源',
      dataCaliber: '仅用于固定测试账号验收，不纳入真实员工统计',
      targetValue: indicator.targetValue,
      targetValueText: indicator.targetValue ? `${indicator.targetValue}${indicator.unit ?? ''}` : null,
      unit: indicator.unit,
      weight: indicator.weight,
      indicatorType: indicator.name.includes('加分') ? IndicatorType.bonus : IndicatorType.kpi,
      dimensionName: dimension.name,
      dimensionWeight: dimension.weight,
      actualValue: hasSelfEvaluation ? 86 : null,
      actualNote: hasSelfEvaluation ? '测试员工已填写本周期完成情况。' : null,
      selfScore: hasSelfEvaluation ? 86 : null,
      selfComment: hasSelfEvaluation ? '按计划完成测试项目里程碑，并补齐过程记录。' : null,
      managerScore: hasManagerEvaluation ? 85 : null,
      managerComment: hasManagerEvaluation ? '交付稳定，建议继续提升跨团队协同。' : null,
      finalScore: isPublished ? 85 : null,
      sortOrder: dimensionIndex * 100 + indicatorIndex,
    })),
  );
  await prisma.indicatorInstance.createMany({ data: indicators });

  await prisma.selfEvalSummary.deleteMany({ where: { taskId: task.id } });
  if (hasSelfEvaluation) {
    await prisma.selfEvalSummary.create({
      data: {
        taskId: task.id,
        achievements: '完成测试周期核心目标，可用于主管评分页面验收。',
        improvements: '后续继续优化风险识别与跨团队沟通。',
        nextGoals: '完成下一阶段测试项目交付。',
        supportNeeded: '需要主管协调跨部门测试资源。',
        submittedAt: date('2026-09-22'),
      },
    });
  }

  await prisma.managerEvalSummary.deleteMany({ where: { taskId: task.id } });
  if (hasManagerEvaluation) {
    await prisma.managerEvalSummary.create({
      data: {
        taskId: task.id,
        strengths: '目标完成稳定，关键事项推进清晰。',
        improvements: '建议提前识别依赖和交付风险。',
        developmentPlan: '下一周期增加阶段复盘和知识分享。',
        submittedAt: date('2026-09-25'),
      },
    });
  }

  await prisma.gradeResult.deleteMany({ where: { taskId: task.id } });
  if (isPublished) {
    await prisma.gradeResult.create({
      data: {
        taskId: task.id,
        calculatedScore: 85,
        rawGrade: PerfGrade.B,
        calibratedGrade: PerfGrade.B,
        calibrationNote: '测试验收数据：校准通过。',
        coefficient: 1,
        isPublished: true,
        publishedAt: date('2026-09-29'),
        hrCalibratorId: args.hrId,
        hrCalibratedAt: date('2026-09-27'),
        approverId: args.approverId,
        approvedAt: date('2026-09-28'),
      },
    });
  }

  await prisma.flowRecord.deleteMany({ where: { taskId: task.id } });
  const flowRecords: Array<{
    taskId: string;
    cycleId: string;
    nodeType: FlowNodeType;
    actorId: string;
    action: FlowAction;
    comment: string;
  }> = [];
  if (indicatorSetAt) {
    flowRecords.push({
      taskId: task.id,
      cycleId: args.cycle.id,
      nodeType: FlowNodeType.indicator_setting,
      actorId: args.employee.id,
      action: FlowAction.submit,
      comment: '测试员工提交目标',
    });
  }
  if (hasSelfEvaluation) {
    flowRecords.push({
      taskId: task.id,
      cycleId: args.cycle.id,
      nodeType: FlowNodeType.self_eval,
      actorId: args.employee.id,
      action: FlowAction.submit,
      comment: '测试员工提交自评',
    });
  }
  if (hasManagerEvaluation) {
    flowRecords.push({
      taskId: task.id,
      cycleId: args.cycle.id,
      nodeType: FlowNodeType.manager_score,
      actorId: args.manager.id,
      action: FlowAction.submit,
      comment: '测试主管完成评分',
    });
  }
  if (flowRecords.length) await prisma.flowRecord.createMany({ data: flowRecords });

  if (isPublished) {
    await prisma.performanceArchive.upsert({
      where: { employeeId_cycleId: { employeeId: args.employee.id, cycleId: args.cycle.id } },
      update: {
        employeeName: args.employee.name,
        grade: PerfGrade.B,
        totalScore: 85,
        coefficient: 1,
        summary: { source: 'demo-acceptance', status: args.status },
      },
      create: {
        employeeId: args.employee.id,
        cycleId: args.cycle.id,
        employeeName: args.employee.name,
        grade: PerfGrade.B,
        totalScore: 85,
        coefficient: 1,
        summary: { source: 'demo-acceptance', status: args.status },
      },
    });
  }
}

async function ensureAcceptanceData(
  userMap: Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>,
  template: Awaited<ReturnType<typeof ensureTemplate>>,
) {
  const cycle = await ensureAcceptanceCycle(userMap);
  const snapshot = await ensureSnapshot(cycle.id, template);
  const hr = userMap.get('HR001')!;
  const approver = userMap.get('VP001')!;

  for (const plan of ACCEPTANCE_TASK_PLAN) {
    await ensureAcceptanceTask({
      cycle,
      template,
      snapshotId: snapshot.id,
      employee: userMap.get(plan.employeeNo)!,
      manager: userMap.get(plan.managerNo)!,
      hrId: hr.id,
      approverId: approver.id,
      status: plan.status,
    });
  }
}

async function ensureTask(args: {
  cycle: Awaited<ReturnType<typeof ensureCycle>>;
  snapshotId: string;
  employee: Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;
  managerId: string;
  approverId: string;
  score: number;
  grade: PerfGrade;
  confirmed: boolean;
}) {
  const status = args.confirmed ? TaskStatus.confirmed : TaskStatus.published;
  const existing = await prisma.assessmentTask.findFirst({
    where: { cycleId: args.cycle.id, employeeId: args.employee.id },
  });
  const task = existing
    ? await prisma.assessmentTask.update({
        where: { id: existing.id },
        data: {
          snapshotId: args.snapshotId,
          deptId: args.employee.deptId,
          managerId: args.managerId,
          deptHeadId: args.managerId,
          approverId: args.approverId,
          status,
          indicatorSetAt: args.cycle.startDate,
          indicatorConfirmedAt: args.cycle.startDate,
          selfEvalSubmittedAt: args.cycle.endDate,
          managerScoredAt: args.cycle.endDate,
          hrCalibratedAt: args.cycle.endDate,
          approvedAt: args.cycle.endDate,
          publishedAt: args.cycle.endDate,
          employeeConfirmedAt: args.confirmed ? args.cycle.endDate : null,
        },
      })
    : await prisma.assessmentTask.create({
        data: {
          cycleId: args.cycle.id,
          snapshotId: args.snapshotId,
          employeeId: args.employee.id,
          deptId: args.employee.deptId,
          managerId: args.managerId,
          deptHeadId: args.managerId,
          approverId: args.approverId,
          status,
          indicatorSetAt: args.cycle.startDate,
          indicatorConfirmedAt: args.cycle.startDate,
          selfEvalSubmittedAt: args.cycle.endDate,
          managerScoredAt: args.cycle.endDate,
          hrCalibratedAt: args.cycle.endDate,
          approvedAt: args.cycle.endDate,
          publishedAt: args.cycle.endDate,
          employeeConfirmedAt: args.confirmed ? args.cycle.endDate : null,
        },
      });

  await prisma.indicatorInstance.deleteMany({ where: { taskId: task.id } });
  await prisma.indicatorInstance.createMany({
    data: [
      {
        taskId: task.id,
        name: '核心项目交付',
        scoringStandard: '按里程碑、质量、交付及时性综合评分',
        targetValue: 100,
        unit: '分',
        weight: 0.45,
        indicatorType: IndicatorType.kpi,
        dimensionName: '业绩目标',
        dimensionWeight: 0.7,
        actualValue: args.score,
        selfScore: Math.max(60, args.score - 2),
        selfComment: '已按计划完成主要工作。',
        managerScore: args.score,
        managerComment: '整体达成较好，关键事项推进稳定。',
        finalScore: args.score,
        sortOrder: 0,
      },
      {
        taskId: task.id,
        name: '协作与责任心',
        scoringStandard: '按协作、响应和责任承担评分',
        targetValue: 100,
        unit: '分',
        weight: 0.3,
        indicatorType: IndicatorType.attitude,
        dimensionName: '能力态度',
        dimensionWeight: 0.3,
        actualValue: Math.min(100, args.score + 3),
        selfScore: Math.min(100, args.score + 2),
        selfComment: '积极配合团队协作。',
        managerScore: Math.min(100, args.score + 1),
        managerComment: '协作意识较好。',
        finalScore: Math.min(100, args.score + 1),
        sortOrder: 1,
      },
    ],
  });

  await prisma.selfEvalSummary.upsert({
    where: { taskId: task.id },
    update: {
      achievements: '完成本周期核心目标，过程记录完整。',
      improvements: '后续需提升跨部门提前沟通。',
      nextGoals: '围绕下周期重点项目继续推进。',
      submittedAt: args.cycle.endDate,
    },
    create: {
      taskId: task.id,
      achievements: '完成本周期核心目标，过程记录完整。',
      improvements: '后续需提升跨部门提前沟通。',
      nextGoals: '围绕下周期重点项目继续推进。',
      submittedAt: args.cycle.endDate,
    },
  });

  await prisma.managerEvalSummary.upsert({
    where: { taskId: task.id },
    update: {
      strengths: '目标完成稳定，执行质量较好。',
      improvements: '建议加强风险前置识别。',
      developmentPlan: '下周期增加阶段复盘。',
      submittedAt: args.cycle.endDate,
    },
    create: {
      taskId: task.id,
      strengths: '目标完成稳定，执行质量较好。',
      improvements: '建议加强风险前置识别。',
      developmentPlan: '下周期增加阶段复盘。',
      submittedAt: args.cycle.endDate,
    },
  });

  await prisma.gradeResult.upsert({
    where: { taskId: task.id },
    update: {
      calculatedScore: args.score,
      rawGrade: args.grade,
      calibratedGrade: args.grade,
      calibrationNote: args.grade === PerfGrade.A ? '高分已校准，关注部门分布是否合理。' : '校准通过。',
      coefficient: gradeCoefficient(args.grade),
      isPublished: true,
      publishedAt: args.cycle.endDate,
      hrCalibratedAt: args.cycle.endDate,
      approverId: args.approverId,
      approvedAt: args.cycle.endDate,
      employeeConfirmedAt: args.confirmed ? args.cycle.endDate : null,
    },
    create: {
      taskId: task.id,
      calculatedScore: args.score,
      rawGrade: args.grade,
      calibratedGrade: args.grade,
      calibrationNote: args.grade === PerfGrade.A ? '高分已校准，关注部门分布是否合理。' : '校准通过。',
      coefficient: gradeCoefficient(args.grade),
      isPublished: true,
      publishedAt: args.cycle.endDate,
      hrCalibratedAt: args.cycle.endDate,
      approverId: args.approverId,
      approvedAt: args.cycle.endDate,
      employeeConfirmedAt: args.confirmed ? args.cycle.endDate : null,
    },
  });

  await prisma.performanceInterview.upsert({
    where: { taskId: task.id },
    update: {
      status: args.confirmed ? InterviewStatus.closed : InterviewStatus.pending,
      scoreInformed: true,
      achievements: '确认本周期主要成果。',
      weaknesses: '需要进一步提升计划前置性。',
      nextGoals: '下周期聚焦关键指标。',
      deadline: args.cycle.endDate,
    },
    create: {
      taskId: task.id,
      cycleId: args.cycle.id,
      employeeId: args.employee.id,
      interviewerId: args.managerId,
      status: args.confirmed ? InterviewStatus.closed : InterviewStatus.pending,
      scoreInformed: true,
      achievements: '确认本周期主要成果。',
      weaknesses: '需要进一步提升计划前置性。',
      nextGoals: '下周期聚焦关键指标。',
      deadline: args.cycle.endDate,
    },
  });

  await prisma.performanceArchive.upsert({
    where: { employeeId_cycleId: { employeeId: args.employee.id, cycleId: args.cycle.id } },
    update: {
      employeeName: args.employee.name,
      deptName: null,
      grade: args.grade,
      totalScore: args.score,
      coefficient: gradeCoefficient(args.grade),
      summary: { source: 'demo-history', confirmed: args.confirmed },
    },
    create: {
      employeeId: args.employee.id,
      cycleId: args.cycle.id,
      employeeName: args.employee.name,
      deptName: null,
      grade: args.grade,
      totalScore: args.score,
      coefficient: gradeCoefficient(args.grade),
      summary: { source: 'demo-history', confirmed: args.confirmed },
    },
  });

  await prisma.flowRecord.deleteMany({ where: { taskId: task.id } });
  await prisma.flowRecord.createMany({
    data: [
      { taskId: task.id, cycleId: args.cycle.id, nodeType: FlowNodeType.self_eval, actorId: args.employee.id, action: FlowAction.submit, comment: '员工提交自评' },
      { taskId: task.id, cycleId: args.cycle.id, nodeType: FlowNodeType.manager_score, actorId: args.managerId, action: FlowAction.submit, comment: '主管完成评分' },
      { taskId: task.id, cycleId: args.cycle.id, nodeType: FlowNodeType.hr_calibration, action: FlowAction.approve, comment: 'HR校准通过' },
      { taskId: task.id, cycleId: args.cycle.id, nodeType: FlowNodeType.publish, action: FlowAction.approve, comment: '结果已发布' },
    ],
  });
}

async function ensureObjectives(userMap: Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>) {
  const hr = userMap.get('HR001')!;
  const manager = userMap.get('MGR001')!;
  const emp1 = userMap.get('EMP001')!;
  const rdDept = await prisma.department.findFirstOrThrow({ where: { name: '测试研发部' } });

  await prisma.objective.deleteMany({
    where: { OR: [{ title: { startsWith: '测试演示-' } }, { title: { startsWith: '演示-' } }] },
  });

  const company = await prisma.objective.create({
    data: {
      title: '测试演示-提升核心产品交付质量',
      description: '公司级目标：聚焦交付质量、客户满意度和稳定性。',
      level: ObjectiveLevel.company,
      status: ObjectiveStatus.active,
      progress: 72,
      priority: 1,
      weight: 40,
      createdBy: hr.id,
    },
  });
  const department = await prisma.objective.create({
    data: {
      title: '测试演示-研发部关键项目按期上线',
      description: '部门级目标：关键项目按期上线，线上缺陷率下降。',
      level: ObjectiveLevel.department,
      parentId: company.id,
      deptId: rdDept.id,
      status: ObjectiveStatus.active,
      progress: 68,
      priority: 1,
      weight: 60,
      createdBy: manager.id,
    },
  });
  const personal = await prisma.objective.create({
    data: {
      title: '测试演示-张辰负责模块完成灰度发布',
      description: '个人级目标：完成核心模块灰度、监控和复盘。',
      level: ObjectiveLevel.individual,
      parentId: department.id,
      deptId: rdDept.id,
      ownerId: emp1.id,
      status: ObjectiveStatus.active,
      progress: 75,
      priority: 2,
      weight: 30,
      createdBy: manager.id,
    },
  });

  await prisma.actionItem.createMany({
    data: [
      {
        objectiveId: personal.id,
        title: '测试演示-完成接口联调',
        description: '与前端完成核心流程联调。',
        assigneeId: emp1.id,
        status: ActionItemStatus.done,
        progress: 100,
        createdBy: manager.id,
      },
      {
        objectiveId: personal.id,
        title: '测试演示-补齐发布监控',
        description: '补齐异常告警和上线观察记录。',
        assigneeId: emp1.id,
        status: ActionItemStatus.in_progress,
        progress: 60,
        createdBy: manager.id,
      },
    ],
  });
}

async function main() {
  const { password } = requireDemoHistorySeed(process.env);
  const userMap = await ensureUsers(password);
  await isolateFixedTestAccounts(userMap);
  const hr = userMap.get('HR001')!;
  const manager = userMap.get('MGR001')!;
  const approver = userMap.get('VP001')!;
  const template = await ensureTemplate(hr.id);

  await ensureAcceptanceData(userMap, template);

  for (const spec of cycleSpecs) {
    const cycle = await ensureCycle(spec, hr.id);
    const snapshot = await ensureSnapshot(cycle.id, template);
    for (const item of scoreBook[spec.name]) {
      const employee = await prisma.user.findUniqueOrThrow({ where: { employeeNo: item.no } });
      await ensureTask({
        cycle,
        snapshotId: snapshot.id,
        employee,
        managerId: manager.id,
        approverId: approver.id,
        score: item.score,
        grade: item.grade,
        confirmed: item.confirmed,
      });
    }
  }

  await ensureObjectives(userMap);
  console.log('Demo history seeded. Fixed test accounts: 8. Password was supplied at runtime and was not logged.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
