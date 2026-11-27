import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { hasApprovedGoalBaseline } from '@/tasks/goal-workflow';
import { ChangeGoal, canGrantChanges, changeOwner, nextChangeStage, validateChangeGoals } from './goal-change-rules';
import { GoalChangeListQueryDto } from './dto/goal-change-list-query.dto';
import { ACTIVE_LIFECYCLE, assertLifecycleActive, canManageLifecycle, lifecycleProjection, lifecycleWhere } from '@/performance-lifecycle/lifecycle-policy';

const actor = { select: { id: true, name: true, status: true, deletedAt: true, archivedAt: true } } as const;
const taskInclude = {
  cycle: true, employee: { select: { ...actor.select, employeeNo: true } }, manager: actor, deptHead: actor, approver: actor,
  goalChangeGrant: true,
  indicatorInstances: { where: { retiredAt: null }, orderBy: { sortOrder: 'asc' as const } },
  indicatorVersions: { where: { status: 'active' as const }, orderBy: { version: 'desc' as const }, take: 1 },
  periods: { orderBy: { sequence: 'asc' as const }, include: { indicatorReviews: true, revisions: { select: { id: true }, take: 1 } } },
} satisfies Prisma.AssessmentTaskInclude;
type Task = Prisma.AssessmentTaskGetPayload<{ include: typeof taskInclude }>;
type Request = Prisma.GoalChangeRequestGetPayload<Record<string, never>>;
type Versioned = { expectedRevision: number };
const ongoing = { notIn: ['active', 'revoked'] };

