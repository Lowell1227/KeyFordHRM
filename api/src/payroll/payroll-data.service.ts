import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { approvedEmploymentSourceWhere, selectEmploymentAt } from '@/employee-archives/employment-timeline';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDomain, PAYROLL_ITEM_CODES } from './payroll-contracts';
import { assertPayrollVersion, lockPayrollAuthorization, lockPayrollSubject, payrollDate, payrollDecimal, payrollHash, payrollMonth } from './payroll-transaction';
import { normalizeAttendance, PayrollAttendanceInput, PayrollAttendanceResult } from './payroll-attendance-normalizer';
import { normalizePayrollPolicy } from './payroll-policy';
import { normalizeDeductionSettings } from './payroll-deduction-settings';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { PayrollPolicyWithScope, payrollScopeEmploymentDays, readFormalPayrollEmployments, readPayrollScopeEmployments, readReviewedPayrollScopePolicies } from './payroll-employment-scope';

export interface PayrollAttendanceScope { employeeIds: string[]; from: string; to: string }
export interface PayrollAttendanceSync {
  subjectId: string; month: string; sourceKey: string; input: PayrollAttendanceInput;
  scope?: PayrollAttendanceScope;
  /** Missing completion evidence is incomplete, including for legacy full-month callers. */
  complete?: boolean;
}
type CoverageDay = { employeeId: string; workDate: string; complete: boolean };
type AttendancePayload = PayrollAttendanceResult & { dingtalk?: Prisma.InputJsonValue; sync?: {
  requestHash: string; scope: PayrollAttendanceScope; queryComplete: boolean; complete: boolean; coverage: CoverageDay[];
} };
const attendanceKey = (row: { employeeId: string; workDate: string }) => JSON.stringify([row.employeeId, row.workDate]);
const orderAttendance = (a: { employeeId: string; workDate: string }, b: { employeeId: string; workDate: string }) =>
  attendanceKey(a) < attendanceKey(b) ? -1 : attendanceKey(a) > attendanceKey(b) ? 1 : 0;

export const payrollJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function payrollAttendanceConflicts(tx: Prisma.TransactionClient, subjectId: string, domain: PayrollDomain,
  month: string, payload: unknown) {
  const sourceIds = (value: unknown): string[] => {
    const days = (value as Partial<PayrollAttendanceResult> | null)?.days;
    return Array.isArray(days) ? days.flatMap(day => Array.isArray(day.records)
      ? day.records.flatMap(record => typeof record.sourceId === 'string' && record.sourceId.trim() ? [record.sourceId] : []) : []) : [];
  };
  const ids = new Set(sourceIds(payload));
  if (!ids.size) return [];
  const rows = await tx.payrollAttendanceSnapshot.findMany({ where: { subjectId, domain, month: { not: month } },
    orderBy: [{ month: 'asc' }, { version: 'desc' }], distinct: ['month'],
    select: { month: true, version: true, sourceHash: true, payload: true } });
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!latest.has(row.month) || row.version > latest.get(row.month)!.version) latest.set(row.month, row);
  return [...latest.values()].sort((a, b) => a.month.localeCompare(b.month)).flatMap(row => {
    const shared = [...new Set(sourceIds(row.payload).filter(id => ids.has(id)))].sort();
    return shared.length ? [{ month: row.month, sourceHash: row.sourceHash, sourceIds: shared }] : [];
  });
}

export async function assertPayrollFrozenAttendance(tx: Prisma.TransactionClient, subjectId: string, domain: PayrollDomain, frozen: unknown) {
  const months = (frozen as { months?: Array<{ month: string; sources?: { attendance?: { payload?: unknown } } }> } | null)?.months;
  if (!Array.isArray(months)) return;
  // Recheck only source ownership: ordinary settlement changes must not invalidate a locked amount.
  for (const entry of months) if ((await payrollAttendanceConflicts(tx, subjectId, domain, entry.month, entry.sources?.attendance?.payload)).length) {
    throw new ConflictException('批准版本的考勤来源存在跨月归属冲突，请先核对原月及已入薪差异');
  }
}
export function payrollDays(month: string): string[] {
  const { start, end } = payrollMonth(month), days: string[] = [];
  for (let day = start.getTime(); day <= end.getTime(); day += 86400000) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}
export async function payrollEmployments(tx: Prisma.TransactionClient | PrismaService, subjectId: string, month: string, domain: PayrollDomain = 'validation') {
  if (domain === 'formal') return readFormalPayrollEmployments(tx, subjectId, month);
  const { start, end } = payrollMonth(month);
  const relevant = await tx.employmentRecord.findMany({ where: { AND: [approvedEmploymentSourceWhere,
    { contractSubjectId: subjectId, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] },
    { employeeStatus: { in: ['active', 'probation', 'resigned'] } },
    { OR: [{ leaveDate: null }, { leaveDate: { gte: start } }] }], }, select: { userId: true } });
  const employeeIds = [...new Set(relevant.map(row => row.userId))];
  if (!employeeIds.length) return [];
  return tx.employmentRecord.findMany({ where: { AND: [approvedEmploymentSourceWhere,
    { userId: { in: employeeIds }, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }] },
    select: { id: true, userId: true, contractSubjectId: true, effectiveFrom: true, effectiveTo: true, createdAt: true,
      entryDate: true, leaveDate: true, employeeStatus: true, employeeNo: true,
      user: { select: { id: true, name: true, employeeNo: true } } }, orderBy: [{ userId: 'asc' }, { effectiveFrom: 'asc' }, { id: 'asc' }] });
}
export function isPayrollEmployment(record: { contractSubjectId: string | null; employeeStatus: string; entryDate: Date | null; leaveDate: Date | null;
  payrollAssignment?: { subjectId: string; workDates: string[] } } | null, subjectId: string, day: string) {
  return Boolean(record && (record.payrollAssignment ? record.payrollAssignment.subjectId === subjectId && record.payrollAssignment.workDates.includes(day)
    : record.contractSubjectId === subjectId) && ['active', 'probation', 'resigned'].includes(record.employeeStatus)
    && (!record.entryDate || record.entryDate.getTime() <= payrollDate(day).getTime())
    && (!record.leaveDate || record.leaveDate.getTime() >= payrollDate(day).getTime()));
}

