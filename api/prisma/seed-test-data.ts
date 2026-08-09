import { PrismaClient, SysRole, CycleStatus, TaskStatus, IndicatorType, DimensionType, PerfGrade } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const E2E_CYCLE_PREFIX = 'E2E-acceptance-';
const E2E_TEMPLATE_PREFIX = 'E2E-template-';

const CYCLE_NAMES = [
  `${E2E_CYCLE_PREFIX}indicator-confirm`,
  `${E2E_CYCLE_PREFIX}indicator-reject`,
  `${E2E_CYCLE_PREFIX}goal-review`,
  `${E2E_CYCLE_PREFIX}self-eval`,
  `${E2E_CYCLE_PREFIX}manager-score`,
  `${E2E_CYCLE_PREFIX}hr-calibration`,
  `${E2E_CYCLE_PREFIX}approval`,
];

async function main() {
  // Keep the browser global setup and seeded acceptance accounts on one credential.
  const passwordHash = await bcrypt.hash('000000', 10);
  const dept = await prisma.department.findFirst({ where: { parentId: { not: null } } });
  if (!dept) throw new Error('缺少部门数据，请先跑基础 seed');

  const oldCycles = await prisma.assessmentCycle.findMany({
    where: { name: { startsWith: E2E_CYCLE_PREFIX } },
    select: { id: true },
  });
  for (const cycle of oldCycles) {
    await prisma.assessmentTask.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.assessmentTemplateSnapshot.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.assessmentCycle.delete({ where: { id: cycle.id } });
  }
  await prisma.assessmentTemplate.deleteMany({ where: { name: { startsWith: E2E_TEMPLATE_PREFIX } } });

  // 创建测试账号
  const employee1 = await prisma.user.upsert({
    where: { employeeNo: 'EMP001' },
    update: { passwordHash, sysRole: SysRole.employee, status: 'active', deptId: dept.id, position: '专员' },
    create: {
      employeeNo: 'EMP001',
      name: '测试员工甲',
      passwordHash,
      sysRole: SysRole.employee,
      status: 'active',
      deptId: dept.id,
      position: '专员',
    },
  });
  const employee2 = await prisma.user.upsert({
    where: { employeeNo: 'EMP002' },
    update: { passwordHash, sysRole: SysRole.employee, status: 'active', deptId: dept.id, position: '专员' },
    create: {
      employeeNo: 'EMP002',
      name: '测试员工乙',
      passwordHash,
      sysRole: SysRole.employee,
      status: 'active',
      deptId: dept.id,
      position: '专员',
    },
  });
  const manager = await prisma.user.upsert({
    where: { employeeNo: 'MGR001' },
    update: { passwordHash, sysRole: SysRole.manager, status: 'active', deptId: dept.id, position: '主管' },
    create: {
      employeeNo: 'MGR001',
      name: '测试主管',
      passwordHash,
      sysRole: SysRole.manager,
      status: 'active',
      deptId: dept.id,
      position: '主管',
    },
  });
  const hr = await prisma.user.upsert({
    where: { employeeNo: 'HR001' },
    update: { passwordHash, sysRole: SysRole.hr, status: 'active', deptId: dept.id, position: 'HR', canViewAll: true },
    create: {
      employeeNo: 'HR001',
      name: '测试HR',
      passwordHash,
      sysRole: SysRole.hr,
      status: 'active',
      deptId: dept.id,
      position: 'HR',
      canViewAll: true,
    },
  });
  const vp = await prisma.user.upsert({
    where: { employeeNo: 'VP001' },
    update: { passwordHash, sysRole: SysRole.vp, status: 'active', deptId: dept.id, position: 'VP' },
    create: {
      employeeNo: 'VP001',
      name: '测试VP',
      passwordHash,
      sysRole: SysRole.vp,
      status: 'active',
      deptId: dept.id,
      position: 'VP',
    },
  });

  await prisma.user.update({ where: { id: employee1.id }, data: { directManagerId: manager.id } });
  await prisma.user.update({ where: { id: employee2.id }, data: { directManagerId: manager.id } });

  // 创建周期
  const cycles: Record<string, any> = {};
  for (const name of CYCLE_NAMES) {
    cycles[name] = await prisma.assessmentCycle.create({
      data: {
        name,
        type: 'quarterly',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
        status: CycleStatus.draft,
        createdBy: hr.id,
        gradeAMaxRatio: 0.2,
        gradeBMaxRatio: 0.4,
        gradeCMaxRatio: 0.3,
        gradeDMaxRatio: 0.1,
      },
    });
  }

  // 创建快照和任务（每个周期独立模板，避免快照唯一约束）
  const taskMap: Record<string, any> = {};

  // 指标确认-确认：EMP001
  taskMap['indicatorConfirm'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}indicator-confirm`], hr.id, employee1, manager, vp, TaskStatus.indicator_confirming,
  );

  // 指标确认-退回：EMP002
  taskMap['indicatorReject'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}indicator-reject`], hr.id, employee2, manager, vp, TaskStatus.indicator_confirming,
  );

  // Manager goal-review workspace: EMP001 has a submitted indicator awaiting direct-manager review.
  taskMap['goalReview'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}goal-review`], hr.id, employee1, manager, vp, TaskStatus.indicator_reviewing,
  );

  // 自评周期：EMP001
  taskMap['selfEval'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}self-eval`], hr.id, employee1, manager, vp, TaskStatus.self_eval,
  );

  // 主管评分周期：EMP001，先模拟主管已评过分
  taskMap['managerScore'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}manager-score`], hr.id, employee1, manager, vp, TaskStatus.manager_scoring, true,
  );

  // HR校准周期：EMP001、EMP002 都已经理评分
  taskMap['calibration1'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}hr-calibration`], hr.id, employee1, manager, vp, TaskStatus.hr_calibration, true,
  );
  taskMap['calibration2'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}hr-calibration`], hr.id, employee2, manager, vp, TaskStatus.hr_calibration, true,
  );

  // 审批周期：EMP001、EMP002 都已校准
  taskMap['approval1'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}approval`], hr.id, employee1, manager, vp, TaskStatus.approval, true, 'B',
  );
  taskMap['approval2'] = await createTaskWithStatus(
    cycles[`${E2E_CYCLE_PREFIX}approval`], hr.id, employee2, manager, vp, TaskStatus.approval, true, 'C',
  );

  console.log('✓ 测试数据创建完成');
  console.log('  员工 EMP001(甲) / EMP002(乙) / 主管 MGR001 / HR HR001 / VP VP001  密码均为 000000');
}

