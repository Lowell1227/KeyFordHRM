import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssessmentPeriodStatus, AssessmentPeriodType, AssessmentTask, IndicatorInstance, IndicatorVisibilityScope, ObjectiveLevel, Prisma, SysRole, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { NotificationsService, TaskReminderNodeType } from '@/notifications/notifications.service';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { Paginated, paginated } from '@/common/dto/pagination.dto';
import { ScoringService } from './scoring.service';
import { FlowService } from './flow.service';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateActualValueDto } from './dto/update-actual-value.dto';
import { SubmitSelfEvalDto } from './dto/submit-self-eval.dto';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';
import { SaveManagerEvaluationDraftDto } from './dto/save-manager-evaluation-draft.dto';
import { WithdrawManagerScoreDto } from './dto/withdraw-manager-score.dto';
import { DeptReviewDto } from './dto/dept-review.dto';
import { SubmitIndicatorProposalDto } from './dto/submit-indicator-proposal.dto';
import { SetIndicatorItemDto, SetIndicatorsDto } from './dto/set-indicators.dto';
import { ObjectivesService } from '@/objectives/objectives.service';
import { IndicatorReferenceItem, IndicatorVisibilityService } from './indicator-visibility.service';
import { ReferenceIndicatorQueryDto } from './dto/reference-indicator-query.dto';
import { assertTaskVersion, claimTaskVersion } from './task-version';
import { IndicatorVersionService } from './indicator-version.service';

type IndicatorBaselineSource = IndicatorInstance & {
  visibleDepartments: Array<{ departmentId: string }>;
  visibleUsers: Array<{ userId: string }>;
  objectiveAlignments: Array<{ objectiveId: string }>;
};

/** 任务列表项。 */
export interface TaskListItem {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  deptId: string | null;
  deptName: string | null;
  managerId: string | null;
  status: TaskStatus;
  isExempt: boolean;
  exemptReason: string | null;
  totalScore: number | null;
  rawGrade: string | null;
  updatedAt: Date;
}

/** 任务详情。 */
export interface TaskDetail extends TaskListItem {
  workflowVersion: number;
  employeeNo: string | null;
  managerName: string | null;
  periods: Array<{
    id: string;
    periodKey: string;
    periodType: AssessmentPeriodType;
    sequence: number;
    status: AssessmentPeriodStatus;
    selfEvalOpenAt: Date;
    selfEvalDueAt: Date;
    managerDueAt: Date;
    employeeSubmittedAt: Date | null;
    managerSubmittedAt: Date | null;
  }>;
  workflowContext: TaskWorkflowContext;
  managerScoredAt: Date | null;
  indicatorInstances: Array<{
    id: string;
    name: string;
    description: string | null;
    scoringStandard: string | null;
    dataSource: string | null;
    dataCaliber: string | null;
    targetValue: number | null;
    targetValueText: string | null;
    unit: string | null;
    weight: number;
    indicatorType: string;
    dimensionName: string | null;
    dimensionWeight: number;
    actualValue: string | null;
    actualNote: string | null;
    selfScore: number | null;
    selfComment: string | null;
    managerScore: number | null;
    managerComment: string | null;
    extraScores: Array<{ label: string; value: number }>;
    finalScore: number | null;
    sortOrder: number;
    visibilityScope: IndicatorVisibilityScope;
    visibleDepartmentIds: string[];
    visibleUserIds: string[];
    alignedObjectives: Array<{
      id: string;
      title: string;
      level: ObjectiveLevel;
      ownerId: string | null;
    }>;
  }>;
  selfEvalSummary: {
    achievements: string | null;
    improvements: string | null;
    suggestions: string | null;
    nextGoals: string | null;
    supportNeeded: string | null;
    attachments: unknown;
    submittedAt: Date | null;
  } | null;
  managerEvalSummary: {
    strengths: string | null;
    improvements: string | null;
    developmentPlan: string | null;
    attachments: unknown;
    submittedAt: Date | null;
  } | null;
  gradeResult: {
    calculatedScore: number | null;
    rawGrade: string | null;
    calibratedGrade: string | null;
    coefficient: number | null;
    isVeto: boolean;
    vetoReason: string | null;
    vetoOperatorId: string | null;
    vetoOperatorName: string | null;
    isPublished: boolean;
    employeeConfirmedAt: Date | null;
  } | null;
  performanceInterview: {
    id: string;
    status: string;
    interviewTime: Date | null;
    location: string | null;
    method: string | null;
    scoreInformed: boolean;
    achievements: string | null;
    weaknesses: string | null;
    nextGoals: string | null;
    remediation: string | null;
    supportNeeded: string | null;
    otherMatters: string | null;
    deadline: Date | null;
    managerSignedAt: Date | null;
    employeeSignedAt: Date | null;
  } | null;
  flowRecords: Array<{
    id: string;
    taskId: string;
    cycleId: string;
    nodeType: string;
    action: string;
    actorId: string | null;
    actorName: string | null;
    comment: string | null;
    extraData: Prisma.JsonValue | null;
    createdAt: Date;
  }>;
}

export interface TaskWorkflowContext {
  stage: 'goal_setting' | 'self_eval' | 'review' | 'result' | 'completed';
  statusLabel: string;
  currentHandler: {
    id: string;
    name: string;
    nodeType: TaskReminderNodeType;
  } | null;
  currentDeadline: Date | null;
  canRemind: boolean;
  reminderNodeType: TaskReminderNodeType | null;
  reminderAvailableAt: Date | null;
}

/** D18 默认可见字段（与 schema 默认值保持一致）。 */
const DEFAULT_PUBLISH_VISIBLE_FIELDS: PublishVisibleFields = {
  total_score: true,
  grade: true,
  indicator_scores: true,
  manager_comment: true,
  coefficient: false,
};

