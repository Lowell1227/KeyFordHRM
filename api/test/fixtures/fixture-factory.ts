import { PrismaService } from '@/prisma/prisma.service';
import {
  Prisma,
  SysRole,
  IndicatorType,
  DimensionType,
  CycleType,
  CycleStatus,
  TaskStatus,
  PerfGrade,
  CompanyCode,
  UserStatus,
  EmploymentType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { LaunchService } from '@/cycles/launch.service';

function inferIndicatorType(name: string, dimensionType: DimensionType): IndicatorType {
  if (name.includes('否决')) return 'veto';
  if (name.includes('加分')) return 'bonus';
  if (name.includes('减分')) return 'penalty';
  return dimensionType as unknown as IndicatorType;
}

export interface CreateUserInput {
  employeeNo: string;
  name: string;
  sysRole: SysRole;
  deptId: string;
  directManagerId?: string;
  password?: string;
  entryDate?: Date;
  leaveDate?: Date;
  phone?: string;
  email?: string;
  canViewAll?: boolean;
  isAssessorOnly?: boolean;
}

export interface CreateDeptInput {
  name: string;
  parentId?: string;
  leaderId?: string;
  approverId?: string;
  company?: CompanyCode;
}

export interface CreateIndicatorInput {
  name: string;
  type: IndicatorType;
  scoringStandard?: string;
  targetValue?: number;
  unit?: string;
  createdBy: string;
  code?: string;
}

export interface CreateTemplateInput {
  name: string;
  createdBy: string;
  applicableDepts?: string[];
  applicableUsers?: string[];
  dimensions?: Array<{
    name: string;
    type: DimensionType;
    weight: number;
    indicators: Array<{
      name: string;
      weight: number;
      type?: IndicatorType;
      scoringStandard?: string;
      targetValue?: number;
      unit?: string;
    }>;
  }>;
}

export interface CreateCycleInput {
  name: string;
  createdBy: string;
  type?: CycleType;
  status?: CycleStatus;
  startDate?: Date;
  endDate?: Date;
  deadlineIndicatorSetting?: Date;
  deadlineIndicatorConfirm?: Date;
  deadlineSelfEval?: Date;
  deadlineManagerScore?: Date;
  deadlineHrCalibration?: Date;
  deadlineApproval?: Date;
  deadlinePublish?: Date;
  deadlineAppeal?: Date;
  publishVisibleFields?: Prisma.InputJsonValue;
  gradeAMaxRatio?: number;
  gradeBMaxRatio?: number;
  gradeCMaxRatio?: number;
  gradeDMaxRatio?: number;
}

/**
 * E2E 测试 fixture 工厂。
 *
 * 所有方法直接操作 Prisma，避免通过 API 走权限/校验，便于快速构造任意状态的数据。
 */
export class FixtureFactory {
  constructor(private readonly prisma: PrismaService) {}

  /** 取一个种子部门（默认取“项目一部”）用于挂测试用户。 */
  async getSeedDept(): Promise<{ id: string; name: string; leaderId: string | null; approverId: string | null }> {
    const dept = await this.prisma.department.findFirst({
      where: { parentId: { not: null } },
      orderBy: { sortOrder: 'asc' },
    });
    if (!dept) throw new Error('基础 seed 未写入部门，请先跑 prisma db seed');
    return dept;
  }

  async createUser(input: CreateUserInput) {
    const passwordHash = await bcrypt.hash(input.password ?? 'test123', 10);
    return this.prisma.user.create({
      data: {
        employeeNo: input.employeeNo,
        name: input.name,
        sysRole: input.sysRole,
        deptId: input.deptId,
        directManagerId: input.directManagerId ?? null,
        passwordHash,
        status: UserStatus.active,
        employmentType: EmploymentType.full_time,
        entryDate: input.entryDate ?? new Date('2020-01-01'),
        leaveDate: input.leaveDate ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        canViewAll: input.canViewAll ?? false,
        isAssessorOnly: input.isAssessorOnly ?? false,
      },
    });
  }

  async createDept(input: CreateDeptInput) {
    return this.prisma.department.create({
      data: {
        name: input.name,
        parentId: input.parentId ?? null,
        leaderId: input.leaderId ?? null,
        approverId: input.approverId ?? null,
        company: input.company ?? CompanyCode.fuede,
        sortOrder: 999,
      },
    });
  }

  async updateDeptLeader(deptId: string, leaderId: string | null) {
    return this.prisma.department.update({ where: { id: deptId }, data: { leaderId } });
  }

  async updateDeptApprover(deptId: string, approverId: string | null) {
    return this.prisma.department.update({ where: { id: deptId }, data: { approverId } });
  }

  async updateUserManager(userId: string, managerId: string | null) {
    return this.prisma.user.update({ where: { id: userId }, data: { directManagerId: managerId } });
  }

  async updateUserRole(userId: string, role: SysRole) {
    return this.prisma.user.update({ where: { id: userId }, data: { sysRole: role } });
  }

  async createIndicator(input: CreateIndicatorInput) {
    return this.prisma.indicator.create({
      data: {
        name: input.name,
        type: input.type,
        code: input.code ?? null,
        scoringStandard: input.scoringStandard ?? null,
        targetValue: input.targetValue != null ? new Prisma.Decimal(input.targetValue) : null,
        unit: input.unit ?? null,
        isActive: true,
        createdBy: input.createdBy,
      },
    });
  }

  /** 创建任务卡要求的标准模板。 */
  async createStandardTemplate(input: Pick<CreateTemplateInput, 'name' | 'createdBy' | 'applicableDepts' | 'applicableUsers'>) {
    return this.createTemplate({
      name: input.name,
      createdBy: input.createdBy,
      applicableDepts: input.applicableDepts,
      applicableUsers: input.applicableUsers,
      dimensions: [
        {
          name: 'KPI维度',
          type: DimensionType.kpi,
          weight: 0.6,
          indicators: [
            { name: '指标A', weight: 0.5, scoringStandard: '销售额完成率' },
            { name: '指标B', weight: 0.5, scoringStandard: '客户满意度' },
          ],
        },
        {
          name: '态度维度',
          type: DimensionType.attitude,
          weight: 0.4,
          indicators: [{ name: '指标C', weight: 1.0, scoringStandard: '工作态度' }],
        },
        {
          name: '加减分项',
          type: DimensionType.bonus,
          weight: 0.0001,
          indicators: [
            { name: '加分项', weight: 1, type: IndicatorType.bonus, scoringStandard: '突出贡献' },
            { name: '减分项', weight: 1, type: IndicatorType.penalty, scoringStandard: '重大失误' },
            { name: '一票否决', weight: 0.0001, type: IndicatorType.veto, scoringStandard: '一票否决' },
          ],
        },
      ],
    });
  }

  async createTemplate(input: CreateTemplateInput) {
    return this.prisma.assessmentTemplate.create({
      data: {
        name: input.name,
        isActive: true,
        maxScore: new Prisma.Decimal(100),
        createdBy: input.createdBy,
        applicableDepts: input.applicableDepts ?? [],
        applicableUsers: input.applicableUsers ?? [],
        dimensions: {
          create: input.dimensions?.map((dim, dimIndex) => ({
            name: dim.name,
            type: dim.type,
            weight: new Prisma.Decimal(dim.weight),
            sortOrder: dimIndex,
            indicators: {
              create: dim.indicators.map((ind, indIndex) => ({
                name: ind.name,
                weight: new Prisma.Decimal(ind.weight),
                scoringStandard: ind.scoringStandard ?? null,
                targetValue: ind.targetValue != null ? new Prisma.Decimal(ind.targetValue) : null,
                unit: ind.unit ?? null,
                sortOrder: indIndex,
              })),
            },
          })),
        },
      },
      include: { dimensions: { include: { indicators: true } } },
    });
  }

  async createCycle(input: CreateCycleInput) {
    return this.prisma.assessmentCycle.create({
      data: {
        name: input.name,
        type: input.type ?? CycleType.quarterly,
        status: input.status ?? CycleStatus.draft,
        startDate: input.startDate ?? new Date('2026-01-01'),
        endDate: input.endDate ?? new Date('2026-03-31'),
        deadlineIndicatorSetting: input.deadlineIndicatorSetting ?? null,
        deadlineIndicatorConfirm: input.deadlineIndicatorConfirm ?? null,
        deadlineSelfEval: input.deadlineSelfEval ?? null,
        deadlineManagerScore: input.deadlineManagerScore ?? null,
        deadlineHrCalibration: input.deadlineHrCalibration ?? null,
        deadlineApproval: input.deadlineApproval ?? null,
        deadlinePublish: input.deadlinePublish ?? null,
        deadlineAppeal: input.deadlineAppeal ?? null,
        createdBy: input.createdBy,
        hrOwnerId: input.createdBy,
        gradeAMaxRatio: new Prisma.Decimal(input.gradeAMaxRatio ?? 0.2),
        gradeBMaxRatio: new Prisma.Decimal(input.gradeBMaxRatio ?? 0.4),
        gradeCMaxRatio: new Prisma.Decimal(input.gradeCMaxRatio ?? 0.3),
        gradeDMaxRatio: new Prisma.Decimal(input.gradeDMaxRatio ?? 0.1),
        publishVisibleFields:
          input.publishVisibleFields ??
          ({
            total_score: true,
            grade: true,
            indicator_scores: true,
            manager_comment: true,
            coefficient: false,
          } as Prisma.InputJsonValue),
      },
    });
  }

  async launchCycle(cycleId: string, operatorId: string, launchService?: LaunchService) {
    if (launchService) {
      const checked = await launchService.preflight(cycleId);
      return launchService.launch(cycleId, {
        id: operatorId,
        name: 'operator',
        sysRole: SysRole.hr,
        deptId: null,
        isAssessorOnly: false,
        canViewAll: false,
      }, { expectedPlanHash: checked.planHash! });
    }

    return this.prisma.assessmentCycle.update({
      where: { id: cycleId },
      data: { status: CycleStatus.indicator_setting },
    });
  }

  /**
   * 在指定状态直接创建任务（含快照、指标实例、可选 gradeResult）。
   * 用于负面/边界/数据红线用例，不依赖完整 launch 流程。
   */
  async createTaskInStatus(input: {
    cycleId?: string;
    employeeId: string;
    managerId: string;
    deptHeadId?: string;
    approverId?: string;
    status: TaskStatus;
    deptId?: string;
    hasManagerScore?: boolean;
    calculatedScore?: number;
    rawGrade?: PerfGrade;
    calibratedGrade?: PerfGrade;
    isVeto?: boolean;
    isExempt?: boolean;
    exemptReason?: string;
    publishVisibleFields?: Record<string, boolean>;
  }) {
    const dept = input.deptId ? { id: input.deptId } : await this.getSeedDept();

    let cycleId = input.cycleId;
    if (!cycleId) {
      const cycle = await this.createCycle({
        name: `direct-task-${Date.now()}`,
        createdBy: input.managerId,
        status: CycleStatus.draft,
        publishVisibleFields: input.publishVisibleFields,
      });
      cycleId = cycle.id;
    }

    const template = await this.createStandardTemplate({
      name: `direct-template-${Date.now()}`,
      createdBy: input.managerId,
      applicableDepts: [dept.id],
    });

    const snapshotData = {
      templateId: template.id,
      name: template.name,
      maxScore: 100,
      version: 1,
      dimensions: template.dimensions.map((dim) => ({
        id: dim.id,
        name: dim.name,
        type: dim.type,
        weight: dim.weight.toNumber(),
        sortOrder: dim.sortOrder,
        indicators: dim.indicators.map((ind) => ({
          id: ind.id,
          name: ind.name,
          weight: ind.weight.toNumber(),
          scoringStandard: ind.scoringStandard,
          targetValue: ind.targetValue?.toNumber() ?? null,
          unit: ind.unit,
          indicatorType: inferIndicatorType(ind.name, dim.type),
          sortOrder: ind.sortOrder,
        })),
      })),
    };

    const snapshot = await this.prisma.assessmentTemplateSnapshot.create({
      data: {
        cycleId,
        templateId: template.id,
        snapshotData: snapshotData as Prisma.InputJsonValue,
      },
    });

    const task = await this.prisma.assessmentTask.create({
      data: {
        cycleId,
        snapshotId: snapshot.id,
        employeeId: input.employeeId,
        deptId: dept.id,
        managerId: input.managerId,
        deptHeadId: input.deptHeadId ?? input.managerId,
        approverId: input.approverId ?? null,
        status: input.status,
        isExempt: input.isExempt ?? false,
        exemptReason: input.exemptReason ?? null,
      },
    });

    const instances = template.dimensions.flatMap((dim) =>
      dim.indicators.map((ind) => ({
        taskId: task.id,
        templateIndicatorId: ind.id,
        name: ind.name,
        description: ind.scoringStandard,
        scoringStandard: ind.scoringStandard,
        targetValue: ind.targetValue,
        unit: ind.unit,
        weight: new Prisma.Decimal(ind.weight),
        indicatorType: inferIndicatorType(ind.name, dim.type),
        dimensionName: dim.name,
        dimensionWeight: new Prisma.Decimal(dim.weight),
        sortOrder: ind.sortOrder,
      })),
    );

    await this.prisma.indicatorInstance.createMany({ data: instances });

    if (input.hasManagerScore || input.calculatedScore != null) {
      const score = input.calculatedScore ?? 85;
      await this.prisma.gradeResult.create({
        data: {
          taskId: task.id,
          calculatedScore: new Prisma.Decimal(score),
          rawGrade:
            input.rawGrade ??
            (score >= 90 ? PerfGrade.A : score >= 75 ? PerfGrade.B : score >= 60 ? PerfGrade.C : PerfGrade.D),
          calibratedGrade: input.calibratedGrade ?? null,
          coefficient: new Prisma.Decimal(1.0),
          isVeto: input.isVeto ?? false,
        },
      });
    }

    return task;
  }

  /**
   * 重置数据表（保留系统配置、部门树）。
   * 按外键依赖顺序 truncate。
   */
  async resetDataTables(): Promise<void> {
    const tables = [
      'audit_logs',
      'signatures',
      'notification_logs',
      'flow_records',
      'appeals',
      'performance_archives',
      'performance_interviews',
      'improvement_plans',
      'grade_results',
      'manager_eval_summaries',
      'self_eval_summaries',
      'indicator_instances',
      'assessment_tasks',
      'assessment_template_snapshots',
      'assessment_cycles',
      'assessment_templates',
      'template_indicators',
      'template_dimensions',
      'indicators',
      'employment_records',
    ];

    for (const table of tables) {
      try {
        await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      } catch (e) {
        // 表不存在时忽略（兼容 schema 变化）
        console.warn(`truncate ${table} 失败`, (e as Error).message);
      }
    }

    // 清空用户前先把部门外键置空，避免 DELETE RESTRICT 失败；
    // 不使用 TRUNCATE CASCADE，否则 departments 也会因外键约束被清空。
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "departments" SET leader_id = NULL, approver_id = NULL;`,
      );
    } catch (e) {
      console.warn('清空部门外键失败', (e as Error).message);
    }

    try {
      await this.prisma.$executeRawUnsafe(`DELETE FROM "users";`);
    } catch (e) {
      console.warn('delete users 失败', (e as Error).message);
    }
  }
}