function employmentDays(records: Awaited<ReturnType<typeof payrollEmployments>>, subjectId: string, month: string) {
  const result: Array<{ employeeId: string; workDate: string; employment: typeof records[number] }> = [];
  for (const employeeId of [...new Set(records.map(row => row.userId))].sort()) for (const workDate of payrollDays(month)) {
    const selection = selectEmploymentAt(records.filter(row => row.userId === employeeId), payrollDate(workDate));
    if (selection.matches.length > 1) throw new ConflictException('存在重叠任职，请先核对员工档案');
    if (selection.current && isPayrollEmployment(selection.current, subjectId, workDate)) result.push({ employeeId, workDate, employment: selection.current });
  }
  return result;
}

function attendanceScope(input: PayrollAttendanceSync, eligible: Array<{ employeeId: string; workDate: string }>): PayrollAttendanceScope {
  const days = payrollDays(input.month), ids = [...new Set(eligible.map(row => row.employeeId))].sort();
  if (input.complete !== undefined && typeof input.complete !== 'boolean') throw new BadRequestException('请明确分页是否完整');
  if (input.scope === undefined) return { employeeIds: ids, from: days[0], to: days[days.length - 1] };
  const scope = input.scope;
  if (!scope || !Array.isArray(scope.employeeIds) || !scope.employeeIds.length || scope.employeeIds.length > ids.length ||
    new Set(scope.employeeIds).size !== scope.employeeIds.length || scope.employeeIds.some(id => typeof id !== 'string' || !ids.includes(id))) {
    throw new BadRequestException('补同步人员不在本主体当月任职范围');
  }
  payrollDate(scope.from); payrollDate(scope.to);
  if (!days.includes(scope.from) || !days.includes(scope.to) || scope.from > scope.to) throw new BadRequestException('补同步日期范围不正确');
  return { employeeIds: [...scope.employeeIds].sort(), from: scope.from, to: scope.to };
}

