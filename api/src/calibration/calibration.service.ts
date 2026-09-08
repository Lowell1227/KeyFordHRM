import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentCycle, PerfGrade, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { FlowService } from '@/tasks/flow.service';
import { ConfirmCalibrationDto } from './dto/confirm-calibration.dto';
import { RejectCalibrationDto } from './dto/reject-calibration.dto';
import { claimTaskVersion } from '@/tasks/task-version';
import { hasHrCapability } from '@/auth/hr-capabilities';

/** 等级分布单项。 */
export interface GradeDistributionEntry {
  count: number;
  ratio: number;
  maxRatio: number;
  isOverLimit: boolean;
}

/** 校准工作台列表项。 */
export interface CalibrationWorkbenchItem {
  canCalibrate: boolean;
  canViewDetail: boolean;
  actionHint: string | null;
  taskId: string;
  employeeName: string;
  deptName: string | null;
  position: string | null;
  status: TaskStatus;
  calculatedScore: number | null;
  rawGrade: PerfGrade | null;
  /** 直属上级提交整周期结果评定的时间。 */
  finalGradeSubmittedAt: Date | null;
  managerName: string | null;
}

/** 校准工作台阶段进度。 */
export interface CalibrationProgress {
  /** 评定中：月度评分/整周期结果评定未完成。 */
  finalGrading: number;
  /** 待部门复核。 */
  deptReview: number;
  /** 待 HR 校准。 */
  pending: number;
  /** 审批中。 */
  inApproval: number;
  /** 已定级完成（公示及之后）。 */
  done: number;
}

/** 校准工作台响应。 */
export interface CalibrationWorkbench {
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  totalActive: number;
  progress: CalibrationProgress;
  items: CalibrationWorkbenchItem[];
}

/** 确认/驳回响应。 */
export interface CalibrationActionResult {
  updated: number;
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
}

/** 校准详情（个人抽屉）。 */
export interface CalibrationCandidateDetail {
  taskId: string;
  employeeName: string;
  deptName: string | null;
  position: string | null;
  managerName: string | null;
  status: TaskStatus;
  calculatedScore: number | null;
  finalGrade: PerfGrade | null;
  periods: Array<{
    periodKey: string;
    status: string;
    selfGrade: PerfGrade | null;
    managerGrade: PerfGrade | null;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
  }>;
  /** 各指标跨月汇总（权重 + 平均分，分数与等级无换算关系）。 */
  indicators: Array<{
    name: string;
    weight: number;
    type: string;
    avgSelfScore: number | null;
    avgManagerScore: number | null;
  }>;
  /** 复核/校准退回历史（新→旧）。 */
  rejectHistory: Array<{
    nodeType: string;
    comment: string | null;
    createdAt: Date;
    actorName: string | null;
  }>;
}

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

