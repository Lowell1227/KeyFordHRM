import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentQueryDto } from './dto/department-query.dto';
import { UpdateApproverDto } from './dto/update-approver.dto';
import { UpdateLeaderDto } from './dto/update-leader.dto';
import { ERROR_CODE } from '../common/constants/error-codes';
import { AccountType, CompanyCode, Prisma, SysRole } from '@prisma/client';
import { buildEffectiveApproverMap } from './department-relations';
import { UpdateDepartmentStructureDto } from './dto/update-department-structure.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { MergeDepartmentDto } from './dto/merge-department.dto';
import type { AuthUser } from '@/common/types/auth.types';

interface DepartmentStructureRecord {
  id: string;
  name: string;
  fullPath: string | null;
  parentId: string | null;
  company: CompanyCode;
  sortOrder?: number;
  isActive?: boolean;
  leaderId?: string | null;
  approverId?: string | null;
}

type DepartmentChangeAction = 'create' | 'update_structure' | 'update_leader' | 'merge' | 'delete';

interface DepartmentChangeRecord {
  id: string;
  departmentId: string | null;
  departmentName: string;
  action: string;
  status: string;
  baseValue: Prisma.JsonValue;
  proposedValue: Prisma.JsonValue;
  createdById: string;
}

export interface DepartmentNode {
  id: string;
  name: string;
  fullPath: string | null;
  parentId?: string | null;
  leaderId: string | null;
  leaderName: string | null;
  approverId: string | null;
  approverName: string | null;
  effectiveApproverId?: string | null;
  effectiveApproverName?: string | null;
  effectiveApproverSource?:
    | 'manual_override'
    | 'leader_manager'
    | 'parent_leader'
    | 'ancestor_chain'
    | 'unresolved';
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

