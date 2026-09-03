import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssessmentPeriodStatus,
  IndicatorProgressHealth,
  Prisma,
  SysRole,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import type { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import type { SaveEmployeePeriodReviewDraftDto } from './dto/save-employee-period-review-draft.dto';
import type { SubmitEmployeePeriodReviewDto } from './dto/submit-employee-period-review.dto';
import type { SaveManagerPeriodReviewDraftDto } from './dto/save-manager-period-review-draft.dto';
import type { ReturnManagerPeriodReviewDto } from './dto/return-manager-period-review.dto';
import type { SubmitManagerPeriodReviewDto } from './dto/submit-manager-period-review.dto';
import { PeriodAggregationService } from './period-aggregation.service';
import { FlowService } from '@/tasks/flow.service';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { ReopenPeriodReviewDto } from './dto/reopen-period-review.dto';
import { managerPeriodReviewTitle, periodReviewNoun, periodReviewTitle } from './period-review-labels';
import type { PeriodReviewActionResult, PeriodReviewDetail } from './period-review.types';

const periodInclude = {
  task: {
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
      manager: { select: { id: true, name: true } },
      dept: { select: { id: true, name: true } },
      cycle: { select: { id: true, name: true, notificationMode: true, publishedAt: true } },
      gradeResult: {
        select: {
          isPublished: true,
          publishedAt: true,
          calculatedScore: true,
          rawGrade: true,
          calibratedGrade: true,
        },
      },
    },
  },
  indicatorVersion: {
    include: { items: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } },
  },
  indicatorReviews: true,
} satisfies Prisma.AssessmentPeriodInclude;

type PeriodWithContext = Prisma.AssessmentPeriodGetPayload<{ include: typeof periodInclude }>;

const sourceSelect = {
  id: true,
  objectiveAlignments: {
    select: { objective: { select: { id: true, title: true, level: true } } },
  },
  progressUpdates: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      progress: true,
      healthStatus: true,
      content: true,
      attachments: true,
      createdAt: true,
    },
  },
} satisfies Prisma.IndicatorInstanceSelect;

type SourceContext = Prisma.IndicatorInstanceGetPayload<{ select: typeof sourceSelect }>;

const previousPeriodInclude = {
  indicatorVersion: { include: { items: true } },
  indicatorReviews: true,
} satisfies Prisma.AssessmentPeriodInclude;

type PreviousPeriodContext = Prisma.AssessmentPeriodGetPayload<{ include: typeof previousPeriodInclude }>;

