import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentTask, IndicatorVisibilityScope, ObjectiveLevel, Prisma, SysRole, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { Paginated, paginated } from '@/common/dto/pagination.dto';
import { ScoringService } from './scoring.service';
import { FlowService } from './flow.service';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateActualValueDto } from './dto/update-actual-value.dto';
import { SubmitSelfEvalDto } from './dto/submit-self-eval.dto';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';
import { DeptReviewDto } from './dto/dept-review.dto';
import { SubmitIndicatorProposalDto } from './dto/submit-indicator-proposal.dto';
import { SetIndicatorItemDto, SetIndicatorsDto } from './dto/set-indicators.dto';
import { ObjectivesService } from '@/objectives/objectives.service';
import { IndicatorReferenceItem, IndicatorVisibilityService } from './indicator-visibility.service';
import { ReferenceIndicatorQueryDto } from './dto/reference-indicator-query.dto';
import { assertTaskVersion, taskVersionConflict } from './task-version';

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
  totalScore: number | null;
  rawGrade: string | null;
  updatedAt: Date;
}

/** 任务详情。 */
export interface TaskDetail extends TaskListItem {
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly scoringService: ScoringService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
    private readonly indicatorVisibility: IndicatorVisibilityService,
    private readonly objectivesService: ObjectivesService,
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
        employee: { select: { name: true } },
        dept: { select: { name: true } },
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
        gradeResult: true,
        performanceInterview: true,
        flowRecords: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { name: true } } },
        },
        cycle: { select: { publishVisibleFields: true } },
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

    const result = await this.flowService.transition({
      task,
      action: 'submit',
      targetStatus: 'self_eval',
      actorId: viewer.id,
      taskUpdate: { indicatorConfirmedAt: new Date() },
    });

    await this.notificationsService.create({
      userId: task.employeeId,
      senderId: viewer.id,
      cycleId: task.cycleId,
      taskId: task.id,
      type: 'indicator_confirmed',
      title: '指标已确认，请进行自评',
      content: '您的考核指标已确认，请及时完成自评。',
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

    const result = await this.flowService.transition({
      task,
      action: 'reject',
      targetStatus,
      actorId: viewer.id,
      comment,
      extraData: { reason: comment },
      taskUpdate: { indicatorConfirmedAt: null },
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
        message: '只有指标制定中才允许维护本周期指标',
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

    if (!isEmployee && !isManager && !isAdmin) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权限维护该任务指标' });
    }
    if ((isEmployee && !isDraftStatus) || ((isManager || isAdmin) && !isReviewStatus)) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '只有指标制定中才允许维护本周期指标',
      });
    }

    const validItems = this.normalizeIndicatorItems(dto.instances ?? []);
    if (!validItems.length) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '请至少保留一条指标' });
    }

    for (const item of validItems) {
      await this.indicatorVisibility.validateSelection(item, task, viewer);
    }

    const note = dto.note?.trim() || undefined;
    let submittedToReview = false;
    let approvedForEmployeeConfirm = false;
    await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await this.claimTaskVersion(tx, task.id, dto.expectedUpdatedAt);
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
              type: isEmployee ? 'indicator_draft_saved' : 'indicator_review_saved',
              source: isEmployee ? 'employee' : isAdmin ? 'admin' : 'manager',
              count: validItems.length,
            },
          },
        });
        return;
      }

      if (isEmployee) {
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

      if (isManager || isAdmin) {
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

  /** POST /tasks/:id/manager-score */
  async submitManagerScore(
    id: string,
    dto: SubmitManagerScoreDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id, { snapshot: { select: { snapshotData: true } } });
    this.assertManager(task, viewer);

    const snapshotData = (task.snapshot?.snapshotData ?? {}) as { maxScore?: number };
    const maxScore = typeof snapshotData.maxScore === 'number' ? snapshotData.maxScore : 100;

    if (dto.veto?.isVeto && (!dto.veto.vetoReason || dto.veto.vetoReason.trim() === '')) {
      throw new ConflictException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '一票否决必须填写原因',
      });
    }

    const targetStatus = task.managerId === task.deptHeadId ? 'hr_calibration' : 'dept_review';

    await this.prisma.$transaction(async (tx) => {
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
          submittedAt: new Date(),
        },
        update: {
          strengths: dto.evalSummary.strengths ?? null,
          improvements: dto.evalSummary.improvements ?? null,
          developmentPlan: dto.evalSummary.developmentPlan ?? null,
          attachments: (dto.evalSummary.attachments as Prisma.InputJsonValue) ?? [],
          submittedAt: new Date(),
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

      await tx.gradeResult.upsert({
        where: { taskId: id },
        create: {
          taskId: id,
          calculatedScore: scoreResult.totalScore,
          rawGrade: scoreResult.rawGrade,
          isVeto: dto.veto?.isVeto ?? false,
          vetoReason: dto.veto?.isVeto ? (dto.veto.vetoReason ?? null) : null,
          vetoOperatorId: dto.veto?.isVeto ? viewer.id : null,
          calibratedGrade: dto.veto?.isVeto ? 'D' : undefined,
        },
        update: {
          calculatedScore: scoreResult.totalScore,
          rawGrade: scoreResult.rawGrade,
          isVeto: dto.veto?.isVeto ?? false,
          vetoReason: dto.veto?.isVeto ? (dto.veto.vetoReason ?? null) : null,
          vetoOperatorId: dto.veto?.isVeto ? viewer.id : null,
          calibratedGrade: dto.veto?.isVeto ? 'D' : undefined,
        },
      });

      await this.flowService.transitionTx(tx, {
        task,
        action: 'submit',
        targetStatus,
        actorId: viewer.id,
        taskUpdate: { managerScoredAt: new Date() },
      });
    });

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
      // 主管即部门负责人，直接到 HR 校准：通知 HR（这里发给 cycle.createdBy 作为经办人，或泛化通知 HR 角色）
      await this.notifyHr(task, viewer, '主管评分待 HR 校准', '主管已完成评分，请进行 HR 校准。');
    }

    return { id: task.id, status: targetStatus };
  }

  /** POST /tasks/:id/dept-review */
  async deptReview(id: string, dto: DeptReviewDto, viewer: AuthUser): Promise<{ id: string; status: TaskStatus }> {
    const task = await this.getTaskOrThrow(id);
    this.assertDeptHead(task, viewer);

    if (dto.action === 'approve') {
      await this.prisma.$transaction(async (tx) => {
        await this.flowService.transitionTx(tx, {
          task,
          action: 'approve',
          targetStatus: 'hr_calibration',
          actorId: viewer.id,
          comment: dto.comment,
          taskUpdate: { deptReviewedAt: new Date() },
        });
      });

      await this.notifyHr(task, viewer, '部门复核通过，待 HR 校准', '部门负责人已复核通过，请进行 HR 校准。');
      return { id: task.id, status: 'hr_calibration' };
    }

    // reject
    await this.prisma.$transaction(async (tx) => {
      await this.flowService.transitionTx(tx, {
        task,
        action: 'reject',
        targetStatus: 'manager_scoring',
        actorId: viewer.id,
        comment: dto.comment,
        taskUpdate: { deptReviewedAt: null },
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
    // 先尝试通知周期创建人
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: task.cycleId },
      select: { createdBy: true },
    });
    if (cycle?.createdBy) {
      await this.notificationsService.create({
        userId: cycle.createdBy,
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

  private async claimTaskVersion(
    tx: Prisma.TransactionClient,
    taskId: string,
    expectedUpdatedAt: string,
  ): Promise<Date> {
    const expected = new Date(expectedUpdatedAt);
    const claimedUpdatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
    const claimed = await tx.assessmentTask.updateMany({
      where: { id: taskId, updatedAt: expected },
      data: { updatedAt: claimedUpdatedAt },
    });

    if (claimed.count !== 1) throw taskVersionConflict();
    return claimedUpdatedAt;
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
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      managerId: task.managerId,
      status: task.status,
      totalScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      updatedAt: task.updatedAt,
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
        maskedInd.finalScore = null;
      }
      if (!visible.manager_comment) {
        maskedInd.managerComment = null;
      }
      return maskedInd;
    });

    if (!visible.manager_comment) {
      masked.managerEvalSummary = null;
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
      finalScore: null,
    }));

    return masked;
  }
}
