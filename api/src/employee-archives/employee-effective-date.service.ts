import { Injectable } from '@nestjs/common';
import { EmployeeNumberStatus, ExternalIdentityProvider, ExternalIdentityStatus, OnboardingStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from './employment-timeline';

export const RESIGNATION_BINDING_DISABLED_REASON = '员工档案审核为离职';

@Injectable()
export class EmployeeEffectiveDateService {
  constructor(private readonly prisma: PrismaService) {}

  async refreshEffectiveProjections(at = new Date()) {
    const dueUsers = await this.prisma.employeeDataChangeRequest.findMany({
      where: { onboardingStatus: OnboardingStatus.pending_entry, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const item of dueUsers) {
      if (item.userId) await this.refreshUserProjection(item.userId, at);
    }
    const effectiveAt = shanghaiBusinessDate(at);
    const [users, records, positions] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, accountType: 'employee', status: { not: 'pending_entry' } },
        select: { id: true, status: true },
      }),
      this.prisma.employmentRecord.findMany({
        where: approvedEmploymentSourceWhere,
        orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }],
      }),
      this.prisma.position.findMany({ select: { id: true, name: true } }),
    ]);
    const recordsByUser = new Map<string, typeof records>();
    for (const record of records) {
      const group = recordsByUser.get(record.userId) ?? [];
      group.push(record);
      recordsByUser.set(record.userId, group);
    }
    const positionNames = new Map(positions.map((position) => [position.id, position.name]));
    let overlaps = 0;
    let updated = 0;
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const user of users) {
      const selection = selectEmploymentAt(recordsByUser.get(user.id) ?? [], effectiveAt);
      if (!selection.current) continue;
      if (selection.matches.length > 1) overlaps += 1;
      const current = selection.current;
      if (user.status === 'resigned' && current.employeeStatus !== 'resigned') continue;
      updated += 1;
      updates.push(this.prisma.user.update({
        where: { id: user.id },
        data: {
          deptId: current.deptId,
          positionId: current.positionId,
          position: current.positionId
            ? (positionNames.get(current.positionId) ?? current.position)
            : current.position,
          entryDate: current.entryDate,
          plannedRegularDate: current.plannedRegularDate,
          actualRegularDate: current.actualRegularDate,
          leaveDate: current.leaveDate,
          employmentType: current.employmentType,
          status: current.employeeStatus,
        },
      }));
      if (current.employeeStatus === 'resigned') {
        updates.push(this.prisma.externalIdentityBinding.updateMany({ where: {
          userId: user.id, status: ExternalIdentityStatus.enabled, endedAt: null,
        }, data: { status: ExternalIdentityStatus.disabled, disabledAt: at, disabledReason: RESIGNATION_BINDING_DISABLED_REASON } }));
      }
      if (current.sourceRequestId) {
        updates.push(this.prisma.employeeDataChangeRequest.updateMany({ where: {
          id: current.sourceRequestId, profileReviewStatus: 'approved', appliedAt: null,
        }, data: { appliedAt: at } }));
      }
    }

    if (updates.length > 0) await this.prisma.$transaction(updates);
    return { checked: users.length, updated, overlaps };
  }

  async refreshUserProjection(userId: string, at = new Date()): Promise<{ activated: boolean; historicalOnly: boolean }> {
    const request = await this.prisma.employeeDataChangeRequest.findFirst({
      where: { userId, onboardingStatus: OnboardingStatus.pending_entry },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const result = request ? await this.activateApprovedOnboarding(tx, request.id, at)
        : { activated: false, historicalOnly: false };
      if (!result.activated && !result.historicalOnly) await this.refreshCurrentEmployment(tx, userId, at);
      return result;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private async refreshCurrentEmployment(tx: Prisma.TransactionClient, userId: string, at: Date) {
    const user = await tx.user.findUnique({ where: { id: userId, deletedAt: null }, select: {
      id: true, accountType: true, status: true, deptId: true, positionId: true, position: true,
      entryDate: true, plannedRegularDate: true, actualRegularDate: true, leaveDate: true, employmentType: true,
    } });
    if (!user || user.accountType !== 'employee' || user.status === 'pending_entry') return;
    const records = await tx.employmentRecord.findMany({ where: { userId, ...approvedEmploymentSourceWhere }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] });
    const current = selectEmploymentAt(records, shanghaiBusinessDate(at)).current;
    if (!current) return;
    if (user.status === 'resigned' && current.employeeStatus !== 'resigned') return;
    const position = current.positionId ? await tx.position.findUnique({ where: { id: current.positionId }, select: { name: true } }) : null;
    const projection = {
      deptId: current.deptId, positionId: current.positionId, position: position?.name ?? current.position,
      entryDate: current.entryDate, plannedRegularDate: current.plannedRegularDate,
      actualRegularDate: current.actualRegularDate, leaveDate: current.leaveDate,
      employmentType: current.employmentType, status: current.employeeStatus,
    };
    if (Object.entries(projection).some(([key, value]) => JSON.stringify((user as any)[key]) !== JSON.stringify(value))) {
      await tx.user.update({ where: { id: userId }, data: projection });
    }
    if (current.employeeStatus === 'resigned') {
      await tx.externalIdentityBinding.updateMany({ where: { userId, status: ExternalIdentityStatus.enabled, endedAt: null },
        data: { status: ExternalIdentityStatus.disabled, disabledAt: at, disabledReason: RESIGNATION_BINDING_DISABLED_REASON } });
    }
    if (current.sourceRequestId) {
      await tx.employeeDataChangeRequest.updateMany({ where: {
        id: current.sourceRequestId, profileReviewStatus: 'approved', appliedAt: null,
      }, data: { appliedAt: at } });
    }
  }

  async activateApprovedOnboarding(
    tx: Prisma.TransactionClient,
    requestId: string,
    at: Date,
  ): Promise<{ activated: boolean; historicalOnly: boolean }> {
    const request = await tx.employeeDataChangeRequest.findUnique({
      where: { id: requestId },
      include: {
        employmentRecords: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        employeeNumbers: true,
      },
    });
    if (!request || !request.userId || request.onboardingStatus === OnboardingStatus.cancelled
      || request.onboardingStatus === OnboardingStatus.effective || request.profileReviewStatus !== 'approved') {
      return { activated: false, historicalOnly: false };
    }
    const employment = request.employmentRecords[0];
    if (!employment) return { activated: false, historicalOnly: false };
    const proposed = this.record(request.proposedValue);
    const performance = this.record(proposed.performance);
    const performanceManagerId = request.performanceReviewStatus === 'approved' && typeof performance.managerId === 'string'
      ? performance.managerId : null;
    const today = shanghaiBusinessDate(at);
    if (employment.effectiveFrom > today) return { activated: false, historicalOnly: false };
    const assignment = request.employeeNumbers.find((item) => item.status === EmployeeNumberStatus.reserved)
      ?? request.employeeNumbers.find((item) => item.employeeNo === employment.employeeNo);
    if (employment.effectiveTo && employment.effectiveTo < today) {
      if (assignment) {
        await tx.employeeNumberAssignment.update({ where: { id: assignment.id }, data: {
          status: EmployeeNumberStatus.historical,
          effectiveFrom: employment.effectiveFrom,
          effectiveTo: employment.effectiveTo,
        } });
      }
      await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.effective, appliedAt: at,
      } });
      return { activated: false, historicalOnly: true };
    }

    await tx.employeeNumberAssignment.updateMany({
      where: { userId: request.userId, status: EmployeeNumberStatus.current, ...(assignment ? { id: { not: assignment.id } } : {}) },
      data: {
        status: EmployeeNumberStatus.historical,
        effectiveTo: new Date(employment.effectiveFrom.getTime() - 86_400_000),
      },
    });
    if (assignment) {
      await tx.employeeNumberAssignment.update({ where: { id: assignment.id }, data: {
        status: EmployeeNumberStatus.current, effectiveFrom: employment.effectiveFrom,
        effectiveTo: employment.effectiveTo, releasedAt: null,
      } });
    }
    await tx.user.update({ where: { id: request.userId }, data: {
      employeeNo: employment.employeeNo,
      deptId: employment.deptId,
      positionId: employment.positionId,
      position: employment.position,
      directManagerId: performanceManagerId,
      entryDate: employment.entryDate ?? employment.effectiveFrom,
      plannedRegularDate: employment.plannedRegularDate,
      actualRegularDate: employment.actualRegularDate,
      leaveDate: null,
      employmentType: employment.employmentType,
      status: employment.employeeStatus,
      archivedAt: null,
      sysRole: SysRole.employee,
      hrCapabilities: { set: [] },
      canViewAll: false,
      isAssessorOnly: false,
    } });

    const warnings = Array.isArray(request.validationWarnings) ? [...request.validationWarnings] : [];
    const disabledBindings = await tx.externalIdentityBinding.findMany({ where: {
      userId: request.userId,
      provider: ExternalIdentityProvider.dingtalk,
      status: ExternalIdentityStatus.disabled,
      endedAt: null,
      disabledReason: RESIGNATION_BINDING_DISABLED_REASON,
    } });
    for (const binding of disabledBindings) {
      const conflict = await tx.externalIdentityBinding.findFirst({ where: {
        provider: ExternalIdentityProvider.dingtalk,
        externalUnionId: binding.externalUnionId,
        status: ExternalIdentityStatus.enabled,
        endedAt: null,
        userId: { not: request.userId },
      }, select: { id: true } });
      if (conflict) {
        warnings.push({ field: 'dingtalkBinding', message: '钉钉身份已关联其他员工，请管理员人工核对' });
      } else {
        await tx.externalIdentityBinding.update({ where: { id: binding.id }, data: {
          status: ExternalIdentityStatus.enabled,
          disabledAt: null,
          disabledById: null,
          disabledReason: null,
        } });
      }
    }
    await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
      onboardingStatus: OnboardingStatus.effective,
      appliedAt: at,
      validationWarnings: warnings as Prisma.InputJsonValue,
    } });
    await tx.auditLog.create({ data: {
      userId: request.createdById,
      action: 'activate_employee_onboarding',
      entityType: 'employee_data_change_request',
      entityId: requestId,
      newValue: { userId: request.userId, effectiveFrom: employment.effectiveFrom.toISOString() },
    } });
    return { activated: true, historicalOnly: false };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