@Injectable()
export class GoalChangesService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  private canView(task: Task, viewer: AuthUser): boolean {
    return viewer.sysRole === 'system_admin' || canManageLifecycle(viewer, 'view') || canGrantChanges(viewer, task.cycle)
      || [task.employeeId, task.managerId, task.deptHeadId, task.approverId].includes(viewer.id);
  }

  private assertView(task: Task, viewer: AuthUser) {
    if (!this.canView(task, viewer)) throw new ForbiddenException('无权查看该目标变更');
  }

  private assertGrant(task: Task, viewer: AuthUser) {
    if (!canGrantChanges(viewer, task.cycle)) throw new ForbiddenException('仅负责该周期的HR可开放或撤销变更');
  }

  private assertRevision(actual: number, expected?: number) {
    if (!Number.isInteger(expected) || expected! < 0) throw new BadRequestException('缺少有效读取版本，请刷新');
    if (actual !== expected) throw new ConflictException('内容已更新，请刷新后重试');
  }

  private available(person: { status: string; deletedAt: Date | null; archivedAt: Date | null } | null | undefined) {
    return Boolean(person && ['active', 'probation'].includes(person.status) && !person.deletedAt && !person.archivedAt);
  }

  private eligiblePeriods(task: Task) {
    return task.periods.filter((period) => ['unopened', 'self_eval'].includes(period.status)
      && !period.employeeSubmittedAt && !period.managerSubmittedAt && !period.lockedAt && !period.revisions.length);
  }

  private assertEligible(task: Task) {
    assertLifecycleActive(task);
    if (!this.available(task.employee) || task.isExempt || task.participantDisposition !== 'active') {
      throw new ConflictException('员工已不在本周期有效参与范围');
    }
    if (!hasApprovedGoalBaseline(task) || ['published', 'confirmed', 'appealing', 'closed'].includes(task.status)
      || ['published', 'closed'].includes(task.cycle.status)) throw new ConflictException('该周期当前不能变更已确认目标');
    if (task.periods.length ? !this.eligiblePeriods(task).length : Boolean(task.selfEvalSubmittedAt || task.managerScoredAt)) {
      throw new ConflictException('已无尚未提交自评或评分的月份，不能变更目标');
    }
  }

  private baseline(task: Task): ChangeGoal[] {
    return task.indicatorInstances.map((item) => ({
      sourceInstanceId: item.id, name: item.name, description: item.description, scoringStandard: item.scoringStandard,
      targetValue: item.targetValue?.toNumber() ?? null, targetValueText: item.targetValueText, unit: item.unit,
      weight: item.weight.toNumber(), indicatorType: item.indicatorType, dimensionName: item.dimensionName,
      dimensionWeight: item.dimensionWeight.toNumber(), sortOrder: item.sortOrder,
    }));
  }

  private goalArray(value: Prisma.JsonValue): ChangeGoal[] { return value as unknown as ChangeGoal[]; }

  private actions(request: Request, task: Task, viewer: AuthUser): string[] {
    if ((request.lifecycleStatus && request.lifecycleStatus !== 'active') || (task.lifecycleStatus && task.lifecycleStatus !== 'active')) return [];
    if (viewer.isAssessorOnly) return [];
    const result: string[] = [];
    if (canGrantChanges(viewer, task.cycle) && !['active', 'revoked'].includes(request.status)) result.push('revoke');
    try { this.assertEligible(task); } catch { return result; }
    if (task.goalChangeGrant?.state !== 'open') return result;
    if (['draft', 'revision'].includes(request.status) && request.creatorId === viewer.id
      && [task.employeeId, task.managerId].includes(viewer.id)) result.push('edit', 'submit');
    if (changeOwner(task, request.status) === viewer.id) result.push('decide');
    return result;
  }

  private async map(request: Request, task: Task, viewer: AuthUser, creatorName?: string) {
    const creator = creatorName === undefined
      ? await this.prisma.user.findUnique({ where: { id: request.creatorId }, select: { name: true } })
      : { name: creatorName };
    let workflowIssue: string | null = null;
    if (!['active', 'revoked'].includes(request.status)) {
      try { this.assertEligible(task); } catch (error) { workflowIssue = error instanceof Error ? error.message : '当前不能办理'; }
    }
    return { ...request, employeeId: task.employeeId, managerId: task.managerId, employeeName: task.employee.name,
      cycleName: task.cycle.name, creatorName: creator?.name ?? '', canGrant: canGrantChanges(viewer, task.cycle), workflowIssue,
      ...lifecycleProjection('goal_change', request, viewer),
      currentOwnerId: (!request.lifecycleStatus || request.lifecycleStatus === 'active') && (!task.lifecycleStatus || task.lifecycleStatus === 'active')
        ? (['draft', 'revision'].includes(request.status) ? request.creatorId : changeOwner(task, request.status)) : null,
      allowedActions: [...this.actions(request, task, viewer), ...lifecycleProjection('goal_change', request, viewer).allowedActions] };
  }

  async context(viewer: AuthUser) {
    const tasks = await this.prisma.assessmentTask.findMany({ where: { AND: [this.scope(viewer), ACTIVE_LIFECYCLE] }, include: taskInclude, orderBy: { createdAt: 'desc' } });
    const result: Array<Record<string, unknown>> = [];
    for (const task of tasks) {
      if (!this.canView(task, viewer)) continue;
      try { this.assertEligible(task); } catch { continue; }
      const request = await this.prisma.goalChangeRequest.findFirst({ where: { taskId: task.id, status: ongoing, ...ACTIVE_LIFECYCLE }, select: { id: true } });
      result.push({ id: task.id, cycleId: task.cycleId, cycleName: task.cycle.name, employeeId: task.employeeId,
        employeeName: task.employee.name, employeeNo: task.employee.employeeNo, managerId: task.managerId,
        managerName: task.manager?.name ?? '', grant: task.goalChangeGrant, requestId: request?.id ?? null,
        canGrant: canGrantChanges(viewer, task.cycle), canStart: !viewer.isAssessorOnly && !request
          && task.goalChangeGrant?.state === 'open' && [task.employeeId, task.managerId].includes(viewer.id) });
    }
    return { canGrant: !viewer.isAssessorOnly && (viewer.sysRole === 'hr'
      || (viewer.sysRole === 'hr_user' && Boolean(viewer.hrCapabilities?.includes('cycle_plan_edit')))), tasks: result };
  }

  async entry(viewer: AuthUser) {
    const history = await this.prisma.goalChangeRequest.findFirst({ where: { task: this.scope(viewer) }, select: { id: true } });
    if (history) return { visible: true };
    if (viewer.isAssessorOnly) return { visible: false };
    const tasks = await this.prisma.assessmentTask.findMany({
      where: { AND: [this.scope(viewer), { goalChangeGrant: { is: { state: 'open' } } },
        { OR: [{ employeeId: viewer.id }, { managerId: viewer.id }] }] }, include: taskInclude,
    });
    return { visible: tasks.some((task) => {
      try { this.assertEligible(task); return true; } catch { return false; }
    }) };
  }

  async findAll(viewer: AuthUser) {
    const requests = await this.prisma.goalChangeRequest.findMany({ where: { task: this.scope(viewer), lifecycleStatus: { not: 'deleted' } }, orderBy: { updatedAt: 'desc' } });
    const result: Array<Awaited<ReturnType<GoalChangesService['map']>>> = [];
    for (const request of requests) {
      const task = await this.prisma.assessmentTask.findUnique({ where: { id: request.taskId }, include: taskInclude });
      if (task && this.canView(task, viewer)) result.push(await this.map(request, task, viewer));
    }
    return result;
  }

  async findPage(query: GoalChangeListQueryDto, viewer: AuthUser) {
    const id = viewer.id;
    const scoped: Prisma.GoalChangeRequestWhereInput = query.scope === 'self'
      ? { task: { employeeId: id } }
      : query.scope === 'team'
        ? { task: { managerId: id, NOT: { employeeId: id } } }
        : query.scope === 'review'
          ? { OR: [
            { status: 'indicator_reviewing', task: { managerId: id } },
            { status: 'indicator_dept_reviewing', task: { deptHeadId: id } },
            { status: 'indicator_confirming', task: { employeeId: id } },
            { status: 'indicator_approving', task: { approverId: id } },
          ] }
          : {};
    const keyword = query.keyword?.trim();
    const where: Prisma.GoalChangeRequestWhereInput = { AND: [
      { task: this.scope(viewer) }, scoped,
      lifecycleWhere(query.lifecycleStatus, viewer),
      ...(query.status ? [{ status: query.status }] : []),
      ...(keyword ? [{ OR: [
        { task: { employee: { name: { contains: keyword, mode: 'insensitive' } } } },
        { task: { cycle: { name: { contains: keyword, mode: 'insensitive' } } } },
        { creator: { name: { contains: keyword, mode: 'insensitive' } } },
        { reason: { contains: keyword, mode: 'insensitive' } },
      ] } satisfies Prisma.GoalChangeRequestWhereInput] : []),
    ] };
    const [total, requests] = await Promise.all([
      this.prisma.goalChangeRequest.count({ where }),
      this.prisma.goalChangeRequest.findMany({ where, skip: query.skip, take: query.take,
        include: { task: { include: taskInclude }, creator: { select: { name: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }),
    ]);
    const items = await Promise.all(requests.map(({ task, creator, ...request }) => this.map(request, task, viewer, creator.name)));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async myPending(viewer: AuthUser) {
    if (viewer.isAssessorOnly) return [];
    const id = viewer.id;
    const requests = await this.prisma.goalChangeRequest.findMany({
      where: { ...ACTIVE_LIFECYCLE, task: ACTIVE_LIFECYCLE, OR: [
        { status: { in: ['draft', 'revision'] }, creatorId: id, task: { OR: [{ employeeId: id }, { managerId: id }] } },
        { status: 'indicator_reviewing', task: { managerId: id } },
        { status: 'indicator_dept_reviewing', task: { deptHeadId: id } },
        { status: 'indicator_confirming', task: { employeeId: id } },
        { status: 'indicator_approving', task: { approverId: id } },
      ] },
      include: { task: { include: taskInclude }, creator: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const rows = await Promise.all(requests.map(async ({ task, creator, ...request }) => {
      if (!task || !this.canView(task, viewer)) return null;
      const row = await this.map(request, task, viewer, creator.name);
      return row.allowedActions.some((action) => ['edit', 'submit', 'decide'].includes(action)) ? row : null;
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  }

  private scope(viewer: AuthUser): Prisma.AssessmentTaskWhereInput {
    if (viewer.sysRole === 'system_admin' || viewer.sysRole === 'hr' || canManageLifecycle(viewer, 'view')) return {};
    return { OR: [{ employeeId: viewer.id }, { managerId: viewer.id }, { deptHeadId: viewer.id }, { approverId: viewer.id },
      ...(viewer.sysRole === 'hr_user' && viewer.hrCapabilities?.includes('cycle_plan_edit')
        ? [{ cycle: { hrOwnerId: viewer.id } }] : [])] };
  }

  async findOne(id: string, viewer: AuthUser) {
    const request = await this.prisma.goalChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('目标变更不存在');
    const task = await this.prisma.assessmentTask.findUnique({ where: { id: request.taskId }, include: taskInclude });
    if (!task) throw new NotFoundException('考核任务不存在');
    this.assertView(task, viewer);
    const records = await this.prisma.auditLog.findMany({ where: { entityType: 'goal_change', entityId: id },
      include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
    const eligible = new Set(this.eligiblePeriods(task).map((period) => period.id));
    return { ...await this.map(request, task, viewer), records: records.map((record) => ({
      id: record.id, action: record.action, actorName: record.user?.name ?? '系统', createdAt: record.createdAt, newValue: record.newValue,
    })), protectedPeriodKeys: task.periods.filter((period) => !eligible.has(period.id)).map((period) => period.periodKey) };
  }

  private async lockTask(tx: Prisma.TransactionClient, taskId: string): Promise<Task> {
    // Monthly submissions claim a period before updating its task; keep the same lock order.
    await tx.$queryRaw`SELECT id FROM assessment_periods WHERE task_id=${taskId}::uuid ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM assessment_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
    const task = await tx.assessmentTask.findUnique({ where: { id: taskId }, include: taskInclude });
    if (!task) throw new NotFoundException('考核任务不存在');
    assertLifecycleActive(task);
    return task;
  }

  private async audit(tx: Prisma.TransactionClient, id: string, viewer: AuthUser, action: string, value: unknown) {
    await tx.auditLog.create({ data: { userId: viewer.id, entityType: 'goal_change', entityId: id, action,
      newValue: value as Prisma.InputJsonValue } });
  }

  async openGrant(input: { taskId: string; expectedRevision?: number }, viewer: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, input.taskId);
      this.assertGrant(task, viewer);
      this.assertEligible(task);
      if (await tx.goalChangeRequest.count({ where: { taskId: task.id, status: ongoing, ...ACTIVE_LIFECYCLE } })) throw new ConflictException('该员工已有进行中的目标变更');
      const grant = await tx.goalChangeGrant.findUnique({ where: { taskId: task.id } });
      if (grant) {
        this.assertRevision(grant.revision, input.expectedRevision);
        if (grant.state === 'open') throw new ConflictException('目标变更已开放');
        await tx.goalChangeGrant.update({ where: { taskId: task.id }, data: { state: 'open', revision: { increment: 1 }, grantedById: viewer.id, updatedAt: new Date() } });
      } else {
        await tx.goalChangeGrant.create({ data: { taskId: task.id, grantedById: viewer.id } });
      }
      await this.audit(tx, task.id, viewer, 'open_goal_change', { taskId: task.id });
    });
    await this.notifyTaskActors(input.taskId, viewer, '目标变更已开放');
    return this.context(viewer);
  }

  async revokeGrant(taskId: string, input: Versioned, viewer: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId);
      this.assertGrant(task, viewer);
      const grant = await tx.goalChangeGrant.findUnique({ where: { taskId } });
      if (!grant || grant.state !== 'open') throw new ConflictException('变更资格已关闭');
      this.assertRevision(grant.revision, input.expectedRevision);
      await tx.goalChangeGrant.update({ where: { taskId }, data: { state: 'revoked', revision: { increment: 1 }, updatedAt: new Date() } });
      const requests = await tx.goalChangeRequest.findMany({ where: { taskId, status: ongoing, ...ACTIVE_LIFECYCLE } });
      for (const request of requests) {
        await tx.goalChangeRequest.update({ where: { id: request.id }, data: { status: 'revoked', revision: { increment: 1 }, updatedAt: new Date() } });
        await this.audit(tx, request.id, viewer, 'revoke', { status: 'revoked' });
      }
      await this.audit(tx, taskId, viewer, 'revoke_goal_change', { taskId });
    });
    return this.context(viewer);
  }

  async create(input: { taskId: string }, viewer: AuthUser) {
    const id = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, input.taskId);
      if (viewer.isAssessorOnly || ![task.employeeId, task.managerId].includes(viewer.id)) throw new ForbiddenException('仅员工本人和冻结的绩效直属上级可发起');
      this.assertEligible(task);
      const grant = await tx.goalChangeGrant.findUnique({ where: { taskId: task.id } });
      if (grant?.state !== 'open') throw new ForbiddenException('请先由HR开放本人的目标变更');
      if (await tx.goalChangeRequest.count({ where: { taskId: task.id, status: ongoing, ...ACTIVE_LIFECYCLE } })) throw new ConflictException('该任务已有进行中的变更');
      const beforeGoals = this.baseline(task);
      const request = await tx.goalChangeRequest.create({ data: { taskId: task.id, creatorId: viewer.id,
        beforeGoals: beforeGoals as unknown as Prisma.InputJsonValue, goals: beforeGoals as unknown as Prisma.InputJsonValue,
        baselineVersionId: task.indicatorVersions[0]?.id ?? null } });
      await this.audit(tx, request.id, viewer, 'create', { status: 'draft' });
      return request.id;
    });
    return this.findOne(id, viewer);
  }

  private async mutate(id: string, expected: number, viewer: AuthUser,
    action: (tx: Prisma.TransactionClient, request: Request, task: Task) => Promise<void>, requireEligible = true) {
    const identity = await this.prisma.goalChangeRequest.findUnique({ where: { id }, select: { taskId: true } });
    if (!identity) throw new NotFoundException('目标变更不存在');
    await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, identity.taskId);
      const request = await tx.goalChangeRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('目标变更不存在');
      assertLifecycleActive(request);
      this.assertView(task, viewer);
      this.assertRevision(request.revision, expected);
      if (viewer.isAssessorOnly) throw new ForbiddenException('当前账号不能办理变更');
      const grant = await tx.goalChangeGrant.findUnique({ where: { taskId: task.id } });
      if (grant?.state !== 'open' || ['active', 'revoked'].includes(request.status)) throw new ConflictException('目标变更已关闭');
      if (requireEligible) this.assertEligible(task);
      await action(tx, request, task);
    });
    return this.findOne(id, viewer);
  }

  private async write(tx: Prisma.TransactionClient, request: Request, viewer: AuthUser, action: string,
    data: Prisma.GoalChangeRequestUpdateManyMutationInput, extra: Record<string, unknown> = {}) {
    const result = await tx.goalChangeRequest.updateMany({ where: { id: request.id, ...ACTIVE_LIFECYCLE, revision: request.revision, status: request.status },
      data: { ...data, revision: { increment: 1 }, updatedAt: new Date() } });
    if (result.count !== 1) throw new ConflictException('变更已由其他人处理，请刷新');
    await this.audit(tx, request.id, viewer, action, { previousStatus: request.status, status: data.status ?? request.status, ...extra });
  }

  async update(id: string, input: Versioned & { reason: string; goals: ChangeGoal[] }, viewer: AuthUser) {
    return this.mutate(id, input.expectedRevision, viewer, async (tx, request, task) => {
      if (!this.actions(request, task, viewer).includes('edit')) throw new ForbiddenException('仅发起人可修改待提交变更');
      const goals = validateChangeGoals(input.goals, this.goalArray(request.beforeGoals));
      await this.write(tx, request, viewer, 'save_draft', { reason: input.reason.trim(), goals: goals as unknown as Prisma.InputJsonValue });
    });
  }

  private assertReviewActors(task: Task) {
    const actors = task.cycle.goalWorkflowVersion >= 2
      ? [task.manager, task.deptHead, task.approver] : [task.manager];
    if (actors.some((person) => !this.available(person))) throw new ConflictException('审批人员缺失、离职或已归档，请联系HR维护本周期审批关系');
  }

  async submit(id: string, input: Versioned & { reason?: string; goals?: ChangeGoal[] }, viewer: AuthUser) {
    const result = await this.mutate(id, input.expectedRevision, viewer, async (tx, request, task) => {
      if (!this.actions(request, task, viewer).includes('submit')) throw new ForbiddenException('当前不能提交此变更');
      if ((input.reason === undefined) !== (input.goals === undefined)
        || (input.reason !== undefined && (typeof input.reason !== 'string' || !Array.isArray(input.goals)))) {
        throw new BadRequestException('请同时提交变更原因和目标');
      }
      const reason = (input.reason ?? request.reason)?.trim();
      if (!reason) throw new BadRequestException('请填写变更原因');
      const goals = validateChangeGoals(input.goals ?? this.goalArray(request.goals), this.goalArray(request.beforeGoals));
      this.assertReviewActors(task);
      const next = nextChangeStage(task, 'indicator_drafting', task.cycle.goalWorkflowVersion);
      await this.write(tx, request, viewer, 'submit', {
        status: next.status, reason, goals: goals as unknown as Prisma.InputJsonValue,
      }, { skipped: next.skipped });
    });
    await this.notifyOwner(result, viewer);
    return result;
  }

  async decide(id: string, input: Versioned & { approve: boolean; comment?: string }, viewer: AuthUser) {
    const result = await this.mutate(id, input.expectedRevision, viewer, async (tx, request, task) => {
      if (changeOwner(task, request.status) !== viewer.id) throw new ForbiddenException('当前不是你的目标变更待办');
      if (!input.approve && !input.comment?.trim()) throw new BadRequestException('退回必须填写意见');
      this.assertReviewActors(task);
      const next = input.approve ? nextChangeStage(task, request.status, task.cycle.goalWorkflowVersion) : { status: 'revision', skipped: [] };
      const versionId = next.status === 'active' ? await this.activate(tx, request, task, viewer) : null;
      await this.write(tx, request, viewer, input.approve ? 'approve' : 'reject', {
        status: next.status, ...(versionId ? { effectiveVersionId: versionId } : {}),
      }, { comment: input.comment?.trim() ?? '', skipped: next.skipped, effectiveVersionId: versionId });
    });
    await this.notifyOwner(result, viewer);
    return result;
  }

  async revoke(id: string, input: Versioned, viewer: AuthUser) {
    return this.mutate(id, input.expectedRevision, viewer, async (tx, request, task) => {
      this.assertGrant(task, viewer);
      await this.write(tx, request, viewer, 'revoke', { status: 'revoked' });
      await tx.goalChangeGrant.update({ where: { taskId: task.id }, data: { state: 'revoked', revision: { increment: 1 }, updatedAt: new Date() } });
    }, false);
  }

  private async activate(tx: Prisma.TransactionClient, request: Request, original: Task, viewer: AuthUser): Promise<string> {
    // Period draftVersion claims make a concurrent old-page submission fail rather than write against new goals.
    const task = await tx.assessmentTask.findUniqueOrThrow({ where: { id: original.id }, include: taskInclude });
    this.assertEligible(task);
    if ((task.indicatorVersions[0]?.id ?? null) !== request.baselineVersionId) throw new ConflictException('原目标版本已变化，请重新发起');
    const goals = validateChangeGoals(this.goalArray(request.goals), this.goalArray(request.beforeGoals));
    const latest = await tx.indicatorVersion.findFirst({ where: { taskId: task.id }, orderBy: { version: 'desc' } });
    const eligible = this.eligiblePeriods(task);
    const version = await tx.indicatorVersion.create({ data: { taskId: task.id, version: (latest?.version ?? 0) + 1,
      status: 'active', effectiveFromPeriodKey: eligible[0]?.periodKey ?? 'cycle', reason: request.reason,
      createdById: viewer.id, activatedAt: new Date() } });
    await tx.indicatorVersion.updateMany({ where: { taskId: task.id, status: 'active', id: { not: version.id } }, data: { status: 'retired' } });
    const retained = goals.map((goal) => goal.sourceInstanceId).filter((id): id is string => Boolean(id));
    await tx.indicatorInstance.updateMany({ where: { taskId: task.id, retiredAt: null, id: { notIn: retained } }, data: { retiredAt: new Date() } });
    const newItemBySource = new Map<string, string>();
    for (const goal of goals) {
      const { sourceInstanceId, ...fields } = goal;
      const instance = sourceInstanceId
        ? await tx.indicatorInstance.update({ where: { id: sourceInstanceId, taskId: task.id, retiredAt: null }, data: fields })
        : await tx.indicatorInstance.create({ data: { ...fields, taskId: task.id } });
      const item = await tx.indicatorVersionItem.create({ data: { ...fields, sourceInstanceId: instance.id, indicatorVersionId: version.id } });
      newItemBySource.set(instance.id, item.id);
    }
    for (const period of eligible) {
      const oldItems = period.indicatorVersionId ? await tx.indicatorVersionItem.findMany({ where: { indicatorVersionId: period.indicatorVersionId } }) : [];
      const sourceByOld = new Map(oldItems.map((item) => [item.id, item.sourceInstanceId]));
      for (const review of period.indicatorReviews) {
        const source = sourceByOld.get(review.indicatorVersionItemId);
        const replacement = source && newItemBySource.get(source);
        if (!replacement) continue;
        await tx.assessmentPeriodIndicatorReview.update({ where: { id: review.id }, data: { indicatorVersionItemId: replacement } });
      }
      // Removed unsubmitted draft rows remain in the old version; the new period view only reads its new item set.
      await tx.assessmentPeriod.update({ where: { id: period.id }, data: { indicatorVersionId: version.id, draftVersion: { increment: 1 }, updatedAt: new Date() } });
    }
    await tx.assessmentTask.update({ where: { id: task.id }, data: { updatedAt: new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1)) } });
    await tx.goalChangeGrant.update({ where: { taskId: task.id }, data: { state: 'consumed', revision: { increment: 1 }, updatedAt: new Date() } });
    await this.audit(tx, request.id, viewer, 'activate', { versionId: version.id,
      affectedPeriods: eligible.map((period) => period.periodKey), protectedPeriods: task.periods.filter((period) => !eligible.some((item) => item.id === period.id)).map((period) => period.periodKey) });
    return version.id;
  }

  private async notifyTaskActors(taskId: string, viewer: AuthUser, title: string) {
    const task = await this.prisma.assessmentTask.findUnique({ where: { id: taskId, ...ACTIVE_LIFECYCLE }, select: { employeeId: true, managerId: true } });
    if (task) await Promise.allSettled([...new Set([task.employeeId, task.managerId].filter((id): id is string => Boolean(id)))].map((id) => this.notify(id, viewer.id, title, '/goal-changes', taskId)));
  }

  private async notifyOwner(request: { id: string; currentOwnerId: string | null; status: string; taskId: string }, viewer: AuthUser) {
    if (request.status === 'active') return this.notifyTaskActors(request.taskId, viewer, '目标变更已生效');
    if (request.currentOwnerId) await this.notify(request.currentOwnerId, viewer.id, '目标变更待处理', `/goal-changes/${request.id}`);
  }

  private async notify(userId: string, senderId: string, title: string, path: string, taskId?: string) {
    if (userId === senderId) return;
    const goalChangeId = path.startsWith('/goal-changes/') ? path.slice('/goal-changes/'.length) : undefined;
    try { await this.notifications.create({ userId, senderId, taskId, type: 'goal_change', title, content: '请在目标变更中查看。', extraData: { path, ...(goalChangeId ? { goalChangeId } : {}) } }); }
    catch { /* 通知不影响事务；待办以申请状态为准。 */ }
  }
}