@Injectable()
export class PeriodReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly aggregation: PeriodAggregationService,
    private readonly flow: FlowService,
  ) {}

  async getReview(periodId: string, viewer: AuthUser): Promise<PeriodReviewDetail> {
    const period = await this.getPeriod(periodId);
    this.assertCanRead(period, viewer);

    const sourceIds = (period.indicatorVersion?.items ?? [])
      .map((item) => item.sourceInstanceId)
      .filter((id): id is string => Boolean(id));
    const progressRange = this.progressRange(period);
    const [sources, previousPeriods]: [SourceContext[], PreviousPeriodContext[]] = await Promise.all([
      sourceIds.length
        ? this.prisma.indicatorInstance.findMany({
          where: { id: { in: sourceIds } },
          select: {
            ...sourceSelect,
            progressUpdates: {
              ...sourceSelect.progressUpdates,
              where: {
                periodId: null,
                createdAt: { gte: progressRange.gte, lt: progressRange.lt },
              },
            },
          },
        })
        : [],
      this.prisma.assessmentPeriod.findMany({
        where: { taskId: period.taskId, sequence: { lt: period.sequence } },
        orderBy: { sequence: 'desc' },
        include: previousPeriodInclude,
      }),
    ]);

    const sourceById = new Map<string, SourceContext>(sources.map((source) => [source.id, source]));
    const currentByItem = new Map(period.indicatorReviews.map((review) => [review.indicatorVersionItemId, review]));

    return {
      period: {
        id: period.id,
        taskId: period.taskId,
        periodKey: period.periodKey,
        periodType: period.periodType,
        status: period.status,
        selfEvalOpenAt: period.selfEvalOpenAt,
        selfEvalDueAt: period.selfEvalDueAt,
        managerDueAt: period.managerDueAt,
        employeeSubmittedAt: period.employeeSubmittedAt,
        managerSubmittedAt: period.managerSubmittedAt,
        selfScoreTotal: this.decimalNumber(period.selfScoreTotal),
        managerScoreTotal: this.decimalNumber(period.managerScoreTotal),
        draftVersion: period.draftVersion,
      },
      context: {
        cycleName: period.task.cycle.name,
        employeeName: period.task.employee.name,
        employeeNo: period.task.employee.employeeNo,
        deptName: period.task.dept?.name ?? null,
        managerName: period.task.manager?.name ?? null,
        statusLabel: this.statusLabel(period.status),
      },
      permissions: {
        canEditEmployee: this.canEditEmployee(period, viewer),
        canEditManager: period.managerId === viewer.id
          && period.status === 'manager_scoring'
          && period.employeeSubmittedAt != null
          && !period.managerSubmittedAt,
      },
      indicators: (period.indicatorVersion?.items ?? []).map((item) => {
        const review = currentByItem.get(item.id);
        const source = item.sourceInstanceId ? sourceById.get(item.sourceInstanceId) : undefined;
        const latest = source?.progressUpdates[0];
        const monthlyProgressSource = review
          ? 'draft_or_result'
          : latest
            ? 'active_progress'
            : 'none';
        const isScoreRequired = this.isScoreRequired(item.weight);
        return {
          indicatorVersionItemId: item.id,
          sourceInstanceId: item.sourceInstanceId,
          name: item.name,
          description: item.description,
          scoringStandard: item.scoringStandard,
          targetValue: this.decimalNumber(item.targetValue),
          targetValueText: item.targetValueText,
          unit: item.unit,
          weight: item.weight.toNumber(),
          isScoreRequired,
          monthlyProgressSource,
          progress: review ? review.progress : latest?.progress ?? null,
          healthStatus: review ? review.healthStatus : latest?.healthStatus ?? null,
          actualValueText: review?.actualValueText ?? null,
          employeeComment: review ? review.employeeComment : latest?.content ?? null,
          problemReason: review?.problemReason ?? null,
          nextMonthPlan: review?.nextMonthPlan ?? null,
          supportNeeded: review?.supportNeeded ?? null,
          attachments: this.jsonArray(review?.employeeAttachments),
          selfScore: isScoreRequired ? this.decimalNumber(review?.selfScore) : null,
          managerScore: this.decimalNumber(review?.managerScore),
          managerComment: review?.managerComment ?? null,
          latestProgress: latest ? {
            progress: latest.progress,
            healthStatus: latest.healthStatus,
            content: latest.content,
            attachments: this.jsonArray(latest.attachments),
            createdAt: latest.createdAt,
          } : null,
          alignedObjectives: (source?.objectiveAlignments ?? []).map((alignment) => alignment.objective),
          history: this.historyForSource(previousPeriods, item.sourceInstanceId),
        };
      }),
    };
  }

  async saveEmployeeDraft(
    periodId: string,
    dto: SaveEmployeePeriodReviewDraftDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    const period = await this.getPeriod(periodId);
    this.assertEmployeeEditable(period, viewer);
    this.assertKnownItems(period, dto.indicators.map((item) => item.indicatorVersionItemId), false);
    const savedAt = new Date();
    const itemsById = new Map((period.indicatorVersion?.items ?? []).map((item) => [item.id, item]));

    const draftVersion = await this.prisma.$transaction(async (tx) => {
      const nextVersion = await this.claimDraftVersion(tx, period, dto.expectedVersion);
      for (const item of dto.indicators) {
        const versionItem = itemsById.get(item.indicatorVersionItemId)!;
        const data = this.employeeReviewData(item, this.isScoreRequired(versionItem.weight));
        await tx.assessmentPeriodIndicatorReview.upsert({
          where: {
            periodId_indicatorVersionItemId: {
              periodId,
              indicatorVersionItemId: item.indicatorVersionItemId,
            },
          },
          create: { periodId, indicatorVersionItemId: item.indicatorVersionItemId, ...data },
          update: data,
        });
      }
      return nextVersion;
    });

    return { periodId, status: period.status, draftVersion, savedAt };
  }

  async submitEmployeeReview(
    periodId: string,
    dto: SubmitEmployeePeriodReviewDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    const previous = await this.prisma.assessmentPeriodReviewRevision.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (previous) return this.actionResultFromRevision(previous.snapshot, periodId);

    const period = await this.getPeriod(periodId);
    this.assertEmployeeEditable(period, viewer);
    this.assertKnownItems(period, dto.indicators.map((item) => item.indicatorVersionItemId), true);
    this.assertEmployeeScores(period, dto.indicators);
    const submittedAt = new Date();
    const itemsById = new Map((period.indicatorVersion?.items ?? []).map((item) => [item.id, item]));
    const selfScoreTotal = this.weightedScoreTotal(
      itemsById,
      dto.indicators,
      (item) => item.selfScore,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const draftVersion = await this.claimDraftVersion(tx, period, dto.expectedVersion);
      const revision = await tx.assessmentPeriodReviewRevision.count({
        where: { periodId, stage: 'employee' },
      });
      const snapshot: Prisma.InputJsonObject = {
        periodId,
        status: AssessmentPeriodStatus.manager_scoring,
        draftVersion,
        submittedAt: submittedAt.toISOString(),
        selfScoreTotal,
        indicators: dto.indicators.map((item) => ({
          indicatorVersionItemId: item.indicatorVersionItemId,
          progress: item.progress,
          healthStatus: item.healthStatus,
          employeeComment: item.employeeComment ?? null,
          selfScore: item.selfScore,
        })) as Prisma.InputJsonArray,
      };
      const formalRevision = await tx.assessmentPeriodReviewRevision.create({
        data: {
          periodId,
          stage: 'employee',
          revision: revision + 1,
          snapshot,
          idempotencyKey: dto.idempotencyKey,
          createdById: viewer.id,
        },
      });
      for (const item of dto.indicators) {
        const versionItem = itemsById.get(item.indicatorVersionItemId)!;
        const scoreRequired = this.isScoreRequired(versionItem.weight);
        const data = this.employeeReviewData(item, scoreRequired);
        await tx.assessmentPeriodIndicatorReview.upsert({
          where: {
            periodId_indicatorVersionItemId: {
              periodId,
              indicatorVersionItemId: item.indicatorVersionItemId,
            },
          },
          create: { periodId, indicatorVersionItemId: item.indicatorVersionItemId, ...data },
          update: data,
        });
        if (
          versionItem.sourceInstanceId
          && (
            item.progress != null
            || item.healthStatus != null
            || this.optionalText(item.employeeComment) != null
          )
        ) {
          await tx.indicatorProgressUpdate.create({
            data: {
              indicatorInstanceId: versionItem.sourceInstanceId,
              periodId,
              periodReviewRevisionId: formalRevision.id,
              progress: item.progress,
              healthStatus: item.healthStatus,
              content: this.optionalText(item.employeeComment) ?? '',
              attachments: [],
              createdBy: viewer.id,
            },
          });
        }
      }
      await tx.assessmentPeriod.update({
        where: { id: periodId },
        data: {
          status: 'manager_scoring',
          employeeSubmittedAt: submittedAt,
          selfScoreTotal,
        },
      });
      await tx.assessmentTask.updateMany({
        where: { id: period.taskId, status: { in: ['goal_confirmed', 'self_eval'] } },
        data: { status: 'manager_scoring' },
      });
      await tx.flowRecord.create({
        data: {
          taskId: period.taskId,
          cycleId: period.task.cycleId,
          nodeType: 'self_eval',
          actorId: viewer.id,
          action: 'submit',
          comment: null,
          extraData: { type: 'employee_period_review_submitted', periodId, periodKey: period.periodKey },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'employee_period_review_submitted',
          entityType: 'assessment_period',
          entityId: periodId,
          newValue: snapshot,
        },
      });
      return { periodId, status: AssessmentPeriodStatus.manager_scoring, draftVersion, savedAt: submittedAt };
    });

    if (period.task.cycle.notificationMode !== 'off' && period.managerId) {
      await this.notifications.create({
        userId: period.managerId,
        senderId: viewer.id,
        cycleId: period.task.cycleId,
        taskId: period.taskId,
        type: 'monthly_manager_score_opened',
        title: `员工已提交${periodReviewNoun(period.periodType)}`,
        content: `${period.task.employee.name}已提交${periodReviewTitle(period.periodType, period.periodKey)}，请完成评分。`,
        extraData: {
          taskId: period.taskId,
          periodId,
          periodKey: period.periodKey,
          action: 'manager_period_review',
        },
      });
    }
    return result;
  }

  async saveManagerDraft(
    periodId: string,
    dto: SaveManagerPeriodReviewDraftDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    const period = await this.getPeriod(periodId);
    this.assertManagerEditable(period, viewer, true);
    this.assertKnownItems(period, dto.indicators.map((item) => item.indicatorVersionItemId), false);
    const savedAt = new Date();
    const itemsById = new Map((period.indicatorVersion?.items ?? []).map((item) => [item.id, item]));

    const draftVersion = await this.prisma.$transaction(async (tx) => {
      const nextVersion = await this.claimManagerDraftVersion(tx, period, dto.expectedVersion);
      for (const item of dto.indicators) {
        const versionItem = itemsById.get(item.indicatorVersionItemId)!;
        const data = this.managerReviewData(item, this.isScoreRequired(versionItem.weight));
        await tx.assessmentPeriodIndicatorReview.upsert({
          where: {
            periodId_indicatorVersionItemId: {
              periodId,
              indicatorVersionItemId: item.indicatorVersionItemId,
            },
          },
          create: { periodId, indicatorVersionItemId: item.indicatorVersionItemId, ...data },
          update: data,
        });
      }
      return nextVersion;
    });

    return { periodId, status: period.status, draftVersion, savedAt };
  }

  async returnManagerReview(
    periodId: string,
    dto: ReturnManagerPeriodReviewDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    const previous = await this.prisma.assessmentPeriodReviewRevision.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (previous) return this.actionResultFromRevision(previous.snapshot, periodId);

    const period = await this.getPeriod(periodId);
    this.assertManagerEditable(period, viewer, true);
    const returnedAt = new Date();
    const reason = this.optionalText(dto.reason) ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const draftVersion = await this.claimManagerDraftVersion(tx, period, dto.expectedVersion);
      const revision = await tx.assessmentPeriodReviewRevision.count({
        where: { periodId, stage: 'manager' },
      });
      const snapshot: Prisma.InputJsonObject = {
        action: 'return',
        periodId,
        status: AssessmentPeriodStatus.self_eval,
        draftVersion,
        submittedAt: returnedAt.toISOString(),
        reason,
      };
      await tx.assessmentPeriodReviewRevision.create({
        data: {
          periodId,
          stage: 'manager',
          revision: revision + 1,
          snapshot,
          idempotencyKey: dto.idempotencyKey,
          createdById: viewer.id,
        },
      });
      await tx.assessmentPeriodIndicatorReview.updateMany({
        where: { periodId },
        data: { managerScore: null, managerComment: null },
      });
      await tx.assessmentPeriod.update({
        where: { id: periodId },
        data: {
          status: 'self_eval',
          employeeSubmittedAt: null,
          managerSubmittedAt: null,
          managerScoreTotal: null,
          lockedAt: null,
        },
      });
      await tx.flowRecord.create({
        data: {
          taskId: period.taskId,
          cycleId: period.task.cycleId,
          nodeType: 'manager_score',
          actorId: viewer.id,
          action: 'reject',
          comment: reason,
          extraData: { type: 'manager_period_review_returned', periodId, periodKey: period.periodKey },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'manager_period_review_returned',
          entityType: 'assessment_period',
          entityId: periodId,
          oldValue: { employeeSubmittedAt: period.employeeSubmittedAt?.toISOString() ?? null },
          newValue: snapshot,
        },
      });
      return { periodId, status: AssessmentPeriodStatus.self_eval, draftVersion, savedAt: returnedAt };
    });

    if (period.task.cycle.notificationMode !== 'off') {
      await this.notifications.create({
        userId: period.task.employeeId,
        senderId: viewer.id,
        cycleId: period.task.cycleId,
        taskId: period.taskId,
        type: 'period_employee_review_returned',
        title: `${periodReviewTitle(period.periodType, period.periodKey)}已退回`,
        content: reason
          ? `主管退回了本期自评：${reason}`
          : '主管退回了本期自评，请修改后重新提交。',
        extraData: {
          taskId: period.taskId,
          periodId,
          periodKey: period.periodKey,
          action: 'employee_period_review',
        },
      });
    }
    return result;
  }

  async submitManagerReview(
    periodId: string,
    dto: SubmitManagerPeriodReviewDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    const previous = await this.prisma.assessmentPeriodReviewRevision.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (previous) return this.actionResultFromRevision(previous.snapshot, periodId);

    const period = await this.getPeriod(periodId);
    this.assertManagerEditable(period, viewer, true);
    this.assertKnownItems(period, dto.indicators.map((item) => item.indicatorVersionItemId), true);
    this.assertManagerScores(period, dto.indicators);
    const submittedAt = new Date();
    const itemsById = new Map((period.indicatorVersion?.items ?? []).map((item) => [item.id, item]));
    const managerScoreTotal = this.weightedScoreTotal(
      itemsById,
      dto.indicators,
      (item) => item.managerScore,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const draftVersion = await this.claimManagerDraftVersion(tx, period, dto.expectedVersion);
      const revision = await tx.assessmentPeriodReviewRevision.count({
        where: { periodId, stage: 'manager' },
      });
      const snapshot: Prisma.InputJsonObject = {
        action: 'submit',
        periodId,
        status: AssessmentPeriodStatus.completed,
        draftVersion,
        submittedAt: submittedAt.toISOString(),
        managerScoreTotal,
        indicators: dto.indicators.map((item) => ({
          indicatorVersionItemId: item.indicatorVersionItemId,
          managerScore: item.managerScore,
          managerComment: this.optionalText(item.managerComment) ?? null,
        })) as Prisma.InputJsonArray,
      };
      await tx.assessmentPeriodReviewRevision.create({
        data: {
          periodId,
          stage: 'manager',
          revision: revision + 1,
          snapshot,
          idempotencyKey: dto.idempotencyKey,
          createdById: viewer.id,
        },
      });
      for (const item of dto.indicators) {
        const versionItem = itemsById.get(item.indicatorVersionItemId)!;
        const data = this.managerReviewData(item, this.isScoreRequired(versionItem.weight));
        await tx.assessmentPeriodIndicatorReview.upsert({
          where: {
            periodId_indicatorVersionItemId: {
              periodId,
              indicatorVersionItemId: item.indicatorVersionItemId,
            },
          },
          create: { periodId, indicatorVersionItemId: item.indicatorVersionItemId, ...data },
          update: data,
        });
      }
      await tx.assessmentPeriod.update({
        where: { id: periodId },
        data: {
          status: 'completed',
          managerSubmittedAt: submittedAt,
          managerScoreTotal,
          lockedAt: submittedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'manager_period_review_submitted',
          entityType: 'assessment_period',
          entityId: periodId,
          newValue: snapshot,
        },
      });
      await this.aggregation.refreshTask(period.taskId, tx, viewer.id);
      return { periodId, status: AssessmentPeriodStatus.completed, draftVersion, savedAt: submittedAt };
    });

    if (period.task.cycle.notificationMode !== 'off') {
      await this.notifications.create({
        userId: period.task.employeeId,
        senderId: viewer.id,
        cycleId: period.task.cycleId,
        taskId: period.taskId,
        type: 'period_manager_review_completed',
        title: `${managerPeriodReviewTitle(period.periodType, period.periodKey)}已完成`,
        content: '主管已完成本期评分，最终周期结果将在全部期间评分完成后汇总。',
        extraData: {
          taskId: period.taskId,
          periodId,
          periodKey: period.periodKey,
          action: 'employee_period_review',
        },
      });
    }
    return result;
  }

  async reopenPeriodReview(
    periodId: string,
    dto: ReopenPeriodReviewDto,
    viewer: AuthUser,
  ): Promise<PeriodReviewActionResult> {
    if (!hasHrCapability(viewer, 'cycle_plan_edit')) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权重新开放月度自评' });
    }
    const reason = this.optionalText(dto.reason);
    if (!reason) {
      throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写重新开放原因' });
    }
    const reopenedAt = new Date();

    const context = await this.prisma.$transaction(async (tx) => {
      const period = await tx.assessmentPeriod.findUnique({
        where: { id: periodId },
        include: periodInclude,
      });
      if (!period) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '月度自评不存在' });
      }
      if (period.periodType !== 'month') {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '仅月度自评支持重新开放' });
      }
      const gradeResult = period.task.gradeResult;
      if (
        period.task.cycle.publishedAt
        || period.task.publishedAt
        || gradeResult?.isPublished
        || gradeResult?.publishedAt
        || ['published', 'confirmed', 'appealing', 'closed'].includes(period.task.status)
      ) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '结果已经公示，请走现有结果更正流程',
        });
      }
      if (
        period.status !== AssessmentPeriodStatus.completed
        || !period.employeeSubmittedAt
        || !period.managerSubmittedAt
        || !period.lockedAt
      ) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '主管尚未提交并锁定本月评分，请使用主管退回',
        });
      }

      const claimed = await tx.assessmentPeriod.updateMany({
        where: {
          id: periodId,
          draftVersion: dto.expectedVersion,
          status: AssessmentPeriodStatus.completed,
          managerSubmittedAt: { not: null },
          lockedAt: { not: null },
        },
        data: { draftVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '月份状态已更新，请刷新后重试',
        });
      }
      const draftVersion = dto.expectedVersion + 1;

      await tx.assessmentPeriodIndicatorReview.updateMany({
        where: { periodId },
        data: { managerScore: null, managerComment: null },
      });
      await tx.assessmentPeriod.update({
        where: { id: periodId },
        data: {
          status: AssessmentPeriodStatus.self_eval,
          employeeSubmittedAt: null,
          managerSubmittedAt: null,
          lockedAt: null,
          selfScoreTotal: null,
          managerScoreTotal: null,
        },
      });
      await this.flow.reopenPeriodTx(tx, {
        task: period.task,
        actorId: viewer.id,
        reason,
        periodId,
        periodKey: period.periodKey,
        taskUpdate: {
          selfEvalSubmittedAt: null,
          managerScoredAt: null,
          deptReviewedAt: null,
          hrCalibratedAt: null,
          approvedAt: null,
          employeeConfirmedAt: null,
          closedAt: null,
        },
      });
      await tx.gradeResult.updateMany({
        where: { taskId: period.taskId, isPublished: false },
        data: {
          calculatedScore: null,
          rawGrade: null,
          calibratedGrade: null,
          calibrationNote: null,
          isVeto: false,
          vetoReason: null,
          vetoOperatorId: null,
          coefficient: null,
          hrCalibratorId: null,
          hrCalibratedAt: null,
          approverId: null,
          approvedAt: null,
          employeeConfirmedAt: null,
          publishedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'monthly_self_evaluation_reopened',
          entityType: 'assessment_period',
          entityId: periodId,
          oldValue: {
            status: period.status,
            taskStatus: period.task.status,
            draftVersion: period.draftVersion,
            employeeSubmittedAt: period.employeeSubmittedAt.toISOString(),
            managerSubmittedAt: period.managerSubmittedAt.toISOString(),
            lockedAt: period.lockedAt.toISOString(),
            selfScoreTotal: this.decimalNumber(period.selfScoreTotal),
            managerScoreTotal: this.decimalNumber(period.managerScoreTotal),
          },
          newValue: {
            status: AssessmentPeriodStatus.self_eval,
            taskStatus: 'self_eval',
            draftVersion,
            reason,
            reopenedAt: reopenedAt.toISOString(),
          },
        },
      });

      return {
        periodId,
        status: AssessmentPeriodStatus.self_eval,
        draftVersion,
        savedAt: reopenedAt,
        taskId: period.taskId,
        cycleId: period.task.cycleId,
        employeeId: period.task.employeeId,
        periodKey: period.periodKey,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.notifications.create({
      dedupeKey: `period-reopened:${periodId}:${context.draftVersion}:${context.employeeId}`,
      userId: context.employeeId,
      senderId: viewer.id,
      cycleId: context.cycleId,
      taskId: context.taskId,
      type: 'monthly_self_evaluation_reopened',
      title: '月度自评已重新开放',
      content: `${context.periodKey}月度自评已重新开放，原因：${reason}。请修改后重新提交。`,
      extraData: {
        periodId,
        periodKey: context.periodKey,
        taskId: context.taskId,
        action: 'employee_period_review',
      },
    });

    return {
      periodId: context.periodId,
      status: context.status,
      draftVersion: context.draftVersion,
      savedAt: context.savedAt,
    };
  }

  private async getPeriod(periodId: string): Promise<PeriodWithContext> {
    const period = await this.prisma.assessmentPeriod.findUnique({
      where: { id: periodId },
      include: periodInclude,
    });
    if (!period) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '月度自评任务不存在' });
    if (!period.indicatorVersion) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '本期目标版本尚未确认' });
    }
    return period;
  }

  private assertCanRead(period: PeriodWithContext, viewer: AuthUser): void {
    const allowed = period.task.employeeId === viewer.id
      || period.managerId === viewer.id
      || viewer.sysRole === SysRole.hr
      || viewer.sysRole === SysRole.system_admin
      || viewer.canViewAll;
    if (!allowed) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该期复盘' });
    }
  }

  private canEditEmployee(period: PeriodWithContext, viewer: AuthUser): boolean {
    return period.task.employeeId === viewer.id
      && ['self_eval', 'manager_scoring'].includes(period.status)
      && !period.employeeSubmittedAt
      && !period.managerSubmittedAt;
  }

  private assertEmployeeEditable(period: PeriodWithContext, viewer: AuthUser): void {
    if (period.task.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可填写本期自评' });
    }
    if (!this.canEditEmployee(period, viewer)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '当前复盘不可编辑' });
    }
  }

  private assertKnownItems(period: PeriodWithContext, ids: string[], requireComplete: boolean): void {
    const expected = (period.indicatorVersion?.items ?? []).map((item) => item.id);
    const unique = new Set(ids);
    const valid = ids.length === unique.size && ids.every((id) => expected.includes(id));
    const complete = !requireComplete || (ids.length === expected.length && expected.every((id) => unique.has(id)));
    if (!valid || !complete) {
      throw new ConflictException({
        code: ERROR_CODE.PARAM_INVALID,
        message: requireComplete ? '请提交每一项目标的本期自评' : '包含不属于本期目标的内容',
      });
    }
  }

  private assertManagerEditable(
    period: PeriodWithContext,
    viewer: AuthUser,
    requireEmployeeSubmission: boolean,
  ): void {
    if (period.managerId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅本期冻结的绩效直属上级可评分' });
    }
    if (period.status !== 'manager_scoring' || period.managerSubmittedAt || period.lockedAt) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '当前期间不可进行主管评分' });
    }
    if (requireEmployeeSubmission && !period.employeeSubmittedAt) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '员工尚未提交本期自评' });
    }
  }

  private async claimDraftVersion(
    tx: Prisma.TransactionClient,
    period: PeriodWithContext,
    expectedVersion: number,
  ): Promise<number> {
    const claimed = await tx.assessmentPeriod.updateMany({
      where: {
        id: period.id,
        draftVersion: expectedVersion,
        managerSubmittedAt: null,
        employeeSubmittedAt: null,
        status: { in: ['self_eval', 'manager_scoring'] },
      },
      data: { draftVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '内容已在其他设备更新，请刷新后继续',
      });
    }
    return expectedVersion + 1;
  }

  private async claimManagerDraftVersion(
    tx: Prisma.TransactionClient,
    period: PeriodWithContext,
    expectedVersion: number,
  ): Promise<number> {
    const claimed = await tx.assessmentPeriod.updateMany({
      where: {
        id: period.id,
        managerId: period.managerId,
        draftVersion: expectedVersion,
        managerSubmittedAt: null,
        lockedAt: null,
        status: 'manager_scoring',
      },
      data: { draftVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '内容已在其他设备更新，请刷新后继续',
      });
    }
    return expectedVersion + 1;
  }

  private employeeReviewData(item: {
    progress?: number | null;
    healthStatus?: IndicatorProgressHealth | null;
    employeeComment?: string | null;
    selfScore?: number | null;
  }, scoreRequired: boolean) {
    return {
      progress: item.progress,
      healthStatus: item.healthStatus,
      employeeComment: this.optionalText(item.employeeComment),
      selfScore: scoreRequired ? item.selfScore : null,
    };
  }

  private managerReviewData(
    item: { managerScore?: number | null; managerComment?: string | null },
    scoreRequired: boolean,
  ) {
    if (item.managerScore != null && (
      !Number.isFinite(item.managerScore)
      || item.managerScore < 0
      || item.managerScore > 100
    )) {
      throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '主管评分须为0至100分' });
    }
    return {
      managerScore: scoreRequired ? item.managerScore ?? null : null,
      managerComment: this.optionalText(item.managerComment) ?? null,
    };
  }

  private historyForSource(
    periods: Array<{
      periodKey: string;
      indicatorVersion: { items: Array<{ id: string; sourceInstanceId: string | null }> } | null;
      indicatorReviews: Array<{
        indicatorVersionItemId: string;
        progress: number | null;
        healthStatus: IndicatorProgressHealth | null;
        actualValueText: string | null;
        selfScore: Prisma.Decimal | null;
        managerScore: Prisma.Decimal | null;
      }>;
    }>,
    sourceInstanceId: string | null,
  ) {
    if (!sourceInstanceId) return [];
    return periods.flatMap((previous) => {
      const item = previous.indicatorVersion?.items.find((candidate) => candidate.sourceInstanceId === sourceInstanceId);
      const review = item
        ? previous.indicatorReviews.find((candidate) => candidate.indicatorVersionItemId === item.id)
        : undefined;
      if (!review) return [];
      return [{
        periodKey: previous.periodKey,
        progress: review.progress,
        healthStatus: review.healthStatus,
        actualValueText: review.actualValueText,
        selfScore: this.decimalNumber(review.selfScore),
        managerScore: this.decimalNumber(review.managerScore),
      }];
    });
  }

  private actionResultFromRevision(snapshot: Prisma.JsonValue, periodId: string): PeriodReviewActionResult {
    const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot as Prisma.JsonObject
      : {};
    return {
      periodId,
      status: (value.status as AssessmentPeriodStatus | undefined) ?? AssessmentPeriodStatus.manager_scoring,
      draftVersion: Number(value.draftVersion ?? 0),
      savedAt: new Date(String(value.submittedAt ?? new Date().toISOString())),
    };
  }

  private statusLabel(status: AssessmentPeriodStatus): string {
    return {
      unopened: '未开放',
      self_eval: '员工自评',
      manager_scoring: '主管评分',
      completed: '已完成',
      no_result: '无绩效结果',
    }[status];
  }

  private isScoreRequired(weight: Prisma.Decimal): boolean {
    return weight.greaterThan(0);
  }

  private assertEmployeeScores(
    period: PeriodWithContext,
    items: Array<{ indicatorVersionItemId: string; selfScore?: number | null }>,
  ): void {
    const versionItems = new Map(
      (period.indicatorVersion?.items ?? []).map((item) => [item.id, item]),
    );
    for (const item of items) {
      const versionItem = versionItems.get(item.indicatorVersionItemId)!;
      const required = this.isScoreRequired(versionItem.weight);
      if (required && (
        item.selfScore == null
        || !Number.isFinite(item.selfScore)
        || item.selfScore < 0
        || item.selfScore > 100
      )) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '请填写每项有效权重指标的月度自评分',
        });
      }
      if (!required && item.selfScore != null) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '零权重指标不参与月度评分',
        });
      }
    }
  }

  private assertManagerScores(
    period: PeriodWithContext,
    items: Array<{ indicatorVersionItemId: string; managerScore?: number | null }>,
  ): void {
    const versionItems = new Map(
      (period.indicatorVersion?.items ?? []).map((item) => [item.id, item]),
    );
    for (const item of items) {
      const versionItem = versionItems.get(item.indicatorVersionItemId)!;
      const required = this.isScoreRequired(versionItem.weight);
      if (required && (
        item.managerScore == null
        || !Number.isFinite(item.managerScore)
        || item.managerScore < 0
        || item.managerScore > 100
      )) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '请填写每项有效权重指标的主管月度评分',
        });
      }
      if (!required && item.managerScore != null) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '零权重指标不参与主管月度评分',
        });
      }
    }
  }

  private weightedScoreTotal<T extends { indicatorVersionItemId: string }>(
    versionItems: Map<string, { weight: Prisma.Decimal }>,
    items: T[],
    scoreOf: (item: T) => number | null | undefined,
  ): number | null {
    let weightedScore = 0;
    let totalWeight = 0;
    for (const item of items) {
      const weight = versionItems.get(item.indicatorVersionItemId)?.weight.toNumber() ?? 0;
      if (weight <= 0) continue;
      const score = scoreOf(item);
      if (score == null) return null;
      weightedScore += score * weight;
      totalWeight += weight;
    }
    return totalWeight > 0
      ? Number((weightedScore / totalWeight).toFixed(2))
      : null;
  }

  private progressRange(period: Pick<PeriodWithContext, 'periodKey' | 'periodStart' | 'periodEnd'>) {
    const monthly = /^(\d{4})-(\d{2})$/.exec(period.periodKey);
    if (monthly) {
      const year = Number(monthly[1]);
      const month = Number(monthly[2]);
      return {
        gte: new Date(Date.UTC(year, month - 1, 1) - 8 * 60 * 60 * 1000),
        lt: new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000),
      };
    }
    const start = period.periodStart;
    const end = period.periodEnd;
    return {
      gte: new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
      ) - 8 * 60 * 60 * 1000),
      lt: new Date(Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        end.getUTCDate() + 1,
      ) - 8 * 60 * 60 * 1000),
    };
  }

  private optionalText(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private decimalNumber(value: Prisma.Decimal | null | undefined): number | null {
    return value == null ? null : value.toNumber();
  }

  private jsonArray(value: Prisma.JsonValue | null | undefined): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private attachmentsJson(
    attachments: Array<{ name: string; url: string; size?: number }> | undefined,
  ): Prisma.InputJsonArray {
    return (attachments ?? []).map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
      ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    }));
  }
}
