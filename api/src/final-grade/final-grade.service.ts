import { buildResultEvidence, RESULT_PERIOD_SELECT, ResultEvidence } from '@/tasks/result-evidence';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfGrade, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { FlowService } from '@/tasks/flow.service';
import { resolveCalibrationRecipient } from '@/calibration/calibration-recipient';
import { claimTaskVersion } from '@/tasks/task-version';
import { isManagerPeriodComplete } from '@/tasks/team-task-stage';
import { SubmitFinalGradeDto } from './dto/submit-final-grade.dto';
import { mapReviewHistory, REVIEW_HISTORY_NODES } from '@/tasks/review-history';

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
  resultEvidence?: ResultEvidence;
  flowRecords: ReturnType<typeof mapReviewHistory>;
  taskId: string;
  cycleId: string;
  cycleName: string;
  employeeName: string;
  deptName: string | null;
  position: string | null;
  status: TaskStatus;
  approvedAt: Date | null;
  publishedAt: Date | null;
  managerName: string | null;
  /** 依据任务冻结关系确定本次是否合并部门复核。 */
  departmentReview: { combined: boolean; reviewerName: string | null };
  periods: FinalGradePeriodItem[];
  /** 整周期参考总分（各月上级评分均分，分数与等级无换算关系）。 */
  calculatedScore: number | null;
  /** 已录入的整周期最终等级（未录入为 null）。 */
  currentGrade: PerfGrade | null;
  /** 最近一次周期评定的评语，随评定流程记录持久化。 */
  comment: string | null;
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
 * （直属上级即部门负责人时合并办理部门复核，再进入绩效校准）。
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
    // 复核人可读取评定依据，写入仍仅允许绩效直属上级/系统管理员。
    if (task.deptHeadId !== viewer.id || task.employeeId === viewer.id) this.assertManager(task, viewer);

    const latestReject = await this.prisma.flowRecord.findFirst({
      where: {
        taskId,
        action: 'reject',
        nodeType: { in: ['dept_review', 'hr_calibration', 'appeal'] },
      },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { name: true } } },
    });

    const latestSubmission = await this.prisma.flowRecord.findFirst({
      where: { taskId, action: 'submit', nodeType: 'manager_score', extraData: { path: ['type'], equals: 'final_grade_submitted' } },
      orderBy: { createdAt: 'desc' },
      select: { extraData: true },
    });
    const submissionData = latestSubmission?.extraData as Prisma.JsonObject | null | undefined;

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
      && task.periods.every(isManagerPeriodComplete);

    return {
      resultEvidence: buildResultEvidence(task.periods),
      flowRecords: mapReviewHistory(task.flowRecords),
      taskId: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle.name,
      employeeName: task.employee?.name ?? '',
      deptName: task.dept?.name ?? null,
      position: task.employee?.position ?? null,
      status: task.status,
      approvedAt: task.approvedAt,
      publishedAt: task.publishedAt ?? null,
      managerName: task.manager?.name ?? null,
      departmentReview: {
        combined: this.isCombinedDepartmentReview(task),
        reviewerName: task.deptHead?.name ?? null,
      },
      periods,
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      currentGrade: task.gradeResult?.rawGrade ?? null,
      comment: typeof submissionData?.comment === 'string' ? submissionData.comment : null,
      allPeriodsComplete,
      canSubmit: allPeriodsComplete && task.status === TaskStatus.manager_scoring
        && (task.managerId === viewer.id || viewer.sysRole === 'system_admin'),
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

    const completePeriods = task.periods.filter(isManagerPeriodComplete);
    if (task.periods.length === 0 || completePeriods.length !== task.periods.length) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '全部月度评分完成后才能提交整周期结果评定',
      });
    }

    const total = completePeriods.reduce((sum, p) => sum + p.managerScoreTotal!.toNumber(), 0);
    const comment = dto.comment?.trim() || null;
    const score = Number((total / completePeriods.length).toFixed(2));
    const combinedDepartmentReview = this.isCombinedDepartmentReview(task);
    const targetStatus = combinedDepartmentReview
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
        targetStatus: TaskStatus.dept_review,
        actorId: viewer.id,
        comment: `整周期结果评定：最终等级 ${dto.grade}（参考均分 ${score}）`,
        extraData: { type: 'final_grade_submitted', grade: dto.grade, calculatedScore: score, comment },
        taskUpdate: { managerScoredAt: new Date(), updatedAt: claimedUpdatedAt },
      });

      if (combinedDepartmentReview) {
        await this.flowService.transitionTx(tx, {
          task: { ...task, status: TaskStatus.dept_review },
          action: 'approve',
          targetStatus: TaskStatus.hr_calibration,
          actorId: viewer.id,
          comment: '绩效直属上级与部门负责人为同一人，本次提交合并完成部门复核。',
          extraData: {
            type: 'combined_department_review',
            managerId: task.managerId,
            deptHeadId: task.deptHeadId,
          },
          taskUpdate: { deptReviewedAt: new Date(), updatedAt: claimedUpdatedAt },
        });
      }
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
      } else if (targetStatus === TaskStatus.hr_calibration) {
        const cycle = await this.prisma.assessmentCycle.findUnique({
          where: { id: task.cycleId },
          select: { hrOwnerId: true },
        });
        const userId = await resolveCalibrationRecipient(this.prisma, task, cycle?.hrOwnerId ?? null);
        if (userId) {
          await this.notificationsService.create({
            userId,
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
        deptHead: { select: { name: true } },
        flowRecords: {
          where: { nodeType: { in: REVIEW_HISTORY_NODES } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { actor: { select: { name: true } } },
        },
        gradeResult: { select: { calculatedScore: true, rawGrade: true } },
        cycle: { select: { name: true } },
        periods: {
          include: { indicatorReviews: RESULT_PERIOD_SELECT.indicatorReviews },
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
    task: { managerId: string | null; employeeId: string },
    viewer: AuthUser,
  ): void {
    if (task.employeeId === viewer.id || (viewer.sysRole !== 'system_admin' && task.managerId !== viewer.id)) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅直属上级可操作',
      });
    }
  }

  private isCombinedDepartmentReview(task: { managerId: string | null; deptHeadId: string | null }): boolean {
    return Boolean(task.managerId && task.deptHeadId && task.managerId === task.deptHeadId);
  }
}
