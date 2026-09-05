import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentTask, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { buildGradeDistribution } from '@/calibration/calibration.service';
import { BulkApprovalDto } from './dto/bulk-approval.dto';
import { ApprovalRejectDto } from './dto/approval-reject.dto';

/** 审批列表项。 */
export interface ApprovalListItem {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  position: string | null;
  deptId: string | null;
  deptName: string | null;
  status: TaskStatus;
  totalScore: number | null;
  rawGrade: string | null;
  calibratedGrade: string | null;
  isVeto: boolean;
  approverId: string | null;
  approvedAt: Date | null;
}

/** 批量审批结果。 */
export interface BulkApprovalResult {
  approved: number;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /cycles/:id/approval — 按审批人过滤的待审批列表。 */
  async getApprovalList(cycleId: string, viewer: AuthUser): Promise<ApprovalListItem[]> {
    await this.getCycleOrThrow(cycleId);

    const where: Prisma.AssessmentTaskWhereInput = {
      cycleId,
      status: 'approval',
      isExempt: false,
    };

    if (!this.canViewAll(viewer)) {
      where.approverId = viewer.id;
    }

    const tasks = await this.prisma.assessmentTask.findMany({
      where,
      include: {
        employee: { select: { name: true, position: true } },
        dept: { select: { name: true } },
        gradeResult: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return tasks.map((task) => this.mapToListItem(task));
  }

  /**
   * GET /cycles/:id/approval/overview — 审批概览（全校准分布只读 + 名下进度）。
   *
   * 分管总可查看整个周期的等级分布作为审批参照，但只能操作自己名下的任务。
   */
  async getOverview(cycleId: string, viewer: AuthUser) {
    const cycle = await this.getCycleOrThrow(cycleId);
    const allTasks = await this.prisma.assessmentTask.findMany({
      where: { cycleId, isExempt: false },
      include: { gradeResult: { select: { calibratedGrade: true, rawGrade: true } } },
    });

    const ownPending = allTasks.filter(
      (t) => t.status === 'approval' && t.approverId === viewer.id,
    ).length;
    const ownTotal = allTasks.filter((t) => t.approverId === viewer.id).length;
    const cyclePending = allTasks.filter((t) => t.status === 'approval').length;

    // 校准环节退回记录（HR 驳回 + 部门复核退回），供审批人了解重评背景
    const rejectRecords = await this.prisma.flowRecord.findMany({
      where: {
        cycleId,
        action: 'reject',
        nodeType: { in: ['hr_calibration', 'dept_review'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        actor: { select: { name: true } },
        task: { select: { employee: { select: { name: true } } } },
      },
    });

    return {
      gradeDistribution: buildGradeDistribution(allTasks, cycle),
      ownPending,
      ownTotal,
      /** 周期内仍处审批中的任务数；为 0 表示已全部通过或退回。 */
      cyclePending,
      rejects: rejectRecords.map((r) => ({
        employeeName: r.task?.employee?.name ?? '',
        nodeType: r.nodeType,
        comment: r.comment,
        createdAt: r.createdAt,
        actorName: r.actor?.name ?? null,
      })),
    };
  }

  /** POST /cycles/:id/approval — 批量审批（只写 GradeResult，不改 status）。 */
  async approveTasks(
    cycleId: string,
    dto: BulkApprovalDto,
    viewer: AuthUser,
  ): Promise<BulkApprovalResult> {
    await this.getCycleOrThrow(cycleId);

    const tasks = await this.findApprovalTasksByIds(cycleId, dto.taskIds, viewer);
    if (tasks.length !== dto.taskIds.length) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '存在非本周期、非审批状态或无权审批的任务',
      });
    }

    const now = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        for (const task of tasks) {
          await tx.gradeResult.upsert({
            where: { taskId: task.id },
            create: {
              taskId: task.id,
              approverId: viewer.id,
              approvedAt: now,
            },
            update: {
              approverId: viewer.id,
              approvedAt: now,
            },
          });

          await tx.assessmentTask.update({
            where: { id: task.id },
            data: { approvedAt: now },
          });

          await tx.flowRecord.create({
            data: {
              taskId: task.id,
              cycleId: task.cycleId,
              nodeType: 'approval',
              actorId: viewer.id,
              action: 'approve',
              comment: dto.comment,
            },
          });
        }
      },
      { timeout: 60000, maxWait: 10000 },
    );

    return { approved: tasks.length };
  }

