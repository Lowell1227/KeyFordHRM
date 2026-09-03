import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IndicatorProgressHealth,
  IndicatorVisibilityScope,
  ObjectiveLevel,
  ObjectiveReviewStatus,
  ObjectiveStatus,
  Prisma,
  SysRole,
  TaskStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { paginated, Paginated } from '@/common/dto/pagination.dto';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto } from './dto/update-objective.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ObjectiveQueryDto } from './dto/objective-query.dto';
import { GoalTrackingQueryDto } from './dto/goal-tracking-query.dto';
import { buildActionItemVisibilityWhere } from '@/action-items/action-item-visibility';
import { buildVisibilityScopeWhere } from '@/tasks/indicator-visibility.rules';
import { IndicatorMapNode, IndicatorMapResult } from './indicator-map.types';
import {
  currentGoalProgress,
  progressBusinessPeriodKey,
  progressSource,
  sortGoalProgress,
  type GoalProgressSource,
} from './goal-tracking-progress';

/** include 定义（字面量，便于 Prisma 推导类型）。 */
const objectiveIncludeDef = {
  dept: { select: { id: true, name: true } },
  owner: {
    select: {
      id: true,
      name: true,
      directManagerId: true,
      directManager: { select: { id: true, name: true } },
    },
  },
  cycle: { select: { id: true, name: true } },
  relatedIndicator: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const;

type ObjectiveWithRelations = Prisma.ObjectiveGetPayload<{ include: typeof objectiveIncludeDef }>;

const goalTrackingInclude = {
  owner: { select: { id: true, name: true } },
  cycle: { select: { id: true, name: true } },
} as const;

type GoalTrackingObjective = Prisma.ObjectiveGetPayload<{
  include: typeof goalTrackingInclude;
}>;

export interface GoalTrackingLatestProgress {
  id: string;
  title?: string;
  content?: string;
  progress: number | null;
  healthStatus?: 'on_track' | 'at_risk' | 'blocked' | 'completed' | null;
  attachments?: unknown[];
  createdBy?: string;
  creatorName?: string;
  updatedAt: Date;
  businessPeriodKey: string;
  source: GoalProgressSource;
}

export interface GoalTrackingItem {
  id: string;
  title: string;
  taskId?: string;
  description?: string | null;
  scoringStandard?: string | null;
  dataSource?: string | null;
  dataCaliber?: string | null;
  targetValue?: number | null;
  targetValueText?: string | null;
  unit?: string | null;
  indicatorType?: string;
  dimensionName?: string | null;
  dimensionWeight?: number;
  visibilityScope?: string;
  visibilityScopes?: string[];
  ownerId: string | null;
  ownerName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  priority: number;
  status: ObjectiveStatus;
  progress: number;
  weight: number | null;
  latestProgress: GoalTrackingLatestProgress | null;
}

export interface GoalTrackingResult {
  taskId?: string | null;
  taskStatus?: TaskStatus | null;
  canEdit?: boolean;
  monthlyFollowUpRequired?: boolean;
  summary?: {
    periodCount: number;
    employeeSubmittedCount: number;
    managerCompletedCount: number;
    activeBusinessPeriodKey: string | null;
    activeUpdatedGoalCount: number;
    goalCount: number;
  };
  totalWeight: number;
  items: GoalTrackingItem[];
}

export interface UpdateIndicatorProgressInput {
  progress: number;
  healthStatus: IndicatorProgressHealth;
  content: string;
  expectedLatestUpdateAt?: string | null;
}

export interface IndicatorAlignmentTaskContext {
  id: string;
  cycleId: string;
  employeeId: string;
  managerId: string | null;
  deptId: string | null;
}

function activeGoalTrackingBusinessPeriodKey(
  periods: Array<{ periodKey: string; status: string; employeeSubmittedAt: Date | null }> = [],
): string | null {
  const activePeriod = periods.find((period) => (
    ['self_eval', 'manager_scoring'].includes(period.status)
    && !period.employeeSubmittedAt
  )) ?? periods[periods.length - 1] ?? null;
  return activePeriod?.periodKey ?? null;
}

/** 目标树节点。 */
export interface ObjectiveNode {
  id: string;
  title: string;
  description: string | null;
  level: ObjectiveLevel;
  deptId: string | null;
  deptName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  parentId: string | null;
  cycleId: string | null;
  cycleName: string | null;
  weight: number | null;
  priority: number;
  progress: number;
  status: ObjectiveStatus;
  reviewStatus: ObjectiveReviewStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  canReview: boolean;
  ownerReportingDepth: number | null;
  relatedIndicatorId: string | null;
  relatedIndicatorName: string | null;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: Date;
  updatedAt: Date;
  children?: ObjectiveNode[];
}

/** 查询参数（内部）。 */
export interface ObjectiveQuery {
  level?: ObjectiveLevel;
  deptId?: string;
  ownerId?: string;
  parentId?: string | null;
  cycleId?: string;
  status?: ObjectiveStatus;
  keyword?: string;
}

interface ObjectiveViewerContext {
  reportingDepthByOwner: Map<string, number>;
}

export type ObjectiveReviewDecision =
  | 'approved'
  | 'changes_requested';

@Injectable()
export class ObjectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async findIndicatorMap(cycleId: string, viewer: AuthUser): Promise<IndicatorMapResult> {
    const [cycle, viewerTask, cycleTasks] = await Promise.all([
      this.prisma.assessmentCycle.findUnique({
        where: { id: cycleId },
        select: { id: true, name: true, startDate: true, endDate: true },
      }),
      this.prisma.assessmentTask.findUnique({
        where: { cycleId_employeeId: { cycleId, employeeId: viewer.id } },
        select: { id: true, cycleId: true, employeeId: true, managerId: true, deptId: true },
      }),
      this.prisma.assessmentTask.findMany({
        where: { cycleId },
        select: { employeeId: true, managerId: true },
      }),
    ]);
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    if (!viewerTask) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '你没有权限查看该考核周期的目标地图',
      });
    }

    const managerByEmployee = new Map(cycleTasks.map((task) => [task.employeeId, task.managerId]));
    const frozenAncestorOwnerIds: string[] = [];
    const visited = new Set<string>([viewerTask.employeeId]);
    let ancestorId = viewerTask.managerId;
    while (ancestorId && !visited.has(ancestorId)) {
      frozenAncestorOwnerIds.push(ancestorId);
      visited.add(ancestorId);
      ancestorId = managerByEmployee.get(ancestorId) ?? null;
    }
    const ancestorDeptIds = viewerTask.deptId
      ? await this.dataScope.getAncestorDeptIds(viewerTask.deptId)
      : [];
    const visibilityWhere: Prisma.IndicatorInstanceWhereInput = {
      OR: [
        { task: { employeeId: viewer.id } },
        buildVisibilityScopeWhere(IndicatorVisibilityScope.company),
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.supervisors),
            { task: { managerId: viewer.id } },
          ],
        },
        ...(viewerTask.managerId
          ? [{
              AND: [
                buildVisibilityScopeWhere(IndicatorVisibilityScope.direct_reports),
                { task: { employeeId: viewerTask.managerId } },
              ],
            } satisfies Prisma.IndicatorInstanceWhereInput]
          : []),
        ...(frozenAncestorOwnerIds.length
          ? [{
              AND: [
                buildVisibilityScopeWhere(IndicatorVisibilityScope.all_reports),
                { task: { employeeId: { in: frozenAncestorOwnerIds } } },
              ],
            } satisfies Prisma.IndicatorInstanceWhereInput]
          : []),
        ...(viewerTask.deptId
          ? [
              {
                AND: [
                  buildVisibilityScopeWhere(IndicatorVisibilityScope.department),
                  { task: { deptId: viewerTask.deptId } },
                ],
              } satisfies Prisma.IndicatorInstanceWhereInput,
              {
                AND: [
                  buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
                  { visibleDepartments: { some: { departmentId: viewerTask.deptId } } },
                ],
              } satisfies Prisma.IndicatorInstanceWhereInput,
            ]
          : []),
        ...(ancestorDeptIds.length
          ? [{
              AND: [
                buildVisibilityScopeWhere(IndicatorVisibilityScope.department_tree),
                { task: { deptId: { in: ancestorDeptIds } } },
              ],
            } satisfies Prisma.IndicatorInstanceWhereInput]
          : []),
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
            { visibleUsers: { some: { userId: viewer.id } } },
          ],
        },
      ],
    };

    const indicators = await this.prisma.indicatorInstance.findMany({
      where: { AND: [{ task: { cycleId } }, visibilityWhere] },
      orderBy: [{ task: { employeeId: 'asc' } }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        task: {
          select: {
            employeeId: true,
            deptId: true,
            employee: { select: { id: true, name: true } },
            dept: { select: { id: true, name: true } },
          },
        },
        visibilityRules: { orderBy: { scope: 'asc' }, select: { scope: true } },
        childAlignments: { select: { parentIndicatorId: true } },
        progressUpdates: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { progress: true } },
      },
    });

    const visibleIds = new Set(indicators.map((indicator) => indicator.id));
    const allEdges = indicators.flatMap((indicator) => indicator.childAlignments
      .filter((alignment) => visibleIds.has(alignment.parentIndicatorId))
      .map((alignment) => ({
        id: `${alignment.parentIndicatorId}:${indicator.id}`,
        source: alignment.parentIndicatorId,
        target: indicator.id,
      })));
    const coreOwnerIds = new Set([viewer.id, ...(viewerTask.managerId ? [viewerTask.managerId] : [])]);
    const graphIds = new Set(
      indicators.filter((indicator) => coreOwnerIds.has(indicator.task.employeeId)).map((indicator) => indicator.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of allEdges) {
        if (!graphIds.has(edge.source) && !graphIds.has(edge.target)) continue;
        if (!graphIds.has(edge.source)) { graphIds.add(edge.source); changed = true; }
        if (!graphIds.has(edge.target)) { graphIds.add(edge.target); changed = true; }
      }
    }
    const edges = allEdges.filter((edge) => graphIds.has(edge.source) && graphIds.has(edge.target));
    const incomingIds = new Set(edges.map((edge) => edge.target));
    const mapNode = (indicator: (typeof indicators)[number]): IndicatorMapNode => ({
      id: indicator.id,
      name: indicator.name,
      description: indicator.description,
      weight: Math.round(indicator.weight.toNumber() * 10_000) / 100,
      progress: indicator.progressUpdates[0]?.progress ?? 0,
      sortOrder: indicator.sortOrder,
      visibilityScopes: indicator.visibilityRules.length
        ? indicator.visibilityRules.map((rule) => rule.scope)
        : [indicator.visibilityScope],
      owner: {
        id: indicator.task.employee.id,
        name: indicator.task.employee.name,
        deptId: indicator.task.deptId,
        deptName: indicator.task.dept?.name ?? null,
      },
    });
    const nodes = indicators.filter((indicator) => graphIds.has(indicator.id)).map(mapNode);
    const sameDepartmentUnaligned = viewerTask.deptId
      ? indicators
          .filter((indicator) => indicator.task.deptId === viewerTask.deptId && !graphIds.has(indicator.id))
          .map(mapNode)
      : [];

    return {
      cycle,
      roots: nodes.filter((node) => !incomingIds.has(node.id)).map((node) => node.id),
      nodes,
      edges,
      sameDepartmentUnaligned,
      permissions: {
        viewerTaskId: viewerTask.id,
        viewerId: viewer.id,
        managerId: viewerTask.managerId,
        canViewSameDepartment: Boolean(viewerTask.deptId),
      },
    };
  }

  /** GET /objectives — 列表或树。 */
  async findAll(
    query: ObjectiveQueryDto,
    viewer: AuthUser,
  ): Promise<ObjectiveNode[] | Paginated<ObjectiveNode>> {
    const context = await this.getViewerContext(viewer);
    const where = await this.buildWhere(query, viewer, context);

    if (query.flat) {
      const [total, objectives] = await Promise.all([
        this.prisma.objective.count({ where }),
        this.prisma.objective.findMany({
          where,
          include: objectiveIncludeDef,
          orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
          skip: query.skip,
          take: query.take,
        }),
      ]);
      return paginated(
        objectives.map((objective) => this.mapToNode(objective, viewer, context)),
        total,
        query,
      );
    }

    // 树模式：先取所有可见目标，再内存组装成森林。
    const objectives = await this.prisma.objective.findMany({
      where,
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });

    return this.buildForest(
      objectives.map((objective) => this.mapToNode(objective, viewer, context)),
    );
  }

  /** GET /objectives/tree — 独立树接口（兼容前端直接调用）。 */
  async findTree(viewer: AuthUser, cycleId?: string): Promise<ObjectiveNode[]> {
    const context = await this.getViewerContext(viewer);
    const where = await this.buildWhere({ cycleId }, viewer, context);
    const objectives = await this.prisma.objective.findMany({
      where,
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return this.buildForest(
      objectives.map((objective) => this.mapToNode(objective, viewer, context)),
    );
  }

  async findTracking(
    query: GoalTrackingQueryDto,
    viewer: AuthUser,
  ): Promise<GoalTrackingResult> {
    if (!query.objectiveId && (!query.ownerId || !query.cycleId)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请选择人员和考核周期',
      });
    }

    if (!query.objectiveId) {
      return this.findIndicatorTracking(query.ownerId!, query.cycleId!, viewer);
    }

    const visibilityWhere = await this.buildWhere(
      query.objectiveId
        ? {}
        : { ownerId: query.ownerId, cycleId: query.cycleId },
      viewer,
    );
    const where = query.objectiveId
      ? { AND: [visibilityWhere, { id: query.objectiveId }] }
      : visibilityWhere;
    const objectives = await this.prisma.objective.findMany({
      where,
      include: goalTrackingInclude,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    const objectiveIds = objectives.map((objective) => objective.id);
    const visibleActions = objectiveIds.length === 0
      ? []
      : await this.prisma.actionItem.findMany({
          where: {
            AND: [
              buildActionItemVisibilityWhere(viewer),
              { objectiveId: { in: objectiveIds } },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            objectiveId: true,
            title: true,
            progress: true,
            updatedAt: true,
          },
        });
    const latestByObjective = new Map<string, GoalTrackingLatestProgress>();
    for (const action of visibleActions) {
      if (!latestByObjective.has(action.objectiveId)) {
        latestByObjective.set(action.objectiveId, {
          id: action.id,
          title: action.title,
          progress: action.progress,
          updatedAt: action.updatedAt,
          businessPeriodKey: progressBusinessPeriodKey({
            id: action.id,
            createdAt: action.updatedAt,
          }),
          source: 'active_progress',
        });
      }
    }
    const items = objectives.map((objective: GoalTrackingObjective): GoalTrackingItem => ({
      id: objective.id,
      title: objective.title,
      ownerId: objective.ownerId,
      ownerName: objective.owner?.name ?? null,
      cycleId: objective.cycleId,
      cycleName: objective.cycle?.name ?? null,
      priority: objective.priority,
      status: objective.status,
      progress: objective.progress,
      weight: objective.weight?.toNumber() ?? null,
      latestProgress: latestByObjective.get(objective.id) ?? null,
    }));
    return {
      totalWeight: items.reduce((sum, item) => sum + (item.weight ?? 0), 0),
      items,
    };
  }

  private async findIndicatorTracking(
    ownerId: string,
    cycleId: string,
    viewer: AuthUser,
  ): Promise<GoalTrackingResult> {
    let indicatorWhere: Prisma.IndicatorInstanceWhereInput | undefined;
    if (ownerId !== viewer.id) {
      const viewerTask = await this.prisma.assessmentTask.findUnique({
        where: { cycleId_employeeId: { cycleId, employeeId: viewer.id } },
        select: { managerId: true },
      });
      if (viewerTask?.managerId !== ownerId) {
        throw new ForbiddenException({
          code: ERROR_CODE.FORBIDDEN,
          message: '你没有权限查看该员工在本考核周期的目标',
        });
      }
      indicatorWhere = {
        OR: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.company),
          buildVisibilityScopeWhere(IndicatorVisibilityScope.direct_reports),
          buildVisibilityScopeWhere(IndicatorVisibilityScope.all_reports),
          ...(viewer.deptId
            ? [
                {
                  AND: [
                    buildVisibilityScopeWhere(IndicatorVisibilityScope.department),
                    { task: { deptId: viewer.deptId } },
                  ],
                },
                {
                  AND: [
                    buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
                    { visibleDepartments: { some: { departmentId: viewer.deptId } } },
                  ],
                },
              ] satisfies Prisma.IndicatorInstanceWhereInput[]
            : []),
          {
            AND: [
              buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
              { visibleUsers: { some: { userId: viewer.id } } },
            ],
          },
        ],
      };
    }

    const task = await this.prisma.assessmentTask.findUnique({
      where: { cycleId_employeeId: { cycleId, employeeId: ownerId } },
      include: {
        employee: { select: { id: true, name: true } },
        cycle: {
          select: {
            id: true,
            name: true,
            monthlyFollowUpRequired: true,
            workflowVersion: true,
            openedAt: true,
            publishedAt: true,
            closedAt: true,
          },
        },
        periods: {
          orderBy: { sequence: 'asc' },
          select: {
            periodKey: true,
            status: true,
            employeeSubmittedAt: true,
            managerSubmittedAt: true,
          },
        },
        indicatorInstances: {
          ...(indicatorWhere ? { where: indicatorWhere } : {}),
          orderBy: { sortOrder: 'asc' },
          include: {
            visibilityRules: {
              orderBy: { scope: 'asc' },
              select: { scope: true },
            },
            objectiveAlignments: {
              include: {
                objective: {
                  select: { id: true, title: true, level: true, ownerId: true },
                },
              },
            },
            progressUpdates: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              include: {
                creator: { select: { id: true, name: true } },
                period: { select: { periodKey: true } },
              },
            },
          },
        },
      },
    });

    if (!task) {
      return { taskId: null, taskStatus: null, canEdit: false, totalWeight: 0, items: [] };
    }

    const canEdit = this.canSubmitActiveProgress(task, viewer);
    const items = task.indicatorInstances.map((indicator) => {
      const latest = currentGoalProgress(indicator.progressUpdates);
      const weight = Math.round(indicator.weight.toNumber() * 10_000) / 100;
      return {
        id: indicator.id,
        taskId: indicator.taskId,
        title: indicator.name,
        description: indicator.description,
        scoringStandard: indicator.scoringStandard,
        dataSource: indicator.dataSource,
        dataCaliber: indicator.dataCaliber,
        targetValue: indicator.targetValue?.toNumber() ?? null,
        targetValueText: indicator.targetValueText,
        unit: indicator.unit,
        indicatorType: indicator.indicatorType,
        dimensionName: indicator.dimensionName,
        dimensionWeight: indicator.dimensionWeight.toNumber() * 100,
        visibilityScope: indicator.visibilityScope,
        visibilityScopes: indicator.visibilityRules?.length
          ? indicator.visibilityRules.map((rule) => rule.scope)
          : [indicator.visibilityScope],
        ownerId: task.employee.id,
        ownerName: task.employee.name,
        cycleId: task.cycle.id,
        cycleName: task.cycle.name,
        priority: -indicator.sortOrder,
        status: ObjectiveStatus.active,
        progress: latest?.progress ?? 0,
        weight,
        latestProgress: latest
          ? {
              id: latest.id,
              content: latest.content,
              progress: latest.progress,
              healthStatus: latest.healthStatus,
              attachments: Array.isArray(latest.attachments) ? latest.attachments : [],
              createdBy: latest.creator.id,
              creatorName: latest.creator.name,
              updatedAt: latest.createdAt,
              businessPeriodKey: progressBusinessPeriodKey(latest),
              source: progressSource(latest),
            }
          : null,
      } satisfies GoalTrackingItem;
    });
    const periods = task.periods ?? [];
    const activeBusinessPeriodKey = activeGoalTrackingBusinessPeriodKey(periods);

    return {
      taskId: task.id,
      taskStatus: task.status,
      canEdit,
      monthlyFollowUpRequired: task.cycle.monthlyFollowUpRequired,
      summary: {
        periodCount: periods.length,
        employeeSubmittedCount: periods.filter((period) => Boolean(period.employeeSubmittedAt)).length,
        managerCompletedCount: periods.filter((period) => (
          period.status === 'completed' && Boolean(period.managerSubmittedAt)
        )).length,
        activeBusinessPeriodKey,
        activeUpdatedGoalCount: activeBusinessPeriodKey
          ? task.indicatorInstances.filter((indicator) => indicator.progressUpdates.some((progress) => (
            progressSource(progress) === 'active_progress'
            && progressBusinessPeriodKey(progress) === activeBusinessPeriodKey
          ))).length
          : 0,
        goalCount: items.length,
      },
      totalWeight: Math.round(items.reduce((sum, item) => sum + (item.weight ?? 0), 0) * 100) / 100,
      items,
    };
  }

  async findIndicatorAlignmentCandidates(taskId: string, viewer: AuthUser) {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        cycleId: true,
        employeeId: true,
        managerId: true,
        deptId: true,
        manager: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核任务不存在',
      });
    }
    this.assertCanMaintainIndicatorAlignment(task, viewer);
    if (!task.managerId) {
      return { items: [], owners: [], reason: '本周期未设置绩效直属上级' };
    }

    const where = await this.buildIndicatorAlignmentCandidateWhere(task);
    const indicators = await this.prisma.indicatorInstance.findMany({
      where,
      select: {
        id: true,
        name: true,
        task: {
          select: {
            employee: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const items = indicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name,
        owner: indicator.task.employee,
      }));
    const manager = task.manager ?? {
      id: task.managerId,
      name: items[0]?.owner.name ?? '绩效直属上级',
      avatarUrl: null,
    };
    return {
      items,
      owners: [{
        ...manager,
        relation: 'performance_manager' as const,
        items,
      }],
      reason: indicators.length ? null : '绩效直属上级暂无对你可见的指标',
    };
  }

  async assertIndicatorAlignmentCandidateIds(
    task: IndicatorAlignmentTaskContext,
    submittedIds: string[],
    viewer: AuthUser,
  ): Promise<void> {
    this.assertCanMaintainIndicatorAlignment(task, viewer);
    const ids = [...new Set(submittedIds ?? [])];
    if (ids.length === 0) return;
    if (!task.managerId) this.throwAlignmentForbidden();

    const where = await this.buildIndicatorAlignmentCandidateWhere(task);
    const visibleCount = await this.prisma.indicatorInstance.count({
      where: { AND: [where, { id: { in: ids } }] },
    });
    if (visibleCount !== ids.length) this.throwAlignmentForbidden();
  }

  private async buildIndicatorAlignmentCandidateWhere(
    task: IndicatorAlignmentTaskContext,
  ): Promise<Prisma.IndicatorInstanceWhereInput> {
    const ancestorDeptIds = task.deptId
      ? await this.dataScope.getAncestorDeptIds(task.deptId)
      : [];
    const visibility: Prisma.IndicatorInstanceWhereInput[] = [
      buildVisibilityScopeWhere(IndicatorVisibilityScope.company),
      buildVisibilityScopeWhere(IndicatorVisibilityScope.direct_reports),
      buildVisibilityScopeWhere(IndicatorVisibilityScope.all_reports),
      {
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
          { visibleUsers: { some: { userId: task.employeeId } } },
        ],
      },
    ];
    if (task.deptId) {
      visibility.push(
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.department),
            { task: { deptId: task.deptId } },
          ],
        },
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.department_tree),
            { task: { deptId: { in: ancestorDeptIds } } },
          ],
        },
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
            { visibleDepartments: { some: { departmentId: task.deptId } } },
          ],
        },
      );
    }
    return {
      AND: [
        { task: { cycleId: task.cycleId, employeeId: task.managerId! } },
        { OR: visibility },
      ],
    };
  }

  private assertCanMaintainIndicatorAlignment(
    task: IndicatorAlignmentTaskContext,
    viewer: AuthUser,
  ): void {
    if (
      task.employeeId !== viewer.id
      && task.managerId !== viewer.id
      && viewer.sysRole !== SysRole.hr
      && viewer.sysRole !== SysRole.system_admin
    ) {
      this.throwAlignmentForbidden();
    }
  }

  private throwAlignmentForbidden(): never {
    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权选择所提交的绩效直属上级指标',
    });
  }

  async updateIndicatorProgress(
    indicatorId: string,
    input: UpdateIndicatorProgressInput,
    viewer: AuthUser,
  ) {
    const indicator = await this.prisma.indicatorInstance.findUnique({
      where: { id: indicatorId },
      include: {
        task: {
          select: {
            id: true,
            employeeId: true,
            status: true,
            isExempt: true,
            participantDisposition: true,
            indicatorConfirmedAt: true,
            closedAt: true,
            selfEvalSubmittedAt: true,
            publishedAt: true,
            cycle: {
              select: {
                workflowVersion: true,
                openedAt: true,
                publishedAt: true,
                closedAt: true,
              },
            },
          },
        },
      },
    });
    if (!indicator) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核指标不存在',
      });
    }
    if (indicator.task.employeeId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '只能更新本人的考核指标进展',
      });
    }
    if (!this.canSubmitActiveProgress(indicator.task, viewer)) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前考核阶段不允许更新进展',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "indicator_instances"
        WHERE "id" = ${indicatorId}::uuid
        FOR UPDATE
      `;
      const progressUpdates = await tx.indicatorProgressUpdate.findMany({
        where: { indicatorInstanceId: indicatorId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { period: { select: { periodKey: true } } },
      });
      const latest = currentGoalProgress(progressUpdates);
      if (input.expectedLatestUpdateAt !== undefined) {
        const actualLatestUpdateAt = latest?.createdAt.toISOString() ?? null;
        if (actualLatestUpdateAt !== input.expectedLatestUpdateAt) {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: '进展已被更新，请刷新后重试',
          });
        }
      }
      const created = await tx.indicatorProgressUpdate.create({
        data: {
          indicatorInstanceId: indicatorId,
          progress: input.progress,
          healthStatus: input.healthStatus,
          content: input.content,
          attachments: [],
          createdBy: viewer.id,
        },
        include: { creator: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'progress_update',
          entityType: 'indicator_instance',
          entityId: indicatorId,
          oldValue: latest
            ? ({
                progress: latest.progress,
                healthStatus: latest.healthStatus,
                updatedAt: latest.createdAt.toISOString(),
              } satisfies Prisma.InputJsonObject)
            : Prisma.JsonNull,
          newValue: {
            progress: created.progress,
            healthStatus: created.healthStatus,
            content: created.content,
            attachments: created.attachments,
            updatedAt: created.createdAt.toISOString(),
          },
        },
      });
      return {
        id: created.id,
        progress: created.progress,
        healthStatus: created.healthStatus,
        content: created.content,
        attachments: Array.isArray(created.attachments) ? created.attachments : [],
        createdBy: created.creator.id,
        creatorName: created.creator.name,
        updatedAt: created.createdAt,
        businessPeriodKey: progressBusinessPeriodKey(created),
        source: progressSource(created),
      };
    });
  }

  async findTrackingIndicator(indicatorId: string, viewer: AuthUser) {
    const identity = await this.prisma.indicatorInstance.findUnique({
      where: { id: indicatorId },
      select: {
        task: { select: { employeeId: true, cycleId: true } },
      },
    });
    const ownerVisibility: Prisma.IndicatorInstanceWhereInput[] = [
      { task: { employeeId: viewer.id } },
    ];
    if (identity && identity.task.employeeId !== viewer.id) {
      const viewerTask = await this.prisma.assessmentTask.findUnique({
        where: {
          cycleId_employeeId: {
            cycleId: identity.task.cycleId,
            employeeId: viewer.id,
          },
        },
        select: { managerId: true },
      });
      const managerId = viewerTask?.managerId;
      if (!managerId || managerId !== identity.task.employeeId) {
        throw new NotFoundException({
          code: ERROR_CODE.NOT_FOUND,
          message: '考核指标不存在或不可见',
        });
      }
      ownerVisibility.push(
        { AND: [{ task: { employeeId: managerId } }, buildVisibilityScopeWhere(IndicatorVisibilityScope.company)] },
        { AND: [{ task: { employeeId: managerId } }, buildVisibilityScopeWhere(IndicatorVisibilityScope.direct_reports)] },
        { AND: [{ task: { employeeId: managerId } }, buildVisibilityScopeWhere(IndicatorVisibilityScope.all_reports)] },
        {
          AND: [
            { task: { employeeId: managerId } },
            buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
            { visibleUsers: { some: { userId: viewer.id } } },
          ],
        },
      );
      if (viewer.deptId) {
        ownerVisibility.push(
          {
            AND: [
              { task: { employeeId: managerId } },
              buildVisibilityScopeWhere(IndicatorVisibilityScope.department),
              { task: { deptId: viewer.deptId } },
            ],
          },
          {
            AND: [
              { task: { employeeId: managerId } },
              buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
              { visibleDepartments: { some: { departmentId: viewer.deptId } } },
            ],
          },
        );
      }
    }
    const indicator = await this.prisma.indicatorInstance.findFirst({
      where: { AND: [{ id: indicatorId }, { OR: ownerVisibility }] },
      include: {
        visibilityRules: {
          orderBy: { scope: 'asc' },
          select: { scope: true },
        },
        task: {
          include: {
            employee: { select: { id: true, name: true } },
            periods: {
              orderBy: { sequence: 'asc' },
              select: {
                periodKey: true,
                status: true,
                employeeSubmittedAt: true,
              },
            },
            cycle: {
              select: {
                id: true,
                name: true,
                workflowVersion: true,
                openedAt: true,
                publishedAt: true,
                closedAt: true,
              },
            },
          },
        },
        objectiveAlignments: {
          include: {
            objective: {
              select: { id: true, title: true, level: true, ownerId: true },
            },
          },
        },
        progressUpdates: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            creator: { select: { id: true, name: true } },
            period: { select: { periodKey: true } },
          },
        },
      },
    });
    if (!indicator) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '考核指标不存在或不可见',
      });
    }

    const changeRecords = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'indicator_instance',
        entityId: indicator.id,
        action: {
          in: ['indicator_baseline_confirmed', 'indicator_updated'],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { user: { select: { id: true, name: true } } },
    });
    const effectiveWeight = Math.round(indicator.weight.toNumber() * 10_000) / 100;
    const orderedProgress = sortGoalProgress(indicator.progressUpdates);

    return {
      id: indicator.id,
      taskId: indicator.taskId,
      title: indicator.name,
      description: indicator.description,
      scoringStandard: indicator.scoringStandard,
      dataSource: indicator.dataSource,
      dataCaliber: indicator.dataCaliber,
      targetValue: indicator.targetValue?.toNumber() ?? null,
      targetValueText: indicator.targetValueText,
      unit: indicator.unit,
      indicatorType: indicator.indicatorType,
      dimensionName: indicator.dimensionName,
      dimensionWeight: indicator.dimensionWeight.toNumber() * 100,
      weight: effectiveWeight,
      visibilityScope: indicator.visibilityScope,
      visibilityScopes: indicator.visibilityRules?.length
        ? indicator.visibilityRules.map((rule) => rule.scope)
        : [indicator.visibilityScope],
      actualValue: indicator.actualValue?.toNumber() ?? null,
      actualNote: indicator.actualNote,
      ownerId: indicator.task.employee.id,
      ownerName: indicator.task.employee.name,
      cycleId: indicator.task.cycle.id,
      cycleName: indicator.task.cycle.name,
      taskStatus: indicator.task.status,
      canEdit: this.canSubmitActiveProgress(indicator.task, viewer),
      activeBusinessPeriodKey: activeGoalTrackingBusinessPeriodKey(indicator.task.periods),
      alignedObjectives: indicator.objectiveAlignments.map(({ objective }) => objective),
      progressUpdates: orderedProgress.map((progress) => ({
        id: progress.id,
        progress: progress.progress,
        healthStatus: progress.healthStatus,
        content: progress.content,
        attachments: Array.isArray(progress.attachments) ? progress.attachments : [],
        createdBy: progress.creator.id,
        creatorName: progress.creator.name,
        updatedAt: progress.createdAt,
        businessPeriodKey: progressBusinessPeriodKey(progress),
        source: progressSource(progress),
      })),
      changeRecords: changeRecords.map((record) => ({
        id: record.id,
        action: record.action,
        oldValue: record.oldValue,
        newValue: record.newValue,
        actorId: record.user?.id ?? null,
        actorName: record.user?.name ?? null,
        createdAt: record.createdAt,
      })),
      createdAt: indicator.createdAt,
      updatedAt: indicator.updatedAt,
    };
  }

  private canSubmitActiveProgress(
    task: {
      employeeId: string;
      isExempt: boolean;
      participantDisposition: string;
      indicatorConfirmedAt: Date | null;
      closedAt: Date | null;
      publishedAt: Date | null;
      cycle: {
        workflowVersion: number;
        openedAt: Date | null;
        publishedAt: Date | null;
        closedAt: Date | null;
      };
    },
    viewer: AuthUser,
  ): boolean {
    return task.employeeId === viewer.id
      && task.cycle.workflowVersion === 2
      && task.cycle.openedAt != null
      && task.indicatorConfirmedAt != null
      && !task.isExempt
      && task.participantDisposition === 'active'
      && task.closedAt == null
      && task.cycle.closedAt == null
      && task.cycle.publishedAt == null
      && task.publishedAt == null;
  }

  async assertVisibleIds(ids: string[], viewer: AuthUser): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;

    const context = await this.getViewerContext(viewer);
    const visibilityWhere = await this.buildWhere({}, viewer, context);
    const count = await this.prisma.objective.count({
      where: { AND: [visibilityWhere, { id: { in: uniqueIds } }] },
    });
    if (count !== uniqueIds.length) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权访问所选目标',
      });
    }
  }

  async findVisibleByIds(ids: string[], viewer: AuthUser): Promise<ObjectiveNode[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const context = await this.getViewerContext(viewer);
    const visibilityWhere = await this.buildWhere({}, viewer, context);
    const objectives = await this.prisma.objective.findMany({
      where: { AND: [visibilityWhere, { id: { in: uniqueIds } }] },
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return objectives.map((objective) => this.mapToNode(objective, viewer, context));
  }

  /** GET /objectives/:id — 详情。 */
  async findOne(id: string, viewer: AuthUser): Promise<ObjectiveNode> {
    const objective = await this.prisma.objective.findUnique({
      where: { id },
      include: objectiveIncludeDef,
    });

    if (!objective) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '目标不存在',
      });
    }

    const context = await this.getViewerContext(viewer);
    await this.assertCanView(objective, viewer, context);
    return this.mapToNode(objective, viewer, context);
  }

  /** POST /objectives — 创建。 */
  async create(dto: CreateObjectiveDto, viewer: AuthUser): Promise<ObjectiveNode> {
    await this.assertCanCreate(dto, viewer);
    await this.validateParentLevel(dto.level, dto.parentId);
    if (dto.parentId) {
      await this.validateParentCycleConsistency(dto.cycleId, dto.parentId);
    }
    const reviewStatus = await this.resolveReviewStatus(dto.ownerId, ObjectiveStatus.active);

    const created = await this.prisma.objective.create({
      data: {
        title: dto.title,
        description: dto.description,
        level: dto.level,
        deptId: dto.deptId,
        ownerId: dto.ownerId,
        parentId: dto.parentId,
        cycleId: dto.cycleId,
        weight: dto.weight == null ? null : new Prisma.Decimal(dto.weight),
        priority: dto.priority ?? 0,
        reviewStatus,
        relatedIndicatorId: dto.relatedIndicatorId,
        createdBy: viewer.id,
      },
      include: objectiveIncludeDef,
    });

    const context = await this.getViewerContext(viewer);
    return this.mapToNode(created, viewer, context);
  }

  /** PATCH /objectives/:id — 更新。 */
  async update(id: string, dto: UpdateObjectiveDto, viewer: AuthUser): Promise<ObjectiveNode> {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
      include: objectiveIncludeDef,
    });
    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '目标不存在',
      });
    }

    await this.assertCanManage(existing, viewer);

    const nextLevel = dto.level ?? existing.level;
    const nextParentId = dto.parentId === undefined ? existing.parentId : dto.parentId;
    const nextCycleId = dto.cycleId === undefined ? existing.cycleId : dto.cycleId;
    await this.validateParentLevel(nextLevel, nextParentId);

    if (
      nextParentId
      && (dto.parentId !== undefined || dto.cycleId !== undefined)
    ) {
      await this.validateParentCycleConsistency(nextCycleId, nextParentId);
    }
    if (dto.cycleId !== undefined && nextCycleId !== existing.cycleId) {
      await this.validateChildrenCycleConsistency(id, nextCycleId);
    }

    const materialFields: Array<keyof UpdateObjectiveDto> = [
      'title',
      'description',
      'level',
      'deptId',
      'ownerId',
      'parentId',
      'cycleId',
      'weight',
      'relatedIndicatorId',
    ];
    const draftLifecycleChanged = dto.status === ObjectiveStatus.draft
      || (existing.status === ObjectiveStatus.draft && dto.status === ObjectiveStatus.active);
    const shouldResetReview = draftLifecycleChanged
      || materialFields.some((field) => dto[field] !== undefined);
    const reviewReset = shouldResetReview
      ? {
          reviewStatus: await this.resolveReviewStatus(
            dto.ownerId === undefined ? existing.ownerId : dto.ownerId,
            dto.status ?? existing.status,
          ),
          reviewedById: null,
          reviewedAt: null,
          reviewComment: null,
        }
      : {};

    const updated = await this.prisma.objective.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        level: dto.level,
        deptId: dto.deptId === undefined ? undefined : dto.deptId,
        ownerId: dto.ownerId === undefined ? undefined : dto.ownerId,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        cycleId: dto.cycleId === undefined ? undefined : dto.cycleId,
        weight: dto.weight === undefined ? undefined : (dto.weight == null ? null : new Prisma.Decimal(dto.weight)),
        priority: dto.priority,
        status: dto.status,
        relatedIndicatorId: dto.relatedIndicatorId === undefined ? undefined : dto.relatedIndicatorId,
        ...reviewReset,
      },
      include: objectiveIncludeDef,
    });

    const context = await this.getViewerContext(viewer);
    return this.mapToNode(updated, viewer, context);
  }

  /** PATCH /objectives/:id/progress — 更新进度。 */
  async updateProgress(
    id: string,
    dto: UpdateProgressDto,
    viewer: AuthUser,
  ): Promise<ObjectiveNode> {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
      include: objectiveIncludeDef,
    });
    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '目标不存在',
      });
    }

    await this.assertCanManage(existing, viewer);

    const updated = await this.prisma.objective.update({
      where: { id },
      data: { progress: dto.progress },
      include: objectiveIncludeDef,
    });

    const context = await this.getViewerContext(viewer);
    return this.mapToNode(updated, viewer, context);
  }

  async reviewObjective(
    id: string,
    decision: ObjectiveReviewDecision,
    comment: string | undefined,
    viewer: AuthUser,
    expectedUpdatedAt: string,
  ): Promise<ObjectiveNode> {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
      include: objectiveIncludeDef,
    });
    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '目标不存在',
      });
    }
    if (existing.owner?.directManagerId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅目标负责人的直属上级可以审核',
      });
    }
    if (existing.reviewStatus !== ObjectiveReviewStatus.pending) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '审核状态已变化，请刷新后重试',
      });
    }

    const normalizedComment = comment?.trim() || null;
    if (
      decision === ObjectiveReviewStatus.changes_requested
      && !normalizedComment
    ) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请填写退回原因',
      });
    }
    const reviewedAt = new Date();
    const expectedVersionStart = new Date(expectedUpdatedAt);
    const expectedVersionEnd = new Date(expectedVersionStart.getTime() + 1);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.objective.updateMany({
        where: {
          id,
          reviewStatus: ObjectiveReviewStatus.pending,
          updatedAt: {
            gte: expectedVersionStart,
            lt: expectedVersionEnd,
          },
          owner: { directManagerId: viewer.id },
        },
        data: {
          reviewStatus: decision,
          reviewedById: viewer.id,
          reviewedAt,
          reviewComment: normalizedComment,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '审核状态已变化，请刷新后重试',
        });
      }
      const objective = await tx.objective.findUnique({
        where: { id },
        include: objectiveIncludeDef,
      });
      if (!objective) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '审核状态已变化，请刷新后重试',
        });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: decision === ObjectiveReviewStatus.approved
            ? 'objective_review_approved'
            : 'objective_review_changes_requested',
          entityType: 'objective',
          entityId: id,
          oldValue: {
            reviewStatus: existing.reviewStatus,
            reviewedById: existing.reviewedById,
            reviewedAt: existing.reviewedAt?.toISOString() ?? null,
            reviewComment: existing.reviewComment,
          },
          newValue: {
            reviewStatus: decision,
            reviewedById: viewer.id,
            reviewedAt: reviewedAt.toISOString(),
            reviewComment: normalizedComment,
          },
        },
      });
      return objective;
    });

    const context = await this.getViewerContext(viewer);
    return this.mapToNode(updated, viewer, context);
  }

  /** DELETE /objectives/:id — 删除。 */
  async remove(id: string, viewer: AuthUser): Promise<void> {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
      include: objectiveIncludeDef,
    });
    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '目标不存在',
      });
    }

    await this.assertCanManage(existing, viewer);

    const childrenCount = await this.prisma.objective.count({ where: { parentId: id } });
    if (childrenCount > 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '请先删除子目标',
      });
    }

    await this.prisma.objective.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // 私有辅助
  // ---------------------------------------------------------------------------

  private mapToNode(
    objective: ObjectiveWithRelations,
    viewer: AuthUser,
    context: ObjectiveViewerContext,
  ): ObjectiveNode {
    const reviewerId = objective.owner?.directManagerId ?? null;
    return {
      id: objective.id,
      title: objective.title,
      description: objective.description,
      level: objective.level,
      deptId: objective.deptId,
      deptName: objective.dept?.name ?? null,
      ownerId: objective.ownerId,
      ownerName: objective.owner?.name ?? null,
      parentId: objective.parentId,
      cycleId: objective.cycleId,
      cycleName: objective.cycle?.name ?? null,
      weight: objective.weight?.toNumber() ?? null,
      priority: objective.priority,
      progress: objective.progress,
      status: objective.status,
      reviewStatus: objective.reviewStatus,
      reviewerId,
      reviewerName: objective.owner?.directManager?.name ?? null,
      reviewedById: objective.reviewedById,
      reviewedByName: objective.reviewedBy?.name ?? null,
      reviewedAt: objective.reviewedAt,
      reviewComment: objective.reviewComment,
      canReview: reviewerId === viewer.id
        && objective.reviewStatus === ObjectiveReviewStatus.pending,
      ownerReportingDepth: objective.ownerId
        ? (context.reportingDepthByOwner.get(objective.ownerId) ?? null)
        : null,
      relatedIndicatorId: objective.relatedIndicatorId,
      relatedIndicatorName: objective.relatedIndicator?.name ?? null,
      createdBy: objective.createdBy,
      creatorName: objective.creator?.name ?? null,
      createdAt: objective.createdAt,
      updatedAt: objective.updatedAt,
    };
  }

  private async buildWhere(
    query: ObjectiveQuery,
    viewer: AuthUser,
    context?: ObjectiveViewerContext,
  ): Promise<Prisma.ObjectiveWhereInput> {
    const where: Prisma.ObjectiveWhereInput = {};

    if (query.level) where.level = query.level;
    if (query.deptId) where.deptId = query.deptId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.status) where.status = query.status;
    if (query.parentId !== undefined) where.parentId = query.parentId;

    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.title = { contains: keyword, mode: 'insensitive' };
    }

    // 数据权限：普通员工只能看到公司级 + 自己作为负责人的目标；
    // 主管/部门负责人额外看到其数据范围内的目标；HR/system_admin 看全部。
    if (!this.isAdminLike(viewer)) {
      const viewerContext = context ?? await this.getViewerContext(viewer);
      const scope = await this.dataScope.getVisibleEmployeeFilter(viewer);
      const visibleOwners = await this.prisma.user.findMany({
        where: scope,
        select: { id: true },
      });
      const visibleOwnerIds = visibleOwners.map((user) => user.id);

      const uniqueIds = [...new Set([
        ...visibleOwnerIds,
        ...viewerContext.reportingDepthByOwner.keys(),
      ])].filter(Boolean);
      where.OR = [
        { level: ObjectiveLevel.company },
        ...(uniqueIds.length > 0 ? [{ ownerId: { in: uniqueIds } }] : []),
        ...(viewer.deptId ? [{ deptId: viewer.deptId }] : []),
      ];
    }

    return where;
  }

  private async getViewerContext(viewer: AuthUser): Promise<ObjectiveViewerContext> {
    return {
      reportingDepthByOwner: await this.getReportingDepthByOwner(viewer.id),
    };
  }

  private async getReportingDepthByOwner(viewerId: string): Promise<Map<string, number>> {
    const users = await this.prisma.user.findMany({
      where: { status: UserStatus.active },
      select: { id: true, directManagerId: true },
    });
    const childrenByManager = new Map<string, string[]>();
    for (const user of users) {
      if (!user.directManagerId) continue;
      const children = childrenByManager.get(user.directManagerId) ?? [];
      children.push(user.id);
      childrenByManager.set(user.directManagerId, children);
    }

    const depthByOwner = new Map<string, number>([[viewerId, 0]]);
    const queue: Array<{ id: string; depth: number }> = [{ id: viewerId, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const childId of childrenByManager.get(current.id) ?? []) {
        if (depthByOwner.has(childId)) continue;
        const depth = current.depth + 1;
        depthByOwner.set(childId, depth);
        queue.push({ id: childId, depth });
      }
    }
    return depthByOwner;
  }

  private async resolveReviewStatus(
    ownerId: string | null | undefined,
    status: ObjectiveStatus,
  ): Promise<ObjectiveReviewStatus> {
    if (status === ObjectiveStatus.draft) return ObjectiveReviewStatus.draft;
    if (!ownerId) return ObjectiveReviewStatus.not_required;
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { directManagerId: true },
    });
    return owner?.directManagerId
      ? ObjectiveReviewStatus.pending
      : ObjectiveReviewStatus.not_required;
  }

  private buildForest(nodes: ObjectiveNode[]): ObjectiveNode[] {
    const map = new Map<string, ObjectiveNode>();
    nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));

    const roots: ObjectiveNode[] = [];
    nodes.forEach((n) => {
      const node = map.get(n.id)!;
      if (n.parentId && map.has(n.parentId)) {
        map.get(n.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    // 清理无子节点的 children 字段。
    const clean = (node: ObjectiveNode): ObjectiveNode => {
      if (node.children && node.children.length === 0) {
        delete node.children;
      } else if (node.children) {
        node.children = node.children.map(clean);
      }
      return node;
    };

    return roots.map(clean);
  }

  private async validateParentLevel(level: ObjectiveLevel, parentId?: string | null): Promise<void> {
    if (level === ObjectiveLevel.company && parentId) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '公司级目标不允许挂父目标',
      });
    }

    if (!parentId) return;

    const parent = await this.prisma.objective.findUnique({
      where: { id: parentId },
      select: { level: true },
    });
    if (!parent) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '父目标不存在',
      });
    }

    const expected: Record<ObjectiveLevel, ObjectiveLevel | null> = {
      [ObjectiveLevel.company]: null,
      [ObjectiveLevel.department]: ObjectiveLevel.company,
      [ObjectiveLevel.individual]: ObjectiveLevel.department,
    };

    if (expected[level] !== parent.level) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '父目标层级不匹配',
      });
    }
  }

  private async validateParentCycleConsistency(
    cycleId: string | null | undefined,
    parentId: string,
  ): Promise<void> {
    const parent = await this.prisma.objective.findUnique({
      where: { id: parentId },
      select: { cycleId: true },
    });

    if (!parent || (cycleId ?? null) !== parent.cycleId) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '子目标与父目标所属周期不一致',
      });
    }
  }

  private async validateChildrenCycleConsistency(
    parentId: string,
    cycleId: string | null,
  ): Promise<void> {
    const children = await this.prisma.objective.findMany({
      where: { parentId },
      select: { cycleId: true },
    });
    if (children.some((child) => child.cycleId !== cycleId)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '父目标所属周期与现有子目标不一致',
      });
    }
  }

  private async assertCanView(
    objective: { level: ObjectiveLevel; ownerId: string | null; deptId: string | null },
    viewer: AuthUser,
    context: ObjectiveViewerContext,
  ): Promise<void> {
    if (this.isAdminLike(viewer)) return;
    if (objective.level === ObjectiveLevel.company) return;
    if (objective.ownerId === viewer.id) return;
    if (
      objective.ownerId
      && context.reportingDepthByOwner.has(objective.ownerId)
    ) return;

    if (viewer.deptId && objective.deptId === viewer.deptId) return;

    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);
    const visible = objective.ownerId
      ? await this.prisma.user.count({ where: { AND: [{ id: objective.ownerId }, scopeFilter] } })
      : 0;

    if (visible === 0) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权查看该目标',
      });
    }
  }

  private async assertCanCreate(dto: CreateObjectiveDto, viewer: AuthUser): Promise<void> {
    if (this.isAdminLike(viewer)) return;

    // 绩效直属上级关系可为直属下属建个人目标。
    if (dto.ownerId) {
      const employee = await this.prisma.user.findUnique({
        where: { id: dto.ownerId },
        select: { directManagerId: true },
      });
      if (employee?.directManagerId === viewer.id) return;
    }

    // 部门负责人关系可在管辖部门下建部门/个人目标。
    if (dto.deptId) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });
      const managedDeptIds = (
        await Promise.all(managedDepts.map((d) => this.dataScope.getSubDeptIds(d.id)))
      ).flat();
      if (managedDeptIds.includes(dto.deptId)) return;
    }

    // 负责人可以为自己建个人目标。
    if (
      dto.level === ObjectiveLevel.individual &&
      dto.ownerId === viewer.id
    ) {
      return;
    }

    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权创建该目标',
    });
  }

  private async assertCanManage(
    objective: ObjectiveWithRelations,
    viewer: AuthUser,
  ): Promise<void> {
    if (this.isAdminLike(viewer)) return;
    if (objective.createdBy === viewer.id) return;

    // 部门负责人关系可管理部门/个人目标所在部门（含子部门）。
    if (objective.deptId) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });
      const managedDeptIds = (
        await Promise.all(managedDepts.map((d) => this.dataScope.getSubDeptIds(d.id)))
      ).flat();
      if (managedDeptIds.includes(objective.deptId)) return;
    }

    // 绩效直属上级关系可管理直属下属个人目标。
    if (objective.ownerId) {
      const employee = await this.prisma.user.findUnique({
        where: { id: objective.ownerId },
        select: { directManagerId: true },
      });
      if (employee?.directManagerId === viewer.id) return;
    }

    // 负责人可更新自己的个人目标。
    if (objective.ownerId === viewer.id && objective.level === ObjectiveLevel.individual) return;

    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权操作该目标',
    });
  }

  private isAdminLike(user: AuthUser): boolean {
    return user.sysRole === SysRole.system_admin || user.sysRole === SysRole.hr;
  }
}
