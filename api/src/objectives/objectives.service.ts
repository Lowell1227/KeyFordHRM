import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IndicatorProgressHealth,
  ObjectiveLevel,
  ObjectiveStatus,
  Prisma,
  SysRole,
  TaskStatus,
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

/** include 定义（字面量，便于 Prisma 推导类型）。 */
const objectiveIncludeDef = {
  dept: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  cycle: { select: { id: true, name: true } },
  relatedIndicator: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
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
  progress: number;
  healthStatus?: 'on_track' | 'at_risk' | 'blocked' | 'completed';
  attachments?: unknown[];
  createdBy?: string;
  creatorName?: string;
  updatedAt: Date;
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
  totalWeight: number;
  items: GoalTrackingItem[];
}

export interface UpdateIndicatorProgressInput {
  progress: number;
  healthStatus: IndicatorProgressHealth;
  content: string;
  attachments: Array<{ name: string; url: string; size?: number }>;
  expectedLatestUpdateAt?: string | null;
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

@Injectable()
export class ObjectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  /** GET /objectives — 列表或树。 */
  async findAll(
    query: ObjectiveQueryDto,
    viewer: AuthUser,
  ): Promise<ObjectiveNode[] | Paginated<ObjectiveNode>> {
    const where = await this.buildWhere(query, viewer);

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
      return paginated(objectives.map((o) => this.mapToNode(o)), total, query);
    }

    // 树模式：先取所有可见目标，再内存组装成森林。
    const objectives = await this.prisma.objective.findMany({
      where,
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });

