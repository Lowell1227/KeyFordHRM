import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SysRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth.types';
import { findDepartmentsByEffectiveApprover } from '@/departments/department-relations';

/**
 * 数据权限助手服务。
 *
 * 负责根据当前用户的系统权限与实时业务关系，计算其可见的在职员工范围，
 * 以及递归收集部门及其所有后代部门。
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取指定部门自身及其所有后代部门的 id 列表。
   *
   * 实现方式：一次性读取全部 department（仅 id、parentId），在内存中递归收集。
   * 部门层级最多 3 层，规模小，无需使用 raw CTE。
   *
   * @param deptId - 起始部门 id
   * @returns 字符串数组，包含 deptId 自身及其所有后代部门 id
   */
  async getSubDeptIds(deptId: string): Promise<string[]> {
    const allDepts = await this.prisma.department.findMany({
      select: { id: true, parentId: true },
    });

    const childrenMap = new Map<string, string[]>();
    for (const d of allDepts) {
      const list = childrenMap.get(d.parentId ?? '') ?? [];
      list.push(d.id);
      childrenMap.set(d.parentId ?? '', list);
    }

    const result: string[] = [];
    const queue: string[] = [deptId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = childrenMap.get(current) ?? [];
      queue.push(...children);
    }

    return result;
  }

  async getAncestorDeptIds(deptId: string): Promise<string[]> {
    const allDepts = await this.prisma.department.findMany({
      select: { id: true, parentId: true },
    });
    const parentById = new Map(allDepts.map((dept) => [dept.id, dept.parentId]));
    const result: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null | undefined = deptId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      result.push(currentId);
      currentId = parentById.get(currentId);
    }

    return result;
  }

  async getManagerChainIds(userId: string): Promise<string[]> {
    const allUsers = await this.prisma.user.findMany({
      select: { id: true, directManagerId: true },
    });
    const managerByUserId = new Map(allUsers.map((user) => [user.id, user.directManagerId]));
    const result: string[] = [];
    const visited = new Set<string>([userId]);
    let managerId = managerByUserId.get(userId);

    while (managerId && !visited.has(managerId)) {
      visited.add(managerId);
      result.push(managerId);
      managerId = managerByUserId.get(managerId);
    }

    return result;
  }

  /**
   * 返回 viewer 能看到的在职用户的 Prisma UserWhereInput 过滤条件。
   *
   * 规则：
   * - system_admin 或 canViewAll === true → 全量 {}
   * - SysRole.hr → 全量 {}
   * - 其他账号按实时关系合并：本人、直属下属、负责部门、最终审批范围
   * - assessor_only 始终仅看本人
   *
   * @param viewer - 当前登录用户（AuthUser）
   * @returns Prisma.UserWhereInput 对象，可直接传入 Prisma 查询的 where 参数
   */
  async getVisibleEmployeeFilter(viewer: AuthUser): Promise<Prisma.UserWhereInput> {
    /** 系统管理员或拥有全局查看权限的用户 → 可见全部在职员工。 */
    if (viewer.sysRole === SysRole.system_admin || viewer.canViewAll === true) {
      return {};
    }

    /** HR 角色 → 可见全部在职员工。 */
    if (viewer.sysRole === SysRole.hr) {
      return {};
    }

    if (viewer.isAssessorOnly) return { id: viewer.id };

    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        parentId: true,
        leaderId: true,
        approverId: true,
        leader: {
          select: {
            name: true,
            directManagerId: true,
            directManager: { select: { name: true } },
          },
        },
        approver: { select: { name: true } },
      },
    });

    const relations = departments.map((department) => ({
      id: department.id,
      name: department.name,
      parentId: department.parentId,
      leaderId: department.leaderId,
      leaderName: department.leader?.name ?? null,
      leaderDirectManagerId: department.leader?.directManagerId ?? null,
      leaderDirectManagerName: department.leader?.directManager?.name ?? null,
      approverId: department.approverId,
      approverName: department.approver?.name ?? null,
    }));
    const scopeRoots = new Set([
      ...relations.filter((department) => department.leaderId === viewer.id).map((department) => department.id),
      ...findDepartmentsByEffectiveApprover(relations, viewer.id),
    ]);
    const children = new Map<string, string[]>();
    for (const department of relations) {
      if (!department.parentId) continue;
      children.set(department.parentId, [...(children.get(department.parentId) ?? []), department.id]);
    }
    const departmentIds = new Set<string>();
    const queue = [...scopeRoots];
    while (queue.length > 0) {
      const departmentId = queue.shift()!;
      if (departmentIds.has(departmentId)) continue;
      departmentIds.add(departmentId);
      queue.push(...(children.get(departmentId) ?? []));
    }

    return {
      OR: [
        { id: viewer.id },
        { directManagerId: viewer.id },
        ...(departmentIds.size > 0 ? [{ deptId: { in: [...departmentIds] } }] : []),
      ],
    };
  }
}
