import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollDomain } from './payroll-contracts';
import { readPayrollPerformance, PayrollPerformanceSource } from './payroll-performance-source';
import { effectivePayrollParameters } from './payroll-parameter-timeline';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollDate, payrollHash } from './payroll-transaction';

type Line = { id: string; employeeId: string; attributionMonth: string; itemCode: string; amount: Prisma.Decimal | null;
  entitlement?: Prisma.Decimal | null; status?: string; evidence?: unknown };
type Automatic = { employeeId: string; cycleId: string; result: PayrollPerformanceSource };
type ManualEntry = { policyId: string; amount: string; evidenceRef: string };
type Manual = { employeeId: string; month: string; workDates: string[]; entries: ManualEntry[] };
type FrozenSources = { performance?: Automatic[]; manualPerformance?: Manual[]; policies?: any[]; parameterReleases?: RuleRelease[];
  attendance?: { payload?: { days?: Array<{ employeeId: string; workDate: string }> } };
  adjustments?: Array<{ id: string; employeeId: string; itemCode: string; amount: string }> };
type Dependency = { employeeId: string; month: string; automatic?: Automatic; manual?: Manual; sources: FrozenSources; dates: string[] };
type RuleRelease = { ruleId: string | null; previousParameterId: string | null; snapshotHash: string; parameterVersion?: number };
type Rules = { policies: any[]; releases: RuleRelease[] };
const changed = () => new ConflictException('批准后未付绩效来源已变化或待核，请撤销未付安排后重算并重新审批');

function manualAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) throw changed();
  return new Prisma.Decimal(value).toFixed(2);
}

function datesInMonth(dates: unknown, month: string): string[] {
  if (!Array.isArray(dates) || !dates.length || new Set(dates).size !== dates.length) throw changed();
  for (const date of dates) {
    try { payrollDate(date); } catch { throw changed(); }
    if (date.slice(0, 7) !== month) throw changed();
  }
  return [...dates].sort();
}

function ruleAt(rules: Rules, date: string, subjectId: string, domain: PayrollDomain, legacy = false) {
  const links = rules.releases.filter(row => row.ruleId).map(row => ({ parameterId: row.ruleId!, previousParameterId: row.previousParameterId }));
  const selected = effectivePayrollParameters(rules.policies, links, payrollDate(date));
  if (selected.length !== 1) throw changed();
  const policy = selected[0], approvals = rules.releases.filter(row => row.ruleId === policy.id);
  if (policy.subjectId !== subjectId || policy.domain !== domain || policy.status !== 'active'
    || (!legacy || approvals.length) && (approvals.length !== 1
      || approvals[0].parameterVersion !== undefined && approvals[0].parameterVersion !== policy.version
      || approvals[0].snapshotHash !== payrollHash(payrollParameterDefinition('rule', policy)))) throw changed();
  return policy;
}

function frozenRules(sources: FrozenSources): Rules {
  if (!Array.isArray(sources.policies) || !sources.policies.length) throw changed();
  try {
    return { policies: sources.policies.map(row => ({ ...row,
      effectiveFrom: row.effectiveFrom instanceof Date ? row.effectiveFrom : payrollDate(row.effectiveFrom.slice(0, 10)),
      effectiveTo: row.effectiveTo == null ? null : row.effectiveTo instanceof Date ? row.effectiveTo : payrollDate(row.effectiveTo.slice(0, 10)),
    })), releases: (sources.parameterReleases ?? []).filter(row => row.ruleId) };
  } catch { throw changed(); }
}

function automaticMapping(mapping: any) {
  if (!mapping || !['official', 'fictional'].includes(mapping.sourceKind) || !Array.isArray(mapping.cycleIds)
    || mapping.cycleIds.length !== 1 || typeof mapping.cycleIds[0] !== 'string'
    || !mapping.coefficients || typeof mapping.coefficients !== 'object' || !Object.keys(mapping.coefficients).length) throw changed();
  const coefficients = Object.fromEntries(Object.entries(mapping.coefficients).sort(([a], [b]) => a.localeCompare(b)).map(([grade, amount]) => {
    if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) throw changed();
    return [grade, new Prisma.Decimal(amount).toString()];
  }));
  return { sourceKind: mapping.sourceKind, cycleIds: [...mapping.cycleIds], coefficients,
    coefficientVersion: mapping.coefficientVersion?.trim() ?? null, evidenceRef: mapping.evidenceRef?.trim() ?? null };
}

