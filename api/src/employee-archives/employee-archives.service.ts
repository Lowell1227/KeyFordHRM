import { normalizeContractSubject, validateContractSubject } from '@/contract-subjects/contract-subject-reference';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto';
import {
  AccountType,
  CompanyCode,
  EmploymentType,
  ExternalIdentityProvider,
  ExternalIdentityStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  CreateEmployeeDto,
  SaveEmployeeCreateDraftDto,
  SubmitEmployeeArchiveDraftDto,
} from './dto/employee-archive.dto';
import { approvedEmploymentSourceWhere, employmentWarnings, selectEmploymentAt, shanghaiBusinessDate } from './employment-timeline';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { lockTalentSource, resolveTalentSource, talentSourceSelect } from './employee-talent-source';
import { employeeArchiveView, employeeDataChangeView, activeApplicationWhere } from './employee-data-change-view';
import { archiveIssueStates } from './employee-archive-issues';
import {
  DIRECT_APPLY_PROFILE_FIELDS,
  DIRECT_APPLY_PROFILE_FIELD_LABELS,
  type DirectApplyProfileField,
} from './direct-apply-profile-fields';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { CURRENT_WORKER_STATUSES } from '@/common/personnel/current-worker';

export interface UpsertEmployeeProfileInput {
  phone?: string | null;
  gender?: string | null;
}

export interface CreateEmploymentRecordInput {
  contractSubjectId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  company: CompanyCode;
  deptId?: string | null;
  position?: string | null;
  positionId?: string | null;
  jobGrade?: string | null;
  jobFamily?: string | null;
  directManagerId?: string | null;
  workLocation?: string | null;
  employmentType: EmploymentType;
  employeeStatus: UserStatus;
  entryDate?: Date | null;
  plannedRegularDate?: Date | null;
  actualRegularDate?: Date | null;
  leaveDate?: Date | null;
  probationMonths?: number | null;
  changeType: string;
  reason?: string | null;
  sourceType?: string | null;
  sourceBatchId?: string | null;
}

export interface BindDingtalkIdentityInput {
  externalUserId?: string | null;
  externalUnionId: string;
}

const CONTRACT_IMAGE_MAX_COUNT = 5;
const CONTRACT_ATTACHMENT_MAX_COUNT = 10;
const CONTRACT_IMAGE_MAX_SIZE = 2 * 1024 * 1024;
const CONTRACT_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;
const CONTRACT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CONTRACT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const CONTRACT_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const CONTRACT_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx']);