async function createTaskWithStatus(
  cycle: any,
  hrId: string,
  employee: any,
  manager: any,
  approver: any,
  status: TaskStatus,
  hasManagerScore: boolean = false,
  calibratedGrade?: PerfGrade,
) {
  // 每个周期创建一个独立模板
  const template = await prisma.assessmentTemplate.create({
    data: {
      name: `${E2E_TEMPLATE_PREFIX}${cycle.name}`,
      maxScore: 100,
      isActive: true,
      createdBy: hrId,
      dimensions: {
        create: [
          {
            name: '业绩维度',
            type: DimensionType.kpi,
            weight: 0.8,
            sortOrder: 0,
            indicators: {
              create: [
                {
                  name: '销售额完成率',
                  scoringStandard: '按实际销售额/目标销售额 * 100 评分',
                  targetValue: 100,
                  unit: '%',
                  weight: 0.5,
                  sortOrder: 0,
                },
                {
                  name: '客户满意度',
                  scoringStandard: '按客户评分',
                  targetValue: 90,
                  unit: '分',
                  weight: 0.3,
                  sortOrder: 1,
                },
              ],
            },
          },
          {
            name: '加减分',
            type: DimensionType.bonus,
            weight: 0.2,
            sortOrder: 1,
            indicators: {
              create: [
                {
                  name: '加分项',
                  scoringStandard: '突出贡献加分',
                  weight: 0.1999,
                  sortOrder: 0,
                },
                {
                  name: '一票否决项',
                  scoringStandard: '重大失误一票否决',
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
      dimensions: {
        include: { indicators: true },
      },
    },
  });

  const snapshotData = {
    maxScore: template.maxScore,
    dimensions: template.dimensions.map((d: any) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      weight: d.weight,
      indicators: d.indicators.map((ind: any) => ({
        id: ind.id,
        name: ind.name,
        scoringStandard: ind.scoringStandard,
        targetValue: ind.targetValue,
        unit: ind.unit,
        weight: ind.weight,
        indicatorType: inferIndicatorType(ind.name),
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
      deptHeadId: manager.id,
      approverId: approver.id,
      status,
    },
  });

  const instances: any[] = [];
  let sortOrder = 0;
  for (const dim of snapshotData.dimensions) {
    for (const ind of dim.indicators) {
      instances.push({
        taskId: task.id,
        templateIndicatorId: ind.id,
        name: ind.name,
        description: ind.scoringStandard,
        scoringStandard: ind.scoringStandard,
        targetValue: ind.targetValue,
        unit: ind.unit,
        weight: ind.weight,
        indicatorType: ind.indicatorType,
        dimensionName: dim.name,
        dimensionWeight: dim.weight,
        sortOrder: sortOrder++,
      });
    }
  }
  await prisma.indicatorInstance.createMany({ data: instances });

  if (hasManagerScore) {
    await prisma.indicatorInstance.updateMany({
      where: { taskId: task.id },
      data: { managerScore: 85, managerComment: '主管评语' },
    });
    await prisma.managerEvalSummary.create({
      data: {
        taskId: task.id,
        strengths: '业绩稳定',
        improvements: '需加强协作',
      },
    });
  }

  if (status === 'hr_calibration' || status === 'approval') {
    const calculatedScore = status === 'approval' ? (calibratedGrade === 'A' ? 95 : calibratedGrade === 'B' ? 85 : calibratedGrade === 'C' ? 75 : 55) : 85;
    await prisma.gradeResult.create({
      data: {
        taskId: task.id,
        calculatedScore,
        rawGrade: calculatedScore >= 90 ? PerfGrade.A : calculatedScore >= 75 ? PerfGrade.B : calculatedScore >= 60 ? PerfGrade.C : PerfGrade.D,
        coefficient: 1.0,
      },
    });
  }

  if (status === 'approval' && calibratedGrade) {
    await prisma.gradeResult.update({
      where: { taskId: task.id },
      data: { calibratedGrade, calibrationNote: '校准说明', hrCalibratedAt: new Date() },
    });
    await prisma.assessmentTask.update({
      where: { id: task.id },
      data: { hrCalibratedAt: new Date() },
    });
  }

  return task;
}

function inferIndicatorType(name: string): IndicatorType {
  if (name.includes('否决')) return IndicatorType.veto;
  if (name.includes('加分')) return IndicatorType.bonus;
  if (name.includes('减分')) return IndicatorType.penalty;
  return IndicatorType.kpi;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
