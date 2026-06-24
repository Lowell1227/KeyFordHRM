import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImprovementPlanStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { paginated, Paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { FillImprovementPlanDto } from './dto/fill-improvement-plan.dto';
import { CompleteImprovementPlanDto } from './dto/complete-improvement-plan.dto';

/** 列表项。 */
export interface ImprovementPlanListItem {
  id: string;
  employeeId: string;
  cycleId: string;
  taskId: string;
  creatorId: string | null;
  improvementNeed: string | null;
  importance: string | null;
  improvementGoal: string | null;
  targetDate: Date | null;
  measures: Prisma.JsonValue;
  finalScore: number | null;
  status: ImprovementPlanStatus;
  createdAt: Date;
  updatedAt: Date;
  employee: { id: string; name: string; employeeNo: string | null; deptName: string | null } | null;
  cycle: { id: string; name: string } | null;
  creator: { id: string; name: string } | null;
  deptName: string | null;
}

/** 详情。 */
export interface ImprovementPlanDetail extends ImprovementPlanListItem {}

/** 连续 D 预警结果。 */
export interface ConsecutiveDWarning {
  hasWarning: boolean;
  consecutiveCount: number;
  archives: Array<{
    cycleId: string;
    cycleName: string;
    grade: string;
    archivedAt: Date;
  }>;
}

/** 查询参数。 */
export interface ImprovementPlanQuery {
  employeeId?: string;
  cycleId?: string;
  status?: ImprovementPlanStatus;
}

@Injectable()
export class ImprovementPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  /** GET /improvement-plans — 列表（员工仅见自己的）。 */
  async findAll(
    query: ImprovementPlanQuery,
    pagination: PaginationDto,
    viewer: AuthUser,
  ): Promise<Paginated<ImprovementPlanListItem>> {
    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);

    const where: Prisma.ImprovementPlanWhereInput = {};
    if (Object.keys(scopeFilter).length > 0) {
      where.employee = scopeFilter;
    }
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.cycleId) {
      where.cycleId = query.cycleId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, plans] = await Promise.all([
      this.prisma.improvementPlan.count({ where }),
      this.prisma.improvementPlan.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
          cycle: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginated(plans.map((p) => this.mapToItem(p)), total, pagination);
  }

  /** GET /improvement-plans/:id — 详情。 */
  async findOne(id: string, viewer: AuthUser): Promise<ImprovementPlanDetail> {
    const plan = await this.prisma.improvementPlan.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
        cycle: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    if (!plan) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '改进计划不存在',
      });
    }

    await this.assertCanView(plan.employeeId, viewer);
    return this.mapToItem(plan);
  }

  /** POST /improvement-plans/:id/fill — 主管/HR 填写计划。 */
  async fill(
    id: string,
    dto: FillImprovementPlanDto,
    viewer: AuthUser,
  ): Promise<ImprovementPlanDetail> {
    const plan = await this.prisma.improvementPlan.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
        cycle: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    if (!plan) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '改进计划不存在',
      });
    }

    await this.assertCanManage(plan.employeeId, viewer);

    if (plan.status !== ImprovementPlanStatus.draft) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '仅待制定状态的计划可以填写',
      });
    }

    const updated = await this.prisma.improvementPlan.update({
      where: { id },
      data: {
        improvementNeed: dto.improvementNeed,
        importance: dto.importance,
        improvementGoal: dto.improvementGoal,
        targetDate: new Date(dto.targetDate),
        measures: dto.measures as unknown as Prisma.InputJsonValue,
        status: ImprovementPlanStatus.in_progress,
        creatorId: plan.creatorId ?? viewer.id,
      },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
        cycle: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    return this.mapToItem(updated);
  }

  /** POST /improvement-plans/:id/complete — 主管/HR 录最终评分。 */
  async complete(
    id: string,
    dto: CompleteImprovementPlanDto,
    viewer: AuthUser,
  ): Promise<ImprovementPlanDetail> {
    const plan = await this.prisma.improvementPlan.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
        cycle: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    if (!plan) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '改进计划不存在',
      });
    }

    await this.assertCanManage(plan.employeeId, viewer);

    if (plan.status !== ImprovementPlanStatus.in_progress) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '仅进行中的计划可以录入最终评分',
      });
    }

    const updated = await this.prisma.improvementPlan.update({
      where: { id },
      data: {
        finalScore: dto.finalScore,
        status: ImprovementPlanStatus.completed,
      },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } } },
        cycle: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    return this.mapToItem(updated);
  }

  /** GET /improvement-plans/employee/:employeeId/consecutive-d-warning */
  async detectConsecutiveD(employeeId: string): Promise<ConsecutiveDWarning> {
    const archives = await this.prisma.performanceArchive.findMany({
      where: { employeeId },
      include: { cycle: { select: { name: true } } },
      orderBy: { archivedAt: 'desc' },
      take: 2,
    });

    const hasWarning =
      archives.length >= 2 && archives.every((a) => a.grade === 'D');

    let consecutiveCount = 0;
    if (hasWarning) {
      consecutiveCount = await this.countConsecutiveDs(employeeId);
    }

    return {
      hasWarning,
      consecutiveCount,
      archives: archives.map((a) => ({
        cycleId: a.cycleId,
        cycleName: a.cycle.name,
        grade: a.grade,
        archivedAt: a.archivedAt,
      })),
    };
  }

  /** 计算从最近一条归档开始的连续 D 次数。 */
  private async countConsecutiveDs(employeeId: string): Promise<number> {
    const archives = await this.prisma.performanceArchive.findMany({
      where: { employeeId },
      orderBy: { archivedAt: 'desc' },
      select: { grade: true },
    });

    let count = 0;
    for (const archive of archives) {
      if (archive.grade === 'D') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** 校验 viewer 是否有权查看某员工的数据。 */
  private async assertCanView(employeeId: string, viewer: AuthUser): Promise<void> {
    if (viewer.id === employeeId) return;

    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);
    const visible = await this.prisma.user.count({
      where: { AND: [{ id: employeeId }, scopeFilter] },
    });

    if (visible === 0) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权查看该改进计划',
      });
    }
  }

  /** 校验 viewer 是否有权管理（填写/完成）某员工的计划。 */
  private async assertCanManage(employeeId: string, viewer: AuthUser): Promise<void> {
    if (viewer.sysRole === SysRole.system_admin || viewer.sysRole === SysRole.hr) {
      return;
    }

    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { directManagerId: true, deptId: true },
    });

    if (!employee) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '员工不存在',
      });
    }

    // 直接主管
    if (viewer.sysRole === SysRole.manager && employee.directManagerId === viewer.id) {
      return;
    }

    // 部门负责人
    if (viewer.sysRole === SysRole.dept_head && employee.deptId) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });
      const managedDeptIds = (
        await Promise.all(managedDepts.map((d) => this.dataScope.getSubDeptIds(d.id)))
      ).flat();
      if (managedDeptIds.includes(employee.deptId)) {
        return;
      }
    }

    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权操作该改进计划',
    });
  }

  private mapToItem(
    plan: Prisma.ImprovementPlanGetPayload<{
      include: {
        employee: { select: { id: true; name: true; employeeNo: true; dept: { select: { name: true } } } };
        cycle: { select: { id: true; name: true } };
        creator: { select: { id: true; name: true } };
      };
    }>,
  ): ImprovementPlanListItem {
    return {
      id: plan.id,
      employeeId: plan.employeeId,
      cycleId: plan.cycleId,
      taskId: plan.taskId,
      creatorId: plan.creatorId,
      improvementNeed: plan.improvementNeed,
      importance: plan.importance,
      improvementGoal: plan.improvementGoal,
      targetDate: plan.targetDate,
      measures: plan.measures,
      finalScore: plan.finalScore,
      status: plan.status,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      employee: plan.employee
        ? {
            id: plan.employee.id,
            name: plan.employee.name,
            employeeNo: plan.employee.employeeNo,
            deptName: plan.employee.dept?.name ?? null,
          }
        : null,
      cycle: plan.cycle,
      creator: plan.creator,
      deptName: plan.employee?.dept?.name ?? null,
    };
  }
}
