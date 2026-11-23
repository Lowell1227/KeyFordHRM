import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere, selectEmploymentAt } from '@/employee-archives/employment-timeline';
import { PayrollPolicyConfig } from './payroll-contracts';
import { effectivePayrollParameters } from './payroll-parameter-timeline';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { lockPayrollSubject, payrollHash, payrollMonth } from './payroll-transaction';

export type PayrollEmployeeScope = { employeeIds: string[]; evidenceRef: string };
export type PayrollPolicyWithScope = PayrollPolicyConfig & { employeeScope?: PayrollEmployeeScope };
type Reader = Prisma.TransactionClient | PrismaService;
type Policy = Prisma.PayrollPolicyGetPayload<{}>;
type Link = { ruleId: string | null; previousParameterId: string | null; parameterVersion: number; snapshotHash: string };

export class PayrollEmploymentOverlapException extends ConflictException {
  constructor() { super('存在重叠任职，请先核对员工档案'); }
}

export function normalizePayrollEmployeeScope(value: unknown): PayrollEmployeeScope {
  const scope = value as PayrollEmployeeScope | null;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['employeeIds', 'evidenceRef'].includes(key))
    || !Array.isArray(scope.employeeIds) || !scope.employeeIds.length || scope.employeeIds.length > 1000
    || scope.employeeIds.some(id => typeof id !== 'string' || !isUUID(id))
    || typeof scope.evidenceRef !== 'string' || !scope.evidenceRef.trim() || scope.evidenceRef.trim().length > 200) {
    throw new BadRequestException('请明确1至1000名有效发薪员工及不超过200字的确认依据');
  }
  const ids = scope.employeeIds.map(id => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new BadRequestException('发薪人员不能重复');
  return { employeeIds: ids.sort(), evidenceRef: scope.evidenceRef.trim() };
}

function scopeOf(policy: Policy): PayrollEmployeeScope | undefined {
  const value = (policy.config as unknown as PayrollPolicyWithScope)?.employeeScope;
  return value === undefined ? undefined : normalizePayrollEmployeeScope(value);
}

export async function readReviewedPayrollScopePolicies(tx: Reader, subjectId?: string) {
  const policies = await tx.payrollPolicy.findMany({ where: { domain: 'formal', status: 'active', ...(subjectId ? { subjectId } : {}) } });
  const releases = await tx.payrollParameterRelease.findMany({ where: { domain: 'formal', kind: 'rule', status: 'approved', ...(subjectId ? { subjectId } : {}) },
    select: { ruleId: true, previousParameterId: true, parameterVersion: true, snapshotHash: true } });
  const reviewed = policies.filter(policy => {
    const approvals = releases.filter(row => row.ruleId === policy.id);
    if (!approvals.length) return false;
    if (approvals.length !== 1 || approvals[0].parameterVersion !== policy.version
      || approvals[0].snapshotHash !== payrollHash(payrollParameterDefinition('rule', policy))) throw new ConflictException('正式发薪规则与已审快照不一致，请核对版本');
    return true;
  });
  return { policies: reviewed, releases };
}

function selectedPolicies(policies: Policy[], releases: Link[], at: Date) {
  return effectivePayrollParameters(policies, releases.filter(row => row.ruleId).map(row => ({ parameterId: row.ruleId!, previousParameterId: row.previousParameterId })), at);
}

export async function readFormalPayrollAssignments(tx: Reader, subjectId: string, month: string): Promise<Map<string, string[]>> {
  const { start, end } = payrollMonth(month), { policies, releases } = await readReviewedPayrollScopePolicies(tx, subjectId);
  const assignments = new Map<string, string[]>();
  for (let day = +start; day <= +end; day += 86400000) {
    const selected = selectedPolicies(policies, releases, new Date(day));
    if (selected.length > 1) throw new ConflictException('正式发薪人员范围的有效规则重叠，请核对');
    if (!selected.length) continue;
    const scope = scopeOf(selected[0]);
    // An unconfigured historical rule is not permission to infer a payer from a contract.
    if (!scope) continue;
    for (const id of scope.employeeIds) assignments.set(id, [...(assignments.get(id) ?? []), new Date(day).toISOString().slice(0, 10)]);
  }
  return assignments;
}

const employmentSelect = { id: true, userId: true, contractSubjectId: true, effectiveFrom: true, effectiveTo: true, createdAt: true,
  entryDate: true, leaveDate: true, employeeStatus: true, employeeNo: true,
  user: { select: { id: true, name: true, employeeNo: true } } } as const;
export async function readPayrollScopeEmployments(tx: Reader, month: string, employeeIds?: string[]) {
  const { start, end } = payrollMonth(month);
  return tx.employmentRecord.findMany({ where: { AND: [approvedEmploymentSourceWhere,
    { ...(employeeIds ? { userId: { in: employeeIds } } : {}), effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }] },
    select: employmentSelect, orderBy: [{ userId: 'asc' }, { effectiveFrom: 'asc' }, { id: 'asc' }] });
}