  /** POST /tasks/:id/approval/reject — 审批人退回绩效校准。 */
  async rejectTask(
    taskId: string,
    dto: ApprovalRejectDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskId },
      include: {
        employee: { select: { name: true } },
        gradeResult: { select: { approvedAt: true } },
      },
    });

    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核任务不存在',
      });
    }

    this.assertApprover(task, viewer);

    if (task.status !== 'approval') {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅审批中的任务可退回',
      });
    }

    await this.prisma.$transaction(
      async (tx) => {
        await this.flowService.transitionTx(tx, {
          task,
          action: 'reject',
          targetStatus: 'hr_calibration',
          actorId: viewer.id,
          comment: dto.comment,
          taskUpdate: { approvedAt: null },
        });

        await tx.gradeResult.updateMany({
          where: { taskId: task.id },
          data: {
            approverId: null,
            approvedAt: null,
          },
        });
      },
      { timeout: 60000, maxWait: 10000 },
    );

    // 通知 HR（优先通知执行确认的 HR，否则通知周期 HR 负责人）
    const gradeResult = await this.prisma.gradeResult.findUnique({
      where: { taskId: task.id },
      select: { hrCalibratorId: true },
    });
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: task.cycleId },
      select: { hrOwnerId: true, name: true },
    });
    const notifyUserId = gradeResult?.hrCalibratorId ?? cycle?.hrOwnerId ?? null;
    if (notifyUserId) {
      await this.notificationsService.create({
        userId: notifyUserId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'approval_rejected',
        title: '绩效结果审批被退回',
        content: `${cycle?.name ?? ''}：${task.employee?.name ?? '员工'} 的绩效结果被审批退回：${dto.comment}。请在校准环节重新处理。`,
      }).catch(() => {
        // 推送失败不阻断业务
      });
    }

    return { id: task.id, status: 'hr_calibration' };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async getCycleOrThrow(cycleId: string) {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核周期不存在',
      });
    }
    return cycle;
  }

  private async findApprovalTasksByIds(cycleId: string, taskIds: string[], viewer: AuthUser) {
    const where: Prisma.AssessmentTaskWhereInput = {
      id: { in: taskIds },
      cycleId,
      status: 'approval',
      isExempt: false,
    };

    where.approverId = viewer.id;

    return this.prisma.assessmentTask.findMany({ where });
  }

  private canViewAll(viewer: AuthUser): boolean {
    return viewer.sysRole === 'system_admin' || viewer.canViewAll;
  }

  private assertApprover(task: AssessmentTask, viewer: AuthUser): void {
    if (task.approverId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅审批人可操作',
      });
    }
  }

  private mapToListItem(
    task: AssessmentTask & {
      employee: { name: string; position: string | null } | null;
      dept: { name: string } | null;
      gradeResult: {
        calculatedScore: Prisma.Decimal | null;
        rawGrade: string | null;
        calibratedGrade: string | null;
        isVeto: boolean;
        approverId: string | null;
        approvedAt: Date | null;
      } | null;
    },
  ): ApprovalListItem {
    return {
      id: task.id,
      cycleId: task.cycleId,
      employeeId: task.employeeId,
      employeeName: task.employee?.name ?? '',
      position: task.employee?.position ?? null,
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      status: task.status,
      totalScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      calibratedGrade: task.gradeResult?.calibratedGrade ?? null,
      isVeto: task.gradeResult?.isVeto ?? false,
      approverId: task.approverId ?? null,
      approvedAt: task.gradeResult?.approvedAt ?? null,
    };
  }
}