    return this.buildForest(objectives.map((o) => this.mapToNode(o)));
  }

  /** GET /objectives/tree — 独立树接口（兼容前端直接调用）。 */
  async findTree(viewer: AuthUser, cycleId?: string): Promise<ObjectiveNode[]> {
    const where = await this.buildWhere({ cycleId }, viewer);
    const objectives = await this.prisma.objective.findMany({
      where,
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return this.buildForest(objectives.map((o) => this.mapToNode(o)));
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
      const viewerRecord = await this.prisma.user.findUnique({
        where: { id: viewer.id },
        select: { directManagerId: true },
      });
      if (viewerRecord?.directManagerId !== ownerId) {
        throw new ForbiddenException({
          code: ERROR_CODE.FORBIDDEN,
          message: '无权查看该员工的考核指标',
        });
      }
      indicatorWhere = {
        OR: [
          { visibilityScope: 'company' },
          { visibilityScope: 'direct_reports' },
          { visibilityScope: 'all_reports' },
          ...(viewer.deptId
            ? [
                { visibilityScope: 'department', task: { deptId: viewer.deptId } },
                { visibleDepartments: { some: { departmentId: viewer.deptId } } },
              ] satisfies Prisma.IndicatorInstanceWhereInput[]
            : []),
          { visibleUsers: { some: { userId: viewer.id } } },
        ],
      };
    }

    const task = await this.prisma.assessmentTask.findUnique({
      where: { cycleId_employeeId: { cycleId, employeeId: ownerId } },
      include: {
        employee: { select: { id: true, name: true } },
        cycle: { select: { id: true, name: true } },
        indicatorInstances: {
          ...(indicatorWhere ? { where: indicatorWhere } : {}),
          orderBy: { sortOrder: 'asc' },
          include: {
            objectiveAlignments: {
              include: {
                objective: {
                  select: { id: true, title: true, level: true, ownerId: true },
                },
              },
            },
            progressUpdates: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              include: { creator: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!task) {
      return { taskId: null, taskStatus: null, canEdit: false, totalWeight: 0, items: [] };
    }

    const editableStatuses = new Set<TaskStatus>([
      TaskStatus.indicator_setting,
      TaskStatus.indicator_confirming,
      TaskStatus.self_eval,
    ]);
    const canEdit = task.employeeId === viewer.id
      && task.selfEvalSubmittedAt == null
      && editableStatuses.has(task.status);
    const items = task.indicatorInstances.map((indicator) => {
      const latest = indicator.progressUpdates[0] ?? null;
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
            }
          : null,
      } satisfies GoalTrackingItem;
    });

    return {
      taskId: task.id,
      taskStatus: task.status,
      canEdit,
      totalWeight: Math.round(items.reduce((sum, item) => sum + (item.weight ?? 0), 0) * 100) / 100,
      items,
    };
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
            selfEvalSubmittedAt: true,
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
    const editableStatuses = new Set<TaskStatus>([
      TaskStatus.indicator_setting,
      TaskStatus.indicator_confirming,
      TaskStatus.self_eval,
    ]);
    if (!editableStatuses.has(indicator.task.status) || indicator.task.selfEvalSubmittedAt) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '当前考核阶段不允许更新进展',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.indicatorProgressUpdate.findFirst({
        where: { indicatorInstanceId: indicatorId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
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
          attachments: input.attachments as Prisma.InputJsonValue,
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
      };
    });
  }

  async findTrackingIndicator(indicatorId: string, viewer: AuthUser) {
    const viewerRecord = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { directManagerId: true },
    });
    const ownerVisibility: Prisma.IndicatorInstanceWhereInput[] = [
      { task: { employeeId: viewer.id } },
    ];
    if (viewerRecord?.directManagerId) {
      const managerId = viewerRecord.directManagerId;
      ownerVisibility.push(
        { AND: [{ task: { employeeId: managerId } }, { visibilityScope: 'company' }] },
        { AND: [{ task: { employeeId: managerId } }, { visibilityScope: 'direct_reports' }] },
        { AND: [{ task: { employeeId: managerId } }, { visibilityScope: 'all_reports' }] },
        {
          AND: [
            { task: { employeeId: managerId } },
            { visibleUsers: { some: { userId: viewer.id } } },
          ],
        },
      );
      if (viewer.deptId) {
        ownerVisibility.push(
          {
            AND: [
              { task: { employeeId: managerId } },
              { visibilityScope: 'department', task: { deptId: viewer.deptId } },
            ],
          },
          {
            AND: [
              { task: { employeeId: managerId } },
              { visibleDepartments: { some: { departmentId: viewer.deptId } } },
            ],
          },
        );
      }
    }
    const indicator = await this.prisma.indicatorInstance.findFirst({
      where: { AND: [{ id: indicatorId }, { OR: ownerVisibility }] },
      include: {
        task: {
          include: {
            employee: { select: { id: true, name: true } },
            cycle: { select: { id: true, name: true } },
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
          include: { creator: { select: { id: true, name: true } } },
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
    const editableStatuses = new Set<TaskStatus>([
      TaskStatus.indicator_setting,
      TaskStatus.indicator_confirming,
      TaskStatus.self_eval,
    ]);
    const effectiveWeight = Math.round(indicator.weight.toNumber() * 10_000) / 100;

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
      actualValue: indicator.actualValue?.toNumber() ?? null,
      actualNote: indicator.actualNote,
      ownerId: indicator.task.employee.id,
      ownerName: indicator.task.employee.name,
      cycleId: indicator.task.cycle.id,
      cycleName: indicator.task.cycle.name,
      taskStatus: indicator.task.status,
      canEdit: indicator.task.employeeId === viewer.id
        && indicator.task.selfEvalSubmittedAt == null
        && editableStatuses.has(indicator.task.status),
      alignedObjectives: indicator.objectiveAlignments.map(({ objective }) => objective),
      progressUpdates: indicator.progressUpdates.map((progress) => ({
        id: progress.id,
        progress: progress.progress,
        healthStatus: progress.healthStatus,
        content: progress.content,
        attachments: Array.isArray(progress.attachments) ? progress.attachments : [],
        createdBy: progress.creator.id,
        creatorName: progress.creator.name,
        updatedAt: progress.createdAt,
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

  async assertVisibleIds(ids: string[], viewer: AuthUser): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;

    const visibilityWhere = await this.buildWhere({}, viewer);
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

    const visibilityWhere = await this.buildWhere({}, viewer);
    const objectives = await this.prisma.objective.findMany({
      where: { AND: [visibilityWhere, { id: { in: uniqueIds } }] },
      include: objectiveIncludeDef,
      orderBy: [{ level: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return objectives.map((objective) => this.mapToNode(objective));
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

    await this.assertCanView(objective, viewer);
    return this.mapToNode(objective);
  }

  /** POST /objectives — 创建。 */
  async create(dto: CreateObjectiveDto, viewer: AuthUser): Promise<ObjectiveNode> {
    await this.assertCanCreate(dto, viewer);
    await this.validateParentLevel(dto.level, dto.parentId);

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
        relatedIndicatorId: dto.relatedIndicatorId,
        createdBy: viewer.id,
      },
      include: objectiveIncludeDef,
    });

    return this.mapToNode(created);
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
    await this.validateParentLevel(nextLevel, nextParentId);

    // 防止 company 级目标被挂到非 company 父目标下等非法移动。
    if (dto.parentId !== undefined && dto.parentId !== null && dto.parentId !== existing.parentId) {
      await this.validateCycleConsistency(id, dto.parentId);
    }

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
      },
      include: objectiveIncludeDef,
    });

    return this.mapToNode(updated);
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

    return this.mapToNode(updated);
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

  private mapToNode(objective: ObjectiveWithRelations): ObjectiveNode {
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
      const scope = await this.dataScope.getVisibleEmployeeFilter(viewer);
      const visibleOwnerIds: string[] = [];

      if ('id' in scope && typeof scope.id === 'string') {
        visibleOwnerIds.push(scope.id);
      }

      if (viewer.sysRole === SysRole.manager) {
        const subordinates = await this.prisma.user.findMany({
          where: scope,
          select: { id: true },
        });
        visibleOwnerIds.push(...subordinates.map((u) => u.id));
      }

      if (viewer.sysRole === SysRole.dept_head) {
        const deptIdFilter = scope.deptId;
        const deptIds: string[] = [];
        if (typeof deptIdFilter === 'string') {
          deptIds.push(deptIdFilter);
        } else if (deptIdFilter && 'in' in deptIdFilter && Array.isArray(deptIdFilter.in)) {
          deptIds.push(...(deptIdFilter.in as string[]));
        }
        if (deptIds.length > 0) {
          const deptMembers = await this.prisma.user.findMany({
            where: { deptId: { in: deptIds } },
            select: { id: true },
          });
          visibleOwnerIds.push(...deptMembers.map((u) => u.id));
        }
      }

      const uniqueIds = [...new Set(visibleOwnerIds)].filter(Boolean);
      where.OR = [
        { level: ObjectiveLevel.company },
        ...(uniqueIds.length > 0 ? [{ ownerId: { in: uniqueIds } }] : []),
        ...(viewer.deptId ? [{ deptId: viewer.deptId }] : []),
      ];
    }

    return where;
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

  private async validateCycleConsistency(id: string, parentId: string): Promise<void> {
    const [self, parent] = await Promise.all([
      this.prisma.objective.findUnique({ where: { id }, select: { cycleId: true } }),
      this.prisma.objective.findUnique({ where: { id: parentId }, select: { cycleId: true } }),
    ]);

    if (self?.cycleId && parent?.cycleId && self.cycleId !== parent.cycleId) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '子目标与父目标所属周期不一致',
      });
    }
  }

  private async assertCanView(
    objective: { level: ObjectiveLevel; ownerId: string | null; deptId: string | null },
    viewer: AuthUser,
  ): Promise<void> {
    if (this.isAdminLike(viewer)) return;
    if (objective.level === ObjectiveLevel.company) return;
    if (objective.ownerId === viewer.id) return;

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

    // 部门负责人可在管辖部门下建部门/个人目标。
    if (viewer.sysRole === SysRole.dept_head && dto.deptId) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });
      const managedDeptIds = (
        await Promise.all(managedDepts.map((d) => this.dataScope.getSubDeptIds(d.id)))
      ).flat();
      if (managedDeptIds.includes(dto.deptId)) return;
    }

    // 主管可为下属建个人目标。
    if (viewer.sysRole === SysRole.manager && dto.ownerId) {
      const employee = await this.prisma.user.findUnique({
        where: { id: dto.ownerId },
        select: { directManagerId: true },
      });
      if (employee?.directManagerId === viewer.id) return;
    }

    // 普通员工只能为自己建个人目标。
    if (
      viewer.sysRole === SysRole.employee &&
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

    // 部门负责人可管理部门/个人目标所在部门（含子部门）。
    if (viewer.sysRole === SysRole.dept_head && objective.deptId) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });
      const managedDeptIds = (
        await Promise.all(managedDepts.map((d) => this.dataScope.getSubDeptIds(d.id)))
      ).flat();
      if (managedDeptIds.includes(objective.deptId)) return;
    }

    // 主管可管理下属个人目标。
    if (viewer.sysRole === SysRole.manager && objective.ownerId) {
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