  private buildPathMap(departments: DepartmentStructureRecord[]): Map<string, string> {
    const nodes = new Map(departments.map((item) => [item.id, item]));
    const paths = new Map<string, string>();

    const buildPath = (nodeId: string, visiting = new Set<string>()): string => {
      const cached = paths.get(nodeId);
      if (cached) return cached;
      if (visiting.has(nodeId)) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '组织架构存在循环' });
      }
      const node = nodes.get(nodeId);
      if (!node) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '组织架构存在无效的上级部门' });
      }
      visiting.add(nodeId);
      const parentPath = node.parentId ? buildPath(node.parentId, visiting) : '';
      visiting.delete(nodeId);
      const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
      paths.set(nodeId, path);
      return path;
    };

    departments.forEach((item) => buildPath(item.id));
    return paths;
  }

  private isDescendant(
    departments: DepartmentStructureRecord[],
    ancestorId: string,
    candidateId: string,
  ): boolean {
    const nodes = new Map(departments.map((item) => [item.id, item]));
    let cursor = nodes.get(candidateId);
    const visited = new Set<string>();
    while (cursor?.parentId) {
      if (cursor.parentId === ancestorId) return true;
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = nodes.get(cursor.parentId);
    }
    return false;
  }

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
        leader: {
          select: {
            name: true,
            directManagerId: true,
            directManager: { select: { name: true } },
          },
        },
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
        accountType: AccountType.employee,
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
        leaderDirectManagerId: d.leader?.directManagerId ?? null,
        leaderDirectManagerName: d.leader?.directManager?.name ?? null,
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
        parentId: d.parentId,
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

  async create(dto: CreateDepartmentDto, operator: AuthUser) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请输入部门名称' });
    }

    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        company: true,
        sortOrder: true,
        isActive: true,
        leaderId: true,
        approverId: true,
      },
    });
    const parentId = dto.parentId ?? null;
    const parent = parentId ? departments.find((item) => item.id === parentId) : null;
    if (parentId && !parent) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '上级部门不存在或已停用' });
    }
    const company = parent?.company ?? dto.company;
    if (!company) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '新建根部门时请选择所属公司' });
    }
    const duplicate = departments.some((item) => item.parentId === parentId && item.name === name);
    if (duplicate) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '同一上级下已存在同名部门' });
    }
    const siblingSortOrders = departments
      .filter((item) => item.parentId === parentId)
      .map((item) => item.sortOrder ?? 0);
    const sortOrder = (siblingSortOrders.length > 0 ? Math.max(...siblingSortOrders) : 0) + 1;
    const fullPath = parent?.fullPath ? `${parent.fullPath} / ${name}` : name;

    return this.submitChangeRequest(
      'create',
      null,
      name,
      {},
      { name, parentId, parentName: parent?.name ?? null, company, sortOrder, fullPath },
      operator,
    );
  }

  async updateStructure(id: string, dto: UpdateDepartmentStructureDto, operator: AuthUser) {
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        company: true,
        leaderId: true,
        approverId: true,
        isActive: true,
      },
    });
    const target = departments.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '部门不存在' });
    }
    const parentId = dto.parentId === undefined ? target.parentId : dto.parentId;
    const requestedName = dto.name?.trim();
    if (dto.name !== undefined && !requestedName) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请输入部门名称' });
    }
    const name = requestedName || target.name;
    const company = dto.company ?? target.company;
    const leaderId = dto.leaderId === undefined ? target.leaderId : dto.leaderId;
    const approverId = dto.approverId === undefined ? target.approverId : dto.approverId;
    if (parentId === id) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门不能挂靠到自身' });
    }
    if (parentId) {
      const parent = departments.find((item) => item.id === parentId);
      if (!parent) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '目标上级部门不存在' });
      }
      let cursor: typeof parent | undefined = parent;
      const visited = new Set<string>();
      while (cursor) {
        if (cursor.id === id) {
          throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门不能挂靠到自己的下级' });
        }
        if (visited.has(cursor.id)) break;
        visited.add(cursor.id);
        cursor = departments.find((item) => item.id === cursor?.parentId);
      }
    }

    const duplicate = departments.some((item) => (
      item.id !== id
      && item.parentId === parentId
      && item.name === name
    ));
    if (duplicate) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '同一上级下已存在同名部门' });
    }

    const parent = parentId ? departments.find((item) => item.id === parentId) : null;
    if (parent && parent.company !== company) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '上级部门与所属公司必须一致' });
    }
    if (departments.some((item) => item.parentId === id && item.company !== company)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '该部门含下级部门，请先调整下级部门后再变更所属公司' });
    }
    if (name === target.name
      && parentId === target.parentId
      && company === target.company
      && (leaderId ?? null) === (target.leaderId ?? null)
      && (approverId ?? null) === (target.approverId ?? null)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '未检测到实际变更，无需提交审核',
      });
    }
    const responsibilityIds = [...new Set([leaderId, approverId].filter((id): id is string => Boolean(id)))];
    if (responsibilityIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: responsibilityIds }, deletedAt: null },
        select: { id: true },
      });
      if (users.length !== responsibilityIds.length) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门负责人或审批人不存在或已停用' });
      }
    }
    return this.submitChangeRequest(
      'update_structure',
      id,
      target.name,
      {
        id,
        name: target.name,
        parentId: target.parentId,
        fullPath: target.fullPath,
        company: target.company,
        leaderId: target.leaderId,
        approverId: target.approverId,
      },
      { id, name, parentId, parentName: parent?.name ?? null, company, leaderId, approverId },
      operator,
    );
  }

  async merge(id: string, dto: MergeDepartmentDto, operator: AuthUser) {
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        company: true,
        isActive: true,
      },
    });
    const source = departments.find((item) => item.id === id);
    const target = departments.find((item) => item.id === dto.targetDepartmentId);
    if (!source) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '待合并部门不存在或已停用' });
    }
    if (!target) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '合并目标部门不存在或已停用' });
    }
    if (source.id === target.id) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '不能将部门合并到自身' });
    }
    if (this.isDescendant(departments, source.id, target.id)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '不能合并到自己的下级部门' });
    }

    const sourceChildren = departments.filter((item) => item.parentId === source.id);
    const targetChildren = departments.filter((item) => item.parentId === target.id);
    const duplicateChild = sourceChildren.find((child) => (
      targetChildren.some((targetChild) => targetChild.name === child.name)
    ));
    if (duplicateChild) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: `目标部门下已存在“${duplicateChild.name}”，请先处理同名下级部门`,
      });
    }

    const directMemberCount = await this.prisma.user.count({
      where: { deptId: source.id, deletedAt: null },
    });
    return this.submitChangeRequest(
      'merge',
      source.id,
      source.name,
      {
        id: source.id,
        name: source.name,
        parentId: source.parentId,
        fullPath: source.fullPath,
        directMemberCount,
        childDepartmentIds: sourceChildren.map((item) => item.id),
      },
      { targetDepartmentId: target.id, targetDepartmentName: target.name },
      operator,
    );
  }

  async remove(id: string, operator: AuthUser) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        isActive: true,
        members: { where: { deletedAt: null }, select: { id: true } },
        children: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (!department || !department.isActive) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '部门不存在或已删除' });
    }
    return this.submitChangeRequest(
      'delete',
      id,
      department.name,
      {
        id,
        name: department.name,
        fullPath: department.fullPath,
        parentId: department.parentId,
        isActive: true,
        directMemberCount: department.members.length,
        childDepartmentCount: department.children.length,
        directMemberIds: department.members.map((member) => member.id),
        childDepartmentIds: department.children.map((child) => child.id),
      },
      {
        isActive: false,
        requiresResolution: department.members.length > 0 || department.children.length > 0,
      },
      operator,
    );
  }

  async findChangeRequests(query: {
    status?: 'pending' | 'approved' | 'rejected' | 'all';
    page: number;
    pageSize: number;
  }) {
    const where = query.status && query.status !== 'all' ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.departmentChangeRequest.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, sysRole: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.departmentChangeRequest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async approveChange(requestId: string, operator: AuthUser) {
    this.assertHrAdmin(operator);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.departmentChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '部门变更申请不存在' });
      }
      if (request.status !== 'pending') {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '该部门变更申请已处理' });
      }
      const claimed = await tx.departmentChangeRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'applying' },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '该部门变更申请已处理' });
      }

      const applied = await this.applyApprovedChange(tx, request);
      const appliedDepartmentId = request.action === 'create'
        && applied
        && typeof applied === 'object'
        && 'id' in applied
        && typeof applied.id === 'string'
        ? applied.id
        : request.departmentId;
      const now = new Date();
      const updated = await tx.departmentChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          departmentId: appliedDepartmentId,
          reviewedById: operator.id,
          reviewedAt: now,
          appliedAt: now,
          rejectedReason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'approve_department_change',
          entityType: 'department_change_request',
          entityId: requestId,
          oldValue: { status: 'pending', createdById: request.createdById },
          newValue: { status: 'approved', action: request.action, departmentId: appliedDepartmentId },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async rejectChange(requestId: string, reason: string, operator: AuthUser) {
    this.assertHrAdmin(operator);
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写退回原因' });
    }
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.departmentChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '部门变更申请不存在' });
      }
      if (request.status !== 'pending') {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '该部门变更申请已处理' });
      }
      const now = new Date();
      const rejected = await tx.departmentChangeRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'rejected',
          reviewedById: operator.id,
          reviewedAt: now,
          rejectedReason: normalizedReason,
        },
      });
      if (rejected.count !== 1) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '该部门变更申请已处理' });
      }
      const updated = await tx.departmentChangeRequest.findUnique({ where: { id: requestId } });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'reject_department_change',
          entityType: 'department_change_request',
          entityId: requestId,
          oldValue: { status: request.status },
          newValue: { status: 'rejected', reason: normalizedReason },
        },
      });
      return updated;
    });
  }

  private async submitChangeRequest(
    action: DepartmentChangeAction,
    departmentId: string | null,
    departmentName: string,
    baseValue: Record<string, unknown>,
    proposedValue: Record<string, unknown>,
    operator: AuthUser,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (departmentId) {
          const pending = await tx.departmentChangeRequest.findFirst({
            where: { departmentId, status: { in: ['pending', 'applying'] } },
            select: { id: true },
          });
          if (pending) {
            throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '该部门已有变更审核中，请先处理现有申请' });
          }
        } else if (action === 'create') {
          const pendingCreates = await tx.departmentChangeRequest.findMany({
            where: { action: 'create', departmentId: null, status: { in: ['pending', 'applying'] } },
            select: { id: true, proposedValue: true },
          });
          const proposedName = typeof proposedValue.name === 'string' ? proposedValue.name.trim().toLocaleLowerCase() : '';
          const proposedParentId = typeof proposedValue.parentId === 'string' ? proposedValue.parentId : null;
          const proposedCompany = typeof proposedValue.company === 'string' ? proposedValue.company : '';
          const duplicate = pendingCreates.some((item) => {
            const pendingValue = this.jsonRecord(item.proposedValue);
            const pendingName = typeof pendingValue.name === 'string' ? pendingValue.name.trim().toLocaleLowerCase() : '';
            return pendingName === proposedName
              && (pendingValue.parentId ?? null) === proposedParentId
              && pendingValue.company === proposedCompany;
          });
          if (duplicate) {
            throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '同一上级下已有同名部门待审核，请先处理现有申请' });
          }
        }
        const request = await tx.departmentChangeRequest.create({
          data: {
            departmentId,
            departmentName,
            action,
            status: 'pending',
            baseValue: baseValue as Prisma.InputJsonValue,
            proposedValue: proposedValue as Prisma.InputJsonValue,
            createdById: operator.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: 'submit_department_change',
            entityType: 'department_change_request',
            entityId: request.id,
            oldValue: baseValue as Prisma.InputJsonValue,
            newValue: { action, departmentId, proposedValue } as Prisma.InputJsonValue,
          },
        });
        return request;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BadRequestException({
          code: ERROR_CODE.CONFLICT,
          message: action === 'create'
            ? '同一上级下已有同名部门待审核，请先处理现有申请'
            : '该部门已有变更审核中，请先处理现有申请',
        });
      }
      throw error;
    }
  }

  private async applyApprovedChange(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    if (request.action === 'create') return this.applyApprovedCreate(tx, request);
    if (request.action === 'update_structure') return this.applyApprovedStructure(tx, request);
    if (request.action === 'update_leader') return this.applyApprovedLeader(tx, request);
    if (request.action === 'merge') return this.applyApprovedMerge(tx, request);
    if (request.action === 'delete') return this.applyApprovedDelete(tx, request);
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '不支持的部门变更类型' });
  }

  private async applyApprovedCreate(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    const proposed = this.jsonRecord(request.proposedValue);
    const name = this.jsonString(proposed.name, '部门名称缺失');
    let parentId = this.nullableJsonString(proposed.parentId);
    const parentFullPath = this.nullableJsonString(proposed.parentFullPath);
    const company = this.jsonString(proposed.company, '所属公司缺失') as CompanyCode;
    const departments = await this.activeDepartments(tx);
    let parent = parentId ? departments.find((item) => item.id === parentId) : null;
    if (!parent && parentFullPath) {
      parent = departments.find((item) => this.normalizedPath(item.fullPath) === this.normalizedPath(parentFullPath)) ?? null;
      parentId = parent?.id ?? null;
    }
    if ((parentId || parentFullPath) && !parent) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '请先审核并生效上级部门' });
    }
    if (departments.some((item) => item.parentId === parentId && item.name === name)) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '同一上级下已存在同名部门' });
    }
    const sortOrder = departments
      .filter((item) => item.parentId === parentId)
      .reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1;
    return tx.department.create({
      data: {
        name,
        parentId,
        company: parent?.company ?? company,
        sortOrder,
        fullPath: parent?.fullPath ? `${parent.fullPath} / ${name}` : name,
        isActive: true,
      },
    });
  }

  private async applyApprovedStructure(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    const id = request.departmentId;
    if (!id) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门标识缺失' });
    const base = this.jsonRecord(request.baseValue);
    const proposed = this.jsonRecord(request.proposedValue);
    const departments = await this.activeDepartments(tx, id);
    const target = departments.find((item) => item.id === id);
    const staleMetadata = (
      ('company' in base && target?.company !== base.company)
      || ('sortOrder' in base && target?.sortOrder !== base.sortOrder)
      || ('isActive' in base && target?.isActive !== base.isActive)
      || ('leaderId' in base && target?.leaderId !== (base.leaderId ?? null))
      || ('approverId' in base && target?.approverId !== (base.approverId ?? null))
    );
    if (!target || target.name !== base.name || target.parentId !== (base.parentId ?? null) || staleMetadata) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '正式部门信息已发生变化，请重新提交审核' });
    }
    const name = this.jsonString(proposed.name, '部门名称缺失');
    let parentId = this.nullableJsonString(proposed.parentId);
    const parentFullPath = this.nullableJsonString(proposed.parentFullPath);
    if (!parentId && parentFullPath) {
      const parent = departments.find((item) => this.normalizedPath(item.fullPath) === this.normalizedPath(parentFullPath));
      if (!parent) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '请先审核并生效上级部门' });
      }
      parentId = parent.id;
    }
    this.validateStructureTarget(departments, id, name, parentId);
    const nodes = new Map(departments.map((item) => [item.id, { ...item }]));
    nodes.set(id, { ...target, name, parentId });
    const pathMap = this.buildPathMap([...nodes.values()]);
    const affected = [...nodes.values()].filter((node) => this.isDescendantOrSelf(nodes, id, node.id));

    const updateData: Prisma.DepartmentUncheckedUpdateInput = { name, parentId };
    if (typeof proposed.company === 'string' && Object.values(CompanyCode).includes(proposed.company as CompanyCode)) {
      updateData.company = proposed.company as CompanyCode;
    }
    if ('leaderId' in proposed) updateData.leaderId = this.nullableJsonString(proposed.leaderId);
    if ('approverId' in proposed) updateData.approverId = this.nullableJsonString(proposed.approverId);
    if (typeof proposed.sortOrder === 'number') updateData.sortOrder = proposed.sortOrder;
    if (typeof proposed.isActive === 'boolean') updateData.isActive = proposed.isActive;
    await tx.department.update({ where: { id }, data: updateData });
    for (const node of affected) {
      await tx.department.update({ where: { id: node.id }, data: { fullPath: pathMap.get(node.id)! } });
    }
  }

  private async applyApprovedLeader(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    const id = request.departmentId;
    if (!id) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门标识缺失' });
    const base = this.jsonRecord(request.baseValue);
    const proposed = this.jsonRecord(request.proposedValue);
    const department = await tx.department.findUnique({
      where: { id },
      select: { id: true, name: true, fullPath: true, leaderId: true, isActive: true },
    });
    if (
      !department
      || !department.isActive
      || department.name !== base.name
      || department.leaderId !== (base.leaderId ?? null)
    ) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '部门负责人已发生变化，请重新提交审核' });
    }
    const leaderId = this.nullableJsonString(proposed.leaderId);
    if (leaderId) {
      const leader = await tx.user.findUnique({
        where: { id: leaderId },
        select: { id: true, deletedAt: true },
      });
      if (!leader || leader.deletedAt) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '拟任部门负责人不存在或已停用' });
      }
    }
    await tx.department.update({ where: { id }, data: { leaderId } });
  }

  private async applyApprovedMerge(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    const sourceId = request.departmentId;
    if (!sourceId) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '待合并部门标识缺失' });
    const base = this.jsonRecord(request.baseValue);
    const proposed = this.jsonRecord(request.proposedValue);
    const targetId = this.jsonString(proposed.targetDepartmentId, '合并目标缺失');
    const departments = await this.activeDepartments(tx);
    const source = departments.find((item) => item.id === sourceId);
    const target = departments.find((item) => item.id === targetId);
    if (!source || source.name !== base.name || !target) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '部门信息已发生变化，请重新提交审核' });
    }
    if (sourceId === targetId || this.isDescendant(departments, sourceId, targetId)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '不能合并到自身或自己的下级部门' });
    }
    const sourceChildren = departments.filter((item) => item.parentId === sourceId);
    const submittedChildren = Array.isArray(base.childDepartmentIds) ? base.childDepartmentIds : [];
    if (sourceChildren.length !== submittedChildren.length
      || sourceChildren.some((item) => !submittedChildren.includes(item.id))) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '待合并部门的下级结构已变化，请重新提交审核' });
    }
    const directMemberCount = await tx.user.count({ where: { deptId: sourceId, deletedAt: null } });
    if (directMemberCount !== Number(base.directMemberCount ?? 0)) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '待合并部门的直属人员已变化，请重新提交审核' });
    }
    const targetChildren = departments.filter((item) => item.parentId === targetId);
    const duplicateChild = sourceChildren.find((child) => targetChildren.some((item) => item.name === child.name));
    if (duplicateChild) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: `目标部门下已存在“${duplicateChild.name}”` });
    }
    const nextDepartments = departments
      .filter((item) => item.id !== sourceId)
      .map((item) => item.parentId === sourceId ? { ...item, parentId: targetId } : item);
    const pathMap = this.buildPathMap(nextDepartments);
    await tx.user.updateMany({ where: { deptId: sourceId, deletedAt: null }, data: { deptId: targetId } });
    await tx.department.updateMany({ where: { parentId: sourceId, isActive: true }, data: { parentId: targetId } });
    for (const item of nextDepartments) {
      const nextPath = pathMap.get(item.id);
      if (nextPath && nextPath !== item.fullPath) {
        await tx.department.update({ where: { id: item.id }, data: { fullPath: nextPath } });
      }
    }
    await tx.department.update({ where: { id: sourceId }, data: { isActive: false, parentId: null } });
  }

  private async applyApprovedDelete(tx: Prisma.TransactionClient, request: DepartmentChangeRecord) {
    const id = request.departmentId;
    if (!id) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门标识缺失' });
    const base = this.jsonRecord(request.baseValue);
    const department = await tx.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        parentId: true,
        isActive: true,
        members: { where: { deletedAt: null }, select: { id: true } },
        children: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (!department || !department.isActive || department.name !== base.name || department.parentId !== (base.parentId ?? null)) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '正式部门信息已发生变化，请重新提交审核' });
    }
    if (department.members.length > 0 || department.children.length > 0) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '请先处理在职人员和下级部门，再停用该部门',
      });
    }
    await tx.department.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async activeDepartments(client: Pick<Prisma.TransactionClient, 'department'>, includeId?: string) {
    return client.department.findMany({
      where: includeId ? { OR: [{ isActive: true }, { id: includeId }] } : { isActive: true },
      select: {
        id: true,
        name: true,
        fullPath: true,
        parentId: true,
        company: true,
        sortOrder: true,
        isActive: true,
        leaderId: true,
        approverId: true,
      },
    });
  }

  private validateStructureTarget(
    departments: DepartmentStructureRecord[],
    id: string,
    name: string,
    parentId: string | null,
  ) {
    if (parentId === id) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门不能挂靠到自身' });
    }
    if (parentId && !departments.some((item) => item.id === parentId)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '目标上级部门不存在' });
    }
    if (parentId && this.isDescendant(departments, id, parentId)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '部门不能挂靠到自己的下级' });
    }
    if (departments.some((item) => item.id !== id && item.parentId === parentId && item.name === name)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '同一上级下已存在同名部门' });
    }
  }

  private isDescendantOrSelf(
    nodes: Map<string, DepartmentStructureRecord>,
    ancestorId: string,
    candidateId: string,
  ) {
    let cursor = nodes.get(candidateId);
    const visited = new Set<string>();
    while (cursor) {
      if (cursor.id === ancestorId) return true;
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    return false;
  }

  private assertHrAdmin(operator: AuthUser) {
    if (operator.sysRole !== SysRole.hr && operator.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 管理员可审核部门变更' });
    }
  }

  private jsonRecord(value: Prisma.JsonValue): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  }

  private jsonString(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
    }
    return value.trim();
  }

  private nullableJsonString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private normalizedPath(value: string | null): string {
    return (value ?? '').replaceAll('／', '/').replace(/\s*\/\s*/g, '/').trim();
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
          message: '部门负责人不存在或已删除',
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