function mergedAttendance(input: PayrollAttendanceSync, scope: PayrollAttendanceScope,
  eligible: Array<{ employeeId: string; workDate: string }>, prior: AttendancePayload | undefined,
  incoming: PayrollAttendanceResult, requestHash: string): AttendancePayload {
  const inScope = (row: { employeeId: string; workDate: string }) => scope.employeeIds.includes(row.employeeId) && row.workDate >= scope.from && row.workDate <= scope.to;
  const keys = new Set(eligible.map(attendanceKey)), scoped = eligible.filter(inScope);
  if (!scoped.length) throw new BadRequestException('所选范围没有有效任职日期');
  const received = new Map(input.input.expected.map(row => [attendanceKey(row), row]));
  if (received.size !== input.input.expected.length || [...input.input.expected, ...input.input.records].some(row => !keys.has(attendanceKey(row)) || !inScope(row))) {
    throw new BadRequestException('同步输入超出声明的人员、日期或有效任职范围');
  }
  if (input.complete === true && scoped.some(row => !received.has(attendanceKey(row)))) throw new BadRequestException('完整同步必须包含范围内每个应核日期（含无需考勤日期）');
  if (prior && (!Array.isArray(prior.days) || !Array.isArray(prior.issues))) throw new ConflictException('历史考勤结构不完整，请先核对来源');
  if (prior?.days.some(row => !keys.has(attendanceKey(row)))) throw new ConflictException('任职范围已变化，请先核对原考勤版本的人员日期差异');
  const previousRecords = prior?.days.flatMap(day => day.records) ?? [];
  const staleDays = new Set<string>();
  const previousExpected = new Map<string, PayrollAttendanceInput['expected'][number]>();
  for (const day of prior?.days ?? []) if (day.required !== null || day.units !== null) {
    previousExpected.set(attendanceKey(day), { employeeId: day.employeeId, workDate: day.workDate, units: day.units ?? '', required: day.required as boolean });
  }
  for (const record of input.input.records) {
    const previous = previousRecords.filter(row => row.sourceId === record.sourceId);
    if (previous.some(row => !inScope(row))) throw new ConflictException('来源标识关联范围外记录，不可通过局部同步迁移或删除');
    if (previous.some(row => row.sourceVersion !== null && row.sourceVersion > record.sourceVersion)) {
      staleDays.add(attendanceKey(record));
      const old = prior?.days.find(row => attendanceKey(row) === attendanceKey(record));
      const next = incoming.days.find(row => attendanceKey(row) === attendanceKey(record));
      if (old && next && (old.units !== next.units || old.required !== next.required)) throw new ConflictException('较旧来源不能覆盖已有较新的排班依据');
    }
  }
  for (const [key, value] of received) previousExpected.set(key, value);
  // Absence from a response is not a deletion. Newer revoked facts remain tombstones against stale replay.
  const normalized = normalizeAttendance({ month: input.month, expected: [...previousExpected.values()],
    records: [...previousRecords, ...input.input.records] as PayrollAttendanceInput['records'] });
  if (normalized.days.reduce((count, day) => count + day.records.length, 0) > 20000) throw new BadRequestException('合并后的考勤记录超过单月范围上限');
  const oldCoverage = new Map((prior?.sync?.coverage ?? []).map(row => [attendanceKey(row), row.complete === true]));
  const coverage = eligible.map(row => ({ employeeId: row.employeeId, workDate: row.workDate,
    complete: inScope(row) ? input.complete === true && (!staleDays.has(attendanceKey(row)) || oldCoverage.get(attendanceKey(row)) === true)
      : oldCoverage.get(attendanceKey(row)) === true })).sort(orderAttendance);
  const days = new Map(normalized.days.map(row => [attendanceKey(row), row]));
  const issues = new Map(normalized.issues.map(issue => [JSON.stringify([issue.employeeId, issue.workDate, issue.code]), issue]));
  for (const issue of prior?.issues ?? []) {
    if (issue.code !== 'SYNC_INCOMPLETE' && (!inScope(issue) || input.complete !== true || !received.has(attendanceKey(issue)))) {
      issues.set(JSON.stringify([issue.employeeId, issue.workDate, issue.code]), issue);
    }
  }
  for (const row of coverage) {
    if (!days.has(attendanceKey(row))) days.set(attendanceKey(row), { employeeId: row.employeeId, workDate: row.workDate, units: null, required: null, records: [], issues: [] });
    if (!row.complete) {
      const issue = { employeeId: row.employeeId, workDate: row.workDate, code: 'SYNC_INCOMPLETE', message: '该人员日期的查询覆盖或分页尚未确认完整，不能封账' };
      issues.set(JSON.stringify([issue.employeeId, issue.workDate, issue.code]), issue);
    }
  }
  const sortedIssues = [...issues.values()].sort((a, b) => orderAttendance(a, b) || a.code.localeCompare(b.code));
  const sortedDays = [...days.values()].sort(orderAttendance).map(day => ({ ...day,
    issues: sortedIssues.filter(issue => attendanceKey(issue) === attendanceKey(day)).map(issue => issue.code) }));
  return { ...normalized, days: sortedDays, issues: sortedIssues,
    version: payrollHash({ normalized: normalized.version, coverage, issues: sortedIssues }),
    sync: { requestHash, scope, queryComplete: input.complete === true, complete: coverage.every(row => row.complete), coverage } };
}