async function assertAutomatic(tx: Prisma.TransactionClient, subjectId: string, domain: PayrollDomain, dependency: Dependency, currentRules: Rules) {
  const { employeeId, month, automatic, sources, dates } = dependency, frozen = automatic!.result;
  if (frozen?.status !== 'ready' || !frozen.snapshot || typeof frozen.snapshot !== 'object' || Array.isArray(frozen.snapshot)
    || frozen.snapshot.employeeId !== employeeId || frozen.snapshot.cycleId !== automatic!.cycleId
    || frozen.snapshot.attributionMonth !== undefined && frozen.snapshot.attributionMonth !== month) throw changed();
  const originalRules = frozenRules(sources), registered = new Set<string>();
  for (const date of dates) {
    // Only the original pre-review validation root may retain its unchanged, unversioned approval history.
    const legacy = domain === 'validation' && frozen.snapshot.attributionMonth === undefined && originalRules.policies.length === 1
      && currentRules.policies.length === 1 && !originalRules.releases.length && !currentRules.releases.length
      && originalRules.policies[0].config?.fixedSalaryBasis !== 'monthly_workdays'
      && originalRules.policies[0].id === currentRules.policies[0].id
      && payrollHash(payrollParameterDefinition('rule', originalRules.policies[0])) === payrollHash(payrollParameterDefinition('rule', currentRules.policies[0]));
    const original = ruleAt(originalRules, date, subjectId, domain, legacy), current = ruleAt(currentRules, date, subjectId, domain, legacy);
    const before = automaticMapping(original.config?.performance?.[month]), after = automaticMapping(current.config?.performance?.[month]);
    if (before.sourceKind !== (domain === 'formal' ? 'official' : 'fictional') || before.cycleIds[0] !== automatic!.cycleId
      || payrollHash(before) !== payrollHash(after)) throw changed();
    for (const cycleId of after.cycleIds) registered.add(cycleId);
  }
  const current = await readPayrollPerformance(tx, { employeeId, cycleId: automatic!.cycleId, registeredCycleIds: [...registered],
    ...(frozen.snapshot.attributionMonth !== undefined ? { requiredMonth: month } : {}) });
  if (current.status !== 'ready' || current.snapshot.version !== frozen.snapshot.version) throw changed();
}

function independent(line: Line, sources?: FrozenSources): boolean {
  const evidence = line.evidence as any;
  if (evidence?.applicability !== 'not_applicable' || evidence.calculated !== null || evidence.manualPerformance != null) return false;
  const entitlement = line.entitlement ?? line.amount;
  if (line.amount?.isZero() && entitlement?.isZero() && evidence.adjustment === '0.00'
    && Array.isArray(evidence.adjustmentIds) && !evidence.adjustmentIds.length) return true;
  if (!line.entitlement || !Array.isArray(evidence.adjustmentIds) || !evidence.adjustmentIds.length
    || new Set(evidence.adjustmentIds).size !== evidence.adjustmentIds.length || !Array.isArray(sources?.adjustments)) return false;
  try {
    const amounts = evidence.adjustmentIds.map(id => {
      const matches = sources!.adjustments!.filter(row => row.id === id && row.employeeId === line.employeeId && row.itemCode === 'performance');
      if (matches.length !== 1) throw changed();
      return new Prisma.Decimal(matches[0].amount);
    });
    const total = amounts.reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0));
    return total.isFinite() && total.eq(evidence.adjustment) && total.eq(line.entitlement);
  } catch { return false; }
}

async function assertManual(subjectId: string, domain: PayrollDomain, dependencies: Dependency[], rules: Rules) {
  if (!dependencies.length) return;
  for (const { month, manual } of dependencies) {
    if (!manual || manual.month !== month || !Array.isArray(manual.workDates) || !manual.workDates.length
      || new Set(manual.workDates).size !== manual.workDates.length || !Array.isArray(manual.entries) || !manual.entries.length) throw changed();
    for (const date of manual.workDates) {
      try { payrollDate(date); } catch { throw changed(); }
      if (date.slice(0, 7) !== month) throw changed();
    }
  }
  for (const dependency of dependencies) {
    const frozen = dependency.manual!, entries = new Map<string, ManualEntry>();
    for (const date of frozen.workDates) {
      const policy = ruleAt(rules, date, subjectId, domain);
      const mapping = (policy.config as any)?.performance?.[dependency.month];
      if (mapping?.sourceKind !== 'manual' || typeof mapping.evidenceRef !== 'string' || !mapping.evidenceRef.trim()) throw changed();
      entries.set(policy.id, { policyId: policy.id, amount: manualAmount(mapping.manualAmounts?.[dependency.employeeId]), evidenceRef: mapping.evidenceRef.trim() });
    }
    const normalize = (rows: ManualEntry[]) => rows.map(row => {
      if (!row || typeof row.policyId !== 'string' || typeof row.evidenceRef !== 'string' || !row.evidenceRef.trim()) throw changed();
      return { policyId: row.policyId, amount: manualAmount(row.amount), evidenceRef: row.evidenceRef };
    }).sort((a, b) => a.policyId.localeCompare(b.policyId));
    const actual = normalize([...entries.values()]), expected = normalize(frozen.entries);
    if (new Set(expected.map(row => row.policyId)).size !== expected.length
      || new Set(actual.map(row => JSON.stringify([row.amount, row.evidenceRef]))).size !== 1
      || payrollHash(actual) !== payrollHash(expected)) throw changed();
  }
}