export function payrollScopeEmploymentDays(records: Awaited<ReturnType<typeof readPayrollScopeEmployments>>, month: string, interval?: { from: Date; to: Date | null }) {
  const { start, end } = payrollMonth(month), result: Array<{ employeeId: string; workDate: string; employment: typeof records[number] }> = [];
  const from = Math.max(+start, interval ? +interval.from : +start), to = Math.min(+end, interval?.to ? +interval.to : +end);
  for (const id of [...new Set(records.map(row => row.userId))].sort()) for (let day = from; day <= to; day += 86400000) {
    const selected = selectEmploymentAt(records.filter(row => row.userId === id), new Date(day));
    if (selected.matches.length > 1) throw new PayrollEmploymentOverlapException();
    const row = selected.current;
    if (row && ['active', 'probation', 'resigned'].includes(row.employeeStatus)
      && (!row.entryDate || +row.entryDate <= day) && (!row.leaveDate || +row.leaveDate >= day)) {
      result.push({ employeeId: id, workDate: new Date(day).toISOString().slice(0, 10), employment: row });
    }
  }
  return result;
}

export async function assertFormalPayrollRuleEmployments(tx: Reader, rule: Policy): Promise<void> {
  const config = rule.config as unknown as PayrollPolicyWithScope;
  const scope = normalizePayrollEmployeeScope(config.employeeScope), eligible = new Set<string>();
  for (const month of Object.keys(config.workCalendars ?? {})) {
    const { start, end } = payrollMonth(month);
    if (end < rule.effectiveFrom || rule.effectiveTo && start > rule.effectiveTo) continue;
    const records = await readPayrollScopeEmployments(tx, month, scope.employeeIds);
    for (const row of payrollScopeEmploymentDays(records, month, { from: rule.effectiveFrom, to: rule.effectiveTo })) eligible.add(row.employeeId);
  }
  if (scope.employeeIds.some(id => !eligible.has(id))) throw new ConflictException('已选发薪人员在规则日历有效期内没有有效任职，请核对人员和日期');
}

export async function readFormalPayrollEmployments(tx: Reader, subjectId: string, month: string) {
  const assignments = await readFormalPayrollAssignments(tx, subjectId, month);
  if (!assignments.size) return [];
  const records = await readPayrollScopeEmployments(tx, month, [...assignments.keys()]);
  const dates = new Map<string, string[]>();
  for (const row of payrollScopeEmploymentDays(records, month)) if (assignments.get(row.employeeId)?.includes(row.workDate)) {
    dates.set(row.employeeId, [...(dates.get(row.employeeId) ?? []), row.workDate]);
  }
  return records.filter(row => dates.has(row.userId)).map(row => ({ ...row, payrollAssignment: { subjectId, workDates: dates.get(row.userId)! } }));
}

// Use before the subject lock, inside the same Serializable publication transaction.
export function lockFormalPayrollScope(tx: Prisma.TransactionClient) {
  return lockPayrollSubject(tx, 'employee-scope-publication', 'formal');
}

export async function assertFormalPayrollScopeAvailable(tx: Reader, candidate: Policy, previousParameterId: string | null): Promise<void> {
  const scope = normalizePayrollEmployeeScope((candidate.config as unknown as PayrollPolicyWithScope).employeeScope);
  const current = await readReviewedPayrollScopePolicies(tx);
  const policies = [...current.policies.filter(row => row.id !== candidate.id), { ...candidate, status: 'active' }];
  const releases = [...current.releases, { ruleId: candidate.id, previousParameterId, parameterVersion: candidate.version,
    snapshotHash: payrollHash(payrollParameterDefinition('rule', candidate)) }];
  const subjects = [...new Set(policies.map(row => row.subjectId))];
  const boundaries = [...new Set(policies.flatMap(row => [+row.effectiveFrom, ...(row.effectiveTo ? [+row.effectiveTo + 86400000] : [])]))].sort((a, b) => a - b);
  for (const day of boundaries) {
    const own = selectedPolicies(policies.filter(row => row.subjectId === candidate.subjectId), releases, new Date(day));
    if (!own.some(row => row.id === candidate.id)) continue;
    if (own.length !== 1) throw new ConflictException('本主体发薪规则生效区间重叠');
    for (const subject of subjects) if (subject !== candidate.subjectId) {
      const selected = selectedPolicies(policies.filter(row => row.subjectId === subject), releases, new Date(day));
      if (selected.some(row => scopeOf(row)?.employeeIds.some(id => scope.employeeIds.includes(id)))) {
        throw new ConflictException('同一员工在同一有效期间已有其他实际发薪主体，请先核对人员范围');
      }
    }
  }
}
