import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { IndicatorVisibilityScope, Prisma, SysRole } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { Paginated, paginated } from '@/common/dto/pagination.dto';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { ObjectivesService } from '@/objectives/objectives.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ReferenceIndicatorQueryDto } from './dto/reference-indicator-query.dto';
import {
  buildVisibilityScopeWhere,
  normalizeIndicatorVisibilityScopes,
} from './indicator-visibility.rules';

export interface IndicatorVisibilitySelection {
  visibilityScope?: IndicatorVisibilityScope;
  visibilityScopes?: IndicatorVisibilityScope[];
  visibleDepartmentIds: string[];
  visibleUserIds: string[];
  alignedObjectiveIds: string[];
}

export interface IndicatorTaskContext {
  id: string;
  employeeId: string;
  deptId: string | null;
  managerId: string | null;
}

export interface IndicatorReferenceItem {
  id: string;
  taskId: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  name: string;
  weight: number;
  visibilityScope: IndicatorVisibilityScope;
  visibilityScopes: IndicatorVisibilityScope[];
}

@Injectable()
export class IndicatorVisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly objectivesService: ObjectivesService,
  ) {}

  async validateSelection(
    selection: IndicatorVisibilitySelection,
    _task: IndicatorTaskContext,
    viewer: AuthUser,
  ): Promise<void> {
    const visibilityScopes = normalizeIndicatorVisibilityScopes(selection);
    const departmentIds = [...new Set(selection.visibleDepartmentIds ?? [])];
    const userIds = [...new Set(selection.visibleUserIds ?? [])];
    const objectiveIds = [...new Set(selection.alignedObjectiveIds ?? [])];

    if (
      visibilityScopes.includes(IndicatorVisibilityScope.custom) &&
      departmentIds.length === 0 &&
      userIds.length === 0
    ) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '自定义可见范围至少选择一个部门或员工',
      });
    }

    if (
      !visibilityScopes.includes(IndicatorVisibilityScope.custom) &&
      (departmentIds.length > 0 || userIds.length > 0)
    ) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '非自定义可见范围不能提交部门或员工',
      });
    }

    const employeeScope = await this.dataScope.getVisibleEmployeeFilter(viewer);
    if (userIds.length > 0) {
      const visibleUsers = await this.prisma.user.findMany({
        where: {
          AND: [employeeScope, { id: { in: userIds } }, { status: 'active' }, { deletedAt: null }],
        },
        select: { id: true },
      });
      if (visibleUsers.length !== userIds.length) this.throwSelectionForbidden();
    }

    if (departmentIds.length > 0) {
      if (this.canSelectAnyDepartment(viewer)) {
        const departments = await this.prisma.department.findMany({
          where: { id: { in: departmentIds }, isActive: true },
          select: { id: true },
        });
        if (departments.length !== departmentIds.length) this.throwSelectionForbidden();
      } else {
        const visibleDepartments = await this.prisma.user.findMany({
          where: {
            AND: [
              employeeScope,
              { deptId: { in: departmentIds } },
              { dept: { isActive: true } },
              { status: 'active' },
              { deletedAt: null },
            ],
          },
          select: { deptId: true },
          distinct: ['deptId'],
        });
        const visibleIds = new Set(visibleDepartments.flatMap((user) => (user.deptId ? [user.deptId] : [])));
        if (departmentIds.some((id) => !visibleIds.has(id))) this.throwSelectionForbidden();
      }
    }

    await this.objectivesService.assertVisibleIds(objectiveIds, viewer);
  }

  async buildReferenceWhere(viewer: AuthUser): Promise<Prisma.IndicatorInstanceWhereInput> {
    const [viewerRecord, ancestorDeptIds, managerChainIds] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: viewer.id },
        select: { directManagerId: true },
      }),
      viewer.deptId ? this.dataScope.getAncestorDeptIds(viewer.deptId) : Promise.resolve([]),
      this.dataScope.getManagerChainIds(viewer.id),
    ]);

    const clauses: Prisma.IndicatorInstanceWhereInput[] = [
      { task: { employeeId: viewer.id } },
      {
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.company),
        ],
      },
      {
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.supervisors),
          { task: { managerId: viewer.id } },
        ],
      },
      {
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.custom),
          { visibleUsers: { some: { userId: viewer.id } } },
        ],
      },
    ];

    if (viewer.deptId) {
      clauses.push(
        {
          AND: [
            buildVisibilityScopeWhere(IndicatorVisibilityScope.department),
            { task: { deptId: viewer.deptId } },
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
            { visibleDepartments: { some: { departmentId: viewer.deptId } } },
          ],
        },
      );
    }
    if (viewerRecord?.directManagerId) {
      clauses.push({
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.direct_reports),
          { task: { employeeId: viewerRecord.directManagerId } },
        ],
      });
    }
    if (managerChainIds.length > 0) {
      clauses.push({
        AND: [
          buildVisibilityScopeWhere(IndicatorVisibilityScope.all_reports),
          { task: { employeeId: { in: managerChainIds } } },
        ],
      });
    }

    return { OR: clauses };
  }

  async findVisibleReferences(
    query: ReferenceIndicatorQueryDto,
    viewer: AuthUser,
  ): Promise<Paginated<IndicatorReferenceItem>> {
    const conditions: Prisma.IndicatorInstanceWhereInput[] = [await this.buildReferenceWhere(viewer)];
    if (query.cycleId) conditions.push({ task: { cycleId: query.cycleId } });
    if (query.ownerId) conditions.push({ task: { employeeId: query.ownerId } });
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      conditions.push({
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          {
            task: {
              employee: { name: { contains: keyword, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    const where: Prisma.IndicatorInstanceWhereInput = { AND: conditions };
    const [total, indicators] = await Promise.all([
      this.prisma.indicatorInstance.count({ where }),
      this.prisma.indicatorInstance.findMany({
        where,
        select: {
          id: true,
          taskId: true,
          name: true,
          weight: true,
          visibilityScope: true,
          visibilityRules: {
            orderBy: { scope: 'asc' },
            select: { scope: true },
          },
          task: {
            select: {
              cycleId: true,
              employee: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
    ]);

    return paginated(
      indicators.map((indicator) => ({
        id: indicator.id,
        taskId: indicator.taskId,
        cycleId: indicator.task.cycleId,
        employeeId: indicator.task.employee.id,
        employeeName: indicator.task.employee.name,
        name: indicator.name,
        weight: indicator.weight.toNumber(),
        visibilityScope: indicator.visibilityScope,
        visibilityScopes: indicator.visibilityRules.length
          ? indicator.visibilityRules.map((rule) => rule.scope)
          : [indicator.visibilityScope],
      })),
      total,
      query,
    );
  }

  private canSelectAnyDepartment(viewer: AuthUser): boolean {
    return viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin || viewer.canViewAll;
  }

  private throwSelectionForbidden(): never {
    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权选择所提交的可见范围',
    });
  }
}