// The caller enforces subject access. Read only payable dependencies, never recapture paid-before balances.
export async function assertPayrollApprovedPerformance(tx: Prisma.TransactionClient, batch: { id: string; subjectId: string },
  version: { id: string; version: number; sources: unknown; lines: Line[]; netSnapshot?: unknown }, domain: PayrollDomain): Promise<void> {
  const performanceLines = version.lines.filter(row => row.itemCode === 'performance' && !independent(row));
  if (!performanceLines.length) return;
  const paid = new Set<string>();
  if (version.netSnapshot != null) {
    const payments = await tx.payrollNetPayment.findMany({ where: { versionId: version.id, subjectId: batch.subjectId, domain }, select: { employeeId: true } });
    for (const payment of payments) paid.add(payment.employeeId);
  }
  const cancellations = await tx.payrollEvent.findMany({ where: { subjectId: batch.subjectId, batchId: batch.id, version: version.version, action: 'remainder_cancelled' }, select: { metadata: true } });
  const cancelledLines = new Set<string>();
  for (const event of cancellations) {
    const metadata = event.metadata as { versionId?: string; employeeId?: string; lineId?: string } | null;
    if (metadata?.versionId === version.id && metadata.employeeId) paid.add(metadata.employeeId);
    if (metadata?.lineId) cancelledLines.add(metadata.lineId);
  }
  const totals = new Map<string, Prisma.Decimal>();
  if (version.netSnapshot == null) {
    // Settlement is per attribution item, not per employee or entire batch.
    const settlements = await tx.payrollSettlement.findMany({ where: { lineId: { in: performanceLines.map(line => line.id) } } });
    for (const payment of settlements) totals.set(payment.lineId, (totals.get(payment.lineId) ?? new Prisma.Decimal(0)).plus(payment.amount));
  }
  const unpaidLines = performanceLines.filter(line => !paid.has(line.employeeId) && !cancelledLines.has(line.id)
    && !(line.amount !== null && totals.get(line.id)?.eq(line.amount)));
  if (!unpaidLines.length) return;
  const sources = version.sources as { months?: Array<{ month: string; sources?: FrozenSources }> } | null;
  if (!Array.isArray(sources?.months)) throw changed();
  const unpaid: Dependency[] = [];
  for (const line of unpaidLines) {
    const blocks = sources.months.filter(block => block?.month === line.attributionMonth);
    if (blocks.length !== 1 || !blocks[0].sources) throw changed();
    const frozen = blocks[0].sources!;
    if (independent(line, frozen)) continue;
    if (frozen.performance != null && !Array.isArray(frozen.performance) || frozen.manualPerformance != null && !Array.isArray(frozen.manualPerformance)) throw changed();
    const automatic = (frozen.performance ?? []).filter(row => row?.employeeId === line.employeeId);
    const manual = (frozen.manualPerformance ?? []).filter(row => row?.employeeId === line.employeeId);
    if (automatic.length + manual.length !== 1) throw changed();
    const days = frozen.attendance?.payload?.days;
    if (automatic.length && !Array.isArray(days)) throw changed();
    const dates = datesInMonth(manual.length ? manual[0].workDates
      : days!.filter(row => row.employeeId === line.employeeId).map(row => row.workDate), line.attributionMonth);
    unpaid.push({ employeeId: line.employeeId, month: line.attributionMonth, sources: frozen, dates, automatic: automatic[0], manual: manual[0] });
  }
  if (!unpaid.length) return;
  const lastDate = unpaid.flatMap(row => row.dates).sort().at(-1)!;
  const policies = await tx.payrollPolicy.findMany({ where: { subjectId: batch.subjectId, domain, status: 'active', effectiveFrom: { lte: payrollDate(lastDate) } } });
  const releases = await tx.payrollParameterRelease.findMany({ where: { subjectId: batch.subjectId, domain, status: 'approved', kind: 'rule',
    rule: { is: { effectiveFrom: { lte: payrollDate(lastDate) } } } }, select: { ruleId: true, previousParameterId: true, parameterVersion: true, snapshotHash: true } });
  const rules = { policies, releases };
  for (const dependency of unpaid) if (dependency.automatic) await assertAutomatic(tx, batch.subjectId, domain, dependency, rules);
  await assertManual(batch.subjectId, domain, unpaid.filter(row => row.manual), rules);
}
