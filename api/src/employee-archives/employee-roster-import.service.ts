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
    if (!['ready_to_confirm', 'needs_resolution'].includes(batch.status)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该批次当前不可确认' });
    }
    if (batch.fileHash !== fileHash) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '确认文件与预检文件不一致' });
    }
    const rawByRowNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    const actionableRows = batch.rows.filter((row) => row.action === 'create' || row.action === 'update');
    const hasBlockedRows = batch.rows.some((row) => row.action === 'blocked' || this.hasItems(row.errors));
    if (actionableRows.length === 0 && hasBlockedRows) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '没有可提交审核的有效员工行' });
    }
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

      const organizationSourceRows = batch.mode === 'full' && hasBlockedRows
        ? actionableRows.map((row) => rawByRowNumber.get(row.rowNumber)!).filter(Boolean)
        : rows;
      const organizationPlan = batch.mode === 'full' ? buildRosterOrganizationPlan(organizationSourceRows) : [];
      const currentOrganizationDepartments = batch.mode === 'full'
        ? await tx.department.findMany({
          select: {
            fullPath: true,
            name: true,
            company: true,
            sortOrder: true,
            isActive: true,
          },
        })
        : [];
      const desiredOrganizationPaths = new Set(organizationPlan.map((node) => this.normalizeOrgPath(node.fullPath)));
      const organizationNeedsReview = batch.mode === 'full' && (
        organizationPlan.some((node) => {
          const currentNode = currentOrganizationDepartments.find((department) => (
            department.fullPath
            && this.normalizeOrgPath(department.fullPath) === this.normalizeOrgPath(node.fullPath)
          ));
          return !currentNode
            || currentNode.name !== node.name
            || currentNode.company !== node.company
            || currentNode.sortOrder !== node.sortOrder
            || !currentNode.isActive;
        })
        || currentOrganizationDepartments.some((department) => (
          department.isActive
          && department.fullPath
          && !desiredOrganizationPaths.has(this.normalizeOrgPath(department.fullPath))
        ))
      );
      const organizationReviewCarrierRow = organizationNeedsReview ? actionableRows[0]?.rowNumber : null;
      const topLevelLeaderNames = new Set(
        organizationPlan
          .filter((node) => node.depth === 0 && node.leaderName)
          .map((node) => node.leaderName!),
      );
      const leaderDepartmentPathsByName = new Map<string, string[][]>();
      for (const node of organizationPlan) {
        if (!node.leaderName) continue;
        const paths = leaderDepartmentPathsByName.get(node.leaderName) ?? [];
        paths.push(node.fullPath.split(' / '));
        leaderDepartmentPathsByName.set(node.leaderName, paths);
      }
      let submitted = 0;
      for (const importRow of actionableRows) {
        const raw = rawByRowNumber.get(importRow.rowNumber)!;
        const normalized = this.normalizedEmployee(importRow.normalizedValue);
        const current = importRow.matchedUserId
          ? await tx.user.findUnique({
            where: { id: importRow.matchedUserId },
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
              directManagerId: true,
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
              dept: { select: { parentId: true, leaderId: true, fullPath: true } },
              employmentHistory: {
                where: {
                  effectiveFrom: { lte: new Date() },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
                },
                orderBy: { effectiveFrom: 'desc' },
                take: 1,
                include: {
                  directManager: { select: { id: true, name: true } },
                },
              },
            },
          })
          : null;
        const currentEmployment = current?.employmentHistory?.[0];
        const isIncrementalUpdate = batch.mode === 'incremental' && importRow.action === 'update';
        const organizationPath = batch.mode === 'full' ? raw.employee.departmentPath : [];
        const targetFullPath = organizationPath.join(' / ');
        const currentDepartmentMatches = Boolean(
          current?.dept?.fullPath
          && this.normalizeOrgPath(current.dept.fullPath) === this.normalizeOrgPath(targetFullPath),
        );
        const organizationLeaderPaths = leaderDepartmentPathsByName.get(raw.employee.name ?? '') ?? [];
        const requiredOrganizationFullPaths = new Set<string>();
        for (const path of [organizationPath, ...organizationLeaderPaths]) {
          path.forEach((_, index) => requiredOrganizationFullPaths.add(path.slice(0, index + 1).join(' / ')));
        }
        const organizationNodes = organizationPlan.filter((node) => requiredOrganizationFullPaths.has(node.fullPath));
        const organizationEnsurePaths = importRow.rowNumber === organizationReviewCarrierRow
          ? organizationPlan.map((node) => node.fullPath.split(' / '))
          : [];
        const proposedEmployee = {
          ...raw.employee,
          name: raw.employee.name ?? current?.name ?? null,
          employeeNo: raw.employee.employeeNo ?? current?.employeeNo ?? null,
          phone: isIncrementalUpdate && raw.profile.phone == null ? current?.phone ?? null : raw.profile.phone,
          company: normalized.company,
          deptId: normalized.deptId ?? (currentDepartmentMatches ? current?.deptId ?? null : null),
          position: isIncrementalUpdate && raw.employee.position == null ? current?.position ?? null : raw.employee.position,
          jobGrade: isIncrementalUpdate && raw.employee.jobGrade == null ? currentEmployment?.jobGrade ?? null : raw.employee.jobGrade,
          jobFamily: isIncrementalUpdate && raw.employee.jobFamily == null ? currentEmployment?.jobFamily ?? null : raw.employee.jobFamily,
          workLocation: isIncrementalUpdate && raw.employee.workLocation == null ? currentEmployment?.workLocation ?? null : raw.employee.workLocation,
          entryDate: isIncrementalUpdate && raw.employee.entryDate == null ? current?.entryDate ?? null : raw.employee.entryDate,
          plannedRegularDate: isIncrementalUpdate && raw.employee.plannedRegularDate == null
            ? current?.plannedRegularDate ?? null
            : raw.employee.plannedRegularDate,
          actualRegularDate: isIncrementalUpdate && raw.employee.actualRegularDate == null
            ? current?.actualRegularDate ?? null
            : raw.employee.actualRegularDate,
          probationMonths: isIncrementalUpdate && raw.employee.probationMonths == null
            ? currentEmployment?.probationMonths ?? null
            : raw.employee.probationMonths,
          employmentType: isIncrementalUpdate && !raw.employee.employmentTypeText
            ? current?.employmentType ?? normalized.employmentType
            : normalized.employmentType,
          employeeStatus: isIncrementalUpdate && !raw.employee.employeeStatusText
            ? current?.status ?? normalized.employeeStatus
            : normalized.employeeStatus,
          ...(batch.mode === 'full'
            ? {
              organizationPath,
              organizationLeaderPaths,
              organizationNodes: importRow.rowNumber === organizationReviewCarrierRow ? organizationPlan : organizationNodes,
              organizationEnsurePaths,
            }
            : {}),
        };
        const parsedProfile = this.profileData(raw.profile);
        const currentProfile = this.profileReviewData(current?.employeeProfile);
        const proposedProfile = isIncrementalUpdate
          ? { ...currentProfile, ...this.withoutNullish(parsedProfile) }
          : parsedProfile;
        const approvedPerformanceManagerId = current?.directManagerId ?? null;
        const isTopLevelLeader = !approvedPerformanceManagerId
          && !raw.employee.managerName
          && (
            topLevelLeaderNames.has(raw.employee.name ?? '')
            || (
              current?.dept?.parentId === null
              && current.dept.leaderId === importRow.matchedUserId
            )
          );
        const needsPerformanceReview = !approvedPerformanceManagerId && !isTopLevelLeader;
        const currentEmployee = current ? {
          employeeNo: current.employeeNo,
          name: current.name,
          phone: current.phone,
          company: currentEmployment?.company ?? normalized.company,
          deptId: current.deptId,
          position: current.position,
          jobGrade: currentEmployment?.jobGrade ?? null,
          jobFamily: currentEmployment?.jobFamily ?? null,
          managerName: currentEmployment?.directManager?.name ?? null,
          workLocation: currentEmployment?.workLocation ?? null,
          entryDate: current.entryDate,
          plannedRegularDate: current.plannedRegularDate,
          actualRegularDate: current.actualRegularDate,
          leaveDate: current.leaveDate,
          probationMonths: currentEmployment?.probationMonths ?? null,
          employmentType: current.employmentType,
          employeeStatus: current.status,
        } : null;
        const employeeReviewKeys = [
          'employeeNo', 'name', 'phone', 'company', 'deptId', 'position', 'jobGrade', 'jobFamily',
          'managerName', 'workLocation', 'entryDate', 'plannedRegularDate', 'actualRegularDate',
          'leaveDate', 'probationMonths', 'employmentType', 'employeeStatus',
        ];
        const leaderFullPaths = organizationLeaderPaths.map((path) => path.join(' / '));
        const currentLeaderDepartments = leaderFullPaths.length > 0
          ? await tx.department.findMany({
            where: { name: { in: organizationLeaderPaths.map((path) => path.at(-1)!) } },
            select: { fullPath: true, leaderId: true },
          })
          : [];
        const currentOrganizationLeaders = Object.fromEntries(leaderFullPaths.map((fullPath) => [
          fullPath,
          currentLeaderDepartments.find((department) => (
            department.fullPath
            && this.normalizeOrgPath(department.fullPath) === this.normalizeOrgPath(fullPath)
          ))?.leaderId ?? null,
        ]));
        const needsLeaderReview = leaderFullPaths.some((fullPath) => (
          currentOrganizationLeaders[fullPath]
            !== importRow.matchedUserId
        ));
        const needsProfileReview = !current
          || !this.sameReviewRecord(currentEmployee, proposedEmployee, employeeReviewKeys)
          || !this.sameReviewRecord(currentProfile, proposedProfile)
          || !this.sameContractSet(current?.employeeContracts ?? [], raw.contracts)
          || needsLeaderReview
          || importRow.rowNumber === organizationReviewCarrierRow;
        if (!needsProfileReview && !needsPerformanceReview) continue;
        const validationErrors = !needsPerformanceReview || raw.employee.managerName
          ? []
          : ['绩效直属上级待设置'];
        const proposedValue = this.toJson({
          employee: proposedEmployee,
          profile: proposedProfile,
          contracts: raw.contracts,
          performance: approvedPerformanceManagerId
            ? {
              managerId: approvedPerformanceManagerId,
              suggestedRosterManagerName: raw.employee.managerName,
            }
            : {
              managerName: raw.employee.managerName,
              suggestedRosterManagerName: raw.employee.managerName,
            },
        });
        const equivalentPending = await tx.employeeDataChangeRequest.findFirst({
          where: {
            sourceType: 'employee_roster_import',
            ...(importRow.matchedUserId
              ? { userId: importRow.matchedUserId }
              : { userId: null, employeeNo: raw.employee.employeeNo }),
            OR: [
              { profileReviewStatus: 'pending' },
              { performanceReviewStatus: 'pending' },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        if (equivalentPending && this.sameChangeProposal(equivalentPending.proposedValue, proposedValue)) {
          continue;
        }
        await tx.employeeDataChangeRequest.create({
          data: {
            userId: importRow.matchedUserId,
            employeeNo: raw.employee.employeeNo,
            employeeName: raw.employee.name!,
            sourceType: 'employee_roster_import',
            sourceBatchId: batchId,
            sourceRowNumber: importRow.rowNumber,
            baseValue: this.toJson(current ? {
              employee: currentEmployee,
              profile: currentProfile,
              profileExists: current.employeeProfile !== null,
              contracts: current.employeeContracts,
              performance: { managerId: current.directManagerId },
              organizationLeaders: currentOrganizationLeaders,
            } : {}),
            proposedValue,
            profileReviewStatus: needsProfileReview ? 'pending' : 'not_required',
            performanceReviewStatus: needsPerformanceReview ? 'pending' : 'not_required',
            validationErrors: this.toJson(validationErrors),
            createdById: operator.id,
          },
        });
        submitted += 1;
      }

      if (batch.mode === 'full' && !hasBlockedRows) {
        const today = this.startOfUtcDay(new Date());
        for (const missingRow of batch.rows.filter((row) => row.action === 'possible_resignation' && row.matchedUserId)) {
          const current = await tx.user.findUnique({
            where: { id: missingRow.matchedUserId! },
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
              directManagerId: true,
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
                where: {
                  effectiveFrom: { lte: today },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
                },
                orderBy: { effectiveFrom: 'desc' },
                take: 1,
              },
            },
          });
          const employment = current?.employmentHistory?.[0];
          if (!current || !employment) continue;
          const profile = this.profileReviewData(current.employeeProfile);
          const employee = {
            employeeNo: current.employeeNo,
            name: current.name,
            phone: current.phone,
            company: employment.company,
            deptId: current.deptId,
            position: current.position,
            jobGrade: employment.jobGrade,
            jobFamily: employment.jobFamily,
            managerId: employment.directManagerId,
            workLocation: employment.workLocation,
            entryDate: current.entryDate,
            plannedRegularDate: current.plannedRegularDate,
            actualRegularDate: current.actualRegularDate,
            leaveDate: today,
            probationMonths: employment.probationMonths,
            employmentType: current.employmentType,
            employeeStatus: UserStatus.resigned,
          };
          const proposedValue = this.toJson({
            employee,
            profile,
            contracts: [],
            performance: { managerId: current.directManagerId },
          });
          const equivalentPending = await tx.employeeDataChangeRequest.findFirst({
            where: {
              userId: missingRow.matchedUserId,
              sourceType: 'employee_roster_import',
              profileReviewStatus: 'pending',
            },
            orderBy: { createdAt: 'desc' },
          });
          if (equivalentPending && this.sameChangeProposal(equivalentPending.proposedValue, proposedValue)) {
            continue;
          }
          await tx.employeeDataChangeRequest.create({
            data: {
              userId: missingRow.matchedUserId,
              employeeNo: current.employeeNo,
              employeeName: current.name,
              sourceType: 'employee_roster_import',
              sourceBatchId: batchId,
              sourceRowNumber: missingRow.rowNumber,
              baseValue: this.toJson({
                employee: { ...employee, leaveDate: current.leaveDate, employeeStatus: current.status },
                profile,
                profileExists: current.employeeProfile !== null,
                contracts: current.employeeContracts,
                performance: { managerId: current.directManagerId },
              }),
              proposedValue,
              profileReviewStatus: 'pending',
              performanceReviewStatus: 'not_required',
              validationErrors: this.toJson([]),
              createdById: operator.id,
            },
          });
          submitted += 1;
        }
      }

      await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: {
          status: submitted > 0 ? 'pending_review' : 'completed',
          confirmedById: operator.id,
          confirmedAt: new Date(),
          summary: this.toJson({
            ...(batch.summary as object),
            submitted,
            ...(batch.mode === 'full' ? { organizationPlan } : {}),
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'submit_employee_roster_review',
          entityType: 'employee_import_batch',
          entityId: batchId,
          newValue: {
            mode: batch.mode,
            submitted,
            fileHashVerified: true,
          },
        },
      });
      return {
        batchId,
        status: submitted > 0 ? 'pending_review' as const : 'completed' as const,
        submitted,
      };

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
        warnings: this.toJson([
          blockingErrorCount > 0
            ? '员工未出现在本次全量花名册；因本批次存在问题行，本次不会自动归档离职'
            : '员工未出现在本次全量花名册；确认并审核通过后将归档为离职',
        ]),
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
    const canConfirm = createCount + updateCount > 0
      || (blockingErrorCount === 0 && missing.length > 0);
    await this.prisma.employeeImportBatch.update({
      where: { id: batch.id },
      data: {
        status: canConfirm ? 'ready_to_confirm' : 'needs_resolution',
        summary: this.toJson({ ...summary, organizationPlan }),
        errorSummary: this.toJson({ blockingErrorCount, warningCount }),
      },
    });

    return { batchId: batch.id, canConfirm, summary };
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

  private normalizedEmployee(value: Prisma.JsonValue): {
    company: CompanyCode;
    deptId: string | null;
    employmentType: EmploymentType;
    employeeStatus: UserStatus;
  } {
    const employee = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>).employee
      : null;
    const deptId = employee?.deptId ?? null;
    if (!deptId && !employee?.organizationKey) {
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

  private profileReviewData(profile: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!profile) return {};
    return Object.fromEntries(
      Object.entries(profile).filter(([key]) => !['id', 'userId', 'createdAt', 'updatedAt'].includes(key)),
    );
  }

  private withoutNullish<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
    ) as Partial<T>;
  }

  private sameReviewRecord(
    left: Record<string, unknown> | null,
    right: Record<string, unknown>,
    selectedKeys?: string[],
  ): boolean {
    if (!left) return false;
    const ignoredKeys = new Set(['idNumberEncrypted', 'bankAccountEncrypted']);
    const keys = selectedKeys ?? [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return keys
      .filter((key) => !ignoredKeys.has(key))
      .every((key) => this.comparableValue(left[key]) === this.comparableValue(right[key]));
  }

  private comparableValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'null';
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private sameContractSet(
    current: Array<Record<string, unknown>>,
    proposed: ParsedEmployeeRosterRow['contracts'],
  ): boolean {
    const normalize = (contract: Record<string, unknown>) => ({
      contractType: contract.contractType ?? contract.kind ?? 'contract',
      sequence: contract.sequence ?? 0,
      name: contract.name ?? null,
      signedAt: this.comparableValue(contract.signedAt),
      expiresAt: this.comparableValue(contract.expiresAt),
      termType: contract.termType ?? contract.termText ?? null,
      originalCompany: contract.originalCompany ?? null,
      newCompany: contract.newCompany ?? null,
      confidentialityAgreement: contract.confidentialityAgreement ?? null,
      nonCompeteAgreement: contract.nonCompeteAgreement ?? null,
      portraitAgreement: contract.portraitAgreement ?? null,
    });
    const sortKey = (contract: ReturnType<typeof normalize>) => `${contract.contractType}:${contract.sequence}`;
    const left = current.map((item) => normalize(item)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const right = proposed
      .map((item) => normalize(item as unknown as Record<string, unknown>))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private sameChangeProposal(left: unknown, right: unknown): boolean {
    const normalize = (value: unknown, key?: string): unknown => {
      if (key === 'idNumberEncrypted' || key === 'bankAccountEncrypted') return undefined;
      if (value === undefined || value === null || value === '') return null;
      if (value instanceof Date) return value.toISOString();
      if (Buffer.isBuffer(value)) return undefined;
      if (Array.isArray(value)) return value.map((item) => normalize(item));
      if (typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
            .map(([childKey, childValue]) => [childKey, normalize(childValue, childKey)])
            .filter(([, childValue]) => childValue !== undefined),
        );
      }
      return value;
    };
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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