interface PublishVisibleFields {
  total_score?: boolean;
  grade?: boolean;
  indicator_scores?: boolean;
  manager_comment?: boolean;
  coefficient?: boolean;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly scoringService: ScoringService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
    private readonly indicatorVisibility: IndicatorVisibilityService,
    private readonly objectivesService: ObjectivesService,
    private readonly indicatorVersionService: IndicatorVersionService,
  ) {}

  /** GET /tasks — 角色过滤 + 分页。 */
  async findAll(dto: TaskQueryDto, viewer: AuthUser): Promise<Paginated<TaskListItem>> {
    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);

    const where: Prisma.AssessmentTaskWhereInput = {};
    const employeeConditions: Prisma.UserWhereInput[] = [];

    if (Object.keys(scopeFilter).length > 0) {
      employeeConditions.push(scopeFilter);
    }

    if (dto.keyword) {
      employeeConditions.push({
        name: { contains: dto.keyword, mode: 'insensitive' },
      });
    }

    if (employeeConditions.length > 0) {
      where.employee = employeeConditions.length === 1 ? employeeConditions[0] : { AND: employeeConditions };
    }

    if (dto.cycleId) {
      where.cycleId = dto.cycleId;
    }

    if (dto.status) {
      where.status = dto.status;
    }

    if (dto.deptId) {
      const subDeptIds = await this.dataScope.getSubDeptIds(dto.deptId);
      where.deptId = { in: subDeptIds };
    }

    const [total, tasks] = await Promise.all([
      this.prisma.assessmentTask.count({ where }),
      this.prisma.assessmentTask.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        include: {
          employee: { select: { name: true } },
          cycle: { select: { name: true } },
          dept: { select: { name: true } },
          gradeResult: { select: { calculatedScore: true, rawGrade: true } },
        },
        orderBy: [{ cycle: { startDate: 'desc' } }, { updatedAt: 'desc' }],
      }),
    ]);

    const items: TaskListItem[] = tasks.map((t) => ({
      id: t.id,
      cycleId: t.cycleId,
      cycleName: t.cycle?.name ?? '',
      employeeId: t.employeeId,
      employeeName: t.employee?.name ?? '',
      deptId: t.deptId,
      deptName: t.dept?.name ?? null,
      managerId: t.managerId,
      status: t.status,
      isExempt: t.isExempt,
      exemptReason: t.exemptReason,
      totalScore: t.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: t.gradeResult?.rawGrade ?? null,
      updatedAt: t.updatedAt,
    }));

    return paginated(items, total, dto);
  }

  /** GET /tasks/mine — 仅查看当前用户自己的考核任务。 */
  async findMine(dto: TaskQueryDto, viewer: AuthUser): Promise<Paginated<TaskListItem>> {
    const where: Prisma.AssessmentTaskWhereInput = { employeeId: viewer.id };

    if (dto.cycleId) {
      where.cycleId = dto.cycleId;
    }
    if (dto.status) {
      where.status = dto.status;
    }

    const [total, tasks] = await Promise.all([
      this.prisma.assessmentTask.count({ where }),
      this.prisma.assessmentTask.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        include: {
          employee: { select: { name: true } },
          cycle: { select: { name: true } },
          dept: { select: { name: true } },
          gradeResult: { select: { calculatedScore: true, rawGrade: true } },
        },
        orderBy: [{ cycle: { startDate: 'desc' } }, { updatedAt: 'desc' }],
      }),
    ]);

    const items: TaskListItem[] = tasks.map((t) => ({
      id: t.id,
      cycleId: t.cycleId,
      cycleName: t.cycle?.name ?? '',
      employeeId: t.employeeId,
      employeeName: t.employee?.name ?? '',
      deptId: t.deptId,
      deptName: t.dept?.name ?? null,
      managerId: t.managerId,
      status: t.status,
      isExempt: t.isExempt,
      exemptReason: t.exemptReason,
      totalScore: t.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: t.gradeResult?.rawGrade ?? null,
      updatedAt: t.updatedAt,
    }));

    return paginated(items, total, dto);
  }

  findReferenceIndicators(
    dto: ReferenceIndicatorQueryDto,
    viewer: AuthUser,
  ): Promise<Paginated<IndicatorReferenceItem>> {
    return this.indicatorVisibility.findVisibleReferences(dto, viewer);
  }

  /** GET /tasks/:id — 权限校验 + D18 遮蔽。 */
  async findOne(id: string, viewer: AuthUser): Promise<TaskDetail> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id },
      include: {
        employee: { select: { name: true, employeeNo: true } },
        dept: { select: { name: true } },
        manager: { select: { id: true, name: true } },
        deptHead: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        indicatorInstances: {
          orderBy: { sortOrder: 'asc' },
          include: {
            visibleDepartments: { select: { departmentId: true } },
            visibleUsers: { select: { userId: true } },
            objectiveAlignments: {
              include: {
                objective: {
                  select: { id: true, title: true, level: true, ownerId: true },
                },
              },
            },
          },
        },
        selfEvalSummary: true,
        managerEvalSummary: true,
        gradeResult: {
          include: { vetoOperator: { select: { id: true, name: true } } },
        },
        performanceInterview: true,
        periods: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            periodKey: true,
            periodType: true,
            sequence: true,
            status: true,
            selfEvalOpenAt: true,
            selfEvalDueAt: true,
            managerDueAt: true,
            employeeSubmittedAt: true,
            managerSubmittedAt: true,
          },
        },
        flowRecords: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { name: true } } },
        },
        cycle: {
          select: {
            name: true,
            workflowVersion: true,
            hrOwnerId: true,
            hrOwner: { select: { id: true, name: true } },
            publishVisibleFields: true,
            selfEvalOpenAt: true,
            deadlineIndicatorSetting: true,
            deadlineIndicatorConfirm: true,
            deadlineSelfEval: true,
            deadlineManagerScore: true,
            deadlineHrCalibration: true,
            deadlineApproval: true,
            deadlinePublish: true,
            deadlineAppeal: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核任务不存在' });
    }

    this.assertCanView(task, viewer);

    const alignedObjectiveIds = [
      ...new Set(
        task.indicatorInstances.flatMap((indicator) =>
          (indicator.objectiveAlignments ?? []).map((alignment) => alignment.objectiveId),
        ),
      ),
    ];
    const visibleObjectives = await this.objectivesService.findVisibleByIds(alignedObjectiveIds, viewer);
    const detail = this.buildTaskDetail(task, new Set(visibleObjectives.map((objective) => objective.id)));
    detail.workflowContext = await this.buildWorkflowContext(task, viewer);

    // D18：员工本人需区分公示前/公示后
    const isEmployee = viewer.id === task.employeeId;
    const isPublished = (['published', 'confirmed', 'appealing', 'closed'] as TaskStatus[]).includes(task.status);
    if (isEmployee && !isPublished) {
      // 公示前：无条件隐藏所有主管评估结果、总分、等级
      return this.applyPrePublishMask(detail);
    }
    if (isEmployee && isPublished) {
      // 公示后：按 cycle.publishVisibleFields 遮蔽
      const visibleFields = this.parsePublishVisibleFields(task.cycle.publishVisibleFields);
      return this.applyMask(detail, visibleFields);
    }

    return detail;
  }

  /** 催办当前非本人处理的环节，节点与收件人由后端根据任务状态唯一确定。 */
  async remindCurrentHandler(
    id: string,
    viewer: AuthUser,
  ): Promise<{ sent: true; nodeType: TaskReminderNodeType }> {
    const task = await this.getTaskOrThrow(id, {
      cycle: { select: { hrOwnerId: true, hrOwner: { select: { id: true, name: true } } } },
    }) as AssessmentTask & { cycle: { hrOwnerId: string | null; hrOwner: { id: string; name: string } | null } };
    this.assertCanView(task, viewer);

    const target = this.resolveReminderTarget(task);
    if (!target) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前状态无可催办处理人',
      });
    }
    if (!this.canViewerRemind(task, viewer, target.nodeType, target.handlerId)) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权催办该环节或不能催办自己',
      });
    }

    await this.notificationsService.sendTaskReminder(id, target.nodeType, viewer.id);
    return { sent: true, nodeType: target.nodeType };
  }

  /** POST /tasks/:id/indicators/confirm */
  async confirmIndicators(id: string, viewer: AuthUser): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id);
    this.assertEmployee(task, viewer);
    if (task.status !== 'indicator_confirming') {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '只有待员工确认指标时才能确认指标',
      });
    }

    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: task.cycleId },
      select: { selfEvalOpenAt: true, workflowVersion: true },
    });
    const now = new Date();
    const targetStatus: TaskStatus = !cycle?.selfEvalOpenAt || cycle.selfEvalOpenAt <= now
      ? 'self_eval'
      : 'goal_confirmed';
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assessmentTask.updateMany({
        where: { id: task.id, status: TaskStatus.indicator_confirming },
        data: { indicatorConfirmedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '目标已确认或状态已变化，请刷新后重试',
        });
      }

      const indicators = await tx.indicatorInstance.findMany({
        where: { taskId: task.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          visibleDepartments: {
            orderBy: { departmentId: 'asc' },
            select: { departmentId: true },
          },
          visibleUsers: {
            orderBy: { userId: 'asc' },
            select: { userId: true },
          },
          objectiveAlignments: {
            orderBy: { objectiveId: 'asc' },
            select: { objectiveId: true },
          },
        },
      });
      if (indicators.length > 0) {
        await tx.auditLog.createMany({
          data: indicators.map((indicator) => ({
            userId: viewer.id,
            action: 'indicator_baseline_confirmed',
            entityType: 'indicator_instance',
            entityId: indicator.id,
            oldValue: Prisma.JsonNull,
            newValue: this.buildIndicatorBaseline(indicator),
          })),
        });
      }
      if (cycle?.workflowVersion === 2) {
        await this.indicatorVersionService.activateConfirmedV1(tx, task.id, viewer.id);
      }
      return this.flowService.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId: viewer.id,
        extraData: {
          type: 'indicator_baseline_confirmed',
          version: 1,
          count: indicators.length,
        },
        taskUpdate: { indicatorConfirmedAt: now },
      });
    });

    await this.notificationsService.create({
      userId: task.employeeId,
      senderId: viewer.id,
      cycleId: task.cycleId,
      taskId: task.id,
      type: 'indicator_confirmed',
      title: targetStatus === 'self_eval' ? '指标已确认，请进行自评' : '指标已确认',
      content: targetStatus === 'self_eval'
        ? '您的考核指标已确认，请及时完成自评。'
        : '您的考核指标已确认，自评将在规定时间开放。',
    });

    return { id: task.id, status: result.newStatus };
  }

  /** POST /tasks/:id/indicators/reject */
  async rejectIndicators(
    id: string,
    comment: string | undefined,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id);
    const isEmployee = task.employeeId === viewer.id;
    const isReviewer = task.managerId === viewer.id || viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin;
    if (!isEmployee && !isReviewer) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权退回该任务指标' });
    }

    let targetStatus: TaskStatus;
    if (task.status === 'indicator_confirming' && isEmployee) {
      targetStatus = 'indicator_reviewing';
    } else if (task.status === 'indicator_reviewing' && isReviewer) {
      targetStatus = 'indicator_drafting';
    } else {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前状态不允许退回指标',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(
        tx,
        task.id,
        task.updatedAt.toISOString(),
        task.status,
      );
      return this.flowService.transitionTx(tx, {
        task,
        action: 'reject',
        targetStatus,
        actorId: viewer.id,
        comment,
        extraData: { reason: comment },
        taskUpdate: {
          indicatorConfirmedAt: null,
          updatedAt: claimedUpdatedAt,
        },
      });
    });

    if (isEmployee && task.managerId) {
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'indicator_rejected',
        title: '指标被驳回',
        content: `员工对考核指标提出驳回${comment ? `：${comment}` : ''}，请重新调整。`,
      });
    }

    if (isEmployee) {
      await this.notifyHr(task, viewer, '指标被驳回', `员工对考核指标提出驳回${comment ? `：${comment}` : ''}，请重新调整。`);
    } else {
      await this.notificationsService.create({
        userId: task.employeeId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'indicator_rejected',
        title: '指标退回修改',
        content: `主管退回了本周期绩效指标${comment ? `：${comment}` : ''}，请修改后重新提交。`,
      });
    }

    return { id: task.id, status: result.newStatus };
  }

  /** POST /tasks/:id/indicator-proposal */
  async submitIndicatorProposal(
    id: string,
    dto: SubmitIndicatorProposalDto,
    viewer: AuthUser,
  ): Promise<{ id: string; submittedAt: Date }> {
    const task = await this.getTaskOrThrow(id);
    this.assertEmployee(task, viewer);

    if (task.status !== 'indicator_drafting' && task.status !== 'indicator_setting') {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '只有目标制定中才允许维护本周期考核指标',
      });
    }

    const validItems = this.normalizeIndicatorItems(dto.items ?? []);
    const note = dto.note?.trim() || null;
    if (!validItems.length) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '请至少填写一条指标草稿',
      });
    }

    const record = await this.prisma.$transaction(async (tx) => {
      await this.replaceIndicatorInstances(tx, task.id, validItems);
      await tx.assessmentTask.update({
        where: { id: task.id },
        data: { updatedAt: new Date() },
      });
      return tx.flowRecord.create({
        data: {
          taskId: task.id,
          cycleId: task.cycleId,
          nodeType: 'indicator_setting',
          action: 'comment',
          actorId: viewer.id,
          comment: note,
          extraData: {
            type: 'indicator_draft_saved',
            source: 'employee',
            count: validItems.length,
            note,
          },
        },
      });
    });

    const content = `${viewer.name ?? '员工'}提交了本周期指标草稿，请在定稿时参考。`;
    if (task.managerId) {
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'indicator_setting_notice',
        title: '员工提交了指标草稿',
        content,
      });
    }
    await this.notifyHr(task, viewer, '员工提交了指标草稿', content);

    return { id: task.id, submittedAt: record.createdAt };
  }

  /** PUT /tasks/:id/indicators */
  async setIndicators(id: string, dto: SetIndicatorsDto, viewer: AuthUser): Promise<TaskDetail> {
    const task = await this.getTaskOrThrow(id);
    assertTaskVersion(task.updatedAt, dto.expectedUpdatedAt);
    const isEmployee = task.employeeId === viewer.id;
    const isManager = task.managerId === viewer.id;
    const isAdmin = viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin;
    const action = dto.action ?? 'submit';
    const isDraftStatus = task.status === 'indicator_drafting' || task.status === 'indicator_setting';
    const isReviewStatus = task.status === 'indicator_reviewing' || task.status === 'indicator_setting';
    const actsAsEmployee = isEmployee && isDraftStatus;
    const actsAsReviewer = (isManager || isAdmin) && isReviewStatus;

    if (!isEmployee && !isManager && !isAdmin) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权限维护该任务指标' });
    }
    if (!actsAsEmployee && !actsAsReviewer) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '只有目标制定中才允许维护本周期考核指标',
      });
    }

    const validItems = this.normalizeIndicatorItems(dto.instances ?? []);
    if (!validItems.length) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '请至少保留一条指标' });
    }
    const normalizedNames = validItems.map((item) => item.name.trim().toLocaleLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '目标名称不能重复' });
    }
    const totalWeight = validItems.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
    if (totalWeight > 1.000001) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '目标权重合计不能超过 100%' });
    }
    if (action === 'submit' && Math.abs(totalWeight - 1) > 0.000001) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '提交目标前权重合计必须为 100%' });
    }

    for (const item of validItems) {
      await this.indicatorVisibility.validateSelection(item, task, viewer);
    }

    const note = dto.note?.trim() || undefined;
    let submittedToReview = false;
    let approvedForEmployeeConfirm = false;
    await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(tx, task.id, dto.expectedUpdatedAt);
      await this.replaceIndicatorInstances(tx, task.id, validItems);

      if (action === 'save') {
        await tx.assessmentTask.update({
          where: { id: task.id },
          data: { updatedAt: claimedUpdatedAt },
        });
        await tx.flowRecord.create({
          data: {
            taskId: task.id,
            cycleId: task.cycleId,
            nodeType: 'indicator_setting',
            action: 'comment',
            actorId: viewer.id,
            comment: note,
            extraData: {
              type: actsAsEmployee ? 'indicator_draft_saved' : 'indicator_review_saved',
              source: actsAsEmployee ? 'employee' : isAdmin ? 'admin' : 'manager',
              count: validItems.length,
            },
          },
        });
        return;
      }

      if (actsAsEmployee) {
        await this.flowService.transitionTx(tx, {
          task,
          action: 'submit',
          targetStatus: 'indicator_reviewing',
          actorId: viewer.id,
          comment: note,
          extraData: {
            type: 'indicator_employee_submitted',
            source: 'employee',
            count: validItems.length,
          },
          taskUpdate: {
            updatedAt: claimedUpdatedAt,
          },
        });
        submittedToReview = true;
        return;
      }

      if (actsAsReviewer) {
        await this.flowService.transitionTx(tx, {
          task,
          action: 'submit',
          targetStatus: 'indicator_confirming',
          actorId: viewer.id,
          comment: note,
          extraData: {
            type: 'indicator_review_approved',
            source: isAdmin ? 'admin' : 'manager',
            count: validItems.length,
          },
          taskUpdate: {
            indicatorSetAt: new Date(),
            indicatorConfirmedAt: null,
            updatedAt: claimedUpdatedAt,
          },
        });
        approvedForEmployeeConfirm = true;
        return;
      }
    });

    if (approvedForEmployeeConfirm) {
      await this.notificationsService.create({
        userId: task.employeeId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'indicator_setting_notice',
        title: '考核指标待确认',
        content: '主管已审核本周期正式考核指标，请进入“我的绩效”确认。',
      });
    }

    if (submittedToReview && task.managerId) {
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'indicator_setting_notice',
        title: '员工提交了指标',
        content: `${viewer.name ?? '员工'}提交了本周期绩效指标，请主管审核。`,
      });
    }

    return this.findOne(id, viewer);
  }
  /** PUT /tasks/:id/actual-value */
  async updateActualValues(
    id: string,
    dto: UpdateActualValueDto,
    viewer: AuthUser,
  ): Promise<{ id: string; updatedCount: number }> {
    const task = await this.getTaskOrThrow(id);
    this.assertCanEditActualValue(task, viewer);

    if (!(['self_eval', 'manager_scoring'] as TaskStatus[]).includes(task.status)) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前状态不允许更新实际完成值',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.indicators) {
        await tx.indicatorInstance.update({
          where: { id: item.id, taskId: id },
          data: {
            actualValue: item.actualValue ?? null,
            actualNote: item.actualNote ?? null,
          },
        });
      }
    });

    return { id: task.id, updatedCount: dto.indicators.length };
  }

  /** POST /tasks/:id/self-eval */
  async submitSelfEval(id: string, dto: SubmitSelfEvalDto, viewer: AuthUser): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id, { snapshot: { select: { snapshotData: true } } });
    this.assertEmployee(task, viewer);
    if (task.status !== 'self_eval') {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: task.status === 'goal_confirmed'
          ? '自评尚未开放，请在开放时间后操作'
          : '当前状态不允许提交自评',
      });
    }

    const snapshotData = (task.snapshot?.snapshotData ?? {}) as { maxScore?: number };
    const maxScore = typeof snapshotData.maxScore === 'number' ? snapshotData.maxScore : 100;

    // 校验分数范围
    for (const item of dto.indicators) {
      this.scoringService.validateScore(item.selfScore, maxScore);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.indicators) {
        await tx.indicatorInstance.update({
          where: { id: item.id, taskId: id },
          data: {
            selfScore: item.selfScore,
            selfComment: item.selfComment ?? null,
          },
        });
      }

      await tx.selfEvalSummary.upsert({
        where: { taskId: id },
        create: {
          taskId: id,
          achievements: dto.summary.achievements ?? null,
          improvements: dto.summary.improvements ?? null,
          suggestions: dto.summary.suggestions ?? null,
          nextGoals: dto.summary.nextGoals ?? null,
          supportNeeded: dto.summary.supportNeeded ?? null,
          attachments: (dto.summary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt: new Date(),
        },
        update: {
          achievements: dto.summary.achievements ?? null,
          improvements: dto.summary.improvements ?? null,
          suggestions: dto.summary.suggestions ?? null,
          nextGoals: dto.summary.nextGoals ?? null,
          supportNeeded: dto.summary.supportNeeded ?? null,
          attachments: (dto.summary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt: new Date(),
        },
      });

      const targetStatus = task.managerId ? 'manager_scoring' : 'hr_calibration';
      await this.flowService.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId: viewer.id,
        taskUpdate: { selfEvalSubmittedAt: new Date() },
      });
    });

    if (task.managerId) {
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'self_eval_submitted',
        title: '员工已提交自评',
        content: '您的下属已完成自评，请及时进行主管评分。',
      });
    }

    return { id: task.id, status: task.managerId ? 'manager_scoring' : 'hr_calibration' };
  }

  /** PUT /tasks/:id/manager-evaluation-draft */
  async saveManagerEvaluationDraft(
    id: string,
    dto: SaveManagerEvaluationDraftDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus; updatedAt: string }> {
    const task = (await this.getTaskOrThrow(id, {
      snapshot: { select: { snapshotData: true } },
      cycle: { select: { workflowVersion: true } },
      periods: { select: { id: true, status: true }, take: 1 },
    })) as AssessmentTask & {
      snapshot?: { snapshotData: Prisma.JsonValue };
      cycle: { workflowVersion: number };
      periods: Array<{ id: string; status: AssessmentPeriodStatus }>;
    };
    this.assertManager(task, viewer);
    this.assertLegacyManagerEvaluationAllowed(task);
    this.assertManagerScoring(task);
    assertTaskVersion(task.updatedAt, dto.expectedUpdatedAt);

    const snapshotData = (task.snapshot?.snapshotData ?? {}) as { maxScore?: number };
    const maxScore = typeof snapshotData.maxScore === 'number' ? snapshotData.maxScore : 100;
    for (const item of dto.indicators ?? []) {
      if (item.managerScore != null) {
        this.scoringService.validateScore(item.managerScore, maxScore);
      }
    }

    const claimedUpdatedAt = await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(tx, task.id, dto.expectedUpdatedAt);

      for (const item of dto.indicators ?? []) {
        const data: Prisma.IndicatorInstanceUpdateInput = {};
        if (item.managerScore !== undefined) data.managerScore = item.managerScore;
        if (item.managerComment !== undefined) data.managerComment = item.managerComment;
        if (item.extraScores !== undefined) {
          data.extraScores = item.extraScores as unknown as Prisma.InputJsonValue;
        }
        if (Object.keys(data).length > 0) {
          await tx.indicatorInstance.update({
            where: { id: item.id, taskId: task.id },
            data,
          });
        }
      }

      const summaryData: Prisma.ManagerEvalSummaryUncheckedUpdateInput = {};
      if (dto.evalSummary.strengths !== undefined) {
        summaryData.strengths = dto.evalSummary.strengths || null;
      }
      if (dto.evalSummary.improvements !== undefined) {
        summaryData.improvements = dto.evalSummary.improvements || null;
      }
      if (dto.evalSummary.developmentPlan !== undefined) {
        summaryData.developmentPlan = dto.evalSummary.developmentPlan || null;
      }
      if (dto.evalSummary.attachments !== undefined) {
        summaryData.attachments = dto.evalSummary.attachments as Prisma.InputJsonValue;
      }

      await tx.managerEvalSummary.upsert({
        where: { taskId: task.id },
        create: {
          taskId: task.id,
          strengths: dto.evalSummary.strengths ?? null,
          improvements: dto.evalSummary.improvements ?? null,
          developmentPlan: dto.evalSummary.developmentPlan ?? null,
          attachments: (dto.evalSummary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt: null,
        },
        update: { ...summaryData, submittedAt: null },
      });

      await tx.assessmentTask.update({
        where: { id: task.id },
        data: { updatedAt: claimedUpdatedAt },
      });
      await tx.flowRecord.create({
        data: {
          taskId: task.id,
          cycleId: task.cycleId,
          nodeType: 'manager_score',
          actorId: viewer.id,
          action: 'comment',
          extraData: { type: 'manager_evaluation_draft_saved' },
        },
      });
      return claimedUpdatedAt;
    });

    return { id: task.id, status: 'manager_scoring', updatedAt: claimedUpdatedAt.toISOString() };
  }

  /** POST /tasks/:id/manager-score */
  async submitManagerScore(
    id: string,
    dto: SubmitManagerScoreDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus }> {
    const task = (await this.getTaskOrThrow(id, {
      snapshot: { select: { snapshotData: true } },
      indicatorInstances: { select: { id: true, indicatorType: true } },
      cycle: { select: { workflowVersion: true } },
      periods: { select: { id: true, status: true }, take: 1 },
    })) as AssessmentTask & {
      snapshot?: { snapshotData: Prisma.JsonValue };
      indicatorInstances: Array<{ id: string; indicatorType: string }>;
      cycle: { workflowVersion: number };
      periods: Array<{ id: string; status: AssessmentPeriodStatus }>;
    };
    this.assertManager(task, viewer);
    this.assertLegacyManagerEvaluationAllowed(task);
    this.assertManagerScoring(task);
    assertTaskVersion(task.updatedAt, dto.expectedUpdatedAt);
    this.assertCompleteManagerScores(task.indicatorInstances, dto);

    const snapshotData = (task.snapshot?.snapshotData ?? {}) as { maxScore?: number };
    const maxScore = typeof snapshotData.maxScore === 'number' ? snapshotData.maxScore : 100;

    if (dto.veto?.isVeto && (!dto.veto.vetoReason || dto.veto.vetoReason.trim() === '')) {
      throw new ConflictException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '一票否决必须填写原因',
      });
    }
    if (dto.veto?.isVeto && !task.indicatorInstances.some((indicator) => indicator.indicatorType === 'veto')) {
      throw new ConflictException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前考核任务不包含一票否决指标',
      });
    }

    const targetStatus = task.managerId === task.deptHeadId ? 'hr_calibration' : 'dept_review';
    const submittedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(tx, task.id, dto.expectedUpdatedAt);

      for (const item of dto.indicators) {
        this.scoringService.validateScore(item.managerScore, maxScore);
        const extraSum = item.extraScores?.reduce((sum, e) => sum + e.value, 0) ?? 0;
        const finalScore = Math.max(0, Math.min(maxScore, item.managerScore + extraSum));
        await tx.indicatorInstance.update({
          where: { id: item.id, taskId: id },
          data: {
            managerScore: item.managerScore,
            managerComment: item.managerComment ?? null,
            extraScores: (item.extraScores ?? []) as unknown as Prisma.InputJsonValue,
            finalScore,
          },
        });
      }

      await tx.managerEvalSummary.upsert({
        where: { taskId: id },
        create: {
          taskId: id,
          strengths: dto.evalSummary.strengths ?? null,
          improvements: dto.evalSummary.improvements ?? null,
          developmentPlan: dto.evalSummary.developmentPlan ?? null,
          attachments: (dto.evalSummary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt,
        },
        update: {
          strengths: dto.evalSummary.strengths ?? null,
          improvements: dto.evalSummary.improvements ?? null,
          developmentPlan: dto.evalSummary.developmentPlan ?? null,
          attachments: (dto.evalSummary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt,
        },
      });

      const [instances, gradeConfig] = await Promise.all([
        tx.indicatorInstance.findMany({ where: { taskId: id } }),
        tx.systemConfig.findUnique({ where: { key: 'grade_score_mapping' } }),
      ]);
      const scorable = instances.map((ind) => this.scoringService.toScorableIndicator(ind));
      const scoreResult = this.scoringService.calcTaskTotal(scorable);
      const mapping = (gradeConfig?.value as Record<string, number> | undefined) ?? { A: 90, B: 75, C: 60 };
      scoreResult.rawGrade = this.scoringService.calcRawGrade(scoreResult.totalScore, mapping);

      if (dto.veto?.isVeto) {
        scoreResult.rawGrade = 'D';
      }

      const vetoReason = dto.veto?.isVeto ? dto.veto.vetoReason!.trim() : null;
      const resetCalibration = {
        calibratedGrade: dto.veto?.isVeto ? ('D' as const) : null,
        calibrationNote: null,
        coefficient: null,
        hrCalibratorId: null,
        hrCalibratedAt: null,
      };
      await tx.gradeResult.upsert({
        where: { taskId: id },
        create: {
          taskId: id,
          calculatedScore: scoreResult.totalScore,
          rawGrade: scoreResult.rawGrade,
          isVeto: dto.veto?.isVeto ?? false,
          vetoReason,
          vetoOperatorId: dto.veto?.isVeto ? viewer.id : null,
          ...resetCalibration,
        },
        update: {
          calculatedScore: scoreResult.totalScore,
          rawGrade: scoreResult.rawGrade,
          isVeto: dto.veto?.isVeto ?? false,
          vetoReason,
          vetoOperatorId: dto.veto?.isVeto ? viewer.id : null,
          ...resetCalibration,
        },
      });

      await this.flowService.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId: viewer.id,
        taskUpdate: { managerScoredAt: submittedAt, updatedAt: claimedUpdatedAt },
      });
    });

    try {
      const notifyUserId = targetStatus === 'hr_calibration' ? null : task.deptHeadId;
      if (notifyUserId) {
        await this.notificationsService.create({
          userId: notifyUserId,
          senderId: viewer.id,
          cycleId: task.cycleId,
          taskId: task.id,
          type: 'manager_score_submitted',
          title: '主管评分待复核',
          content: '主管已完成评分，请进行部门负责人复核。',
        });
      } else {
        await this.notifyHr(task, viewer, '主管评分待 HR 校准', '主管已完成评分，请进行 HR 校准。');
      }
    } catch (error) {
      this.logger.error(
        `manager score notification failed for task ${task.id}`,
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    }

    return { id: task.id, status: targetStatus };
  }

  /** POST /tasks/:id/manager-score/withdraw */
  async withdrawManagerScore(
    id: string,
    dto: WithdrawManagerScoreDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus; updatedAt: string }> {
    const task = await this.getTaskOrThrow(id);
    this.assertManager(task, viewer);

    const directNextStatus = task.managerId === task.deptHeadId ? 'hr_calibration' : 'dept_review';
    if (task.status !== directNextStatus || !task.managerScoredAt) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前状态不允许撤回主管评分',
      });
    }
    if (task.deptReviewedAt || task.hrCalibratedAt) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '下一节点已处理，不能撤回主管评分',
      });
    }
    assertTaskVersion(task.updatedAt, dto.expectedUpdatedAt);

    const claimedUpdatedAt = await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(tx, task.id, dto.expectedUpdatedAt, directNextStatus);
      const downstreamRecord = await tx.flowRecord.findFirst({
        where: {
          taskId: task.id,
          createdAt: { gt: task.managerScoredAt! },
          nodeType: {
            in: ['dept_review', 'hr_calibration', 'approval', 'publish', 'employee_confirm', 'appeal'],
          },
        },
        select: { id: true },
      });
      if (downstreamRecord) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '下一节点已处理，不能撤回主管评分',
        });
      }

      const gradeResult = await tx.gradeResult.findUnique({
        where: { taskId: task.id },
        select: {
          calibratedGrade: true,
          calibrationNote: true,
          coefficient: true,
          hrCalibratorId: true,
          hrCalibratedAt: true,
          isVeto: true,
          vetoOperatorId: true,
        },
      });
      const managerOwnedVeto =
        gradeResult?.isVeto === true &&
        gradeResult.vetoOperatorId === task.managerId &&
        gradeResult.calibratedGrade === 'D';
      const hasHrCalibrationActivity =
        gradeResult != null &&
        (gradeResult.hrCalibratedAt != null ||
          gradeResult.hrCalibratorId != null ||
          gradeResult.coefficient != null ||
          gradeResult.calibrationNote != null ||
          (gradeResult.calibratedGrade != null && !managerOwnedVeto) ||
          (gradeResult.isVeto && !managerOwnedVeto) ||
          (!gradeResult.isVeto && gradeResult.vetoOperatorId != null));
      if (hasHrCalibrationActivity) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: 'HR 已开始校准，不能撤回主管评分',
        });
      }

      await tx.assessmentTask.update({
        where: { id: task.id },
        data: {
          status: 'manager_scoring',
          managerScoredAt: null,
          updatedAt: claimedUpdatedAt,
        },
      });
      await tx.managerEvalSummary.update({
        where: { taskId: task.id },
        data: { submittedAt: null },
      });
      await tx.flowRecord.create({
        data: {
          taskId: task.id,
          cycleId: task.cycleId,
          nodeType: 'manager_score',
          actorId: viewer.id,
          action: 'withdraw',
          extraData: { type: 'manager_score_withdrawn' },
        },
      });
      return claimedUpdatedAt;
    });

    return { id: task.id, status: 'manager_scoring', updatedAt: claimedUpdatedAt.toISOString() };
  }

  /** POST /tasks/:id/dept-review */
  async deptReview(id: string, dto: DeptReviewDto, viewer: AuthUser): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id);
    this.assertDeptHead(task, viewer);

    if (dto.action === 'approve') {
      await this.prisma.$transaction(async (tx) => {
        const claimedUpdatedAt = await claimTaskVersion(
          tx,
          task.id,
          task.updatedAt.toISOString(),
          'dept_review',
        );
        await this.flowService.transitionTx(tx, {
          task,
          action: 'approve',
          targetStatus: 'hr_calibration',
          actorId: viewer.id,
          comment: dto.comment,
          taskUpdate: { deptReviewedAt: new Date(), updatedAt: claimedUpdatedAt },
        });
      });

      await this.notifyHr(task, viewer, '部门复核通过，待 HR 校准', '部门负责人已复核通过，请进行 HR 校准。');
      return { id: task.id, status: 'hr_calibration' };
    }

    // reject
    const claimedUpdatedAt = await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(
        tx,
        task.id,
        task.updatedAt.toISOString(),
        'dept_review',
      );
      await this.flowService.transitionTx(tx, {
        task,
        action: 'reject',
        targetStatus: 'manager_scoring',
        actorId: viewer.id,
        comment: dto.comment,
        taskUpdate: { deptReviewedAt: null, updatedAt: claimedUpdatedAt },
      });
    });

    if (task.managerId) {
      await this.notificationsService.create({
        userId: task.managerId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'dept_review_rejected',
        title: '部门复核未通过',
        content: `部门负责人驳回了评分${dto.comment ? `：${dto.comment}` : ''}，请重新评分。`,
      });
    }

    return { id: task.id, status: 'manager_scoring' };
  }

  /** POST /tasks/:id/employee-confirm */
  async employeeConfirm(id: string, viewer: AuthUser): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id);
    this.assertEmployee(task, viewer);

    await this.prisma.$transaction(async (tx) => {
      await this.flowService.transitionTx(tx, {
        task,
        action: 'approve',
        targetStatus: 'confirmed',
        actorId: viewer.id,
        taskUpdate: { employeeConfirmedAt: new Date() },
      });

      await tx.gradeResult.updateMany({
        where: { taskId: id },
        data: { employeeConfirmedAt: new Date() },
      });
    });

    return { id: task.id, status: 'confirmed' };
  }

  // ---------------------------------------------------------------------------
  // 权限与辅助
  // ---------------------------------------------------------------------------

  private async getTaskOrThrow(
    id: string,
    include?: Prisma.AssessmentTaskInclude,
  ): Promise<AssessmentTask & { snapshot?: { snapshotData: Prisma.JsonValue } }> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id },
      include,
    });
    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核任务不存在' });
    }
    return task as AssessmentTask & { snapshot?: { snapshotData: Prisma.JsonValue } };
  }

  private assertEmployee(task: AssessmentTask, viewer: AuthUser): void {
    if (task.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可操作' });
    }
  }

  private assertManager(task: AssessmentTask, viewer: AuthUser): void {
    if (task.managerId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅主管本人可操作' });
    }
  }

  private assertLegacyManagerEvaluationAllowed(task: AssessmentTask & {
    cycle?: { workflowVersion: number };
    periods?: Array<{ id: string }>;
  }): void {
    if (task.cycle?.workflowVersion === 2 && task.periods?.length) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '本周期使用分期复盘，请在本期复盘中完成主管评分',
      });
    }
  }

  private assertManagerScoring(task: AssessmentTask): void {
    if (task.status !== 'manager_scoring') {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前状态不允许保存或提交主管评分',
      });
    }
  }

  private assertCompleteManagerScores(
    indicators: Array<{ id: string; indicatorType: string }>,
    dto: SubmitManagerScoreDto,
  ): void {
    const expectedIds = indicators
      .filter((indicator) => indicator.indicatorType !== 'veto')
      .map((indicator) => indicator.id);
    const submittedIds = (dto.indicators ?? []).map((indicator) => indicator.id);
    const submittedIdSet = new Set(submittedIds);
    const isComplete =
      submittedIds.length === submittedIdSet.size &&
      submittedIds.length === expectedIds.length &&
      expectedIds.every((indicatorId) => submittedIdSet.has(indicatorId)) &&
      dto.indicators.every(
        (indicator) =>
          typeof indicator.managerScore === 'number' && Number.isFinite(indicator.managerScore),
      );

    if (!isComplete) {
      throw new ConflictException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请为每一项考核指标填写主管评分',
      });
    }
  }

  private assertDeptHead(task: AssessmentTask, viewer: AuthUser): void {
    if (task.deptHeadId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅部门负责人可操作' });
    }
  }

  private assertCanEditActualValue(task: AssessmentTask, viewer: AuthUser): void {
    const allowed =
      task.employeeId === viewer.id ||
      task.managerId === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin;
    if (!allowed) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权限更新实际完成值' });
    }
  }

  private assertCanView(task: AssessmentTask, viewer: AuthUser): void {
    const canView =
      task.employeeId === viewer.id ||
      task.managerId === viewer.id ||
      task.deptHeadId === viewer.id ||
      task.approverId === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll;
    if (!canView) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权限查看该考核任务' });
    }
  }

  private async hasEmployeeIndicatorConfirmation(taskId: string, employeeId: string): Promise<boolean> {
    const records = await this.prisma.flowRecord.findMany({
      where: {
        taskId,
        actorId: employeeId,
        nodeType: 'indicator_setting',
      },
      select: { extraData: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return records.some((record) => {
      const extraData = record.extraData;
      if (!extraData || typeof extraData !== 'object' || Array.isArray(extraData)) return false;
      const data = extraData as { type?: unknown; source?: unknown };
      return data.source === 'employee' && String(data.type) === 'indicator_employee_confirmed';
    });
  }

  private async notifyHr(
    task: AssessmentTask,
    sender: AuthUser,
    title: string,
    content: string,
  ): Promise<void> {
    // 通知周期明确指定的 HR 负责人。
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: task.cycleId },
      select: { hrOwnerId: true },
    });
    if (cycle?.hrOwnerId) {
      await this.notificationsService.create({
        userId: cycle.hrOwnerId,
        senderId: sender.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: 'hr_calibration_notice',
        title,
        content,
      });
    }
  }

  private normalizeIndicatorItems(items: SetIndicatorItemDto[]): SetIndicatorItemDto[] {
    const valid: SetIndicatorItemDto[] = [];

    for (const [index, item] of (items ?? []).entries()) {
      const name = item.name?.trim();
      if (!name) continue;
      const legacyTarget = (item as SetIndicatorItemDto & { target?: string }).target?.trim();
      const legacyStandard = (item as SetIndicatorItemDto & { standard?: string }).standard?.trim();
      valid.push({
        templateIndicatorId: item.templateIndicatorId,
        name,
        description: item.description?.trim() || legacyTarget || undefined,
        scoringStandard: item.scoringStandard?.trim() || legacyStandard || undefined,
        dataSource: item.dataSource?.trim() || undefined,
        dataCaliber: item.dataCaliber?.trim() || undefined,
        targetValue: item.targetValue,
        targetValueText: item.targetValueText?.trim() || undefined,
        unit: item.unit?.trim() || undefined,
        weight: item.weight,
        indicatorType: item.indicatorType ?? 'kpi',
        dimensionName: item.dimensionName?.trim() || 'KPI维度',
        dimensionWeight: item.dimensionWeight ?? 1,
        sortOrder: item.sortOrder ?? index,
        visibilityScope: item.visibilityScope ?? IndicatorVisibilityScope.supervisors,
        visibleDepartmentIds: [...new Set(item.visibleDepartmentIds ?? [])],
        visibleUserIds: [...new Set(item.visibleUserIds ?? [])],
        alignedObjectiveIds: [...new Set(item.alignedObjectiveIds ?? [])],
      });
    }

    const defaultWeight = valid.length ? 1 / valid.length : 0;
    return valid.map((item, index) => ({
      ...item,
      weight: item.weight ?? defaultWeight,
      sortOrder: item.sortOrder ?? index,
    }));
  }

  private async replaceIndicatorInstances(
    tx: Prisma.TransactionClient,
    taskId: string,
    items: SetIndicatorItemDto[],
  ): Promise<void> {
    await tx.indicatorInstance.deleteMany({ where: { taskId } });
    if (!items.length) return;
    for (const [index, item] of items.entries()) {
      await tx.indicatorInstance.create({
        data: {
          task: { connect: { id: taskId } },
          templateIndicator: item.templateIndicatorId ? { connect: { id: item.templateIndicatorId } } : undefined,
          name: item.name.trim(),
          description: item.description || null,
          scoringStandard: item.scoringStandard || null,
          dataSource: item.dataSource || null,
          dataCaliber: item.dataCaliber || null,
          targetValue: item.targetValue != null ? new Prisma.Decimal(item.targetValue.toString()) : null,
          targetValueText: item.targetValueText || null,
          unit: item.unit || null,
          weight: new Prisma.Decimal((item.weight ?? 0).toString()),
          indicatorType: item.indicatorType ?? 'kpi',
          dimensionName: item.dimensionName || null,
          dimensionWeight: new Prisma.Decimal((item.dimensionWeight ?? 1).toString()),
          sortOrder: item.sortOrder ?? index,
          visibilityScope: item.visibilityScope,
          visibleDepartments: item.visibleDepartmentIds.length
            ? {
                createMany: {
                  data: item.visibleDepartmentIds.map((departmentId) => ({
                    departmentId,
                  })),
                },
              }
            : undefined,
          visibleUsers: item.visibleUserIds.length
            ? {
                createMany: {
                  data: item.visibleUserIds.map((userId) => ({ userId })),
                },
              }
            : undefined,
          objectiveAlignments: item.alignedObjectiveIds.length
            ? {
                createMany: {
                  data: item.alignedObjectiveIds.map((objectiveId) => ({
                    objectiveId,
                  })),
                },
              }
            : undefined,
        },
      });
    }
  }

  private buildTaskDetail(task: any, visibleObjectiveIds = new Set<string>()): TaskDetail {
    return {
      id: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle?.name ?? '',
      employeeId: task.employeeId,
      employeeName: task.employee?.name ?? '',
      employeeNo: task.employee?.employeeNo ?? null,
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      managerId: task.managerId,
      managerName: task.manager?.name ?? null,
      workflowVersion: task.cycle?.workflowVersion ?? 1,
      periods: (task.periods ?? []).map((period: any) => ({
        id: period.id,
        periodKey: period.periodKey,
        periodType: period.periodType,
        sequence: period.sequence,
        status: period.status,
        selfEvalOpenAt: period.selfEvalOpenAt,
        selfEvalDueAt: period.selfEvalDueAt,
        managerDueAt: period.managerDueAt,
        employeeSubmittedAt: period.employeeSubmittedAt,
        managerSubmittedAt: period.managerSubmittedAt,
      })),
      status: task.status,
      isExempt: task.isExempt,
      exemptReason: task.exemptReason,
      managerScoredAt: task.managerScoredAt,
      totalScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      updatedAt: task.updatedAt,
      workflowContext: {
        stage: 'goal_setting',
        statusLabel: '',
        currentHandler: null,
        currentDeadline: null,
        canRemind: false,
        reminderNodeType: null,
        reminderAvailableAt: null,
      },
      indicatorInstances: task.indicatorInstances.map((ind: any) => ({
        id: ind.id,
        name: ind.name,
        description: ind.description,
        scoringStandard: ind.scoringStandard,
        dataSource: ind.dataSource,
        dataCaliber: ind.dataCaliber,
        targetValue: ind.targetValue?.toNumber() ?? null,
        targetValueText: ind.targetValueText,
        unit: ind.unit,
        weight: ind.weight.toNumber(),
        indicatorType: ind.indicatorType,
        dimensionName: ind.dimensionName,
        dimensionWeight: ind.dimensionWeight.toNumber(),
        actualValue: ind.actualValue?.toString() ?? null,
        actualNote: ind.actualNote,
        selfScore: ind.selfScore?.toNumber() ?? null,
        selfComment: ind.selfComment,
        managerScore: ind.managerScore?.toNumber() ?? null,
        managerComment: ind.managerComment,
        extraScores: Array.isArray(ind.extraScores) ? ind.extraScores : [],
        finalScore: ind.finalScore?.toNumber() ?? null,
        sortOrder: ind.sortOrder,
        visibilityScope: ind.visibilityScope ?? IndicatorVisibilityScope.supervisors,
        visibleDepartmentIds: (ind.visibleDepartments ?? []).map((row: { departmentId: string }) => row.departmentId),
        visibleUserIds: (ind.visibleUsers ?? []).map((row: { userId: string }) => row.userId),
        alignedObjectives: (ind.objectiveAlignments ?? [])
          .filter((alignment: { objectiveId: string }) => visibleObjectiveIds.has(alignment.objectiveId))
          .map(({ objective }: any) => ({
            id: objective.id,
            title: objective.title,
            level: objective.level,
            ownerId: objective.ownerId,
          })),
      })),
      selfEvalSummary: task.selfEvalSummary
        ? {
            achievements: task.selfEvalSummary.achievements,
            improvements: task.selfEvalSummary.improvements,
            suggestions: task.selfEvalSummary.suggestions,
            nextGoals: task.selfEvalSummary.nextGoals,
            supportNeeded: task.selfEvalSummary.supportNeeded,
            attachments: task.selfEvalSummary.attachments,
            submittedAt: task.selfEvalSummary.submittedAt,
          }
        : null,
      managerEvalSummary: task.managerEvalSummary
        ? {
            strengths: task.managerEvalSummary.strengths,
            improvements: task.managerEvalSummary.improvements,
            developmentPlan: task.managerEvalSummary.developmentPlan,
            attachments: task.managerEvalSummary.attachments,
            submittedAt: task.managerEvalSummary.submittedAt,
          }
        : null,
      gradeResult: task.gradeResult
        ? {
            calculatedScore: task.gradeResult.calculatedScore?.toNumber() ?? null,
            rawGrade: task.gradeResult.rawGrade,
            calibratedGrade: task.gradeResult.calibratedGrade,
            coefficient: task.gradeResult.coefficient?.toNumber() ?? null,
            isVeto: task.gradeResult.isVeto,
            vetoReason: task.gradeResult.vetoReason,
            vetoOperatorId: task.gradeResult.vetoOperatorId,
            vetoOperatorName: task.gradeResult.vetoOperator?.name ?? null,
            isPublished: task.gradeResult.isPublished,
            employeeConfirmedAt: task.gradeResult.employeeConfirmedAt,
          }
        : null,
      performanceInterview: task.performanceInterview
        ? {
            id: task.performanceInterview.id,
            status: task.performanceInterview.status,
            interviewTime: task.performanceInterview.interviewTime,
            location: task.performanceInterview.location,
            method: task.performanceInterview.method,
            scoreInformed: task.performanceInterview.scoreInformed,
            achievements: task.performanceInterview.achievements,
            weaknesses: task.performanceInterview.weaknesses,
            nextGoals: task.performanceInterview.nextGoals,
            remediation: task.performanceInterview.remediation,
            supportNeeded: task.performanceInterview.supportNeeded,
            otherMatters: task.performanceInterview.otherMatters,
            deadline: task.performanceInterview.deadline,
            managerSignedAt: task.performanceInterview.managerSignedAt,
            employeeSignedAt: task.performanceInterview.employeeSignedAt,
          }
        : null,
      flowRecords: task.flowRecords.map((fr: any) => ({
        id: fr.id,
        taskId: fr.taskId,
        cycleId: fr.cycleId,
        nodeType: fr.nodeType,
        action: fr.action,
        actorId: fr.actorId,
        actorName: fr.actor?.name ?? null,
        comment: fr.comment,
        extraData: fr.extraData,
        createdAt: fr.createdAt,
      })),
    };
  }

  /**
   * 员工最终确认时形成正式基线。这里只保存指标结构字段，执行进展、评分和草稿
   * 继续走各自记录，避免把一次确认放大成整张考核表的冗余快照。
   */
  private buildIndicatorBaseline(indicator: IndicatorBaselineSource): Prisma.InputJsonObject {
    return {
      version: 1,
      taskId: indicator.taskId,
      templateIndicatorId: indicator.templateIndicatorId,
      name: indicator.name,
      description: indicator.description ?? null,
      scoringStandard: indicator.scoringStandard ?? null,
      dataSource: indicator.dataSource ?? null,
      dataCaliber: indicator.dataCaliber ?? null,
      targetValue: indicator.targetValue?.toNumber?.() ?? null,
      targetValueText: indicator.targetValueText ?? null,
      unit: indicator.unit ?? null,
      weight: indicator.weight?.toNumber?.() ?? Number(indicator.weight ?? 0),
      indicatorType: indicator.indicatorType,
      dimensionName: indicator.dimensionName ?? null,
      dimensionWeight: indicator.dimensionWeight?.toNumber?.() ?? Number(indicator.dimensionWeight ?? 0),
      visibilityScope: indicator.visibilityScope ?? IndicatorVisibilityScope.supervisors,
      visibleDepartmentIds: indicator.visibleDepartments
        .map((item) => item.departmentId)
        .sort(),
      visibleUserIds: indicator.visibleUsers
        .map((item) => item.userId)
        .sort(),
      alignedObjectiveIds: indicator.objectiveAlignments
        .map((item) => item.objectiveId)
        .sort(),
      sortOrder: indicator.sortOrder,
    };
  }

  private async buildWorkflowContext(task: any, viewer: AuthUser): Promise<TaskWorkflowContext> {
    const target = this.resolveReminderTarget(task);
    const canRemind = Boolean(
      target && this.canViewerRemind(task, viewer, target.nodeType, target.handlerId),
    );
    const reminderAvailableAt = canRemind && target
      ? await this.notificationsService.getReminderCooldownUntil(
          task.id,
          target.nodeType,
          target.handlerId,
        )
      : null;

    const statusLabels: Partial<Record<TaskStatus, string>> = {
      pending: '待开始',
      indicator_drafting: '待制定目标',
      indicator_reviewing: '待主管审核目标',
      indicator_setting: '目标制定中',
      indicator_confirming: '待员工确认目标',
      goal_confirmed: '目标已确认，待自评开放',
      self_eval: '待员工自评',
      manager_scoring: '待主管评估',
      dept_review: '待部门复核',
      hr_calibration: '待 HR 校准',
      approval: '待审批',
      published: '结果已发布，待员工确认',
      confirmed: '结果已确认',
      appealing: '申诉处理中',
      closed: '已完成',
      exempted: '已豁免',
    };

    return {
      stage: this.resolveBusinessStage(task.status),
      statusLabel: statusLabels[task.status as TaskStatus] ?? task.status,
      currentHandler: target
        ? {
            id: target.handlerId,
            name: this.resolveHandlerName(task, target.nodeType),
            nodeType: target.nodeType,
          }
        : null,
      currentDeadline: this.resolveCurrentDeadline(task),
      canRemind,
      reminderNodeType: target?.nodeType ?? null,
      reminderAvailableAt,
    };
  }

  private resolveReminderTarget(
    task: Pick<AssessmentTask, 'status' | 'employeeId' | 'managerId' | 'deptHeadId' | 'approverId'> & {
      cycle?: { hrOwnerId?: string | null };
    },
  ): { nodeType: TaskReminderNodeType; handlerId: string } | null {
    const mapping: Partial<Record<TaskStatus, TaskReminderNodeType>> = {
      indicator_drafting: 'employee',
      indicator_reviewing: 'manager',
      indicator_setting: 'manager',
      indicator_confirming: 'employee',
      self_eval: 'employee',
      manager_scoring: 'manager',
      dept_review: 'deptHead',
      hr_calibration: 'hr',
      approval: 'approver',
      published: 'employee',
      appealing: 'deptHead',
    };
    const nodeType = mapping[task.status];
    if (!nodeType) return null;
    const handlerId = nodeType === 'employee'
      ? task.employeeId
      : nodeType === 'manager'
        ? task.managerId
        : nodeType === 'deptHead'
          ? task.deptHeadId
          : nodeType === 'hr'
            ? task.cycle?.hrOwnerId ?? null
            : task.approverId;
    return handlerId ? { nodeType, handlerId } : null;
  }

  private canViewerRemind(
    task: Pick<AssessmentTask, 'employeeId' | 'managerId' | 'deptHeadId'>,
    viewer: AuthUser,
    nodeType: TaskReminderNodeType,
    handlerId: string,
  ): boolean {
    if (handlerId === viewer.id) return false;
    if (viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin) return true;
    if (viewer.id === task.employeeId) return true;
    if (viewer.id === task.managerId) return nodeType === 'employee';
    return viewer.id === task.deptHeadId;
  }

  private resolveHandlerName(task: any, nodeType: TaskReminderNodeType): string {
    if (nodeType === 'employee') return task.employee?.name ?? '员工';
    if (nodeType === 'manager') return task.manager?.name ?? '直属主管';
    if (nodeType === 'deptHead') return task.deptHead?.name ?? '部门负责人';
    if (nodeType === 'hr') return task.cycle?.hrOwner?.name ?? 'HR 负责人';
    return task.approver?.name ?? '审批人';
  }

  private resolveBusinessStage(status: TaskStatus): TaskWorkflowContext['stage'] {
    if (['pending', 'indicator_drafting', 'indicator_reviewing', 'indicator_setting', 'indicator_confirming', 'goal_confirmed'].includes(status)) return 'goal_setting';
    if (status === 'self_eval') return 'self_eval';
    if (['manager_scoring', 'dept_review', 'hr_calibration', 'approval'].includes(status)) return 'review';
    if (['published', 'appealing'].includes(status)) return 'result';
    return 'completed';
  }

  private resolveCurrentDeadline(task: any): Date | null {
    const cycle = task.cycle ?? {};
    const deadlines: Partial<Record<TaskStatus, Date | null | undefined>> = {
      indicator_drafting: cycle.deadlineIndicatorSetting,
      indicator_reviewing: cycle.deadlineIndicatorSetting,
      indicator_setting: cycle.deadlineIndicatorSetting,
      indicator_confirming: cycle.deadlineIndicatorConfirm,
      goal_confirmed: cycle.selfEvalOpenAt,
      self_eval: cycle.deadlineSelfEval,
      manager_scoring: cycle.deadlineManagerScore,
      dept_review: cycle.deadlineHrCalibration,
      hr_calibration: cycle.deadlineHrCalibration,
      approval: cycle.deadlineApproval,
      published: cycle.deadlinePublish,
      appealing: cycle.deadlineAppeal,
    };
    return deadlines[task.status as TaskStatus] ?? null;
  }

  private parsePublishVisibleFields(value: Prisma.JsonValue): PublishVisibleFields {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return DEFAULT_PUBLISH_VISIBLE_FIELDS;
    }
    return { ...DEFAULT_PUBLISH_VISIBLE_FIELDS, ...(value as PublishVisibleFields) };
  }

  private applyMask(detail: TaskDetail, visible: PublishVisibleFields): TaskDetail {
    const masked = { ...detail };

    if (!visible.total_score) {
      masked.totalScore = null;
      if (masked.gradeResult) {
        masked.gradeResult.calculatedScore = null;
      }
    }

    if (!visible.grade && masked.gradeResult) {
      masked.gradeResult.rawGrade = null;
      masked.gradeResult.calibratedGrade = null;
    }

    if (!visible.coefficient && masked.gradeResult) {
      masked.gradeResult.coefficient = null;
    }

    masked.indicatorInstances = detail.indicatorInstances.map((ind) => {
      const maskedInd = { ...ind };
      if (!visible.indicator_scores) {
        maskedInd.managerScore = null;
        maskedInd.extraScores = [];
        maskedInd.finalScore = null;
      }
      if (!visible.manager_comment) {
        maskedInd.managerComment = null;
      }
      return maskedInd;
    });

    if (!visible.manager_comment) {
      masked.managerEvalSummary = null;
      if (masked.gradeResult) {
        masked.gradeResult.isVeto = false;
        masked.gradeResult.vetoReason = null;
        masked.gradeResult.vetoOperatorId = null;
        masked.gradeResult.vetoOperatorName = null;
      }
    }

    return masked;
  }

  /** 公示前：员工本人无条件隐藏所有主管评估结果、总分、等级。 */
  private applyPrePublishMask(detail: TaskDetail): TaskDetail {
    const masked = { ...detail };

    masked.totalScore = null;
    masked.rawGrade = null;
    masked.gradeResult = null;
    masked.managerEvalSummary = null;

    masked.indicatorInstances = detail.indicatorInstances.map((ind) => ({
      ...ind,
      managerScore: null,
      managerComment: null,
      extraScores: [],
      finalScore: null,
    }));

    return masked;
  }
}
