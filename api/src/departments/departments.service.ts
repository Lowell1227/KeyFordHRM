import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentQueryDto } from './dto/department-query.dto';
import { UpdateApproverDto } from './dto/update-approver.dto';
import { UpdateLeaderDto } from './dto/update-leader.dto';
import { ERROR_CODE } from '../common/constants/error-codes';
import { CompanyCode } from '@prisma/client';
import { buildEffectiveApproverMap } from './department-relations';

export interface DepartmentNode {
  id: string;
  name: string;
  fullPath: string | null;
  leaderId: string | null;
  leaderName: string | null;
  approverId: string | null;
  approverName: string | null;
  effectiveApproverId?: string | null;
  effectiveApproverName?: string | null;
  effectiveApproverSource?: 'manual_override' | 'parent_leader' | 'ancestor_chain' | 'unresolved';
  effectiveApproverDeptId?: string | null;
  effectiveApproverDeptName?: string | null;
  company?: CompanyCode;
  sortOrder?: number;
  isActive?: boolean;
  directMemberCount?: number;
  memberCount: number;
  children?: DepartmentNode[];
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: DepartmentQueryDto): Promise<DepartmentNode[]> {
    const { flat = false, company, isActive } = query;

    const where = {
      ...(company ? { company: company as CompanyCode } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    };

    const departments = await this.prisma.department.findMany({
      where,
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        leaderId: true,
        approverId: true,
        company: true,
        sortOrder: true,
        isActive: true,
        leader: { select: { name: true } },
        approver: { select: { name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const deptIds = departments.map((d) => d.id);
    const childrenByParent = new Map<string, typeof departments>();
    departments.forEach((dept) => {
      if (!dept.parentId) return;
      const children = childrenByParent.get(dept.parentId) ?? [];
      children.push(dept);
      childrenByParent.set(dept.parentId, children);
    });

    const directCounts = await this.prisma.user.groupBy({
      by: ['deptId'],
      where: {
        deptId: { in: deptIds },
        deletedAt: null,
        status: { not: 'resigned' },
      },
      _count: { _all: true },
    });

    const directCountMap = new Map<string, number>();
    directCounts.forEach((item) => {
      if (item.deptId) {
        directCountMap.set(item.deptId, item._count._all);
      }
    });

    const collectSubDeptIds = (deptId: string): string[] => {
      const children = childrenByParent.get(deptId) ?? [];
      return [deptId, ...children.flatMap((child) => collectSubDeptIds(child.id))];
    };

    const countMap = new Map<string, number>();
    deptIds.forEach((id) => {
      const scopedDeptIds = collectSubDeptIds(id);
      const total = scopedDeptIds.reduce((sum, scopedDeptId) => sum + (directCountMap.get(scopedDeptId) ?? 0), 0);
      countMap.set(id, total);
    });

    const effectiveApproverMap = buildEffectiveApproverMap(
      departments.map((d) => ({
        id: d.id,
        name: d.name,
        parentId: d.parentId ?? null,
        leaderId: d.leaderId ?? null,
        leaderName: d.leader?.name ?? null,
        approverId: d.approverId ?? null,
        approverName: d.approver?.name ?? null,
      })),
    );

    const baseNodes = departments.map((d) => {
      const effectiveApprover = effectiveApproverMap.get(d.id);

      return {
        id: d.id,
        name: d.name,
        fullPath: d.fullPath,
        leaderId: d.leaderId,
        leaderName: d.leader?.name ?? null,
        approverId: d.approverId,
        approverName: effectiveApprover?.effectiveApproverName ?? d.approver?.name ?? null,
        effectiveApproverId: effectiveApprover?.effectiveApproverId ?? null,
        effectiveApproverName: effectiveApprover?.effectiveApproverName ?? null,
        effectiveApproverSource: effectiveApprover?.effectiveApproverSource ?? 'unresolved',
        effectiveApproverDeptId: effectiveApprover?.sourceDeptId ?? null,
        effectiveApproverDeptName: effectiveApprover?.sourceDeptName ?? null,
        company: d.company,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        directMemberCount: directCountMap.get(d.id) ?? 0,
        memberCount: countMap.get(d.id) ?? 0,
      };
    });

    if (flat) {
      return baseNodes;
    }

    const nodeMap = new Map<string, DepartmentNode>();
    baseNodes.forEach((n) => nodeMap.set(n.id, { ...n, children: [] }));

    const roots: DepartmentNode[] = [];
    departments.forEach((d) => {
      const node = nodeMap.get(d.id)!;
      if (d.parentId && nodeMap.has(d.parentId)) {
        nodeMap.get(d.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortChildren = (nodes: DepartmentNode[]) => {
      nodes.sort((a, b) => {
        const aOrder = departments.find((d) => d.id === a.id)?.sortOrder ?? 0;
        const bOrder = departments.find((d) => d.id === b.id)?.sortOrder ?? 0;
        return aOrder - bOrder;
      });
      nodes.forEach((n) => {
        if (n.children && n.children.length > 0) {
          sortChildren(n.children);
        }
      });
    };

    sortChildren(roots);
    return roots;
  }

  async updateApprover(id: string, dto: UpdateApproverDto): Promise<DepartmentNode> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fullPath: true,
        leaderId: true,
        approverId: true,
        leader: { select: { name: true } },
        approver: { select: { name: true } },
      },
    });

    if (!department) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '部门不存在',
      });
    }

    const approverId = dto.approverId ?? null;

    if (approverId) {
      const user = await this.prisma.user.findUnique({
        where: { id: approverId },
        select: { id: true, deletedAt: true },
      });

      if (!user || user.deletedAt !== null) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '审批人不存在或已删除',
        });
      }
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: { approverId },
      select: {
        id: true,
        name: true,
        fullPath: true,
        leaderId: true,
        approverId: true,
        leader: { select: { name: true } },
        approver: { select: { name: true } },
      },
    });

    const memberCount = await this.prisma.user.count({
      where: {
        deptId: id,
        deletedAt: null,
        status: { not: 'resigned' },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      fullPath: updated.fullPath,
      leaderId: updated.leaderId,
      leaderName: updated.leader?.name ?? null,
      approverId: updated.approverId,
      approverName: updated.approver?.name ?? null,
      directMemberCount: memberCount,
      memberCount,
    };
  }

  async updateLeader(id: string, dto: UpdateLeaderDto): Promise<DepartmentNode> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fullPath: true,
        leaderId: true,
        approverId: true,
        leader: { select: { name: true } },
        approver: { select: { name: true } },
      },
    });

    if (!department) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '部门不存在',
      });
    }

    const leaderId = dto.leaderId ?? null;

    if (leaderId) {
      const user = await this.prisma.user.findUnique({
        where: { id: leaderId },
        select: { id: true, deletedAt: true },
      });

      if (!user || user.deletedAt !== null) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '组织负责人不存在或已删除',
        });
      }
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: { leaderId },
      select: {
        id: true,
        name: true,
        fullPath: true,
        leaderId: true,
        approverId: true,
        leader: { select: { name: true } },
        approver: { select: { name: true } },
      },
    });

    const memberCount = await this.prisma.user.count({
      where: {
        deptId: id,
        deletedAt: null,
        status: { not: 'resigned' },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      fullPath: updated.fullPath,
      leaderId: updated.leaderId,
      leaderName: updated.leader?.name ?? null,
      approverId: updated.approverId,
      approverName: updated.approver?.name ?? null,
      directMemberCount: memberCount,
      memberCount,
    };
  }
}
