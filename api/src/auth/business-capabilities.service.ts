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
    const [directReportCount, departments, managerTaskCount, deptHeadTaskCount, approverTaskCount, hrCycleCount] =
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
      identities,
    };
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

  private addIdentity(
    identities: BusinessIdentity[],
    type: BusinessIdentityType,
    label: string,
    count: number,
  ): void {
    if (count > 0) identities.push({ type, label, count });
  }
}
