import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CycleStatus, Prisma, ScoringFrequency, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto, paginated } from '@/common/dto/pagination.dto';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';
import { UpdateDeadlinesDto } from './dto/update-deadlines.dto';
import { CycleQueryDto, CycleStatusGroup } from './dto/cycle-query.dto';
import type { CycleNotificationMode } from './dto/update-cycle-notification-mode.dto';
import type { ReviewCycleDto } from './dto/review-cycle.dto';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { CycleScheduleService, NormalizedCycleSchedulePlan } from './cycle-schedule.service';
import { businessDateKey, canonicalDateOnly, normalizeScoringFrequency } from './cycle-scoring-plan';

const DEADLINE_FIELDS = [
  'deadlineIndicatorSetting',
  'deadlineIndicatorConfirm',
  'deadlineSelfEval',
  'deadlineManagerScore',
  'deadlineHrCalibration',
  'deadlineApproval',
  'deadlinePublish',
] as const;

type DeadlineField = (typeof DEADLINE_FIELDS)[number];

const CYCLE_STATUS_GROUPS: Record<CycleStatusGroup, CycleStatus[]> = {
  [CycleStatusGroup.attention]: [CycleStatus.draft, CycleStatus.launch_blocked],
  [CycleStatusGroup.active]: [
    CycleStatus.scheduled,
    CycleStatus.indicator_setting,
    CycleStatus.self_eval,
    CycleStatus.manager_score,
    CycleStatus.hr_calibration,
    CycleStatus.approval,
    CycleStatus.published,
    CycleStatus.appeal,
  ],
  [CycleStatusGroup.finished]: [CycleStatus.closed],
};

const CYCLE_PLAN_INCLUDE = {
  periodSchedules: { orderBy: { sequence: 'asc' as const } },
  companyFinalApprover: { select: { id: true, name: true } },
};

