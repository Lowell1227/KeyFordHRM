import { Injectable } from '@nestjs/common';
import { EmployeeNumberStatus, ExternalIdentityProvider, ExternalIdentityStatus, OnboardingStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { selectEmploymentAt } from './employment-timeline';

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
    const effectiveAt = this.shanghaiDate(at);
    const [users, records, positions] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, accountType: 'employee' },
        select: { id: true },
      }),
      this.prisma.employmentRecord.findMany({
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
    const updates: Array<ReturnType<typeof this.prisma.user.update>> = [];

    for (const user of users) {
      const selection = selectEmploymentAt(recordsByUser.get(user.id) ?? [], effectiveAt);
      if (!selection.current) continue;
      if (selection.matches.length > 1) overlaps += 1;
      const current = selection.current;
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
    }

    if (updates.length > 0) await this.prisma.$transaction(updates);
    return { checked: users.length, updated: updates.length, overlaps };
  }

  async refreshUserProjection(userId: string, at = new Date()): Promise<{ activated: boolean; historicalOnly: boolean }> {
    const request = await this.prisma.employeeDataChangeRequest.findFirst({
      where: { userId, onboardingStatus: OnboardingStatus.pending_entry },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!request) return { activated: false, historicalOnly: false };
    return this.prisma.$transaction((tx) => this.activateApprovedOnboarding(tx, request.id, at), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
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
      || request.onboardingStatus === OnboardingStatus.effective) {
      return { activated: false, historicalOnly: false };
    }
    const employment = request.employmentRecords[0];
    if (!employment) return { activated: false, historicalOnly: false };
    const proposed = this.record(request.proposedValue);
    const performance = this.record(proposed.performance);
    const performanceManagerId = typeof performance.managerId === 'string' ? performance.managerId : null;
    const today = this.shanghaiDate(at);
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

  private shanghaiDate(at: Date): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000Z`);
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
