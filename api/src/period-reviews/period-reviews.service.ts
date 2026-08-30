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
import type { PeriodReviewActionResult, PeriodReviewDetail } from './period-review.types';

const periodInclude = {
  task: {
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
      manager: { select: { id: true, name: true } },
      dept: { select: { id: true, name: true } },
      cycle: { select: { id: true, name: true, notificationMode: true } },
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
  ) {}

  async getReview(periodId: string, viewer: AuthUser): Promise<PeriodReviewDetail> {
    const period = await this.getPeriod(periodId);
    this.assertCanRead(period, viewer);

    const sourceIds = (period.indicatorVersion?.items ?? [])
      .map((item) => item.sourceInstanceId)
      .filter((id): id is string => Boolean(id));
    const [sources, previousPeriods]: [SourceContext[], PreviousPeriodContext[]] = await Promise.all([
      sourceIds.length
        ? this.prisma.indicatorInstance.findMany({
          where: { id: { in: sourceIds } },
          select: {
            ...sourceSelect,
            progressUpdates: {
              ...sourceSelect.progressUpdates,
              where: { createdAt: { gte: period.periodStart, lte: period.periodEnd } },
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
        canEditManager: period.managerId === viewer.id && period.status === 'manager_scoring' && !period.managerSubmittedAt,
      },
      indicators: (period.indicatorVersion?.items ?? []).map((item) => {
        const review = currentByItem.get(item.id);
        const source = item.sourceInstanceId ? sourceById.get(item.sourceInstanceId) : undefined;
        const latest = source?.progressUpdates[0];
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
          progress: review?.progress ?? null,
          healthStatus: review?.healthStatus ?? null,
          actualValueText: review?.actualValueText ?? null,
          employeeComment: review?.employeeComment ?? null,
          problemReason: review?.problemReason ?? null,
          nextMonthPlan: review?.nextMonthPlan ?? null,
          supportNeeded: review?.supportNeeded ?? null,
          attachments: this.jsonArray(review?.employeeAttachments),
          selfScore: this.decimalNumber(review?.selfScore),
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

    const draftVersion = await this.prisma.$transaction(async (tx) => {
      const nextVersion = await this.claimDraftVersion(tx, period, dto.expectedVersion);
      for (const item of dto.indicators) {
        const data = this.employeeReviewData(item);
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
    const submittedAt = new Date();
    const itemsById = new Map((period.indicatorVersion?.items ?? []).map((item) => [item.id, item]));
    const selfScoreTotal = Number(dto.indicators.reduce((sum, item) => {
      const weight = itemsById.get(item.indicatorVersionItemId)?.weight.toNumber() ?? 0;
      return sum + item.selfScore * weight;
    }, 0).toFixed(2));

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
          actualValueText: item.actualValueText ?? null,
          employeeComment: item.employeeComment ?? null,
          problemReason: item.problemReason ?? null,
          nextMonthPlan: item.nextMonthPlan ?? null,
          supportNeeded: item.supportNeeded ?? null,
          attachments: this.attachmentsJson(item.attachments),
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
        const data = this.employeeReviewData(item);
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
        if (versionItem.sourceInstanceId) {
          await tx.indicatorProgressUpdate.create({
            data: {
              indicatorInstanceId: versionItem.sourceInstanceId,
              periodId,
              periodReviewRevisionId: formalRevision.id,
              progress: item.progress,
              healthStatus: item.healthStatus,
              content: this.optionalText(item.employeeComment)
                ?? this.progressSummary(item.progress, item.healthStatus),
              attachments: this.attachmentsJson(item.attachments),
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
        title: '员工已提交月度复盘与自评',
        content: `${period.task.employee.name}已提交${period.periodKey}月度复盘，请完成评分。`,
        extraData: { periodId, periodKey: period.periodKey },
      });
    }
    return result;
  }

  private async getPeriod(periodId: string): Promise<PeriodWithContext> {
    const period = await this.prisma.assessmentPeriod.findUnique({
      where: { id: periodId },
      include: periodInclude,
    });
    if (!period) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '月度复盘不存在' });
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
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该月度复盘' });
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
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可填写月度复盘' });
    }
    if (!this.canEditEmployee(period, viewer)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '当前月度复盘不可编辑' });
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
        message: requireComplete ? '请完成每一项目标的月度复盘' : '包含不属于本期目标的内容',
      });
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

  private employeeReviewData(item: {
    progress?: number | null;
    healthStatus?: IndicatorProgressHealth | null;
    actualValueText?: string | null;
    employeeComment?: string | null;
    problemReason?: string | null;
    nextMonthPlan?: string | null;
    supportNeeded?: string | null;
    attachments?: Array<{ name: string; url: string; size?: number }>;
    selfScore?: number | null;
  }) {
    return {
      progress: item.progress,
      healthStatus: item.healthStatus,
      actualValueText: this.optionalText(item.actualValueText),
      employeeComment: this.optionalText(item.employeeComment),
      problemReason: this.optionalText(item.problemReason),
      nextMonthPlan: this.optionalText(item.nextMonthPlan),
      supportNeeded: this.optionalText(item.supportNeeded),
      employeeAttachments: this.attachmentsJson(item.attachments),
      selfScore: item.selfScore,
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
      self_eval: '员工复盘与自评',
      manager_scoring: '主管评分',
      completed: '已完成',
      no_result: '无绩效结果',
    }[status];
  }

  private progressSummary(progress: number, health: IndicatorProgressHealth): string {
    const labels: Record<IndicatorProgressHealth, string> = {
      on_track: '正常',
      at_risk: '有风险',
      blocked: '受阻',
      completed: '已完成',
    };
    return `月度复盘：完成度 ${progress}%，状态${labels[health]}`;
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
