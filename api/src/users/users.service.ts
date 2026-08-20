import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExternalIdentityProvider, SysRole, UserStatus, EmploymentType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { PaginationDto, paginated, Paginated } from '@/common/dto/pagination.dto';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import * as bcrypt from 'bcrypt';

/** 用户列表项字段（参考后端文档 3.2） */
export interface UserListItem {
  id: string;
  employeeNo: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  deptId: string | null;
  deptName: string | null;
  position: string | null;
  sysRole: SysRole;
  status: UserStatus;
  employmentType: EmploymentType;
  directManagerId: string | null;
  directManagerName: string | null;
  isAssessorOnly: boolean;
  canViewAll: boolean;
  entryDate: Date | null;
  dingtalkBindingState: 'unbound' | 'enabled' | 'disabled';
}

/** 用户详情字段 */
export interface UserDetail {
  id: string;
  employeeNo: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  deptId: string | null;
  deptName: string | null;
  deptPath: string | null;
  position: string | null;
  sysRole: SysRole;
  status: UserStatus;
  employmentType: EmploymentType;
  directManagerId: string | null;
  directManagerName: string | null;
  isAssessorOnly: boolean;
  canViewAll: boolean;
  entryDate: Date | null;
  leaveDate: Date | null;
  createdAt: Date;
}

/** 用户摘要（用于更新后返回） */
export interface UserSummary {
  id: string;
  employeeNo: string | null;
  name: string;
  sysRole: SysRole;
  status: UserStatus;
  deptId: string | null;
  directManagerId: string | null;
}

/** Direct report roster item used by manager workspaces. */
export interface DirectReportItem extends UserSummary {
  avatarUrl: string | null;
  deptName: string | null;
  position: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  /** GET /users — 查询用户列表 */
  async findAll(dto: UserQueryDto, viewer: AuthUser): Promise<Paginated<UserListItem>> {
    const where: Prisma.UserWhereInput = { deletedAt: null };

    // 部门过滤（含子部门）
    if (dto.deptId) {
      const subDeptIds = await this.dataScope.getSubDeptIds(dto.deptId);
      where.deptId = { in: subDeptIds };
    }

    // 状态过滤
    if (dto.status) {
      where.status = dto.status;
    }

    // 用工类型过滤
    if (dto.employmentType) {
      where.employmentType = dto.employmentType;
    }

    // 系统角色过滤
    if (dto.sysRole) {
      where.sysRole = dto.sysRole;
    }

    // 关键词过滤（name / employeeNo 不区分大小写）
    if (dto.keyword) {
      where.OR = [
        { name: { contains: dto.keyword, mode: 'insensitive' } },
        { employeeNo: { contains: dto.keyword, mode: 'insensitive' } },
      ];
    }

    // 数据权限范围叠加（viewer 只能看到自己有权限的数据）
    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);
    if (Object.keys(scopeFilter).length > 0) {
      where.AND = [scopeFilter];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        include: {
          dept: { select: { name: true } },
          directManager: { select: { name: true } },
          externalIdentityBindings: {
            where: { provider: ExternalIdentityProvider.dingtalk, endedAt: null },
            select: { status: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const items: UserListItem[] = users.map((u) => ({
      id: u.id,
      employeeNo: u.employeeNo,
      name: u.name,
      phone: u.phone,
      email: u.email,
      avatarUrl: u.avatarUrl,
      deptId: u.deptId,
      deptName: u.dept?.name ?? null,
      position: u.position,
      sysRole: u.sysRole,
      status: u.status,
      employmentType: u.employmentType,
      directManagerId: u.directManagerId,
      directManagerName: u.directManager?.name ?? null,
      isAssessorOnly: u.isAssessorOnly,
      canViewAll: u.canViewAll,
      entryDate: u.entryDate,
      dingtalkBindingState: u.externalIdentityBindings[0]?.status ?? 'unbound',
    }));

    return paginated(items, total, dto);
  }

  /** GET /users/:id — 查询用户详情 */
  async findOne(id: string, viewer: AuthUser): Promise<UserDetail> {
    // 权限检查：本人 / HR / system_admin / canViewAll
    const canViewDirectly =
      viewer.id === id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll === true;

    if (!canViewDirectly) {
      const target = await this.prisma.user.findUnique({
        where: { id, deletedAt: null },
        select: { directManagerId: true },
      });
      if (!target) {
        throw new NotFoundException({
          code: ERROR_CODE.NOT_FOUND,
          message: '用户不存在',
        });
      }
      if (target.directManagerId !== viewer.id) {
        throw new ForbiddenException({
          code: ERROR_CODE.FORBIDDEN,
          message: '无权限查看该用户',
        });
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        dept: { select: { name: true, fullPath: true } },
        directManager: { select: { name: true } },
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '用户不存在',
      });
    }

    return {
      id: user.id,
      employeeNo: user.employeeNo,
      name: user.name,
      phone: user.phone,
      email: user.email,
      avatarUrl: user.avatarUrl,
      deptId: user.deptId,
      deptName: user.dept?.name ?? null,
      deptPath: user.dept?.fullPath ?? null,
      position: user.position,
      sysRole: user.sysRole,
      status: user.status,
      employmentType: user.employmentType,
      directManagerId: user.directManagerId,
      directManagerName: user.directManager?.name ?? null,
      isAssessorOnly: user.isAssessorOnly,
      canViewAll: user.canViewAll,
      entryDate: user.entryDate,
      leaveDate: user.leaveDate,
      createdAt: user.createdAt,
    };
  }

  /**
   * GET /users/:id/subordinates — 某人的直接下属列表（主管选人用）。
   * 仅本人 / HR / system_admin / canViewAll 可查，避免泄露组织结构。
   */
  async findSubordinates(managerId: string, viewer: AuthUser): Promise<DirectReportItem[]> {
    const privileged =
      viewer.id === managerId ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll === true;
    if (!privileged) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '无权限查看该用户的下属',
      });
    }

