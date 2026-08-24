import { Injectable } from '@nestjs/common';
import { SysRole, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findDepartmentsByEffectiveApprover } from '../departments/department-relations';

export type BusinessIdentityType =
  | 'performance_manager'
  | 'department_leader'
  | 'performance_approver'
  | 'cycle_hr_owner';

export interface BusinessIdentity {
  type: BusinessIdentityType;
  label: string;
  count: number;
}

export interface BusinessCapabilities {
  canManageTeam: boolean;
  canReviewDepartment: boolean;
  canViewPerformanceApproval: boolean;
  canOperatePerformanceApproval: boolean;
  canHandleHrCycle: boolean;
  canHandleInterviews: boolean;
  canHandleProbationReviews: boolean;
  canHandleConfirmationApprovals: boolean;
  canViewReports: boolean;
  canManageObjectives: boolean;
  identities: BusinessIdentity[];
}

export interface BusinessCapabilitySubject {
  id: string;
  sysRole: SysRole | string;
  canViewAll: boolean;
}

const TERMINAL_TASK_STATUSES: TaskStatus[] = ['confirmed', 'closed', 'exempted'];

@Injectable()
export class BusinessCapabilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(user: BusinessCapabilitySubject): Promise<BusinessCapabilities> {
    const [
      directReportCount,
      departments,
      managerTaskCount,
      deptHeadTaskCount,
      approverTaskCount,
      hrCycleCount,
      interviewCount,
      probationReviewCount,
      confirmationApprovalCount,
    ] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            directManagerId: user.id,
            deletedAt: null,
            status: { not: 'resigned' },
          },
        }),
        this.prisma.department.findMany({
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
        }),
        this.countActiveTasks('managerId', user.id),
        this.countActiveTasks('deptHeadId', user.id),
        this.countActiveTasks('approverId', user.id),
        this.prisma.assessmentCycle.count({
          where: { hrOwnerId: user.id, status: { not: 'closed' } },
        }),
        this.prisma.performanceInterview.count({
          where: { interviewerId: user.id, status: { not: 'closed' } },
        }),
        this.prisma.probationReview.count({
          where: { managerId: user.id, status: { not: 'closed' } },
        }),
        this.prisma.confirmationApplication.count({
          where: {
            OR: [
              { status: 'submitted', managerId: user.id },
              { status: 'manager_approved', hrId: user.id },
              { status: 'hr_approved', companyApproverId: user.id },
            ],
          },
        }),
      ]);

    const relationRecords = departments.map((department) => ({
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
    const ledDepartmentCount = relationRecords.filter((department) => department.leaderId === user.id).length;
    const approvalDepartmentCount = findDepartmentsByEffectiveApprover(relationRecords, user.id).length;

    const managerScopeCount = directReportCount + managerTaskCount;
    const departmentScopeCount = ledDepartmentCount + deptHeadTaskCount;
    const approvalScopeCount = approvalDepartmentCount + approverTaskCount;
    const canOperatePerformanceApproval = approvalScopeCount > 0;
    const isSystemManager = user.sysRole === SysRole.hr || user.sysRole === SysRole.system_admin;

    const identities: BusinessIdentity[] = [];
    this.addIdentity(identities, 'performance_manager', '绩效直属上级', managerScopeCount);
    this.addIdentity(identities, 'department_leader', '部门负责人', departmentScopeCount);
    this.addIdentity(identities, 'performance_approver', '最终业务审批人', approvalScopeCount);
    this.addIdentity(identities, 'cycle_hr_owner', '本周期 HR 负责人', hrCycleCount);

    return {
      canManageTeam: managerScopeCount > 0,
      canReviewDepartment: departmentScopeCount > 0,
      canViewPerformanceApproval:
        canOperatePerformanceApproval || user.canViewAll || user.sysRole === SysRole.system_admin,
      canOperatePerformanceApproval,
      canHandleHrCycle: hrCycleCount > 0,
      canHandleInterviews: interviewCount > 0 || isSystemManager || user.canViewAll,
      canHandleProbationReviews: probationReviewCount > 0,
      canHandleConfirmationApprovals: confirmationApprovalCount > 0,
      canViewReports:
        isSystemManager
        || user.canViewAll
        || managerScopeCount > 0
        || departmentScopeCount > 0
        || approvalScopeCount > 0,
      canManageObjectives: isSystemManager || managerScopeCount > 0 || departmentScopeCount > 0,
      identities,
    };
  }

  /**
   * 批量计算员工列表中的业务身份。列表接口必须一次投影，避免逐人执行能力查询。
   */
  async getIdentitySummariesForUsers(userIds: string[]): Promise<Map<string, BusinessIdentity[]>> {
    const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
    const result = new Map(uniqueUserIds.map((userId) => [userId, [] as BusinessIdentity[]]));
    if (uniqueUserIds.length === 0) return result;

    const [directReports, departments, managerTasks, deptHeadTasks, approverTasks, hrCycles] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['directManagerId'],
        where: {
          directManagerId: { in: uniqueUserIds },
          deletedAt: null,
          status: { not: 'resigned' },
        },
        _count: { _all: true },
      }),
      this.prisma.department.findMany({
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
      }),
      this.groupActiveTasks('managerId', uniqueUserIds),
      this.groupActiveTasks('deptHeadId', uniqueUserIds),
      this.groupActiveTasks('approverId', uniqueUserIds),
      this.prisma.assessmentCycle.groupBy({
        by: ['hrOwnerId'],
        where: { hrOwnerId: { in: uniqueUserIds }, status: { not: 'closed' } },
        _count: { _all: true },
      }),
    ]);

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

    const directReportCounts = this.groupCounts(directReports, 'directManagerId');
    const managerTaskCounts = this.groupCounts(managerTasks, 'managerId');
    const deptHeadTaskCounts = this.groupCounts(deptHeadTasks, 'deptHeadId');
    const approverTaskCounts = this.groupCounts(approverTasks, 'approverId');
    const hrCycleCounts = this.groupCounts(hrCycles, 'hrOwnerId');

    for (const userId of uniqueUserIds) {
      const identities = result.get(userId)!;
      const ledDepartmentCount = relations.filter((department) => department.leaderId === userId).length;
      const approvalDepartmentCount = findDepartmentsByEffectiveApprover(relations, userId).length;
      this.addIdentity(
        identities,
        'performance_manager',
        '绩效直属上级',
        (directReportCounts.get(userId) ?? 0) + (managerTaskCounts.get(userId) ?? 0),
      );
      this.addIdentity(
        identities,
        'department_leader',
        '部门负责人',
        ledDepartmentCount + (deptHeadTaskCounts.get(userId) ?? 0),
      );
      this.addIdentity(
        identities,
        'performance_approver',
        '最终业务审批人',
        approvalDepartmentCount + (approverTaskCounts.get(userId) ?? 0),
      );
      this.addIdentity(
        identities,
        'cycle_hr_owner',
        '本周期 HR 负责人',
        hrCycleCounts.get(userId) ?? 0,
      );
    }

    return result;
  }

  private countActiveTasks(
    relation: 'managerId' | 'deptHeadId' | 'approverId',
    userId: string,
  ): Promise<number> {
    return this.prisma.assessmentTask.count({
      where: {
        [relation]: userId,
        status: { notIn: TERMINAL_TASK_STATUSES },
        isExempt: false,
      },
    });
  }

  private groupActiveTasks(
    relation: 'managerId' | 'deptHeadId' | 'approverId',
    userIds: string[],
  ) {
    return this.prisma.assessmentTask.groupBy({
      by: [relation],
      where: {
        [relation]: { in: userIds },
        status: { notIn: TERMINAL_TASK_STATUSES },
        isExempt: false,
      },
      _count: { _all: true },
    } as never);
  }

  private groupCounts<T extends Record<string, unknown>>(
    rows: T[],
    key: keyof T,
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[key];
      if (typeof value !== 'string') continue;
      const count = (row._count as { _all?: number } | undefined)?._all ?? 0;
      counts.set(value, count);
    }
    return counts;
  }

  private addIdentity(
    identities: BusinessIdentity[],
    type: BusinessIdentityType,
    label: string,
    count: number,
  ): void {
    if (count > 0) identities.push({ type, label, count });
  }
}