@Injectable()
export class PayrollDataService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService) {}
  private async domain(tx: Prisma.TransactionClient | PrismaService) { return this.access.assertDomain(tx, this.access.maintenancePurpose()); }
  async employees(subjectId: string, month: string, actor: AuthUser) {
    const scopes = await this.access.getAccess(actor), scope = scopes.subjects.find(row => row.id === subjectId);
    if (!scope?.capabilities.some(value => ['attendance_edit', 'attendance_seal', 'payroll_edit', 'payroll_view', 'payroll_settle'].includes(value))) {
      await this.access.assert(this.prisma, actor, subjectId, 'payroll_view');
    }
    const domain = await this.domain(this.prisma);
    const records = await payrollEmployments(this.prisma, subjectId, month, domain);
    return [...new Map(employmentDays(records, subjectId, month).map(({ employeeId, employment: row }) => [employeeId,
      { id: row.user.id, name: row.user.name, employeeNo: row.employeeNo ?? row.user.employeeNo }])).values()];
  }
  async employeeScopeCandidates(subjectId: string, month: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit');
    if (!hasHrCapability(actor, 'employee_archive_edit')) throw new ForbiddenException('配置发薪人员范围还需员工档案维护权限');
    await this.domain(this.prisma);
    const records = await readPayrollScopeEmployments(this.prisma, month);
    return [...new Map(payrollScopeEmploymentDays(records, month).map(({ employeeId, employment }) => [employeeId,
      { id: employeeId, name: employment.user.name, employeeNo: employment.employeeNo ?? employment.user.employeeNo }])).values()];
  }
  private async employeeForWrite(tx: Prisma.TransactionClient, subjectId: string, employeeId: string, domain: PayrollDomain) {
    if (domain === 'formal') {
      const { policies } = await readReviewedPayrollScopePolicies(tx, subjectId);
      if (!policies.some(row => (row.config as unknown as PayrollPolicyWithScope).employeeScope?.employeeIds.includes(employeeId))) {
        throw new BadRequestException('正式发薪人员范围待配置，或员工尚未纳入已审范围');
      }
    }
    const employee = await tx.employmentRecord.findFirst({ where: { AND: [approvedEmploymentSourceWhere,
      { userId: employeeId, ...(domain === 'validation' ? { contractSubjectId: subjectId } : {}) }] } });
    if (!employee) throw new BadRequestException(domain === 'validation' ? '员工不属于当前公司的已审有效任职范围' : '员工没有已审有效任职记录');
    return employee;
  }
  async operators(subjectId: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit');
    const rows = await this.prisma.payrollGrant.findMany({ where: { subjectId, revokedAt: null, user: { status: { in: ['active', 'probation'] }, deletedAt: null, archivedAt: null, isAssessorOnly: false } },
      include: { user: { select: { id: true, name: true } } }, orderBy: { userId: 'asc' } });
    return rows.map(row => ({ ...row.user, capabilities: row.capabilities }));
  }
  async performanceCycles(subjectId: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit');
    const domain = await this.domain(this.prisma);
    const fixture = await this.prisma.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } });
    const monthly = await this.prisma.systemConfig.findUnique({ where: { key: 'payroll_monthly_rules_preview_v1' } });
    const markers = [fixture?.value, monthly?.value] as Array<{ fictional?: boolean; state?: string; subjectIds?: unknown; cycleIds?: unknown } | null | undefined>;
    const idsOf = (marker: typeof markers[number]): string[] => Array.isArray(marker?.cycleIds)
      ? marker.cycleIds.filter((id): id is string => typeof id === 'string' && !!id.trim()) : [];
    const select = { id: true, name: true, type: true, startDate: true, endDate: true } as const;
    if (domain === 'validation') {
      const ids = [...new Set(markers.flatMap((marker, index) => marker?.fictional === true
        && Array.isArray(marker.subjectIds) && marker.subjectIds.includes(subjectId)
        && (index === 0 || marker.state === 'ready') ? idsOf(marker) : []))];
      if (!ids.length) return [];
      return this.prisma.assessmentCycle.findMany({ where: { id: { in: ids } }, select, orderBy: { id: 'asc' } });
    }
    const { policies } = await readReviewedPayrollScopePolicies(this.prisma, subjectId);
    const scopeIds = [...new Set(policies.flatMap(row => (row.config as unknown as PayrollPolicyWithScope).employeeScope?.employeeIds ?? []))];
    if (!scopeIds.length) return [];
    const employments = await this.prisma.employmentRecord.findMany({ where: { AND: [approvedEmploymentSourceWhere,
      { userId: { in: scopeIds }, employeeStatus: { in: ['active', 'probation', 'resigned'] } }] }, select: { userId: true } });
    const employeeIds = [...new Set(employments.map(row => row.userId))];
    if (!employeeIds.length) return [];
    const taskScope: Prisma.AssessmentTaskWhereInput = { isExempt: false, participantDisposition: 'active', status: { not: 'exempted' } };
    const cycles = await this.prisma.assessmentCycle.findMany({ where: { type: 'monthly', id: { notIn: markers.flatMap(idsOf) },
      tasks: { some: { ...taskScope, employeeId: { in: employeeIds } } } }, select, orderBy: { id: 'asc' } });
    const months = new Map<string, ReturnType<typeof employmentDays>>(), visible: typeof cycles = [];
    for (const cycle of cycles) {
      const { startDate, endDate } = cycle;
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate.getUTCFullYear() < 2000 || endDate < startDate) continue;
      const start = startDate.toISOString().slice(0, 10), end = endDate.toISOString().slice(0, 10), month = start.slice(0, 7);
      if (month !== end.slice(0, 7)) continue;
      if (!months.has(month)) months.set(month, employmentDays(await payrollEmployments(this.prisma, subjectId, month, domain), subjectId, month));
      const ids = [...new Set(months.get(month)!.filter(row => row.workDate >= start && row.workDate <= end).map(row => row.employeeId))];
      // Candidate metadata is not proof of a payable result; individual publication checks remain in salary capture.
      if (ids.length && await this.prisma.assessmentTask.count({ where: { cycleId: cycle.id, employeeId: { in: ids }, ...taskScope } })) visible.push(cycle);
    }
    return visible;
  }
  async attendance(subjectId: string, month: string, actor: AuthUser) {
    const scopes = await this.access.getAccess(actor), scope = scopes.subjects.find(row => row.id === subjectId);
    if (!scope?.capabilities.some(value => ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit'].includes(value))) await this.access.assert(this.prisma, actor, subjectId, 'attendance_edit');
    const domain = await this.domain(this.prisma); payrollMonth(month);
    return this.prisma.payrollAttendanceSnapshot.findMany({ where: { subjectId, month, domain }, orderBy: { version: 'desc' }, take: 50 });
  }
  async sync(input: PayrollAttendanceSync, actor: AuthUser) {
    if (this.access.maintenancePurpose() !== 'validation') throw new ForbiddenException('正式考勤仅接受服务端核验的钉钉取数，不能提交客户端考勤或完整性声明');
    return this.persistSync(input, actor);
  }
  async syncVerified(input: PayrollAttendanceSync, actor: AuthUser, verify: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonValue | undefined>) {
    if (typeof verify !== 'function') throw new ForbiddenException('正式考勤同步缺少服务端核验');
    return this.persistSync(input, actor, verify);
  }
  private async persistSync(input: PayrollAttendanceSync, actor: AuthUser, verify?: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonValue | undefined>) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'attendance_edit');
      const domain = await this.domain(tx); await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'attendance_edit');
      if (domain === 'formal' && typeof verify !== 'function') throw new ForbiddenException('正式考勤同步缺少服务端核验');
      const verified = verify ? await verify(tx) : undefined;
      const sourceEvidence = verified === undefined ? undefined : payrollJson(verified);
      if (!input.sourceKey?.trim() || input.sourceKey.length > 100 || input.input?.month !== input.month) throw new BadRequestException('同步来源或月份不正确');
      if (!Array.isArray(input.input?.expected) || !Array.isArray(input.input?.records) || input.input.expected.length > 10000 || input.input.records.length > 20000) throw new BadRequestException('考勤输入不完整或超过单次范围');
      const eligible = employmentDays(await payrollEmployments(tx, input.subjectId, input.month, domain), input.subjectId, input.month);
      if (!eligible.length) throw new BadRequestException('该主体当月没有可核对的任职人员');
      const scope = attendanceScope(input, eligible), incoming = normalizeAttendance(input.input);
      const requestHash = payrollHash({ scope, complete: input.complete === true, input: incoming,
        ...(sourceEvidence !== undefined ? { dingtalk: sourceEvidence } : {}) });
      const existing = await tx.payrollAttendanceSnapshot.findUnique({ where: { subjectId_domain_month_sourceKey: { subjectId: input.subjectId, domain, month: input.month, sourceKey: input.sourceKey } } });
      if (existing) {
        if ((existing.payload as unknown as AttendancePayload)?.sync?.requestHash !== requestHash) throw new ConflictException('同一同步来源内容变化，请使用新的来源版本');
        return existing;
      }
      const latest = await tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId: input.subjectId, domain, month: input.month }, orderBy: { version: 'desc' } });
      const normalized: AttendancePayload = mergedAttendance(input, scope, eligible, latest?.payload as unknown as AttendancePayload | undefined, incoming, requestHash);
      const conflicts = await payrollAttendanceConflicts(tx, input.subjectId, domain, input.month, normalized);
      if (conflicts.length) {
        const ids = new Set(conflicts.flatMap(row => row.sourceIds));
        for (const day of normalized.days) if (day.records.some(record => ids.has(record.sourceId))) {
          const code = 'CROSS_MONTH_SOURCE_CONFLICT';
          if (!day.issues.includes(code)) day.issues.push(code);
          normalized.issues.push({ employeeId: day.employeeId, workDate: day.workDate, code,
            message: '同一考勤来源存在跨月归属冲突，请先核对原月、更正及已入薪差异；本次不能封账' });
        }
        normalized.version = payrollHash({ version: normalized.version, conflicts });
      }
      if (sourceEvidence !== undefined) normalized.dingtalk = sourceEvidence;
      const sourceHash = payrollHash(normalized);
      const row = await tx.payrollAttendanceSnapshot.create({ data: { subjectId: input.subjectId, month: input.month, domain, version: (latest?.version ?? 0) + 1,
        sourceKey: input.sourceKey, sourceHash, payload: payrollJson(normalized), createdById: actor.id } });
      await this.event(tx, input.subjectId, actor.id, 'attendance_sync', { snapshotId: row.id, version: row.version });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async review(id: string, input: { note: string; employeeId?: string; workDate?: string }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.attendanceForWrite(tx, id, actor, 'attendance_edit');
      if (row.status !== 'draft' || !input.note?.trim() || input.note.length > 500) throw new BadRequestException('只能为未封账版本填写核对依据');
      if (input.workDate && !payrollDays(row.month).includes(input.workDate)) throw new BadRequestException('核对日期不在本月');
      const days = (row.payload as unknown as AttendancePayload)?.days;
      if (input.employeeId !== undefined && (!input.employeeId || !Array.isArray(days) || !days.some(day => day.employeeId === input.employeeId &&
        (!input.workDate || day.workDate === input.workDate)))) throw new BadRequestException('核对人员或日期不在当前考勤版本范围');
      const prior = Array.isArray(row.review) ? row.review : [];
      const review = { actorId: actor.id, at: new Date().toISOString(), note: input.note.trim(), ...(input.employeeId ? { employeeId: input.employeeId } : {}), ...(input.workDate ? { workDate: input.workDate } : {}) };
      const result = await tx.payrollAttendanceSnapshot.update({ where: { id }, data: { review: payrollJson([...prior, review]) } });
      await this.event(tx, row.subjectId, actor.id, 'attendance_review', { snapshotId: row.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async seal(id: string, expectedVersion: number, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.attendanceForWrite(tx, id, actor, 'attendance_seal');
      await lockPayrollSubject(tx, row.subjectId, row.domain as PayrollDomain);
      assertPayrollVersion(row.version, expectedVersion);
      const payload = row.payload as unknown as AttendancePayload;
      if ((await payrollAttendanceConflicts(tx, row.subjectId, row.domain as PayrollDomain, row.month, payload)).length) {
        throw new ConflictException('同一考勤来源存在跨月归属冲突，请核对原月及已入薪差异后再封账');
      }
      if (row.status !== 'draft' || !Array.isArray(payload?.issues) || payload.issues.length || payload.sync?.complete !== true ||
        !Array.isArray(payload.sync.coverage) || !payload.sync.coverage.length || payload.sync.coverage.some(day => day.complete !== true)) {
        throw new ConflictException('仍有影响计薪的考勤问题或查询覆盖未完整，需修正来源并补同步后封账');
      }
      const newer = await tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId: row.subjectId, month: row.month, domain: row.domain, version: { gt: row.version } } });
      if (newer) throw new ConflictException('已有更新的同步版本，请核对最新版本');
      const result = await tx.payrollAttendanceSnapshot.update({ where: { id }, data: { status: 'sealed', sealedAt: new Date(), sealedById: actor.id,
        sealedHash: payrollHash({ sourceHash: row.sourceHash, review: row.review }) } });
      await this.event(tx, row.subjectId, actor.id, 'attendance_seal', { snapshotId: row.id, version: row.version }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async standards(subjectId: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit'); const domain = await this.domain(this.prisma);
    return this.prisma.payrollStandard.findMany({ where: { subjectId, domain }, include: { employee: { select: { name: true, employeeNo: true } } }, orderBy: [{ employeeId: 'asc' }, { version: 'desc' }], take: 500 });
  }
  async deductions(subjectId: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit'); const domain = await this.domain(this.prisma);
    return this.prisma.payrollDeductionProfile.findMany({ where: { subjectId, domain },
      include: { employee: { select: { name: true, employeeNo: true } } }, orderBy: [{ payDate: 'desc' }, { version: 'desc' }], take: 500 });
  }
  async saveDeductions(input: { subjectId: string; employeeId: string; payDate: string; settings: unknown }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit'); const domain = await this.domain(tx);
      await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit');
      const payDate = payrollDate(input.payDate), settings = normalizeDeductionSettings(input, input.settings);
      await this.employeeForWrite(tx, input.subjectId, input.employeeId, domain);
      const latest = await tx.payrollDeductionProfile.findFirst({ where: { subjectId: input.subjectId, domain, employeeId: input.employeeId, payDate }, orderBy: { version: 'desc' } });
      const result = await tx.payrollDeductionProfile.create({ data: { subjectId: input.subjectId, employeeId: input.employeeId, domain, payDate,
        effectiveFrom: payDate, effectiveTo: payDate, settings: payrollJson(settings), version: (latest?.version ?? 0) + 1, createdById: actor.id } });
      await this.event(tx, input.subjectId, actor.id, 'deduction_draft', { deductionId: result.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async rules(subjectId: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit'); const domain = await this.domain(this.prisma);
    return this.prisma.payrollPolicy.findMany({ where: { subjectId, domain }, orderBy: { version: 'desc' }, take: 50 });
  }
  async saveStandard(input: { subjectId: string; employeeId: string; effectiveFrom: string; effectiveTo?: string; fixedMonthly: string | null; performanceBase: string | null; performanceMode: string | null; evidence: string }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit'); const domain = await this.domain(tx); await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit');
      const from = payrollDate(input.effectiveFrom), to = input.effectiveTo ? payrollDate(input.effectiveTo) : null;
      if (to && to < from) throw new BadRequestException('生效结束日期不能早于开始日期');
      if (!input.evidence?.trim() || input.evidence.length > 500 || (input.performanceMode != null && !['none', 'included', 'additional'].includes(input.performanceMode))) throw new BadRequestException('请填写确认依据和有效工资结构');
      await this.employeeForWrite(tx, input.subjectId, input.employeeId, domain);
      const latest = await tx.payrollStandard.findFirst({ where: { subjectId: input.subjectId, employeeId: input.employeeId, domain }, orderBy: { version: 'desc' } });
      const result = await tx.payrollStandard.create({ data: { subjectId: input.subjectId, employeeId: input.employeeId, domain, version: (latest?.version ?? 0) + 1,
        effectiveFrom: from, effectiveTo: to, fixedMonthly: payrollDecimal(input.fixedMonthly, true), performanceBase: payrollDecimal(input.performanceBase, true), performanceMode: input.performanceMode,
        evidence: input.evidence.trim(), createdById: actor.id } });
      await this.event(tx, input.subjectId, actor.id, 'standard_draft', { standardId: result.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async saveRule(input: { subjectId: string; effectiveFrom: string; effectiveTo?: string; config: unknown }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit'); const domain = await this.domain(tx); await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit');
      const from = payrollDate(input.effectiveFrom), to = input.effectiveTo ? payrollDate(input.effectiveTo) : null;
      if (to && to < from) throw new BadRequestException('生效结束日期不能早于开始日期');
      if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config) || JSON.stringify(input.config).length > 50000) throw new BadRequestException('规则参数不正确');
      const config = normalizePayrollPolicy(input.config);
      for (const [month, mapping] of Object.entries(config.performance)) if (mapping.sourceKind === 'manual') {
        const eligible = domain === 'formal'
          ? new Set(payrollScopeEmploymentDays(await readPayrollScopeEmployments(tx, month, config.employeeScope?.employeeIds ?? []), month)
            .filter(row => config.employeeScope?.employeeIds.includes(row.employeeId)).map(row => row.employeeId))
          : new Set(employmentDays(await payrollEmployments(tx, input.subjectId, month), input.subjectId, month).map(row => row.employeeId));
        if (Object.keys(mapping.manualAmounts ?? {}).some(id => !eligible.has(id))) throw new BadRequestException('人工绩效人员不在本主体当月有效任职范围');
      }
      const latest = await tx.payrollPolicy.findFirst({ where: { subjectId: input.subjectId, domain }, orderBy: { version: 'desc' } });
      const result = await tx.payrollPolicy.create({ data: { subjectId: input.subjectId, domain, version: (latest?.version ?? 0) + 1, effectiveFrom: from, effectiveTo: to, config: payrollJson(config), createdById: actor.id } });
      await this.event(tx, input.subjectId, actor.id, 'rule_draft', { ruleId: result.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async activate(kind: 'standard' | 'rule', id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.configurationForWrite(tx, kind, id, actor);
      throw new ConflictException('工资参数须提交直属主管审核，通过后发布，不能直接启用');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async clone(kind: 'standard' | 'rule', id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.configurationForWrite(tx, kind, id, actor);
      const common = { subjectId: row.subjectId, domain: row.domain, status: 'draft',
        effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, createdById: actor.id };
      let result;
      if (kind === 'standard') {
        const source = row as Prisma.PayrollStandardGetPayload<{}>;
        const latest = await tx.payrollStandard.findFirst({ where: { subjectId: row.subjectId, employeeId: source.employeeId, domain: row.domain }, orderBy: { version: 'desc' } });
        result = await tx.payrollStandard.create({ data: { ...common, employeeId: source.employeeId, version: (latest?.version ?? 0) + 1,
          fixedMonthly: source.fixedMonthly, performanceBase: source.performanceBase, performanceMode: source.performanceMode, evidence: source.evidence } });
      } else {
        const source = row as Prisma.PayrollPolicyGetPayload<{}>;
        const latest = await tx.payrollPolicy.findFirst({ where: { subjectId: row.subjectId, domain: row.domain }, orderBy: { version: 'desc' } });
        result = await tx.payrollPolicy.create({ data: { ...common, version: (latest?.version ?? 0) + 1, config: payrollJson(source.config) } });
      }
      await this.event(tx, row.subjectId, actor.id, `${kind}_clone`, { sourceId: id, id: result.id });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async disable(kind: 'standard' | 'rule', id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.configurationForWrite(tx, kind, id, actor);
      if (row.status === 'disabled') return row;
      if (row.status !== 'active') throw new ConflictException('只能停用已启用的工资标准或规则');
      const released = await tx.payrollParameterRelease.findFirst({ where: { subjectId: row.subjectId, domain: row.domain, status: 'approved',
        OR: [kind === 'standard' ? { standardId: id } : { ruleId: id }, { previousParameterId: id }] }, select: { id: true } });
      if (row.domain === 'formal' || released) throw new ConflictException('已发布版本须通过新版本调整，不能直接停用或恢复旧值');
      const result = kind === 'standard' ? await tx.payrollStandard.update({ where: { id }, data: { status: 'disabled' } })
        : await tx.payrollPolicy.update({ where: { id }, data: { status: 'disabled' } });
      await this.event(tx, row.subjectId, actor.id, `${kind}_disable`, { id });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private async attendanceForWrite(tx: Prisma.TransactionClient, id: string, actor: AuthUser, capability: 'attendance_edit' | 'attendance_seal') {
    const header = await tx.payrollAttendanceSnapshot.findUnique({ where: { id }, select: { id: true, subjectId: true, domain: true } });
    if (!header) throw new NotFoundException('考勤版本不存在');
    await this.access.assert(tx, actor, header.subjectId, capability);
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    await lockPayrollSubject(tx, header.subjectId, header.domain);
    await lockPayrollAuthorization(tx, header.subjectId);
    await this.access.assert(tx, actor, header.subjectId, capability);
    const row = await tx.payrollAttendanceSnapshot.findUnique({ where: { id } });
    if (!row || row.subjectId !== header.subjectId || row.domain !== header.domain) throw new ConflictException('考勤版本已变化，请重新读取');
    return row;
  }
  private async configurationForWrite(tx: Prisma.TransactionClient, kind: 'standard' | 'rule', id: string, actor: AuthUser) {
    if (kind !== 'standard' && kind !== 'rule') throw new BadRequestException('不支持的工资配置类型');
    const args = { where: { id }, select: { id: true, subjectId: true, domain: true } } as const;
    const header = kind === 'standard' ? await tx.payrollStandard.findUnique(args) : await tx.payrollPolicy.findUnique(args);
    if (!header) throw new NotFoundException('工资标准或规则不存在');
    await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    await lockPayrollSubject(tx, header.subjectId, header.domain);
    await lockPayrollAuthorization(tx, header.subjectId);
    await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
    const row = kind === 'standard' ? await tx.payrollStandard.findUnique({ where: { id } }) : await tx.payrollPolicy.findUnique({ where: { id } });
    if (!row || row.subjectId !== header.subjectId || row.domain !== header.domain) throw new ConflictException('工资配置已变化，请重新读取');
    return row;
  }
  async adjustments(subjectId: string, month: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_edit'); const domain = await this.domain(this.prisma); payrollMonth(month);
    return this.prisma.payrollAdjustment.findMany({ where: { subjectId, month, domain }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
  async openings(subjectId: string, month: string, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'payroll_settle'); const domain = await this.domain(this.prisma); payrollMonth(month);
    return this.prisma.payrollOpeningBalance.findMany({ where: { subjectId, domain, attributionMonth: month }, orderBy: [{ employeeId: 'asc' }, { itemCode: 'asc' }] });
  }
  async confirmOpening(input: { subjectId: string; employeeId: string; month: string; itemCode: string; amount: string; reference: string }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_settle'); const domain = await this.domain(tx); await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'payroll_settle'); payrollMonth(input.month);
      const employees = await payrollEmployments(tx, input.subjectId, input.month, domain);
      if (!employees.some(row => row.userId === input.employeeId) || !(PAYROLL_ITEM_CODES as readonly string[]).includes(input.itemCode)
        || !input.reference?.trim() || input.reference.length > 200) throw new BadRequestException('请核对期初人员、项目和确认依据');
      const amount = payrollDecimal(input.amount, false, true)!;
      if (amount.decimalPlaces() > 2) throw new BadRequestException('期初金额最多两位小数');
      const key = { subjectId: input.subjectId, employeeId: input.employeeId, domain, attributionMonth: input.month, itemCode: input.itemCode };
      const existing = await tx.payrollOpeningBalance.findUnique({ where: { subjectId_employeeId_domain_attributionMonth_itemCode: key } });
      if (existing?.confirmedAt || await tx.payrollReservation.findUnique({ where: { subjectId_employeeId_domain_attributionMonth_itemCode: key } })) throw new ConflictException('该期初已确认或归属项已被审批占用，不可覆盖');
      const data = { amount, reference: input.reference.trim(), confirmedById: actor.id, confirmedAt: new Date() };
      const result = existing ? await tx.payrollOpeningBalance.update({ where: { id: existing.id }, data }) : await tx.payrollOpeningBalance.create({ data: { ...key, ...data } });
      await this.event(tx, input.subjectId, actor.id, 'opening_confirmed', { openingId: result.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async fixtureResponse(subjectId: string, month: string, corrected: boolean, actor: AuthUser) {
    await this.access.assert(this.prisma, actor, subjectId, 'attendance_edit'); await this.access.assertDomain(this.prisma, 'validation');
    const marker = await this.prisma.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } });
    const fixture = marker?.value as { subjectIds?: string[]; employeeIds?: string[] } | null;
    if (!fixture?.subjectIds?.includes(subjectId) || !fixture.employeeIds?.length) throw new BadRequestException('尚未准备该主体的虚构考勤');
    const employments = await payrollEmployments(this.prisma, subjectId, month);
    const ids = [...new Set(employments.filter(row => row.contractSubjectId === subjectId && fixture.employeeIds!.includes(row.userId)).map(row => row.userId))];
    const expected: PayrollAttendanceInput['expected'] = [], records: PayrollAttendanceInput['records'] = [];
    for (const [employeeIndex, employeeId] of ids.entries()) for (const [index, workDate] of payrollDays(month).entries()) {
      const selection = selectEmploymentAt(employments.filter(row => row.userId === employeeId), payrollDate(workDate));
      if (!isPayrollEmployment(selection.current, subjectId, workDate)) continue;
      const required = index < 20; expected.push({ employeeId, workDate, required, units: required ? '1' : '0' });
      if (!required) continue;
      const add = (part: string, type: PayrollAttendanceInput['records'][number]['type'], start: string, end: string, hours: string) => records.push({
        sourceId: `fictional:${employeeId}:${workDate}:${part}`, sourceVersion: corrected ? 2 : 1, employeeId, workDate,
        type, state: 'effective', startsAt: `${workDate}T${start}:00+08:00`, endsAt: `${workDate}T${end}:00+08:00`, hours, unit: 'hour',
        ...(type === 'overtime' ? { overtimeKind: 'weekday' as const } : {}) });
      if (employeeIndex === 0 && index === 0) {
        add('am-first', 'normal', '08:00', '10:00', '2'); add('am-last', corrected ? 'unpaid_leave' : 'missing_punch', '10:00', '12:00', '2');
        add('overtime', 'overtime', '18:00', '20:00', '2');
      } else add('am', 'normal', '08:00', '12:00', '4');
      add('pm', 'normal', '13:00', '17:00', '4');
    }
    const input = { month, expected, records }; return { sourceKey: `fixture:${payrollHash({ input, complete: true })}`, input, complete: true };
  }
  async addAdjustment(input: { subjectId: string; employeeId: string; month: string; itemCode: string; amount: string; reason: string; reference: string }, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit'); const domain = await this.domain(tx); await lockPayrollSubject(tx, input.subjectId, domain);
      await lockPayrollAuthorization(tx, input.subjectId);
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit'); payrollMonth(input.month);
      const employees = await payrollEmployments(tx, input.subjectId, input.month, domain);
      if (!employees.some(row => row.userId === input.employeeId) || !(PAYROLL_ITEM_CODES as readonly string[]).includes(input.itemCode)
        || !input.reason?.trim() || input.reason.length > 500 || !input.reference?.trim() || input.reference.length > 200) throw new BadRequestException('请核对调整人员、项目、原因和依据');
      const amount = payrollDecimal(input.amount, false, true)!;
      if (amount.decimalPlaces() > 2) throw new BadRequestException('授权调整金额最多两位小数');
      const result = await tx.payrollAdjustment.create({ data: { ...input, domain, amount, reason: input.reason.trim(), reference: input.reference.trim(), createdById: actor.id } });
      await this.event(tx, input.subjectId, actor.id, 'adjustment_recorded', { adjustmentId: result.id }); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private event(tx: Prisma.TransactionClient, subjectId: string, actorId: string, action: string, metadata: Prisma.InputJsonValue) {
    return tx.payrollEvent.create({ data: { subjectId, actorId, action, metadata } });
  }
}