    const subs = await this.prisma.user.findMany({
      where: {
        directManagerId: managerId,
        deletedAt: null,
        status: UserStatus.active,
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        avatarUrl: true,
        sysRole: true,
        status: true,
        deptId: true,
        dept: { select: { name: true } },
        position: true,
        directManagerId: true,
      },
      orderBy: { name: 'asc' },
    });
    return subs.map((u) => ({
      ...this.toSummary(u),
      avatarUrl: u.avatarUrl,
      deptName: u.dept?.name ?? null,
      position: u.position,
    }));
  }

  /** PATCH /users/:id/manager — 更新直属主管 */
  async updateManager(id: string, dto: UpdateManagerDto, operator?: AuthUser): Promise<UserSummary> {
    return this.updateSettings(
      id,
      {
        directManagerId: dto.directManagerId ?? null,
        grantManagerRole: dto.grantManagerRole,
      },
      operator,
    );
  }

  /** PATCH /users/:id/settings — 统一更新人员关系与系统权限 */
  async updateSettings(id: string, dto: UpdateUserSettingsDto, operator?: AuthUser): Promise<UserSummary> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
    if (!targetUser) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '用户不存在',
      });
    }

    if (dto.sysRole !== undefined && operator?.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅系统管理员可以设置系统权限',
      });
    }

    const directManagerId = dto.directManagerId !== undefined
      ? dto.directManagerId ?? null
      : targetUser.directManagerId;
    let newManager: { id: string; sysRole: SysRole } | null = null;

    if (dto.grantManagerRole && operator?.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: '仅系统管理员可以同时开通主管权限',
      });
    }

    if (dto.grantManagerRole && !directManagerId) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '开通主管权限时必须指定直属主管',
      });
    }

    if ((dto.directManagerId !== undefined || dto.grantManagerRole) && directManagerId) {
      if (directManagerId === id) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '不能将自己设为自己的直属主管',
        });
      }

      newManager = await this.prisma.user.findUnique({
        where: { id: directManagerId, deletedAt: null },
        select: { id: true, sysRole: true },
      });
      if (!newManager) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '指定的直属主管不存在',
        });
      }

      // 环检测：沿 directManagerId 向上遍历，若遇到 targetUser.id 则形成环
      let currentId: string | null = directManagerId;
      const visited = new Set<string>();
      while (currentId) {
        if (visited.has(currentId)) {
          break; // 已有环，但继续抛出
        }
        visited.add(currentId);
        if (currentId === id) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: '设置的直属主管会形成汇报环',
          });
        }
        const next = await this.prisma.user.findUnique({
          where: { id: currentId, deletedAt: null },
          select: { directManagerId: true },
        });
        currentId = next?.directManagerId ?? null;
      }
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (dto.directManagerId !== undefined) {
      updateData.directManagerId = directManagerId;
    }
    if (dto.sysRole !== undefined) {
      updateData.sysRole = dto.sysRole;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignedUser = await tx.user.update({
          where: { id },
          data: updateData,
      });
      if (dto.grantManagerRole && newManager?.sysRole === SysRole.employee) {
        await tx.user.update({
          where: { id: newManager.id },
          data: { sysRole: SysRole.manager },
        });
      }
      return assignedUser;
    });

    return this.toSummary(updated);
  }

  /** PATCH /users/:id/role — 更新系统角色 */
  async updateRole(id: string, dto: UpdateRoleDto): Promise<UserSummary> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
    if (!targetUser) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '用户不存在',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { sysRole: dto.sysRole },
    });

    return this.toSummary(updated);
  }

  /** PATCH /users/:id/password — 设置密码 */
  async setPassword(id: string, dto: SetPasswordDto, operator: AuthUser): Promise<{ success: boolean }> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
    if (!targetUser) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '用户不存在',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash },
      });

      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'reset_password',
          entityType: 'user',
          entityId: id,
          oldValue: { userId: id },
          newValue: { resetAt: Date.now() },
        },
      });
    });

    return { success: true };
  }

  private toSummary(user: {
    id: string;
    employeeNo: string | null;
    name: string;
    sysRole: SysRole;
    status: UserStatus;
    deptId: string | null;
    directManagerId: string | null;
  }): UserSummary {
    return {
      id: user.id,
      employeeNo: user.employeeNo,
      name: user.name,
      sysRole: user.sysRole,
      status: user.status,
      deptId: user.deptId,
      directManagerId: user.directManagerId,
    };
  }
}
