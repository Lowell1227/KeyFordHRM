import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollDeductionsResult } from './payroll-deductions-calculator';
import { normalizeDeductionSettings } from './payroll-deduction-settings';
import { calculateNetWithLedger, NetLedgerFact } from './payroll-net-calculator';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollDate, payrollHash } from './payroll-transaction';
import { PAYROLL_ITEM_CODES } from './payroll-contracts';

const D = Prisma.Decimal.clone({ precision: 40 });
const moneyFields = ['gross', 'socialInsurance', 'housingFund', 'incomeTax', 'net'] as const;
export type PayrollNetRow = { employeeId: string; employeeName: string; employeeNo: string;
  result: PayrollDeductionsResult; ledger?: NonNullable<ReturnType<typeof calculateNetWithLedger>['ledger']> };
export type PayrollNetSnapshot = { schema: 1; subjectId: string; domain: string; payDate: string; sourceHash: string;
  rows: PayrollNetRow[]; totals: Record<typeof moneyFields[number], string> | null };
export function netSnapshotHash(value: unknown): string {
  const sorted = (input: any): any => Array.isArray(input) ? input.map(sorted) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted(input[key])])) : input;
  return payrollHash(sorted(value));
}
export function assertPayrollNetShape(raw: unknown): asserts raw is PayrollNetSnapshot {
  const s = raw as PayrollNetSnapshot;
  const fail = () => { throw new ConflictException('实发快照不完整、金额不符或校验失败，请重新核算'); };
  if (!s || s.schema !== 1 || !s.subjectId || !['validation', 'formal'].includes(s.domain) || !s.payDate ||
    !Array.isArray(s.rows) || !s.rows.length || !s.totals || !s.sourceHash) fail();
  try { payrollDate(s.payDate); } catch { fail(); }
  const { sourceHash, ...body } = s;
  if (sourceHash !== netSnapshotHash(body)) fail();
  const ids = new Set<string>();
  for (const row of s.rows) {
    if (!row || !row.employeeId || ids.has(row.employeeId) || row.result?.status !== 'ready' || !Array.isArray(row.result.issues) || row.result.issues.length ||
      !row.ledger || !row.result.evidence?.parameter) fail();
    ids.add(row.employeeId);
    for (const key of moneyFields) if (typeof row.result[key] !== 'string' || !/^\d{1,16}\.\d{2}$/.test(row.result[key]!)) fail();
    if (!new D(row.result.gross!).minus(row.result.socialInsurance!).minus(row.result.housingFund!).minus(row.result.incomeTax!).eq(row.result.net!)) fail();
  }
  for (const key of moneyFields) if (typeof s.totals![key] !== 'string' || !/^\d{1,18}\.\d{2}$/.test(s.totals![key]) ||
    !new D(s.totals![key]).eq(s.rows.reduce((sum, row) => sum.plus(row.result[key]!), new D(0)))) fail();
}

export function assertPayrollNetLines(raw: unknown, lines: Array<{ employeeId: string; attributionMonth: string; itemCode: string; amount: Prisma.Decimal | null }>, gross: Prisma.Decimal | null) {
  assertPayrollNetShape(raw);
  const groups = new Map<string, Set<string>>(), totals = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const key = `${line.employeeId}:${line.attributionMonth}`, items = groups.get(key) ?? new Set<string>();
    if (items.has(line.itemCode) || !(PAYROLL_ITEM_CODES as readonly string[]).includes(line.itemCode) || line.amount === null) throw new ConflictException('实发工资缺少完整五项税前明细');
    items.add(line.itemCode); groups.set(key, items);
    totals.set(line.employeeId, (totals.get(line.employeeId) ?? new D(0)).plus(line.amount));
  }
  if (groups.size === 0 || [...groups.values()].some(items => items.size !== 5) || totals.size !== raw.rows.length || gross === null ||
    !gross.eq(raw.totals!.gross) || raw.rows.some(row => !totals.get(row.employeeId)?.eq(row.result.gross!))) throw new ConflictException('实发人员、税前明细或合计不一致');
}