@Injectable()
export class CyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cycleScheduleService: CycleScheduleService = new CycleScheduleService(),
  ) {}

  /** POST /cycles — 创建考核周期。 */
  async create(dto: CreateCycleDto, user: AuthUser) {
    const startDate = canonicalDateOnly(dto.startDate);
    const endDate = canonicalDateOnly(dto.endDate);
    const goalSettingOpenAt = dto.goalSettingOpenAt ?? this.addDays(startDate, -10);
    const selfEvalOpenAt = dto.selfEvalOpenAt ?? this.addDays(endDate, 1);
    this.validateCycleDates({ ...dto, startDate, endDate }, goalSettingOpenAt, selfEvalOpenAt);
    const hrOwnerId = await this.resolveHrOwnerId(dto.hrOwnerId, user);
    const workflowVersion = dto.workflowVersion ?? 1;
    const reviewerId = workflowVersion === 1
      ? await this.resolveReviewerId(dto.reviewerId)
      : null;
    const schedulePlan = workflowVersion === 2
      ? this.normalizeSchedulePlan({
          type: dto.type,
          startDate,
          endDate,
          scoringFrequency: dto.scoringFrequency,
          schedules: dto.periodSchedules,
        })
      : null;

    return this.prisma.$transaction(async (tx) => {
      const companyFinalApproverId = workflowVersion === 2
        ? await this.resolveCompanyFinalApproverId(tx)
        : null;
      const data: Prisma.AssessmentCycleCreateInput = {
        name: dto.name,
        type: dto.type,
        startDate,
        endDate,
        goalSettingOpenAt,
        selfEvalOpenAt,
        workflowVersion,
        scoringFrequency: schedulePlan?.scoringFrequency ?? ScoringFrequency.cycle,
        ...(companyFinalApproverId && {
          companyFinalApprover: { connect: { id: companyFinalApproverId } },
        }),
        ...(schedulePlan && {
          periodSchedules: { create: schedulePlan.schedules.map((schedule) => this.scheduleCreateData(schedule)) },
        }),
        ...(reviewerId && { reviewer: { connect: { id: reviewerId } } }),
        reviewStatus: 'pending',
        monthlyFollowUpRequired: ['quarterly', 'semiannual', 'annual'].includes(dto.type)
          ? Boolean(dto.monthlyFollowUpRequired)
          : false,
        participantDeptIds: dto.participantDeptIds ?? [],
        participantUserIds: dto.participantUserIds ?? [],
        explicitExemptDeptIds: dto.explicitExemptDeptIds ?? [],
        explicitExemptUserIds: dto.explicitExemptUserIds ?? [],
        notificationMode: dto.notificationMode ?? 'off',
        status: 'draft',
        creator: { connect: { id: user.id } },
        hrOwner: { connect: { id: hrOwnerId } },
        ...(dto.deadlineIndicatorSetting && { deadlineIndicatorSetting: dto.deadlineIndicatorSetting }),
        ...(dto.deadlineIndicatorConfirm && { deadlineIndicatorConfirm: dto.deadlineIndicatorConfirm }),
        ...(dto.deadlineSelfEval && { deadlineSelfEval: dto.deadlineSelfEval }),
        ...(dto.deadlineManagerScore && { deadlineManagerScore: dto.deadlineManagerScore }),
        ...(dto.deadlineHrCalibration && { deadlineHrCalibration: dto.deadlineHrCalibration }),
        ...(dto.deadlineApproval && { deadlineApproval: dto.deadlineApproval }),
        ...(dto.deadlinePublish && { deadlinePublish: dto.deadlinePublish }),
        ...(dto.publishVisibleFields && { publishVisibleFields: dto.publishVisibleFields }),
        gradeAMaxRatio: new Prisma.Decimal(dto.gradeAMaxRatio ?? 0.2),
        gradeBMaxRatio: new Prisma.Decimal(dto.gradeBMaxRatio ?? 0.4),
        gradeCMaxRatio: new Prisma.Decimal(dto.gradeCMaxRatio ?? 0.3),
        gradeDMaxRatio: new Prisma.Decimal(dto.gradeDMaxRatio ?? 0.1),
      };
      const cycle = await tx.assessmentCycle.create({ data, include: CYCLE_PLAN_INCLUDE });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_created',
          entityType: 'assessment_cycle',
          entityId: cycle.id,
          newValue: { name: dto.name, type: dto.type, status: 'draft' },
        },
      });
      return this.withPlanFields(cycle, schedulePlan?.warnings ?? []);
    });
  }

  /** PATCH /cycles/:id/notification-mode — 开放前可调整钉钉通知策略。 */
  async updateNotificationMode(id: string, notificationMode: CycleNotificationMode, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      const editableStatuses: CycleStatus[] = [CycleStatus.draft, CycleStatus.scheduled, CycleStatus.launch_blocked];
      if (!editableStatuses.includes(cycle.status)) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '周期正式开放后不能修改通知策略',
        });
      }

      const write = await tx.assessmentCycle.updateMany({
        where: { id, status: cycle.status },
        data: { notificationMode },
      });
      if (write.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '周期状态已变化，请刷新后重试' });
      }
      const updated = await tx.assessmentCycle.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_notification_mode_updated',
          entityType: 'assessment_cycle',
          entityId: id,
          oldValue: { notificationMode: cycle.notificationMode },
          newValue: { notificationMode },
        },
      });
      return updated;
    });
  }

  /** DELETE /cycles/:id — 仅允许删除尚未预约或开放的草稿周期。 */
  async remove(id: string, user: AuthUser): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (cycle.status !== CycleStatus.draft) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '仅草稿状态的周期可以删除',
        });
      }

      const deleted = await tx.assessmentCycle.deleteMany({
        where: { id, status: CycleStatus.draft },
      });
      if (deleted.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '周期状态已变化，请刷新后重试',
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_draft_deleted',
          entityType: 'assessment_cycle',
          entityId: cycle.id,
          oldValue: {
            name: cycle.name,
            type: cycle.type,
            status: cycle.status,
          },
        },
      });
      return { id: cycle.id };
    });
  }

  /** PATCH /cycles/:id — 仅允许修改草稿周期的完整计划。 */
  async updateDraft(id: string, dto: UpdateCycleDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({
        where: { id },
        include: CYCLE_PLAN_INCLUDE,
      });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (cycle.status !== CycleStatus.draft) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '仅草稿状态的周期可以编辑完整计划',
        });
      }
      if (dto.expectedPlanVersion !== cycle.planVersion) {
        throw this.stalePlanConflict();
      }

      const goalSettingOpenAt = dto.goalSettingOpenAt ?? cycle.goalSettingOpenAt;
      const selfEvalOpenAt = dto.selfEvalOpenAt ?? cycle.selfEvalOpenAt;
      const startDate = canonicalDateOnly(dto.startDate ?? cycle.startDate);
      const endDate = canonicalDateOnly(dto.endDate ?? cycle.endDate);
      if (goalSettingOpenAt && selfEvalOpenAt) {
        this.validateCycleDates(
          {
            startDate,
            endDate,
            deadlineIndicatorSetting: dto.deadlineIndicatorSetting ?? cycle.deadlineIndicatorSetting ?? undefined,
            deadlineIndicatorConfirm: dto.deadlineIndicatorConfirm ?? cycle.deadlineIndicatorConfirm ?? undefined,
            deadlineSelfEval: dto.deadlineSelfEval ?? cycle.deadlineSelfEval ?? undefined,
            deadlineManagerScore: dto.deadlineManagerScore ?? cycle.deadlineManagerScore ?? undefined,
            deadlineHrCalibration: dto.deadlineHrCalibration ?? cycle.deadlineHrCalibration ?? undefined,
            deadlineApproval: dto.deadlineApproval ?? cycle.deadlineApproval ?? undefined,
            deadlinePublish: dto.deadlinePublish ?? cycle.deadlinePublish ?? undefined,
          } as CreateCycleDto,
          goalSettingOpenAt,
          selfEvalOpenAt,
        );
      }

      const hrOwnerId = dto.hrOwnerId !== undefined
        ? await this.resolveHrOwnerId(dto.hrOwnerId, user)
        : cycle.hrOwnerId;
      const workflowVersion = dto.workflowVersion ?? cycle.workflowVersion ?? 1;
      const reviewerId = dto.reviewerId !== undefined && workflowVersion === 1
        ? await this.resolveReviewerId(dto.reviewerId)
        : cycle.reviewerId;
      const nextType = dto.type ?? cycle.type;
      const requestedScoringFrequency = normalizeScoringFrequency(
        nextType,
        dto.scoringFrequency ?? cycle.scoringFrequency,
      );
      const scheduleStructureChanged = workflowVersion !== (cycle.workflowVersion ?? 1)
        || nextType !== cycle.type
        || businessDateKey(startDate) !== businessDateKey(cycle.startDate)
        || businessDateKey(endDate) !== businessDateKey(cycle.endDate)
        || requestedScoringFrequency !== (cycle.scoringFrequency ?? ScoringFrequency.cycle);
      const storedSchedules = cycle.periodSchedules ?? [];
      const schedulePlan = workflowVersion === 2
        ? this.normalizeSchedulePlan({
            type: nextType,
            startDate,
            endDate,
            scoringFrequency: dto.scoringFrequency ?? cycle.scoringFrequency,
            schedules: dto.periodSchedules ?? (scheduleStructureChanged
              ? undefined
              : storedSchedules.map((schedule) => ({
                  periodKey: schedule.periodKey,
                  selfEvalOpenAt: schedule.selfEvalOpenAt,
                  selfEvalDueAt: schedule.selfEvalDueAt,
                  managerDueAt: schedule.managerDueAt,
                  isException: schedule.isException,
                }))),
          })
        : null;
      const nextScoringFrequency = schedulePlan?.scoringFrequency ?? ScoringFrequency.cycle;
      const changedPeriodKeys = this.changedPeriodKeys(storedSchedules, schedulePlan?.schedules ?? []);
      const scheduleChanged = changedPeriodKeys.length > 0;
      const coreTimingChanged = workflowVersion !== (cycle.workflowVersion ?? 1)
        || nextScoringFrequency !== (cycle.scoringFrequency ?? ScoringFrequency.cycle)
        || scheduleChanged;

      const nextMonthlyFollowUpRequired = ['quarterly', 'semiannual', 'annual'].includes(nextType)
        ? dto.monthlyFollowUpRequired ?? cycle.monthlyFollowUpRequired
        : false;
      const nextParticipantDeptIds = dto.participantDeptIds !== undefined
        ? this.normalizeIdSet(dto.participantDeptIds)
        : this.normalizeIdSet(cycle.participantDeptIds);
      const nextParticipantUserIds = dto.participantUserIds !== undefined
        ? this.normalizeIdSet(dto.participantUserIds)
        : this.normalizeIdSet(cycle.participantUserIds);
      const nextExplicitExemptDeptIds = dto.explicitExemptDeptIds !== undefined
        ? this.normalizeIdSet(dto.explicitExemptDeptIds)
        : this.normalizeIdSet(cycle.explicitExemptDeptIds);
      const nextExplicitExemptUserIds = dto.explicitExemptUserIds !== undefined
        ? this.normalizeIdSet(dto.explicitExemptUserIds)
        : this.normalizeIdSet(cycle.explicitExemptUserIds);

      const data: Prisma.AssessmentCycleUncheckedUpdateManyInput = {};
      if (dto.name !== undefined && dto.name !== cycle.name) data.name = dto.name;
      if (dto.type !== undefined && dto.type !== cycle.type) data.type = dto.type;
      if (dto.startDate !== undefined && businessDateKey(startDate) !== businessDateKey(cycle.startDate)) {
        data.startDate = startDate;
      }
      if (dto.endDate !== undefined && businessDateKey(endDate) !== businessDateKey(cycle.endDate)) {
        data.endDate = endDate;
      }
      if (dto.goalSettingOpenAt !== undefined && !this.sameInstant(dto.goalSettingOpenAt, cycle.goalSettingOpenAt)) {
        data.goalSettingOpenAt = dto.goalSettingOpenAt;
      }
      if (dto.selfEvalOpenAt !== undefined && !this.sameInstant(dto.selfEvalOpenAt, cycle.selfEvalOpenAt)) {
        data.selfEvalOpenAt = dto.selfEvalOpenAt;
      }
      if (workflowVersion !== (cycle.workflowVersion ?? 1)) data.workflowVersion = workflowVersion;
      if (nextScoringFrequency !== (cycle.scoringFrequency ?? ScoringFrequency.cycle)) {
        data.scoringFrequency = nextScoringFrequency;
      }
      if (dto.notificationMode !== undefined && dto.notificationMode !== cycle.notificationMode) {
        data.notificationMode = dto.notificationMode;
      }
      if (hrOwnerId !== cycle.hrOwnerId) data.hrOwnerId = hrOwnerId;
      if (reviewerId !== cycle.reviewerId) data.reviewerId = reviewerId;
      if (nextMonthlyFollowUpRequired !== cycle.monthlyFollowUpRequired) {
        data.monthlyFollowUpRequired = nextMonthlyFollowUpRequired;
      }
      if (!this.sameIdSet(nextParticipantDeptIds, cycle.participantDeptIds)) data.participantDeptIds = nextParticipantDeptIds;
      if (!this.sameIdSet(nextParticipantUserIds, cycle.participantUserIds)) data.participantUserIds = nextParticipantUserIds;
      if (!this.sameIdSet(nextExplicitExemptDeptIds, cycle.explicitExemptDeptIds)) {
        data.explicitExemptDeptIds = nextExplicitExemptDeptIds;
      }
      if (!this.sameIdSet(nextExplicitExemptUserIds, cycle.explicitExemptUserIds)) {
        data.explicitExemptUserIds = nextExplicitExemptUserIds;
      }
      if (dto.publishVisibleFields !== undefined && !this.sameJson(dto.publishVisibleFields, cycle.publishVisibleFields)) {
        data.publishVisibleFields = dto.publishVisibleFields;
      }
      if (dto.gradeAMaxRatio !== undefined && !this.sameDecimal(dto.gradeAMaxRatio, cycle.gradeAMaxRatio)) {
        data.gradeAMaxRatio = new Prisma.Decimal(dto.gradeAMaxRatio);
      }
      if (dto.gradeBMaxRatio !== undefined && !this.sameDecimal(dto.gradeBMaxRatio, cycle.gradeBMaxRatio)) {
        data.gradeBMaxRatio = new Prisma.Decimal(dto.gradeBMaxRatio);
      }
      if (dto.gradeCMaxRatio !== undefined && !this.sameDecimal(dto.gradeCMaxRatio, cycle.gradeCMaxRatio)) {
        data.gradeCMaxRatio = new Prisma.Decimal(dto.gradeCMaxRatio);
      }
      if (dto.gradeDMaxRatio !== undefined && !this.sameDecimal(dto.gradeDMaxRatio, cycle.gradeDMaxRatio)) {
        data.gradeDMaxRatio = new Prisma.Decimal(dto.gradeDMaxRatio);
      }
      if (dto.deadlineIndicatorSetting !== undefined
        && !this.sameInstant(dto.deadlineIndicatorSetting, cycle.deadlineIndicatorSetting)) {
        data.deadlineIndicatorSetting = dto.deadlineIndicatorSetting;
      }
      if (dto.deadlineIndicatorConfirm !== undefined
        && !this.sameInstant(dto.deadlineIndicatorConfirm, cycle.deadlineIndicatorConfirm)) {
        data.deadlineIndicatorConfirm = dto.deadlineIndicatorConfirm;
      }
      if (dto.deadlineSelfEval !== undefined && !this.sameInstant(dto.deadlineSelfEval, cycle.deadlineSelfEval)) {
        data.deadlineSelfEval = dto.deadlineSelfEval;
      }
      if (dto.deadlineManagerScore !== undefined
        && !this.sameInstant(dto.deadlineManagerScore, cycle.deadlineManagerScore)) {
        data.deadlineManagerScore = dto.deadlineManagerScore;
      }
      if (dto.deadlineHrCalibration !== undefined
        && !this.sameInstant(dto.deadlineHrCalibration, cycle.deadlineHrCalibration)) {
        data.deadlineHrCalibration = dto.deadlineHrCalibration;
      }
      if (dto.deadlineApproval !== undefined && !this.sameInstant(dto.deadlineApproval, cycle.deadlineApproval)) {
        data.deadlineApproval = dto.deadlineApproval;
      }
      if (dto.deadlinePublish !== undefined && !this.sameInstant(dto.deadlinePublish, cycle.deadlinePublish)) {
        data.deadlinePublish = dto.deadlinePublish;
      }

      const businessChanged = Object.keys(data).length > 0 || scheduleChanged;
      if (!businessChanged) {
        const claim = await tx.assessmentCycle.updateMany({
          where: { id, status: CycleStatus.draft, planVersion: dto.expectedPlanVersion },
          data: { planVersion: { increment: 0 } },
        });
        if (claim.count !== 1) throw this.stalePlanConflict();
        const unchanged = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
        if (!unchanged) throw this.stalePlanConflict();
        return this.withPlanFields(unchanged, schedulePlan?.warnings ?? []);
      }

      data.planVersion = { increment: 1 };
      data.reviewStatus = 'pending';
      data.reviewedAt = null;
      data.reviewComment = null;
      const claim = await tx.assessmentCycle.updateMany({
        where: { id, status: CycleStatus.draft, planVersion: dto.expectedPlanVersion },
        data,
      });
      if (claim.count !== 1) throw this.stalePlanConflict();

      if (scheduleChanged) {
        await tx.cyclePeriodSchedule.deleteMany({ where: { cycleId: id } });
        if (schedulePlan?.schedules.length) {
          await tx.cyclePeriodSchedule.createMany({
            data: schedulePlan.schedules.map((schedule) => ({
              cycleId: id,
              ...this.scheduleCreateData(schedule),
            })),
          });
        }
      }
      if (coreTimingChanged) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'cycle_scoring_plan_updated',
            entityType: 'assessment_cycle',
            entityId: id,
            oldValue: {
              scoringFrequency: cycle.scoringFrequency ?? ScoringFrequency.cycle,
              changedPeriodKeys,
            },
            newValue: {
              scoringFrequency: nextScoringFrequency,
              changedPeriodKeys,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_draft_updated',
          entityType: 'assessment_cycle',
          entityId: id,
          newValue: { name: dto.name ?? cycle.name, type: nextType, status: cycle.status },
        },
      });
      const updated = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
      if (!updated) throw this.stalePlanConflict();
      return this.withPlanFields(updated, schedulePlan?.warnings ?? []);
    });
  }

  /** GET /cycles — 查询周期列表。 */
  async findAll(query: CycleQueryDto, viewer: AuthUser) {
    const canManageCycles = viewer.sysRole === SysRole.hr
      || viewer.sysRole === SysRole.system_admin
      || hasHrCapability(viewer, 'cycle_plan_edit')
      || hasHrCapability(viewer, 'cycle_plan_review');
    const visibleTaskWhere = this.visibleTaskWhere(viewer);
    const where: Prisma.AssessmentCycleWhereInput = {
      ...(query.status && { status: query.status }),
      ...(!query.status && query.group && { status: { in: CYCLE_STATUS_GROUPS[query.group] } }),
      ...(!canManageCycles && { status: { notIn: ['draft', 'scheduled', 'launch_blocked'] } }),
      ...(!canManageCycles && { tasks: { some: visibleTaskWhere } }),
      ...(query.type && { type: query.type }),
      ...(query.keyword
        ? { name: { contains: query.keyword, mode: 'insensitive' } }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.assessmentCycle.count({ where }),
      this.prisma.assessmentCycle.findMany({
        where,
        skip: query.skip,
        take: query.take,
        include: CYCLE_PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return paginated(items.map((cycle) => this.withPlanFields(cycle)), total, query);
  }

  /** GET /cycles/mine — 查看已开放且与本人或直属团队任务相关的周期。 */
  async findMine(viewer: AuthUser) {
    const visibleTaskWhere = this.visibleTaskWhere(viewer);
    return this.prisma.assessmentCycle.findMany({
      where: {
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: { some: visibleTaskWhere },
      },
      include: {
        tasks: {
          where: visibleTaskWhere,
          select: { id: true, status: true, isExempt: true },
          take: 1,
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /** GET /cycles/:id — 周期详情。 */
  async findOne(id: string, viewer?: AuthUser) {
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
        ...CYCLE_PLAN_INCLUDE,
      },
    });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    const canManageCycles = !viewer
      || viewer.sysRole === SysRole.hr
      || viewer.sysRole === SysRole.system_admin
      || hasHrCapability(viewer, 'cycle_plan_edit')
      || hasHrCapability(viewer, 'cycle_plan_review');
    if (!canManageCycles && ['draft', 'scheduled', 'launch_blocked'].includes(cycle.status)) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看尚未发起的周期' });
    }

    if (!canManageCycles) {
      const visibleTaskWhere = this.visibleTaskWhere(viewer!);
      const hasVisibleTask = await this.prisma.assessmentTask.count({
        where: { cycleId: id, ...visibleTaskWhere },
      });
      if (hasVisibleTask === 0) {
        throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该周期' });
      }
    }

    const taskWhere: Prisma.AssessmentTaskWhereInput = canManageCycles
      ? { cycleId: id }
      : { cycleId: id, ...this.visibleTaskWhere(viewer!) };

    const [snapshotCount, totalTasks, taskStatusCounts] = await Promise.all([
      this.prisma.assessmentTemplateSnapshot.count({ where: { cycleId: id } }),
      this.prisma.assessmentTask.count({ where: taskWhere }),
      this.prisma.assessmentTask.groupBy({
        by: ['status'],
        where: taskWhere,
        _count: { _all: true },
      }),
    ]);

    const byStatus = Object.fromEntries(taskStatusCounts.map((item) => [item.status, item._count._all]));
    const count = (...statuses: string[]) => statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
    const unsubmitted = count('pending', 'indicator_drafting');
    const pendingManagerReview = count('indicator_reviewing', 'indicator_setting');
    const pendingEmployeeConfirmation = count('indicator_confirming');
    const exempted = count('exempted');
    const goalCompleted = Math.max(0, totalTasks - exempted - unsubmitted - pendingManagerReview - pendingEmployeeConfirmation);
    const overdue = (
      cycle.deadlineIndicatorSetting && cycle.deadlineIndicatorSetting < new Date()
        ? unsubmitted + pendingManagerReview
        : 0
    ) + (
      cycle.deadlineIndicatorConfirm && cycle.deadlineIndicatorConfirm < new Date()
        ? pendingEmployeeConfirmation
        : 0
    );

    return {
      ...cycle,
      reviewFrequency: 'cycle' as const,
      snapshotCount,
      taskStats: {
        total: totalTasks,
        unsubmitted,
        pendingManagerReview,
        pendingEmployeeConfirmation,
        goalCompleted,
        exempted,
        overdue,
        byStatus,
      },
    };
  }

  /** PATCH /cycles/:id/deadlines — 只能延期不能提前。 */
  async updateDeadlines(id: string, dto: UpdateDeadlinesDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (['scheduled', 'launch_blocked'].includes(cycle.status)) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '周期已预约发起，修改截止时间前请先取消预约',
        });
      }
      if (cycle.planVersion !== dto.expectedPlanVersion) throw this.stalePlanConflict();

      this.validateDeadlinePostponement(cycle, dto);
      const data: Prisma.AssessmentCycleUpdateManyMutationInput = {};
      for (const field of DEADLINE_FIELDS) {
        if (dto[field] !== undefined && !this.sameInstant(dto[field], cycle[field])) data[field] = dto[field];
      }
      if (Object.keys(data).length === 0) {
        const unchanged = await tx.assessmentCycle.updateMany({
          where: { id, status: cycle.status, planVersion: dto.expectedPlanVersion },
          data: { planVersion: { increment: 0 } },
        });
        if (unchanged.count !== 1) throw this.stalePlanConflict();
        const current = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
        if (!current) throw this.stalePlanConflict();
        return this.withPlanFields(current);
      }
      data.planVersion = { increment: 1 };
      if (cycle.status === CycleStatus.draft) {
        data.reviewStatus = 'pending';
        data.reviewedAt = null;
        data.reviewComment = null;
      }
      const write = await tx.assessmentCycle.updateMany({
        where: { id, status: cycle.status, planVersion: dto.expectedPlanVersion },
        data,
      });
      if (write.count !== 1) throw this.stalePlanConflict();
      const updated = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
      if (!updated) throw this.stalePlanConflict();
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_deadlines_updated',
          entityType: 'assessment_cycle',
          entityId: id,
          oldValue: Object.fromEntries(DEADLINE_FIELDS.map((field) => [field, cycle[field]])) as Prisma.InputJsonValue,
          newValue: Object.fromEntries(DEADLINE_FIELDS.map((field) => [field, updated[field]])) as Prisma.InputJsonValue,
        },
      });
      return this.withPlanFields(updated);
    });
  }

  private normalizeSchedulePlan(
    input: Parameters<CycleScheduleService['normalizeAndValidate']>[0],
  ): NormalizedCycleSchedulePlan {
    const plan = this.cycleScheduleService.normalizeAndValidate(input);
    if (plan.blockers.length > 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '评分排期存在阻断项，请调整后重试',
        blockers: plan.blockers,
      });
    }
    return plan;
  }

  private scheduleCreateData(schedule: NormalizedCycleSchedulePlan['schedules'][number]) {
    return {
      periodKey: schedule.periodKey,
      periodType: schedule.periodType,
      sequence: schedule.sequence,
      periodStart: schedule.periodStart,
      periodEnd: schedule.periodEnd,
      selfEvalOpenAt: schedule.selfEvalOpenAt,
      selfEvalDueAt: schedule.selfEvalDueAt,
      managerDueAt: schedule.managerDueAt,
      isException: schedule.isException,
    };
  }

  private changedPeriodKeys(
    stored: Array<{
      periodKey: string;
      periodType: string;
      sequence: number;
      periodStart: Date;
      periodEnd: Date;
      selfEvalOpenAt: Date;
      selfEvalDueAt: Date;
      managerDueAt: Date;
      isException: boolean;
    }>,
    next: NormalizedCycleSchedulePlan['schedules'],
  ): string[] {
    const storedByKey = new Map(stored.map((schedule) => [schedule.periodKey, this.scheduleSignature(schedule)]));
    const nextByKey = new Map(next.map((schedule) => [schedule.periodKey, this.scheduleSignature(schedule)]));
    return [...new Set([...storedByKey.keys(), ...nextByKey.keys()])]
      .filter((periodKey) => storedByKey.get(periodKey) !== nextByKey.get(periodKey))
      .sort();
  }

  private scheduleSignature(schedule: {
    periodType: string;
    sequence: number;
    periodStart: Date;
    periodEnd: Date;
    selfEvalOpenAt: Date;
    selfEvalDueAt: Date;
    managerDueAt: Date;
    isException: boolean;
  }): string {
    return JSON.stringify([
      schedule.periodType,
      schedule.sequence,
      businessDateKey(schedule.periodStart),
      businessDateKey(schedule.periodEnd),
      schedule.selfEvalOpenAt.toISOString(),
      schedule.selfEvalDueAt.toISOString(),
      schedule.managerDueAt.toISOString(),
      schedule.isException,
    ]);
  }

  private normalizeIdSet(values: readonly string[] | null | undefined): string[] {
    return [...new Set(values ?? [])].sort();
  }

  private sameIdSet(left: readonly string[] | null | undefined, right: readonly string[] | null | undefined): boolean {
    return JSON.stringify(this.normalizeIdSet(left)) === JSON.stringify(this.normalizeIdSet(right));
  }

  private sameInstant(left: Date | null | undefined, right: Date | null | undefined): boolean {
    if (left == null || right == null) return left == null && right == null;
    return left.getTime() === right.getTime();
  }

  private sameDecimal(left: number | Prisma.Decimal, right: number | Prisma.Decimal): boolean {
    return new Prisma.Decimal(left).equals(new Prisma.Decimal(right));
  }

  private sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(this.canonicalJson(left)) === JSON.stringify(this.canonicalJson(right));
  }

  private canonicalJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonicalJson(item));
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Prisma.Decimal)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.canonicalJson(item)]),
      );
    }
    return value;
  }

  private stalePlanConflict(): ConflictException {
    return new ConflictException({
      code: ERROR_CODE.CONFLICT,
      message: '周期计划已被其他人修改、审核或发起，请刷新后重试',
    });
  }

  private withPlanFields<T extends object>(
    cycle: T,
    scheduleWarnings?: NormalizedCycleSchedulePlan['warnings'],
  ): T & { reviewFrequency: 'cycle'; scheduleWarnings?: NormalizedCycleSchedulePlan['warnings'] } {
    return {
      ...cycle,
      reviewFrequency: 'cycle',
      ...(scheduleWarnings !== undefined && { scheduleWarnings }),
    };
  }

  private async resolveCompanyFinalApproverId(
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const config = await tx.systemConfig.findUnique({
      where: { key: 'performance_company_final_approver' },
    });
    const value = config?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const userId = (value as Prisma.JsonObject).userId;
    if (typeof userId !== 'string' || !userId.trim()) return null;

    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'active' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async resolveReviewerId(requestedId?: string): Promise<string> {
    const reviewer = requestedId
      ? await this.prisma.user.findFirst({
        where: { id: requestedId, sysRole: SysRole.hr, deletedAt: null, status: { not: 'resigned' } },
        select: { id: true },
      })
      : await this.prisma.user.findFirst({
        where: { sysRole: SysRole.hr, deletedAt: null, status: { not: 'resigned' } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    if (!reviewer) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请选择一名在职 HR 管理员作为审核人' });
    }
    return reviewer.id;
  }

  async review(id: string, dto: ReviewCycleDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
      if (!cycle) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      if (cycle.status !== CycleStatus.draft) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '只有草稿周期可以审核' });
      }
      if (cycle.reviewerId && cycle.reviewerId !== user.id) {
        throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅本周期审核人可以审核' });
      }
      if (!cycle.reviewerId && user.sysRole !== SysRole.hr) {
        throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 管理员可以审核待分配的周期计划' });
      }
      if (cycle.planVersion !== dto.expectedPlanVersion) throw this.stalePlanConflict();
      const reviewStatus = dto.action === 'approve' ? 'approved' : 'rejected';
      const claim = await tx.assessmentCycle.updateMany({
        where: {
          id,
          status: CycleStatus.draft,
          planVersion: dto.expectedPlanVersion,
          reviewerId: cycle.reviewerId,
          reviewStatus: cycle.reviewStatus,
          reviewedAt: cycle.reviewedAt,
        },
        data: {
          planVersion: { increment: 1 },
          reviewerId: user.id,
          reviewStatus,
          reviewedAt: new Date(),
          reviewComment: dto.comment?.trim() || null,
        },
      });
      if (claim.count !== 1) throw this.stalePlanConflict();
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `cycle_review_${dto.action}`,
          entityType: 'assessment_cycle',
          entityId: id,
          newValue: { reviewStatus, comment: dto.comment?.trim() || null },
        },
      });
      const updated = await tx.assessmentCycle.findUnique({ where: { id }, include: CYCLE_PLAN_INCLUDE });
      if (!updated) throw this.stalePlanConflict();
      return this.withPlanFields(updated);
    });
  }

  private async resolveHrOwnerId(requestedId: string | undefined, operator: AuthUser): Promise<string> {
    const operatorIsEligibleOwner = operator.sysRole === SysRole.hr
      || (operator.sysRole === SysRole.hr_user && hasHrCapability(operator, 'cycle_plan_edit'));
    if (!requestedId && operatorIsEligibleOwner) {
      return operator.id;
    }
    const eligibleOwnerWhere: Prisma.UserWhereInput = {
      OR: [
        { sysRole: SysRole.hr },
        { sysRole: SysRole.hr_user, hrCapabilities: { has: 'cycle_plan_edit' } },
      ],
      deletedAt: null,
      status: { not: 'resigned' },
    };
    const owner = requestedId
      ? await this.prisma.user.findFirst({
          where: { id: requestedId, ...eligibleOwnerWhere },
          select: { id: true },
        })
      : await this.prisma.user.findFirst({
          where: eligibleOwnerWhere,
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
    if (!owner) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请选择一名在职 HR 作为本周期负责人',
      });
    }
    return owner.id;
  }

  /** 周期可见性按任务中保存的实际业务身份判断，不依赖单一系统角色。 */
  private visibleTaskWhere(viewer: AuthUser): Prisma.AssessmentTaskWhereInput {
    return {
      OR: [
        { employeeId: viewer.id },
        { managerId: viewer.id },
        { deptHeadId: viewer.id },
        { approverId: viewer.id },
      ],
    };
  }

  /** 校验考核期间本身与时间节点的业务顺序；节点可跨越考核期间边界。 */
  private validateCycleDates(
    dto: CreateCycleDto,
    goalSettingOpenAt: Date,
    selfEvalOpenAt: Date,
  ): void {
    if (dto.endDate <= dto.startDate) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '结束日期必须晚于开始日期',
      });
    }

    const goalDeadlines = [
      goalSettingOpenAt,
      dto.deadlineIndicatorSetting,
      dto.deadlineIndicatorConfirm,
    ].filter((date): date is Date => date != null);
    this.assertNonDecreasing(goalDeadlines, '目标制定开放、提交和确认时间需按流程顺序递增');

    const evaluationDeadlines = [
      selfEvalOpenAt,
      dto.deadlineSelfEval,
      dto.deadlineManagerScore,
      dto.deadlineHrCalibration,
      dto.deadlineApproval,
      dto.deadlinePublish,
    ].filter((date): date is Date => date != null);
    this.assertNonDecreasing(evaluationDeadlines, '自评开放后各节点截止日需按流程顺序递增');
  }

  /** 校验延期：每个新截止日 ≥ 原值，且结果序列仍递增。 */
  private validateDeadlinePostponement(cycle: any, dto: UpdateDeadlinesDto): void {
    for (const field of DEADLINE_FIELDS) {
      const newValue = dto[field];
      const oldValue = cycle[field] as Date | null;
      if (newValue == null) continue;

      if (oldValue != null && newValue < oldValue) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '节点截止日只能延期，不能提前',
        });
      }
    }

    const merged = DEADLINE_FIELDS.map((field) => dto[field] ?? cycle[field])
      .filter((d): d is Date => d != null);

    this.assertNonDecreasing(merged, '调整后各节点截止日需保持递增');
  }

  private assertNonDecreasing(dates: Date[], message: string): void {
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] < dates[i - 1]) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
      }
    }
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
}
