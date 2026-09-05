import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfGrade, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { FlowService } from '@/tasks/flow.service';
import { claimTaskVersion } from '@/tasks/task-version';
import { SubmitFinalGradeDto } from './dto/submit-final-grade.dto';

/** 月度结果摘要。 */
export interface FinalGradePeriodItem {
  periodKey: string;
  periodType: string;
  status: string;
  selfGrade: PerfGrade | null;
  managerGrade: PerfGrade | null;
  selfScoreTotal: number | null;
  managerScoreTotal: number | null;
}

/** 最近一次被退回的信息。 */
export interface FinalGradeRejectInfo {
  nodeType: string;
  comment: string | null;
  createdAt: Date;
  actorName: string | null;
}

/** GET /tasks/:id/final-grade 响应。 */
export interface FinalGradeDetail {
  taskId: string;
  cycleId: string;
  cycleName: string;
  employeeName: string;
  deptName: string | null;
  position: string | null;
  status: TaskStatus;
  managerName: string | null;
  periods: FinalGradePeriodItem[];
  /** 整周期参考总分（各月上级评分均分，分数与等级无换算关系）。 */
  calculatedScore: number | null;
  /** 已录入的整周期最终等级（未录入为 null）。 */
  currentGrade: PerfGrade | null;
  /** 全部月度是否已完成且锁定。 */
  allPeriodsComplete: boolean;
  /** 当前是否可提交/修改最终等级。 */
  canSubmit: boolean;
  latestReject: FinalGradeRejectInfo | null;
}

/**
 * 整周期结果评定。
 *
 * 直属上级在各月评分全部锁定后，参考系统自动均分与各月等级，
 * 独立录入整周期最终等级 A/B/C/D。录入后任务进入部门复核
 * （直属上级即部门负责人时直接进入绩效校准）。
 */
@Injectable()
export class FinalGradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /tasks/:id/final-grade — 评定页数据。 */
  async getFinalGrade(taskId: string, viewer: AuthUser): Promise<FinalGradeDetail> {
    const task = await this.getTaskOrThrow(taskId);
    this.assertManager(task, viewer);

    const latestReject = await this.prisma.flowRecord.findFirst({
      where: {
        taskId,
        action: 'reject',
        nodeType: { in: ['dept_review', 'hr_calibration'] },
      },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { name: true } } },
    });

    const periods: FinalGradePeriodItem[] = task.periods.map((p) => ({
      periodKey: p.periodKey,
      periodType: p.periodType,
      status: p.status,
      selfGrade: p.selfGrade,
      managerGrade: p.managerGrade,
      selfScoreTotal: p.selfScoreTotal?.toNumber() ?? null,
      managerScoreTotal: p.managerScoreTotal?.toNumber() ?? null,
    }));

    const allPeriodsComplete = task.periods.length > 0
      && task.periods.every((p) => (
        p.status === 'completed'
        && p.employeeSubmittedAt != null
        && p.managerSubmittedAt != null
        && p.managerScoreTotal != null
        && p.lockedAt != null
      ));

    return {
      taskId: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle.name,
      employeeName: task.employee?.name ?? '',
      deptName: task.dept?.name ?? null,
      position: task.employee?.position ?? null,
      status: task.status,
      managerName: task.manager?.name ?? null,
      periods,
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      currentGrade: task.gradeResult?.rawGrade ?? null,
      allPeriodsComplete,
      canSubmit: allPeriodsComplete && task.status === TaskStatus.manager_scoring,
      latestReject: latestReject
        ? {
            nodeType: latestReject.nodeType,
            comment: latestReject.comment,
            createdAt: latestReject.createdAt,
            actorName: latestReject.actor?.name ?? null,
          }
        : null,
    };
  }

  /** POST /tasks/:id/final-grade — 提交整周期最终等级。 */
  async submitFinalGrade(
    taskId: string,
    dto: SubmitFinalGradeDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus; grade: PerfGrade }> {
    const task = await this.getTaskOrThrow(taskId);
    this.assertManager(task, viewer);

    if (task.status !== TaskStatus.manager_scoring) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不允许提交整周期结果评定',
      });
    }

    const completePeriods = task.periods.filter((p) => (
      p.status === 'completed'
      && p.employeeSubmittedAt != null
      && p.managerSubmittedAt != null
      && p.managerScoreTotal != null
      && p.lockedAt != null
    ));
    if (task.periods.length === 0 || completePeriods.length !== task.periods.length) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '全部月度评分完成后才能提交整周期结果评定',
      });
    }

    const total = completePeriods.reduce((sum, p) => sum + p.managerScoreTotal!.toNumber(), 0);
    const score = Number((total / completePeriods.length).toFixed(2));
    const targetStatus = task.managerId === task.deptHeadId
      ? TaskStatus.hr_calibration
      : TaskStatus.dept_review;

    await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(
        tx,
        task.id,
        task.updatedAt.toISOString(),
        TaskStatus.manager_scoring,
      );

      await tx.gradeResult.upsert({
        where: { taskId: task.id },
        create: {
          taskId: task.id,
          calculatedScore: score,
          rawGrade: dto.grade,
        },
        update: {
          calculatedScore: score,
          rawGrade: dto.grade,
        },
      });

      await this.flowService.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId: viewer.id,
        comment: `整周期结果评定：最终等级 ${dto.grade}（参考均分 ${score}）`,
        extraData: { type: 'final_grade_submitted', grade: dto.grade, calculatedScore: score },
        taskUpdate: { managerScoredAt: new Date(), updatedAt: claimedUpdatedAt },
      });
    });

    // 通知下一环节处理人
    const notifyUserId = targetStatus === TaskStatus.dept_review ? task.deptHeadId : null;
    try {
      if (notifyUserId) {
        await this.notificationsService.create({
          userId: notifyUserId,
          senderId: viewer.id,
          cycleId: task.cycleId,
          taskId: task.id,
          type: 'manager_score_submitted',
          title: '整周期结果待复核',
          content: `直属上级已完成 ${task.employee?.name ?? '员工'} 的整周期结果评定，请进行部门复核。`,
        });
      } else {
        const cycle = await this.prisma.assessmentCycle.findUnique({
          where: { id: task.cycleId },
          select: { hrOwnerId: true },
        });
        if (cycle?.hrOwnerId) {
          await this.notificationsService.create({
            userId: cycle.hrOwnerId,
            senderId: viewer.id,
            cycleId: task.cycleId,
            taskId: task.id,
            type: 'hr_calibration_notice',
            title: '整周期结果待绩效校准',
            content: `直属上级已完成 ${task.employee?.name ?? '员工'} 的整周期结果评定，请进行绩效校准。`,
          });
        }
      }
    } catch {
      // 通知失败不阻断业务
    }

    return { id: task.id, status: targetStatus, grade: dto.grade };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async getTaskOrThrow(taskId: string) {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskId },
      include: {
        employee: { select: { name: true, position: true } },
        dept: { select: { name: true } },
        manager: { select: { name: true } },
        gradeResult: { select: { calculatedScore: true, rawGrade: true } },
        cycle: { select: { name: true } },
        periods: {
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '绩效任务不存在' });
    }
    return task;
  }

  private assertManager(
    task: { managerId: string | null },
    viewer: AuthUser,
  ): void {
    if (viewer.sysRole !== 'system_admin' && task.managerId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅直属上级可操作',
      });
    }
  }
}
