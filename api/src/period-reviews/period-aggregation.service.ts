import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { FlowService } from '@/tasks/flow.service';

export interface PeriodAggregationResult {
  complete: boolean;
  score: number | null;
  targetStatus: TaskStatus | null;
}

/**
 * 月度结果聚合。
 *
 * 所有月度评分锁定后，仅刷新整周期参考总分（各月上级评分均分）。
 * 整周期最终等级由直属上级在「整周期结果评定」中独立录入，
 * 本服务不再从最后一月 managerGrade 推导 rawGrade，也不自动流转状态。
 */
@Injectable()
export class PeriodAggregationService {
  constructor(
    private readonly flow: FlowService,
  ) {}

  async refreshTask(
    taskId: string,
    tx: Prisma.TransactionClient,
    actorId: string,
  ): Promise<PeriodAggregationResult> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "assessment_tasks"
      WHERE "id" = ${taskId}::uuid
      FOR UPDATE
    `;
    const task = await tx.assessmentTask.findUnique({
      where: { id: taskId },
      include: {
        cycle: { select: { workflowVersion: true } },
        periods: {
          select: {
            status: true,
            employeeSubmittedAt: true,
            managerSubmittedAt: true,
            managerScoreTotal: true,
            lockedAt: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '绩效任务不存在' });
    }

    const completePeriods = task.periods.filter((period) => (
      period.status === 'completed'
      && period.employeeSubmittedAt != null
      && period.managerSubmittedAt != null
      && period.managerScoreTotal != null
      && period.lockedAt != null
    ));
    const allPeriodsComplete = task.periods.length > 0
      && completePeriods.length === task.periods.length;
    const legacyAdvancedWorkflowV2 = task.cycle?.workflowVersion === 2
      && (task.status === TaskStatus.dept_review || task.status === TaskStatus.hr_calibration);
    if (
      !allPeriodsComplete
      || (task.status !== TaskStatus.manager_scoring && !legacyAdvancedWorkflowV2)
    ) {
      return { complete: false, score: null, targetStatus: null };
    }

    const total = completePeriods.reduce(
      (sum, period) => sum + period.managerScoreTotal!.toNumber(),
      0,
    );
    const score = Number((total / completePeriods.length).toFixed(2));

    await tx.gradeResult.upsert({
      where: { taskId },
      create: {
        taskId,
        calculatedScore: score,
      },
      update: {
        calculatedScore: score,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'period_scores_aggregated',
        entityType: 'assessment_task',
        entityId: taskId,
        newValue: {
          score,
          gradeSource: 'final_grade_independently_entered',
          periodCount: completePeriods.length,
        },
      },
    });
    return { complete: true, score, targetStatus: null };
  }
}
