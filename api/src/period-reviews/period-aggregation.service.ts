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
        periods: {
          select: { status: true, managerScoreTotal: true },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '绩效任务不存在' });
    }

    const unfinished = task.periods.some((period) => !['completed', 'no_result'].includes(period.status));
    const valid = task.periods.filter((period) => (
      period.status === 'completed' && period.managerScoreTotal != null
    ));
    if (unfinished || valid.length === 0 || task.status !== 'manager_scoring') {
      return { complete: false, score: null, targetStatus: null };
    }

    const total = valid.reduce((sum, period) => sum + period.managerScoreTotal!.toNumber(), 0);
    const score = Number((total / valid.length).toFixed(2));
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

    const targetStatus: TaskStatus = task.managerId === task.deptHeadId
      ? TaskStatus.hr_calibration
      : TaskStatus.dept_review;
    await this.flow.transitionTx(tx, {
      task,
      action: 'submit',
      targetStatus,
      actorId,
      taskUpdate: { managerScoredAt: new Date() },
    });
    return { complete: true, score, targetStatus };
  }
}
