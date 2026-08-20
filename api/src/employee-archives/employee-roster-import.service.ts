import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
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
import { parseEmployeeRosterExcel, ParsedEmployeeRosterRow } from './employee-roster.excel';
import {
  buildRosterOrganizationPlan,
  mapRosterCompany,
  rosterOrganizationKeyForRow,
} from './employee-roster-organization';

export type EmployeeRosterImportMode = 'full' | 'incremental';

export interface EmployeeRosterPreviewSummary {
  totalRows: number;
  createCount: number;
  updateCount: number;
  blockingErrorCount: number;
  warningCount: number;
  missingFromFullRosterCount: number;
  desiredDepartmentCount: number;
}

interface PreviewSource {
  mode: EmployeeRosterImportMode;
  fileName: string;
  fileHash: string;
}

interface ExistingRosterUser {
  id: string;
  employeeNo: string | null;
  name: string;
  deptId: string | null;
  position: string | null;
  status: UserStatus;
  dept: { name: string; fullPath: string | null } | null;
  externalIdentityBindings?: Array<{ status: ExternalIdentityStatus }>;
}

@Injectable()
export class EmployeeRosterImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config?: ConfigService,
  ) {}

  async findBatch(batchId: string) {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) {
      throw new BadRequestException({ code: ERROR_CODE.NOT_FOUND, message: '导入批次不存在' });
    }
    return batch;
  }

  async preview(file: Express.Multer.File, mode: EmployeeRosterImportMode, operator: AuthUser) {
    this.assertFile(file);
    const rows = await parseEmployeeRosterExcel(file.buffer);
    return this.createPreviewFromRows(rows, {
      mode,
      fileName: file.originalname,
      fileHash: createHash('sha256').update(file.buffer).digest('hex'),
    }, operator);
  }

  async confirm(batchId: string, file: Express.Multer.File, operator: AuthUser) {
    this.assertFile(file);
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const rows = await parseEmployeeRosterExcel(file.buffer);
    return this.confirmFromRows(batchId, rows, fileHash, operator);
  }

  async confirmFromRows(
    batchId: string,
    rows: ParsedEmployeeRosterRow[],
    fileHash: string,
    operator: AuthUser,
  ) {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) {
      throw new BadRequestException({ code: ERROR_CODE.NOT_FOUND, message: '导入批次不存在' });
    }
    if (batch.status !== 'ready_to_confirm') {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该批次当前不可确认' });
    }
    if (batch.fileHash !== fileHash) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '确认文件与预检文件不一致' });
    }
    if (batch.rows.some((row) => row.action === 'blocked' || this.hasItems(row.errors))) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '批次仍有阻断项，不能确认' });
    }

    const rawByRowNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    const actionableRows = batch.rows.filter((row) => row.action === 'create' || row.action === 'update');
    if (actionableRows.some((row) => !rawByRowNumber.has(row.rowNumber))) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '确认文件行结构与预检不一致' });
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.employeeImportBatch.updateMany({
        where: { id: batchId, status: 'ready_to_confirm' },
        data: { status: 'importing' },
      });
      if (locked.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该批次已被其他操作处理' });
      }

      const organizationIds = batch.mode === 'full'
        ? await this.synchronizeFullRosterOrganization(tx, rows)
        : undefined;

      const userIdByRow = new Map<number, string>();
      for (const importRow of actionableRows) {
        const raw = rawByRowNumber.get(importRow.rowNumber)!;
        const normalized = this.normalizedEmployee(importRow.normalizedValue, organizationIds);
        const commonData = {
          employeeNo: raw.employee.employeeNo!,
          name: raw.employee.name!,
          phone: raw.profile.phone,
          deptId: normalized.deptId,
          position: raw.employee.position,
          entryDate: raw.employee.entryDate,
          plannedRegularDate: raw.employee.plannedRegularDate,
          actualRegularDate: raw.employee.actualRegularDate,
          employmentType: normalized.employmentType,
          status: normalized.employeeStatus,
          accountType: AccountType.employee,
          leaveDate: null,
        };
        const isIncrementalUpdate = batch.mode === 'incremental' && importRow.action === 'update';
        const updateData: Prisma.UserUncheckedUpdateInput = isIncrementalUpdate
          ? this.withoutNullish({
            name: raw.employee.name,
            employeeNo: raw.employee.employeeNo,
            phone: raw.profile.phone,
            deptId: normalized.deptId,
            position: raw.employee.position,
            entryDate: raw.employee.entryDate,
            plannedRegularDate: raw.employee.plannedRegularDate,
            actualRegularDate: raw.employee.actualRegularDate,
            employmentType: raw.employee.employmentTypeText ? normalized.employmentType : undefined,
            status: raw.employee.employeeStatusText ? normalized.employeeStatus : undefined,
            accountType: AccountType.employee,
          }) as Prisma.UserUncheckedUpdateInput
          : commonData;

        if (importRow.action === 'create') {
          const created = await tx.user.create({
            data: {
              ...commonData,
            },
            select: { id: true },
          });
          userIdByRow.set(importRow.rowNumber, created.id);
        } else {
          if (!importRow.matchedUserId) {
            throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: `第 ${importRow.rowNumber} 行未匹配员工` });
          }
          await tx.user.update({ where: { id: importRow.matchedUserId }, data: updateData });
          userIdByRow.set(importRow.rowNumber, importRow.matchedUserId);
        }
      }

      const managerNames = rows
        .map((row) => row.employee.managerName)
        .filter((name): name is string => Boolean(name));
      const managerByName = new Map<string, string>();
      const rosterUserIdsByName = new Map<string, string[]>();
      for (const importRow of actionableRows) {
        const raw = rawByRowNumber.get(importRow.rowNumber)!;
        const userId = userIdByRow.get(importRow.rowNumber)!;
        const name = raw.employee.name;
        if (!name) continue;
        rosterUserIdsByName.set(name, [...(rosterUserIdsByName.get(name) ?? []), userId]);
      }
      for (const [name, userIds] of rosterUserIdsByName) {
        if (userIds.length === 1) managerByName.set(name, userIds[0]);
      }
      const unresolvedManagerNames = [...new Set(managerNames.filter((name) => !managerByName.has(name)))];
      const managerCandidates = unresolvedManagerNames.length
        ? await tx.user.findMany({
          where: { name: { in: unresolvedManagerNames }, deletedAt: null, accountType: AccountType.employee },
          select: { id: true, name: true },
        })
        : [];
      const existingManagerIdsByName = new Map<string, string[]>();
      for (const manager of managerCandidates) {
        existingManagerIdsByName.set(manager.name, [...(existingManagerIdsByName.get(manager.name) ?? []), manager.id]);
      }
      for (const [name, userIds] of existingManagerIdsByName) {
        if (userIds.length === 1) managerByName.set(name, userIds[0]);
      }
      if (batch.mode === 'full' && organizationIds) {
        await this.synchronizeFullRosterOrganizationLeaders(
          tx,
          rows,
          organizationIds,
          managerByName,
        );
      }

      const today = this.startOfUtcDay(new Date());
      const yesterday = new Date(today.getTime() - 86_400_000);
      for (const importRow of actionableRows) {
        const raw = rawByRowNumber.get(importRow.rowNumber)!;
        const normalized = this.normalizedEmployee(importRow.normalizedValue, organizationIds);
        const userId = userIdByRow.get(importRow.rowNumber)!;
        const isIncrementalUpdate = batch.mode === 'incremental' && importRow.action === 'update';
        const current = await tx.employmentRecord.findFirst({
          where: {
            userId,
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          select: {
            id: true,
            effectiveFrom: true,
            company: true,
            deptId: true,
            position: true,
            jobGrade: true,
            jobFamily: true,
            directManagerId: true,
            workLocation: true,
            employmentType: true,
            employeeStatus: true,
            entryDate: true,
            plannedRegularDate: true,
            actualRegularDate: true,
            probationMonths: true,
          },
        });
        if (raw.employee.managerName && !managerByName.has(raw.employee.managerName)) {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: `第 ${importRow.rowNumber} 行直属上级无法唯一匹配，请重新预检`,
          });
        }
        const directManagerId = isIncrementalUpdate && !raw.employee.managerName
          ? current?.directManagerId ?? null
          : raw.employee.managerName
            ? managerByName.get(raw.employee.managerName) ?? null
            : null;

        if (!isIncrementalUpdate || raw.employee.managerName) {
          await tx.user.update({ where: { id: userId }, data: { directManagerId } });
        }
        const profileData = this.profileData(raw.profile);
        const profileUpdateData = isIncrementalUpdate ? this.withoutNullish(profileData) : profileData;
        if (!isIncrementalUpdate || Object.keys(profileUpdateData).length > 0) {
          await tx.employeeProfile.upsert({
            where: { userId },
            create: { userId, ...profileUpdateData },
            update: profileUpdateData,
          });
        }

        const recordData = {
          company: normalized.company,
          deptId: normalized.deptId,
          position: raw.employee.position,
          jobGrade: isIncrementalUpdate && raw.employee.jobGrade == null ? current?.jobGrade ?? null : raw.employee.jobGrade,
          jobFamily: isIncrementalUpdate && raw.employee.jobFamily == null ? current?.jobFamily ?? null : raw.employee.jobFamily,
          directManagerId,
          workLocation: isIncrementalUpdate && raw.employee.workLocation == null ? current?.workLocation ?? null : raw.employee.workLocation,
          employmentType: isIncrementalUpdate && !raw.employee.employmentTypeText
            ? current?.employmentType ?? normalized.employmentType
            : normalized.employmentType,
          employeeStatus: isIncrementalUpdate && !raw.employee.employeeStatusText
            ? current?.employeeStatus ?? normalized.employeeStatus
            : normalized.employeeStatus,
          entryDate: raw.employee.entryDate,
          plannedRegularDate: isIncrementalUpdate && raw.employee.plannedRegularDate == null
            ? current?.plannedRegularDate ?? null
            : raw.employee.plannedRegularDate,
          actualRegularDate: isIncrementalUpdate && raw.employee.actualRegularDate == null
            ? current?.actualRegularDate ?? null
            : raw.employee.actualRegularDate,
          probationMonths: isIncrementalUpdate && raw.employee.probationMonths == null
            ? current?.probationMonths ?? null
            : raw.employee.probationMonths,
          reason: '花名册导入确认',
          sourceType: 'employee_roster_import',
          sourceBatchId: batchId,
          createdById: operator.id,
        };
        const effectiveTo = recordData.employeeStatus === UserStatus.resigned ? today : null;
        if (!current) {
          await tx.employmentRecord.create({
            data: {
              userId,
              effectiveFrom: importRow.action === 'create' ? raw.employee.entryDate! : today,
              effectiveTo,
              changeType: importRow.action === 'create' ? 'hire' : 'data_correction',
              ...recordData,
            },
          });
        } else if (this.startOfUtcDay(current.effectiveFrom) < today) {
          await tx.employmentRecord.update({ where: { id: current.id }, data: { effectiveTo: yesterday } });
          await tx.employmentRecord.create({
            data: { userId, effectiveFrom: today, effectiveTo, changeType: 'data_correction', ...recordData },
          });
        } else {
          await tx.employmentRecord.update({
            where: { id: current.id },
            data: { effectiveTo, changeType: 'data_correction', ...recordData },
          });
        }

        if (raw.contracts.length > 0) {
          await tx.employeeContract.createMany({
            data: raw.contracts.map((contract) => ({
              userId,
              contractType: contract.kind,
              sequence: contract.sequence,
              name: contract.name,
              signingCompany: raw.employee.companyText,
              signedAt: contract.signedAt,
              effectiveFrom: contract.signedAt,
              expiresAt: contract.expiresAt,
              termType: contract.termText,
              originalCompany: contract.originalCompany,
              newCompany: contract.newCompany,
              confidentialityAgreement: contract.confidentialityAgreement,
              nonCompeteAgreement: contract.nonCompeteAgreement,
              portraitAgreement: contract.portraitAgreement,
              sourceBatchId: batchId,
              createdById: operator.id,
            })),
          });
        }
        await tx.employeeImportRow.updateMany({
          where: { batchId, rowNumber: importRow.rowNumber },
          data: { matchedUserId: userId },
        });
      }

      let resigned = 0;
      if (batch.mode === 'full') {
        const missingRows = batch.rows.filter((row) => row.action === 'possible_resignation' && row.matchedUserId);
        for (const missingRow of missingRows) {
          const userId = missingRow.matchedUserId!;
          const archived = await tx.user.updateMany({
            where: { id: userId, accountType: AccountType.employee, status: { not: UserStatus.resigned } },
            data: { status: UserStatus.resigned, leaveDate: today, directManagerId: null },
          });
          if (archived.count !== 1) continue;
          resigned++;
          const currentEmployment = await tx.employmentRecord.findFirst({
            where: {
              userId,
              effectiveFrom: { lte: today },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            },
            orderBy: { effectiveFrom: 'desc' },
            select: { id: true },
          });
          if (currentEmployment) {
            await tx.employmentRecord.update({
              where: { id: currentEmployment.id },
              data: {
                effectiveTo: today,
                employeeStatus: UserStatus.resigned,
                leaveDate: today,
                changeType: 'departure',
                reason: '未出现在已确认的全量花名册',
              },
            });
          }
          await tx.externalIdentityBinding.updateMany({
            where: { userId, status: ExternalIdentityStatus.enabled, endedAt: null },
            data: {
              status: ExternalIdentityStatus.disabled,
              disabledAt: new Date(),
              disabledById: operator.id,
              disabledReason: '员工未出现在已确认的全量花名册',
            },
          });
        }
      }

      const created = actionableRows.filter((row) => row.action === 'create').length;
      const updated = actionableRows.filter((row) => row.action === 'update').length;
      await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: {
          status: 'completed',
          confirmedById: operator.id,
          confirmedAt: new Date(),
          summary: this.toJson({ ...(batch.summary as object), created, updated, resigned }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'confirm_employee_roster_import',
          entityType: 'employee_import_batch',
          entityId: batchId,
          newValue: { mode: batch.mode, created, updated, resigned, fileHashVerified: true },
        },
      });
      return batch.mode === 'full'
        ? { batchId, status: 'completed' as const, created, updated, resigned }
        : { batchId, status: 'completed' as const, created, updated };
    }, { timeout: 60_000 });
  }

  async createPreviewFromRows(rows: ParsedEmployeeRosterRow[], source: PreviewSource, operator: AuthUser) {
    const batch = await this.prisma.employeeImportBatch.create({
      data: {
        mode: source.mode,
        originalFileName: source.fileName,
        fileHash: source.fileHash,
        status: 'previewing',
        operatorId: operator.id,
        retainedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    const organizationPlan = source.mode === 'full' ? buildRosterOrganizationPlan(rows) : [];
    const [existingUsers, departments] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, accountType: AccountType.employee },
        select: {
          id: true,
          employeeNo: true,
          name: true,
          deptId: true,
          position: true,
          status: true,
          dept: { select: { name: true, fullPath: true } },
          externalIdentityBindings: {
            where: { status: ExternalIdentityStatus.enabled, endedAt: null },
            select: { status: true },
            take: 1,
          },
        },
      }),
      this.prisma.department.findMany({
        where: source.mode === 'full' ? {} : { isActive: true },
        select: { id: true, name: true, fullPath: true, company: true },
      }),
    ]);

    const existingByNo = new Map<string, ExistingRosterUser>();
    for (const user of existingUsers) {
      if (user.employeeNo) existingByNo.set(user.employeeNo, user);
    }
    const fileNumberCounts = new Map<string, number>();
    const fileNameCounts = new Map<string, number>();
    const existingNameCounts = new Map<string, number>();
    for (const user of existingUsers) {
      existingNameCounts.set(user.name, (existingNameCounts.get(user.name) ?? 0) + 1);
    }
    for (const row of rows) {
      if (row.employee.employeeNo) {
        fileNumberCounts.set(row.employee.employeeNo, (fileNumberCounts.get(row.employee.employeeNo) ?? 0) + 1);
      }
      if (row.employee.name) {
        fileNameCounts.set(row.employee.name, (fileNameCounts.get(row.employee.name) ?? 0) + 1);
      }
    }

    let createCount = 0;
    let updateCount = 0;
    let blockingErrorCount = 0;
    let warningCount = 0;
    const matchedUserIds = new Set<string>();
    const persistedRows: Prisma.EmployeeImportRowCreateManyInput[] = [];

    for (const row of rows) {
      const errors: string[] = [];
      const warnings: string[] = [];
      const employeeNo = row.employee.employeeNo;
      if (!employeeNo) errors.push('工号不能为空');
      if (!row.employee.name) errors.push('姓名不能为空');
      if (!row.employee.position) errors.push('岗位不能为空');
      if (!row.employee.entryDate) errors.push('入职时间不能为空');
      if (employeeNo && (fileNumberCounts.get(employeeNo) ?? 0) > 1) errors.push('文件中工号重复');
      if (row.employee.managerName) {
        if (row.employee.managerName === row.employee.name) {
          errors.push('直属上级不能是员工本人');
        } else {
          const rosterMatches = fileNameCounts.get(row.employee.managerName) ?? 0;
          const existingMatches = existingNameCounts.get(row.employee.managerName) ?? 0;
          if (rosterMatches !== 1 && (rosterMatches > 1 || existingMatches !== 1)) {
            errors.push(`直属上级“${row.employee.managerName}”无法唯一匹配`);
          }
        }
      }

      const existing = this.matchExistingEmployee(row, existingByNo, existingUsers, warnings, errors);
      if (existing) matchedUserIds.add(existing.id);
      let company = this.mapCompany(row.employee.companyText, warnings);
      const organizationKey = source.mode === 'full' ? rosterOrganizationKeyForRow(row) : null;
      const deptId = source.mode === 'full'
        ? null
        : this.matchDepartment(row, company, departments, warnings, existing?.deptId ?? null);
      if (!row.employee.companyText?.trim()) errors.push('所属公司不能为空');
      if (source.mode === 'full' && !organizationKey) errors.push('部门路径不能为空');
      if (source.mode === 'incremental' && !deptId) errors.push('部门路径未匹配到 HRM 组织');
      const employmentType = this.mapEmploymentType(row.employee.employmentTypeText, warnings);
      const employeeStatus = this.mapEmployeeStatus(row.employee.employeeStatusText, warnings);

      if (existing && row.employee.name && existing.name !== row.employee.name) {
        if (existing.externalIdentityBindings?.some((binding) => binding.status === ExternalIdentityStatus.enabled)) {
          errors.push(`同工号姓名变化且现有账号已绑定钉钉：${existing.name} → ${row.employee.name}，请先核验身份`);
        } else {
          warnings.push(`同工号姓名变化：${existing.name} → ${row.employee.name}`);
        }
      }

      const action = errors.length > 0 ? 'blocked' : existing ? 'update' : 'create';
      if (action === 'blocked') blockingErrorCount++;
      if (action === 'create') createCount++;
      if (action === 'update') updateCount++;
      warningCount += warnings.length;

      persistedRows.push({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        normalizedValue: this.toJson({
          employee: {
            ...row.employee,
            company,
            deptId,
            organizationKey,
            employmentType,
            employeeStatus,
          },
          profile: this.maskSensitiveProfile(row.profile),
          contracts: row.contracts.map((contract) => ({ ...contract })),
        }),
        matchedUserId: existing?.id,
        diffs: this.toJson(existing ? [{ field: 'roster', type: 'compare_on_confirmation' }] : []),
        errors: this.toJson(errors),
        warnings: this.toJson(warnings),
        action,
      });
    }

    const missing = source.mode === 'full'
      ? existingUsers.filter((user) => (
        user.status !== UserStatus.resigned
        && !matchedUserIds.has(user.id)
      ))
      : [];
    for (const [index, user] of missing.entries()) {
      persistedRows.push({
        batchId: batch.id,
        rowNumber: rows.length + index + 2,
        normalizedValue: this.toJson({ employeeNo: user.employeeNo, name: user.name }),
        matchedUserId: user.id,
        diffs: this.toJson([]),
        errors: this.toJson([]),
        warnings: this.toJson(['员工未出现在本次全量花名册；确认全量导入后将归档为离职']),
        action: 'possible_resignation',
      });
      warningCount++;
    }

    if (persistedRows.length > 0) {
      await this.prisma.employeeImportRow.createMany({ data: persistedRows });
    }

    const summary: EmployeeRosterPreviewSummary = {
      totalRows: rows.length,
      createCount,
      updateCount,
      blockingErrorCount,
      warningCount,
      missingFromFullRosterCount: missing.length,
      desiredDepartmentCount: organizationPlan.length,
    };
    const canConfirm = blockingErrorCount === 0;
    await this.prisma.employeeImportBatch.update({
      where: { id: batch.id },
      data: {
        status: canConfirm ? 'ready_to_confirm' : 'needs_resolution',
        summary: this.toJson(summary),
        errorSummary: this.toJson({ blockingErrorCount, warningCount }),
      },
    });

    return { batchId: batch.id, canConfirm, summary };
  }

  private async synchronizeFullRosterOrganization(
    tx: Prisma.TransactionClient,
    rows: ParsedEmployeeRosterRow[],
  ): Promise<Map<string, string>> {
    const plan = buildRosterOrganizationPlan(rows);
    if (plan.length === 0) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '全量花名册没有可用的部门路径' });
    }

    const existingDepartments = await tx.department.findMany({
      select: { id: true, fullPath: true },
    });
    const existingByPath = new Map<string, { id: string }>();
    for (const department of existingDepartments) {
      if (!department.fullPath) continue;
      const path = this.normalizeOrgPath(department.fullPath);
      if (!existingByPath.has(path)) existingByPath.set(path, department);
    }

    const idsByKey = new Map<string, string>();
    for (const node of plan) {
      const parentId = node.parentKey ? idsByKey.get(node.parentKey) : null;
      if (node.parentKey && !parentId) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: `组织上级缺失：${node.fullPath}` });
      }
      const existing = existingByPath.get(this.normalizeOrgPath(node.fullPath));
      if (existing) {
        await tx.department.update({
          where: { id: existing.id },
          data: {
            name: node.name,
            fullPath: node.fullPath,
            parentId,
            company: node.company,
            sortOrder: node.sortOrder,
            isActive: true,
            dingtalkDeptId: null,
          },
        });
        idsByKey.set(node.key, existing.id);
      } else {
        const created = await tx.department.create({
          data: {
            name: node.name,
            fullPath: node.fullPath,
            parentId,
            company: node.company,
            sortOrder: node.sortOrder,
            isActive: true,
          },
          select: { id: true },
        });
        idsByKey.set(node.key, created.id);
      }
    }

    const desiredIds = [...idsByKey.values()];
    await tx.department.updateMany({
      where: { id: { notIn: desiredIds } },
      data: { isActive: false },
    });
    return idsByKey;
  }

  private async synchronizeFullRosterOrganizationLeaders(
    tx: Prisma.TransactionClient,
    rows: ParsedEmployeeRosterRow[],
    organizationIds: Map<string, string>,
    userIdsByName: Map<string, string>,
  ): Promise<void> {
    for (const node of buildRosterOrganizationPlan(rows)) {
      const departmentId = organizationIds.get(node.key);
      if (!departmentId) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: `组织映射缺失：${node.fullPath}` });
      }
      const leaderId = node.leaderName ? userIdsByName.get(node.leaderName) : null;
      if (node.leaderName && !leaderId) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: `组织负责人无法唯一匹配：${node.fullPath} → ${node.leaderName}`,
        });
      }
      await tx.department.update({
        where: { id: departmentId },
        data: { leaderId: leaderId ?? null },
      });
    }
  }

  private matchDepartment(
    row: ParsedEmployeeRosterRow,
    company: CompanyCode,
    departments: Array<{ id: string; name: string; fullPath: string | null; company: CompanyCode }>,
    warnings: string[],
    currentDeptId: string | null,
  ): string | null {
    const path = row.employee.departmentPath;
    const leaf = path.at(-1);
    if (!leaf) return null;
    const joined = this.normalizeOrgPath(path.join('/'));
    const exactPath = departments.filter((dept) =>
      this.normalizeOrgPath(dept.fullPath ?? dept.name) === joined,
    );
    const sameCompanyExact = exactPath.filter((dept) => dept.company === company);
    const matched = sameCompanyExact.length === 1
      ? sameCompanyExact[0]
      : exactPath.length === 1
        ? exactPath[0]
        : null;
    if (matched) return matched.id;
    const currentExact = currentDeptId
      ? exactPath.find((dept) => dept.id === currentDeptId)
      : undefined;
    if (currentExact) {
      warnings.push(`组织路径“${joined}”存在重名，已沿用员工当前 HRM 部门，请 HR 确认`);
      return currentExact.id;
    }

    const leafMatches = departments.filter((dept) => dept.name === leaf);
    const sameCompanyLeaf = leafMatches.filter((dept) => dept.company === company);
    if (sameCompanyLeaf.length === 1) return sameCompanyLeaf[0].id;
    if (leafMatches.length === 1) {
      warnings.push(`按唯一部门名称“${leaf}”匹配，公司编码差异请 HR 确认`);
      return leafMatches[0].id;
    }
    const currentLeaf = currentDeptId
      ? leafMatches.find((dept) => dept.id === currentDeptId)
      : undefined;
    if (currentLeaf) {
      warnings.push(`部门名称“${leaf}”存在重名，已沿用员工当前 HRM 部门，请 HR 确认`);
      return currentLeaf.id;
    }
    return null;
  }

  private matchExistingEmployee(
    row: ParsedEmployeeRosterRow,
    existingByNo: Map<string, ExistingRosterUser>,
    existingUsers: ExistingRosterUser[],
    warnings: string[],
    errors: string[],
  ): ExistingRosterUser | undefined {
    const employeeNo = row.employee.employeeNo;
    if (!employeeNo) return undefined;
    const exact = existingByNo.get(employeeNo);
    if (exact) return exact;

    const normalizedName = this.normalizeRosterPersonName(row.employee.name ?? '');
    if (!normalizedName) return undefined;
    let candidates = existingUsers.filter((user) => (
      !user.employeeNo
      && this.normalizeRosterPersonName(user.name) === normalizedName
    ));
    if (candidates.length > 1) {
      const leaf = row.employee.departmentPath.at(-1);
      const departmentMatches = leaf
        ? candidates.filter((user) => user.dept?.name === leaf || user.dept?.fullPath?.split('/').at(-1)?.trim() === leaf)
        : [];
      if (departmentMatches.length > 0) candidates = departmentMatches;
    }
    if (candidates.length > 1 && row.employee.position) {
      const positionMatches = candidates.filter((user) => user.position === row.employee.position);
      if (positionMatches.length > 0) candidates = positionMatches;
    }
    if (candidates.length === 1) {
      warnings.push(`现有账号缺少工号，已按姓名和任职唯一匹配 ${candidates[0].name}，确认后补写工号`);
      return candidates[0];
    }
    if (candidates.length > 1) {
      errors.push(`工号 ${employeeNo} 未找到，但姓名“${row.employee.name}”存在多个无工号账号，无法唯一匹配`);
    }
    return undefined;
  }

  private mapCompany(value: string | null, warnings: string[]): CompanyCode {
    const text = value ?? '';
    if (text.includes('/') || text.includes('协程')) warnings.push(`所属公司“${text}”按孚德主体系映射，请 HR 确认`);
    return mapRosterCompany(text);
  }

  private normalizeRosterPersonName(value: string): string {
    return value.trim().replace(/[（(][男女][）)]$/, '').trim();
  }

  private normalizeOrgPath(value: string): string {
    return value.replaceAll('／', '/').replace(/\s*\/\s*/g, '/').trim();
  }

  private mapEmploymentType(value: string | null, warnings: string[]): EmploymentType {
    if (value?.includes('退休') || value?.includes('返聘')) return EmploymentType.rehire;
    if (value?.includes('兼职')) return EmploymentType.part_time;
    if (value?.includes('外包')) return EmploymentType.external;
    if (value && !value.includes('全职')) warnings.push(`未识别用工情况“${value}”，暂按全职`);
    return EmploymentType.full_time;
  }

  private mapEmployeeStatus(value: string | null, warnings: string[]): UserStatus {
    if (value?.includes('离职')) return UserStatus.resigned;
    if (value?.includes('试用')) return UserStatus.probation;
    if (value && !value.includes('正式') && !value.includes('在职')) {
      warnings.push(`员工状态“${value}”暂按在职处理，请 HR 确认`);
    }
    return UserStatus.active;
  }

  private maskSensitiveProfile(profile: ParsedEmployeeRosterRow['profile']) {
    return {
      ...profile,
      phone: this.mask(profile.phone, 4),
      birthDate: profile.birthDate ? `${profile.birthDate.getUTCFullYear()}-**-**` : null,
      idAddress: profile.idAddress ? '【已遮罩】' : null,
      idNumber: this.mask(profile.idNumber, 4),
      currentAddress: profile.currentAddress ? '【已遮罩】' : null,
      emergencyContactName: this.maskName(profile.emergencyContactName),
      emergencyContactPhone: this.mask(profile.emergencyContactPhone, 4),
      socialSecurityStartDate: profile.socialSecurityStartDate ? '【已遮罩】' : null,
      housingFundStartDate: profile.housingFundStartDate ? '【已遮罩】' : null,
      bankBranch: profile.bankBranch ? '【已遮罩】' : null,
      bankAccount: this.mask(profile.bankAccount, 4),
    };
  }

  private maskName(value: string | null): string | null {
    if (!value) return null;
    return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 1, 1))}`;
  }

  private mask(value: string | null, visibleTail: number): string | null {
    if (!value) return null;
    return `${'*'.repeat(Math.max(value.length - visibleTail, 4))}${value.slice(-visibleTail)}`;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private hasItems(value: Prisma.JsonValue): boolean {
    return Array.isArray(value) && value.length > 0;
  }

  private normalizedEmployee(value: Prisma.JsonValue, organizationIds?: Map<string, string>): {
    company: CompanyCode;
    deptId: string;
    employmentType: EmploymentType;
    employeeStatus: UserStatus;
  } {
    const employee = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>).employee
      : null;
    const deptId = employee?.deptId
      ?? (employee?.organizationKey ? organizationIds?.get(employee.organizationKey as string) : undefined);
    if (!deptId) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '预检组织映射缺失，请重新预检' });
    }
    return {
      company: employee.company as CompanyCode,
      deptId,
      employmentType: employee.employmentType as EmploymentType,
      employeeStatus: employee.employeeStatus as UserStatus,
    };
  }

  private profileData(profile: ParsedEmployeeRosterRow['profile']) {
    const idNumber = this.encryptAndFingerprint(profile.idNumber);
    const bankAccount = this.encryptAndFingerprint(profile.bankAccount);
    return {
      phone: profile.phone,
      gender: profile.gender,
      birthDate: profile.birthDate,
      ethnicity: profile.ethnicity,
      education: profile.education,
      professionalTitle: profile.professionalTitle,
      school: profile.school,
      graduationDate: profile.graduationDate,
      major: profile.major,
      maritalStatus: profile.maritalStatus,
      childrenStatus: profile.childrenStatus,
      childrenCount: profile.childrenCount,
      politicalStatus: profile.politicalStatus,
      nativePlace: profile.nativePlace,
      householdType: profile.householdType,
      idAddress: profile.idAddress,
      idNumberEncrypted: idNumber?.encrypted,
      idNumberFingerprint: idNumber?.fingerprint,
      currentAddress: profile.currentAddress,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactRelation: profile.emergencyContactRelation,
      emergencyContactPhone: profile.emergencyContactPhone,
      socialSecurityStatus: profile.socialSecurityStatus,
      socialSecurityStartDate: profile.socialSecurityStartDate,
      housingFundStatus: profile.housingFundStatus,
      housingFundStartDate: profile.housingFundStartDate,
      bankName: profile.bankName,
      bankBranch: profile.bankBranch,
      bankAccountEncrypted: bankAccount?.encrypted,
      bankAccountFingerprint: bankAccount?.fingerprint,
    };
  }

  private withoutNullish<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
    ) as Partial<T>;
  }

  private encryptAndFingerprint(value: string | null): { encrypted: Buffer; fingerprint: string } | null {
    if (!value) return null;
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
      fingerprint: createHmac('sha256', key).update(value.trim().toUpperCase()).digest('hex'),
    };
  }

  private startOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  private assertFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请上传花名册文件' });
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '文件大小不能超过 10MB' });
    }
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '仅支持 xlsx 格式花名册' });
    }
  }
}
