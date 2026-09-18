import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
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
import {
  CancelEmployeeReentryDto,
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
          employeeStatus: { in: [UserStatus.active, UserStatus.probation] },
        },
        select: { id: true },
      });
      if (!historicalOnly && currentEmployment) throw new ConflictException('员工已有当前有效任职，不能重复入职');

      const open = await tx.employeeDataChangeRequest.findFirst({
        where: { userId, intakeType: { in: [OnboardingIntakeType.new_hire, OnboardingIntakeType.reentry] }, onboardingStatus: { in: unfinishedStatuses } },
        select: { id: true },
      });
      if (open) throw new ConflictException('该员工已有未完成的入职申请');
      await this.assertReferences(tx, userId, input);

      const warnings = this.buildWarnings(input);
      const employee = this.normalizedEmployee(input);
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
      if (!request || request.intakeType !== OnboardingIntakeType.reentry) throw new NotFoundException('再入职申请不存在');
      if (!unfinishedStatuses.includes(request.onboardingStatus!)) throw new ConflictException('该申请当前不能修订');
      if (!request.userId) throw new ConflictException('再入职申请缺少员工标识');
      await this.assertReferences(tx, request.userId, input);
      const revisions = Array.isArray(request.revisionHistory) ? request.revisionHistory : [];
      const historicalOnly = Boolean(input.effectiveTo && input.effectiveTo < this.startOfTodayInShanghai());
      const next = {
        employee: { ...this.normalizedEmployee(input), employeeNo: request.employeeNo },
        performance: { managerId: input.performanceManagerId ?? null },
        contracts: input.contractReferences ?? [],
        payloadHash: this.hashPayload(input),
      };
      const updated = await tx.employeeDataChangeRequest.update({
        where: { id: requestId },
        data: {
          proposedValue: this.json(next),
          validationWarnings: this.json(this.buildWarnings(input)),
          requestVersion: { increment: 1 },
          revisionHistory: this.json([...revisions, {
            version: request.requestVersion,
            proposedValue: request.proposedValue,
            validationWarnings: request.validationWarnings,
            revisedAt: new Date().toISOString(), revisedById: operatorId,
          }]),
          profileReviewStatus: 'pending', profileReviewedById: null, profileReviewedAt: null,
          performanceReviewStatus: !historicalOnly && input.performanceManagerId ? 'pending' : 'not_required',
          performanceReviewedById: null, performanceReviewedAt: null,
          rejectedReason: null, recordStatus: 'submitted', onboardingStatus: OnboardingStatus.submitted,
        },
      });
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'revise_employee_reentry', entityType: 'employee_data_change_request', entityId: requestId,
        newValue: this.json({ requestVersion: updated.requestVersion, effectiveDate: input.effectiveDate }),
      } });
      return this.toView(updated);
    });
  }

  async cancelReentry(requestId: string, input: CancelEmployeeReentryDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.intakeType !== OnboardingIntakeType.reentry) throw new NotFoundException('再入职申请不存在');
      if (!request.onboardingStatus || !unfinishedStatuses.includes(request.onboardingStatus)) {
        throw new ConflictException('该申请已经生效或取消，不能再次取消');
      }
      const now = new Date();
      if (request.onboardingStatus === OnboardingStatus.pending_entry) {
        await tx.employmentRecord.deleteMany({ where: { sourceRequestId: requestId, effectiveFrom: { gt: this.startOfTodayInShanghai() } } });
        if (request.userId) {
          const base = this.record(this.record(request.baseValue).employee);
          await tx.user.update({ where: { id: request.userId }, data: {
            status: this.userStatus(base.status, UserStatus.resigned),
            archivedAt: this.dateOrNull(base.archivedAt),
            employeeNo: this.stringOrNull(base.employeeNo),
          } });
        }
      }
      await this.employeeNumbers.releaseReservation(tx, requestId, now);
      const updated = await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.cancelled, recordStatus: 'cancelled', cancelledAt: now,
        cancelledById: operatorId, cancelledReason: input.reason.trim(),
      } });
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'cancel_employee_reentry', entityType: 'employee_data_change_request', entityId: requestId,
        newValue: this.json({ status: OnboardingStatus.cancelled, reason: input.reason.trim() }),
      } });
      return this.toView(updated);
    });
  }

  async getCurrentReentry(userId: string): Promise<OnboardingRequestView | null> {
    const request = await this.prisma.employeeDataChangeRequest.findFirst({
      where: { userId, intakeType: OnboardingIntakeType.reentry, onboardingStatus: { in: unfinishedStatuses } },
      orderBy: { createdAt: 'desc' },
    });
    return request ? this.toView(request) : null;
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
      const created = await tx.employeeDataChangeRequest.create({ data: {
        userId: matchedEmployeeId,
        employeeNo: null,
        employeeName: input.identitySnapshot.name.trim(),
        sourceType: 'onboarding_intake', sourceSystem: input.sourceSystem.trim(), sourceReference: input.sourceReference.trim(),
        intakeType: input.intakeType === 'reentry' ? OnboardingIntakeType.reentry : OnboardingIntakeType.new_hire,
        onboardingStatus: OnboardingStatus.draft,
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
          employee: this.normalizedEmployee(input),
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
    });
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
    const existing = await tx.employmentRecord.findUnique({ where: { sourceRequestId: requestId } });
    const proposed = this.record(request.proposedValue);
    const employee = this.record(proposed.employee);
    const effectiveFrom = this.requiredDate(employee.effectiveDate, '再入职日期不能为空');
    const effectiveTo = this.dateOrNull(employee.effectiveTo);
    const today = this.startOfTodayInShanghai(at);
    const historicalOnly = Boolean(effectiveTo && effectiveTo < today);
    const assignment = await tx.employeeNumberAssignment.findFirst({ where: {
      sourceRequestId: requestId, userId: request.userId, employeeNo: request.employeeNo ?? undefined,
      status: EmployeeNumberStatus.reserved,
    } });
    if (!assignment && !existing) throw new ConflictException('自动工号预留不存在或已被占用');
    if (!existing) {
      await tx.employmentRecord.create({ data: {
        userId: request.userId, employeeNo: request.employeeNo,
        effectiveFrom, effectiveTo,
        company: employee.company as any,
        deptId: this.stringOrNull(employee.deptId), positionId: this.stringOrNull(employee.positionId),
        position: this.stringOrNull(employee.position), directManagerId: this.stringOrNull(employee.managerId),
        employmentType: employee.employmentType as any, employeeStatus: employee.employeeStatus as any,
        entryDate: effectiveFrom, plannedRegularDate: this.dateOrNull(employee.plannedRegularDate),
        probationMonths: typeof employee.probationMonths === 'number' ? employee.probationMonths : null,
        changeType: 'reentry', reason: '再入职审核通过', sourceType: 'employee_reentry', sourceRequestId: requestId,
        createdById: reviewerId,
      } });
    }
    if (request.performanceReviewStatus === 'pending') {
      await tx.user.update({ where: { id: request.userId }, data: {
        employeeNo: request.employeeNo,
        status: UserStatus.pending_entry,
        archivedAt: null,
        sysRole: SysRole.employee,
        hrCapabilities: { set: [] },
        canViewAll: false,
        isAssessorOnly: false,
      } });
      await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: {
        onboardingStatus: OnboardingStatus.pending_entry,
      } });
      return 'pending_entry';
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
    if (effectiveFrom > today) {
      await tx.user.update({ where: { id: request.userId }, data: {
        employeeNo: request.employeeNo,
        status: UserStatus.pending_entry, archivedAt: null, sysRole: SysRole.employee,
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
    if (input.positionId) {
      const position = await tx.position.findUnique({ where: { id: input.positionId }, select: { id: true, isActive: true } });
      if (!position?.isActive) throw new BadRequestException('岗位不存在或已停用');
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

  private normalizedEmployee(input: EmployeeReentryFieldsDto) {
    return {
      company: input.company, deptId: input.deptId ?? null, positionId: input.positionId ?? null,
      position: input.position?.trim() || null, managerId: input.rosterManagerId ?? null,
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
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  }

  private toView(request: any): OnboardingRequestView {
    return {
      id: request.id, userId: request.userId, employeeName: request.employeeName, employeeNo: request.employeeNo,
      intakeType: request.intakeType, onboardingStatus: request.onboardingStatus,
      requestVersion: request.requestVersion, recordStatus: request.recordStatus,
      proposedValue: this.record(request.proposedValue),
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
