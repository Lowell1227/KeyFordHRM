import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentCycle, PerfGrade, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { FlowService } from '@/tasks/flow.service';
import { CalibrateGradesDto, CalibrationItemDto } from './dto/calibrate-grades.dto';
import { claimTaskVersion } from '@/tasks/task-version';

/** 等级分布单项。 */
export interface GradeDistributionEntry {
  count: number;
  ratio: number;
  maxRatio: number;
  isOverLimit: boolean;
}

/** 校准工作台列表项。 */
export interface CalibrationWorkbenchItem {
  taskId: string;
  employeeName: string;
  deptName: string | null;
  position: string | null;
  calculatedScore: number | null;
  rawGrade: PerfGrade | null;
  calibratedGrade: PerfGrade | null;
  isVeto: boolean;
  managerName: string | null;
}

/** 校准工作台响应。 */
export interface CalibrationWorkbench {
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  totalActive: number;
  pendingCalibration: number;
  items: CalibrationWorkbenchItem[];
}

/** 批量校准提交响应。 */
export interface CalibrateGradesResult {
  submit: boolean;
  updated: number;
  transitioned: number;
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  warnings: string[];
}

/** 默认等级系数（system_configs.grade_coefficients 未配置时回退）。 */
const DEFAULT_COEFFICIENTS: Record<PerfGrade, number> = {
  A: 1,
  B: 1,
  C: 1,
  D: 1,
};

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

