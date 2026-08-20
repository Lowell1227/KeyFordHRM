import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class EmployeeArchivesService {
  constructor(private readonly prisma: PrismaService) {}

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
      currentEmployment,
      dingtalkBindingState: !dingtalkBinding ? 'unbound' : dingtalkBinding.status,
      dingtalkBinding: dingtalkBinding ?? null,
      externalIdentityBindings: undefined,
    };
  }

  async upsertProfile(userId: string, input: UpsertEmployeeProfileInput, operator: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '员工不存在',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.employeeProfile.upsert({
        where: { userId },
        create: {
          userId,
          phone: input.phone,
          gender: input.gender,
        },
        update: {
          phone: input.phone,
          gender: input.gender,
        },
      });

      if (input.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { phone: input.phone },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'upsert_employee_profile',
          entityType: 'employee_profile',
          entityId: profile.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            userId,
            phone: input.phone ?? null,
            gender: input.gender ?? null,
          },
        },
      });

      return profile;
    });
  }

  async createEmploymentRecord(userId: string, input: CreateEmploymentRecordInput, operator: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '员工不存在',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.employmentRecord.findFirst({
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

      const employment = await tx.employmentRecord.create({
        data: {
          userId,
          ...input,
          createdById: operator.id,
        },
      });

      if (this.isCurrentEmployment(input)) {
        await tx.user.update({
          where: { id: userId },
          data: {
            deptId: input.deptId,
            position: input.position,
            directManagerId: input.directManagerId,
            entryDate: input.entryDate,
            plannedRegularDate: input.plannedRegularDate,
            actualRegularDate: input.actualRegularDate,
            leaveDate: input.leaveDate,
            employmentType: input.employmentType,
            status: input.employeeStatus,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'create_employment_record',
          entityType: 'employment_record',
          entityId: employment.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            userId,
            effectiveFrom: input.effectiveFrom.toISOString(),
            effectiveTo: input.effectiveTo?.toISOString() ?? null,
            company: input.company,
            deptId: input.deptId ?? null,
            position: input.position ?? null,
            directManagerId: input.directManagerId ?? null,
            employeeStatus: input.employeeStatus,
            changeType: input.changeType,
          },
        },
      });

      return employment;
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

  private isCurrentEmployment(input: CreateEmploymentRecordInput): boolean {
    const now = new Date();
    return input.effectiveFrom <= now && (!input.effectiveTo || input.effectiveTo >= now);
  }
}
