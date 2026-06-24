import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentCycle, Prisma, TaskStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { PublishCycleDto } from './dto/publish-cycle.dto';

/** 公示结果。 */
export interface PublishResult {
  cycleId: string;
  published: number;
  publishedAt: Date;
  deadlineAppeal: Date;
}

/**
 * 计算申诉截止日。
 * 规则：自公示日起加 appealWindowDays 天；若周期已有更晚的 deadlineAppeal 则取 max。
 */
export function calcAppealDeadline(
  publishedAt: Date,
  cycle: Pick<AssessmentCycle, 'deadlineAppeal'>,
  appealWindowDays: number,
): Date {
  const base = dayjs(publishedAt);
  const calculated = base.add(appealWindowDays, 'day').startOf('day').toDate();

  if (cycle.deadlineAppeal && new Date(cycle.deadlineAppeal).getTime() > calculated.getTime()) {
    return new Date(cycle.deadlineAppeal);
  }

  return calculated;
}

@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** POST /cycles/:id/publish — HR 按 taskIds 批量公示。 */
  async publishCycle(
    cycleId: string,
    dto: PublishCycleDto,
    viewer: AuthUser,
  ): Promise<PublishResult> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const appealWindowDays = await this.loadAppealWindowDays();

    if (!dto.taskIds || dto.taskIds.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: 'taskIds 不能为空',
      });
    }

    // 只处理本次勾选的、仍在 approval 态的非豁免任务
    const tasks = await this.prisma.assessmentTask.findMany({
      where: {
        id: { in: dto.taskIds },
        cycleId,
        status: 'approval',
        isExempt: false,
      },
      include: {
        gradeResult: { select: { approvedAt: true, calibratedGrade: true, rawGrade: true } },
      },
    });

    if (tasks.length !== dto.taskIds.length) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '存在非本周期、非审批状态或已豁免的任务',
      });
    }

    const notApproved = tasks.filter((t) => !t.gradeResult?.approvedAt);
    if (notApproved.length > 0) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: `存在未审批的任务：${notApproved.map((t) => t.id).join(', ')}`,
      });
    }

    const publishedAt = new Date();
    const deadlineAppeal = calcAppealDeadline(publishedAt, cycle, appealWindowDays);

    await this.prisma.$transaction(
      async (tx) => {
        for (const task of tasks) {
          await this.flowService.transitionTx(tx, {
            task,
            action: 'approve',
            targetStatus: 'published',
            actorId: viewer.id,
            comment: 'HR 公示发布',
            taskUpdate: { publishedAt },
          });

          await tx.gradeResult.updateMany({
            where: { taskId: task.id },
            data: {
              isPublished: true,
              publishedAt,
            },
          });

          // A1：公示时自动为每个已审批任务创建绩效面谈记录，截止日 = 审批通过 +20 日
          const approved = dayjs(task.gradeResult?.approvedAt ?? publishedAt);
          const deadline = new Date(Date.UTC(approved.year(), approved.month(), approved.date() + 20));

          await tx.performanceInterview.upsert({
            where: { taskId: task.id },
            create: {
              taskId: task.id,
              cycleId: task.cycleId,
              employeeId: task.employeeId,
              interviewerId: task.managerId ?? viewer.id,
              deadline,
              status: 'pending',
            },
            update: {},
          });

          // A2：最终等级为 D 时自动生成绩效改进计划（壳）
          const effectiveGrade = task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade;
          if (effectiveGrade === 'D') {
            await tx.improvementPlan.upsert({
              where: { employeeId_cycleId: { employeeId: task.employeeId, cycleId } },
              create: {
                employeeId: task.employeeId,
                cycleId,
                taskId: task.id,
                status: 'draft',
              },
              update: {},
            });
          }
        }

        // 仅当本周期已无处于 approval 的非豁免任务时，才将周期状态推进为 published
        const remainingApprovalTasks = await tx.assessmentTask.count({
          where: { cycleId, status: 'approval', isExempt: false },
        });

        const cycleData: Prisma.AssessmentCycleUpdateInput = {
          publishedAt,
          deadlineAppeal,
        };
        if (remainingApprovalTasks === 0) {
          cycleData.status = 'published';
        }

        await tx.assessmentCycle.update({
          where: { id: cycleId },
          data: cycleData,
        });
      },
      { timeout: 60000, maxWait: 10000 },
    );

    if (dto.sendDingtalkNotification) {
      for (const task of tasks) {
        await this.notificationsService.sendResultPublished(task.id).catch(() => {
          // 通知失败不阻断业务
        });
      }
    }

    return {
      cycleId,
      published: tasks.length,
      publishedAt,
      deadlineAppeal,
    };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async getCycleOrThrow(cycleId: string): Promise<AssessmentCycle> {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核周期不存在',
      });
    }
    return cycle;
  }

  private async loadAppealWindowDays(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'appeal_window_days' },
    });

    if (!config) return 30;

    const value = config.value as number | { value?: number } | undefined;
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof value.value === 'number') {
      return value.value;
    }
    return 30;
  }
}
