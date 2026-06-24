import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SysRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth.types';

/**
 * 数据权限助手服务。
 *
 * 负责根据当前用户的角色与部门关系，计算其可见的在职员工范围，
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

  /**
   * 返回 viewer 能看到的在职用户的 Prisma UserWhereInput 过滤条件。
   *
   * 规则按 PRD 3.2：
   * - system_admin 或 canViewAll === true → 全量 {}
   * - SysRole.hr → 全量 {}
   * - SysRole.vp → viewer.id 作为 departments.approver_id 的部门（含子部门）的全部成员
   * - SysRole.dept_head → viewer.id 作为 departments.leader_id 的部门（含子部门）的全部成员
   * - SysRole.manager → directManagerId = viewer.id 的用户，加上 viewer 自己
   * - 其他（employee / assessor） → 仅自己
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

    /** VP 角色 → 可见自己作为 approver_id 的部门（含子部门）下的全部成员。 */
    if (viewer.sysRole === SysRole.vp) {
      const managedDepts = await this.prisma.department.findMany({
        where: { approverId: viewer.id },
        select: { id: true },
      });

      if (managedDepts.length === 0) {
        return { id: viewer.id };
      }

      const deptIds = (
        await Promise.all(managedDepts.map((d) => this.getSubDeptIds(d.id)))
      ).flat();

      return { deptId: { in: Array.from(new Set(deptIds)) } };
    }

    /** 部门负责人 → 可见自己作为 leader_id 的部门（含子部门）下的全部成员。 */
    if (viewer.sysRole === SysRole.dept_head) {
      const managedDepts = await this.prisma.department.findMany({
        where: { leaderId: viewer.id },
        select: { id: true },
      });

      if (managedDepts.length === 0) {
        return { id: viewer.id };
      }

      const deptIds = (
        await Promise.all(managedDepts.map((d) => this.getSubDeptIds(d.id)))
      ).flat();

      return { deptId: { in: Array.from(new Set(deptIds)) } };
    }

    /** 经理 → 可见自己的直接下属以及自己。 */
    if (viewer.sysRole === SysRole.manager) {
      return {
        OR: [{ directManagerId: viewer.id }, { id: viewer.id }],
      };
    }

    /** 普通员工 / 评估员 → 仅可见自己。 */
    return { id: viewer.id };
  }
}
