import { normalizeContractSubject, validateContractSubject } from '@/contract-subjects/contract-subject-reference';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { hasHrCapability } from '@/auth/hr-capabilities';
import {
  AccountType,
  EmployeeDataChangeRequest,
  EmployeeNumberStatus,
  OnboardingIntakeType,
  OnboardingStatus,
  Prisma,
  SysRole,
  UserStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { shanghaiBusinessDate } from './employment-timeline';
import { employeeDataChangeView } from './employee-data-change-view';
import { lockTalentSource, resolveTalentSource, talentSourceSelect } from './employee-talent-source';
import {
  CancelEmployeeReentryDto,
  ConfirmEmployeeArrivalDto,
  ReviseEmployeeArrivalDateDto,
  CreateEmployeeReentryDto,
  CreateOnboardingIntakeDto,
  EmployeeReentryFieldsDto,
  OnboardingIntakeResult,
  OnboardingRequestView,
  ReviseEmployeeReentryDto,
} from './dto/employee-onboarding.dto';

const unfinishedStatuses: OnboardingStatus[] = [
  OnboardingStatus.draft,
  OnboardingStatus.submitted,
  OnboardingStatus.pending_entry,
];

@Injectable()
export class EmployeeOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeNumbers: EmployeeNumberService,
    private readonly identityMatcher: EmployeeIdentityMatchService,
    private readonly effectiveDates: EmployeeEffectiveDateService,
  ) {}

  async confirmArrival(requestId: string, input: ConfirmEmployeeArrivalDto, operator: AuthUser): Promise<OnboardingRequestView> {
    if (!hasHrCapability(operator, 'employee_archive_review')) throw new ForbiddenException('没有确认到岗权限');
    const arrivalDate = this.calendarDate(input.arrivalDate);
    if (arrivalDate > shanghaiBusinessDate()) throw new BadRequestException('不能确认未来的实际到岗日期');
    return this.arrivalTransaction(async tx => {
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId }, include: {
        employmentRecords: true, employeeNumbers: true,
        talentCandidate: { select: talentSourceSelect },
      } });
      if (!request || request.archivedAt) throw new NotFoundException('入职申请不存在或已归档');
      await lockTalentSource(tx, request.talentCandidateId);
      if (request.requiresArrivalConfirmation && request.onboardingStatus === OnboardingStatus.effective
        && request.arrivalConfirmedAt && request.arrivalDate?.getTime() === arrivalDate.getTime()
        && Number.isInteger(input.requestVersion)
        && [request.requestVersion, request.requestVersion - 1].includes(input.requestVersion)) return this.toView(request);
      this.assertArrivalPending(request, input.requestVersion);
      if (request.profileReviewStatus !== 'approved' || request.onboardingStatus !== OnboardingStatus.pending_entry) {
        throw new ConflictException('入职资料尚未审核通过，请先完成审核');
      }
      const employment = request.employmentRecords.find(item => item.sourceRequestId === requestId && item.userId === request.userId);
      const assignment = request.employeeNumbers.find(item => item.status === EmployeeNumberStatus.reserved
        && item.userId === request.userId && item.employeeNo === request.employeeNo);
      const user = await tx.user.findUnique({ where: { id: request.userId!, deletedAt: null }, select: { id: true, status: true, accountType: true } });
      if (!employment || !assignment || !user || user.accountType !== AccountType.employee || user.status !== UserStatus.pending_entry
        || employment.employeeNo !== request.employeeNo || ![UserStatus.active, UserStatus.probation].includes(employment.employeeStatus as any)
        || (employment.effectiveTo && employment.effectiveTo < shanghaiBusinessDate())) {
        throw new ConflictException('待到岗身份、任职或预留工号已变化，请刷新后核对');
      }
      if (employment.effectiveFrom.getTime() !== arrivalDate.getTime()) {
        throw new ConflictException('实际到岗日期与已审核日期不一致，请先修订入职日期并重新审核');
      }
      const now = new Date();
      const claimed = await tx.employeeDataChangeRequest.updateMany({ where: {
        id: requestId, requestVersion: input.requestVersion, onboardingStatus: OnboardingStatus.pending_entry,
        profileReviewStatus: 'approved', cancelledAt: null, archivedAt: null, arrivalConfirmedAt: null,
      }, data: { arrivalDate, arrivalConfirmedAt: now, arrivalConfirmedById: operator.id, requestVersion: { increment: 1 } } });
      if (claimed.count !== 1) throw new ConflictException('申请已变化，请刷新后重试');
      const result = await this.effectiveDates.activateApprovedOnboarding(tx, requestId, now);
      if (!result.activated) throw new ConflictException('到岗生效条件已变化，请刷新后核对');
      await tx.auditLog.create({ data: { userId: operator.id, action: 'confirm_employee_arrival',
        entityType: 'employee_data_change_request', entityId: requestId,
        newValue: { arrivalDate: input.arrivalDate, requestVersion: input.requestVersion + 1, userId: request.userId, talentCandidateId: request.talentCandidateId },
      } });
      return this.toView(await tx.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId },
        include: { talentCandidate: { select: talentSourceSelect } } }));
    });
  }

  async reviseArrivalDate(requestId: string, input: ReviseEmployeeArrivalDateDto, operator: AuthUser): Promise<OnboardingRequestView> {
    if (!hasHrCapability(operator, 'employee_archive_edit')) throw new ForbiddenException('没有修订入职申请权限');
    const date = this.calendarDate(input.arrivalDate);
    return this.arrivalTransaction(async tx => {
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.archivedAt) throw new NotFoundException('入职申请不存在或已归档');
      const reopening = request.onboardingStatus === OnboardingStatus.cancelled;
      if (reopening) await this.assertCancelledArrivalReopen(tx, request, input.requestVersion);
      else this.assertArrivalPending(request, input.requestVersion);
      const proposed = this.record(request.proposedValue);
      await lockTalentSource(tx, request.talentCandidateId);
      const employee = this.record(proposed.employee);
      const end = this.dateOrNull(employee.effectiveTo);
      if (end && date > end) throw new BadRequestException('入职日期不能晚于任职结束日期');
      const dateKey = request.intakeType === OnboardingIntakeType.new_hire ? 'effectiveFrom' : 'effectiveDate';
      const revisions = Array.isArray(request.revisionHistory) ? request.revisionHistory : [];
      const renewed = reopening ? await this.employeeNumbers.renewReleasedReservation(tx, requestId, request.userId!) : null;
      const employeeNo = renewed?.employeeNo ?? request.employeeNo;
      const updated = await tx.employeeDataChangeRequest.update({ where: { id: requestId, requestVersion: input.requestVersion,
        arrivalConfirmedAt: null, archivedAt: null, onboardingStatus: request.onboardingStatus,
        cancelledAt: reopening ? { not: null } : null }, data: {
        proposedValue: this.json({ ...proposed, employee: { ...employee, employeeNo, [dateKey]: input.arrivalDate, entryDate: input.arrivalDate } }),
        onboardingStatus: OnboardingStatus.submitted, profileReviewStatus: 'pending', profileReviewedAt: null, profileReviewedById: null,
        recordStatus: 'submitted', rejectedReason: null, appliedAt: null, requestVersion: { increment: 1 },
        ...(reopening ? { employeeNo, cancelledAt: null, cancelledById: null, cancelledReason: null } : {}),
        revisionHistory: this.json([...revisions, { version: request.requestVersion, proposedValue: request.proposedValue,
          baseValue: request.baseValue, rejectedReason: request.rejectedReason,
          revisedById: operator.id, revisedAt: new Date().toISOString(),
          ...(reopening ? { action: 'reopen_cancelled_employee_arrival', cancelledAt: request.cancelledAt,
            cancelledById: request.cancelledById, cancelledReason: request.cancelledReason,
            releasedReservation: renewed?.previousAssignment } : {}) }]),
      }, include: { talentCandidate: { select: talentSourceSelect } } });
      // The original approved record stays excluded by the request's pending review status.
      await tx.auditLog.create({ data: { userId: operator.id,
        action: reopening ? 'reopen_cancelled_employee_arrival' : 'revise_employee_arrival_date',
        entityType: 'employee_data_change_request', entityId: requestId,
        newValue: { arrivalDate: input.arrivalDate, requestVersion: input.requestVersion + 1 },
      } });
      return this.toView(updated);
    });
  }

  private async assertCancelledArrivalReopen(
    tx: Prisma.TransactionClient, request: EmployeeDataChangeRequest, requestVersion: number,
  ): Promise<void> {
    if (!Number.isInteger(requestVersion) || request.requestVersion !== requestVersion) throw new ConflictException('申请版本已变化，请刷新后重试');
    if (request.archivedAt || request.intakeType !== OnboardingIntakeType.new_hire || !request.requiresArrivalConfirmation
      || !request.userId || request.arrivalConfirmedAt || request.arrivalDate || request.arrivalConfirmedById
      || !request.cancelledAt || request.onboardingStatus !== OnboardingStatus.cancelled || request.recordStatus !== 'cancelled') {
      throw new ConflictException('仅可恢复已取消且从未到岗的首次入职申请');
    }
    await resolveTalentSource(tx, undefined, request, request.userId);
    // Keep candidate-before-identity lock order; every eligibility check shares this transaction.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${request.userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: request.userId, deletedAt: null, archivedAt: null,
      accountType: AccountType.employee }, select: { status: true, employeeNo: true } });
    if (user?.status !== UserStatus.pending_entry || user.employeeNo !== null) {
      throw new ConflictException('待入职身份已变化，不能恢复已取消申请');
    }
    const employment = await tx.employmentRecord.findFirst({ where: { userId: request.userId }, select: { id: true } });
    const number = await tx.employeeNumberAssignment.findFirst({ where: { userId: request.userId,
      status: { in: [EmployeeNumberStatus.reserved, EmployeeNumberStatus.current, EmployeeNumberStatus.historical] } }, select: { id: true } });
    if (employment || number) throw new ConflictException('员工已有任职或未释放工号，不能恢复首次入职申请');
    const open = await tx.employeeDataChangeRequest.findFirst({ where: {
      userId: request.userId, id: { not: request.id }, archivedAt: null, cancelledAt: null,
      OR: [{ recordStatus: 'draft' }, { recordStatus: 'submitted', OR: [
        { onboardingStatus: { in: unfinishedStatuses } },
        { profileReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
        { performanceReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
        { profileReviewStatus: 'approved', appliedAt: null },
      ] }],
    }, select: { id: true } });
    if (open) throw new ConflictException('该身份已有其他未完成申请，请先处理原申请');
  }

  private assertArrivalPending(request: any, requestVersion: number): void {
    if (!request || request.archivedAt) throw new NotFoundException('入职申请不存在或已归档');
    if (!Number.isInteger(requestVersion) || request.requestVersion !== requestVersion) throw new ConflictException('申请版本已变化，请刷新后重试');
    if (!request.requiresArrivalConfirmation || !request.intakeType || !request.userId || request.arrivalConfirmedAt
      || request.cancelledAt || !['submitted', 'pending_entry'].includes(request.onboardingStatus) || request.recordStatus !== 'submitted') {
      throw new ConflictException('该申请不属于可办理到岗的待入职申请');
    }
  }

  private calendarDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('请填写有效的到岗日期（YYYY-MM-DD）');
    }
    return date;
  }

  private async arrivalTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const details = this.record(error);
      const rawTransactionConflict = details.code === 'P2010'
        && ['40001', '40P01'].includes(String(this.record(details.meta).code));
      if (rawTransactionConflict || ['P2025', 'P2034'].includes(String(details.code))) {
        throw new ConflictException('申请已被其他操作更新，请刷新后重试');
      }
      throw error;
    }
  }

  async createReentry(
    userId: string,
    input: CreateEmployeeReentryDto,
    operatorId: string,
  ): Promise<OnboardingRequestView> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId, deletedAt: null, accountType: AccountType.employee },
        include: { employmentHistory: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      });
      if (!user) throw new NotFoundException('员工不存在');

      const today = this.startOfTodayInShanghai();
      const historicalOnly = Boolean(input.effectiveTo && input.effectiveTo < today);
      if (!historicalOnly && user.status !== UserStatus.resigned && !user.archivedAt) {
        throw new ConflictException('该员工当前仍在职，请在原档案中维护，不能重复入职');
      }
      const currentEmployment = await tx.employmentRecord.findFirst({
        where: {
          userId,
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        select: { id: true, employeeStatus: true },
      });
      if (!historicalOnly && currentEmployment
        && (currentEmployment.employeeStatus === UserStatus.active
          || currentEmployment.employeeStatus === UserStatus.probation)) {
        throw new ConflictException('员工已有当前有效任职，不能重复入职');
      }

      const open = await tx.employeeDataChangeRequest.findFirst({
        where: { userId, intakeType: { in: [OnboardingIntakeType.new_hire, OnboardingIntakeType.reentry] }, onboardingStatus: { in: unfinishedStatuses } },
        select: { id: true },
      });
      if (open) throw new ConflictException('该员工已有未完成的入职申请');
      await this.assertReferences(tx, userId, input);
      const talentCandidateId = await resolveTalentSource(tx, input.talentCandidateId, undefined, userId);

      const warnings = this.buildWarnings(input);
      const employee = this.normalizedEmployee(input);
      await this.normalizePosition(tx, employee, this.record(user.employmentHistory[0]));
      await normalizeContractSubject(tx, employee, {}, 'companyText');
      await validateContractSubject(tx, employee, {}, 'companyText');
      const request = await tx.employeeDataChangeRequest.create({
        data: {
          userId,
          employeeNo: null,
          employeeName: user.name,
          sourceType: 'manual_reentry',
          sourceSystem: input.sourceSystem?.trim() || 'manual',
          sourceReference: input.sourceReference?.trim() || null,
          intakeType: OnboardingIntakeType.reentry,
          onboardingStatus: OnboardingStatus.submitted,
          requiresArrivalConfirmation: !historicalOnly,
          talentCandidateId,
          baseValue: this.json({
            employee: {
              status: user.status,
              archivedAt: user.archivedAt,
              employeeNo: user.employeeNo,
              latestEmployment: user.employmentHistory[0] ?? null,
            },
            performance: { managerId: user.directManagerId },
          }),
          proposedValue: this.json({
            employee,
            performance: { managerId: input.performanceManagerId ?? null },
            contracts: input.contractReferences ?? [],
            payloadHash: this.hashPayload(input),
          }),
          profileReviewStatus: 'pending',
          performanceReviewStatus: !historicalOnly && input.performanceManagerId ? 'pending' : 'not_required',
          validationErrors: this.json([]),
          validationWarnings: this.json(warnings),
          recordStatus: 'submitted',
          createdById: operatorId,
        },
      });
      const employeeNo = await this.employeeNumbers.reserveNext(tx, request.id, userId);
      const updated = await tx.employeeDataChangeRequest.update({
        where: { id: request.id },
        include: { talentCandidate: { select: talentSourceSelect } },
        data: {
          employeeNo,
          proposedValue: this.json({
            employee: { ...employee, employeeNo },
            performance: { managerId: input.performanceManagerId ?? null },
            contracts: input.contractReferences ?? [],
            payloadHash: this.hashPayload(input),
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'submit_employee_reentry',
          entityType: 'employee_data_change_request',
          entityId: request.id,
          newValue: this.json({ userId, sourceSystem: input.sourceSystem ?? 'manual', effectiveDate: input.effectiveDate, employeeNo: this.maskEmployeeNo(employeeNo) }),
        },
      });
      return this.toView(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reviseReentry(requestId: string, input: ReviseEmployeeReentryDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || !request.intakeType) throw new NotFoundException('入职申请不存在');
      const performanceOnly = request.profileReviewStatus === 'approved' && request.performanceReviewStatus === 'rejected'
        && [OnboardingStatus.pending_entry, OnboardingStatus.effective].includes(request.onboardingStatus as any)
        && (request.intakeType === OnboardingIntakeType.new_hire || request.onboardingStatus === OnboardingStatus.effective || input.performanceOnly === true);
      if ((input.performanceOnly || request.intakeType === OnboardingIntakeType.new_hire) && !performanceOnly) {
        throw new ConflictException('该申请不属于可重提的退回绩效关系');
      }
      if (!unfinishedStatuses.includes(request.onboardingStatus!) && !performanceOnly) throw new ConflictException('该申请当前不能修订');
      if (!request.userId) throw new ConflictException('再入职申请缺少员工标识');
      await resolveTalentSource(tx, input.talentCandidateId, request, request.userId);
      await this.assertReferences(tx, request.userId, performanceOnly ? { performanceManagerId: input.performanceManagerId } as EmployeeReentryFieldsDto : input);
      if (performanceOnly && !input.performanceOnly && request.intakeType === OnboardingIntakeType.reentry) {
        const previous = this.record(this.record(request.proposedValue).employee);
        const changed = Object.entries(this.normalizedEmployee(input)).some(([key, value]) => {
          const before = key.includes('Date') || key === 'effectiveTo' ? this.dateOrNull(previous[key]) : previous[key] ?? null;
          const after = key.includes('Date') || key === 'effectiveTo' ? this.dateOrNull(value) : value ?? null;
          return this.hashPayload(before) !== this.hashPayload(after);
        });
        if (changed) throw new ConflictException('基础档案已生效，本次只可重提退回的绩效关系；任职调整请另办变更');
      }
      const baseValue = this.record(request.baseValue);
      const reviewedEmployment = !performanceOnly
        ? await tx.employmentRecord.findUnique({ where: { sourceRequestId: request.id } }) : null;
      // Revision may remove the pending projection; retain its reviewed company for later review.
      const companyBase = reviewedEmployment ? {
        contractSubjectId: reviewedEmployment.contractSubjectId ?? null,
        company: reviewedEmployment.company,
        companyText: reviewedEmployment.companyText ?? null,
      } : this.record(baseValue.reviewedEmploymentCompany);
      const revisions = Array.isArray(request.revisionHistory) ? request.revisionHistory : [];
      const historicalOnly = Boolean(input.effectiveTo && input.effectiveTo < this.startOfTodayInShanghai());
      const next = performanceOnly ? {
        ...this.record(request.proposedValue), performance: { managerId: input.performanceManagerId ?? null },
      } : {
        employee: { ...this.normalizedEmployee(input), employeeNo: request.employeeNo },
        performance: { managerId: input.performanceManagerId ?? null },
        contracts: input.contractReferences ?? [],
        payloadHash: this.hashPayload(input),
      };
      if (!performanceOnly) {
        await this.normalizePosition(tx, next.employee as Record<string, unknown>, this.reentryPositionSnapshot(request));
        await normalizeContractSubject(tx, next.employee as Record<string, unknown>, this.record(this.record(request.proposedValue).employee), 'companyText', companyBase);
        await validateContractSubject(tx, next.employee as Record<string, unknown>, companyBase, 'companyText');
      }
      if (request.onboardingStatus === OnboardingStatus.pending_entry && !performanceOnly) {
        await this.undoPendingProjection(tx, request);
      }
      const updated = await tx.employeeDataChangeRequest.update({
        where: { id: requestId },
        include: { talentCandidate: { select: talentSourceSelect } },
        data: {
          ...(input.talentCandidateId ? { talentCandidateId: input.talentCandidateId } : {}),
          ...(reviewedEmployment ? { baseValue: this.json({ ...baseValue, reviewedEmploymentCompany: companyBase }) } : {}),
          proposedValue: this.json(next),
          validationWarnings: performanceOnly ? request.validationWarnings ?? [] : this.json(this.buildWarnings(input)),
          requestVersion: { increment: 1 },
          revisionHistory: this.json([...revisions, {
            version: request.requestVersion,
            baseValue: request.baseValue,
            rejectedReason: request.rejectedReason,
            proposedValue: request.proposedValue,
            validationWarnings: request.validationWarnings,
            revisedAt: new Date().toISOString(), revisedById: operatorId,
          }]),
          ...(!performanceOnly ? { profileReviewStatus: 'pending', profileReviewedById: null, profileReviewedAt: null } : {}),
          performanceReviewStatus: performanceOnly || (!historicalOnly && input.performanceManagerId) ? 'pending' : 'not_required',
          performanceReviewedById: null, performanceReviewedAt: null,
          rejectedReason: null, recordStatus: 'submitted', onboardingStatus: performanceOnly ? request.onboardingStatus : OnboardingStatus.submitted,
        },
      });
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'revise_employee_reentry', entityType: 'employee_data_change_request', entityId: requestId,
        newValue: this.json({ requestVersion: updated.requestVersion, effectiveDate: input.effectiveDate }),
      } });
      return this.toView(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async cancelReentry(requestId: string, input: CancelEmployeeReentryDto, operatorId: string) {
    return this.arrivalTransaction(async (tx) => {
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || !request.intakeType) throw new NotFoundException('入职申请不存在');
      if (!request.onboardingStatus || !unfinishedStatuses.includes(request.onboardingStatus)) {
        throw new ConflictException('该申请已经生效或取消，不能再次取消');
      }
      await lockTalentSource(tx, request.talentCandidateId);
      const now = new Date();
      if (request.onboardingStatus === OnboardingStatus.pending_entry || (request.requiresArrivalConfirmation && request.userId)) {
        await this.undoPendingProjection(tx, request);
      }
      await this.employeeNumbers.releaseReservation(tx, requestId, now);
      const updated = await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.cancelled, recordStatus: 'cancelled', cancelledAt: now,
        cancelledById: operatorId, cancelledReason: input.reason.trim(), requestVersion: { increment: 1 },
      }, include: { talentCandidate: { select: talentSourceSelect } } });
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'cancel_employee_reentry', entityType: 'employee_data_change_request', entityId: requestId,
        newValue: this.json({ status: OnboardingStatus.cancelled, reason: input.reason.trim() }),
      } });
      return this.toView(updated);
    });
  }

  private async undoPendingProjection(tx: Prisma.TransactionClient, request: any) {
    const employment = await tx.employmentRecord.findUnique({ where: { sourceRequestId: request.id } });
    const awaitingArrival = request.requiresArrivalConfirmation && !request.arrivalConfirmedAt;
    if (!awaitingArrival && employment && employment.effectiveFrom <= shanghaiBusinessDate()) {
      throw new ConflictException('该任职已到生效日期，请刷新档案后办理更正');
    }
    await tx.employmentRecord.deleteMany({ where: { sourceRequestId: request.id,
      ...(!awaitingArrival ? { effectiveFrom: { gt: shanghaiBusinessDate() } } : {}) } });
    if (!request.userId) return;
    const base = this.record(this.record(request.baseValue).employee);
    // Only undo the projection owned by this application, never replay the full old archive.
    await tx.user.updateMany({ where: {
      id: request.userId, status: UserStatus.pending_entry, employeeNo: request.employeeNo,
    }, data: {
      status: awaitingArrival && request.intakeType === OnboardingIntakeType.new_hire ? UserStatus.pending_entry : this.userStatus(base.status, UserStatus.resigned),
      archivedAt: this.dateOrNull(base.archivedAt),
      employeeNo: this.stringOrNull(base.employeeNo),
      directManagerId: null,
    } });
  }

  async getCurrentReentry(userId: string): Promise<OnboardingRequestView | null> {
    const request = await this.prisma.employeeDataChangeRequest.findFirst({
      include: { talentCandidate: { select: talentSourceSelect } },
      where: { userId, OR: [
        { intakeType: OnboardingIntakeType.reentry, onboardingStatus: { in: unfinishedStatuses } },
        { intakeType: OnboardingIntakeType.new_hire, requiresArrivalConfirmation: true,
          onboardingStatus: { in: unfinishedStatuses }, archivedAt: null, cancelledAt: null },
        { intakeType: OnboardingIntakeType.reentry, onboardingStatus: OnboardingStatus.effective, performanceReviewStatus: { in: ['pending', 'rejected'] } },
        { intakeType: OnboardingIntakeType.new_hire, profileReviewStatus: 'approved', performanceReviewStatus: { in: ['pending', 'rejected'] }, onboardingStatus: { in: [OnboardingStatus.pending_entry, OnboardingStatus.effective] } },
      ] },
      orderBy: { createdAt: 'desc' },
    });
    if (request) return this.toView(request);
    return this.arrivalTransaction(async tx => {
      const cancelled = await tx.employeeDataChangeRequest.findFirst({ where: { userId,
        intakeType: OnboardingIntakeType.new_hire, requiresArrivalConfirmation: true,
        onboardingStatus: OnboardingStatus.cancelled, recordStatus: 'cancelled',
        arrivalConfirmedAt: null, cancelledAt: { not: null }, archivedAt: null,
      }, orderBy: { updatedAt: 'desc' }, include: { talentCandidate: { select: talentSourceSelect } } });
      if (!cancelled) return null;
      try { await this.assertCancelledArrivalReopen(tx, cancelled, cancelled.requestVersion); }
      catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) return null;
        throw error;
      }
      const view = { ...this.toView(cancelled), cancelledAt: cancelled.cancelledAt };
      return view;
    });
  }

  async createOnboardingIntake(input: CreateOnboardingIntakeDto, operatorId: string): Promise<OnboardingIntakeResult> {
    const payloadHash = this.hashIntakePayload(input);
    const existing = await this.prisma.employeeDataChangeRequest.findFirst({
      where: { sourceSystem: input.sourceSystem.trim(), sourceReference: input.sourceReference.trim() },
    });
    if (existing) {
      const existingHash = this.stringOrNull(this.record(existing.proposedValue).payloadHash);
      if (existingHash !== payloadHash) throw new ConflictException('来源编号已存在，但本次内容与原草稿不一致');
      return {
        intakeId: existing.id,
        matchStatus: existing.userId ? 'matched_reentry' : 'new',
        matchedEmployeeId: existing.userId,
        recordStatus: existing.recordStatus,
        nextAction: existing.userId ? 'submit_hr_review' : 'complete_new_hire_draft',
      };
    }

    let matchedEmployeeId = input.intakeType === 'reentry' ? input.existingEmployeeId ?? null : null;
    let matchStatus: OnboardingIntakeResult['matchStatus'] = input.intakeType === 'new_hire' ? 'new' : 'needs_review';
    let candidates: unknown[] = [];
    if (!matchedEmployeeId && (input.identitySnapshot.phone || input.identitySnapshot.idNumber)) {
      const lookup = await this.identityMatcher.lookup({ phone: input.identitySnapshot.phone, idNumber: input.identitySnapshot.idNumber });
      candidates = lookup.candidates.map(({ id, matchBasis, nextAction }) => ({ id, matchBasis, nextAction }));
      if (lookup.outcome === 'conflict') matchStatus = 'conflict';
    }
    if (matchedEmployeeId) {
      const user = await this.prisma.user.findUnique({ where: { id: matchedEmployeeId, deletedAt: null }, select: { id: true } });
      if (!user) throw new BadRequestException('所选历史员工不存在');
      matchStatus = 'matched_reentry';
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const talentCandidateId = await resolveTalentSource(tx, input.talentCandidateId, undefined, matchedEmployeeId);
      const employee = this.normalizedEmployee(input);
      const previousEmployment = matchedEmployeeId ? await tx.employmentRecord.findFirst({
        where: { userId: matchedEmployeeId }, orderBy: { effectiveFrom: 'desc' },
        select: { positionId: true, position: true, jobFamily: true },
      }) : null;
      await this.normalizePosition(tx, employee, this.record(previousEmployment));
      await normalizeContractSubject(tx, employee, {}, 'companyText');
      const created = await tx.employeeDataChangeRequest.create({ data: {
        userId: matchedEmployeeId,
        employeeNo: null,
        employeeName: input.identitySnapshot.name.trim(),
        sourceType: 'onboarding_intake', sourceSystem: input.sourceSystem.trim(), sourceReference: input.sourceReference.trim(),
        intakeType: input.intakeType === 'reentry' ? OnboardingIntakeType.reentry : OnboardingIntakeType.new_hire,
        onboardingStatus: OnboardingStatus.draft,
        requiresArrivalConfirmation: !(input.effectiveTo && input.effectiveTo < shanghaiBusinessDate()),
        talentCandidateId,
        baseValue: this.json({}),
        proposedValue: this.json({
          payloadHash,
          identitySnapshot: {
            name: input.identitySnapshot.name.trim(),
            phone: this.maskPhone(input.identitySnapshot.phone),
            email: this.maskEmail(input.identitySnapshot.email),
            hasIdNumber: Boolean(input.identitySnapshot.idNumber),
          },
          matchCandidates: candidates,
          employee,
        }),
        validationErrors: this.json([]), validationWarnings: this.json(this.buildWarnings(input)),
        recordStatus: 'draft', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
        createdById: operatorId,
      } });
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'create_onboarding_intake', entityType: 'employee_data_change_request', entityId: created.id,
        newValue: this.json({ sourceSystem: input.sourceSystem, sourceReference: input.sourceReference, intakeType: input.intakeType, matchStatus }),
      } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return {
      intakeId: request.id, matchStatus, matchedEmployeeId, recordStatus: request.recordStatus,
      nextAction: matchStatus === 'matched_reentry' ? 'submit_hr_review' : matchStatus === 'new' ? 'complete_new_hire_draft' : 'review_employee_match',
    };
  }

  hashIntakePayload(input: CreateOnboardingIntakeDto): string {
    return this.hashPayload(input);
  }

  async applyApprovedReentry(
    tx: Prisma.TransactionClient,
    requestId: string,
    reviewerId: string,
    at = new Date(),
  ): Promise<'pending_entry' | 'effective' | 'historical'> {
    const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.intakeType !== OnboardingIntakeType.reentry || !request.userId) {
      throw new NotFoundException('再入职申请不存在');
    }
    if (request.onboardingStatus === OnboardingStatus.cancelled) throw new ConflictException('再入职申请已取消');
    if (request.onboardingStatus === OnboardingStatus.effective) return 'effective';
    await lockTalentSource(tx, request.talentCandidateId);
    const existing = await tx.employmentRecord.findUnique({ where: { sourceRequestId: requestId } });
    const proposed = this.record(request.proposedValue);
    const employee = { ...this.record(proposed.employee) };
    await this.normalizePosition(tx, employee, this.reentryPositionSnapshot(request));
    const effectiveFrom = this.requiredDate(employee.effectiveDate, '再入职日期不能为空');
    const effectiveTo = this.dateOrNull(employee.effectiveTo);
    const today = this.startOfTodayInShanghai(at);
    const historicalOnly = !request.requiresArrivalConfirmation && Boolean(effectiveTo && effectiveTo < today);
    const assignment = await tx.employeeNumberAssignment.findFirst({ where: {
      sourceRequestId: requestId, userId: request.userId, employeeNo: request.employeeNo ?? undefined,
      status: EmployeeNumberStatus.reserved,
    } });
    if (!assignment && !existing) throw new ConflictException('自动工号预留不存在或已被占用');
    if (!existing || (request.requiresArrivalConfirmation && !request.arrivalConfirmedAt)) {
      const companyBase = existing ?? this.record(this.record(request.baseValue).reviewedEmploymentCompany);
      if (companyBase.contractSubjectId && (employee.contractSubjectId === undefined || employee.contractSubjectId === companyBase.contractSubjectId)) {
        employee.contractSubjectId = companyBase.contractSubjectId;
        employee.company = companyBase.company;
        employee.companyText = companyBase.companyText;
      }
      await validateContractSubject(tx, employee, companyBase, 'companyText');
      const employmentData = {
        effectiveFrom, effectiveTo,
        company: employee.company as any,
        contractSubjectId: this.stringOrNull(employee.contractSubjectId), companyText: this.stringOrNull(employee.companyText),
        deptId: this.stringOrNull(employee.deptId), positionId: this.stringOrNull(employee.positionId),
        position: this.stringOrNull(employee.position), directManagerId: this.stringOrNull(employee.managerId),
        jobFamily: this.stringOrNull(employee.jobFamily),
        employmentType: employee.employmentType as any, employeeStatus: employee.employeeStatus as any,
        entryDate: effectiveFrom, plannedRegularDate: this.dateOrNull(employee.plannedRegularDate),
        probationMonths: typeof employee.probationMonths === 'number' ? employee.probationMonths : null,
      };
      if (existing) {
        await tx.employmentRecord.update({ where: { id: existing.id }, data: employmentData });
      } else {
        await tx.employmentRecord.create({ data: {
          ...employmentData, userId: request.userId, employeeNo: request.employeeNo,
          changeType: 'reentry', reason: '再入职审核通过', sourceType: 'employee_reentry', sourceRequestId: requestId,
          createdById: reviewerId,
        } });
      }
    }
    if (historicalOnly) {
      await tx.employeeNumberAssignment.updateMany({ where: { sourceRequestId: requestId }, data: {
        status: EmployeeNumberStatus.historical, effectiveFrom, effectiveTo,
      } });
      await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.effective, appliedAt: at,
      } });
      return 'historical';
    }
    if (effectiveFrom > today || (request.requiresArrivalConfirmation && !request.arrivalConfirmedAt)) {
      await tx.user.update({ where: { id: request.userId }, data: {
        employeeNo: request.employeeNo,
        status: UserStatus.pending_entry, archivedAt: null, sysRole: SysRole.employee,
        directManagerId: null,
        hrCapabilities: { set: [] }, canViewAll: false, isAssessorOnly: false,
      } });
      await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.pending_entry,
      } });
      return 'pending_entry';
    }
    await this.effectiveDates.activateApprovedOnboarding(tx, requestId, at);
    return 'effective';
  }

  async finalizeApprovedOnboarding(tx: Prisma.TransactionClient, requestId: string, at = new Date()) {
    return this.effectiveDates.activateApprovedOnboarding(tx, requestId, at);
  }

  private async assertReferences(tx: Prisma.TransactionClient, userId: string, input: EmployeeReentryFieldsDto) {
    if (input.deptId) {
      const dept = await tx.department.findUnique({ where: { id: input.deptId }, select: { id: true, isActive: true } });
      if (!dept?.isActive) throw new BadRequestException('所属部门不存在或已停用');
    }
    for (const managerId of [input.rosterManagerId, input.performanceManagerId].filter(Boolean) as string[]) {
      if (managerId === userId) throw new BadRequestException('直属上级不能是员工本人');
      const manager = await tx.user.findUnique({ where: {
        id: managerId, deletedAt: null, archivedAt: null,
        status: { in: [UserStatus.active, UserStatus.probation] },
      }, select: { id: true } });
      if (!manager) throw new BadRequestException('直属上级不存在或当前不在职');
    }
  }

  private reentryPositionSnapshot(request: EmployeeDataChangeRequest): Record<string, unknown> {
    const previous = this.record(this.record(request.proposedValue).employee);
    const historical = this.record(this.record(this.record(request.baseValue).employee).latestEmployment);
    // Older requests omitted jobFamily; only a matching position can supply that missing snapshot.
    return this.stringOrNull(previous.positionId) === this.stringOrNull(historical.positionId)
      ? { ...historical, ...previous } : previous;
  }

  private async normalizePosition(
    tx: Prisma.TransactionClient, employee: Record<string, unknown>, previous: Record<string, unknown>,
  ): Promise<void> {
    const id = this.stringOrNull(employee.positionId);
    const samePosition = id === this.stringOrNull(previous.positionId);
    const position = id ? await tx.position.findUnique({ where: { id },
      select: { id: true, name: true, jobFamily: true, isActive: true } }) : null;
    if (id && !position?.isActive) throw new BadRequestException('岗位不存在或已停用');
    for (const field of ['position', 'jobFamily'] as const) {
      const unchanged = employee[field] === undefined
        || this.stringOrNull(employee[field]) === this.stringOrNull(previous[field]);
      if (samePosition && unchanged && Object.prototype.hasOwnProperty.call(previous, field)) {
        employee[field] = previous[field] ?? null;
      } else if (position) {
        employee[field] = (field === 'position' ? position.name : position.jobFamily) ?? null;
      } else {
        employee[field] = this.stringOrNull(employee[field]);
      }
    }
  }

  private normalizedEmployee(input: EmployeeReentryFieldsDto) {
    return {
      ...(input.contractSubjectId !== undefined ? { contractSubjectId: input.contractSubjectId } : {}),
      company: input.company, deptId: input.deptId ?? null, positionId: input.positionId ?? null,
      ...(input.position !== undefined ? { position: this.stringOrNull(input.position) } : {}),
      ...(input.jobFamily !== undefined ? { jobFamily: this.stringOrNull(input.jobFamily) } : {}),
      managerId: input.rosterManagerId ?? null,
      effectiveDate: input.effectiveDate, effectiveTo: input.effectiveTo ?? null,
      employeeStatus: input.employeeStatus, employmentType: input.employmentType,
      plannedRegularDate: input.plannedRegularDate ?? null, probationMonths: input.probationMonths ?? null,
    };
  }

  private buildWarnings(input: EmployeeReentryFieldsDto) {
    const warnings: Array<{ field: string; message: string }> = [];
    if (!input.contractReferences?.length) warnings.push({ field: 'contractReferences', message: '尚未关联新合同，可提交后补充' });
    if (input.employeeStatus === UserStatus.probation && !input.plannedRegularDate) warnings.push({ field: 'plannedRegularDate', message: '试用期员工尚未填写计划转正日' });
    if (!input.rosterManagerId) warnings.push({ field: 'rosterManagerId', message: '尚未设置花名册直属主管，可提交后补充' });
    if (!input.performanceManagerId) warnings.push({ field: 'performanceManagerId', message: '尚未设置绩效直属上级，可提交后补充' });
    if (input.effectiveDate < this.startOfTodayInShanghai()) warnings.push({ field: 'effectiveDate', message: '该日期将作为历史补录处理' });
    return warnings;
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonicalize(item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
        result[key] = this.canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
    }
    return value instanceof Date ? value.toISOString() : value;
  }

  private hashPayload(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(this.canonicalize(value))).digest('hex');
  }

  private startOfTodayInShanghai(at = new Date()): Date {
    return shanghaiBusinessDate(at);
  }

  private toView(request: any): OnboardingRequestView {
    return {
      id: request.id, userId: request.userId, employeeName: request.employeeName, employeeNo: request.employeeNo,
      intakeType: request.intakeType, onboardingStatus: request.onboardingStatus,
      requestVersion: request.requestVersion, recordStatus: request.recordStatus,
      requiresArrivalConfirmation: request.requiresArrivalConfirmation ?? false,
      arrivalDate: request.arrivalDate ?? null, arrivalConfirmedAt: request.arrivalConfirmedAt ?? null,
      arrivalConfirmedById: request.arrivalConfirmedById ?? null, talentCandidateId: request.talentCandidateId ?? null,
      talentCandidate: request.talentCandidate ?? null,
      profileReviewStatus: request.profileReviewStatus,
      performanceReviewStatus: request.performanceReviewStatus,
      rejectedReason: request.rejectedReason ?? null,
      profileReviewedAt: request.profileReviewedAt ?? null,
      performanceReviewedAt: request.performanceReviewedAt ?? null,
      profileReviewedById: request.profileReviewedById ?? null,
      performanceReviewedById: request.performanceReviewedById ?? null,
      appliedAt: request.appliedAt ?? null,
      proposedValue: this.record(employeeDataChangeView(request).proposedValue),
      validationWarnings: Array.isArray(request.validationWarnings) ? request.validationWarnings : [],
      createdAt: request.createdAt, updatedAt: request.updatedAt,
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private dateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private requiredDate(value: unknown, message: string): Date {
    const date = this.dateOrNull(value);
    if (!date) throw new BadRequestException(message);
    return date;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private userStatus(value: unknown, fallback: UserStatus): UserStatus {
    return Object.values(UserStatus).includes(value as UserStatus) ? value as UserStatus : fallback;
  }

  private maskEmployeeNo(value: string): string {
    return value.length <= 2 ? '*'.repeat(value.length) : `${'*'.repeat(value.length - 2)}${value.slice(-2)}`;
  }

  private maskPhone(value?: string): string | null {
    const phone = value?.trim();
    if (!phone) return null;
    return phone.length <= 4 ? '*'.repeat(phone.length) : `${phone.slice(0, 3)}${'*'.repeat(Math.max(1, phone.length - 7))}${phone.slice(-4)}`;
  }

  private maskEmail(value?: string): string | null {
    const email = value?.trim().toLowerCase();
    if (!email) return null;
    const [name, domain] = email.split('@');
    return domain ? `${name.slice(0, 1)}***@${domain}` : '*'.repeat(email.length);
  }
}