@Injectable()
export class EmployeeArchivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config?: ConfigService,
    private readonly employeeNumbers?: EmployeeNumberService,
    private readonly identityMatcher?: EmployeeIdentityMatchService,
    private readonly onboarding?: EmployeeOnboardingService,
  ) {}

  async createEmployee(input: CreateEmployeeDto, operator: AuthUser) {
    const phone = (input.phone || input.profile?.phone)?.replace(/[\s-]/g, '').replace(/^\+86/, '');
    const idNumber = (input.idNumber || input.profile?.idNumber)?.trim().toUpperCase();
    if (phone && !/^1\d{10}$/.test(phone)) throw new BadRequestException('请填写完整的手机号，或清空后补充');
    if (idNumber && !/^(?:\d{15}|\d{17}[\dX])$/.test(idNumber)) throw new BadRequestException('请填写完整的身份证号，或清空后补充');
    const view = await this.withDraftTransaction(async (tx) => {
      const sourceDraft = input.draftId ? await tx.employeeDataChangeRequest.findFirst({
        where: { id: input.draftId, sourceType: 'manual_employee_create',
          OR: [{ recordStatus: 'draft' }, { profileReviewStatus: 'rejected' }], archivedAt: null },
        select: { id: true, proposedValue: true, requestVersion: true, userId: true, employeeNo: true,
          profileReviewStatus: true, recordStatus: true, revisionHistory: true, rejectedReason: true, updatedAt: true,
          sourceSystem: true, validationWarnings: true, talentCandidateId: true, requiresArrivalConfirmation: true },
      }) : null;
      if (sourceDraft?.sourceSystem === 'archive_assistant_pilot') throw new BadRequestException('测试资料仅可保存待核草稿');
      if (input.draftId) this.assertDraftVersion(sourceDraft, input.expectedVersion);
      const name = input.name.trim();
      const department = await tx.department.findUnique({
        where: { id: input.deptId },
        select: { id: true, isActive: true },
      });
      if (!department?.isActive) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '所属部门不存在或已停用' });
      }
      const position = input.positionId
        ? await tx.position.findUnique({
          where: { id: input.positionId },
          select: { id: true, name: true, jobFamily: true, isActive: true },
        })
        : null;
      if (input.positionId && !position) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '岗位不存在' });
      }
      const warnings: string[] = [];
      if (position && !position.isActive) warnings.push('所选岗位已停用');
      if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
        warnings.push('任职结束日期早于生效日期');
      }
      let proposedValue = this.employeeCreateProposedValue(input, position ? {
        id: position.id,
        name: position.name,
        jobFamily: position.jobFamily,
      } : null);
      let draftVersion: number | null = null;
      let savedDraft: Record<string, any> | null = null;
      if (input.draftId) {
        const draft = sourceDraft;
        if (!draft) {
          throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '草稿已提交或已归档，请刷新后重试' });
        }
        if (draft.userId || draft.profileReviewStatus === 'approved') throw new ConflictException('员工主档已经建立，请在原档案中继续维护');
        savedDraft = draft;
        proposedValue = this.preserveSensitiveProfile(proposedValue, draft.proposedValue);
        draftVersion = draft.requestVersion;
      }
      await this.normalizeSubjectPayload(tx, proposedValue, this.record(savedDraft?.proposedValue));
      const talentCandidateId = await resolveTalentSource(tx, input.talentCandidateId, savedDraft as any);
      await this.validateSubjectPayload(tx, proposedValue, {});
      await this.assertEmployeeCreateIdentity(
        tx,
        proposedValue,
        input.phoneDuplicateAcknowledged,
        input.draftId,
      );
      const performanceManagerId = this.nullableString(
        this.record(proposedValue.performance).managerId,
      );
      const requestData = {
          userId: null,
          employeeNo: null,
          employeeName: name,
          sourceType: 'manual_employee_create',
          intakeType: 'new_hire',
          onboardingStatus: 'submitted',
          requiresArrivalConfirmation: !(input.employeeStatus === UserStatus.resigned || (input.effectiveTo && input.effectiveTo < shanghaiBusinessDate()))
            && (savedDraft?.requiresArrivalConfirmation ?? true),
          talentCandidateId,
          baseValue: this.toJson({
            employee: {},
            profile: {},
            profileExists: false,
            contracts: [],
            performance: { managerId: null },
          }),
          proposedValue: this.toJson(proposedValue),
          profileReviewStatus: 'pending',
          performanceReviewStatus: performanceManagerId ? 'pending' : 'not_required',
          validationErrors: this.toJson([]),
          validationWarnings: this.toJson(this.sourceDraftWarnings(savedDraft, warnings)),
          createdById: operator.id,
          recordStatus: 'submitted',
          archivedAt: null,
          rejectedReason: null,
          profileReviewedAt: null,
          profileReviewedById: null,
          performanceReviewedAt: null,
          performanceReviewedById: null,
      } satisfies Prisma.EmployeeDataChangeRequestUncheckedCreateInput;
      let request;
      if (input.draftId && draftVersion !== null) {
        request = await this.updateEmployeeCreateDraft(tx, input.draftId, draftVersion, savedDraft!.updatedAt, {
          ...requestData,
          requestVersion: { increment: 1 },
          revisionHistory: this.revisionSnapshot(savedDraft!),
        });
      } else {
        request = await tx.employeeDataChangeRequest.create({ data: requestData });
      }
      if (!this.employeeNumbers) {
        throw new BadRequestException({ code: ERROR_CODE.INTERNAL, message: '员工工号服务未就绪' });
      }
      const employeeNo = savedDraft?.employeeNo ?? await this.employeeNumbers.reserveNext(tx, request.id);
      const proposed = requestData.proposedValue as unknown as Record<string, unknown>;
      const employee = proposed.employee as Record<string, unknown>;
      const updated = await tx.employeeDataChangeRequest.update({
        where: { id: request.id },
        data: {
          employeeNo,
          proposedValue: this.toJson({ ...proposed, employee: { ...employee, employeeNo } }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'submit_employee_create',
          entityType: 'employee_data_change_request',
          entityId: request.id,
          newValue: this.toJson({ employeeNo, name, effectiveFrom: input.effectiveFrom, warnings }),
        },
      });
      return employeeDataChangeView(updated);
    });
    return { ...view, reviewOutcome: 'pending' as const };
  }

  async saveEmployeeCreateDraft(input: SaveEmployeeCreateDraftDto, operator: AuthUser) {
    return this.withDraftTransaction(tx => this.saveEmployeeCreateDraftWithClient(tx, input, operator));
  }

  private async withDraftTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (['P2025', 'P2034'].includes(String(this.record(error).code))) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '资料已变化，请保留当前输入并重新打开最新草稿核对' });
      }
      throw error;
    }
  }

  private assertDraftVersion(draft: { requestVersion: number } | null, expectedVersion?: number): void {
    if (!draft || !Number.isInteger(expectedVersion) || expectedVersion !== draft.requestVersion) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '草稿已变化或已提交，请保留当前输入并重新打开最新草稿核对' });
    }
  }

  /** Internal trusted reception only; source metadata is never accepted by public draft DTOs. */
  async saveEmployeeCreateDraftWithClient(tx: Prisma.TransactionClient, input: SaveEmployeeCreateDraftDto, operator: AuthUser,
    source?: { sourceSystem: string; sourceReference: string; validationWarnings: Prisma.InputJsonValue[] }) {
    let employeeNo: string | null = null;
    const employeeName = input.name?.trim() || '未命名员工草稿';
    let proposed = this.employeeCreateProposedValue(input, null);
    proposed.draftMeta = {
      layoutVersion: input.draftLayoutVersion ?? 1,
      currentStep: input.draftStep ?? 0,
      completedSteps: [...new Set(input.completedSteps ?? [])].sort((a, b) => a - b),
    };
      let draftVersion: number | null = null;
      let savedDraft: Record<string, any> | null = null;
      if (input.draftId) {
        const draft = await tx.employeeDataChangeRequest.findFirst({
          where: {
            id: input.draftId,
            sourceType: 'manual_employee_create',
            OR: [{ recordStatus: 'draft' }, { profileReviewStatus: 'rejected' }],
            archivedAt: null,
          },
          select: { id: true, proposedValue: true, requestVersion: true, userId: true, employeeNo: true,
            profileReviewStatus: true, recordStatus: true, revisionHistory: true, rejectedReason: true, updatedAt: true,
            sourceSystem: true, validationWarnings: true, baseValue: true, talentCandidateId: true, requiresArrivalConfirmation: true },
        });
        if (!draft) {
          throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '草稿已提交或已归档，请刷新后重试' });
        }
        if (draft.userId || draft.profileReviewStatus === 'approved') throw new ConflictException('员工主档已经建立，请在原档案中继续维护');
        if (draft.sourceSystem === 'archive_assistant_pilot') {
          const owner = await tx.employeeDataChangeRequest.findUnique({ where: { id: draft.id }, select: { createdById: true } });
          if (owner?.createdById !== operator.id) throw new ConflictException('请由原接收人维护测试草稿');
        }
        this.assertDraftVersion(draft, input.expectedVersion);
        savedDraft = draft;
        employeeNo = draft.employeeNo ?? null;
        proposed = this.preserveSensitiveProfile(proposed, draft.proposedValue);
        draftVersion = draft.requestVersion;
      }
      await this.normalizeSubjectPayload(tx, proposed, this.record(savedDraft?.proposedValue));
      const talentCandidateId = await resolveTalentSource(tx, input.talentCandidateId, savedDraft as any);
      const proposedValue = this.toJson(proposed);
      const performanceManagerId = this.nullableString(
        this.record(proposed.performance).managerId,
      );
      const data = {
        userId: null,
        employeeNo,
        employeeName,
        sourceType: 'manual_employee_create',
        ...(source?.sourceSystem === 'archive_assistant_pilot' || savedDraft?.sourceSystem === 'archive_assistant_pilot' ? {} : {
          intakeType: 'new_hire' as const, onboardingStatus: 'draft' as const,
          requiresArrivalConfirmation: savedDraft?.requiresArrivalConfirmation ?? true,
        }),
        talentCandidateId,
        ...(savedDraft?.sourceSystem === 'archive_assistant_pilot' ? {} : {
          baseValue: this.toJson({ employee: {}, profile: {}, contracts: [], performance: { managerId: null } }),
        }),
        proposedValue,
        profileReviewStatus: 'pending',
        performanceReviewStatus: performanceManagerId ? 'pending' : 'not_required',
        validationErrors: this.toJson([]),
        validationWarnings: this.toJson(this.sourceDraftWarnings(savedDraft, source?.validationWarnings ?? [])),
        ...(source ? { sourceSystem: source.sourceSystem, sourceReference: source.sourceReference } : {}),
        createdById: operator.id,
        recordStatus: 'draft',
        archivedAt: null,
        rejectedReason: null,
      } satisfies Prisma.EmployeeDataChangeRequestUncheckedCreateInput;
      let request;
      if (input.draftId && draftVersion !== null) {
        request = await this.updateEmployeeCreateDraft(tx, input.draftId, draftVersion, savedDraft!.updatedAt, {
          ...data,
          requestVersion: { increment: 1 },
          revisionHistory: this.revisionSnapshot(savedDraft!),
        });
      } else {
        request = await tx.employeeDataChangeRequest.create({ data });
      }
      if (!input.draftId || input.saveMode !== 'auto') {
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: input.draftId ? 'save_employee_create_draft' : 'create_employee_create_draft',
            entityType: 'employee_data_change_request',
            entityId: request.id,
            newValue: this.toJson({ employeeNo, employeeName, currentStep: input.draftStep ?? 0 }),
          },
        });
      }
      return employeeDataChangeView(request);
  }

  private employeeCreateProposedValue(
    input: Partial<CreateEmployeeDto>,
    resolvedPosition: { id: string; name: string; jobFamily: string | null } | null,
  ): Record<string, unknown> {
    const phone = input.phone?.trim()
      .replace(/[\s-]/g, '')
      .replace(/^\+86/, '') || null;
    const inputEmployee = this.pickFields(this.record(input.employee), [
      'position', 'jobGrade', 'jobFamily', 'workLocation', 'probationMonths',
      'plannedRegularDate', 'actualRegularDate', 'leaveDate', 'contractSubjectId', 'companyText',
    ]);
    const employee: Record<string, unknown> = {
      ...inputEmployee,
      employeeNo: null,
      name: input.name?.trim() || null,
      phone,
      company: input.company ?? null,
      deptId: input.deptId ?? null,
      positionId: resolvedPosition?.id ?? input.positionId ?? null,
      position: resolvedPosition?.name ?? inputEmployee.position ?? null,
      jobFamily: resolvedPosition?.jobFamily ?? inputEmployee.jobFamily ?? null,
      jobGrade: inputEmployee.jobGrade ?? null,
      workLocation: inputEmployee.workLocation ?? null,
      probationMonths: inputEmployee.probationMonths ?? null,
      plannedRegularDate: inputEmployee.plannedRegularDate ?? null,
      actualRegularDate: inputEmployee.actualRegularDate ?? null,
      leaveDate: inputEmployee.leaveDate ?? null,
      managerId: input.rosterManagerId ?? null,
      entryDate: input.entryDate ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      employmentType: input.employmentType ?? null,
      employeeStatus: input.employeeStatus ?? null,
      changeType: 'hire',
    };
    const inputProfile = this.pickFields(this.record(input.profile), [
      'phone', 'gender', 'birthDate', 'ethnicity', 'education', 'professionalTitle', 'school',
      'graduationDate', 'major', 'maritalStatus', 'childrenStatus', 'childrenCount', 'politicalStatus',
      'nativePlace', 'householdType', 'idAddress', 'idNumber', 'currentAddress',
      'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
      'socialSecurityStatus', 'socialSecurityStartDate', 'housingFundStatus', 'housingFundStartDate',
      'bankName', 'bankBranch', 'bankAccount',
    ]);
    const profilePhone = this.nullableString(inputProfile.phone)
      ?.replace(/[\s-]/g, '')
      .replace(/^\+86/, '') ?? null;
    const profile: Record<string, unknown> = {
      ...inputProfile,
      phone: phone ?? profilePhone,
    };
    delete profile.idNumberEncrypted;
    delete profile.idNumberFingerprint;
    delete profile.bankAccountEncrypted;
    delete profile.bankAccountFingerprint;
    const idNumber = input.idNumber?.trim() || this.nullableString(profile.idNumber);
    if (idNumber) {
      const secured = this.encryptAndFingerprint(idNumber.toUpperCase());
      profile.idNumberEncrypted = secured.encrypted;
      profile.idNumberFingerprint = secured.fingerprint;
    }
    this.applySensitiveReplacement(profile, profile, 'bankAccount', 'bankAccountEncrypted', 'bankAccountFingerprint');
    delete profile.idNumber;
    delete profile.bankAccount;
    const contracts = (input.contracts ?? []).map((contract, index) => {
      const safeContract = this.pickFields(this.record(contract), [
        'contractType', 'name', 'signingCompany', 'contractSubjectId', 'signedAt', 'effectiveFrom', 'expiresAt',
        'termType', 'originalCompany', 'newCompany', 'confidentialityAgreement',
        'nonCompeteAgreement', 'portraitAgreement', 'sequence',
      ]);
      safeContract.images = this.contractMaterials(this.record(contract).images);
      safeContract.attachments = this.contractMaterials(this.record(contract).attachments);
      this.assertContractMaterials(safeContract);
      return {
        ...safeContract,
        sequence: typeof safeContract.sequence === 'number' ? safeContract.sequence : index,
      };
    });
    const inputPerformance = this.pickFields(this.record(input.performance), ['managerId']);
    const performance = {
      ...inputPerformance,
      managerId: input.performanceManagerId ?? inputPerformance.managerId ?? null,
    };
    return { employee, profile, contracts, performance };
  }

  private async normalizeSubjectPayload(
    tx: Prisma.TransactionClient, value: Record<string, unknown>, base: Record<string, unknown>, saved: Record<string, unknown> = {},
  ) {
    const employee = this.record(value.employee);
    const baseEmployee = this.record(base.employee);
    const savedEmployee = this.record(saved.employee);
    const previous = employee.contractSubjectId && employee.contractSubjectId === savedEmployee.contractSubjectId
      ? savedEmployee : baseEmployee;
    await normalizeContractSubject(tx, employee, previous, 'companyText');
    if (value.contracts === base.contracts) return;
    const baseContracts = Array.isArray(base.contracts) ? base.contracts.map((item) => this.record(item)) : [];
    const savedContracts = Array.isArray(saved.contracts) ? saved.contracts.map((item) => this.record(item)) : [];
    for (const [index, item] of (Array.isArray(value.contracts) ? value.contracts : []).entries()) {
      const contract = this.record(item);
      const old = contract.id ? baseContracts.find((c) => c.id === contract.id) : baseContracts.every((c) => !c.id) ? baseContracts[index] : undefined;
      const stored = contract.id ? savedContracts.find((c) => c.id === contract.id) : savedContracts[index];
      await normalizeContractSubject(tx, contract,
        contract.contractSubjectId && contract.contractSubjectId === stored?.contractSubjectId ? stored : old ?? {}, 'signingCompany');
    }
  }

  private async validateSubjectPayload(tx: Prisma.TransactionClient, value: Record<string, unknown>, base: Record<string, unknown>) {
    await validateContractSubject(tx, this.record(value.employee), this.record(base.employee));
    const contracts = Array.isArray(base.contracts) ? base.contracts.map((item) => this.record(item)) : [];
    for (const item of Array.isArray(value.contracts) ? value.contracts : []) {
      const contract = this.record(item);
      await validateContractSubject(tx, contract, contracts.find((c) => c.id && c.id === contract.id) ?? {});
    }
  }

  private preserveSensitiveProfile(
    proposed: Record<string, unknown>,
    previousValue: Prisma.JsonValue,
  ): Record<string, unknown> {
    const profile = { ...this.record(proposed.profile) };
    const previousProfile = this.record(this.record(previousValue).profile);
    for (const key of [
      'idNumberEncrypted',
      'idNumberFingerprint',
      'bankAccountEncrypted',
      'bankAccountFingerprint',
    ]) {
      if (profile[key] == null && previousProfile[key] != null) profile[key] = previousProfile[key];
    }
    // Source provenance is server-owned and must survive editing a collected draft.
    return { ...proposed, ...this.pickFields(this.record(previousValue), [
      'source', 'sourceFileHash', 'sourceEmployeeNo', 'identityCandidateUserId', 'sourceEvidenceEncrypted',
    ]), profile };
  }

  private sourceDraftWarnings(previous: Record<string, any> | null, next: unknown[]): unknown[] {
    if (!previous || !(previous.sourceSystem || this.record(previous.proposedValue).sourceFileHash) || !Array.isArray(previous.validationWarnings)) return next;
    const combined = [...previous.validationWarnings, ...next];
    return combined.filter((warning, index) => combined.findIndex(item => JSON.stringify(item) === JSON.stringify(warning)) === index);
  }

  private async assertEmployeeCreateIdentity(
    tx: Prisma.TransactionClient,
    proposedValue: Record<string, unknown>,
    phoneDuplicateAcknowledged = false,
    excludedRequestId?: string,
  ): Promise<void> {
    const employee = this.record(proposedValue.employee);
    const profile = this.record(proposedValue.profile);
    const phone = (this.nullableString(employee.phone) ?? this.nullableString(profile.phone))
      ?.replace(/[\s-]/g, '')
      .replace(/^\+86/, '') ?? null;
    const idNumberFingerprint = this.nullableString(profile.idNumberFingerprint)?.toLowerCase() ?? null;
    if (!phone && !idNumberFingerprint) return;

    await this.lockEmployeeCreateIdentities(tx, phone, idNumberFingerprint);

    if (this.identityMatcher) {
      const identity = await this.identityMatcher.lookupStoredIdentity({
        phone: phone ?? undefined,
        idNumberFingerprint: idNumberFingerprint ?? undefined,
        excludeRequestId: excludedRequestId,
      });
      if (identity.outcome === 'identity_match' || identity.outcome === 'conflict') {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '发现已存在员工，请进入原档案处理再入职或资料维护' });
      }
      if (identity.outcome === 'phone_candidates' && !phoneDuplicateAcknowledged) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该手机号与已有员工相同，请确认不是同一人后再继续' });
      }
    }

    const pendingBaseWhere: Prisma.EmployeeDataChangeRequestWhereInput = {
      ...(excludedRequestId ? { id: { not: excludedRequestId } } : {}),
      sourceType: 'manual_employee_create',
      recordStatus: 'submitted',
      archivedAt: null,
      cancelledAt: null,
    };
    if (idNumberFingerprint && await tx.employeeDataChangeRequest.findFirst({
      where: {
        ...pendingBaseWhere,
        proposedValue: { path: ['profile', 'idNumberFingerprint'], equals: idNumberFingerprint },
      },
      select: { id: true },
    })) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '相同身份证号已有待审核的新增员工申请，请先处理该申请' });
    }
    if (phone && !phoneDuplicateAcknowledged && await tx.employeeDataChangeRequest.findFirst({
      where: {
        ...pendingBaseWhere,
        OR: [
          { proposedValue: { path: ['employee', 'phone'], equals: phone } },
          { proposedValue: { path: ['profile', 'phone'], equals: phone } },
        ],
      },
      select: { id: true },
    })) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该手机号与已有员工相同，请确认不是同一人后再继续' });
    }
  }

  private async lockEmployeeCreateIdentities(
    tx: Prisma.TransactionClient,
    phone: string | null,
    idNumberFingerprint: string | null,
  ): Promise<void> {
    const keys = [
      ...(phone ? [`employee-create:phone:${phone}`] : []),
      ...(idNumberFingerprint ? [`employee-create:id:${idNumberFingerprint}`] : []),
    ].sort();
    for (const key of keys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
  }

  private async updateEmployeeCreateDraft(
    tx: Prisma.TransactionClient,
    draftId: string,
    requestVersion: number,
    updatedAt: Date,
    data: Prisma.EmployeeDataChangeRequestUncheckedUpdateInput,
  ) {
    try {
      return await tx.employeeDataChangeRequest.update({
        where: {
          id: draftId,
          sourceType: 'manual_employee_create',
          OR: [{ recordStatus: 'draft' }, { profileReviewStatus: 'rejected' }],
          archivedAt: null,
          requestVersion,
          updatedAt,
        },
        data,
      });
    } catch (error) {
      if (this.record(error).code === 'P2025') {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '草稿已变化或已提交，请刷新后重试' });
      }
      throw error;
    }
  }

  private pickFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]]));
  }

  private revisionSnapshot(request: Record<string, any>): Prisma.InputJsonValue {
    const history = Array.isArray(request.revisionHistory) ? request.revisionHistory : [];
    // Autosave updates a working draft; submitted/returned versions remain in history.
    if (request.recordStatus === 'draft' && !request.rejectedReason) return this.toJson(history);
    return this.toJson([...history, {
      version: request.requestVersion, proposedValue: request.proposedValue,
      profileReviewStatus: request.profileReviewStatus, performanceReviewStatus: request.performanceReviewStatus,
      rejectedReason: request.rejectedReason, profileReviewedAt: request.profileReviewedAt,
      performanceReviewedAt: request.performanceReviewedAt, updatedAt: request.updatedAt,
    }]);
  }

  private contractMaterials(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => this.pickFields(this.record(item), ['name', 'url', 'size', 'mimeType']));
  }

  async listDrafts(query: { page: number; pageSize: number }, operator?: AuthUser) {
    const where: Prisma.EmployeeDataChangeRequestWhereInput = {
      recordStatus: 'draft',
      archivedAt: null,
      OR: [{ sourceSystem: null }, { sourceSystem: { not: 'archive_assistant_pilot' } },
        ...(operator ? [{ sourceSystem: 'archive_assistant_pilot', createdById: operator.id }] : [])],
    };
    const [items, total] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findMany({
        where,
        include: { createdBy: { select: { id: true, name: true, sysRole: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.employeeDataChangeRequest.count({ where }),
    ]);
    const canReadIssues = operator && (hasHrCapability(operator, 'employee_archive_edit') || hasHrCapability(operator, 'employee_archive_review'));
    const issueUsers = canReadIssues ? [...new Set(items.filter(item => item.userId && Array.isArray(item.validationWarnings) && item.validationWarnings.length).map(item => item.userId!))] : [];
    const facts = issueUsers.length ? await this.prisma.user.findMany({ where: { id: { in: issueUsers }, deletedAt: null },
      select: { id: true, name: true, employeeNo: true, phone: true, status: true, deptId: true, position: true, entryDate: true, employmentType: true,
        employeeProfile: true, employeeContracts: true,
        employmentHistory: { where: approvedEmploymentSourceWhere, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] } },
    }) : [];
    const factsByUser = new Map(facts.map(user => [user.id, user] as const));
    return {
      items: items.map((item) => employeeDataChangeView({ ...item,
        ...(canReadIssues ? { archiveIssueCount: item.userId && !factsByUser.has(item.userId) ? 0 : archiveIssueStates(item, factsByUser.get(item.userId!) ?? null).length } : {}),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async archiveEmployees(userIds: string[], operator: AuthUser): Promise<{ archived: number }> {
    const ids = [...new Set(userIds)];
    return this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, status: true, archivedAt: true },
      });
      if (users.length !== ids.length) {
        throw new BadRequestException({ code: ERROR_CODE.NOT_FOUND, message: '部分员工不存在，请刷新后重试' });
      }
      const ineligible = users.filter((user) => user.status !== UserStatus.resigned || user.archivedAt);
      if (ineligible.length > 0) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `只能归档已离职员工：${ineligible.map((user) => user.name).join('、')}`,
        });
      }
      const pendingReviews = await tx.employeeDataChangeRequest.findMany({
        where: {
          userId: { in: ids },
          recordStatus: 'submitted',
          archivedAt: null,
          OR: [
            { profileReviewStatus: { in: ['pending', 'applying'] } },
            { performanceReviewStatus: { in: ['pending', 'applying'] } },
          ],
        },
        select: { userId: true, employeeName: true },
      });
      if (pendingReviews.length > 0) {
        const names = [...new Set(pendingReviews.map((item) => item.employeeName).filter(Boolean))].join('、');
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: `${names || '所选员工'}还有待审核变更，请先处理后再归档`,
        });
      }
      const archivedAt = new Date();
      const result = await tx.user.updateMany({
        where: { id: { in: ids }, archivedAt: null },
        data: { archivedAt },
      });
      for (const user of users) {
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: 'archive_resigned_employee',
            entityType: 'user',
            entityId: user.id,
            newValue: this.toJson({ archivedAt, status: user.status }),
          },
        });
      }
      return { archived: result.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async archiveDrafts(requestIds: string[], operator: AuthUser): Promise<{ archived: number }> {
    const ids = [...new Set(requestIds)];
    return this.prisma.$transaction(async (tx) => {
      const drafts = await tx.employeeDataChangeRequest.findMany({
        where: { id: { in: ids }, recordStatus: 'draft', archivedAt: null },
        select: { id: true, employeeName: true, sourceSystem: true, createdById: true, talentCandidateId: true },
      });
      if (drafts.some(draft => draft.sourceSystem === 'archive_assistant_pilot' && draft.createdById !== operator.id)) {
        throw new NotFoundException('草稿不存在');
      }
      if (drafts.length !== ids.length) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '部分草稿已提交或已归档，请刷新后重试' });
      }
      for (const candidateId of [...new Set(drafts.map(draft => draft.talentCandidateId).filter(Boolean))].sort()) {
        await lockTalentSource(tx, candidateId);
      }
      const archivedAt = new Date();
      const result = await tx.employeeDataChangeRequest.updateMany({
        where: { id: { in: ids }, recordStatus: 'draft', archivedAt: null },
        data: { recordStatus: 'archived', archivedAt },
      });
      for (const draft of drafts) {
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: 'archive_employee_draft',
            entityType: 'employee_data_change_request',
            entityId: draft.id,
            newValue: this.toJson({ archivedAt, employeeName: draft.employeeName }),
          },
        });
      }
      return { archived: result.count };
    });
  }

  async batchArchive(ids: string[], operator: AuthUser, kind: 'employee' | 'draft') {
    const succeeded: Array<{ id: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of new Set(ids)) {
      try {
        if (kind === 'employee') await this.archiveEmployees([id], operator);
        else await this.archiveDrafts([id], operator);
        succeeded.push({ id });
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : '归档失败，请刷新后重试' });
      }
    }
    return { archived: succeeded.length, succeeded, failed };
  }

  async restoreRecords(ids: string[], operator: AuthUser, kind: 'employee' | 'draft') {
    const succeeded: Array<{ id: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of new Set(ids)) {
      try {
        await this.prisma.$transaction(async (tx) => {
          if (kind === 'draft') {
            const draft = await tx.employeeDataChangeRequest.findUnique({ where: { id }, select: { id: true, sourceSystem: true, createdById: true, talentCandidateId: true } });
            if (draft?.talentCandidateId) await resolveTalentSource(tx, undefined, draft);
            if (draft?.sourceSystem === 'archive_assistant_pilot') {
              if (draft.createdById !== operator.id) throw new NotFoundException('草稿不存在');
              throw new ConflictException('测试草稿请从机器人重新发起');
            }
          }
          const result = kind === 'employee'
            ? await tx.user.updateMany({ where: { id, deletedAt: null, archivedAt: { not: null } }, data: { archivedAt: null } })
            : await tx.employeeDataChangeRequest.updateMany({
              where: { id, recordStatus: 'archived', archivedAt: { not: null } },
              data: { archivedAt: null, recordStatus: 'draft' },
            });
          if (!result.count) throw new ConflictException('记录已变化或不在归档中，请刷新后重试');
          await tx.auditLog.create({ data: { userId: operator.id,
            action: kind === 'employee' ? 'restore_employee_archive' : 'restore_employee_draft',
            entityType: kind === 'employee' ? 'user' : 'employee_data_change_request', entityId: id,
            newValue: { archivedAt: null },
          } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        succeeded.push({ id });
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : '取消归档失败，请刷新后重试' });
      }
    }
    return { restored: succeeded.length, succeeded, failed };
  }

  async listApplications(query: { page: number; pageSize: number; keyword?: string; departmentId?: string }) {
    const where: Prisma.EmployeeDataChangeRequestWhereInput = {
      ...activeApplicationWhere(),
      AND: [
        { OR: [{ userId: null }, { user: { deletedAt: null } }] },
        ...(query.keyword ? [{ OR: [
          { employeeName: { contains: query.keyword, mode: 'insensitive' as const } },
          { employeeNo: { contains: query.keyword, mode: 'insensitive' as const } },
        ] }] : []),
        ...(query.departmentId ? [{ OR: [
          { user: { deptId: query.departmentId } },
          { proposedValue: { path: ['employee', 'deptId'], equals: query.departmentId } },
        ] }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findMany({ where,
        include: { talentCandidate: { select: talentSourceSelect }, createdBy: { select: { id: true, name: true, sysRole: true } },
          user: { select: { id: true, name: true, employeeNo: true, status: true, archivedAt: true, position: true, dept: { select: { id: true, name: true } } } } },
        orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      }), this.prisma.employeeDataChangeRequest.count({ where }),
    ]);
    return { items: items.map((item) => ({ ...employeeDataChangeView(item), canResume: this.canResumeApplication(item) })),
      total, page: query.page, pageSize: query.pageSize };
  }

  async cancelApplication(id: string, reason: string, operator: AuthUser) {
    const request = await this.prisma.employeeDataChangeRequest.findUnique({ where: { id } });
    if (!request || request.archivedAt) throw new NotFoundException('申请不存在或已归档');
    if (request.sourceSystem === 'archive_assistant_pilot' && request.createdById !== operator.id) throw new NotFoundException('申请不存在');
    if (request.intakeType && request.onboardingStatus !== 'effective') {
      if (!this.onboarding) throw new BadRequestException('入职服务未就绪');
      return this.onboarding.cancelReentry(id, { reason }, operator.id);
    }
    return this.prisma.$transaction(async (tx) => {
      await lockTalentSource(tx, request.talentCandidateId);
      if (request.sourceSystem === 'archive_assistant_pilot') {
        const current = await tx.employeeDataChangeRequest.findUnique({ where: { id }, select: { createdById: true } });
        if (current?.createdById !== operator.id) throw new NotFoundException('申请不存在');
      }
      const scheduled = request.sourceType === 'manual_employment_change'
        && request.profileReviewStatus === 'approved' && !request.appliedAt
        ? await tx.employmentRecord.findFirst({ where: { sourceRequestId: id, effectiveFrom: { gt: shanghaiBusinessDate() } } }) : null;
      if (scheduled) {
        const delta = await tx.auditLog.findFirst({ where: { entityType: 'employee_data_change_request', entityId: id,
          action: 'schedule_employment_interval' }, orderBy: { createdAt: 'desc' } });
        if (delta) {
          const before = this.record(delta.oldValue);
          const after = this.record(delta.newValue);
          const restored = await tx.employmentRecord.updateMany({
            where: { id: String(before.employmentId), userId: scheduled.userId, effectiveTo: new Date(String(after.effectiveTo)) },
            data: { effectiveTo: before.effectiveTo ? new Date(String(before.effectiveTo)) : null },
          });
          if (restored.count !== 1) throw new ConflictException('此前任职已发生其他变更，请先核对任职记录再撤回');
        } else if (scheduled.changeType === 'resignation') {
          throw new ConflictException('这条历史离职申请缺少撤回快照，请核对原任职结束日期后再处理');
        }
        await tx.employmentRecord.deleteMany({ where: { id: scheduled.id, sourceRequestId: id, effectiveFrom: { gt: shanghaiBusinessDate() } } });
        const updated = await tx.employeeDataChangeRequest.update({
          where: { id, requestVersion: request.requestVersion, updatedAt: request.updatedAt, appliedAt: null },
          data: { profileReviewStatus: 'cancelled', performanceReviewStatus: request.performanceReviewStatus === 'approved' ? 'approved' : 'cancelled',
            cancelledAt: new Date(), cancelledById: operator.id, cancelledReason: reason, requestVersion: { increment: 1 } },
        });
        await tx.auditLog.create({ data: { userId: operator.id, action: 'cancel_employee_change',
          entityType: 'employee_data_change_request', entityId: id, newValue: { reason, scheduledEmploymentId: scheduled.id } } });
        return employeeDataChangeView(updated);
      }
      const scopes = ['profile', 'performance'].filter((scope) =>
        ['pending', 'rejected'].includes(scope === 'profile' ? request.profileReviewStatus : request.performanceReviewStatus));
      if (!scopes.length) throw new ConflictException('申请已处理，已生效内容不能撤回');
      const partial = request.profileReviewStatus === 'approved' || request.performanceReviewStatus === 'approved';
      const updated = await tx.employeeDataChangeRequest.update({
        where: { id, requestVersion: request.requestVersion, updatedAt: request.updatedAt },
        data: { ...(scopes.includes('profile') ? { profileReviewStatus: 'cancelled' } : {}),
          ...(scopes.includes('performance') ? { performanceReviewStatus: 'cancelled' } : {}),
          ...(partial ? {} : { cancelledAt: new Date(), cancelledById: operator.id, cancelledReason: reason }),
          requestVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({ data: { userId: operator.id, action: 'cancel_employee_change',
        entityType: 'employee_data_change_request', entityId: id, newValue: { scopes, reason, partial },
      } });
      return employeeDataChangeView(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getApplication(id: string, operator?: AuthUser) {
    const [request, events] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findUnique({ where: { id },
        include: { talentCandidate: { select: talentSourceSelect }, createdBy: { select: { id: true, name: true, sysRole: true } },
          profileReviewedBy: { select: { id: true, name: true } }, performanceReviewedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'employee_data_change_request', entityId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, entityId: true, action: true, createdAt: true,
          user: { select: { id: true, name: true } }, oldValue: true, newValue: true },
      }),
    ]);
    if (!request) throw new NotFoundException('申请不存在');
    if (request.sourceSystem === 'archive_assistant_pilot' && request.createdById !== operator?.id) throw new NotFoundException('申请不存在');
    const [enriched] = await this.enrichChangeNames([request]);
    return { ...employeeDataChangeView(enriched), events: employeeDataChangeView(events), canResume: this.canResumeApplication(request),
      canCancel: !request.cancelledAt && (request.profileReviewStatus === 'pending' || request.performanceReviewStatus === 'pending'
        || request.profileReviewStatus === 'rejected' || request.performanceReviewStatus === 'rejected'
        || request.onboardingStatus === 'pending_entry' || (request.sourceType === 'manual_employment_change'
          && request.profileReviewStatus === 'approved' && !request.appliedAt)) };
  }

  private canResumeApplication(request: { recordStatus: string; archivedAt: Date | null; profileReviewStatus: string; performanceReviewStatus: string }) {
    return !request.archivedAt && (request.recordStatus === 'draft'
      || request.profileReviewStatus === 'rejected' || request.performanceReviewStatus === 'rejected');
  }

  async history(userId: string) {
    const requests = await this.prisma.employeeDataChangeRequest.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } },
        profileReviewedBy: { select: { id: true, name: true } }, performanceReviewedBy: { select: { id: true, name: true } } },
    });
    const events = await this.prisma.auditLog.findMany({
      where: { OR: [
        { entityType: 'employee_data_change_request', entityId: { in: requests.map((request) => request.id) } },
        { entityType: 'user', entityId: userId, action: { in: ['archive_resigned_employee', 'restore_employee_archive'] } },
      ] }, orderBy: { createdAt: 'asc' },
      select: { id: true, entityId: true, action: true, createdAt: true, user: { select: { id: true, name: true } }, oldValue: true, newValue: true },
    });
    const enriched = await this.enrichChangeNames(requests);
    return employeeArchiveView({
      changeHistory: enriched.map((request) => ({ ...request, events: events.filter((event) => event.entityId === request.id) })),
      archiveEvents: events.filter((event) => event.entityId === userId),
    });
  }

  private async enrichChangeNames<T extends { baseValue: unknown; proposedValue: unknown }>(requests: T[]): Promise<T[]> {
    const userIds = new Set<string>();
    const departmentIds = new Set<string>();
    for (const request of requests) for (const value of [request.baseValue, request.proposedValue]) {
      const snapshot = this.record(value);
      const employee = this.record(snapshot.employee);
      const managerId = this.nullableString(this.record(snapshot.performance).managerId);
      if (managerId) userIds.add(managerId);
      if (typeof employee.managerId === 'string') userIds.add(employee.managerId);
      if (typeof employee.deptId === 'string') departmentIds.add(employee.deptId);
    }
    const [users, departments] = await Promise.all([
      userIds.size ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [],
      departmentIds.size ? this.prisma.department.findMany({ where: { id: { in: [...departmentIds] } }, select: { id: true, name: true } }) : [],
    ]);
    const userNames = new Map<string, string>(users.map((user) => [user.id, user.name] as const));
    const departmentNames = new Map<string, string>(departments.map((department) => [department.id, department.name] as const));
    const enrich = (value: unknown) => {
      const snapshot = this.record(value);
      const employee = this.record(snapshot.employee);
      const performance = this.record(snapshot.performance);
      return { ...snapshot, employee: { ...employee,
        departmentName: employee.departmentName ?? departmentNames.get(String(employee.deptId)) ?? null,
        managerName: employee.managerName ?? userNames.get(String(employee.managerId)) ?? null },
        performance: { ...performance, managerName: performance.managerName ?? userNames.get(String(performance.managerId)) ?? null } };
    };
    return requests.map((request) => ({ ...request, baseValue: enrich(request.baseValue), proposedValue: enrich(request.proposedValue) }));
  }

  async findOne(userId: string) {
    const archive = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, name: true, employeeNo: true, status: true, position: true, positionId: true,
        phone: true, email: true, avatarUrl: true, deptId: true, entryDate: true,
        plannedRegularDate: true, actualRegularDate: true, leaveDate: true,
        employmentType: true, sysRole: true, hrCapabilities: true, archivedAt: true, directManagerId: true,
        createdAt: true, updatedAt: true,
        employeeNumberAssignments: { orderBy: { createdAt: 'desc' } },
        dept: { select: { id: true, name: true, fullPath: true, company: true } },
        directManager: { select: { id: true, name: true, employeeNo: true } },
        employeeProfile: {
          select: {
            id: true,
            userId: true,
            phone: true,
            gender: true,
            birthDate: true,
            ethnicity: true,
            education: true,
            professionalTitle: true,
            school: true,
            graduationDate: true,
            major: true,
            maritalStatus: true,
            childrenStatus: true,
            childrenCount: true,
            politicalStatus: true,
            nativePlace: true,
            householdType: true,
            idAddress: true,
            idNumberFingerprint: true,
            currentAddress: true,
            emergencyContactName: true,
            emergencyContactRelation: true,
            emergencyContactPhone: true,
            socialSecurityStatus: true,
            socialSecurityStartDate: true,
            housingFundStatus: true,
            housingFundStartDate: true,
            bankName: true,
            bankBranch: true,
            bankAccountFingerprint: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        employmentHistory: {
          where: approvedEmploymentSourceWhere,
          orderBy: { effectiveFrom: 'desc' },
          include: {
            dept: { select: { id: true, name: true, fullPath: true } },
            directManager: { select: { id: true, name: true, employeeNo: true } },
          },
        },
        externalIdentityBindings: {
          where: { provider: ExternalIdentityProvider.dingtalk, endedAt: null },
          select: {
            id: true,
            provider: true,
            status: true,
            externalUserId: true,
            boundAt: true,
            disabledAt: true,
            disabledReason: true,
            lastLoginAt: true,
          },
          take: 1,
        },
        employeeContracts: {
          orderBy: [{ signedAt: 'desc' }, { sequence: 'desc' }],
        },
      },
    });
    if (!archive) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }
    const latestResignationReview = await this.prisma.employeeDataChangeRequest.findFirst({
      where: {
        userId,
        sourceType: 'manual_employment_change',
        recordStatus: 'submitted',
        archivedAt: null,
        proposedValue: { path: ['employee', 'changeType'], equals: 'resignation' },
      },
      include: {
        createdBy: { select: { id: true, name: true, sysRole: true } },
        profileReviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const [dingtalkBinding] = archive.externalIdentityBindings;
    const now = shanghaiBusinessDate();
    const employmentSelection = selectEmploymentAt(archive.employmentHistory, now);
    const currentEmployment = employmentSelection.current;
    return employeeArchiveView({
      ...archive,
      archiveVersion: this.archiveVersion(archive),
      employeeProfile: archive.employeeProfile ? {
        ...archive.employeeProfile,
        idNumberConfigured: Boolean(archive.employeeProfile.idNumberFingerprint),
        bankAccountConfigured: Boolean(archive.employeeProfile.bankAccountFingerprint),
        idNumberFingerprint: undefined,
        bankAccountFingerprint: undefined,
      } : null,
      currentEmployment,
      employmentWarnings: employmentSelection.warnings,
      performanceManager: archive.directManager,
      rosterManager: currentEmployment?.directManager ?? null,
      directManager: undefined,
      dingtalkBindingState: !dingtalkBinding ? 'unbound' : dingtalkBinding.status,
      dingtalkBinding: dingtalkBinding ?? null,
      latestResignationReview,
      externalIdentityBindings: undefined,
    });
  }

  async upsertProfile(userId: string, input: UpsertEmployeeProfileInput, operator: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        employeeProfile: true,
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '员工不存在',
      });
    }
    this.assertEmployeeEditable(user);

    const currentEmployment = user.employmentHistory[0] ?? null;
    const currentProfile = this.profileReviewData(user.employeeProfile);
    const proposedProfile = {
      ...currentProfile,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
    };
    const employee = this.employeeReviewData(user, currentEmployment, input.phone);
    if (this.sameReviewRecord(this.employeeReviewData(user, currentEmployment), employee)
      && this.sameReviewRecord(currentProfile, proposedProfile)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '未检测到实际变更，无需提交审核',
      });
    }
    const pending = await this.prisma.employeeDataChangeRequest.findFirst({
      where: {
        userId,
        sourceType: 'manual_profile_change',
        recordStatus: 'submitted',
        archivedAt: null,
        profileReviewStatus: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = {
      baseValue: this.toJson({
        employee: this.employeeReviewData(user, currentEmployment),
        profile: currentProfile,
        profileExists: user.employeeProfile !== null,
        performance: { managerId: user.directManagerId },
      }),
      proposedValue: this.toJson({
        employee,
        profile: proposedProfile,
        contracts: [],
        performance: { managerId: user.directManagerId },
      }),
      validationErrors: this.toJson([]),
      createdById: operator.id,
      rejectedReason: null,
    };
    if (pending) {
      return employeeDataChangeView(await this.prisma.employeeDataChangeRequest.update({
        where: { id: pending.id },
        data,
      }));
    }
    return employeeDataChangeView(await this.prisma.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_profile_change',
        ...data,
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
      },
    }));
  }

  async submitDraft(userId: string, input: SubmitEmployeeArchiveDraftDto, operator: AuthUser) {
    const persisted = await this.withDraftTransaction(tx => this.persistArchiveChangeWithClient(tx, userId, input, operator, 'submitted'));
    const reviewOutcome = persisted.request ? 'pending' as const : 'not_required' as const;
    return { ...persisted, reviewOutcome };
  }

  async saveArchiveDraft(userId: string, input: SubmitEmployeeArchiveDraftDto, operator: AuthUser) {
    return this.withDraftTransaction(async tx => {
      const { request } = await this.persistArchiveChangeWithClient(tx, userId, input, operator, 'draft');
      if (!request) {
        // 自动保存可能携带与当前档案归一化后完全一致的值（如清空操作把 null 写成 ''），
        // 此时视为幂等成功的空保存，不产生草稿、不记审计，由前端保持当前编辑状态。
        return null;
      }
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'save_employee_archive_draft',
          entityType: 'employee_data_change_request',
          entityId: request.id,
          newValue: this.toJson({ userId }),
        },
      });
      return request;
    });
  }

  private async persistArchiveChangeWithClient(
    client: Pick<Prisma.TransactionClient, 'user' | 'employeeDataChangeRequest' | 'employeeProfile' | 'auditLog'>
      & Partial<Pick<Prisma.TransactionClient, 'contractSubject'>>,
    userId: string,
    input: SubmitEmployeeArchiveDraftDto,
    operator: AuthUser,
    recordStatus: 'draft' | 'submitted',
    requireBaseVersion = true,
  ): Promise<{ request: ReturnType<typeof employeeDataChangeView> | null; directApplied: string[] }> {
    if (input.employee.companyText != null && (typeof input.employee.companyText !== 'string'
      || input.employee.companyText.length > 150)) {
      throw new BadRequestException('所属公司须为不超过150字的文字');
    }
    const user = await client.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        employeeProfile: true,
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          include: { directManager: { select: { name: true } } },
        },
        employeeContracts: { where: { isActive: true }, orderBy: { sequence: 'asc' } },
      },
    });
    if (!user) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }
    this.assertEmployeeEditable(user);

    const existing = await client.employeeDataChangeRequest.findFirst({
      where: input.draftId
        ? {
          id: input.draftId,
          userId,
          sourceType: 'manual_archive_change',
          OR: [{ recordStatus: 'draft' }, { profileReviewStatus: 'rejected' }, { performanceReviewStatus: 'rejected' }],
          archivedAt: null,
        }
        : {
          userId,
          sourceType: 'manual_archive_change',
          recordStatus: { in: ['draft', 'submitted'] },
          archivedAt: null,
          OR: [
            { recordStatus: 'draft' },
            { profileReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
            { performanceReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
          ],
        },
      orderBy: { createdAt: 'desc' },
    });
    if (input.draftId) {
      this.assertDraftVersion(existing, input.expectedVersion);
    } else if (existing) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '员工已有待核草稿或待审申请，请打开原单继续维护' });
    }
    if (!input.draftId && requireBaseVersion && input.baseVersion !== this.archiveVersion(user)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '正式档案已发生变化，请保留当前输入并重新核对最新档案' });
    }

    // 免审个人信息字段（如手机号、学历、紧急联系人）在提交时直接写入正式数据并记审计日志，
    // 不进入审核队列；直改后内存中的正式档案同步更新，后续 diff 自然只覆盖需审核字段。
    const directApplied: string[] = [];
    const directChanges: Record<string, unknown> = {};
    const employment = user.employmentHistory[0] ?? null;
    let baseEmployee = this.employeeReviewData(user, employment);
    let baseProfile = this.profileReviewData(user.employeeProfile);
    const baseContracts = user.employeeContracts.map((contract) => this.contractReviewData(contract));
    const profileApproved = existing?.profileReviewStatus === 'approved';
    const performanceApproved = existing?.performanceReviewStatus === 'approved';
    const savedProposal = this.record(existing?.proposedValue);
    const savedBase = this.record(existing?.baseValue);
    const originalContracts = Array.isArray(savedBase.contracts) ? savedBase.contracts.map(item => this.record(item)) : [];
    if (existing) {
      const profileBase = profileApproved ? savedProposal : savedBase;
      const savedEmployee = profileApproved
        ? await this.appliedEmployeeReviewData(client as Prisma.TransactionClient, this.record(profileBase.employee), this.record(savedBase.employee), this.record(savedProposal.performance))
        : this.record(profileBase.employee);
      const savedProfile = profileApproved ? this.appliedProfileReviewData(this.record(profileBase.profile)) : this.record(profileBase.profile);
      const profileKeys = [...new Set([...Object.keys(savedProfile), ...Object.keys(baseProfile)])]
        .filter(key => !['idNumberEncrypted', 'bankAccountEncrypted'].includes(key));
      const savedPerformance = { ...this.record((performanceApproved ? savedProposal : savedBase).performance) };
      if (performanceApproved) savedPerformance.managerId = await this.appliedPerformanceManagerId(client as Prisma.TransactionClient, savedPerformance);
      const profileExists = profileApproved && typeof savedBase.profileExists === 'boolean'
        ? savedBase.profileExists || Object.keys(savedProfile).length > 0 : savedBase.profileExists;
      if (!this.sameReviewRecord(savedEmployee, baseEmployee, Object.keys(savedEmployee).filter(key => key in baseEmployee))
        || ('profile' in profileBase && !this.sameReviewRecord(savedProfile, baseProfile, profileKeys))
        || (typeof profileExists === 'boolean' && profileExists !== (user.employeeProfile !== null))
        || (Array.isArray(profileBase.contracts) && !(profileApproved
          ? this.sameAppliedContractSet(profileBase.contracts.map(item => this.record(item)), baseContracts, originalContracts)
          : this.sameContractSet(profileBase.contracts.map(item => this.record(item)), baseContracts)))
        || !this.sameReviewRecord(savedPerformance, { managerId: user.directManagerId }, Object.keys(savedPerformance).filter(key => key === 'managerId'))) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '正式档案已发生变化，请保留当前输入并重新核对最新档案' });
      }
    }
    // Check the untouched formal baseline before applying this submission's direct changes.
    if (recordStatus === 'submitted') {
      await this.applyDirectProfileChanges(client, user, input, operator, directApplied, directChanges);
      baseEmployee = this.employeeReviewData(user, employment);
      baseProfile = this.profileReviewData(user.employeeProfile);
    }
    const proposedEmployee: Record<string, unknown> = {
      ...baseEmployee,
      ...input.employee,
      // 工号由入职/再入职流程生成，档案编辑不得改写当前或历史工号。
      employeeNo: baseEmployee.employeeNo,
    };
    if (user.status === UserStatus.resigned && proposedEmployee.employeeStatus !== UserStatus.resigned) {
      throw new ConflictException('已离职员工请通过“办理再入职”生成新工号，不能直接修改为在职');
    }
    const safeInputProfile = { ...input.profile };
    for (const key of ['idNumberEncrypted', 'idNumberFingerprint', 'bankAccountEncrypted', 'bankAccountFingerprint',
      'idNumberConfigured', 'bankAccountConfigured']) delete safeInputProfile[key];
    const storedProfile = this.record(savedProposal.profile);
    const proposedProfile: Record<string, unknown> = { ...baseProfile, ...safeInputProfile };
    for (const key of ['idNumberEncrypted', 'idNumberFingerprint', 'bankAccountEncrypted', 'bankAccountFingerprint']) {
      if (storedProfile[key] != null) proposedProfile[key] = storedProfile[key];
    }
    this.applySensitiveReplacement(proposedProfile, input.profile, 'idNumber', 'idNumberEncrypted', 'idNumberFingerprint');
    this.applySensitiveReplacement(proposedProfile, input.profile, 'bankAccount', 'bankAccountEncrypted', 'bankAccountFingerprint');
    delete proposedProfile.idNumber;
    delete proposedProfile.bankAccount;
    const proposedContracts = input.contracts?.map((contract, index) => {
      this.assertContractMaterials(contract);
      return {
        ...contract,
        sequence: typeof contract.sequence === 'number' ? contract.sequence : index,
      };
    }) ?? baseContracts;
    if (input.employee.contractSubjectId === undefined) delete proposedEmployee.contractSubjectId;
    await this.normalizeSubjectPayload(client as Prisma.TransactionClient, { employee: proposedEmployee, contracts: proposedContracts },
      { employee: baseEmployee, contracts: baseContracts }, this.record(existing?.proposedValue));
    if (recordStatus === 'submitted') await this.validateSubjectPayload(client as Prisma.TransactionClient,
      { employee: proposedEmployee, contracts: proposedContracts }, { employee: baseEmployee, contracts: baseContracts });
    const proposedPerformance = {
      managerId: user.directManagerId,
      ...(input.performance ?? {}),
    };
    const comparableEmployee = profileApproved
      ? await this.appliedEmployeeReviewData(client as Prisma.TransactionClient, proposedEmployee, this.record(savedBase.employee), this.record(savedProposal.performance), this.record(savedProposal.employee))
      : proposedEmployee;
    const comparableProfile = profileApproved ? this.appliedProfileReviewData(proposedProfile) : proposedProfile;
    const profileChanged = !this.sameReviewRecord(baseEmployee, comparableEmployee, [
      'employeeNo', 'name', 'phone', 'company', 'companyText', 'contractSubjectId', 'deptId', 'positionId', 'position', 'jobGrade',
      'jobFamily', 'managerId', 'workLocation', 'employmentType', 'employeeStatus', 'entryDate',
      'plannedRegularDate', 'actualRegularDate', 'leaveDate', 'probationMonths',
    ])
      || !this.sameReviewRecord(baseProfile, comparableProfile, [...new Set([...Object.keys(baseProfile), ...Object.keys(comparableProfile)])]
        .filter(key => !['idNumberEncrypted', 'bankAccountEncrypted'].includes(key)))
      || !(profileApproved ? this.sameAppliedContractSet(proposedContracts, baseContracts, originalContracts) : this.sameContractSet(baseContracts, proposedContracts));
    const performanceManagerId = performanceApproved
      ? await this.appliedPerformanceManagerId(client as Prisma.TransactionClient, proposedPerformance) : proposedPerformance.managerId ?? null;
    const performanceChanged = performanceManagerId !== (user.directManagerId ?? null);
    if ((existing?.profileReviewStatus === 'approved' && profileChanged)
      || (existing?.performanceReviewStatus === 'approved' && performanceChanged)) {
      throw new ConflictException('已通过的部分不能在原申请中改写，请从当前档案另行发起更正');
    }
    const data = {
      baseValue: existing
        ? this.toJson(this.baseValueWithDirectChanges(existing.baseValue, directChanges))
        : this.toJson({
        employee: baseEmployee,
        profile: baseProfile,
        profileExists: user.employeeProfile !== null,
        contracts: baseContracts,
        performance: { managerId: user.directManagerId },
      }),
      proposedValue: this.toJson(this.baseValueWithDirectChanges({
        employee: profileApproved ? savedProposal.employee : proposedEmployee,
        profile: profileApproved ? savedProposal.profile : proposedProfile,
        contracts: profileApproved ? savedProposal.contracts : proposedContracts,
        performance: performanceApproved ? savedProposal.performance : proposedPerformance,
      }, directChanges)),
      validationErrors: this.toJson([]),
      createdById: operator.id,
      rejectedReason: null,
    };
    if (!profileChanged && !performanceChanged) {
      if (directApplied.length === 0) {
        // 保存草稿时，与当前档案归一化后一致的输入视为幂等空保存：返回现有草稿（或空），
        // 避免自动保存被 400 打断并反复提示“草稿保存失败”。提交审核仍要求有实际变更。
        if (recordStatus === 'draft') {
          return { request: existing ? employeeDataChangeView(existing) : null, directApplied };
        }
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '未检测到实际变更，无需提交审核',
        });
      }
      // Complete the consumed draft so the next edit starts from the new formal baseline.
      if (existing) {
        await client.employeeDataChangeRequest.update({
          where: { id: existing.id, requestVersion: existing.requestVersion, updatedAt: existing.updatedAt },
          data: {
            ...data,
            recordStatus: 'submitted',
            archivedAt: new Date(),
            profileReviewStatus: existing.profileReviewStatus === 'approved' ? 'approved' : 'not_required',
            performanceReviewStatus: existing.performanceReviewStatus === 'approved' ? 'approved' : 'not_required',
            requestVersion: { increment: 1 },
            revisionHistory: this.revisionSnapshot(existing),
          },
        });
      }
      return { request: null, directApplied };
    }
    if (existing) {
      return {
        request: employeeDataChangeView(await client.employeeDataChangeRequest.update({
        where: { id: existing.id, requestVersion: existing.requestVersion, updatedAt: existing.updatedAt },
        data: {
          ...data,
          recordStatus,
          archivedAt: null,
          profileReviewStatus: existing.profileReviewStatus === 'approved' ? 'approved' : profileChanged ? 'pending' : 'not_required',
          performanceReviewStatus: existing.performanceReviewStatus === 'approved' ? 'approved' : performanceChanged ? 'pending' : 'not_required',
          requestVersion: { increment: 1 },
          revisionHistory: this.revisionSnapshot(existing),
        },
      })),
        directApplied,
      };
    }
    return {
      request: employeeDataChangeView(await client.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_archive_change',
        recordStatus,
        ...data,
        profileReviewStatus: profileChanged ? 'pending' : 'not_required',
        performanceReviewStatus: performanceChanged ? 'pending' : 'not_required',
      },
    })),
      directApplied,
    };
  }

  async submitDepartmentAssignments(
    userIds: string[],
    departmentId: string,
    operator: AuthUser,
  ): Promise<{ submitted: number }> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0 || uniqueUserIds.length > 100) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '每次请选择 1 至 100 名员工' });
    }
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true },
      });
      if (!department?.isActive) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '目标部门不存在或已停用' });
      }
      const users = await tx.user.findMany({
        where: { id: { in: uniqueUserIds }, deletedAt: null },
        select: { id: true, deptId: true },
      });
      if (users.length !== uniqueUserIds.length) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '部分员工不存在或已停用，请刷新后重试' });
      }
      const changedUserIds = users.filter((user) => user.deptId !== departmentId).map((user) => user.id);
      if (changedUserIds.length === 0) return { submitted: 0, submittedRequestIds: [] as string[] };

      const pendingReviews = await tx.employeeDataChangeRequest.findMany({
        where: {
          userId: { in: changedUserIds },
          recordStatus: 'submitted',
          archivedAt: null,
          profileReviewStatus: 'pending',
        },
        select: { userId: true, employeeName: true },
      });
      if (pendingReviews.length > 0) {
        const names = pendingReviews.map((item) => item.employeeName).filter(Boolean).join('、');
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: `${names || '所选员工'}已有档案变更待审，请先处理后再批量调整`,
        });
      }

      const submittedRequestIds: string[] = [];
      for (const userId of changedUserIds) {
        const { request } = await this.persistArchiveChangeWithClient(tx, userId, {
          employee: { deptId: departmentId },
          profile: {},
        }, operator, 'submitted', false);
        if (request?.id) submittedRequestIds.push(request.id);
      }
      return { submitted: changedUserIds.length, submittedRequestIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then((result) => {
      const reviewOutcome = result.submittedRequestIds.length ? 'pending' as const : 'not_required' as const;
      return { submitted: result.submitted, reviewOutcome };
    });
  }

  async createEmploymentRecord(userId: string, input: CreateEmploymentRecordInput, operator: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        employeeProfile: true,
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '员工不存在',
      });
    }
    this.assertEmployeeEditable(user);
    if (user.status === UserStatus.resigned && input.employeeStatus !== UserStatus.resigned
      && (!input.effectiveTo || input.effectiveTo >= shanghaiBusinessDate())) {
      throw new ConflictException('已离职员工请通过“办理再入职”建立新的任职');
    }

    const pendingEmploymentChange = await this.prisma.employeeDataChangeRequest.findFirst({
      where: {
        userId,
        sourceType: 'manual_employment_change',
        recordStatus: 'submitted',
        archivedAt: null,
        OR: [{ profileReviewStatus: { in: ['pending', 'applying'] } },
          { profileReviewStatus: 'approved', appliedAt: null, employmentRecords: { some: { effectiveFrom: { gt: shanghaiBusinessDate() } } } }],
      },
      select: { id: true },
    });
    if (pendingEmploymentChange) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '该员工已有任职变更审核中，请先处理现有申请',
      });
    }

    const overlappingRecords = await this.prisma.employmentRecord.findMany({
      where: {
        userId,
        effectiveFrom: { lte: input.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: input.effectiveFrom } },
        ],
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    const warnings = employmentWarnings(overlappingRecords, {
      id: 'pending',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    });

    const position = input.positionId
      ? await this.prisma.position.findUnique({
        where: { id: input.positionId },
        select: { id: true, name: true, jobFamily: true, isActive: true },
      })
      : null;
    if (input.positionId && !position) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '岗位不存在' });
    }
    if (position && !position.isActive) warnings.push('所选岗位已停用');

    const currentEmployment = user.employmentHistory[0] ?? null;
    const baseEmployee = this.employeeReviewData(user, currentEmployment);
    const positionChanged = !currentEmployment || (position?.id ?? null) !== this.nullableString(baseEmployee.positionId);
    const proposedEmployee = {
      ...baseEmployee,
      company: input.company,
      ...(input.contractSubjectId !== undefined ? { contractSubjectId: input.contractSubjectId } : {}),
      deptId: input.deptId ?? null,
      positionId: position?.id ?? null,
      position: position?.name ?? (input.position !== undefined ? input.position : positionChanged ? null : baseEmployee.position),
      jobGrade: input.jobGrade !== undefined ? input.jobGrade : baseEmployee.jobGrade,
      jobFamily: position && positionChanged ? position.jobFamily
        : input.jobFamily !== undefined ? input.jobFamily : positionChanged ? null : baseEmployee.jobFamily,
      managerId: input.directManagerId ?? null,
      workLocation: input.workLocation ?? null,
      employmentType: input.employmentType,
      employeeStatus: input.employeeStatus,
      entryDate: input.entryDate ?? user.entryDate ?? null,
      plannedRegularDate: input.plannedRegularDate ?? null,
      actualRegularDate: input.actualRegularDate ?? null,
      leaveDate: input.leaveDate ?? null,
      probationMonths: input.probationMonths ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      changeType: input.changeType,
      reason: input.reason ?? null,
    };
    if (input.contractSubjectId === undefined) delete proposedEmployee.contractSubjectId;
    await normalizeContractSubject(this.prisma, proposedEmployee as Record<string, unknown>, baseEmployee, 'companyText');
    const profile = this.profileReviewData(user.employeeProfile);
    const view = employeeDataChangeView(await this.prisma.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_employment_change',
        recordStatus: 'submitted',
        sourceBatchId: input.sourceBatchId ?? null,
        baseValue: this.toJson({
          employee: baseEmployee,
          profile,
          profileExists: user.employeeProfile !== null,
          performance: { managerId: user.directManagerId },
        }),
        proposedValue: this.toJson({
          employee: proposedEmployee,
          profile,
          contracts: [],
          performance: { managerId: user.directManagerId },
        }),
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
        validationErrors: this.toJson([]),
        validationWarnings: this.toJson(warnings),
        createdById: operator.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, sysRole: true } },
        profileReviewedBy: { select: { id: true, name: true } },
      },
    }));
    return { ...view, reviewOutcome: 'pending' as const };
  }

  async bindDingtalkIdentity(userId: string, input: BindDingtalkIdentityInput, operator: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }

    return this.prisma.$transaction(async (tx) => {
      const conflict = await tx.externalIdentityBinding.findFirst({
        where: {
          provider: ExternalIdentityProvider.dingtalk,
          endedAt: null,
          OR: [
            { userId },
            { externalUnionId: input.externalUnionId },
            ...(input.externalUserId ? [{ externalUserId: input.externalUserId }] : []),
          ],
        },
        select: { id: true, userId: true },
      });
      if (conflict) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: conflict.userId === userId ? '该员工已有钉钉关联' : '该钉钉身份已关联其他员工',
        });
      }

      const binding = await tx.externalIdentityBinding.create({
        data: {
          provider: ExternalIdentityProvider.dingtalk,
          userId,
          externalUserId: input.externalUserId,
          externalUnionId: input.externalUnionId,
          status: ExternalIdentityStatus.enabled,
          boundById: operator.id,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          dingtalkId: input.externalUserId,
          dingtalkUnionId: input.externalUnionId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'bind_dingtalk_identity',
          entityType: 'external_identity_binding',
          entityId: binding.id,
          newValue: { userId, provider: 'dingtalk', status: 'enabled' },
        },
      });
      return binding;
    });
  }

  async setDingtalkIdentityEnabled(
    userId: string,
    enabled: boolean,
    reason: string | null,
    operator: AuthUser,
  ) {
    const current = await this.prisma.externalIdentityBinding.findFirst({
      where: { userId, provider: ExternalIdentityProvider.dingtalk, endedAt: null },
    });
    if (!current) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '该员工尚未关联钉钉' });
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const binding = await tx.externalIdentityBinding.update({
        where: { id: current.id },
        data: enabled
          ? {
            status: ExternalIdentityStatus.enabled,
            disabledAt: null,
            disabledById: null,
            disabledReason: null,
          }
          : {
            status: ExternalIdentityStatus.disabled,
            disabledAt: now,
            disabledById: operator.id,
            disabledReason: reason,
          },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: enabled ? 'enable_dingtalk_identity' : 'disable_dingtalk_identity',
          entityType: 'external_identity_binding',
          entityId: current.id,
          oldValue: { status: current.status },
          newValue: { status: binding.status, reason },
        },
      });
      return binding;
    });
  }

  private assertEmployeeEditable(user: { archivedAt?: Date | null }) {
    if (user.archivedAt) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '员工档案已归档，只能查看',
      });
    }
  }

  private archiveVersion(user: Record<string, any>): string {
    // Version only persisted record identities and timestamps; never hash personal field values.
    const version = (record: Record<string, any> | null | undefined) => record
      ? [record.id ?? null, record.updatedAt ?? null] : null;
    const versions = (records: Record<string, any>[]) => records.map(version)
      .sort((a, b) => String(a![0]).localeCompare(String(b![0])));
    return createHash('sha256').update(JSON.stringify({ user: version(user), profile: version(user.employeeProfile),
      employments: versions(user.employmentHistory ?? []),
      contracts: versions((user.employeeContracts ?? []).filter(contract => contract.isActive !== false)),
      managerId: user.directManagerId ?? user.directManager?.id ?? null,
    })).digest('hex');
  }

  private employeeReviewData(
    user: Record<string, any>,
    employment: Record<string, any> | null,
    phoneOverride?: string | null,
  ): Record<string, unknown> {
    return {
      employeeNo: user.employeeNo,
      name: user.name,
      phone: phoneOverride !== undefined ? phoneOverride : user.phone,
      company: employment?.company ?? CompanyCode.fuede,
      companyText: employment?.companyText ?? null,
      contractSubjectId: employment?.contractSubjectId ?? null,
      deptId: user.deptId ?? employment?.deptId ?? null,
      positionId: user.positionId ?? employment?.positionId ?? null,
      position: user.position ?? employment?.position ?? null,
      jobGrade: employment?.jobGrade ?? null,
      jobFamily: employment?.jobFamily ?? null,
      managerId: employment?.directManagerId ?? null,
      workLocation: employment?.workLocation ?? null,
      employmentType: user.employmentType ?? employment?.employmentType ?? EmploymentType.full_time,
      employeeStatus: user.status ?? employment?.employeeStatus ?? UserStatus.active,
      entryDate: user.entryDate ?? employment?.entryDate ?? null,
      plannedRegularDate: user.plannedRegularDate ?? employment?.plannedRegularDate ?? null,
      actualRegularDate: user.actualRegularDate ?? employment?.actualRegularDate ?? null,
      leaveDate: user.leaveDate ?? employment?.leaveDate ?? null,
      probationMonths: employment?.probationMonths ?? null,
    };
  }

  private profileReviewData(profile: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!profile) return {};
    return Object.fromEntries(
      Object.entries(profile).filter(([key]) => !['id', 'userId', 'createdAt', 'updatedAt'].includes(key)),
    );
  }

  /**
   * 免审个人信息字段直改：写入正式档案、记审计日志，并同步刷新该员工其他在审申请的
   * base 快照中被直改的字段，避免审批时把本次直改误判为“正式档案已发生变化”。
   * 仅提交（recordStatus='submitted'）时执行；保存草稿不触碰正式数据。
   */
  private async applyDirectProfileChanges(
    client: Pick<Prisma.TransactionClient, 'user' | 'employeeProfile' | 'auditLog' | 'employeeDataChangeRequest'>,
    user: { id: string; phone: string | null; employeeProfile: Record<string, unknown> | null },
    input: SubmitEmployeeArchiveDraftDto,
    operator: AuthUser,
    directApplied: string[],
    directChanges: Record<string, unknown>,
  ): Promise<void> {
    const profile = (user.employeeProfile ?? {}) as Record<string, unknown>;
    const dateFields = new Set(['birthDate', 'graduationDate']);
    const normalizedInput: Record<string, unknown> = {};
    for (const key of DIRECT_APPLY_PROFILE_FIELDS) {
      if (!(key in input.profile)) continue;
      let next = (input.profile as Record<string, unknown>)[key];
      // 与审核生效路径（profileUpdate/nullableString/nullableDate）保持一致的归一化。
      if (key === 'phone') next = this.directApplyString(next);
      if (dateFields.has(key)) {
        const parsed = this.directApplyDate(next);
        if (next != null && next !== '' && !parsed) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: `${DIRECT_APPLY_PROFILE_FIELD_LABELS[key as DirectApplyProfileField]}格式无效，请按 YYYY-MM-DD 填写或清空`,
          });
        }
        next = parsed;
      }
      normalizedInput[key] = next ?? null;
      if (this.comparableReviewValue(profile[key] ?? null, key) === this.comparableReviewValue(next ?? null, key)) continue;
      directChanges[key] = next ?? null;
    }
    // 无论是否产生实际直改，都把免审字段的归一化值写回输入，避免原始值（如带空格手机号）进入审核差异。
    for (const [key, value] of Object.entries(normalizedInput)) {
      (input.profile as Record<string, unknown>)[key] = value;
      if (key === 'phone' && input.employee) input.employee.phone = value;
    }
    // 兼容仅通过 employee 段提交手机号的调用方：前端两个段都会带手机号，此处兜底合并。
    if (!('phone' in directChanges) && input.employee && 'phone' in input.employee) {
      const next = this.directApplyString(input.employee.phone);
      if (this.comparableReviewValue(user.phone, 'phone') !== this.comparableReviewValue(next, 'phone')) {
        directChanges.phone = next;
      }
    }
    if (Object.keys(directChanges).length === 0) return;

    if ('phone' in directChanges) {
      const phone = directChanges.phone as string | null;
      await client.user.update({ where: { id: user.id }, data: { phone } });
      user.phone = phone;
    }
    await client.employeeProfile.upsert({
      where: { userId: user.id },
      create: { user: { connect: { id: user.id } }, ...directChanges } as Prisma.EmployeeProfileCreateInput,
      update: directChanges,
    });
    user.employeeProfile = { ...profile, ...directChanges };

    const pendingRequests = await client.employeeDataChangeRequest.findMany({
      where: {
        userId: user.id,
        recordStatus: 'submitted',
        archivedAt: null,
        OR: [
          { profileReviewStatus: { in: ['pending', 'applying'] } },
          { performanceReviewStatus: { in: ['pending', 'applying'] } },
        ],
      },
    });
    for (const pending of pendingRequests) {
      if (pending.id === input.draftId) continue;
      const base = this.record(pending.baseValue);
      const proposed = this.record(pending.proposedValue);
      for (const [key, value] of Object.entries(directChanges)) {
        for (const section of key === 'phone' ? ['employee', 'profile'] : ['profile']) {
          const before = this.record(base[section]);
          const after = this.record(proposed[section]);
          if (key in after && this.comparableReviewValue(after[key], key) !== this.comparableReviewValue(before[key], key)
            && this.comparableReviewValue(after[key], key) !== this.comparableReviewValue(value, key)) {
            throw new ConflictException('已有待审申请修改了相同个人信息，请先处理原申请后重试');
          }
        }
      }
      await client.employeeDataChangeRequest.update({
        where: { id: pending.id, requestVersion: pending.requestVersion, updatedAt: pending.updatedAt },
        data: {
          baseValue: this.toJson(this.baseValueWithDirectChanges(pending.baseValue, directChanges)),
          proposedValue: this.toJson(this.baseValueWithDirectChanges(pending.proposedValue, directChanges)),
          requestVersion: { increment: 1 },
          revisionHistory: this.toJson([...(Array.isArray(pending.revisionHistory) ? pending.revisionHistory : []), {
            version: pending.requestVersion, baseValue: pending.baseValue, proposedValue: pending.proposedValue,
            reason: 'personal_info_direct_update', updatedAt: pending.updatedAt,
          }]),
        },
      });
    }

    const changedKeys = Object.keys(directChanges);
    await client.auditLog.create({
      data: {
        userId: operator.id,
        action: 'employee_profile_direct_update',
        entityType: 'user',
        entityId: user.id,
        oldValue: this.toJson(Object.fromEntries(changedKeys.map(key => [key, this.auditDisplayValue(profile[key] ?? null, key)]))),
        newValue: this.toJson(Object.fromEntries(changedKeys.map(key => [key, this.auditDisplayValue(directChanges[key], key)]))),
      },
    });
    directApplied.push(...changedKeys.map(key => DIRECT_APPLY_PROFILE_FIELD_LABELS[key as DirectApplyProfileField] ?? key));
  }

  /** 把免审直改后的字段值回填进审核单 base 快照，保持审批基准与正式档案一致。 */
  private baseValueWithDirectChanges(baseValue: unknown, changes: Record<string, unknown>): Record<string, unknown> {
    const base = { ...this.record(baseValue) };
    if (Object.keys(changes).length === 0) return base;
    if ('profileExists' in base) base.profileExists = true;
    if (Object.keys(this.record(base.profile)).length > 0 || base.profile !== undefined) {
      base.profile = { ...this.record(base.profile), ...changes };
    }
    if ('phone' in changes) {
      const employee = this.record(base.employee);
      if (Object.keys(employee).length > 0 || base.employee !== undefined) {
        employee.phone = changes.phone;
        base.employee = employee;
      }
    }
    return base;
  }

  private auditDisplayValue(value: unknown, key: string): unknown {
    if (value == null || value === '') return null;
    if (['phone', 'emergencyContactPhone'].includes(key)) {
      const text = String(value);
      return /^\d{11}$/.test(text) ? `${text.slice(0, 3)}****${text.slice(-4)}` : '[redacted]';
    }
    if (['idAddress', 'currentAddress', 'emergencyContactName'].includes(key)) return '[redacted]';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return JSON.stringify(value);
  }

  private directApplyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private directApplyDate(value: unknown): Date | null {
    if (value == null || value === '') return null;
    if (value instanceof Date && Number.isNaN(value.getTime())) return null;
    const text = value instanceof Date ? value.toISOString() : String(value);
    if (!/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(text)) return null;
    const day = text.slice(0, 10);
    const date = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? date : null;
  }

  private contractReviewData(contract: object): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(contract).filter(([key]) => ![
        'userId', 'createdAt', 'updatedAt', 'sourceBatchId', 'createdById', 'isActive', 'endedAt', 'attachmentRef',
      ].includes(key)),
    );
  }

  private sameReviewRecord(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    selectedKeys?: string[],
  ): boolean {
    const ignoredKeys = new Set(['idNumber', 'bankAccount']);
    const keys = selectedKeys ?? [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return keys
      .filter((key) => !ignoredKeys.has(key))
      .every((key) => this.comparableReviewValue(left[key], key) === this.comparableReviewValue(right[key], key));
  }

  private nullableAppliedDate(value: unknown): Date | null {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private appliedProfileReviewData(profile: Record<string, unknown>): Record<string, unknown> {
    const applied = { ...profile };
    for (const key of ['birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate']) {
      if (key in applied) applied[key] = this.nullableAppliedDate(applied[key]);
    }
    return applied;
  }

  private async reviewedManagerByName(client: Prisma.TransactionClient, name: string): Promise<string | null> {
    const candidates = await client.user.findMany({ where: { name, deletedAt: null, accountType: AccountType.employee,
      status: { in: CURRENT_WORKER_STATUSES } }, select: { id: true }, take: 2 });
    return candidates.length === 1 ? candidates[0].id : null;
  }

  private async appliedPerformanceManagerId(client: Prisma.TransactionClient, performance: Record<string, unknown>): Promise<string | null> {
    const id = typeof performance.managerId === 'string' ? performance.managerId : null;
    const name = this.nullableString(performance.managerName);
    return !id && name ? this.reviewedManagerByName(client, name) : id;
  }

  private async appliedEmployeeReviewData(client: Prisma.TransactionClient, employee: Record<string, unknown>,
    previous: Record<string, unknown>, performance: Record<string, unknown>, reviewedEmployee = employee): Promise<Record<string, unknown>> {
    const comparable = (value: unknown) => value == null || value === '' ? 'null' : value instanceof Date ? value.toISOString() : String(value);
    const writesEmployment = ['company', 'companyText', 'contractSubjectId', 'deptId', 'positionId', 'position', 'jobGrade', 'jobFamily',
      'managerId', 'managerName', 'workLocation', 'employmentType', 'employeeStatus', 'entryDate', 'plannedRegularDate', 'actualRegularDate', 'leaveDate', 'probationMonths']
      .some(key => comparable(previous[key]) !== comparable(reviewedEmployee[key]));
    const employmentOnly = new Set(['company', 'companyText', 'contractSubjectId', 'jobGrade', 'jobFamily', 'managerId', 'workLocation', 'probationMonths']);
    const applied = { ...employee };
    for (const key of ['name', 'employeeNo', 'phone', 'deptId', 'positionId', 'position', 'jobGrade', 'jobFamily', 'managerId', 'workLocation', 'companyText', 'contractSubjectId']) {
      if (key in applied && (writesEmployment || !employmentOnly.has(key))) applied[key] = this.nullableString(applied[key]);
    }
    for (const [key, options, fallback] of [
      ['company', Object.values(CompanyCode), CompanyCode.fuede],
      ['employmentType', Object.values(EmploymentType), EmploymentType.full_time],
      ['employeeStatus', Object.values(UserStatus), UserStatus.active],
    ] as const) {
      if (key in applied && (writesEmployment || !employmentOnly.has(key)) && !options.includes(applied[key] as never)) applied[key] = fallback;
    }
    for (const key of ['entryDate', 'plannedRegularDate', 'actualRegularDate', 'leaveDate']) {
      if (key in applied) applied[key] = this.nullableAppliedDate(applied[key]);
    }
    if (writesEmployment && 'probationMonths' in applied && typeof applied.probationMonths !== 'number') applied.probationMonths = null;
    if (applied.positionId) {
      const position = await client.position.findUnique({ where: { id: String(applied.positionId) }, select: { id: true, name: true, jobFamily: true } });
      if (!position) throw new ConflictException('已通过档案的岗位已变化，请重新核对最新档案');
      applied.position = position.name;
      if (writesEmployment && this.nullableString(reviewedEmployee.positionId) !== this.nullableString(previous.positionId)) {
        applied.jobFamily = position.jobFamily;
      }
    }
    const managerName = this.nullableString(employee.managerName);
    if (writesEmployment && !applied.managerId && managerName) {
      const suggestedId = this.nullableString(performance.managerId);
      applied.managerId = suggestedId && this.nullableString(performance.managerName) === managerName
        ? suggestedId : await this.reviewedManagerByName(client, managerName);
    }
    if (writesEmployment && employee.contractSubjectId === undefined && 'contractSubjectId' in previous) applied.contractSubjectId = previous.contractSubjectId;
    if (writesEmployment && (employee.companyText === undefined || (employee.contractSubjectId === undefined && previous.contractSubjectId))) {
      applied.companyText = this.nullableString(previous.companyText);
    }
    return applied;
  }

  private sameAppliedContractSet(proposed: Record<string, unknown>[], current: Record<string, unknown>[], previous: Record<string, unknown>[]): boolean {
    if (proposed.length !== current.length) return false;
    const remaining = [...current];
    return proposed.every((contract, index) => {
      const id = this.nullableString(contract.id);
      const contractType = this.nullableString(contract.kind ?? contract.contractType) ?? 'contract';
      const sequence = typeof contract.sequence === 'number' ? contract.sequence : index;
      const matches = remaining.filter(item => id ? item.id === id : item.contractType === contractType && item.sequence === sequence);
      if (matches.length !== 1) return false;
      const applied = matches[0];
      const prior = id ? previous.find(item => item.id === id) : undefined;
      remaining.splice(remaining.indexOf(applied), 1);
      const normalized = { ...contract, id: applied.id, contractType, sequence,
        effectiveFrom: id && contract.effectiveFrom !== undefined ? contract.effectiveFrom : contract.effectiveFrom ?? contract.signedAt,
        termType: this.nullableString(contract.termText ?? contract.termType),
      };
      for (const key of ['name', 'signingCompany', 'originalCompany', 'newCompany', 'confidentialityAgreement', 'nonCompeteAgreement', 'portraitAgreement']) {
        normalized[key] = this.nullableString(contract[key]);
      }
      if (contract.contractSubjectId === undefined && prior) normalized['contractSubjectId'] = prior.contractSubjectId;
      if (prior?.contractSubjectId && (contract.contractSubjectId === undefined || contract.contractSubjectId === prior.contractSubjectId)) {
        normalized['signingCompany'] = prior.signingCompany ?? null;
      }
      return this.sameContractSet([normalized], [applied]);
    });
  }

  private sameContractSet(
    left: Record<string, unknown>[],
    right: Record<string, unknown>[],
  ): boolean {
    const normalize = (contract: Record<string, unknown>) => ({
      id: contract.id ?? null,
      contractType: contract.contractType ?? contract.kind ?? 'contract',
      sequence: contract.sequence ?? 0,
      name: contract.name ?? null,
      signingCompany: contract.signingCompany ?? null,
      contractSubjectId: contract.contractSubjectId ?? null,
      signedAt: this.comparableReviewValue(contract.signedAt, 'signedAt'),
      effectiveFrom: this.comparableReviewValue(contract.effectiveFrom, 'effectiveFrom'),
      expiresAt: this.comparableReviewValue(contract.expiresAt, 'expiresAt'),
      termType: contract.termType ?? contract.termText ?? null,
      originalCompany: contract.originalCompany ?? null,
      newCompany: contract.newCompany ?? null,
      confidentialityAgreement: contract.confidentialityAgreement ?? null,
      nonCompeteAgreement: contract.nonCompeteAgreement ?? null,
      portraitAgreement: contract.portraitAgreement ?? null,
      images: Array.isArray(contract.images) ? contract.images : [],
      attachments: Array.isArray(contract.attachments) ? contract.attachments : [],
    });
    const sortKey = (contract: ReturnType<typeof normalize>) => String(
      contract.id ?? `${contract.contractType}:${contract.sequence}`,
    );
    const normalizedLeft = left.map(normalize).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const normalizedRight = right.map(normalize).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
  }

  private comparableReviewValue(value: unknown, key: string): string {
    if (value === undefined || value === null || value === '') return 'null';
    if ([
      'entryDate', 'plannedRegularDate', 'actualRegularDate', 'leaveDate', 'birthDate', 'graduationDate',
      'socialSecurityStartDate', 'housingFundStartDate', 'signedAt', 'effectiveFrom', 'expiresAt',
    ].includes(key)) {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
    }
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private assertContractMaterials(contract: Record<string, unknown>): void {
    const images = this.materialList(contract.images, '合同图片');
    const attachments = this.materialList(contract.attachments, '合同附件');
    if (images.length > CONTRACT_IMAGE_MAX_COUNT) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '每份合同最多上传 5 张图片' });
    }
    if (attachments.length > CONTRACT_ATTACHMENT_MAX_COUNT) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '每份合同最多上传 10 个附件' });
    }
    images.forEach((material) => this.assertContractMaterial(
      material,
      CONTRACT_IMAGE_MAX_SIZE,
      CONTRACT_IMAGE_MIME_TYPES,
      CONTRACT_IMAGE_EXTENSIONS,
      'employee-contracts/images/',
      '合同图片单张不能超过 2MB',
      '合同图片仅支持 JPG、PNG、WEBP',
    ));
    attachments.forEach((material) => this.assertContractMaterial(
      material,
      CONTRACT_ATTACHMENT_MAX_SIZE,
      CONTRACT_ATTACHMENT_MIME_TYPES,
      CONTRACT_ATTACHMENT_EXTENSIONS,
      'employee-contracts/attachments/',
      '合同附件单个不能超过 10MB',
      '合同附件仅支持 PDF、DOC、DOCX、XLS、XLSX',
    ));
  }

  private materialList(value: unknown, label: string): Record<string, unknown>[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: `${label}格式不正确` });
    }
    return value as Record<string, unknown>[];
  }

  private assertContractMaterial(
    material: Record<string, unknown>,
    maxSize: number,
    allowedMimeTypes: Set<string>,
    allowedExtensions: Set<string>,
    requiredObjectPrefix: string,
    sizeMessage: string,
    typeMessage: string,
  ): void {
    if (!material || typeof material !== 'object'
      || typeof material.name !== 'string'
      || typeof material.url !== 'string'
      || typeof material.size !== 'number'
      || typeof material.mimeType !== 'string') {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '合同材料信息不完整' });
    }
    if (material.size > maxSize) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: sizeMessage });
    }
    const name = material.name.toLowerCase();
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (!allowedMimeTypes.has(material.mimeType) || !allowedExtensions.has(extension)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: typeMessage });
    }
    try {
      const parsed = new URL(material.url, 'https://hrm.internal');
      const key = parsed.searchParams.get('key') ?? '';
      if (!material.url.startsWith('/storage/download?key=')
        || parsed.pathname !== '/storage/download'
        || !key.startsWith(requiredObjectPrefix)
        || key.includes('..')
        || key.includes('\\')) {
        throw new Error('invalid contract object key');
      }
    } catch {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '合同材料必须通过系统合同专用入口安全上传' });
    }
  }

  private applySensitiveReplacement(
    target: Record<string, unknown>,
    input: Record<string, unknown>,
    inputKey: string,
    encryptedKey: string,
    fingerprintKey: string,
  ) {
    if (typeof input[inputKey] !== 'string' || !input[inputKey].trim()) return;
    const secured = this.encryptAndFingerprint(input[inputKey].trim());
    target[encryptedKey] = secured.encrypted;
    target[fingerprintKey] = secured.fingerprint;
  }

  private encryptAndFingerprint(value: string): { encrypted: Buffer; fingerprint: string } {
    const secret = this.config?.get<string>('EMPLOYEE_ARCHIVE_ENCRYPTION_KEY')
      ?? this.config?.get<string>('JWT_SECRET');
    if (!secret) {
      throw new BadRequestException({ code: ERROR_CODE.INTERNAL, message: '员工档案加密配置缺失' });
    }
    const key = createHash('sha256').update(`employee-archive:${secret}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]),
      fingerprint: createHmac('sha256', key).update(value.toUpperCase()).digest('hex'),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
