import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CycleStatus, Prisma, SysRole } from '@prisma/client';
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

@Injectable()
export class CyclesService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /cycles — 创建考核周期。 */
  async create(dto: CreateCycleDto, user: AuthUser) {
    const goalSettingOpenAt = dto.goalSettingOpenAt ?? this.addDays(dto.startDate, -10);
    const selfEvalOpenAt = dto.selfEvalOpenAt ?? this.addDays(dto.endDate, 1);
    this.validateCycleDates(dto, goalSettingOpenAt, selfEvalOpenAt);
    const reviewerId = await this.resolveReviewerId(dto.reviewerId);

    const data: Prisma.AssessmentCycleCreateInput = {
      name: dto.name,
      type: dto.type,
      startDate: dto.startDate,
      endDate: dto.endDate,
      goalSettingOpenAt,
      selfEvalOpenAt,
      reviewer: { connect: { id: reviewerId } },
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
      hrOwner: { connect: { id: user.id } },
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

    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.create({ data });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_created',
          entityType: 'assessment_cycle',
          entityId: cycle.id,
          newValue: { name: dto.name, type: dto.type, status: 'draft' },
        },
      });
      return cycle;
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
      const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (cycle.status !== CycleStatus.draft) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '仅草稿状态的周期可以编辑完整计划',
        });
      }

      const goalSettingOpenAt = dto.goalSettingOpenAt ?? cycle.goalSettingOpenAt;
      const selfEvalOpenAt = dto.selfEvalOpenAt ?? cycle.selfEvalOpenAt;
      const startDate = dto.startDate ?? cycle.startDate;
      const endDate = dto.endDate ?? cycle.endDate;
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

      const reviewerId = dto.reviewerId !== undefined
        ? await this.resolveReviewerId(dto.reviewerId)
        : cycle.reviewerId;

      const data: Prisma.AssessmentCycleUpdateInput = {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate }),
        ...(dto.goalSettingOpenAt !== undefined && { goalSettingOpenAt: dto.goalSettingOpenAt }),
        ...(dto.selfEvalOpenAt !== undefined && { selfEvalOpenAt: dto.selfEvalOpenAt }),
        ...(dto.notificationMode !== undefined && { notificationMode: dto.notificationMode }),
        ...(reviewerId && { reviewer: { connect: { id: reviewerId } } }),
        ...(dto.monthlyFollowUpRequired !== undefined && {
          monthlyFollowUpRequired: ['quarterly', 'semiannual', 'annual'].includes(dto.type ?? cycle.type)
            ? dto.monthlyFollowUpRequired
            : false,
        }),
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewComment: null,
        ...(dto.participantDeptIds !== undefined && { participantDeptIds: dto.participantDeptIds }),
        ...(dto.participantUserIds !== undefined && { participantUserIds: dto.participantUserIds }),
        ...(dto.explicitExemptDeptIds !== undefined && { explicitExemptDeptIds: dto.explicitExemptDeptIds }),
        ...(dto.explicitExemptUserIds !== undefined && { explicitExemptUserIds: dto.explicitExemptUserIds }),
        ...(dto.publishVisibleFields !== undefined && { publishVisibleFields: dto.publishVisibleFields }),
        ...(dto.gradeAMaxRatio !== undefined && { gradeAMaxRatio: new Prisma.Decimal(dto.gradeAMaxRatio) }),
        ...(dto.gradeBMaxRatio !== undefined && { gradeBMaxRatio: new Prisma.Decimal(dto.gradeBMaxRatio) }),
        ...(dto.gradeCMaxRatio !== undefined && { gradeCMaxRatio: new Prisma.Decimal(dto.gradeCMaxRatio) }),
        ...(dto.gradeDMaxRatio !== undefined && { gradeDMaxRatio: new Prisma.Decimal(dto.gradeDMaxRatio) }),
        ...(dto.deadlineIndicatorSetting !== undefined && { deadlineIndicatorSetting: dto.deadlineIndicatorSetting }),
        ...(dto.deadlineIndicatorConfirm !== undefined && { deadlineIndicatorConfirm: dto.deadlineIndicatorConfirm }),
        ...(dto.deadlineSelfEval !== undefined && { deadlineSelfEval: dto.deadlineSelfEval }),
        ...(dto.deadlineManagerScore !== undefined && { deadlineManagerScore: dto.deadlineManagerScore }),
        ...(dto.deadlineHrCalibration !== undefined && { deadlineHrCalibration: dto.deadlineHrCalibration }),
        ...(dto.deadlineApproval !== undefined && { deadlineApproval: dto.deadlineApproval }),
        ...(dto.deadlinePublish !== undefined && { deadlinePublish: dto.deadlinePublish }),
      };

      const updated = await tx.assessmentCycle.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'cycle_draft_updated',
          entityType: 'assessment_cycle',
          entityId: id,
          newValue: { name: updated.name, type: updated.type, status: updated.status },
        },
      });
      return updated;
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
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return paginated(items, total, query);
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
      const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (['scheduled', 'launch_blocked'].includes(cycle.status)) {
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '周期已预约发起，修改截止时间前请先取消预约',
        });
      }

      this.validateDeadlinePostponement(cycle, dto);
      const data: Prisma.AssessmentCycleUpdateManyMutationInput = {};
      for (const field of DEADLINE_FIELDS) {
        if (dto[field] !== undefined) data[field] = dto[field];
      }
      const write = await tx.assessmentCycle.updateMany({
        where: { id, status: cycle.status },
        data,
      });
      if (write.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '周期状态已变化，请刷新后重试',
        });
      }
      const updated = await tx.assessmentCycle.findUniqueOrThrow({ where: { id } });
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
      return updated;
    });
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
      const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      if (cycle.status !== CycleStatus.draft) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '只有草稿周期可以审核' });
      }
      if (cycle.reviewerId !== user.id && user.sysRole !== SysRole.system_admin) {
        throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅本周期审核人可以审核' });
      }
      const reviewStatus = dto.action === 'approve' ? 'approved' : 'rejected';
      const updated = await tx.assessmentCycle.update({
        where: { id },
        data: { reviewStatus, reviewedAt: new Date(), reviewComment: dto.comment?.trim() || null },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `cycle_review_${dto.action}`,
          entityType: 'assessment_cycle',
          entityId: id,
          newValue: { reviewStatus, comment: dto.comment?.trim() || null },
        },
      });
      return updated;
    });
  }

  private async resolveHrOwnerId(requestedId: string | undefined, operator: AuthUser): Promise<string> {
    if (!requestedId && operator.sysRole === SysRole.hr) return operator.id;
    const owner = requestedId
      ? await this.prisma.user.findFirst({
          where: { id: requestedId, sysRole: SysRole.hr, deletedAt: null, status: { not: 'resigned' } },
          select: { id: true },
        })
      : await this.prisma.user.findFirst({
          where: { sysRole: SysRole.hr, deletedAt: null, status: { not: 'resigned' } },
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