@Injectable()
export class CalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /cycles/:id/calibration — 校准工作台。 */
  async getWorkbench(cycleId: string, _viewer: AuthUser): Promise<CalibrationWorkbench> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const tasks = await this.findActiveTasksWithResult(cycleId);

    return {
      gradeDistribution: buildGradeDistribution(tasks, cycle),
      totalActive: tasks.length,
      pendingCalibration: tasks.filter(
        (t) => t.status === 'hr_calibration' && t.gradeResult?.calibratedGrade == null,
      ).length,
      items: tasks.map((t) => this.mapToWorkbenchItem(t)),
    };
  }

  /** GET /cycles/:id/grade-distribution — 仅返回分布。 */
  async getGradeDistribution(cycleId: string): Promise<{ total: number; distribution: Record<PerfGrade, GradeDistributionEntry> } & Record<PerfGrade, GradeDistributionEntry>> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const tasks = await this.findActiveTasksWithResult(cycleId);
    const distribution = buildGradeDistribution(tasks, cycle);
    return {
      total: tasks.length,
      distribution,
      ...distribution,
    };
  }

  /** POST /cycles/:id/calibration — 批量提交校准。 */
  async calibrateGrades(
    cycleId: string,
    dto: CalibrateGradesDto,
    viewer: AuthUser,
  ): Promise<CalibrateGradesResult> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const coefficients = await this.loadGradeCoefficients();

    const taskIds = dto.calibrations.map((c) => c.taskId);
    const tasks = await this.findActiveTasksByIds(cycleId, taskIds);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const warnings: string[] = [];
    let transitioned = 0;
    let transitionedTaskIds: string[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        const claimedVersions = new Map<string, Date>();
        for (const item of dto.calibrations) {
          const task = taskMap.get(item.taskId);
          if (!task) {
            throw new BadRequestException({
              code: ERROR_CODE.PARAM_INVALID,
              message: `任务 ${item.taskId} 不存在或非本周期非豁免任务`,
            });
          }

          const veto = normalizeVeto(item);
          const coefficient = coefficients[veto.grade];
          if (!claimedVersions.has(task.id)) {
            claimedVersions.set(
              task.id,
              await claimTaskVersion(tx, task.id, task.updatedAt.toISOString(), 'hr_calibration'),
            );
          }

          await tx.gradeResult.upsert({
            where: { taskId: task.id },
            create: {
              taskId: task.id,
              calculatedScore: task.gradeResult?.calculatedScore ?? null,
              rawGrade: task.gradeResult?.rawGrade ?? null,
              calibratedGrade: veto.grade,
              calibrationNote: item.calibrationNote ?? null,
              isVeto: veto.isVeto,
              vetoReason: veto.vetoReason ?? null,
              vetoOperatorId: veto.isVeto ? viewer.id : null,
              coefficient: new Prisma.Decimal(coefficient),
              hrCalibratorId: viewer.id,
              hrCalibratedAt: new Date(),
            },
            update: {
              calibratedGrade: veto.grade,
              calibrationNote: item.calibrationNote ?? null,
              isVeto: veto.isVeto,
              vetoReason: veto.vetoReason ?? null,
              vetoOperatorId: veto.isVeto ? viewer.id : null,
              coefficient: new Prisma.Decimal(coefficient),
              hrCalibratorId: viewer.id,
              hrCalibratedAt: new Date(),
            },
          });
        }

        if (dto.submit) {
          const hrCalibrationTasks = await tx.assessmentTask.findMany({
            where: { cycleId, status: 'hr_calibration', isExempt: false },
            include: { gradeResult: { select: { calibratedGrade: true } } },
          });

          const missing = hrCalibrationTasks.filter((t) => t.gradeResult?.calibratedGrade == null);
          if (missing.length > 0) {
            throw new BadRequestException({
              code: ERROR_CODE.PARAM_INVALID,
              message: `存在未填写校准等级的任务：${missing.map((t) => t.id).join(', ')}`,
            });
          }

          for (const task of hrCalibrationTasks) {
            let claimedUpdatedAt = claimedVersions.get(task.id);
            if (!claimedUpdatedAt) {
              claimedUpdatedAt = await claimTaskVersion(
                tx,
                task.id,
                task.updatedAt.toISOString(),
                'hr_calibration',
              );
            }
            await this.flowService.transitionTx(tx, {
              task,
              action: 'submit',
              targetStatus: 'approval',
              actorId: viewer.id,
              comment: 'HR 校准完成，提交审批',
              taskUpdate: { hrCalibratedAt: new Date(), updatedAt: claimedUpdatedAt },
            });
          }

          transitioned = hrCalibrationTasks.length;
          transitionedTaskIds = hrCalibrationTasks.map((t) => t.id);
        }
      },
      { timeout: 60000, maxWait: 10000 },
    );

    if (dto.submit && transitionedTaskIds.length > 0) {
      const transitionedTasks = await this.prisma.assessmentTask.findMany({
        where: { id: { in: transitionedTaskIds } },
        select: { id: true, approverId: true, employee: { select: { name: true } } },
      });

      const byApprover = groupBy(transitionedTasks, (t) => t.approverId ?? '__none__');
      for (const [approverId, approverTasks] of byApprover) {
        if (approverId === '__none__' || !approverId) continue;
        const names = approverTasks.map((t) => t.employee?.name ?? '员工').join('、');
        await this.notificationsService.create({
          userId: approverId,
          senderId: viewer.id,
          cycleId,
          type: 'calibration_submitted',
          title: 'HR 校准结果待审批',
          content: `HR 已完成 ${cycle.name} 的等级校准，涉及员工：${names}，请审批。`,
        }).catch(() => {
          // 推送失败不阻断业务
        });
      }
    }

    const refreshedTasks = await this.findActiveTasksWithResult(cycleId);
    const distribution = buildGradeDistribution(refreshedTasks, cycle);
    for (const grade of GRADES) {
      if (distribution[grade].isOverLimit) {
        warnings.push(`${grade} 等级比例 ${(distribution[grade].ratio * 100).toFixed(1)}% 超过上限 ${(distribution[grade].maxRatio * 100).toFixed(1)}%`);
      }
    }

    return {
      submit: dto.submit,
      updated: dto.calibrations.length,
      transitioned,
      gradeDistribution: distribution,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async getCycleOrThrow(cycleId: string): Promise<AssessmentCycle> {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    return cycle;
  }

  private async findActiveTasksWithResult(cycleId: string) {
    return this.prisma.assessmentTask.findMany({
      where: { cycleId, isExempt: false },
      include: {
        employee: { select: { name: true, position: true } },
        dept: { select: { name: true } },
        manager: { select: { name: true } },
        gradeResult: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findActiveTasksByIds(cycleId: string, taskIds: string[]) {
    return this.prisma.assessmentTask.findMany({
      where: { cycleId, isExempt: false, id: { in: taskIds } },
      include: { gradeResult: { select: { calculatedScore: true, rawGrade: true } } },
    });
  }

  /** 加载等级系数配置。 */
  async loadGradeCoefficients(): Promise<Record<PerfGrade, number>> {
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'grade_coefficients' } });
    const value = config?.value as Record<string, number> | undefined;
    return {
      A: value?.A ?? DEFAULT_COEFFICIENTS.A,
      B: value?.B ?? DEFAULT_COEFFICIENTS.B,
      C: value?.C ?? DEFAULT_COEFFICIENTS.C,
      D: value?.D ?? DEFAULT_COEFFICIENTS.D,
    };
  }

  private mapToWorkbenchItem(task: Awaited<ReturnType<CalibrationService['findActiveTasksWithResult']>>[number]): CalibrationWorkbenchItem {
    return {
      taskId: task.id,
      employeeName: task.employee?.name ?? '',
      deptName: task.dept?.name ?? null,
      position: task.employee?.position ?? null,
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      calibratedGrade: task.gradeResult?.calibratedGrade ?? null,
      isVeto: task.gradeResult?.isVeto ?? false,
      managerName: task.manager?.name ?? null,
    };
  }
}

/** 校验并规范化一票否决输入。 */
export function normalizeVeto(item: CalibrationItemDto): {
  isVeto: boolean;
  grade: PerfGrade;
  vetoReason?: string;
} {
  const isVeto = item.isVeto === true;

  if (isVeto && item.calibratedGrade !== 'D') {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '一票否决时校准等级必须为 D',
    });
  }

  if (isVeto && (!item.vetoReason || item.vetoReason.trim() === '')) {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '一票否决时必须填写否决原因',
    });
  }

  return {
    isVeto,
    grade: isVeto ? 'D' : item.calibratedGrade,
    vetoReason: item.vetoReason,
  };
}

/** 构建等级分布。 */
export function buildGradeDistribution(
  tasks: Array<{ gradeResult?: { calibratedGrade: PerfGrade | null; rawGrade: PerfGrade | null } | null }>,
  cycle: Pick<AssessmentCycle, 'gradeAMaxRatio' | 'gradeBMaxRatio' | 'gradeCMaxRatio' | 'gradeDMaxRatio'>,
): Record<PerfGrade, GradeDistributionEntry> {
  const total = tasks.length;
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const task of tasks) {
    const effectiveGrade = task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade ?? null;
    if (effectiveGrade && GRADES.includes(effectiveGrade)) {
      counts[effectiveGrade]++;
    }
  }

  const maxRatios: Record<PerfGrade, number> = {
    A: cycle.gradeAMaxRatio.toNumber(),
    B: cycle.gradeBMaxRatio.toNumber(),
    C: cycle.gradeCMaxRatio.toNumber(),
    D: cycle.gradeDMaxRatio.toNumber(),
  };

  const result = {} as Record<PerfGrade, GradeDistributionEntry>;
  for (const grade of GRADES) {
    const ratio = total === 0 ? 0 : counts[grade] / total;
    const maxRatio = maxRatios[grade];
    result[grade] = {
      count: counts[grade],
      ratio,
      maxRatio,
      isOverLimit: ratio > maxRatio,
    };
  }

  return result;
}

function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}