@Injectable()
export class CalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** A cycle assignment grants access to that cycle only; creation alone grants nothing. */
  async listCycles(viewer: AuthUser) {
    return this.prisma.assessmentCycle.findMany({
      where: {
        status: { in: ['indicator_setting', 'self_eval', 'manager_score', 'hr_calibration', 'approval', 'published', 'appeal'] },
        ...(!hasHrCapability(viewer, 'performance_calibration') ? { hrOwnerId: viewer.id } : {}),
      },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    });
  }

  /** GET /cycles/:id/calibration — 校准工作台。 */
  async getWorkbench(cycleId: string, viewer: AuthUser): Promise<CalibrationWorkbench> {
    const cycle = await this.getCycleOrThrow(cycleId, viewer);
    const tasks = await this.findActiveTasksWithResult(cycleId);

    return {
      gradeDistribution: buildGradeDistribution(tasks.filter(t => t.employeeId !== viewer.id), cycle),
      totalActive: tasks.length,
      progress: buildProgress(tasks),
      items: tasks.map((t) => this.mapToWorkbenchItem(t, viewer)),
    };
  }

  /** GET /cycles/:id/grade-distribution — 仅返回分布。 */
  async getGradeDistribution(cycleId: string, viewer: AuthUser): Promise<{ total: number; distribution: Record<PerfGrade, GradeDistributionEntry> } & Record<PerfGrade, GradeDistributionEntry>> {
    const cycle = await this.getCycleOrThrow(cycleId, viewer);
    const tasks = (await this.findActiveTasksWithResult(cycleId)).filter(t => t.employeeId !== viewer.id);
    const distribution = buildGradeDistribution(tasks, cycle);
    return {
      total: tasks.length,
      distribution,
      ...distribution,
    };
  }

  /** GET /cycles/:id/calibration/tasks/:taskId — 个人详情（校准依据）。 */
  async getCandidateDetail(cycleId: string, taskId: string, viewer: AuthUser): Promise<CalibrationCandidateDetail> {
    await this.getCycleOrThrow(cycleId, viewer);
    const task = await this.prisma.assessmentTask.findFirst({
      where: { id: taskId, cycleId, isExempt: false },
      include: {
        employee: { select: { name: true, position: true } },
        dept: { select: { name: true } },
        manager: { select: { name: true } },
        gradeResult: { select: { calculatedScore: true, rawGrade: true } },
        periods: {
          orderBy: { sequence: 'asc' },
          select: {
            periodKey: true,
            status: true,
            selfGrade: true,
            managerGrade: true,
            selfScoreTotal: true,
            managerScoreTotal: true,
          },
        },
        indicatorInstances: {
          select: { name: true, weight: true, indicatorType: true },
          orderBy: { sortOrder: 'asc' },
        },
        flowRecords: {
          where: { action: 'reject', nodeType: { in: ['dept_review', 'hr_calibration'] } },
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { name: true } } },
        },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '任务不存在' });
    }
    this.assertNotSelf([task], viewer);

    // 指标跨月平均分：按指标名称对齐（快照/实例名称一致）
    const reviews = await this.prisma.assessmentPeriodIndicatorReview.findMany({
      where: { period: { taskId } },
      include: {
        period: { select: { periodKey: true } },
        indicatorVersionItem: { select: { name: true } },
      },
    });
    const scoreMap = new Map<string, { self: number[]; manager: number[] }>();
    for (const r of reviews) {
      const name = r.indicatorVersionItem?.name;
      if (!name) continue;
      const entry = scoreMap.get(name) ?? { self: [], manager: [] };
      if (r.selfScore != null) entry.self.push(Number(r.selfScore));
      if (r.managerScore != null) entry.manager.push(Number(r.managerScore));
      scoreMap.set(name, entry);
    }
    const avg = (list: number[]) => (list.length ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(2)) : null);

    const indicatorDefs = task.indicatorInstances;

    return {
      taskId: task.id,
      employeeName: task.employee?.name ?? '',
      deptName: task.dept?.name ?? null,
      position: task.employee?.position ?? null,
      managerName: task.manager?.name ?? null,
      status: task.status,
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      finalGrade: task.gradeResult?.rawGrade ?? null,
      periods: task.periods.map((p) => ({
        periodKey: p.periodKey,
        status: p.status,
        selfGrade: p.selfGrade,
        managerGrade: p.managerGrade,
        selfScoreTotal: p.selfScoreTotal?.toNumber() ?? null,
        managerScoreTotal: p.managerScoreTotal?.toNumber() ?? null,
      })),
      indicators: indicatorDefs.map((def) => ({
        name: def.name,
        weight: def.weight.toNumber(),
        type: def.indicatorType,
        avgSelfScore: avg(scoreMap.get(def.name)?.self ?? []),
        avgManagerScore: avg(scoreMap.get(def.name)?.manager ?? []),
      })),
      rejectHistory: task.flowRecords.map((r) => ({
        nodeType: r.nodeType,
        comment: r.comment,
        createdAt: r.createdAt,
        actorName: r.actor?.name ?? null,
      })),
    };
  }

  /**
   * POST /cycles/:id/calibration/confirm — HR 确认（逐人即时流转到审批）。
   *
   * HR 在校准环节不修改任何绩效结果，确认即表示审核通过，
   * 任务立即进入结果审批并通知审批人。
   */
  async confirm(
    cycleId: string,
    dto: ConfirmCalibrationDto,
    viewer: AuthUser,
  ): Promise<CalibrationActionResult> {
    const cycle = await this.getCycleOrThrow(cycleId, viewer);
    const tasks = await this.findActiveTasksByIds(cycleId, dto.taskIds);
    if (tasks.length !== dto.taskIds.length) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '存在非本周期或非待校准状态的任务',
      });
    }
    this.assertNotSelf(tasks, viewer);

      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        // Lock the whole batch before flow synchronization locks the cycle row.
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "assessment_tasks"
          WHERE "id" IN (${Prisma.join(tasks.map((task) => Prisma.sql`${task.id}::uuid`))})
          ORDER BY "id" FOR NO KEY UPDATE
        `);
        await this.recheckOwnerTx(tx, cycleId, viewer);
        for (const task of tasks) {
        if (task.status !== TaskStatus.hr_calibration) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: `任务 ${task.employee?.name ?? task.id} 当前状态不允许确认`,
          });
        }
        const claimedUpdatedAt = await claimTaskVersion(
          tx,
          task.id,
          task.updatedAt.toISOString(),
          TaskStatus.hr_calibration,
        );
        await tx.gradeResult.updateMany({
          where: { taskId: task.id },
          data: { hrCalibratorId: viewer.id, hrCalibratedAt: now },
        });
        await this.flowService.transitionTx(tx, {
          task,
          action: 'submit',
          targetStatus: 'approval',
          actorId: viewer.id,
          comment: '绩效校准确认，提交结果审批',
          taskUpdate: { hrCalibratedAt: now, updatedAt: claimedUpdatedAt },
        });
      }
    });

    // 通知审批人（按审批人分组，一条通知覆盖多名员工）
    const notified = new Set<string>();
    for (const task of tasks) {
      const approverId = task.approverId;
      if (!approverId || notified.has(approverId)) continue;
      notified.add(approverId);
      const names = tasks
        .filter((t) => t.approverId === approverId)
        .map((t) => t.employee?.name ?? '员工')
        .join('、');
      await this.notificationsService.create({
        userId: approverId,
        senderId: viewer.id,
        cycleId,
        type: 'calibration_confirmed',
        title: '绩效结果待审批',
        content: `HR 已完成 ${cycle.name} 的绩效校准确认，涉及员工：${names}，请审批。`,
      }).catch(() => {
        // 推送失败不阻断业务
      });
    }

    const refreshed = await this.findActiveTasksWithResult(cycleId);
    return {
      updated: tasks.length,
      gradeDistribution: buildGradeDistribution(refreshed.filter(t => t.employeeId !== viewer.id), cycle),
    };
  }

  /**
   * POST /cycles/:id/calibration/reject — HR 驳回（退回直属上级重新评定）。
   */
  async reject(
    cycleId: string,
    dto: RejectCalibrationDto,
    viewer: AuthUser,
  ): Promise<CalibrationActionResult> {
    const cycle = await this.getCycleOrThrow(cycleId, viewer);
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '驳回原因不能为空',
      });
    }
    const tasks = await this.findActiveTasksByIds(cycleId, dto.taskIds);
    if (tasks.length !== dto.taskIds.length) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '存在非本周期或非待校准状态的任务',
      });
    }
    this.assertNotSelf(tasks, viewer);

      await this.prisma.$transaction(async (tx) => {
        // Use the same task-before-cycle lock order as individual task transitions.
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "assessment_tasks"
          WHERE "id" IN (${Prisma.join(tasks.map((task) => Prisma.sql`${task.id}::uuid`))})
          ORDER BY "id" FOR NO KEY UPDATE
        `);
        await this.recheckOwnerTx(tx, cycleId, viewer);
        for (const task of tasks) {
        if (task.status !== TaskStatus.hr_calibration) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: `任务 ${task.employee?.name ?? task.id} 当前状态不允许驳回`,
          });
        }
        const claimedUpdatedAt = await claimTaskVersion(
          tx,
          task.id,
          task.updatedAt.toISOString(),
          TaskStatus.hr_calibration,
        );
        await this.flowService.transitionTx(tx, {
          task,
          action: 'reject',
          targetStatus: 'manager_scoring',
          actorId: viewer.id,
          comment: reason,
          extraData: { type: 'calibration_rejected' },
          taskUpdate: { approvedAt: null, updatedAt: claimedUpdatedAt },
        });
      }
    });

    for (const task of tasks) {
      if (!task.managerId) continue;
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId,
        taskId: task.id,
        type: 'calibration_rejected',
        title: '整周期结果评定被驳回',
        content: `${cycle.name}：${task.employee?.name ?? '员工'} 的整周期结果评定被 HR 驳回：${reason}。请修改月度结果或最终等级后重新提交。`,
      }).catch(() => {
        // 推送失败不阻断业务
      });
    }

    const refreshed = await this.findActiveTasksWithResult(cycleId);
    return {
      updated: tasks.length,
      gradeDistribution: buildGradeDistribution(refreshed.filter(t => t.employeeId !== viewer.id), cycle),
    };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /** 加载等级系数配置（供申诉/更正等模块复用）。 */
  async loadGradeCoefficients(): Promise<Record<PerfGrade, number>> {
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'grade_coefficients' } });
    const value = config?.value as Record<string, number> | undefined;
    return {
      A: value?.A ?? 1,
      B: value?.B ?? 1,
      C: value?.C ?? 1,
      D: value?.D ?? 1,
    };
  }

  private assertCycleAccess(cycle: Pick<AssessmentCycle, 'hrOwnerId'>, viewer: AuthUser) {
    if (!hasHrCapability(viewer, 'performance_calibration') && cycle.hrOwnerId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权处理该周期的绩效校准' });
    }
  }

  private assertNotSelf(tasks: Array<{ employeeId: string }>, viewer: AuthUser) {
    if (tasks.some(task => task.employeeId === viewer.id)) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '本人结果由其他有权限的 HR 处理' });
    }
  }

  private async recheckOwnerTx(tx: Prisma.TransactionClient, cycleId: string, viewer: AuthUser) {
    if (hasHrCapability(viewer, 'performance_calibration')) return;
    // Match FlowService's task-before-cycle lock order and hold the assignment until commit.
    await tx.$queryRaw`SELECT "id" FROM "assessment_cycles" WHERE "id" = ${cycleId}::uuid FOR UPDATE`;
    const cycle = await tx.assessmentCycle.findUnique({ where: { id: cycleId }, select: { hrOwnerId: true } });
    if (!cycle) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    this.assertCycleAccess(cycle, viewer);
  }

  private async getCycleOrThrow(cycleId: string, viewer: AuthUser): Promise<AssessmentCycle> {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    this.assertCycleAccess(cycle, viewer);
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
      include: {
        employee: { select: { name: true } },
        gradeResult: { select: { calculatedScore: true, rawGrade: true } },
      },
    });
  }

  private mapToWorkbenchItem(task: Awaited<ReturnType<CalibrationService['findActiveTasksWithResult']>>[number], viewer: AuthUser): CalibrationWorkbenchItem {
    const ownResult = task.employeeId === viewer.id;
    return {
      canCalibrate: !ownResult && task.status === 'hr_calibration',
      canViewDetail: !ownResult,
      actionHint: ownResult ? '本人结果由其他有权限的 HR 处理' : null,
      taskId: task.id,
      employeeName: task.employee?.name ?? '',
      deptName: task.dept?.name ?? null,
      position: task.employee?.position ?? null,
      status: task.status,
      calculatedScore: ownResult ? null : task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: ownResult ? null : task.gradeResult?.rawGrade ?? null,
      finalGradeSubmittedAt: task.managerScoredAt ?? null,
      managerName: task.manager?.name ?? null,
    };
  }
}

