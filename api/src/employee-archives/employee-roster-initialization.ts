import { randomUUID } from 'node:crypto';
import { CompanyCode, EmploymentType, Prisma, PrismaClient } from '@prisma/client';
import { ParsedEmployeeRosterRow } from './employee-roster.excel';
import { EmployeeRosterImportService } from './employee-roster-import.service';

// One-shot, confirmed migration only. Deliberately not exposed as an HTTP endpoint.
export interface InitializationTarget {
  sheet: string;
  row: number;
  userId: string | null;
  employeeNo: string;
  company: CompanyCode;
  deptId: string | null;
  positionId: string | null;
  status: 'active' | 'resigned';
}

export interface InitializationWarning {
  field: string;
  message: string;
  code?: string;
  contractSequence?: number;
  contractId?: string;
  source?: unknown;
}

export function validateInitializationTargets(targets: InitializationTarget[]) {
  const sourceRows = new Set<string>();
  const people = new Set<string>();
  const numbers = new Set<string>();
  if (!targets.length) throw new Error('初始化清单为空');
  for (const target of targets) {
    const source = `${target.sheet}:${target.row}`;
    if (!target.employeeNo || sourceRows.has(source) || numbers.has(target.employeeNo)
      || (target.userId && people.has(target.userId))) throw new Error('初始化清单存在重复身份、工号或来源行');
    if (!Object.values(CompanyCode).includes(target.company)) throw new Error('初始化公司范围尚未确认');
    sourceRows.add(source);
    numbers.add(target.employeeNo);
    if (target.userId) people.add(target.userId);
  }
}

export function initializationWarnings(row: ParsedEmployeeRosterRow, target: InitializationTarget): InitializationWarning[] {
  const fieldLabels: Record<string, string> = { signedAt: '签订日期', effectiveFrom: '生效日期', expiresAt: '到期日期',
    birthDate: '出生日期', entryDate: '入职日期', leaveDate: '离职日期', graduationDate: '毕业日期',
    payrollCutoffDate: '计薪截止日期', socialSecurityStopDate: '社保停缴日期', housingFundStopDate: '公积金停缴日期' };
  const warnings: InitializationWarning[] = (row.warnings ?? []).map((warning) => ({ ...warning,
    message: `${warning.contractSequence == null ? '' : `第 ${warning.contractSequence} 条合同 · `}${fieldLabels[warning.field.split('.').at(-1)!] ?? ''}：${warning.message}`,
  }));
  const missing = (field: string, label: string, value: unknown) => {
    if (value == null || value === '') warnings.push({ field, code: 'missing', message: `${label}待补充` });
  };
  missing('employee.companyText', '所属公司', row.employee.companyText);
  missing('employee.deptId', '所属部门', target.deptId);
  missing('employee.position', '岗位', row.employee.position);
  missing('employee.entryDate', '入职日期', row.employee.entryDate);
  if (target.status === 'resigned') missing('employee.leaveDate', '离职日期', row.employee.leaveDate);
  return warnings.filter((warning, index) => warnings.findIndex((item) => item.field === warning.field
    && item.message === warning.message && item.contractSequence === warning.contractSequence) === index);
}