async function readNetRow(tx: Prisma.TransactionClient, input: { subjectId: string; employeeId: string; domain: string; payDate: string; gross: string }): Promise<Pick<PayrollNetRow, 'result' | 'ledger'>> {
  const blocked = (issue: string) => ({ result: { status: 'needs_configuration' as const, issues: [issue], gross: null,
    socialInsurance: null, housingFund: null, incomeTax: null, net: null, evidence: { sourceHash: null, input: null } } });
  const profile = await tx.payrollDeductionProfile.findFirst({ where: { subjectId: input.subjectId, employeeId: input.employeeId,
    domain: input.domain, payDate: payrollDate(input.payDate), status: 'active' }, orderBy: { version: 'desc' }, include: { releases: { where: { status: 'approved' } } } });
  if (!profile) return blocked('缺少发薪日对应的已审核扣缴资料');
  const release = profile.releases[0];
  if (profile.releases.length !== 1 || release.parameterVersion !== profile.version || release.submittedById === release.reviewerId ||
    payrollHash(payrollParameterDefinition('deduction', profile)) !== release.snapshotHash) return blocked('扣缴资料与主管审核快照不一致');
  let settings: ReturnType<typeof normalizeDeductionSettings>;
  try { settings = normalizeDeductionSettings(input, profile.settings); }
  catch { return blocked('已审核资料缺少累计基准或不适用于该发薪日，请补充审核'); }
  const year = input.payDate.slice(0, 4);
  const payments = await tx.payrollNetPayment.findMany({ where: { subjectId: input.subjectId, employeeId: input.employeeId, domain: input.domain,
    OR: [{ payDate: { gte: payrollDate(`${year}-01-01`), lte: payrollDate(`${year}-12-31`) } },
      { snapshot: { path: ['ledger', 'socialMonth'], equals: settings.socialInsurance.contributionDate.slice(0, 7) } },
      { snapshot: { path: ['ledger', 'housingMonth'], equals: settings.housingFund.contributionDate.slice(0, 7) } }],
  }, orderBy: [{ payDate: 'asc' }, { id: 'asc' }],
    include: { version: { select: { netSnapshot: true, status: true, voidedAt: true, approvedAt: true, submittedById: true,
      approvalStep: true, approvalPath: true, reviewerCount: true, decisions: { orderBy: { step: 'asc' } },
      batch: { select: { subjectId: true, purpose: true } } } } } });
  const facts: NetLedgerFact[] = [];
  for (const payment of payments) {
    const stored = payment.snapshot as unknown as PayrollNetRow;
    const v = payment.version;
    if (v.status !== 'approved' || v.voidedAt || !v.approvedAt || !v.submittedById || v.reviewerCount < 1 || v.reviewerCount >= v.approvalPath.length ||
      v.approvalStep !== v.approvalPath.length || new Set(v.approvalPath).size !== v.approvalPath.length || v.approvalPath.includes(v.submittedById) ||
      v.decisions.length !== v.approvalPath.length || v.decisions.some((decision, i) => decision.step !== i || decision.action !== 'approve' || decision.actorId !== v.approvalPath[i]) ||
      v.batch.subjectId !== input.subjectId ||
      (input.domain === 'formal' ? payment.version.batch.purpose !== 'formal' : payment.version.batch.purpose !== 'validation')) {
      return blocked('实际扣缴记录的主体或批准来源不一致');
    }
    assertPayrollNetShape(payment.version.netSnapshot);
    const approved = payment.version.netSnapshot.rows.find(row => row.employeeId === input.employeeId);
    if (!approved || !stored.ledger || netSnapshotHash(approved) !== netSnapshotHash(stored) ||
      moneyFields.some(key => !payment[key].eq(stored.result[key]!))) return blocked('实际扣缴记录与批准金额不一致');
    facts.push({ id: payment.id, payDate: payment.payDate.toISOString().slice(0, 10), gross: payment.gross.toFixed(2),
      socialInsurance: payment.socialInsurance.toFixed(2), housingFund: payment.housingFund.toFixed(2), incomeTax: payment.incomeTax.toFixed(2),
      taxDeductions: stored.ledger.taxDeductions, socialMonth: stored.ledger.socialMonth, housingMonth: stored.ledger.housingMonth,
      openingDate: stored.ledger.openingDate, openingHash: stored.ledger.openingHash });
  }
  try {
    const calculated = calculateNetWithLedger(input, settings, facts), { ledger, ...result } = calculated;
    result.evidence.parameter = { id: profile.id, version: profile.version, releaseId: release.id, snapshotHash: release.snapshotHash };
    return { result, ...(ledger ? { ledger } : {}) };
  } catch { return blocked('已审核资料缺少累计基准或不适用于该发薪日，请补充审核'); }
}

