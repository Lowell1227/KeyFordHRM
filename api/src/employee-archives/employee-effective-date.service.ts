import { ConflictException, Injectable } from '@nestjs/common';
import { EmployeeNumberStatus, ExternalIdentityProvider, ExternalIdentityStatus, OnboardingStatus, Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from './employment-timeline';
import { lockTalentSource, syncTalentApplicationOnboarding } from './employee-talent-source';
import { terminateEmploymentPerformance } from '@/performance-lifecycle/lifecycle-employment';

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
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, accountType: 'employee', status: { not: 'pending_entry' } },
      select: { id: true },
    });
    const userIds = new Set([...dueUsers.map(item => item.userId).filter((id): id is string => Boolean(id)),
      ...users.map(user => user.id)]);
    let overlaps = 0;
    let updated = 0;
    for (const userId of userIds) {
      const result = await this.refreshProjection(userId, at);
      if (result.updated) updated += 1;
      if (result.overlap) overlaps += 1;
    }
    return { checked: userIds.size, updated, overlaps };
  }

  async refreshUserProjection(userId: string, at = new Date()): Promise<{ activated: boolean; historicalOnly: boolean }> {
    const { activated, historicalOnly } = await this.refreshProjection(userId, at);
    return { activated, historicalOnly };
  }

  private async refreshProjection(userId: string, at: Date) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.employeeDataChangeRequest.findFirst({
            where: { userId, onboardingStatus: OnboardingStatus.pending_entry },
            orderBy: { createdAt: 'desc' }, select: { id: true },
          });
          const result = request ? await this.activateApprovedOnboarding(tx, request.id, at)
            : { activated: false, historicalOnly: false };
          const projection = !result.activated && !result.historicalOnly
            ? await this.refreshCurrentEmployment(tx, userId, at) : { updated: result.activated, overlap: false };
          return { ...result, ...projection };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const details = error as { code?: string; meta?: { code?: string } } | null;
        const conflict = details?.code === 'P2034'
          || (details?.code === 'P2010' && ['40001', '40P01'].includes(details.meta?.code ?? ''));
        if (!conflict) throw error;
        if (attempt >= 2) throw new ConflictException('员工任职正在更新，请稍后重试');
      }
    }
  }

  private async refreshCurrentEmployment(tx: Prisma.TransactionClient, userId: string, at: Date) {
    const user = await tx.user.findUnique({ where: { id: userId, deletedAt: null }, select: {
      id: true, accountType: true, status: true, deptId: true, positionId: true, position: true,
      entryDate: true, plannedRegularDate: true, actualRegularDate: true, leaveDate: true, employmentType: true,
    } });
    if (!user || user.accountType !== 'employee' || user.status === 'pending_entry') return { updated: false, overlap: false };
    const records = await tx.employmentRecord.findMany({ where: { userId, ...approvedEmploymentSourceWhere }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] });
    const selection = selectEmploymentAt(records, shanghaiBusinessDate(at));
    const current = selection.current;
    const overlap = selection.matches.length > 1;
    if (!current || (user.status === 'resigned' && current.employeeStatus !== 'resigned')) return { updated: false, overlap };
    const projection = {
      deptId: current.deptId, positionId: current.positionId, position: current.position,
      entryDate: current.entryDate, plannedRegularDate: current.plannedRegularDate,
      actualRegularDate: current.actualRegularDate, leaveDate: current.leaveDate,
      employmentType: current.employmentType, status: current.employeeStatus,
    };
    const updated = Object.entries(projection).some(([key, value]) => JSON.stringify((user as any)[key]) !== JSON.stringify(value));
    if (updated) {
      await tx.user.update({ where: { id: userId }, data: projection });
    }
    if (current.employeeStatus === 'resigned') {
      if (updated && user.status !== 'resigned' && current.changeType === 'resignation' && !overlap) {
        const previousDay = new Date(current.effectiveFrom.getTime() - 86_400_000);
        const previous = selectEmploymentAt(records, previousDay);
        const departing = previous.matches.length === 1 && ['active', 'probation'].includes(previous.current!.employeeStatus)
          ? previous.current! : current;
        await terminateEmploymentPerformance(tx, userId, departing.id, at, current.createdById);
      }
      await tx.externalIdentityBinding.updateMany({ where: { userId, status: ExternalIdentityStatus.enabled, endedAt: null },
        data: { status: ExternalIdentityStatus.disabled, disabledAt: at, disabledReason: RESIGNATION_BINDING_DISABLED_REASON } });
    }
    if (current.sourceRequestId) {
      await tx.employeeDataChangeRequest.updateMany({ where: {
        id: current.sourceRequestId, profileReviewStatus: 'approved', appliedAt: null,
      }, data: { appliedAt: at } });
    }
    return { updated, overlap };
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
    if (request.cancelledAt || request.archivedAt || (request.requiresArrivalConfirmation && !request.arrivalConfirmedAt)) {
      return { activated: false, historicalOnly: false };
    }
    await lockTalentSource(tx, request.talentCandidateId);
    const employment = request.employmentRecords[0];
    if (!employment) return { activated: false, historicalOnly: false };
    const proposed = this.record(request.proposedValue);
    const performance = this.record(proposed.performance);
    const performanceManagerId = request.performanceReviewStatus === 'approved' && typeof performance.managerId === 'string'
      ? performance.managerId : null;
    const today = shanghaiBusinessDate(at);
    if (employment.effectiveFrom > today) return { activated: false, historicalOnly: false };
    if (request.requiresArrivalConfirmation && (!request.arrivalDate
      || request.arrivalDate.getTime() !== employment.effectiveFrom.getTime() || request.arrivalDate > today)) {
      return { activated: false, historicalOnly: false };
    }
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
    if (request.talentCandidateId && request.arrivalConfirmedAt) {
      await syncTalentApplicationOnboarding(tx, request, 'hired', request.arrivalConfirmedById ?? request.createdById);
      const candidate = await tx.talentCandidate.findUnique({ where: { id: request.talentCandidateId },
        select: { deletedAt: true, convertedUserId: true } });
      if (candidate && !candidate.deletedAt) {
        if (candidate.convertedUserId && candidate.convertedUserId !== request.userId) {
          throw new ConflictException('来源人才已关联其他员工，请核对后再确认到岗');
        }
        await tx.talentCandidate.updateMany({ where: { id: request.talentCandidateId, deletedAt: null,
          OR: [{ convertedUserId: null }, { convertedUserId: request.userId }] }, data: {
          status: 'hired', convertedUserId: request.userId, convertedAt: at,
          updatedById: request.arrivalConfirmedById,
        } });
      }
    }
    await tx.auditLog.create({ data: {
      userId: request.arrivalConfirmedById ?? request.createdById,
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
