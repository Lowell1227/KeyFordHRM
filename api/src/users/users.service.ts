import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountType, ExternalIdentityProvider, SysRole, UserStatus, EmploymentType } from '@prisma/client';
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
import {
  BusinessCapabilitiesService,
  BusinessIdentity,
} from '@/auth/business-capabilities.service';
import { hasHrCapability } from '@/auth/hr-capabilities';
import * as bcrypt from 'bcrypt';

export type SystemPermission = 'standard_user' | 'hr_user' | 'hr_admin' | 'system_admin';

const EDITABLE_SYSTEM_ROLES = new Set<SysRole>([
  SysRole.employee,
  SysRole.hr_user,
  SysRole.hr,
  SysRole.system_admin,
]);

export function toSystemPermission(sysRole: SysRole): SystemPermission {
  if (sysRole === SysRole.system_admin) return 'system_admin';
  if (sysRole === SysRole.hr) return 'hr_admin';
  if (sysRole === SysRole.hr_user) return 'hr_user';
  return 'standard_user';
}

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
  systemPermission: SystemPermission;
  hrCapabilities: string[];
  businessIdentities: BusinessIdentity[];
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
  systemPermission: SystemPermission;
  hrCapabilities: string[];
  businessIdentities: BusinessIdentity[];
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
    private readonly businessCapabilities: BusinessCapabilitiesService,
  ) {}

  /** GET /users — 查询用户列表 */
  async findAll(dto: UserQueryDto, viewer: AuthUser): Promise<Paginated<UserListItem>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(dto.includeTestAccounts
        ? { accountType: { in: [AccountType.employee, AccountType.test] } }
        : { accountType: AccountType.employee }),
    };

    // 部门过滤（含子部门）
    if (dto.deptId) {
      const subDeptIds = await this.dataScope.getSubDeptIds(dto.deptId);
      where.deptId = { in: subDeptIds };
    }

    // 状态过滤
    if (dto.status) {
      where.status = dto.status;
    } else {
      where.status = { not: UserStatus.resigned };
    }

    // 用工类型过滤
    if (dto.employmentType) {
      where.employmentType = dto.employmentType;
    }

    // 系统权限过滤（employee 同时兼容尚未归一化的历史业务角色值）
    if (dto.sysRole) {
      where.sysRole = dto.sysRole === SysRole.employee
        ? { notIn: [SysRole.hr_user, SysRole.hr, SysRole.system_admin] }
        : dto.sysRole;
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

    const identitiesByUser = await this.businessCapabilities.getIdentitySummariesForUsers(
      users.map((user) => user.id),
    );
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
      systemPermission: toSystemPermission(u.sysRole),
      hrCapabilities: u.hrCapabilities,
      businessIdentities: identitiesByUser.get(u.id) ?? [],
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
      hasHrCapability(viewer, 'employee_archive_edit') ||
      hasHrCapability(viewer, 'employee_archive_review') ||
      hasHrCapability(viewer, 'organization_edit') ||
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

    const identities = await this.businessCapabilities.getIdentitySummariesForUsers([user.id]);
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
      systemPermission: toSystemPermission(user.sysRole),
      hrCapabilities: user.hrCapabilities,
      businessIdentities: identities.get(user.id) ?? [],
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
      hasHrCapability(viewer, 'employee_archive_edit') ||
      hasHrCapability(viewer, 'employee_archive_review') ||
      hasHrCapability(viewer, 'organization_edit') ||
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

  /** @deprecated 绩效直属上级变更必须走 HR 审核。 */
  async updateManager(id: string, dto: UpdateManagerDto, operator?: AuthUser): Promise<UserSummary> {
    void id;
    void dto;
    void operator;
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '绩效直属上级变更必须提交 HR 审核',
    });
  }

  /** PATCH /users/:id/settings — 更新系统权限；关系字段仅为旧客户端拒绝兼容。 */
  async updateSettings(id: string, dto: UpdateUserSettingsDto, operator?: AuthUser): Promise<UserSummary> {
    if (dto.directManagerId !== undefined || dto.grantManagerRole === true) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '绩效直属上级变更必须提交 HR 审核',
      });
    }
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

    if (dto.sysRole !== undefined && !EDITABLE_SYSTEM_ROLES.has(dto.sysRole)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '系统权限仅支持标准用户、普通 HR、HR 管理员或系统管理员',
      });
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (dto.sysRole !== undefined) {
      updateData.sysRole = dto.sysRole;
    }
    if (dto.hrCapabilities !== undefined) {
      if (operator?.sysRole !== SysRole.system_admin) {
        throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅系统管理员可以设置 HR 能力' });
      }
      updateData.hrCapabilities = dto.hrCapabilities;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignedUser = await tx.user.update({
        where: { id },
        data: updateData,
      });
      return assignedUser;
    });

    return this.toSummary(updated);
  }

  /** PATCH /users/:id/role — 更新系统权限（旧路由兼容）。 */
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

    if (!EDITABLE_SYSTEM_ROLES.has(dto.sysRole)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '系统权限仅支持标准用户、普通 HR、HR 管理员或系统管理员',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { sysRole: dto.sysRole },
    });

    return this.toSummary(updated);
  }

  /** PATCH /users/:id/password — 设置密码 */
  async setPassword(id: string, _dto: SetPasswordDto, operator: AuthUser): Promise<{ success: boolean }> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
    if (!targetUser) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '用户不存在',
      });
    }

    const passwordHash = await bcrypt.hash('0000', 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
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