interface InitializationInput {
  fileHash: string;
  fileName: string;
  effectiveDate: Date;
  operatorId: string;
  rows: ParsedEmployeeRosterRow[];
  targets: InitializationTarget[];
  // Capture these from the approved preview; refuse a moving baseline.
  expectedUsers: Array<{ id: string; name: string; employeeNo: string | null; updatedAt: string }>;
  retireUserIds: string[];
  numberCorrections: Array<{ employeeNo: string; previousUserId: string; targetSheet: string; targetRow: number }>;
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const comparable = (value: unknown) => value instanceof Date ? value.toISOString() : value ?? null;

export async function initializeConfirmedRoster(
  prisma: PrismaClient,
  importer: EmployeeRosterImportService,
  input: InitializationInput,
) {
  validateInitializationTargets(input.targets);
  if (!/^[a-f0-9]{64}$/.test(input.fileHash) || !Number.isFinite(input.effectiveDate.getTime())) {
    throw new Error('初始化文件指纹或生效日期无效');
  }
  if (input.rows.length !== input.targets.length) throw new Error('花名册行数与确认清单不一致');
  const sourceRows = new Map(input.rows.map((row) => [`${row.source?.sheetName}:${row.source?.rowNumber}`, row]));
  const targetIds = new Set(input.targets.flatMap((target) => target.userId ? [target.userId] : []));
  if (input.retireUserIds.some((id) => targetIds.has(id))) throw new Error('离职清单与花名册身份重复');
  const now = new Date();
  const effectiveFrom = input.effectiveDate;
  const dayBefore = new Date(effectiveFrom.getTime() - 86_400_000);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('roster_initialization'))`;
    const completed = await tx.employeeImportBatch.findFirst({ where: {
      fileHash: input.fileHash, mode: 'full', parserVersion: 'initialization-1', status: 'completed',
    } });
    if (completed) return { batchId: completed.id, alreadyApplied: true, applied: 0 };
    const operator = await tx.user.findUnique({ where: { id: input.operatorId } });
    if (!operator || operator.sysRole !== 'system_admin' || operator.deletedAt) throw new Error('初始化操作人不是有效系统管理员');
    const users = await tx.user.findMany({ include: {
      employmentHistory: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] },
      employeeProfile: true, employeeContracts: true,
    } });
    const byId = new Map(users.map((user) => [user.id, user]));
    const assignments = await tx.employeeNumberAssignment.findMany({ where: { status: { not: 'released' } } });
    for (const target of input.targets) {
      const correction = input.numberCorrections.find((item) => item.employeeNo === target.employeeNo
        && item.targetSheet === target.sheet && item.targetRow === target.row);
      const permittedOwners = new Set([target.userId, correction?.previousUserId].filter(Boolean));
      if (assignments.some((item) => item.employeeNo === target.employeeNo && (!item.userId || !permittedOwners.has(item.userId)))
        || users.some((item) => item.employeeNo === target.employeeNo && !permittedOwners.has(item.id))) {
        throw new Error('确认工号已被其他员工或新办理记录占用，请更新初始化清单');
      }
    }
    const expectedIds = new Set(input.expectedUsers.map((user) => user.id));
    if ([...targetIds, ...input.retireUserIds].some((id) => !expectedIds.has(id))) throw new Error('目标身份缺少确认基线');
    for (const expected of input.expectedUsers) {
      const actual = byId.get(expected.id);
      if (!actual || actual.name !== expected.name || actual.employeeNo !== expected.employeeNo
        || actual.updatedAt.toISOString() !== expected.updatedAt) throw new Error('员工基线已变化，请重新核对初始化清单');
    }
    for (const id of [...targetIds, ...input.retireUserIds]) {
      const person = byId.get(id)!;
      if (person.deletedAt || person.accountType !== 'employee' || person.sysRole === 'system_admin') throw new Error('初始化员工范围含受保护账号');
      if (person.employmentHistory.some((record) => record.effectiveFrom >= effectiveFrom)) throw new Error('存在同日或未来任职，需单独核对后再初始化');
    }
    const openIntakes = await tx.employeeDataChangeRequest.count({ where: {
      userId: { in: [...targetIds, ...input.retireUserIds] }, onboardingStatus: { in: ['submitted', 'pending_entry'] },
    } });
    if (openIntakes) throw new Error('目标员工存在办理中的入职申请，需先核对');
    const batch = await tx.employeeImportBatch.create({ data: {
      mode: 'full', originalFileName: input.fileName, fileHash: input.fileHash,
      operatorId: input.operatorId, confirmedById: input.operatorId, confirmedAt: now,
      templateVersion: 'roster-current-former', parserVersion: 'initialization-1', status: 'importing',
    } });
    // The only cross-person number move must be listed in the approved correction manifest.
    for (const correction of input.numberCorrections) {
      const previous = byId.get(correction.previousUserId);
      const replacement = input.targets.find((target) => target.userId === correction.previousUserId);
      const recipient = input.targets.find((target) => target.sheet === correction.targetSheet && target.row === correction.targetRow
        && target.employeeNo === correction.employeeNo);
      if (previous?.employeeNo !== correction.employeeNo || !replacement || replacement.employeeNo === correction.employeeNo
        || recipient?.employeeNo !== correction.employeeNo) throw new Error('工号纠正清单与确认身份不一致');
      await tx.employeeNumberAssignment.updateMany({ where: { userId: previous.id, employeeNo: correction.employeeNo },
        data: { status: 'released', releasedAt: now } });
      await tx.user.update({ where: { id: previous.id }, data: { employeeNo: null } });
      await tx.auditLog.create({ data: { userId: input.operatorId, action: 'correct_roster_employee_number',
        entityType: 'user', entityId: previous.id,
        oldValue: { employeeNo: correction.employeeNo }, newValue: { employeeNo: replacement.employeeNo, batchId: batch.id },
      } });
    }
    const pairs = input.targets.map((target) => {
      const row = sourceRows.get(`${target.sheet}:${target.row}`);
      if (!row || !row.employee.name) throw new Error('确认来源行缺失');
      const old = target.userId ? byId.get(target.userId) : undefined;
      if (old && old.name.replace(/[（(][男女][）)]$/, '').trim() !== row.employee.name.replace(/[（(][男女][）)]$/, '').trim()) {
        throw new Error('确认身份姓名不一致');
      }
      return { target, row, old, userId: target.userId ?? randomUUID(), requestId: randomUUID() };
    });
    for (const { target, row, old, userId } of pairs) {
      const employmentType = /退休|返聘/.test(row.employee.employmentTypeText ?? '') ? EmploymentType.rehire
        : /兼职/.test(row.employee.employmentTypeText ?? '') ? EmploymentType.part_time
          : /外包|外部/.test(row.employee.employmentTypeText ?? '') ? EmploymentType.external : EmploymentType.full_time;
      const data = { employeeNo: target.employeeNo, name: row.employee.name!, phone: row.profile.phone,
        deptId: target.deptId, positionId: target.positionId, position: row.employee.position,
        entryDate: row.employee.entryDate, plannedRegularDate: row.employee.plannedRegularDate,
        actualRegularDate: row.employee.actualRegularDate, leaveDate: row.employee.leaveDate ?? null,
        employmentType, status: target.status,
      };
      if (old) await tx.user.update({ where: { id: userId }, data });
      else await tx.user.create({ data: { id: userId, ...data, passwordHash: null, mustChangePassword: true } });
    }
    for (const { target, row, old, userId, requestId } of pairs) {
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const warnings = initializationWarnings(row, target);
      const profile = { ...importer.prepareProfile(row.profile),
        // A former-employee sheet records stop dates, not historical start dates.
        ...(row.profile.socialSecurityStopDate !== undefined && old?.employeeProfile
          ? { socialSecurityStartDate: old.employeeProfile.socialSecurityStartDate } : {}),
        ...(row.profile.housingFundStopDate !== undefined && old?.employeeProfile
          ? { housingFundStartDate: old.employeeProfile.housingFundStartDate } : {}),
        ...(row.profile.idNumber ? {} : { idNumberEncrypted: null, idNumberFingerprint: null }),
        ...(row.profile.bankAccount ? {} : { bankAccountEncrypted: null, bankAccountFingerprint: null }),
      };
      const managerMatches = row.employee.managerName ? pairs.filter((pair) => pair.target.status === 'active'
        && pair.row.employee.name === row.employee.managerName && pair.userId !== userId) : [];
      const managerId = managerMatches.length === 1 ? managerMatches[0].userId : null;
      if (row.employee.managerName && !managerId) warnings.push({ field: 'employee.managerId', code: 'missing', message: '花名册直属主管待核对' });
      const employee = { ...row.employee, ...target, companyText: row.employee.companyText,
        employmentType: current.employmentType, employeeStatus: target.status, managerId, effectiveFrom,
      };
      const contracts: Array<Record<string, unknown>> = [];
      const reusedContractIds = new Set<string>();
      for (const contract of row.contracts) {
        if (contract.kind === 'unclassified') continue; // Remains in encrypted source evidence and review warning.
        const data = { contractType: contract.kind, name: contract.name, signingCompany: contract.signingCompany ?? null,
          signedAt: contract.signedAt, effectiveFrom: contract.effectiveFrom ?? null, expiresAt: contract.expiresAt,
          termType: contract.termText, originalCompany: contract.originalCompany, newCompany: contract.newCompany,
          confidentialityAgreement: contract.confidentialityAgreement, nonCompeteAgreement: contract.nonCompeteAgreement,
          portraitAgreement: contract.portraitAgreement,
        };
        const existing = old?.employeeContracts.find((item) => item.isActive && item.sequence === contract.sequence && !reusedContractIds.has(item.id)
          && Object.entries(data).every(([key, value]) => comparable((item as any)[key]) === comparable(value)));
        // Keep replaced values and attachments as a historical version, not a second current contract.
        if (!existing) await tx.employeeContract.updateMany({ where: {
          userId, contractType: contract.kind, sequence: contract.sequence, isActive: true,
        }, data: { isActive: false, endedAt: now } });
        const stored = existing ?? await tx.employeeContract.create({ data: {
          ...data, userId, sequence: contract.sequence, sourceBatchId: batch.id, createdById: input.operatorId,
        } });
        reusedContractIds.add(stored.id);
        contracts.push({ ...data, id: stored.id, sequence: contract.sequence });
        for (const warning of warnings) if (warning.contractSequence === contract.sequence) warning.contractId = stored.id;
      }
      await tx.employeeDataChangeRequest.create({ data: {
        id: requestId, userId, employeeNo: target.employeeNo, employeeName: row.employee.name!,
        sourceType: 'employee_roster_import', sourceSystem: 'roster_initialization', sourceReference: `${input.fileHash}:${row.rowNumber}`,
        sourceBatchId: batch.id, sourceRowNumber: row.rowNumber, createdById: input.operatorId,
        profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', profileReviewedById: input.operatorId,
        profileReviewedAt: now, appliedAt: now, validationWarnings: json(warnings),
        baseValue: json(old ? { employee: { employeeNo: old.employeeNo, status: old.status, deptId: old.deptId },
          initializationPreviousEncrypted: importer.encryptSourceEvidence({ profile: old.employeeProfile,
            employments: old.employmentHistory, userArchive: { name: old.name, phone: old.phone, position: old.position,
              deptId: old.deptId, employeeNo: old.employeeNo, status: old.status, entryDate: old.entryDate, leaveDate: old.leaveDate } }),
          preservedContractIds: old.employeeContracts.map((item) => item.id) } : {}),
        proposedValue: json({ employee, profile, contracts, source: row.source,
          sourceEvidenceEncrypted: importer.encryptSourceEvidence(row.sourceFields ?? {}),
        }),
      } });
      await tx.employeeProfile.upsert({ where: { userId }, create: { userId, ...profile }, update: profile });
      await tx.employmentRecord.updateMany({ where: { userId, effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      }, data: { effectiveTo: dayBefore } });
      await tx.employmentRecord.create({ data: {
        userId, employeeNo: target.employeeNo, effectiveFrom, effectiveTo: null, company: target.company,
        companyText: row.employee.companyText, deptId: target.deptId, positionId: target.positionId,
        position: current.position, jobGrade: row.employee.jobGrade, jobFamily: row.employee.jobFamily,
        directManagerId: managerId, workLocation: row.employee.workLocation, employmentType: current.employmentType,
        employeeStatus: target.status, entryDate: row.employee.entryDate, leaveDate: row.employee.leaveDate ?? null,
        plannedRegularDate: row.employee.plannedRegularDate, actualRegularDate: row.employee.actualRegularDate,
        probationMonths: row.employee.probationMonths, changeType: 'data_correction', reason: '已确认花名册初始化；生效日为校正日，不代表实际入离职日',
        sourceType: 'roster_initialization', sourceBatchId: batch.id, sourceRequestId: requestId, createdById: input.operatorId,
      } });
      await tx.employeeNumberAssignment.updateMany({ where: { userId, employeeNo: { not: target.employeeNo }, status: 'current' },
        data: { status: 'historical', effectiveTo: dayBefore } });
      await tx.employeeNumberAssignment.upsert({ where: { userId_employeeNo: { userId, employeeNo: target.employeeNo } },
        create: { userId, employeeNo: target.employeeNo, status: target.status === 'active' ? 'current' : 'historical', sourceRequestId: requestId, effectiveFrom },
        update: { status: target.status === 'active' ? 'current' : 'historical', releasedAt: null,
          ...(target.status === 'active' ? { effectiveTo: null } : {}) },
      });
      await tx.employeeImportRow.create({ data: { batchId: batch.id, rowNumber: row.rowNumber, matchedUserId: userId,
        action: old ? 'update' : 'create', normalizedValue: json({ employee: { employeeNo: target.employeeNo, status: target.status }, source: row.source }),
        warnings: json(warnings), manualMapping: json({ confirmedUserId: target.userId }),
      } });
      await tx.auditLog.create({ data: { userId: input.operatorId, action: 'initialize_employee_archive',
        entityType: 'employee_data_change_request', entityId: requestId,
        newValue: { batchId: batch.id, employeeId: userId, sourceRowNumber: row.rowNumber, warnings: warnings.length },
      } });
    }
    // Missing-from-roster people are explicitly listed, never inferred from a partial import.
    for (const userId of input.retireUserIds) {
      const old = byId.get(userId)!;
      const employment = old.employmentHistory[0];
      if (!employment) throw new Error('离职校正缺少任职基线');
      const requestId = randomUUID();
      await tx.employeeDataChangeRequest.create({ data: { id: requestId, userId, employeeNo: old.employeeNo,
        employeeName: old.name, sourceType: 'employee_roster_import', sourceSystem: 'roster_initialization',
        sourceReference: `${input.fileHash.slice(0, 32)}:absent:${userId}`, sourceBatchId: batch.id,
        createdById: input.operatorId, profileReviewStatus: 'approved', performanceReviewStatus: 'not_required',
        profileReviewedById: input.operatorId, profileReviewedAt: now, appliedAt: now,
        baseValue: { employee: { employeeStatus: old.status } },
        proposedValue: json({ employee: { employeeStatus: 'resigned', leaveDate: old.leaveDate } }),
        validationWarnings: old.leaveDate ? [] : [{ field: 'employee.leaveDate', code: 'missing', message: '离职日期待补充' }],
      } });
      await tx.user.update({ where: { id: userId }, data: { status: 'resigned' } });
      await tx.employmentRecord.updateMany({ where: { userId, effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      }, data: { effectiveTo: dayBefore } });
      const { id, createdAt, updatedAt, ...retained } = employment;
      await tx.employmentRecord.create({ data: { ...retained, effectiveFrom, effectiveTo: null, employeeStatus: 'resigned',
        leaveDate: old.leaveDate, changeType: 'data_correction', reason: '未在已确认的最新花名册中，标记离职；实际离职日期待补',
        sourceType: 'roster_initialization', sourceBatchId: batch.id, sourceRequestId: requestId, createdById: input.operatorId,
      } });
      await tx.employeeNumberAssignment.updateMany({ where: { userId, status: 'current' }, data: { status: 'historical' } });
      await tx.auditLog.create({ data: { userId: input.operatorId, action: 'initialize_absent_employee',
        entityType: 'employee_data_change_request', entityId: requestId, newValue: { employeeId: userId, batchId: batch.id },
      } });
    }
    await tx.employeeImportBatch.update({ where: { id: batch.id }, data: { status: 'completed', summary: {
      totalRows: pairs.length, active: input.targets.filter((target) => target.status === 'active').length,
      resigned: input.targets.filter((target) => target.status === 'resigned').length, absent: input.retireUserIds.length,
    } } });
    // PostgreSQL sequences are nontransactional: only raise the high-water mark, never reuse a number.
    await tx.$executeRaw`DO $$ DECLARE target bigint; BEGIN
      SELECT COALESCE(MAX(employee_no::bigint), 1) INTO target FROM (
        SELECT employee_no FROM users UNION SELECT employee_no FROM employee_number_assignments
      ) n WHERE employee_no ~ '^[0-9]{1,18}$';
      WHILE (SELECT last_value FROM employee_number_seq) < target LOOP
        PERFORM nextval('employee_number_seq');
      END LOOP;
    END $$`;
    return { batchId: batch.id, alreadyApplied: false, applied: pairs.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
}