/** 构建等级分布。 */
export function buildGradeDistribution(
  tasks: Array<{ status: TaskStatus; gradeResult?: { calibratedGrade: PerfGrade | null; rawGrade: PerfGrade | null } | null }>,
  cycle: Pick<AssessmentCycle, 'gradeAMaxRatio' | 'gradeBMaxRatio' | 'gradeCMaxRatio' | 'gradeDMaxRatio'>,
): Record<PerfGrade, GradeDistributionEntry> {
  // 分母：已进入评定链路的任务（部门复核/校准/审批/公示及之后），评定中的不计入
  const counted = tasks.filter((t) => (
    t.status === 'dept_review'
    || t.status === 'hr_calibration'
    || t.status === 'approval'
    || t.status === 'published'
    || t.status === 'confirmed'
    || t.status === 'appealing'
    || t.status === 'closed'
  ));
  const total = counted.length;
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const task of counted) {
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

/** 构建阶段进度。 */
export function buildProgress(
  tasks: Array<{ status: TaskStatus }>,
): CalibrationProgress {
  const progress: CalibrationProgress = {
    finalGrading: 0,
    deptReview: 0,
    pending: 0,
    inApproval: 0,
    done: 0,
  };
  for (const task of tasks) {
    if (task.status === 'hr_calibration') progress.pending++;
    else if (task.status === 'dept_review') progress.deptReview++;
    else if (task.status === 'approval') progress.inApproval++;
    else if (
      task.status === 'published'
      || task.status === 'confirmed'
      || task.status === 'appealing'
      || task.status === 'closed'
    ) progress.done++;
    else progress.finalGrading++;
  }
  return progress;
}
