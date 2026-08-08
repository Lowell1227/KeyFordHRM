import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObjectiveLevel, ObjectiveStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { paginated, Paginated } from '@/common/dto/pagination.dto';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto } from './dto/update-objective.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ObjectiveQueryDto } from './dto/objective-query.dto';

/** include 定义（字面量，便于 Prisma 推导类型）。 */
const objectiveIncludeDef = {
  dept: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  cycle: { select: { id: true, name: true } },
  relatedIndicator: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

type ObjectiveWithRelations = Prisma.ObjectiveGetPayload<{ include: typeof objectiveIncludeDef }>;

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
