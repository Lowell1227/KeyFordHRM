import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ImprovementPlanStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto, paginated } from '@/common/dto/pagination.dto';
import { NotificationsService } from '@/notifications/notifications.service';
import { buildEffectiveApproverMap, DepartmentRelationRecord } from '@/departments/department-relations';
import { ImprovementGoal, ImprovementEvaluation, validateEvaluation, validateGoals } from './improvement-plan-rules';

const planInclude = {
  employee: { select: { id: true, name: true, employeeNo: true, deptId: true, directManagerId: true,
    dept: { select: { name: true } } } },
  cycle: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.ImprovementPlanInclude;
type Plan = Prisma.ImprovementPlanGetPayload<{ include: typeof planInclude }>;

export interface PlanDraftInput {
  employeeId: string;
  cycleId?: string | null;
  improvementNeed?: string;
  targetDate?: string | null;
  goals?: ImprovementGoal[];
}
export interface PlanDecisionInput { approve: boolean; comment?: string }
export interface PlanEvaluationInput { items: Array<{ goalId: string; score: number; comment: string }>; overallComment: string }
export interface PlanEvaluationDraftInput { items: Array<{ goalId: string; score: number | null; comment: string }>; overallComment: string }
export interface PlanQuery { employeeId?: string; cycleId?: string; deptId?: string; keyword?: string; status?: ImprovementPlanStatus }

interface OrgContext {
  employee: { id: string; name: string; deptId: string | null; directManagerId: string | null; status: string; deletedAt: Date | null };
  headId: string | null;
  approverId: string | null;
  managerChain: string[];
  ancestorIds: string[];
  relations: DepartmentRelationRecord[];
}

@Injectable()
export class ImprovementWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  private isGlobalViewer(viewer: AuthUser): boolean {
    return viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin || viewer.canViewAll
      || (viewer.sysRole === SysRole.hr_user && Boolean(
        viewer.hrCapabilities?.includes('cycle_plan_edit') && viewer.hrCapabilities.includes('performance_publish')));
  }

  private async org(employeeId: string): Promise<OrgContext> {
    const employee = await this.prisma.user.findUnique({ where: { id: employeeId }, select: {
      id: true, name: true, deptId: true, directManagerId: true, status: true, deletedAt: true,
    } });
    if (!employee) throw new NotFoundException('员工不存在');
    const departments = await this.prisma.department.findMany({ select: {
      id: true, name: true, parentId: true, leaderId: true, approverId: true,
      leader: { select: { name: true, directManagerId: true, directManager: { select: { name: true } } } },
      approver: { select: { name: true } },
    } });
    const relations: DepartmentRelationRecord[] = departments.map((dept) => ({
      id: dept.id, name: dept.name, parentId: dept.parentId, leaderId: dept.leaderId,
      leaderName: dept.leader?.name ?? null, leaderDirectManagerId: dept.leader?.directManagerId ?? null,
      leaderDirectManagerName: dept.leader?.directManager?.name ?? null,
      approverId: dept.approverId, approverName: dept.approver?.name ?? null,
    }));
    const byId = new Map(relations.map((dept) => [dept.id, dept]));
    const ancestorIds: string[] = [];
    const visited = new Set<string>();
    let current = employee.deptId;
    while (current && !visited.has(current)) {
      visited.add(current);
      ancestorIds.push(current);
      current = byId.get(current)?.parentId ?? null;
    }
    const headId = ancestorIds.map((id) => byId.get(id)?.leaderId)
      .find((id) => Boolean(id && id !== employee.id)) ?? null;
    const approverId = employee.deptId
      ? buildEffectiveApproverMap(relations).get(employee.deptId)?.effectiveApproverId ?? null : null;
    const managerChain = await this.dataScope.getManagerChainIds(employeeId);
    return { employee, headId, approverId, managerChain, ancestorIds, relations };
  }

  private canInitiate(org: OrgContext, viewer: AuthUser): boolean {
    return !viewer.isAssessorOnly && viewer.id !== org.employee.id && (org.managerChain.includes(viewer.id)
      || org.ancestorIds.some((id) => org.relations.find((dept) => dept.id === id)?.leaderId === viewer.id));
  }

  private canView(plan: Plan, org: OrgContext, viewer: AuthUser): boolean {
    return this.isGlobalViewer(viewer) || viewer.id === plan.employeeId || viewer.id === plan.creatorId
      || this.canInitiate(org, viewer) || viewer.id === org.approverId;
  }

  private assertNew(plan: Plan): void {
    if (plan.workflowVersion !== 2) throw new ConflictException('历史改进计划仅供查看');
  }

  private async load(id: string): Promise<Plan> {
    const plan = await this.prisma.improvementPlan.findUnique({ where: { id }, include: planInclude });
    if (!plan) throw new NotFoundException('改进计划不存在');
    return plan;
  }

  private goals(plan: Plan): ImprovementGoal[] {
    return Array.isArray(plan.goals) ? plan.goals as unknown as ImprovementGoal[] : [];
  }

  private evaluation(value: Prisma.JsonValue | null): ImprovementEvaluation | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as unknown as ImprovementEvaluation : null;
  }

  private owner(plan: Plan, org: OrgContext): string | null {
    switch (plan.status) {
      case 'draft': case 'goal_revision': return plan.workflowVersion === 2 ? plan.creatorId : null;
      case 'goal_dept_review': case 'dept_review': return org.headId;
      case 'goal_employee_confirm': case 'self_eval': return plan.employeeId;
      case 'manager_review': return org.employee.directManagerId;
      case 'vp_review': return org.approverId;
      default: return null;
    }
  }

  private actions(plan: Plan, org: OrgContext, viewer: AuthUser): string[] {
    if (plan.workflowVersion !== 2 || viewer.id !== this.owner(plan, org)) return [];
    if (plan.status === 'draft' || plan.status === 'goal_revision') return ['edit', 'submit_goals'];
    if (plan.status === 'goal_dept_review' || plan.status === 'goal_employee_confirm') return ['decide_goals'];
    if (plan.status === 'self_eval' || plan.status === 'manager_review' || plan.status === 'dept_review') return ['evaluate'];
    if (plan.status === 'vp_review') return ['decide_final'];
    return [];
  }

  private map(plan: Plan, org: OrgContext, viewer: AuthUser) {
    const hidePendingResult = viewer.id === plan.employeeId && plan.status !== 'completed';
    return {
      id: plan.id, employeeId: plan.employeeId, employeeName: plan.employee.name,
      employeeNo: plan.employee.employeeNo, deptName: plan.employee.dept?.name ?? null,
      cycleId: plan.cycleId, cycleName: plan.cycle?.name ?? null, taskId: plan.taskId,
      creatorId: plan.creatorId, creatorName: plan.creator?.name ?? null,
      improvementNeed: plan.improvementNeed, importance: plan.importance,
      improvementGoal: plan.improvementGoal, targetDate: plan.targetDate,
      measures: plan.measures, goals: this.goals(plan),
      selfEvaluation: this.evaluation(plan.selfEvaluation),
      managerEvaluation: hidePendingResult ? null : this.evaluation(plan.managerEvaluation),
      departmentEvaluation: hidePendingResult ? null : this.evaluation(plan.departmentEvaluation),
      finalScore: hidePendingResult ? null : plan.finalScore, status: plan.status,
      workflowVersion: plan.workflowVersion, startedAt: plan.startedAt, completedAt: plan.completedAt,
      createdAt: plan.createdAt, updatedAt: plan.updatedAt,
      currentOwnerId: this.owner(plan, org), allowedActions: this.actions(plan, org, viewer),
    };
  }

  async findAll(query: PlanQuery, pagination: PaginationDto, viewer: AuthUser) {
    const keyword = query.keyword?.trim();
    const where: Prisma.ImprovementPlanWhereInput = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.deptId || keyword ? { employee: { AND: [
        ...(query.deptId ? [{ deptId: query.deptId }] : []),
        ...(keyword ? [{ OR: [
          { name: { contains: keyword, mode: 'insensitive' as const } },
          { employeeNo: { contains: keyword, mode: 'insensitive' as const } },
        ] }] : []),
      ] } } : {}),
    };
    // ponytail: the roster is small; filter by live organization relationships before paginating.
    const plans = await this.prisma.improvementPlan.findMany({ where, include: planInclude, orderBy: { createdAt: 'desc' } });
    const contexts = new Map<string, OrgContext>();
    const visible: Array<ReturnType<typeof this.map>> = [];
    for (const plan of plans) {
      let org = contexts.get(plan.employeeId);
      if (!org) { org = await this.org(plan.employeeId); contexts.set(plan.employeeId, org); }
      if (this.canView(plan, org, viewer)) visible.push(this.map(plan, org, viewer));
    }
    return paginated(visible.slice(pagination.skip, pagination.skip + pagination.take), visible.length, pagination);
  }

  async findOne(id: string, viewer: AuthUser) {
    const plan = await this.load(id);
    const org = await this.org(plan.employeeId);
    if (!this.canView(plan, org, viewer)) throw new ForbiddenException('无权查看该改进计划');
    const records = await this.prisma.auditLog.findMany({
      where: { entityType: 'improvement_plan', entityId: id }, include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const employeeActions = new Set(['create', 'save_draft', 'submit_goals', 'confirm_goals', 'reject_goals', 'submit_selfEvaluation']);
    const visibleRecords = viewer.id === plan.employeeId && plan.status !== 'completed'
      ? records.filter((record) => employeeActions.has(record.action)
        || (record.action === 'save_evaluation_draft' && (record.oldValue as { status?: string } | null)?.status === 'self_eval'))
      : records;
    return { ...this.map(plan, org, viewer), records: visibleRecords.map((record) => ({
      id: record.id, action: record.action, actorName: record.user?.name ?? '系统',
      createdAt: record.createdAt, oldValue: viewer.id === plan.employeeId ? null : record.oldValue,
      newValue: record.newValue,
    })) };
  }

  async myPending(viewer: AuthUser) {
    const plans = await this.prisma.improvementPlan.findMany({
      where: { workflowVersion: 2, status: { not: 'completed' } }, include: planInclude,
      orderBy: { updatedAt: 'desc' },
    });
    const result: Array<ReturnType<typeof this.map>> = [];
    for (const plan of plans) {
      const org = await this.org(plan.employeeId);
      if (this.owner(plan, org) === viewer.id) result.push(this.map(plan, org, viewer));
    }
    return result;
  }

  async eligibleEmployees(viewer: AuthUser) {
    if (viewer.isAssessorOnly) return [];
    const users = await this.prisma.user.findMany({
      select: { id: true, name: true, employeeNo: true, deptId: true, directManagerId: true,
        status: true, deletedAt: true, dept: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const departments = await this.prisma.department.findMany({ select: { id: true, parentId: true, leaderId: true } });
    const managerByUser = new Map(users.map((user) => [user.id, user.directManagerId]));
    const departmentById = new Map(departments.map((department) => [department.id, department]));
    const result: Array<{ id: string; name: string; employeeNo: string | null; deptName: string | null }> = [];
    for (const employee of users) {
      if (employee.status !== 'active' || employee.deletedAt || employee.id === viewer.id) continue;
      let inScope = false;
      let managerId = employee.directManagerId;
      const seenUsers = new Set([employee.id]);
      while (managerId && !seenUsers.has(managerId)) {
        if (managerId === viewer.id) { inScope = true; break; }
        seenUsers.add(managerId);
        managerId = managerByUser.get(managerId) ?? null;
      }
      let departmentId = employee.deptId;
      const seenDepartments = new Set<string>();
      while (!inScope && departmentId && !seenDepartments.has(departmentId)) {
        seenDepartments.add(departmentId);
        const department = departmentById.get(departmentId);
        if (department?.leaderId === viewer.id) inScope = true;
        departmentId = department?.parentId ?? null;
      }
      if (inScope) result.push({ id: employee.id, name: employee.name,
        employeeNo: employee.employeeNo, deptName: employee.dept?.name ?? null });
    }
    return result;
  }

  async cycleOptions() {
    return this.prisma.assessmentCycle.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(input: PlanDraftInput, viewer: AuthUser) {
    const org = await this.org(input.employeeId);
    if (org.employee.status !== 'active' || org.employee.deletedAt) throw new BadRequestException('只能为在职员工创建改进计划');
    if (!this.canInitiate(org, viewer)) throw new ForbiddenException('只能为管理范围内的员工发起改进计划');
    if (input.cycleId && !await this.prisma.assessmentCycle.findUnique({ where: { id: input.cycleId }, select: { id: true } })) {
      throw new BadRequestException('所选绩效周期不存在');
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.improvementPlan.create({ data: {
        employeeId: input.employeeId, cycleId: input.cycleId || null, taskId: null, creatorId: viewer.id,
        workflowVersion: 2, status: 'draft', improvementNeed: input.improvementNeed?.trim() || null,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        goals: (input.goals ?? []) as unknown as Prisma.InputJsonValue,
      }, include: planInclude });
      await tx.auditLog.create({ data: { userId: viewer.id, action: 'create', entityType: 'improvement_plan',
        entityId: created.id, newValue: { goals: input.goals ?? [], background: input.improvementNeed ?? '' } as unknown as Prisma.InputJsonValue } });
      return created;
    });
    return this.map(plan, org, viewer);
  }

  async updateDraft(id: string, input: Omit<PlanDraftInput, 'employeeId'>, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (plan.creatorId !== viewer.id) throw new ForbiddenException('仅发起人可修改目标');
    if (!['draft', 'goal_revision'].includes(plan.status)) throw new ConflictException('目标已锁定，不能修改');
    if (input.cycleId && !await this.prisma.assessmentCycle.findUnique({ where: { id: input.cycleId }, select: { id: true } })) {
      throw new BadRequestException('所选绩效周期不存在');
    }
    await this.change(plan, viewer, 'save_draft', {
      improvementNeed: input.improvementNeed?.trim() ?? plan.improvementNeed,
      cycleId: input.cycleId === undefined ? plan.cycleId : input.cycleId || null,
      targetDate: input.targetDate === undefined ? plan.targetDate : input.targetDate ? new Date(input.targetDate) : null,
      goals: (input.goals ?? this.goals(plan)) as unknown as Prisma.InputJsonValue,
    }, { goals: input.goals ?? this.goals(plan), background: input.improvementNeed ?? plan.improvementNeed });
    return this.findOne(id, viewer);
  }

  async submitGoals(id: string, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (plan.creatorId !== viewer.id) throw new ForbiddenException('仅发起人可提交目标');
    if (!['draft', 'goal_revision'].includes(plan.status)) throw new ConflictException('当前不能提交目标');
    if (!plan.improvementNeed?.trim()) throw new BadRequestException('请填写改进背景');
    const goals = validateGoals(this.goals(plan));
    const org = await this.org(plan.employeeId);
    if (!org.headId) throw new BadRequestException('员工所属组织未配置部门负责人');
    if (!org.approverId || org.approverId === plan.employeeId) throw new BadRequestException('员工所属组织未配置有效上级审批人');
    const bypass = org.headId === viewer.id;
    const status = bypass ? 'goal_employee_confirm' : 'goal_dept_review';
    await this.change(plan, viewer, 'submit_goals', { status, goals: goals as unknown as Prisma.InputJsonValue },
      { status, goals, autoDepartmentConfirm: bypass });
    await this.notify(this.owner({ ...plan, status } as Plan, org), viewer.id, id, '改进计划目标待确认');
    if (plan.status === 'draft') {
      const specialists = await this.prisma.user.findMany({ where: { sysRole: 'hr_user',
        hrCapabilities: { hasEvery: ['cycle_plan_edit', 'performance_publish'] }, deletedAt: null }, select: { id: true } });
      await Promise.allSettled(specialists.map((specialist) => this.notify(specialist.id, viewer.id, id, '绩效改进计划已发起')));
    }
    return this.findOne(id, viewer);
  }

  async decideGoals(id: string, input: PlanDecisionInput, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (!['goal_dept_review', 'goal_employee_confirm'].includes(plan.status)) throw new ConflictException('当前无需确认目标');
    const org = await this.org(plan.employeeId);
    if (this.owner(plan, org) !== viewer.id) throw new ForbiddenException('当前不是你的目标确认待办');
    if (!input.approve && !input.comment?.trim()) throw new BadRequestException('驳回目标必须填写理由');
    const status = !input.approve ? 'goal_revision' : plan.status === 'goal_dept_review' ? 'goal_employee_confirm' : 'self_eval';
    await this.change(plan, viewer, input.approve ? 'confirm_goals' : 'reject_goals', {
      status, ...(status === 'self_eval' ? { startedAt: new Date() } : {}),
    }, { status, comment: input.comment?.trim() ?? '' });
    await this.notify(this.owner({ ...plan, status } as Plan, org), viewer.id, id,
      status === 'goal_revision' ? '改进计划目标被退回' : status === 'self_eval' ? '请填写改进计划自评' : '改进计划目标待确认');
    return this.findOne(id, viewer);
  }

  async evaluate(id: string, input: PlanEvaluationInput, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (!['self_eval', 'manager_review', 'dept_review'].includes(plan.status)) throw new ConflictException('当前无需评价');
    const org = await this.org(plan.employeeId);
    if (this.owner(plan, org) !== viewer.id) throw new ForbiddenException('当前不是你的评价待办');
    const evaluation = validateEvaluation(validateGoals(this.goals(plan)), input);
    let status: ImprovementPlanStatus;
    let field: 'selfEvaluation' | 'managerEvaluation' | 'departmentEvaluation';
    const data: Prisma.ImprovementPlanUncheckedUpdateManyInput = {};
    if (plan.status === 'self_eval') {
      field = 'selfEvaluation'; status = 'manager_review';
      if (!org.employee.directManagerId) throw new BadRequestException('员工未配置直属上级');
    } else if (plan.status === 'manager_review') {
      field = 'managerEvaluation'; status = org.headId === viewer.id ? 'vp_review' : 'dept_review';
      if (!org.headId) throw new BadRequestException('员工所属组织未配置部门负责人');
      if (status === 'vp_review') data.departmentEvaluation = evaluation as unknown as Prisma.InputJsonValue;
    } else {
      field = 'departmentEvaluation'; status = 'vp_review';
    }
    if (status === 'vp_review' && !org.approverId) throw new BadRequestException('员工所属组织未配置上级审批人');
    data[field] = evaluation as unknown as Prisma.InputJsonValue;
    data.status = status;
    await this.change(plan, viewer, `submit_${field}`, data,
      { status, evaluation, autoDepartmentEvaluation: plan.status === 'manager_review' && org.headId === viewer.id });
    await this.notify(this.owner({ ...plan, status } as Plan, org), viewer.id, id, '改进计划评价待处理');
    return this.findOne(id, viewer);
  }

  async saveEvaluation(id: string, input: PlanEvaluationDraftInput, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (!['self_eval', 'manager_review', 'dept_review'].includes(plan.status)) throw new ConflictException('当前无需评价');
    const org = await this.org(plan.employeeId);
    if (this.owner(plan, org) !== viewer.id) throw new ForbiddenException('当前不是你的评价待办');
    const goals = validateGoals(this.goals(plan));
    if (!Array.isArray(input.items) || input.items.length !== goals.length) throw new BadRequestException('草稿目标与已确认目标不一致');
    const byId = new Map(input.items.map((item) => [item.goalId, item]));
    if (byId.size !== goals.length || goals.some((goal) => !byId.has(goal.id))) throw new BadRequestException('草稿目标与已确认目标不一致');
    const items = goals.map((goal) => {
      const item = byId.get(goal.id)!;
      if (item.score != null && (!Number.isFinite(item.score) || item.score < 0 || item.score > 100)) {
        throw new BadRequestException('目标评分必须在 0 至 100 之间');
      }
      return { goalId: goal.id, score: item.score, comment: item.comment?.trim() ?? '' };
    });
    const evaluation = { items, overallComment: input.overallComment?.trim() ?? '', weightedScore: null, draft: true };
    const field = plan.status === 'self_eval' ? 'selfEvaluation'
      : plan.status === 'manager_review' ? 'managerEvaluation' : 'departmentEvaluation';
    await this.change(plan, viewer, 'save_evaluation_draft', { status: plan.status,
      [field]: evaluation as unknown as Prisma.InputJsonValue }, { status: plan.status, evaluation });
    return this.findOne(id, viewer);
  }

  async decideFinal(id: string, input: PlanDecisionInput, viewer: AuthUser) {
    const plan = await this.load(id);
    this.assertNew(plan);
    if (plan.status !== 'vp_review') throw new ConflictException('当前无需最终审核');
    const org = await this.org(plan.employeeId);
    if (org.approverId !== viewer.id) throw new ForbiddenException('当前不是你的最终审核待办');
    if (!input.approve && !input.comment?.trim()) throw new BadRequestException('驳回必须填写理由');
    const evaluation = this.evaluation(plan.departmentEvaluation);
    if (!evaluation) throw new ConflictException('部门评价不存在');
    const status = input.approve ? 'completed' : 'manager_review';
    await this.change(plan, viewer, input.approve ? 'approve_final' : 'reject_final', {
      status, finalScore: input.approve ? evaluation.weightedScore : null,
      ...(input.approve ? { completedAt: new Date() } : { managerEvaluation: Prisma.DbNull, departmentEvaluation: Prisma.DbNull }),
    }, { status, comment: input.comment?.trim() ?? '', finalScore: input.approve ? evaluation.weightedScore : null });
    await this.notify(input.approve ? plan.employeeId : org.employee.directManagerId, viewer.id, id,
      input.approve ? '绩效改进计划已完成' : '绩效改进计划审核退回');
    return this.findOne(id, viewer);
  }

  private async change(plan: Plan, viewer: AuthUser, action: string,
    data: Prisma.ImprovementPlanUncheckedUpdateManyInput, value: Record<string, unknown>) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.improvementPlan.updateMany({ where: { id: plan.id, status: plan.status, workflowVersion: 2 }, data });
      if (updated.count !== 1) throw new ConflictException('计划状态已变化，请刷新后重试');
      await tx.auditLog.create({ data: {
        userId: viewer.id, action, entityType: 'improvement_plan', entityId: plan.id,
        oldValue: { status: plan.status, goals: plan.goals, managerEvaluation: plan.managerEvaluation,
          departmentEvaluation: plan.departmentEvaluation } as Prisma.InputJsonValue,
        newValue: value as Prisma.InputJsonValue,
      } });
    });
  }

  private async notify(userId: string | null, senderId: string, planId: string, title: string) {
    if (!userId || userId === senderId) return;
    try {
      await this.notifications.create({ userId, senderId, type: 'improvement_plan', title,
        content: '请在绩效改进计划中查看详情。', extraData: { improvementPlanId: planId, path: `/improvement-plans/${planId}` } });
    } catch { /* 通知失败不回滚业务流转；工作台待办仍可见。 */ }
  }
}
