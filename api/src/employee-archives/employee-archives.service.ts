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
import type { SubmitEmployeeArchiveDraftDto } from './dto/employee-archive.dto';

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
  ) {}

  async findOne(userId: string) {
    const archive = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
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
    const [dingtalkBinding] = archive.externalIdentityBindings;
    const now = new Date();
    const currentEmployment = archive.employmentHistory.find((record) => (
      record.effectiveFrom <= now
      && (!record.effectiveTo || record.effectiveTo >= now)
    )) ?? null;
    return {
      ...archive,
      employeeProfile: archive.employeeProfile ? {
        ...archive.employeeProfile,
        idNumberConfigured: Boolean(archive.employeeProfile.idNumberFingerprint),
        bankAccountConfigured: Boolean(archive.employeeProfile.bankAccountFingerprint),
        idNumberFingerprint: undefined,
        bankAccountFingerprint: undefined,
      } : null,
      currentEmployment,
      performanceManager: archive.directManager,
      rosterManager: currentEmployment?.directManager ?? null,
      directManager: undefined,
      dingtalkBindingState: !dingtalkBinding ? 'unbound' : dingtalkBinding.status,
      dingtalkBinding: dingtalkBinding ?? null,
      externalIdentityBindings: undefined,
    };
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

    const currentEmployment = user.employmentHistory[0] ?? null;
    const currentProfile = this.profileReviewData(user.employeeProfile);
    const proposedProfile = {
      ...currentProfile,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
    };
    const employee = this.employeeReviewData(user, currentEmployment, input.phone);
    const pending = await this.prisma.employeeDataChangeRequest.findFirst({
      where: { userId, sourceType: 'manual_profile_change', profileReviewStatus: 'pending' },
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
      return this.prisma.employeeDataChangeRequest.update({
        where: { id: pending.id },
        data,
      });
    }
    return this.prisma.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_profile_change',
        ...data,
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
      },
    });
  }

  async submitDraft(userId: string, input: SubmitEmployeeArchiveDraftDto, operator: AuthUser) {
    return this.submitDraftWithClient(this.prisma, userId, input, operator);
  }

  private async submitDraftWithClient(
    client: Pick<Prisma.TransactionClient, 'user' | 'employeeDataChangeRequest'>,
    userId: string,
    input: SubmitEmployeeArchiveDraftDto,
    operator: AuthUser,
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

    const employment = user.employmentHistory[0] ?? null;
    const baseEmployee = this.employeeReviewData(user, employment);
    const baseProfile = this.profileReviewData(user.employeeProfile);
    const baseContracts = user.employeeContracts.map((contract) => this.contractReviewData(contract));
    const proposedEmployee = { ...baseEmployee, ...input.employee };
    const proposedProfile: Record<string, unknown> = { ...baseProfile, ...input.profile };
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
    const performanceChanged = (proposedPerformance.managerId ?? null) !== (user.directManagerId ?? null);

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
    const pending = await client.employeeDataChangeRequest.findFirst({
      where: { userId, sourceType: 'manual_archive_change', profileReviewStatus: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      return client.employeeDataChangeRequest.update({
        where: { id: pending.id },
        data: {
          ...data,
          performanceReviewStatus: performanceChanged ? 'pending' : 'not_required',
        },
      });
    }
    return client.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_archive_change',
        ...data,
        profileReviewStatus: 'pending',
        performanceReviewStatus: performanceChanged ? 'pending' : 'not_required',
      },
    });
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
        where: { userId: { in: changedUserIds }, profileReviewStatus: 'pending' },
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
        await this.submitDraftWithClient(tx, userId, {
          employee: { deptId: departmentId },
          profile: {},
        }, operator);
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

    const overlap = await this.prisma.employmentRecord.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: input.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: input.effectiveFrom } },
        ],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '任职生效区间与现有记录重叠',
      });
    }

    const currentEmployment = user.employmentHistory[0] ?? null;
    const baseEmployee = this.employeeReviewData(user, currentEmployment);
    const proposedEmployee = {
      ...baseEmployee,
      company: input.company,
      deptId: input.deptId ?? null,
      position: input.position ?? null,
      jobGrade: input.jobGrade ?? null,
      jobFamily: input.jobFamily ?? null,
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
    return this.prisma.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_employment_change',
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
        createdById: operator.id,
      },
    });
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
      Object.entries(contract).filter(([key]) => !['userId', 'createdAt', 'updatedAt', 'sourceBatchId', 'createdById'].includes(key)),
    );
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

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
