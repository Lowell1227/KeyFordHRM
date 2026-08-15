import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActionItemStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { paginated, Paginated } from '@/common/dto/pagination.dto';
import { CreateActionItemDto } from './dto/create-action-item.dto';
import { UpdateActionItemDto } from './dto/update-action-item.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ActionItemQueryDto } from './dto/action-item-query.dto';
import { buildActionItemVisibilityWhere } from './action-item-visibility';

const actionItemInclude = {
  assignee: { select: { id: true, name: true } },
  creator:  { select: { id: true, name: true } },
  objective: { select: { id: true, title: true } },
} as const;

type ActionItemWithRelations = Prisma.ActionItemGetPayload<{ include: typeof actionItemInclude }>;

export interface ActionItemNode {
  id: string;
  objectiveId: string;
  objectiveTitle: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: ActionItemStatus;
  parentId: string | null;
  progress: number;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: Date;
  updatedAt: Date;
  children?: ActionItemNode[];
}

@Injectable()
export class ActionItemsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /action-items — 分页列表（含子任务树）。 */
  async findAll(
    query: ActionItemQueryDto,
    viewer: AuthUser,
  ): Promise<Paginated<ActionItemNode>> {
    const where = this.buildWhere(query, viewer);

    const [total, items] = await Promise.all([
      this.prisma.actionItem.count({ where }),
      this.prisma.actionItem.findMany({
        where,
        include: actionItemInclude,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
    ]);

    return paginated(items.map((i) => this.map(i)), total, query);
  }

  /** GET /action-items/tree?objectiveId= — 按目标返回行动项树。 */
  async findTree(objectiveId: string, viewer: AuthUser): Promise<ActionItemNode[]> {
    await this.assertObjectiveVisible(objectiveId, viewer);

    const items = await this.prisma.actionItem.findMany({
      where: { objectiveId },
      include: actionItemInclude,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    return this.buildTree(items.map((i) => this.map(i)));
  }

  /** GET /action-items/:id — 详情。 */
  async findOne(id: string, viewer: AuthUser): Promise<ActionItemNode> {
    const item = await this.getOrThrow(id);
    await this.assertObjectiveVisible(item.objectiveId, viewer);
    return this.map(item);
  }

  /** POST /action-items — 创建。 */
  async create(dto: CreateActionItemDto, viewer: AuthUser): Promise<ActionItemNode> {
    await this.assertObjectiveVisible(dto.objectiveId, viewer);

    if (dto.parentId) {
      const parent = await this.prisma.actionItem.findUnique({
        where: { id: dto.parentId },
        select: { objectiveId: true, parentId: true },
      });
      if (!parent) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '父任务不存在' });
      }
      if (parent.objectiveId !== dto.objectiveId) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '子任务必须与父任务属于同一目标',
        });
      }
      if (parent.parentId) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '最多支持两级任务（任务+子任务）',
        });
      }
    }

    const created = await this.prisma.actionItem.create({
      data: {
        objectiveId: dto.objectiveId,
        title: dto.title,
        description: dto.description,
        assigneeId: dto.assigneeId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status ?? ActionItemStatus.todo,
        parentId: dto.parentId,
        progress: dto.progress ?? 0,
        createdBy: viewer.id,
      },
      include: actionItemInclude,
    });

    return this.map(created);
  }

  /** PATCH /action-items/:id — 更新。 */
  async update(id: string, dto: UpdateActionItemDto, viewer: AuthUser): Promise<ActionItemNode> {
    const existing = await this.getOrThrow(id);
    await this.assertCanManage(existing, viewer);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      const parent = await this.prisma.actionItem.findUnique({
        where: { id: dto.parentId },
        select: { objectiveId: true, parentId: true },
      });
      if (!parent) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '父任务不存在' });
      }
      if (parent.objectiveId !== existing.objectiveId) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '子任务必须与父任务属于同一目标',
        });
      }
      if (parent.parentId) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '最多支持两级任务（任务+子任务）',
        });
      }
    }

    // done 状态自动将进度设为 100。
    let progressOverride: number | undefined;
    if (dto.status === ActionItemStatus.done) {
      progressOverride = 100;
    }

    const updated = await this.prisma.actionItem.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        assigneeId: dto.assigneeId === undefined ? undefined : dto.assigneeId,
        startDate: dto.startDate === undefined ? undefined : (dto.startDate ? new Date(dto.startDate) : null),
        dueDate: dto.dueDate === undefined ? undefined : (dto.dueDate ? new Date(dto.dueDate) : null),
        status: dto.status,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        progress: progressOverride ?? dto.progress,
      },
      include: actionItemInclude,
    });

    await this.rollupToObjective(updated.objectiveId);
    return this.map(updated);
  }

  /** PATCH /action-items/:id/progress — 更新进度并汇总到目标。 */
  async updateProgress(id: string, dto: UpdateProgressDto, viewer: AuthUser): Promise<ActionItemNode> {
    const existing = await this.getOrThrow(id);
    await this.assertCanManage(existing, viewer);

    const autoStatus =
      dto.progress === 100
        ? ActionItemStatus.done
        : dto.progress > 0 && existing.status === ActionItemStatus.todo
        ? ActionItemStatus.in_progress
        : undefined;

    const updated = await this.prisma.actionItem.update({
      where: { id },
      data: { progress: dto.progress, ...(autoStatus ? { status: autoStatus } : {}) },
      include: actionItemInclude,
    });

    await this.rollupToObjective(updated.objectiveId);
    return this.map(updated);
  }

  /** DELETE /action-items/:id — 删除。 */
  async remove(id: string, viewer: AuthUser): Promise<void> {
    const existing = await this.getOrThrow(id);
    await this.assertCanManage(existing, viewer);

    const childCount = await this.prisma.actionItem.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请先删除子任务' });
    }

    await this.prisma.actionItem.delete({ where: { id } });
    await this.rollupToObjective(existing.objectiveId);
  }

  // ---------------------------------------------------------------------------
  // 私有辅助
  // ---------------------------------------------------------------------------

  private buildWhere(query: ActionItemQueryDto, viewer: AuthUser): Prisma.ActionItemWhereInput {
    const where: Prisma.ActionItemWhereInput = {};

    if (query.objectiveId) where.objectiveId = query.objectiveId;
    if (query.status) where.status = query.status;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.parentId !== undefined) {
      where.parentId = query.parentId === null ? null : query.parentId;
    }

    // 非管理员只能看到自己负责或创建的行动项，或其目标下的公开行动项。
    Object.assign(where, buildActionItemVisibilityWhere(viewer));

    return where;
  }

  /** 将目标下所有行动项的平均进度汇总写回 objective.progress。 */
  private async rollupToObjective(objectiveId: string): Promise<void> {
    const items = await this.prisma.actionItem.findMany({
      where: { objectiveId, parentId: null },
      select: { progress: true },
    });

    if (items.length === 0) return;

    const avg = Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length);
    await this.prisma.objective.update({
      where: { id: objectiveId },
      data: { progress: avg },
    });
  }

  private async getOrThrow(id: string) {
    const item = await this.prisma.actionItem.findUnique({
      where: { id },
      include: actionItemInclude,
    });
    if (!item) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '行动项不存在' });
    }
    return item;
  }

  private async assertObjectiveVisible(objectiveId: string, viewer: AuthUser): Promise<void> {
    const objective = await this.prisma.objective.findUnique({
      where: { id: objectiveId },
      select: { id: true, level: true, ownerId: true, deptId: true },
    });
    if (!objective) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '目标不存在' });
    }
    if (this.isAdminLike(viewer)) return;
    if (objective.level === 'company') return;
    if (objective.ownerId === viewer.id) return;
    if (objective.deptId && objective.deptId === viewer.deptId) return;
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权访问该目标的行动项' });
  }

  private async assertCanManage(
    item: ActionItemWithRelations,
    viewer: AuthUser,
  ): Promise<void> {
    if (this.isAdminLike(viewer)) return;
    if (item.createdBy === viewer.id) return;
    if (item.assigneeId === viewer.id) return;

    if (viewer.sysRole === SysRole.manager || viewer.sysRole === SysRole.dept_head) {
      const assigneeIsSubordinate = item.assigneeId
        ? await this.prisma.user.count({
            where: { id: item.assigneeId, directManagerId: viewer.id },
          })
        : 0;
      if (assigneeIsSubordinate > 0) return;
    }

    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权操作该行动项' });
  }

  private buildTree(nodes: ActionItemNode[]): ActionItemNode[] {
    const map = new Map<string, ActionItemNode>();
    nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));

    const roots: ActionItemNode[] = [];
    nodes.forEach((n) => {
      const node = map.get(n.id)!;
      if (n.parentId && map.has(n.parentId)) {
        map.get(n.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    const clean = (node: ActionItemNode): ActionItemNode => {
      if (node.children && node.children.length === 0) delete node.children;
      else if (node.children) node.children = node.children.map(clean);
      return node;
    };

    return roots.map(clean);
  }

  private map(item: ActionItemWithRelations): ActionItemNode {
    return {
      id: item.id,
      objectiveId: item.objectiveId,
      objectiveTitle: item.objective?.title ?? null,
      title: item.title,
      description: item.description,
      assigneeId: item.assigneeId,
      assigneeName: item.assignee?.name ?? null,
      startDate: item.startDate ? (item.startDate as Date).toISOString().slice(0, 10) : null,
      dueDate: item.dueDate ? (item.dueDate as Date).toISOString().slice(0, 10) : null,
      status: item.status,
      parentId: item.parentId,
      progress: item.progress,
      createdBy: item.createdBy,
      creatorName: item.creator?.name ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private isAdminLike(user: AuthUser): boolean {
    return user.sysRole === SysRole.system_admin || user.sysRole === SysRole.hr;
  }
}
