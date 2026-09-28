import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto';
import {
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
import { employmentWarnings, selectEmploymentAt, shanghaiBusinessDate } from './employment-timeline';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { employeeArchiveView, employeeDataChangeView, activeApplicationWhere } from './employee-data-change-view';

export interface UpsertEmployeeProfileInput {
  phone?: string | null;
  gender?: string | null;
}

export interface CreateEmploymentRecordInput {
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
    return this.prisma.$transaction(async (tx) => {
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
        const draft = await tx.employeeDataChangeRequest.findFirst({
          where: {
            id: input.draftId,
            sourceType: 'manual_employee_create',
            OR: [{ recordStatus: 'draft' }, { profileReviewStatus: 'rejected' }],
            archivedAt: null,
          },
          select: { id: true, proposedValue: true, requestVersion: true, userId: true, employeeNo: true,
            profileReviewStatus: true, recordStatus: true, revisionHistory: true, rejectedReason: true, updatedAt: true },
        });
        if (!draft) {
          throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '草稿已提交或已归档，请刷新后重试' });
        }
        if (draft.userId || draft.profileReviewStatus === 'approved') throw new ConflictException('员工主档已经建立，请在原档案中继续维护');
        savedDraft = draft;
        proposedValue = this.preserveSensitiveProfile(proposedValue, draft.proposedValue);
        draftVersion = draft.requestVersion;
      }
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
          validationWarnings: this.toJson(warnings),
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
        request = await this.updateEmployeeCreateDraft(tx, input.draftId, draftVersion, {
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async saveEmployeeCreateDraft(input: SaveEmployeeCreateDraftDto, operator: AuthUser) {
    let employeeNo: string | null = null;
    const employeeName = input.name?.trim() || '未命名员工草稿';
    let proposed = this.employeeCreateProposedValue(input, null);
    proposed.draftMeta = {
      layoutVersion: input.draftLayoutVersion ?? 1,
      currentStep: input.draftStep ?? 0,
      completedSteps: [...new Set(input.completedSteps ?? [])].sort((a, b) => a - b),
    };
    return this.prisma.$transaction(async (tx) => {
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
            profileReviewStatus: true, recordStatus: true, revisionHistory: true, rejectedReason: true, updatedAt: true },
        });
        if (!draft) {
          throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '草稿已提交或已归档，请刷新后重试' });
        }
        if (draft.userId || draft.profileReviewStatus === 'approved') throw new ConflictException('员工主档已经建立，请在原档案中继续维护');
        savedDraft = draft;
        employeeNo = draft.employeeNo ?? null;
        proposed = this.preserveSensitiveProfile(proposed, draft.proposedValue);
        draftVersion = draft.requestVersion;
      }
      const proposedValue = this.toJson(proposed);
      const performanceManagerId = this.nullableString(
        this.record(proposed.performance).managerId,
      );
      const data = {
        userId: null,
        employeeNo,
        employeeName,
        sourceType: 'manual_employee_create',
        baseValue: this.toJson({ employee: {}, profile: {}, contracts: [], performance: { managerId: null } }),
        proposedValue,
        profileReviewStatus: 'pending',
        performanceReviewStatus: performanceManagerId ? 'pending' : 'not_required',
        validationErrors: this.toJson([]),
        validationWarnings: this.toJson([]),
        createdById: operator.id,
        recordStatus: 'draft',
        archivedAt: null,
        rejectedReason: null,
      } satisfies Prisma.EmployeeDataChangeRequestUncheckedCreateInput;
      let request;
      if (input.draftId && draftVersion !== null) {
        request = await this.updateEmployeeCreateDraft(tx, input.draftId, draftVersion, {
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
    });
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
      'plannedRegularDate', 'actualRegularDate', 'leaveDate',
    ]);
    const employee: Record<string, unknown> = {
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
        'contractType', 'name', 'signingCompany', 'signedAt', 'effectiveFrom', 'expiresAt',
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
    return { ...proposed, profile };
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

  async listDrafts(query: { page: number; pageSize: number }) {
    const where: Prisma.EmployeeDataChangeRequestWhereInput = {
      recordStatus: 'draft',
      archivedAt: null,
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
    return {
      items: items.map((item) => employeeDataChangeView(item)),
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
        select: { id: true, employeeName: true },
      });
      if (drafts.length !== ids.length) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '部分草稿已提交或已归档，请刷新后重试' });
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
        include: { createdBy: { select: { id: true, name: true, sysRole: true } },
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
    if (request.intakeType && request.onboardingStatus !== 'effective') {
      if (!this.onboarding) throw new BadRequestException('入职服务未就绪');
      return this.onboarding.cancelReentry(id, { reason }, operator.id);
    }
    return this.prisma.$transaction(async (tx) => {
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

  async getApplication(id: string) {
    const [request, events] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findUnique({ where: { id },
        include: { createdBy: { select: { id: true, name: true, sysRole: true } },
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
        employmentType: true, sysRole: true, hrCapabilities: true, archivedAt: true,
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
    return this.persistArchiveChangeWithClient(this.prisma, userId, input, operator, 'submitted');
  }

  async saveArchiveDraft(userId: string, input: SubmitEmployeeArchiveDraftDto, operator: AuthUser) {
    const request = await this.persistArchiveChangeWithClient(this.prisma, userId, input, operator, 'draft');
    await this.prisma.auditLog.create({
      data: {
        userId: operator.id,
        action: 'save_employee_archive_draft',
        entityType: 'employee_data_change_request',
        entityId: request.id,
        newValue: this.toJson({ userId }),
      },
    });
    return request;
  }

  private async persistArchiveChangeWithClient(
    client: Pick<Prisma.TransactionClient, 'user' | 'employeeDataChangeRequest'>,
    userId: string,
    input: SubmitEmployeeArchiveDraftDto,
    operator: AuthUser,
    recordStatus: 'draft' | 'submitted',
  ) {
    const user = await client.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        employeeProfile: true,
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
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
          recordStatus,
          archivedAt: null,
          OR: [
            { profileReviewStatus: 'pending' },
            { performanceReviewStatus: 'pending' },
          ],
        },
      orderBy: { createdAt: 'desc' },
    });
    if (input.draftId && !existing) {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '草稿已提交或已归档，请刷新后重试' });
    }

    const employment = user.employmentHistory[0] ?? null;
    const baseEmployee = this.employeeReviewData(user, employment);
    const baseProfile = this.profileReviewData(user.employeeProfile);
    const baseContracts = user.employeeContracts.map((contract) => this.contractReviewData(contract));
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
    const storedProfile = this.record(this.record(existing?.proposedValue).profile);
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
    const proposedPerformance = {
      managerId: user.directManagerId,
      ...(input.performance ?? {}),
    };
    const profileChanged = !this.sameReviewRecord(baseEmployee, proposedEmployee, [
      'employeeNo', 'name', 'phone', 'company', 'deptId', 'positionId', 'position', 'jobGrade',
      'jobFamily', 'managerId', 'workLocation', 'employmentType', 'employeeStatus', 'entryDate',
      'plannedRegularDate', 'actualRegularDate', 'leaveDate', 'probationMonths',
    ])
      || !this.sameReviewRecord(baseProfile, proposedProfile)
      || !this.sameContractSet(baseContracts, proposedContracts);
    const performanceChanged = (proposedPerformance.managerId ?? null) !== (user.directManagerId ?? null);
    if ((existing?.profileReviewStatus === 'approved' && profileChanged)
      || (existing?.performanceReviewStatus === 'approved' && performanceChanged)) {
      throw new ConflictException('已通过的部分不能在原申请中改写，请从当前档案另行发起更正');
    }
    if (!profileChanged && !performanceChanged) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '未检测到实际变更，无需提交审核',
      });
    }

    const data = {
      baseValue: this.toJson({
        employee: baseEmployee,
        profile: baseProfile,
        profileExists: user.employeeProfile !== null,
        contracts: baseContracts,
        performance: { managerId: user.directManagerId },
      }),
      proposedValue: this.toJson({
        employee: proposedEmployee,
        profile: proposedProfile,
        contracts: proposedContracts,
        performance: proposedPerformance,
      }),
      validationErrors: this.toJson([]),
      createdById: operator.id,
      rejectedReason: null,
    };
    if (existing) {
      return employeeDataChangeView(await client.employeeDataChangeRequest.update({
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
      }));
    }
    return employeeDataChangeView(await client.employeeDataChangeRequest.create({
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
    }));
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
      if (changedUserIds.length === 0) return { submitted: 0 };

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

      for (const userId of changedUserIds) {
        await this.persistArchiveChangeWithClient(tx, userId, {
          employee: { deptId: departmentId },
          profile: {},
        }, operator, 'submitted');
      }
      return { submitted: changedUserIds.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    const proposedEmployee = {
      ...baseEmployee,
      company: input.company,
      deptId: input.deptId ?? null,
      positionId: position?.id ?? null,
      position: position?.name ?? input.position ?? null,
      jobGrade: input.jobGrade ?? null,
      jobFamily: position?.jobFamily ?? input.jobFamily ?? null,
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
    };
    const profile = this.profileReviewData(user.employeeProfile);
    return employeeDataChangeView(await this.prisma.employeeDataChangeRequest.create({
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
