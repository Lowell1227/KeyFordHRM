import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentTask, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { FlowService } from '@/tasks/flow.service';
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

  /** POST /tasks/:id/approval/reject — 审批人退回 HR 校准。 */
  async rejectTask(
    taskId: string,
    dto: ApprovalRejectDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskId },
      include: { gradeResult: { select: { approvedAt: true } } },
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

    if (!this.canViewAll(viewer)) {
      where.approverId = viewer.id;
    }

    return this.prisma.assessmentTask.findMany({ where });
  }

  private canViewAll(viewer: AuthUser): boolean {
    return viewer.sysRole === 'system_admin' || viewer.canViewAll;
  }

  private assertApprover(task: AssessmentTask, viewer: AuthUser): void {
    if (task.approverId !== viewer.id && !this.canViewAll(viewer)) {
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
      approverId: task.gradeResult?.approverId ?? task.approverId ?? null,
      approvedAt: task.gradeResult?.approvedAt ?? null,
    };
  }
}