export async function capturePayrollNet(tx: Prisma.TransactionClient, batch: { subjectId: string; payMonth: string }, domain: string,
  payDate: string, lines: Array<{ employeeId: string; amount: string | null; evidence: unknown }>): Promise<PayrollNetSnapshot> {
  payrollDate(payDate);
  if (payDate.slice(0, 7) !== batch.payMonth) throw new ConflictException('发薪日必须属于批次发放月');
  const groups = new Map<string, { gross: Prisma.Decimal; employeeName: string; employeeNo: string }>();
  for (const line of lines) {
    const prior = groups.get(line.employeeId), evidence = line.evidence as { employeeName?: string; employeeNo?: string };
    groups.set(line.employeeId, { gross: (prior?.gross ?? new D(0)).plus(line.amount ?? 0),
      employeeName: prior?.employeeName ?? evidence?.employeeName ?? line.employeeId, employeeNo: prior?.employeeNo ?? evidence?.employeeNo ?? '' });
  }
  const rows: PayrollNetRow[] = [];
  for (const [employeeId, data] of [...groups].sort(([a], [b]) => a.localeCompare(b))) rows.push({ employeeId,
    employeeName: data.employeeName, employeeNo: data.employeeNo, ...await readNetRow(tx, {
      subjectId: batch.subjectId, employeeId, domain, payDate, gross: data.gross.toFixed(2) }) });
  const totals = rows.length && rows.every(row => row.result.status === 'ready')
    ? Object.fromEntries(moneyFields.map(key => [key, rows.reduce((sum, row) => sum.plus(row.result[key]!), new D(0)).toFixed(2)])) as PayrollNetSnapshot['totals'] : null;
  const body = { schema: 1 as const, subjectId: batch.subjectId, domain, payDate, rows, totals };
  return { ...body, sourceHash: netSnapshotHash(body) };
}

// Paid rows are immutable historical results. Only unpaid rows must still match live cumulative sources.
export async function assertPayrollNetFresh(tx: Prisma.TransactionClient, batch: { id: string; subjectId: string; purpose: string; payMonth: string }, raw: unknown, domain: string, versionId?: string) {
  assertPayrollNetShape(raw);
  if (raw.subjectId !== batch.subjectId || raw.domain !== domain || raw.payDate.slice(0, 7) !== batch.payMonth) throw new ConflictException('实发快照归属不正确');
  for (const row of raw.rows) {
    const cancelled = versionId && await tx.payrollEvent.findFirst({ where: { batchId: batch.id, action: 'remainder_cancelled', AND: [
      { metadata: { path: ['versionId'], equals: versionId } }, { metadata: { path: ['employeeId'], equals: row.employeeId } },
    ] }, select: { id: true } });
    if (cancelled) continue;
    const own = await tx.payrollNetPayment.findFirst({ where: { subjectId: batch.subjectId, employeeId: row.employeeId, domain,
      version: { batchId: batch.id, netSnapshot: { path: ['sourceHash'], equals: raw.sourceHash } } } });
    if (own) {
      if (netSnapshotHash(own.snapshot) !== netSnapshotHash(row) || own.payDate.toISOString().slice(0, 10) !== raw.payDate ||
        moneyFields.some(key => !own[key].eq(row.result[key]!))) throw new ConflictException('实发确认与批准快照不一致');
      continue;
    }
    const current = await readNetRow(tx, { subjectId: batch.subjectId, domain, employeeId: row.employeeId, payDate: raw.payDate, gross: row.result.gross! });
    if (netSnapshotHash(current) !== netSnapshotHash({ result: row.result, ledger: row.ledger })) {
      throw new ConflictException('扣缴资料或实际累计已变化，请撤回或退回后重算，未付款版本不得继续办理');
    }
  }
}
