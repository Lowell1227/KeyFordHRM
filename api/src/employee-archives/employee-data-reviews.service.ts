import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  CompanyCode,
  EmploymentType,
  ExternalIdentityStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export type EmployeeReviewScope = 'profile' | 'performance';

export interface ApproveEmployeeReviewsInput {
  requestIds: string[];
  scopes: EmployeeReviewScope[];
}

export interface EmployeeReviewBatchResult {
  succeeded: Array<{ requestId: string; scopes: EmployeeReviewScope[] }>;
  failed: Array<{ requestId: string; reason: string }>;
}

export interface ProposePerformanceManagerInput {
  managerId: string | null;
}

export interface EmployeeReviewQuery {
  page: number;
  pageSize: number;
  status?: 'pending' | 'approved' | 'rejected' | 'all';
  keyword?: string;
}

@Injectable()
export class EmployeeDataReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: EmployeeReviewQuery) {
    const where: Prisma.EmployeeDataChangeRequestWhereInput = {};
    const filters: Prisma.EmployeeDataChangeRequestWhereInput[] = [];
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      filters.push({
        OR: [
          { employeeName: { contains: keyword, mode: 'insensitive' } },
          { employeeNo: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }
    if (!query.status || query.status === 'pending') {
      filters.push({
        OR: [
          { profileReviewStatus: 'pending' },
          { performanceReviewStatus: 'pending' },
        ],
      });
    } else if (query.status === 'rejected') {
      filters.push({
        OR: [
          { profileReviewStatus: 'rejected' },
          { performanceReviewStatus: 'rejected' },
        ],
      });
    } else if (query.status === 'approved') {
      filters.push({ AND: [
        { profileReviewStatus: { in: ['approved', 'not_required'] } },
        { performanceReviewStatus: { in: ['approved', 'not_required'] } },
      ] });
    }
    if (filters.length > 0) where.AND = filters;
    const [items, total] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.employeeDataChangeRequest.count({ where }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async proposePerformanceManager(
    userId: string,
    input: ProposePerformanceManagerInput,
    operator: AuthUser,
  ) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        deletedAt: null,
        accountType: AccountType.employee,
        status: { not: UserStatus.resigned },
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        directManagerId: true,
        deletedAt: true,
        dept: { select: { parentId: true, leaderId: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }
    if (input.managerId === userId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不能是员工本人' });
    }
    if (input.managerId) {
      const manager = await this.prisma.user.findUnique({
        where: {
          id: input.managerId,
          deletedAt: null,
          accountType: AccountType.employee,
          status: { not: UserStatus.resigned },
        },
        select: { id: true, name: true },
      });
      if (!manager) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不存在或已停用' });
      }
    } else if (user.dept?.parentId !== null || user.dept.leaderId !== userId) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '只有组织最高负责人可以不设置绩效直属上级',
      });
    }

    const pending = await this.prisma.employeeDataChangeRequest.findFirst({
      where: {
        userId,
        performanceReviewStatus: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = {
      baseValue: { performance: { managerId: user.directManagerId } },
      proposedValue: { performance: { managerId: input.managerId } },
      validationErrors: [],
      createdById: operator.id,
    };
    if (pending) {
      const pendingProposed = this.record(pending.proposedValue);
      return this.prisma.employeeDataChangeRequest.update({
        where: { id: pending.id },
        data: {
          proposedValue: {
            ...pendingProposed,
            performance: { managerId: input.managerId },
          },
          validationErrors: this.stringArray(pending.validationErrors)
            .filter((error) => !error.includes('绩效直属上级')),
          createdById: operator.id,
          rejectedReason: null,
        },
      });
    }
    return this.prisma.employeeDataChangeRequest.create({
      data: {
        userId,
        employeeNo: user.employeeNo,
        employeeName: user.name,
        sourceType: 'manual_performance_relation',
        ...data,
        profileReviewStatus: 'not_required',
        performanceReviewStatus: 'pending',
      },
    });
  }

  async setPendingPerformanceManager(
    requestId: string,
    managerId: string,
    operator: AuthUser,
  ) {
    const [request, manager] = await Promise.all([
      this.prisma.employeeDataChangeRequest.findUnique({ where: { id: requestId } }),
      this.prisma.user.findUnique({
        where: {
          id: managerId,
          deletedAt: null,
          accountType: AccountType.employee,
          status: { not: UserStatus.resigned },
        },
        select: { id: true, name: true, deletedAt: true },
      }),
    ]);
    if (!request) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '审核记录不存在' });
    }
    if (request.performanceReviewStatus !== 'pending') {
      throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: '绩效关系审核已处理' });
    }
    if (!manager || manager.deletedAt) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不存在或已停用' });
    }
    if (request.userId === managerId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不能是员工本人' });
    }
    const proposed = this.record(request.proposedValue);
    const updatedProposed = {
      ...proposed,
      performance: { managerName: manager.name, managerId },
    };
    return this.prisma.employeeDataChangeRequest.update({
      where: { id: requestId },
      data: {
        proposedValue: updatedProposed as Prisma.InputJsonValue,
        validationErrors: this.stringArray(request.validationErrors)
          .filter((error) => !error.includes('绩效直属上级')),
        rejectedReason: null,
        createdById: operator.id,
      },
    });
  }

  async approveBatch(
    input: ApproveEmployeeReviewsInput,
    operator: AuthUser,
  ): Promise<EmployeeReviewBatchResult> {
    const requestIds = [...new Set(input.requestIds)];
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请选择审核范围' });
    }

    const succeededByRequest = new Map<string, EmployeeReviewScope[]>();
    const failedByRequest = new Map<string, string>();
    const addSucceeded = (requestId: string, scope: EmployeeReviewScope) => {
      const applied = succeededByRequest.get(requestId) ?? [];
      if (!applied.includes(scope)) applied.push(scope);
      succeededByRequest.set(requestId, applied);
    };

    const approveScope = async (requestId: string, scope: EmployeeReviewScope): Promise<boolean> => (
      this.prisma.$transaction(async (tx) => {
        const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
        if (!request) {
          throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '审核记录不存在' });
        }
        const status = scope === 'profile'
          ? request.profileReviewStatus
          : request.performanceReviewStatus;
        if (status !== 'pending') return false;

        const errors = this.stringArray(request.validationErrors);
        const relevantError = scope === 'performance'
          ? errors.find((error) => error.includes('绩效直属上级'))
          : errors.find((error) => !error.includes('绩效直属上级'));
        if (relevantError) {
          throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: relevantError });
        }

        const claimed = scope === 'profile'
          ? await tx.employeeDataChangeRequest.updateMany({
            where: { id: requestId, profileReviewStatus: 'pending' },
            data: { profileReviewStatus: 'applying' },
          })
          : await tx.employeeDataChangeRequest.updateMany({
            where: { id: requestId, performanceReviewStatus: 'pending' },
            data: { performanceReviewStatus: 'applying' },
          });
        if (claimed.count !== 1) return false;

        let subjectUserId = request.userId;
        if (scope === 'profile') {
          subjectUserId = await this.applyProfile(tx, request, operator);
        } else {
          await this.applyPerformanceRelation(tx, request);
        }

        const now = new Date();
        const updateData: Prisma.EmployeeDataChangeRequestUncheckedUpdateInput = {};
        if (scope === 'profile') {
          updateData.profileReviewStatus = 'approved';
          updateData.profileReviewedAt = now;
          updateData.profileReviewedById = operator.id;
          updateData.userId = subjectUserId;
          if (request.performanceReviewStatus !== 'pending') updateData.appliedAt = now;
        } else {
          updateData.performanceReviewStatus = 'approved';
          updateData.performanceReviewedAt = now;
          updateData.performanceReviewedById = operator.id;
          if (request.profileReviewStatus !== 'pending') updateData.appliedAt = now;
        }
        await tx.employeeDataChangeRequest.update({ where: { id: requestId }, data: updateData });
        if (scope === 'profile' && request.sourceType === 'employee_roster_import' && request.sourceBatchId) {
          await this.finalizeFullRosterOrganizationIfReady(tx, request.sourceBatchId);
        }
        if (request.sourceType === 'employee_roster_import' && request.sourceBatchId) {
          await this.completeImportBatchIfReady(tx, request.sourceBatchId);
        }
        await tx.auditLog.create({
          data: {
            userId: operator.id,
            action: 'approve_employee_data_change',
            entityType: 'employee_data_change_request',
            entityId: requestId,
            newValue: { scopes: [scope] },
          },
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    );

    // 先通过基础档案，确保同批次新员工均已建立，再解析绩效关系。
    for (const scope of ['profile', 'performance'] as EmployeeReviewScope[]) {
      if (!scopes.includes(scope)) continue;
      let queue = [...requestIds];
      while (queue.length > 0) {
        const deferred: string[] = [];
        let progressed = false;
        for (const requestId of queue) {
          try {
            if (await approveScope(requestId, scope)) {
              addSucceeded(requestId, scope);
              progressed = true;
            }
          } catch (error) {
            const message = this.errorMessage(error);
            if (scope === 'profile' && message.includes('花名册直属主管') && message.includes('无法唯一匹配')) {
              deferred.push(requestId);
              continue;
            }
            if (!failedByRequest.has(requestId)) failedByRequest.set(requestId, message);
          }
        }
        if (deferred.length === 0) break;
        if (!progressed) {
          for (const requestId of deferred) {
            if (!failedByRequest.has(requestId)) {
              failedByRequest.set(requestId, '花名册直属主管无法唯一匹配');
            }
          }
          break;
        }
        queue = deferred;
      }
    }

    const result: EmployeeReviewBatchResult = { succeeded: [], failed: [] };
    for (const requestId of requestIds) {
      const appliedScopes = succeededByRequest.get(requestId);
      if (appliedScopes?.length) result.succeeded.push({ requestId, scopes: appliedScopes });
      const reason = failedByRequest.get(requestId);
      if (reason) result.failed.push({ requestId, reason });
      if (!appliedScopes?.length && !reason) {
        result.failed.push({ requestId, reason: '该记录已处理' });
      }
    }
    return result;
  }

  private async applyProfile(
    tx: Prisma.TransactionClient,
    request: {
      userId: string | null;
      sourceBatchId: string | null;
      sourceType: string;
      baseValue: Prisma.JsonValue;
      proposedValue: Prisma.JsonValue;
    },
    operator: AuthUser,
  ): Promise<string> {
    const proposed = this.record(request.proposedValue);
    const employee = this.record(proposed.employee);
    const name = this.requiredString(employee.name, '姓名不能为空');
    const employeeNo = this.requiredString(employee.employeeNo, '工号不能为空');
    const company = this.enumValue(employee.company, Object.values(CompanyCode), CompanyCode.fuede);
    const organizationPath = this.stringArrayValue(employee.organizationPath);
    const organizationNodes = Array.isArray(employee.organizationNodes)
      ? employee.organizationNodes.map((item) => this.record(item))
      : [];
    let deptId = this.nullableString(employee.deptId);
    if (organizationPath.length > 0) {
      deptId = (await this.ensureReviewedDepartmentPath(tx, organizationPath, company, organizationNodes)).id;
      employee.deptId = deptId;
    }
    const organizationEnsurePaths = Array.isArray(employee.organizationEnsurePaths)
      ? employee.organizationEnsurePaths
        .map((item) => this.stringArrayValue(item))
        .filter((path) => path.length > 0)
      : [];
    for (const ensurePath of organizationEnsurePaths) {
      await this.ensureReviewedDepartmentPath(tx, ensurePath, company, organizationNodes);
    }
    if (!deptId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '所属部门不能为空' });
    }
    const entryDate = this.requiredDate(employee.entryDate, '入职日期不能为空');
    const employmentType = this.enumValue(employee.employmentType, Object.values(EmploymentType), EmploymentType.full_time);
    const employeeStatus = this.enumValue(employee.employeeStatus, Object.values(UserStatus), UserStatus.active);
    const phone = this.nullableString(employee.phone);
    const position = this.nullableString(employee.position);
    const plannedRegularDate = this.nullableDate(employee.plannedRegularDate);
    const actualRegularDate = this.nullableDate(employee.actualRegularDate);
    const leaveDate = this.nullableDate(employee.leaveDate);
    const isManualEmployment = request.sourceType === 'manual_employment_change';
    const today = this.startOfUtcDay(new Date());
    const effectiveFrom = isManualEmployment
      ? this.requiredDate(employee.effectiveFrom, '任职生效日期不能为空')
      : request.userId ? today : entryDate;
    const effectiveTo = isManualEmployment
      ? this.nullableDate(employee.effectiveTo)
      : employeeStatus === UserStatus.resigned ? today : null;
    const shouldUpdateUserProjection = !isManualEmployment
      || (effectiveFrom <= today && (!effectiveTo || effectiveTo >= today));
    if (request.userId) {
      await this.assertProfileBaseStillCurrent(tx, request.userId, request.baseValue, request.proposedValue);
    }

    const projection = {
      employeeNo,
      name,
      phone,
      deptId,
      position,
      entryDate,
      plannedRegularDate,
      actualRegularDate,
      employmentType,
      status: employeeStatus,
      accountType: AccountType.employee,
      leaveDate,
    };
    const initialPasswordHash = request.userId ? null : await bcrypt.hash('0000', 10);
    const userId = request.userId
      ? request.userId
      : (await tx.user.create({
        data: {
          ...projection,
          directManagerId: null,
          passwordHash: initialPasswordHash,
          mustChangePassword: true,
        },
        select: { id: true },
      })).id;
    if (request.userId && shouldUpdateUserProjection) {
      await tx.user.update({ where: { id: request.userId }, data: projection });
    }

    const profile = this.profileUpdate(this.record(proposed.profile));
    if (Object.keys(profile).length > 0) {
      await tx.employeeProfile.upsert({
        where: { userId },
        create: { userId, ...profile } as Prisma.EmployeeProfileUncheckedCreateInput,
        update: profile as Prisma.EmployeeProfileUncheckedUpdateInput,
      });
    }

    const performance = this.record(proposed.performance);
    const rosterManagerName = this.nullableString(employee.managerName);
    let rosterManagerId = this.nullableString(employee.managerId);
    if (!rosterManagerId && rosterManagerName) {
      const suggestedName = this.nullableString(performance.managerName);
      const suggestedId = this.nullableString(performance.managerId);
      if (suggestedId && suggestedName === rosterManagerName) {
        rosterManagerId = suggestedId;
      } else {
        const candidates = await tx.user.findMany({
          where: {
            name: rosterManagerName,
            deletedAt: null,
            accountType: AccountType.employee,
            status: { not: UserStatus.resigned },
          },
          select: { id: true },
          take: 2,
        });
        if (candidates.length !== 1) {
          throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: `花名册直属主管“${rosterManagerName}”无法唯一匹配` });
        }
        rosterManagerId = candidates[0].id;
      }
    }

    const employmentData = {
      userId,
      company,
      deptId,
      position,
      jobGrade: this.nullableString(employee.jobGrade),
      jobFamily: this.nullableString(employee.jobFamily),
      directManagerId: rosterManagerId,
      workLocation: this.nullableString(employee.workLocation),
      employmentType,
      employeeStatus,
      entryDate,
      plannedRegularDate,
      actualRegularDate,
      leaveDate,
      probationMonths: typeof employee.probationMonths === 'number' ? employee.probationMonths : null,
      changeType: request.userId ? 'data_correction' : 'hire',
      reason: '员工档案审核通过',
      sourceType: 'employee_data_review',
      sourceBatchId: request.sourceBatchId,
      createdById: operator.id,
    };
    const baseEmployee = this.record(this.record(request.baseValue).employee);
    const shouldWriteEmployment = !request.userId
      || isManualEmployment
      || this.hasEmploymentChange(baseEmployee, employee);
    const currentEmployment = request.userId && shouldWriteEmployment && !isManualEmployment
      ? await tx.employmentRecord.findFirst({
        where: {
          userId,
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        select: { id: true, effectiveFrom: true },
      })
      : null;
    let updatedSameDayEmployment = false;
    if (currentEmployment?.effectiveFrom.getTime() === effectiveFrom.getTime()) {
      await tx.employmentRecord.update({
        where: { id: currentEmployment.id },
        data: {
          ...employmentData,
          effectiveFrom,
          effectiveTo,
          changeType: this.nullableString(employee.changeType) ?? employmentData.changeType,
        },
      });
      updatedSameDayEmployment = true;
    } else if (currentEmployment) {
      const yesterday = new Date(today.getTime() - 86_400_000);
      await tx.employmentRecord.update({
        where: { id: currentEmployment.id },
        data: { effectiveTo: yesterday },
      });
    }
    if (shouldWriteEmployment && !updatedSameDayEmployment) {
      await tx.employmentRecord.create({
        data: {
          ...employmentData,
          effectiveFrom,
          effectiveTo,
          changeType: this.nullableString(employee.changeType) ?? employmentData.changeType,
        },
      });
    }

    if (employeeStatus === UserStatus.resigned) {
      await tx.externalIdentityBinding.updateMany({
        where: {
          userId,
          status: ExternalIdentityStatus.enabled,
          endedAt: null,
        },
        data: {
          status: ExternalIdentityStatus.disabled,
          disabledAt: new Date(),
          disabledById: operator.id,
          disabledReason: '员工档案审核为离职',
        },
      });
    }

    if (request.sourceType === 'employee_roster_import' || request.sourceType === 'manual_archive_change') {
      const contracts = Array.isArray(proposed.contracts)
        ? proposed.contracts.map((item) => this.record(item))
        : [];
      await this.reconcileRosterContracts(tx, userId, employee, contracts, request.sourceBatchId, operator);
    }
    const organizationLeaderPaths = Array.isArray(employee.organizationLeaderPaths)
      ? employee.organizationLeaderPaths
        .map((item) => this.stringArrayValue(item))
        .filter((path) => path.length > 0)
      : [];
    const baseOrganizationLeaders = this.record(this.record(request.baseValue).organizationLeaders);
    for (const leaderPath of organizationLeaderPaths) {
      const department = await this.ensureReviewedDepartmentPath(tx, leaderPath, company, organizationNodes);
      const fullPath = leaderPath.join(' / ');
      const baseLeaderId = this.nullableString(baseOrganizationLeaders[fullPath]);
      if ((department.leaderId ?? null) !== baseLeaderId && department.leaderId !== userId) {
        throw new BadRequestException({
          code: ERROR_CODE.CONFLICT,
          message: `部门“${fullPath}”负责人已发生变化，请重新提交审核`,
        });
      }
      await tx.department.update({
        where: { id: department.id },
        data: { leaderId: userId },
      });
    }
    return userId;
  }

  private async applyPerformanceRelation(
    tx: Prisma.TransactionClient,
    request: {
      userId: string | null;
      baseValue: Prisma.JsonValue;
      proposedValue: Prisma.JsonValue;
    },
  ): Promise<void> {
    if (!request.userId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请先通过基础档案审核' });
    }
    const proposed = this.record(request.proposedValue);
    const performance = this.record(proposed.performance);
    const basePerformance = this.record(this.record(request.baseValue).performance);
    let managerId = typeof performance.managerId === 'string' ? performance.managerId : null;
    const managerName = this.nullableString(performance.managerName);
    if (!managerId && managerName) {
      const candidates = await tx.user.findMany({
        where: {
          name: managerName,
          deletedAt: null,
          accountType: AccountType.employee,
          status: { not: UserStatus.resigned },
        },
        select: { id: true },
        take: 2,
      });
      if (candidates.length === 1) managerId = candidates[0].id;
    }
    const subject = await tx.user.findUnique({
      where: { id: request.userId },
      select: {
        directManagerId: true,
        dept: { select: { parentId: true, leaderId: true } },
      },
    });
    const baseManagerId = this.nullableString(basePerformance.managerId);
    if ((subject?.directManagerId ?? null) !== baseManagerId) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '正式绩效直属上级已发生变化，请重新提交审核',
      });
    }
    if (!managerId) {
      if (subject?.dept?.parentId !== null || subject.dept.leaderId !== request.userId) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级待设置' });
      }
      await tx.user.update({
        where: { id: request.userId },
        data: { directManagerId: null },
      });
      return;
    }
    if (managerId === request.userId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不能是员工本人' });
    }
    const manager = await tx.user.findUnique({
      where: {
        id: managerId,
        deletedAt: null,
        accountType: AccountType.employee,
        status: { not: UserStatus.resigned },
      },
      select: { id: true, deletedAt: true, directManagerId: true },
    });
    if (!manager || manager.deletedAt) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级不存在或已停用' });
    }

    let ancestorId: string | null = managerId;
    const visited = new Set<string>();
    while (ancestorId) {
      if (ancestorId === request.userId) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '绩效直属上级关系不能形成循环' });
      }
      if (visited.has(ancestorId)) break;
      visited.add(ancestorId);
      const ancestor: { directManagerId: string | null } | null = await tx.user.findUnique({
        where: { id: ancestorId },
        select: { directManagerId: true },
      });
      ancestorId = ancestor?.directManagerId ?? null;
    }

    await tx.user.update({
      where: { id: request.userId },
      data: { directManagerId: managerId },
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private profileUpdate(value: Record<string, unknown>): Record<string, unknown> {
    const allowedFields = new Set([
      'phone', 'gender', 'birthDate', 'ethnicity', 'education', 'professionalTitle', 'school',
      'graduationDate', 'major', 'maritalStatus', 'childrenStatus', 'childrenCount', 'politicalStatus',
      'nativePlace', 'householdType', 'idAddress', 'idNumberEncrypted', 'idNumberFingerprint',
      'currentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
      'socialSecurityStatus', 'socialSecurityStartDate', 'housingFundStatus', 'housingFundStartDate',
      'bankName', 'bankBranch', 'bankAccountEncrypted', 'bankAccountFingerprint',
    ]);
    const dateFields = new Set([
      'birthDate',
      'graduationDate',
      'socialSecurityStartDate',
      'housingFundStartDate',
    ]);
    const byteFields = new Set(['idNumberEncrypted', 'bankAccountEncrypted']);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || !allowedFields.has(key)) continue;
      if (dateFields.has(key)) result[key] = this.nullableDate(item);
      else if (byteFields.has(key)) result[key] = this.bufferValue(item);
      else result[key] = item;
    }
    return result;
  }

  private hasEmploymentChange(
    base: Record<string, unknown>,
    proposed: Record<string, unknown>,
  ): boolean {
    const keys = [
      'company', 'deptId', 'position', 'jobGrade', 'jobFamily', 'managerId', 'managerName',
      'workLocation', 'employmentType', 'employeeStatus', 'entryDate', 'plannedRegularDate',
      'actualRegularDate', 'leaveDate', 'probationMonths',
    ];
    return keys.some((key) => this.comparableValue(base[key]) !== this.comparableValue(proposed[key]));
  }

  private comparableValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'null';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private stringArrayValue(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
  }

  private async ensureReviewedDepartmentPath(
    tx: Prisma.TransactionClient,
    path: string[],
    fallbackCompany: CompanyCode,
    organizationNodes: Record<string, unknown>[],
  ): Promise<{ id: string; leaderId: string | null }> {
    let parentId: string | null = null;
    let leaf: { id: string; leaderId: string | null } | null = null;
    for (let index = 0; index < path.length; index++) {
      const segments = path.slice(0, index + 1);
      const fullPath = segments.join(' / ');
      const node = organizationNodes.find((item) => item.fullPath === fullPath);
      const company = this.enumValue(node?.company, Object.values(CompanyCode), fallbackCompany);
      const existing = await tx.department.findMany({
        where: {
          OR: [
            { fullPath },
            { name: segments.at(-1)! },
          ],
        },
        select: { id: true, leaderId: true, fullPath: true },
      });
      const exact = existing.filter((item) => (
        item.fullPath?.replaceAll('／', '/').replace(/\s*\/\s*/g, '/').trim()
          === fullPath.replaceAll('／', '/').replace(/\s*\/\s*/g, '/').trim()
      ));
      if (exact.length > 1) {
        throw new BadRequestException({ code: ERROR_CODE.CONFLICT, message: `组织路径“${fullPath}”存在重复，请先清理` });
      }
      if (exact.length === 1) {
        await tx.department.update({
          where: { id: exact[0].id },
          data: {
            name: segments.at(-1)!,
            fullPath,
            parentId,
            company,
            sortOrder: typeof node?.sortOrder === 'number' ? node.sortOrder : index,
            isActive: true,
            dingtalkDeptId: null,
          },
        });
        leaf = exact[0];
      } else {
        leaf = await tx.department.create({
          data: {
            name: segments.at(-1)!,
            fullPath,
            parentId,
            company,
            sortOrder: typeof node?.sortOrder === 'number' ? node.sortOrder : index,
            isActive: true,
          },
          select: { id: true, leaderId: true },
        });
      }
      parentId = leaf.id;
    }
    if (!leaf) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '所属部门路径不能为空' });
    }
    return leaf;
  }

  private async assertProfileBaseStillCurrent(
    tx: Prisma.TransactionClient,
    userId: string,
    baseValue: Prisma.JsonValue,
    proposedValue: Prisma.JsonValue,
  ): Promise<void> {
    const base = this.record(baseValue);
    const baseEmployee = this.record(base.employee);
    const baseProfile = this.record(base.profile);
    const baseProfileExists = typeof base.profileExists === 'boolean' ? base.profileExists : null;
    const baseContracts = Array.isArray(base.contracts)
      ? base.contracts.map((item) => this.record(item))
      : null;
    if (
      Object.keys(baseEmployee).length === 0
      && Object.keys(baseProfile).length === 0
      && baseProfileExists === null
      && baseContracts === null
    ) return;
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: {
        employeeNo: true,
        name: true,
        phone: true,
        deptId: true,
        position: true,
        entryDate: true,
        plannedRegularDate: true,
        actualRegularDate: true,
        leaveDate: true,
        employmentType: true,
        status: true,
        employeeProfile: true,
        employeeContracts: {
          where: { isActive: true },
          select: {
            contractType: true,
            sequence: true,
            name: true,
            signedAt: true,
            expiresAt: true,
            termType: true,
            originalCompany: true,
            newCompany: true,
            confidentialityAgreement: true,
            nonCompeteAgreement: true,
            portraitAgreement: true,
          },
        },
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { directManager: { select: { name: true } } },
        },
      },
    });
    if (!current) {
      throw new BadRequestException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在或已停用' });
    }
    const employment = current.employmentHistory[0];
    const currentEmployee: Record<string, unknown> = {
      employeeNo: current.employeeNo,
      name: current.name,
      phone: current.phone,
      company: employment?.company ?? null,
      deptId: current.deptId,
      position: current.position,
      jobGrade: employment?.jobGrade ?? null,
      jobFamily: employment?.jobFamily ?? null,
      managerId: employment?.directManagerId ?? null,
      managerName: employment?.directManager?.name ?? null,
      workLocation: employment?.workLocation ?? null,
      entryDate: current.entryDate,
      plannedRegularDate: current.plannedRegularDate,
      actualRegularDate: current.actualRegularDate,
      leaveDate: current.leaveDate,
      probationMonths: employment?.probationMonths ?? null,
      employmentType: current.employmentType,
      employeeStatus: current.status,
    };
    const employeeKeys = Object.keys(baseEmployee)
      .filter((key) => ![
        'organizationPath', 'organizationLeaderPaths', 'organizationNodes', 'organizationEnsurePaths',
      ].includes(key));
    const staleEmployeeField = employeeKeys.some((key) => (
      this.comparableValue(currentEmployee[key]) !== this.comparableValue(baseEmployee[key])
    ));
    const currentProfile = this.record(current.employeeProfile);
    const profileKeys = Object.keys(baseProfile)
      .filter((key) => !['id', 'userId', 'createdAt', 'updatedAt', 'idNumberEncrypted', 'bankAccountEncrypted'].includes(key));
    const staleProfileField = profileKeys.some((key) => (
      this.comparableValue(currentProfile[key]) !== this.comparableValue(baseProfile[key])
    ));
    const staleProfileExistence = baseProfileExists !== null
      && Boolean(current.employeeProfile) !== baseProfileExists;
    const staleContracts = baseContracts !== null
      && !this.sameContractSet(current.employeeContracts, baseContracts);
    if (staleEmployeeField || staleProfileField || staleProfileExistence || staleContracts) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '正式基础档案已发生变化，请重新提交审核',
      });
    }
  }

  private async reconcileRosterContracts(
    tx: Prisma.TransactionClient,
    userId: string,
    employee: Record<string, unknown>,
    contracts: Record<string, unknown>[],
    sourceBatchId: string | null,
    operator: AuthUser,
  ): Promise<void> {
    const currentActive = await tx.employeeContract.findMany({
      where: { userId, isActive: true },
      select: { id: true, contractType: true, sequence: true },
    });
    const proposedKeys = new Set<string>();
    for (const [index, contract] of contracts.entries()) {
      const contractType = this.nullableString(contract.kind ?? contract.contractType) ?? 'contract';
      const sequence = typeof contract.sequence === 'number' ? contract.sequence : index;
      proposedKeys.add(this.contractKey(contractType, sequence));
      const contractData = {
        name: this.nullableString(contract.name),
        signingCompany: this.nullableString(contract.signingCompany ?? employee.companyText),
        signedAt: this.nullableDate(contract.signedAt),
        effectiveFrom: this.nullableDate(contract.signedAt),
        expiresAt: this.nullableDate(contract.expiresAt),
        termType: this.nullableString(contract.termText ?? contract.termType),
        originalCompany: this.nullableString(contract.originalCompany),
        newCompany: this.nullableString(contract.newCompany),
        confidentialityAgreement: this.nullableString(contract.confidentialityAgreement),
        nonCompeteAgreement: this.nullableString(contract.nonCompeteAgreement),
        portraitAgreement: this.nullableString(contract.portraitAgreement),
        sourceBatchId,
        createdById: operator.id,
        isActive: true,
        endedAt: null,
      };
      const activeContract = currentActive.find((item) => (
        item.contractType === contractType && item.sequence === sequence
      ));
      if (activeContract) {
        await tx.employeeContract.update({
          where: { id: activeContract.id },
          data: contractData,
        });
      } else {
        await tx.employeeContract.create({
          data: { userId, contractType, sequence, ...contractData },
        });
      }
    }
    const endedAt = new Date();
    for (const contract of currentActive) {
      if (proposedKeys.has(this.contractKey(contract.contractType, contract.sequence))) continue;
      await tx.employeeContract.update({
        where: { id: contract.id },
        data: { isActive: false, endedAt },
      });
    }
  }

  private sameContractSet(
    left: Record<string, unknown>[],
    right: Record<string, unknown>[],
  ): boolean {
    const normalize = (contract: Record<string, unknown>) => ({
      contractType: this.nullableString(contract.contractType ?? contract.kind) ?? 'contract',
      sequence: typeof contract.sequence === 'number' ? contract.sequence : 0,
      name: this.nullableString(contract.name),
      signedAt: this.comparableValue(contract.signedAt),
      expiresAt: this.comparableValue(contract.expiresAt),
      termType: this.nullableString(contract.termType ?? contract.termText),
      originalCompany: this.nullableString(contract.originalCompany),
      newCompany: this.nullableString(contract.newCompany),
      confidentialityAgreement: this.nullableString(contract.confidentialityAgreement),
      nonCompeteAgreement: this.nullableString(contract.nonCompeteAgreement),
      portraitAgreement: this.nullableString(contract.portraitAgreement),
    });
    const sort = (items: Record<string, unknown>[]) => items
      .map(normalize)
      .sort((a, b) => this.contractKey(a.contractType, a.sequence).localeCompare(this.contractKey(b.contractType, b.sequence)));
    return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
  }

  private contractKey(contractType: string, sequence: number): string {
    return `${contractType}:${sequence}`;
  }

  private async finalizeFullRosterOrganizationIfReady(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<void> {
    const remainingProfiles = await tx.employeeDataChangeRequest.count({
      where: {
        sourceBatchId: batchId,
        profileReviewStatus: { in: ['pending', 'applying'] },
      },
    });
    if (remainingProfiles > 0) return;
    const batch = await tx.employeeImportBatch.findUnique({
      where: { id: batchId },
      select: { mode: true, summary: true },
    });
    if (!batch || batch.mode !== 'full') return;
    const summary = this.record(batch.summary);
    if (typeof summary.blockingErrorCount === 'number' && summary.blockingErrorCount > 0) return;
    const organizationPlan = Array.isArray(summary.organizationPlan)
      ? summary.organizationPlan.map((item) => this.record(item))
      : [];
    const desiredFullPaths = organizationPlan
      .map((node) => this.nullableString(node.fullPath))
      .filter((item): item is string => Boolean(item));
    if (desiredFullPaths.length === 0) return;
    await tx.department.updateMany({
      where: {
        OR: [
          { fullPath: null },
          { fullPath: { notIn: desiredFullPaths } },
        ],
      },
      data: { isActive: false },
    });
    const pathsWithoutLeader = organizationPlan
      .filter((node) => !this.nullableString(node.leaderName))
      .map((node) => this.nullableString(node.fullPath))
      .filter((item): item is string => Boolean(item));
    if (pathsWithoutLeader.length > 0) {
      await tx.department.updateMany({
        where: { fullPath: { in: pathsWithoutLeader } },
        data: { leaderId: null },
      });
    }
  }

  private async completeImportBatchIfReady(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<void> {
    const remaining = await tx.employeeDataChangeRequest.count({
      where: {
        sourceBatchId: batchId,
        OR: [
          { profileReviewStatus: { in: ['pending', 'applying'] } },
          { performanceReviewStatus: { in: ['pending', 'applying'] } },
        ],
      },
    });
    if (remaining === 0) {
      await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: { status: 'completed' },
      });
    }
  }

  private bufferValue(value: unknown): Buffer | null {
    if (value == null) return null;
    if (typeof value === 'string') return Buffer.from(value, 'base64');
    const record = this.record(value);
    return record.type === 'Buffer' && Array.isArray(record.data)
      ? Buffer.from(record.data.filter((item): item is number => typeof item === 'number'))
      : null;
  }

  private requiredString(value: unknown, message: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
  }

  private nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private requiredDate(value: unknown, message: string): Date {
    const date = this.nullableDate(value);
    if (date) return date;
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
  }

  private nullableDate(value: unknown): Date | null {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private enumValue<T extends string>(value: unknown, options: T[], fallback: T): T {
    return typeof value === 'string' && options.includes(value as T) ? value as T : fallback;
  }

  private startOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const response = (error as { getResponse(): unknown }).getResponse();
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
    }
    return error instanceof Error ? error.message : '审核失败';
  }
}
