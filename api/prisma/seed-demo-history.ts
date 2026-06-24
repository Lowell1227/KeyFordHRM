import {
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

const prisma = new PrismaClient();
const password = '000000';

type DemoUser = {
  employeeNo: string;
  name: string;
  role: SysRole;
  position: string;
  deptName: string;
  managerNo?: string;
  canViewAll?: boolean;
};

const users: DemoUser[] = [
  { employeeNo: 'ADMIN', name: '系统管理员', role: SysRole.system_admin, position: '系统管理员', deptName: '人力资源部', canViewAll: true },
  { employeeNo: 'HR001', name: '姚瑶', role: SysRole.hr, position: 'HRBP', deptName: '人力资源部', canViewAll: true },
  { employeeNo: 'VP001', name: '李宏', role: SysRole.vp, position: '分管副总', deptName: '总经办', canViewAll: true },
  { employeeNo: 'MGR001', name: '周强', role: SysRole.manager, position: '研发主管', deptName: '研发部' },
  { employeeNo: 'EMP001', name: '张晨', role: SysRole.employee, position: '后端工程师', deptName: '研发部', managerNo: 'MGR001' },
  { employeeNo: 'EMP002', name: '陈明', role: SysRole.employee, position: '前端工程师', deptName: '研发部', managerNo: 'MGR001' },
  { employeeNo: 'EMP003', name: '王敏', role: SysRole.employee, position: '销售经理', deptName: '销售部', managerNo: 'MGR001' },
  { employeeNo: 'EMP004', name: '刘洋', role: SysRole.employee, position: '运营专员', deptName: '运营部', managerNo: 'MGR001' },
];

const cycleSpecs = [
  { name: '2025 Q3 绩效考核（历史）', start: '2025-07-01', end: '2025-09-30' },
  { name: '2025 Q4 绩效考核（历史）', start: '2025-10-01', end: '2025-12-31' },
  { name: '2026 Q1 绩效考核（演示）', start: '2026-01-01', end: '2026-03-31' },
];

const scoreBook: Record<string, Array<{ no: string; score: number; grade: PerfGrade; confirmed: boolean }>> = {
  '2025 Q3 绩效考核（历史）': [
    { no: 'EMP001', score: 84, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP002', score: 91, grade: PerfGrade.A, confirmed: true },
    { no: 'EMP003', score: 88, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP004', score: 72, grade: PerfGrade.C, confirmed: true },
  ],
  '2025 Q4 绩效考核（历史）': [
    { no: 'EMP001', score: 87, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP002', score: 89, grade: PerfGrade.B, confirmed: true },
    { no: 'EMP003', score: 94, grade: PerfGrade.A, confirmed: true },
    { no: 'EMP004', score: 68, grade: PerfGrade.C, confirmed: true },
  ],
  '2026 Q1 绩效考核（演示）': [
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
  const existing = await prisma.department.findFirst({ where: { name } });
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

async function ensureUsers() {
  const passwordHash = await bcrypt.hash(password, 10);
  const root = await ensureDepartment('孚德集团');
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
        canViewAll: user.canViewAll ?? false,
        deletedAt: null,
      },
      create: {
        employeeNo: user.employeeNo,
        name: user.name,
        passwordHash,
        sysRole: user.role,
        position: user.position,
        deptId: deptMap.get(user.deptName),
        status: 'active',
        canViewAll: user.canViewAll ?? false,
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
  if (hr) await prisma.department.updateMany({ where: { name: '人力资源部' }, data: { leaderId: hr.id } });
  if (manager) await prisma.department.updateMany({ where: { name: '研发部' }, data: { leaderId: manager.id } });
  if (vp) await prisma.department.updateMany({ where: { name: { in: ['研发部', '销售部', '运营部'] } }, data: { approverId: vp.id } });

  return created;
}

async function ensureTemplate(hrId: string) {
  const existing = await prisma.assessmentTemplate.findFirst({
    where: { name: '演示绩效模板' },
    include: { dimensions: { include: { indicators: true } } },
  });
  if (existing) return existing;

  return prisma.assessmentTemplate.create({
    data: {
      name: '演示绩效模板',
      description: '演示用：业绩、能力态度、加减分组合模板',
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
  const rdDept = await prisma.department.findFirstOrThrow({ where: { name: '研发部' } });

  await prisma.objective.deleteMany({ where: { title: { startsWith: '演示-' } } });

  const company = await prisma.objective.create({
    data: {
      title: '演示-提升核心产品交付质量',
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
      title: '演示-研发部关键项目按期上线',
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
      title: '演示-张晨负责模块完成灰度发布',
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
        title: '演示-完成接口联调',
        description: '与前端完成核心流程联调。',
        assigneeId: emp1.id,
        status: ActionItemStatus.done,
        progress: 100,
        createdBy: manager.id,
      },
      {
        objectiveId: personal.id,
        title: '演示-补齐发布监控',
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
  const userMap = await ensureUsers();
  const hr = userMap.get('HR001')!;
  const manager = userMap.get('MGR001')!;
  const approver = userMap.get('VP001')!;
  const template = await ensureTemplate(hr.id);

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
  console.log(`Demo history seeded. Accounts password: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
