import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { FlowService } from '@/tasks/flow.service';
import { ScoringService } from '@/tasks/scoring.service';

export interface PeriodAggregationResult {
  complete: boolean;
  score: number | null;
  targetStatus: TaskStatus | null;
}

@Injectable()
export class PeriodAggregationService {
  constructor(
    private readonly scoring: ScoringService,
    private readonly flow: FlowService,
  ) {}

  async refreshTask(
    taskId: string,
    tx: Prisma.TransactionClient,
    actorId: string,
  ): Promise<PeriodAggregationResult> {
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
    const gradeConfig = await tx.systemConfig.findUnique({ where: { key: 'grade_score_mapping' } });
    const mapping = (gradeConfig?.value as Record<string, number> | undefined) ?? { A: 90, B: 75, C: 60 };
    const rawGrade = this.scoring.calcRawGrade(score, mapping);
    const resetCalibration = {
      calibratedGrade: null,
      calibrationNote: null,
      coefficient: null,
      hrCalibratorId: null,
      hrCalibratedAt: null,
    };

    await tx.gradeResult.upsert({
      where: { taskId },
      create: {
        taskId,
        calculatedScore: score,
        rawGrade,
        isVeto: false,
        vetoReason: null,
        vetoOperatorId: null,
        ...resetCalibration,
      },
      update: {
        calculatedScore: score,
        rawGrade,
        isVeto: false,
        vetoReason: null,
        vetoOperatorId: null,
        ...resetCalibration,
      },
    });

    const targetStatus: TaskStatus = legacyAdvancedWorkflowV2
      ? task.status
      : task.managerId === task.deptHeadId
        ? TaskStatus.hr_calibration
        : TaskStatus.dept_review;
    if (!legacyAdvancedWorkflowV2) {
      await this.flow.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId,
        taskUpdate: { managerScoredAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'period_scores_aggregated',
        entityType: 'assessment_task',
        entityId: taskId,
        newValue: {
          score,
          periodCount: completePeriods.length,
          targetStatus,
        },
      },
    });
    return { complete: true, score, targetStatus };
  }
}
