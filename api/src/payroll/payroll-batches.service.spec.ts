import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollCapture } from './payroll-contracts';
import { PayrollBatchesService } from './payroll-batches.service';
import { PayrollController } from './payroll.controller';
import { PayrollExceptionFilter } from './payroll-exception.filter';
import { readPayrollPerformance } from './payroll-performance-source';
import * as netHelpers from './payroll-net';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';

const subject = randomUUID(), otherSubject = randomUUID(), employee = randomUUID();
const editor = { id: randomUUID() }, reviewer = { id: randomUUID() }, approver = { id: randomUUID() };
const finance = { id: randomUUID() }, outsider = { id: randomUUID(), sysRole: 'system_admin', canViewAll: true };

function clone<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new (value.constructor as typeof Prisma.Decimal)(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

function selectFields(value: any, select: any): any {
  if (Array.isArray(value)) return value.map(entry => selectFields(entry, select));
  if (!value || !select) return value;
  return Object.fromEntries(Object.entries(select).map(([key, field]: [string, any]) =>
    [key, field === true ? value[key] : selectFields(value[key], field.select)]));
}

// Only the persistence boundary is doubled; the service and live grant checks are real.
function database() {
  const state = { batches: [] as any[], versions: [] as any[], lines: [] as any[], decisions: [] as any[],
    reservations: [] as any[], settlements: [] as any[], openings: [] as any[], events: [] as any[], exports: [] as any[],
    netPayments: [] as any[], grants: [
      { userId: editor.id, subjectId: subject, capabilities: ['payroll_edit'], revokedAt: null },
      { userId: reviewer.id, subjectId: subject, capabilities: ['payroll_review'], revokedAt: null },
      { userId: approver.id, subjectId: subject, capabilities: ['payroll_approve'], revokedAt: null },
      { userId: finance.id, subjectId: subject, capabilities: ['payroll_settle'], revokedAt: null },
    ] as any[] };
  const version = (v: any) => ({ ...v, lines: state.lines.filter(l => l.versionId === v.id).map(l => ({ ...l,
    settlements: state.settlements.filter(s => s.lineId === l.id), reservation: state.reservations.find(r => r.lineId === l.id) ?? null })),
    decisions: state.decisions.filter(d => d.versionId === v.id).sort((a, b) => a.step - b.step),
    exports: state.exports.filter(e => e.versionId === v.id), netPayments: state.netPayments.filter(p => p.versionId === v.id) });
  const batch = (b: any, args: any = {}) => {
    if (!b) return null;
    const versions = args.include?.versions ?? args.select?.versions;
    const data = { ...b, versions: state.versions.filter(v => v.batchId === b.id &&
      (!versions?.where?.id?.in || versions.where.id.in.includes(v.id)))
      .sort((a, b) => b.version - a.version).slice(0, versions?.take ?? 50).map(version) };
    return args.select ? selectFields(data, args.select) : data;
  };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payrollGrant: { findMany: jest.fn(async ({ where }) => state.grants.filter(g => g.userId === where.userId &&
      g.subjectId === where.subjectId && g.revokedAt === where.revokedAt)) },
    payrollBatch: {
      findUnique: jest.fn(async (args) => batch(state.batches.find(b => b.id === args.where.id), args)),
      findMany: jest.fn(async (args) => state.batches.filter(b => b.subjectId === args.where.subjectId &&
        (!args.where.month || b.month === args.where.month) && (!args.where.id?.in || args.where.id.in.includes(b.id)))
        .sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id))
        .slice(0, args.take).map(b => batch(b, args))),
      create: jest.fn(async ({ data }) => { const b = { id: randomUUID(), version: 0, status: 'draft', correctionOfId: null,
        additionalMonths: [], createdAt: new Date(), updatedAt: new Date(), ...data }; state.batches.push(b); return { ...b }; }),
      update: jest.fn(async ({ where, data }) => { const b = state.batches.find(b => b.id === where.id)!;
        const { version, ...rest } = data; Object.assign(b, rest); if (version) b.version = typeof version === 'number' ? version : b.version + version.increment;
        return { ...b }; }),
    },
    payrollVersion: {
      create: jest.fn(async ({ data }) => { const { lines, ...rest } = data; const v = { id: randomUUID(), status: 'calculated',
        approvalStep: 0, submittedById: null, submittedAt: null, approvedAt: null, voidedAt: null, createdAt: new Date(), ...rest };
        state.versions.push(v); for (const l of lines.create) state.lines.push({ id: randomUUID(), versionId: v.id, ...l }); return version(v); }),
      update: jest.fn(async ({ where, data }) => { const v = state.versions.find(v => v.id === where.id)!; Object.assign(v, data); return version(v); }),
    },
    payrollDecision: { create: jest.fn(async ({ data }) => { if (state.decisions.some(d => d.versionId === data.versionId && d.step === data.step)) throw { code: 'P2002' };
      const d = { id: randomUUID(), createdAt: new Date(), ...data }; state.decisions.push(d); return d; }) },
    payrollReservation: {
      findMany: jest.fn(async ({ where }) => state.reservations.filter(r => r.subjectId === where.subjectId && r.domain === where.domain &&
        where.OR.some(key => ['employeeId', 'attributionMonth', 'itemCode'].every(k => r[k] === key[k])))
        .map(r => ({ ...r, line: { version: { batchId: state.versions.find(v => v.id === state.lines.find(l => l.id === r.lineId)?.versionId)?.batchId } } }))),
      createMany: jest.fn(async ({ data }) => { for (const row of data) {
        if (state.reservations.some(r => ['subjectId', 'employeeId', 'domain', 'attributionMonth', 'itemCode'].every(k => r[k] === row[k]))) throw { code: 'P2002' };
        state.reservations.push({ ...row }); } return { count: data.length }; }),
      deleteMany: jest.fn(async ({ where }) => { const ids = where.lineId?.in ?? [where.lineId];
        const remaining = state.reservations.filter(r => !ids.includes(r.lineId)); const count = state.reservations.length - remaining.length;
        state.reservations = remaining; return { count }; }),
    },
    payrollOpeningBalance: { findMany: jest.fn(async ({ where }) => state.openings.filter(o => o.subjectId === where.subjectId && o.domain === where.domain &&
      where.OR.some(key => ['employeeId', 'attributionMonth', 'itemCode'].every(k => o[k] === key[k])))) },
    payrollSettlement: {
      findUnique: jest.fn(async ({ where }) => state.settlements.find(s => s.requestId === where.requestId) ?? null),
      findMany: jest.fn(async ({ where }) => state.settlements.map(s => ({ ...s, line: state.lines.find(l => l.id === s.lineId) }))
        .filter(s => { const b = state.batches.find(b => b.id === state.versions.find(v => v.id === s.line.versionId)?.batchId);
          const scope = where.line?.version?.batch;
          return !scope || b?.subjectId === scope.subjectId && (typeof scope.purpose === 'string' ? b.purpose === scope.purpose : scope.purpose.in.includes(b.purpose)) &&
            where.line.OR.some(key => ['employeeId', 'attributionMonth', 'itemCode'].every(k => s.line[k] === key[k])); })),
      create: jest.fn(async ({ data }) => { const s = { id: randomUUID(), createdAt: new Date(), ...data }; state.settlements.push(s); return s; }),
    },
    payrollEvent: {
      create: jest.fn(async ({ data }) => { const e = { id: randomUUID(), createdAt: new Date(), ...data }; state.events.push(e); return e; }),
      findMany: jest.fn(async ({ where, take }) => state.events.filter(e => e.subjectId === where.subjectId && e.batchId === where.batchId &&
        (!where.version?.in || where.version.in.includes(e.version))).slice(0, take)),
    },
  };
  const prisma: any = { ...tx, $transaction: jest.fn(async (callback, options) => {
    expect(['Serializable', 'ReadCommitted']).toContain(options.isolationLevel); const before = clone(state);
    try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
  }) };
  return { state, tx, prisma };
}

describe('PayrollBatchesService isolated obligations and workflow', () => {
  let db: ReturnType<typeof database>, access: PayrollAccessService, service: PayrollBatchesService;
  let enabled: boolean, domainAllowed: boolean, capture: PayrollCapture, sources: { capture: jest.Mock };
  const createInput = () => ({ subjectId: subject, month: '2026-11', payMonth: '2026-12', purpose: 'validation' as const });
  beforeEach(() => {
    db = database(); enabled = true; domainAllowed = true;
    access = new PayrollAccessService(db.prisma as PrismaService, { get: (key: string) =>
      key === 'PAYROLL_ENABLED' ? String(enabled) : key === 'HRM_PREVIEW' ? 'true' : 'false' } as ConfigService);
    jest.spyOn(access, 'assertDomain').mockImplementation(async (_tx, purpose) => {
      if (!domainAllowed || purpose === 'formal') throw new ForbiddenException(); return 'validation';
    });
    capture = { sourceHash: 'a'.repeat(64), sources: { attendanceVersion: 1 }, issues: [],
      approvalPath: [reviewer.id, approver.id], reviewerCount: 1, gross: '200.00', lines: [{
        employeeId: employee, attributionMonth: '2026-11', itemCode: 'fixed', status: 'ready', entitlement: '200.00',
        paidBefore: '0.00', amount: '200.00', evidence: { formula: 'fictional' } }] };
    sources = { capture: jest.fn(async () => clone(capture)) };
    service = new PayrollBatchesService(db.prisma, access, sources);
    confirmOpening();
  });
  function confirmOpening(employeeId: string = employee, attributionMonth = '2026-11', itemCode = 'fixed', amount = '0') {
    const existing = db.state.openings.find(o => o.employeeId === employeeId && o.attributionMonth === attributionMonth && o.itemCode === itemCode);
    const opening = { subjectId: subject, employeeId, domain: 'validation', attributionMonth, itemCode, amount: new Prisma.Decimal(amount),
      reference: 'FICTIONAL-OPENING', confirmedAt: new Date(), confirmedById: finance.id };
    if (existing) Object.assign(existing, opening); else db.state.openings.push(opening);
  }
  function clearPrivateReads() { db.tx.payrollBatch.findUnique.mockClear(); db.tx.payrollBatch.findMany.mockClear(); sources.capture.mockClear(); }
  function expectNoPrivateReads() {
    const reads = [...db.tx.payrollBatch.findUnique.mock.calls, ...db.tx.payrollBatch.findMany.mock.calls];
    expect(reads.filter(([args]) => args.include?.versions?.include?.lines || args.select?.versions?.select?.sources)).toHaveLength(0);
    expect(sources.capture).not.toHaveBeenCalled();
  }
  async function calculated() {
    const b = await service.create(createInput(), editor);
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    return new Proxy(db.state.batches.find(row => row.id === b.id)!, {
      get: (_target, key) => db.state.batches.find(row => row.id === b.id)![key],
    });
  }
  async function submitted() { const b = await calculated(); await service.submit(b.id, { expectedVersion: b.version }, editor); return b; }
  async function approved() { const b = await submitted();
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: 'Fictional review' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: 'Fictional approval' }, approver); return b; }
  async function approvedPerformance() {
    const task: any = { id: 'fictional-task', employeeId: employee, cycleId: 'monthly-cycle', status: 'published',
      isExempt: false, participantDisposition: 'active', publishedAt: new Date('2026-11-30'),
      cycle: { type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') },
      gradeResult: { id: 'grade', calibratedGrade: 'A', rawGrade: 'B', isPublished: true, publishedAt: new Date('2026-11-30'), hrCalibratedAt: null, approvedAt: null }, appeals: [] };
    db.tx.assessmentTask = { findUnique: jest.fn(async () => task) };
    const result = await readPayrollPerformance(db.tx, { employeeId: employee, cycleId: task.cycleId, registeredCycleIds: [task.cycleId], requiredMonth: '2026-11' });
    const policy: any = { id: 'policy', subjectId: subject, domain: 'validation', status: 'active', version: 1,
      effectiveFrom: new Date('2026-11-01'), effectiveTo: null, config: { fixedSalaryBasis: 'monthly_workdays', performance: {
        '2026-11': { sourceKind: 'fictional', cycleIds: [task.cycleId], coefficients: { A: '1', B: '0.8' }, coefficientVersion: 'v1', evidenceRef: 'fictional-approved' },
      } } };
    const release = { ruleId: policy.id, previousParameterId: null, parameterVersion: 1, snapshotHash: payrollHash(payrollParameterDefinition('rule', policy)) };
    db.tx.payrollPolicy = { findMany: jest.fn(async () => [policy]) }; db.tx.payrollParameterRelease = { findMany: jest.fn(async () => [release]) };
    capture.sources = JSON.parse(JSON.stringify({ performance: [{ employeeId: employee, cycleId: task.cycleId, result }], policies: [policy], parameterReleases: [release],
      attendance: { payload: { days: [{ employeeId: employee, workDate: '2026-11-10' }] } } }));
    capture.lines = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'].map(itemCode => ({ ...capture.lines[0], itemCode: itemCode as any,
      amount: itemCode === 'fixed' ? '200.00' : '0.00', entitlement: itemCode === 'fixed' ? '200.00' : '0.00' }));
    for (const line of capture.lines) confirmOpening(employee, '2026-11', line.itemCode);
    const batch = await approved();
    db.tx.payrollNetPayment = { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) };
    return { batch, task };
  }
  it('marks an approved unpaid version stale when automatic performance publication changes without recapturing gross', async () => {
    const { batch, task } = await approvedPerformance(); sources.capture.mockClear(); task.gradeResult.isPublished = false;
    expect((await service.detail(batch.id, editor)).versions[0].needsUpdate).toBe(true);
    expect(sources.capture).not.toHaveBeenCalled(); expect(db.state.settlements).toHaveLength(0);
  });
  it('blocks legacy gross settlement after approved unpaid automatic performance changes', async () => {
    const { batch, task } = await approvedPerformance(); sources.capture.mockClear(); task.gradeResult.isPublished = false;
    await expect(service.settle(batch.id, payment(batch, '200.00'), finance)).rejects.toThrow(ConflictException);
    expect(db.state.settlements).toHaveLength(0); expect(sources.capture).not.toHaveBeenCalled();
  });
  it('blocks net payment after approved automatic performance changes before any funds facts are written', async () => {
    const { batch, task } = await approvedPerformance(), version = db.state.versions[0];
    const body = { schema: 1, subjectId: subject, domain: 'validation', payDate: '2026-12-10', rows: [{ employeeId: employee, employeeName: '虚构员工', employeeNo: 'PAY_TEST',
      result: { status: 'ready', issues: [], gross: '200.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '200.00', evidence: { parameter: {} } }, ledger: {} }],
      totals: { gross: '200.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '200.00' } };
    version.netSnapshot = { ...body, sourceHash: netHelpers.netSnapshotHash(body) }; version.payDate = new Date(body.payDate);
    db.tx.payrollNetReservation = { findUnique: jest.fn(async () => ({ versionId: version.id })), deleteMany: jest.fn(async () => ({})) };
    const fresh = jest.spyOn(netHelpers, 'assertPayrollNetFresh').mockResolvedValue(undefined);
    try {
      sources.capture.mockClear(); task.gradeResult.calibratedGrade = 'C';
      await expect(service.netPayment(batch.id, { expectedVersion: batch.version, employeeId: employee, requestId: randomUUID(), reference: 'FICTIONAL', payDate: body.payDate }, finance)).rejects.toThrow(ConflictException);
      expect(db.tx.payrollNetPayment.create).not.toHaveBeenCalled(); expect(db.state.settlements).toHaveLength(0); expect(sources.capture).not.toHaveBeenCalled();
    } finally { fresh.mockRestore(); }
  });
  const payment = (b: any, amount = '150.00', requestId = randomUUID()) => ({ expectedVersion: b.version,
    lineId: db.state.lines.find(l => l.versionId === db.state.versions.filter(v => v.batchId === b.id).at(-1)!.id)!.id,
    amount, reference: 'FICTIONAL-RECEIPT-1', requestId });
  function httpFailure(error: unknown) {
    let status: number, body: any;
    const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { body = value; } };
    new PayrollExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => res }) } as any);
    return { status: status!, body };
  }

  describe('real reconciliation is calculation-only', () => {
    const input = () => ({ ...createInput(), purpose: 'reconciliation' as any });
    beforeEach(() => {
      access = new PayrollAccessService(db.prisma, { get: (key: string) =>
        ['PAYROLL_ENABLED', 'PAYROLL_FORMAL_ENABLED'].includes(key) ? 'true' : 'false' } as ConfigService);
      service = new PayrollBatchesService(db.prisma, access, sources);
      capture.sources = { subjectId: subject, month: '2026-11', domain: 'formal' };
      db.tx.payrollNetReservation = { createMany: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn() };
      db.tx.payrollNetPayment = { create: jest.fn(), findMany: jest.fn(async () => []) };
    });
    it('creates and repeatedly calculates real sources without a preview marker or formal reservations', async () => {
      const batch = await service.create(input(), editor);
      await service.calculate(batch.id, { expectedVersion: 0 }, editor);
      const original = clone(db.state.versions[0]);
      await service.calculate(batch.id, { expectedVersion: 1 }, editor);
      expect(db.state.versions.map(v => v.version)).toEqual([1, 2]);
      expect(db.state.versions[0]).toEqual(original);
      expect(sources.capture).toHaveBeenCalledWith(db.tx, subject, '2026-11', 'formal');
      expect((await service.list(subject, editor))[0].purpose).toBe('reconciliation');
      expect((await service.detail(batch.id, editor)).versions).toHaveLength(2);
      expect(db.state.reservations).toEqual([]); expect(db.state.settlements).toEqual([]);
      expect(db.tx.payrollNetReservation.createMany).not.toHaveBeenCalled();
      expect(db.tx.payrollNetReservation.deleteMany).not.toHaveBeenCalled();
      expect(db.tx.payrollNetPayment.create).not.toHaveBeenCalled();
    });
    it('does not grant real reconciliation to HR/admin titles, cross-subject or assessor-only actors', async () => {
      for (const actor of [outsider, { ...editor, isAssessorOnly: true }]) await expect(service.create(input(), actor)).rejects.toThrow(ForbiddenException);
      await expect(service.create({ ...input(), subjectId: otherSubject }, editor)).rejects.toThrow(ForbiddenException);
      const b = await service.create(input(), editor);
      await expect(service.detail(b.id, outsider)).rejects.toThrow(ForbiddenException);
      expect(db.state.batches).toHaveLength(1);
    });
    it('uses reviewed formal net inputs without writing tax facts or allocations across repeated calculations', async () => {
      const payDate = '2026-12-10';
      const { gross, payDate: date, subjectId, employeeId, ...settings } = fictionalDeductionsInput({
        subjectId: subject, employeeId: employee, month: '2026-11', payDate, gross: '1000.00' });
      const { subjectId: s, employeeId: e, year, ...opening } = settings.tax.opening;
      const profile: any = { id: randomUUID(), subjectId, employeeId, domain: 'formal', version: 1, status: 'active',
        payDate: new Date(date), effectiveFrom: new Date(date), effectiveTo: new Date(date), settings: {
          ...settings, tax: { ...settings.tax, opening }, ledger: { startDate: '2026-01-01',
            priorInPayMonth: Object.fromEntries(Object.keys(settings.tax.current).map(key => [key, '0'])), priorSocialInsurance: '0', priorHousingFund: '0' },
        } };
      profile.releases = [{ id: randomUUID(), parameterVersion: 1, submittedById: editor.id, reviewerId: reviewer.id,
        snapshotHash: payrollHash(payrollParameterDefinition('deduction', profile)) }];
      db.tx.payrollDeductionProfile = { findFirst: jest.fn(async () => profile) };
      capture.gross = capture.lines[0].amount = capture.lines[0].entitlement = '1000.00';
      const b = await service.create(input(), editor);
      await service.calculate(b.id, { expectedVersion: 0, payDate }, editor);
      await service.calculate(b.id, { expectedVersion: 1, payDate }, editor);
      expect(db.state.versions[0].netSnapshot).toEqual(db.state.versions[1].netSnapshot);
      expect(db.state.versions[0].netSnapshot.domain).toBe('formal');
      expect(db.state.versions[0].netSnapshot.totals).toEqual({ gross: '1000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '80.00', net: '720.00' });
      expect(db.tx.payrollDeductionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ domain: 'formal', subjectId: subject }) }));
      expect(db.tx.payrollNetPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ domain: 'formal', subjectId: subject }) }));
      expect(db.tx.payrollNetPayment.create).not.toHaveBeenCalled(); expect(db.state.settlements).toEqual([]);
      expect(db.tx.payrollNetReservation.createMany).not.toHaveBeenCalled(); expect(db.state.reservations).toEqual([]);
    });
    it('parallel independent reconciliations leave existing formal payments and occupied amounts untouched', async () => {
      const existing = { subjectId: subject, employeeId: employee, domain: 'formal', attributionMonth: '2026-11', itemCode: 'fixed', lineId: randomUUID() };
      db.state.reservations.push(existing); db.state.netPayments.push({ id: randomUUID(), subjectId: otherSubject, amount: '500.00' });
      const before = clone({ allocations: db.state.reservations, paid: db.state.netPayments });
      const first = await service.create(input(), editor), second = await service.create(input(), editor);
      await Promise.all([first, second].map(b => service.calculate(b.id, { expectedVersion: 0 }, editor)));
      expect(db.state.versions).toHaveLength(2); expect(new Set(db.state.versions.map(v => v.batchId)).size).toBe(2);
      expect({ allocations: db.state.reservations, paid: db.state.netPayments }).toEqual(before);
      expect(db.tx.payrollReservation.createMany).not.toHaveBeenCalled(); expect(db.tx.payrollReservation.deleteMany).not.toHaveBeenCalled();
    });
    it('requires formal net calculation for formal purpose even if an operator intended reconciliation', async () => {
      const b = await service.create({ ...input(), purpose: 'formal' }, editor);
      await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toThrow('正式工资必须核算扣缴及实发');
      expect(db.state.versions).toEqual([]);
    });
    it('preserves pending configuration and source failures without fabricating zero or reserving funds', async () => {
      const b = await service.create(input(), editor);
      capture.issues = ['Fictional unconfirmed source']; capture.gross = null;
      capture.lines[0].status = 'needs_configuration'; capture.lines[0].amount = null;
      await service.calculate(b.id, { expectedVersion: 0 }, editor);
      const result = await service.detail(b.id, editor);
      expect(result.versions[0].gross).toBeNull(); expect(result.versions[0].issues).toContain('Fictional unconfirmed source');
      sources.capture.mockRejectedValueOnce(new Error('offline'));
      await expect(service.calculate(b.id, { expectedVersion: 1 }, editor)).rejects.toThrow(ConflictException);
      expect(db.state.versions).toHaveLength(1); expect(db.state.reservations).toEqual([]);
    });
    it('rejects a validation-domain source returned for a real reconciliation', async () => {
      const b = await service.create(input(), editor); (capture.sources as any).domain = 'validation';
      await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toThrow(ConflictException);
      expect(db.state.versions).toEqual([]);
    });
    it('does not convert real reconciliation into a correction of an approved formal batch', async () => {
      const original = await db.tx.payrollBatch.create({ data: { ...createInput(), purpose: 'formal', status: 'approved' } });
      await expect(service.create({ ...input(), correctionOfId: original.id }, editor)).rejects.toThrow(BadRequestException);
      expect(db.state.batches).toHaveLength(1);
    });
    it('rejects stale concurrent recalculation tokens without creating duplicate versions or reservations', async () => {
      const b = await service.create(input(), editor);
      await service.calculate(b.id, { expectedVersion: 0 }, editor);
      await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toThrow(ConflictException);
      expect(db.state.versions).toHaveLength(1); expect(db.state.reservations).toEqual([]);
    });
    it.each(['submit', 'withdraw', 'decide', 'settle', 'netPayment', 'cancelRemainder', 'cancelNetRemainder', 'voidApproved', 'deductionsPreview'])('rejects the %s backdoor even for an apparently approved/assigned reconciliation', async action => {
      const b = await service.create(input(), editor); await service.calculate(b.id, { expectedVersion: 0 }, editor);
      const batch = db.state.batches[0], version = db.state.versions[0];
      batch.status = version.status = ['decide', 'withdraw'].includes(action) ? 'pending' : action === 'submit' ? 'calculated' : 'approved';
      version.submittedById = editor.id; version.approvedAt = new Date();
      version.approvalStep = action === 'decide' ? 0 : 2;
      if (version.approvalStep === 2) for (const [step, actorId] of [reviewer.id, approver.id].entries()) db.state.decisions.push({ versionId: version.id, step, actorId, action: 'approve' });
      const body = { expectedVersion: batch.version, decision: 'approve', note: 'Fictional', confirmedUnpaid: true,
        lineId: db.state.lines[0].id, employeeId: employee, requestId: randomUUID(), amount: '10.00', reference: 'Fictional', payDate: '2026-12-10', mode: 'complete' };
      const actor = action === 'decide' ? reviewer : ['submit', 'withdraw', 'deductionsPreview'].includes(action) ? editor : finance;
      const before = clone(db.state);
      await expect((service as any)[action](b.id, body, actor)).rejects.toThrow(/对账|试算/);
      expect(db.state).toEqual(before); expect(db.tx.payrollNetPayment.create).not.toHaveBeenCalled();
    });
    it('never exposes reconciliation to assigned approvers or final-only readers through forged state', async () => {
      const b = await service.create(input(), editor); await service.calculate(b.id, { expectedVersion: 0 }, editor);
      const batch = db.state.batches[0], v = db.state.versions[0]; batch.status = v.status = 'approved';
      v.submittedById = editor.id; v.approvedAt = new Date(); v.approvalStep = 2;
      for (const [step, actorId] of [reviewer.id, approver.id].entries()) db.state.decisions.push({ versionId: v.id, step, actorId, action: 'approve' });
      for (const actor of [reviewer, approver, finance]) {
        expect(await service.list(subject, actor)).toEqual([]);
        await expect(service.detail(b.id, actor)).rejects.toThrow(ForbiddenException);
      }
    });
  });

  it('denies HR/admin, cross-subject, assessor-only, disabled and domain bypasses without writing', async () => {
    for (const actor of [outsider, { ...editor, isAssessorOnly: true }]) await expect(service.create(createInput(), actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create({ ...createInput(), subjectId: otherSubject }, editor)).rejects.toBeInstanceOf(ForbiddenException);
    enabled = false; await expect(service.list(subject, editor)).rejects.toBeInstanceOf(ForbiddenException);
    enabled = true; domainAllowed = false; await expect(service.create(createInput(), editor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.state.batches).toHaveLength(0);
  });
  it('validates months and correction identity without modifying a different subject', async () => {
    await expect(service.create({ ...createInput(), month: '2026-13' }, editor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...createInput(), correctionOfId: randomUUID() }, editor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...createInput(), additionalMonths: ['2026-11'] }, editor)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.state.batches).toHaveLength(0);
  });
  it('creates immutable money/evidence versions and rejects stale write tokens', async () => {
    const b = await calculated(), old = clone(db.state.versions[0]), oldLine = clone(db.state.lines[0]);
    await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toBeInstanceOf(ConflictException);
    capture.sourceHash = 'b'.repeat(64); capture.gross = '210.00'; capture.lines[0].entitlement = capture.lines[0].amount = '210.00';
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    expect(db.state.versions[0]).toEqual(old); expect(db.state.lines[0]).toEqual(oldLine);
    const detail = JSON.parse(JSON.stringify(await service.detail(b.id, editor)));
    expect(detail.versions.map(v => v.version)).toEqual([2, 1]);
    expect(detail.versions[0].lines[0].amount).toBe('210'); expect(detail.events.length).toBeGreaterThan(0);
    expect(db.tx.$queryRaw).toHaveBeenCalled();
  });
  it.each(['equation', 'total', 'precision', 'duplicate'])('rejects invalid source %s atomically', async (kind) => {
    if (kind === 'equation') capture.lines[0].paidBefore = '1.00';
    if (kind === 'total') capture.gross = '199.99';
    if (kind === 'precision') capture.lines[0].amount = '200.001';
    if (kind === 'duplicate') { capture.lines.push(clone(capture.lines[0])); capture.gross = '400.00'; }
    const b = await service.create(createInput(), editor);
    await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.versions).toHaveLength(0); expect(db.state.lines).toHaveLength(0);
  });
  it('never treats a failed source read as zero', async () => {
    const b = await service.create(createInput(), editor); sources.capture.mockRejectedValue(new Error('offline'));
    await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.versions).toHaveLength(0);
  });
  it('retains incomplete preview but blocks partial success and trial submission', async () => {
    capture.issues = ['One employee is missing a rule']; const b = await calculated();
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    capture.issues = []; const trial = await service.create({ ...createInput(), purpose: 'trial' }, editor);
    await service.calculate(trial.id, { expectedVersion: trial.version }, editor);
    await expect(service.submit(trial.id, { expectedVersion: db.state.batches[1].version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0);
  });
  it('approves explicit not-applicable zeros without reserving or settling those lines', async () => {
    capture.lines.push({ ...clone(capture.lines[0]), itemCode: 'performance', status: 'not_applicable',
      entitlement: '0.00', paidBefore: '0.00', amount: '0.00', evidence: { applicability: 'not_applicable' } });
    confirmOpening(employee, '2026-11', 'performance');
    const b = await approved();
    expect(db.state.lines).toHaveLength(2); expect(db.state.reservations).toHaveLength(1);
    const nonapplicable = db.state.lines.find(l => l.itemCode === 'performance')!;
    await expect(service.settle(b.id, { ...payment(b, '1.00'), lineId: nonapplicable.id }, finance)).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['entitlement', 'paidBefore', 'amount', 'evidence'])('rejects invalid not-applicable %s instead of treating missing rules as zero', async (field) => {
    const line = { ...clone(capture.lines[0]), itemCode: 'performance' as const, status: 'not_applicable',
      entitlement: '0.00', paidBefore: '0.00', amount: '0.00', evidence: { applicability: 'not_applicable' } };
    (line as any)[field] = field === 'evidence' ? {} : null;
    capture.lines.push(line); const b = await service.create(createInput(), editor);
    await expect(service.calculate(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.versions).toHaveLength(0);
  });
  it('keeps a mathematically computed zero ready and releases its claim on full approval', async () => {
    capture.lines[0].entitlement = capture.lines[0].amount = capture.gross = '0.00';
    const b = await submitted(); expect(db.state.lines[0].status).toBe('ready'); expect(db.state.reservations).toHaveLength(1);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver);
    expect(db.state.reservations).toHaveLength(0);
  });
  it.each(['no reviewers', 'no approvers', 'duplicate actors', 'self review', 'revoked'])('blocks incomplete or unauthorized path: %s', async (kind) => {
    if (kind === 'no reviewers') capture.reviewerCount = 0;
    if (kind === 'no approvers') capture.reviewerCount = 2;
    if (kind === 'duplicate actors') capture.approvalPath = [reviewer.id, reviewer.id];
    if (kind === 'self review') capture.approvalPath[0] = editor.id;
    if (kind === 'revoked') db.state.grants.find(g => g.userId === approver.id)!.revokedAt = new Date();
    const b = await calculated(); await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toThrow();
    expect(db.state.reservations).toHaveLength(0);
  });
  it('checks actual paid totals again in the submitting transaction', async () => {
    const b = await calculated(); confirmOpening(employee, '2026-11', 'fixed', '100');
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0);
  });
  it.each(['0.00', '200.00'])('rejects missing confirmed opening even when the source claims paidBefore zero and delta %s', async amount => {
    capture.lines[0].entitlement = capture.lines[0].amount = capture.gross = amount;
    db.state.openings = []; const b = await calculated();
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0); expect(db.state.batches[0].status).toBe('calculated');
  });
  it('requires opening confirmation for each key, including explicit not-applicable zeros', async () => {
    capture.lines.push({ ...clone(capture.lines[0]), itemCode: 'performance', status: 'not_applicable',
      entitlement: '0.00', paidBefore: '0.00', amount: '0.00', evidence: { applicability: 'not_applicable' } });
    const b = await calculated();
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0);
  });
  it.each(['amount', 'confirmedAt', 'confirmedById', 'reference'])('rejects an opening with unconfirmed %s', async field => {
    db.state.openings[0][field] = field === 'reference' ? ' ' : null;
    const b = await calculated();
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks duplicate obligation keys across batches and rolls back every partial reservation', async () => {
    const first = await submitted(); const second = await calculated();
    capture.lines.unshift({ ...clone(capture.lines[0]), employeeId: randomUUID() }); capture.gross = '400.00';
    confirmOpening(capture.lines[0].employeeId);
    await service.calculate(second.id, { expectedVersion: second.version }, editor);
    await expect(service.submit(second.id, { expectedVersion: second.version }, editor)).rejects.toMatchObject({
      response: expect.objectContaining({ data: { batchId: first.id } }),
    });
    expect(db.state.reservations).toHaveLength(1); expect(db.state.batches.find(b => b.id === second.id)!.status).toBe('calculated');
    expect(first.id).not.toBe(second.id);
  });
  it('delivers an authorized obligation conflict ID through the real exception filter without taking any new claims', async () => {
    const first = await submitted(), second = await calculated();
    const error = await service.submit(second.id, { expectedVersion: second.version }, editor).catch(error => error);
    expect(error).toBeInstanceOf(ConflictException);
    const response = httpFailure(error);
    expect(response.status).toBe(409); expect(response.body.data).toEqual({ batchId: first.id });
    expect(JSON.stringify(response.body)).not.toContain(employee);
    expect(db.state.reservations).toHaveLength(1); expect(db.state.batches[1].status).toBe('calculated');
  });
  it.each(['other subject', 'other domain'])('does not reveal an original batch ID from an inconsistent %s reservation', async kind => {
    const first = await submitted(), second = await calculated();
    // The reservation FK alone does not guarantee that the original batch shares its subject/domain.
    if (kind === 'other subject') db.state.batches[0].subjectId = otherSubject;
    else db.state.batches[0].purpose = 'formal';
    const error = await service.submit(second.id, { expectedVersion: second.version }, editor).catch(error => error);
    expect(error).toBeInstanceOf(ConflictException);
    const response = httpFailure(error);
    expect(response.status).toBe(409); expect(response.body.data).toBeNull();
    expect(JSON.stringify(error)).not.toContain(first.id);
    expect(JSON.stringify(response.body)).not.toContain(first.id);
    expect(db.state.reservations).toHaveLength(1); expect(db.state.batches[1].status).toBe('calculated');
  });
  it.each(['P2002', 'P2034'])('maps %s to conflict without retrying the write', async (code) => {
    const b = await calculated(); db.tx.payrollReservation.createMany.mockRejectedValue({ code });
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.tx.payrollReservation.createMany).toHaveBeenCalledTimes(1); expect(db.state.batches[0].status).toBe('calculated');
  });
  it('blocks submission of an unchanged snapshot after source update, without taking any claim', async () => {
    const b = await calculated(); capture.sourceHash = 'f'.repeat(64);
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0); expect(db.state.batches[0].status).toBe('calculated');
  });
  it('requires fixed actor order and a live grant at every decision', async () => {
    const b = await submitted();
    await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver)).rejects.toBeInstanceOf(ForbiddenException);
    db.state.grants.find(g => g.userId === reviewer.id)!.revokedAt = new Date();
    await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.state.decisions).toHaveLength(0);
  });
  it('return -> recalculate -> resubmit preserves decisions and cannot reuse old approval', async () => {
    const b = await submitted();
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: 'Old review' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'return', note: 'Correct source' }, approver);
    const old = clone(db.state.decisions); expect(db.state.reservations).toHaveLength(0);
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    await service.calculate(b.id, { expectedVersion: b.version }, editor); await service.submit(b.id, { expectedVersion: b.version }, editor);
    await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.state.decisions).toEqual(old); expect(db.state.versions[1].approvalStep).toBe(0);
  });
  it('pauses changed/unavailable source without mutating the pending version and allows withdrawal', async () => {
    const b = await submitted(); const frozen = clone(db.state.versions[0]); capture.sourceHash = 'b'.repeat(64);
    expect((await service.detail(b.id, reviewer)).versions[0].needsUpdate).toBe(true);
    await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer)).rejects.toBeInstanceOf(ConflictException);
    sources.capture.mockRejectedValue(new Error('unavailable'));
    expect((await service.detail(b.id, editor)).versions[0].needsUpdate).toBe(true);
    expect(db.state.versions[0]).toEqual(frozen);
    await service.withdraw(b.id, { expectedVersion: b.version, note: 'Read failed' }, editor);
    expect(db.state.reservations).toHaveLength(0); expect(db.state.batches[0].status).toBe('withdrawn');
  });
  it('returns latest-only lists and assignment-filtered histories, never old-assignment access', async () => {
    const b = await submitted(); expect((await service.list(subject, reviewer))[0].versions).toHaveLength(1);
    await service.withdraw(b.id, { expectedVersion: b.version, note: 'Change reviewers' }, editor);
    const next = randomUUID(); db.state.grants.push({ userId: next, subjectId: subject, capabilities: ['payroll_review'], revokedAt: null });
    capture.approvalPath[0] = next; capture.sourceHash = 'c'.repeat(64);
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    expect(await service.list(subject, reviewer)).toEqual([]);
    await expect(service.detail(b.id, reviewer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.detail(b.id, { id: next })).rejects.toBeInstanceOf(ForbiddenException);
    await service.submit(b.id, { expectedVersion: b.version }, editor);
    const assigned = await service.detail(b.id, { id: next }); expect(assigned.versions).toHaveLength(1);
    expect(assigned.events.every(e => e.version === assigned.versions[0].version)).toBe(true);
    expect((await service.detail(b.id, editor)).versions).toHaveLength(2);
  });
  it.each(['reviewer', 'exporter'])('keeps an older matching batch visible to its %s behind 100 newer private drafts', async kind => {
    const b = kind === 'reviewer' ? await submitted() : await approved();
    db.state.batches[0].createdAt = new Date('2026-11-01T00:00:00Z');
    db.state.grants.find(g => g.userId === finance.id)!.capabilities = ['payroll_export'];
    for (let i = 0; i < 100; i++) await service.create({ ...createInput(), purpose: 'trial' }, editor);
    clearPrivateReads();
    const rows = await service.list(subject, kind === 'reviewer' ? reviewer : finance);
    expect(rows.map(row => row.id)).toEqual([b.id]);
    const privateReads = db.tx.payrollBatch.findMany.mock.calls.filter(([args]) => args.include?.versions?.include?.lines);
    expect(privateReads).toHaveLength(1); expect(privateReads[0][0].where.id.in).toEqual([b.id]);
  });
  it('returns every authorized match rather than silently dropping the 101st batch', async () => {
    for (let i = 0; i < 101; i++) await service.create({ ...createInput(), purpose: 'trial' }, editor);
    const rows = await service.list(subject, editor);
    expect(rows).toHaveLength(101);
    expect(new Set(rows.map(row => row.id)).size).toBe(101);
  });
  it('filters the optional HTTP month before loading wages and preserves the old subject-only array caller', async () => {
    const october = await service.create({ ...createInput(), month: '2026-10', purpose: 'trial' }, editor);
    const november = await service.create({ ...createInput(), purpose: 'trial' }, editor);
    const controller = new PayrollController(access, {} as any, service, {} as any, {} as any);
    clearPrivateReads();
    const rows = await controller.list({ subjectId: subject, month: '2026-10' } as any, editor as any);
    expect(rows.map(row => row.id)).toEqual([october.id]);
    expect(db.tx.payrollBatch.findMany.mock.calls.every(([args]) => args.where.month === '2026-10')).toBe(true);
    expect((await controller.list({ subjectId: subject }, editor as any)).map(row => row.id).sort()).toEqual([october.id, november.id].sort());
    expect(await controller.list({ subjectId: subject, month: '2026-12' } as any, editor as any)).toEqual([]);
  });
  it.each([{ label: 'review', actor: reviewer }, { label: 'approval', actor: approver }])
    ('keeps unsubmitted wages private from path-configured $label-only actors while retaining submitted history', async ({ actor }) => {
      const b = await calculated(); clearPrivateReads();
      expect(await service.list(subject, actor)).toEqual([]);
      await expect(service.detail(b.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: 'Draft must not be reviewable' }, actor))
        .rejects.toBeInstanceOf(ForbiddenException);
      expectNoPrivateReads();
      await service.submit(b.id, { expectedVersion: b.version }, editor);
      await service.withdraw(b.id, { expectedVersion: b.version, note: 'New draft needed' }, editor);
      expect((await service.detail(b.id, actor)).versions[0].status).toBe('withdrawn');
      await service.calculate(b.id, { expectedVersion: b.version }, editor); clearPrivateReads();
      expect(await service.list(subject, actor)).toEqual([]);
      await expect(service.detail(b.id, actor)).rejects.toBeInstanceOf(ForbiddenException); expectNoPrivateReads();
      await service.submit(b.id, { expectedVersion: b.version }, editor);
      const history = (await service.detail(b.id, actor)).versions;
      expect(history.map(v => [v.version, v.status])).toEqual([[2, 'pending'], [1, 'withdrawn']]);
      expect(history.every(v => v.submittedById === editor.id)).toBe(true);
    });
  it.each(['detail', 'calculate', 'decide'])('never fetches private versions before denying an ungranted %s actor', async operation => {
    const b = await submitted(); clearPrivateReads();
    const run = operation === 'detail' ? service.detail(b.id, outsider) : operation === 'calculate'
      ? service.calculate(b.id, { expectedVersion: b.version }, outsider)
      : service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, outsider);
    await expect(run).rejects.toBeInstanceOf(ForbiddenException); expectNoPrivateReads();
    expect(db.tx.payrollBatch.findUnique.mock.calls[0][0].select).toEqual({ id: true, subjectId: true, purpose: true });
  });
  it('rejects a wrong-stage or unassigned reviewer before fetching private sources', async () => {
    const b = await submitted(); clearPrivateReads();
    await expect(service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoPrivateReads();
    db.state.grants.push({ userId: outsider.id, subjectId: subject, capabilities: ['payroll_review'], revokedAt: null });
    clearPrivateReads();
    await expect(service.detail(b.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    expectNoPrivateReads(); expect(await service.list(subject, outsider)).toEqual([]); expectNoPrivateReads();
  });
  it('checks effective approval before a finance-only mutation can load private versions', async () => {
    const b = await submitted(), request = payment(b); clearPrivateReads();
    await expect(service.settle(b.id, request, finance)).rejects.toBeInstanceOf(ConflictException);
    expectNoPrivateReads();
  });
  it.each(['payroll_export', 'payroll_settle'])('allows %s-only readers only the current effective approved version and its events', async capability => {
    db.state.grants.find(g => g.userId === finance.id)!.capabilities = [capability];
    const b = await submitted(); await service.withdraw(b.id, { expectedVersion: b.version, note: 'New calculation' }, editor);
    await service.calculate(b.id, { expectedVersion: b.version }, editor); await service.submit(b.id, { expectedVersion: b.version }, editor);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver);
    const rows = await service.list(subject, finance); expect(rows.map(row => row.id)).toEqual([b.id]);
    const detail = await service.detail(b.id, finance); expect(detail.versions.map(v => v.version)).toEqual([2]);
    expect(detail.events.every(e => e.version === 2)).toBe(true);
    const fullReads = db.tx.payrollBatch.findUnique.mock.calls.filter(([args]) => args.include?.versions?.include?.lines);
    expect(fullReads.at(-1)?.[0].include.versions.where.id.in).toEqual([db.state.versions[1].id]);
    expect(db.tx.payrollEvent.findMany.mock.calls.at(-1)?.[0].where.version?.in).toEqual([2]);
    await expect(service.list(otherSubject, finance)).rejects.toBeInstanceOf(ForbiddenException);
    db.state.grants.find(g => g.userId === finance.id)!.revokedAt = new Date(); clearPrivateReads();
    await expect(service.detail(b.id, finance)).rejects.toBeInstanceOf(ForbiddenException); expectNoPrivateReads();
  });
  it.each(['draft', 'calculated', 'pending', 'returned', 'withdrawn', 'voided', 'trial', 'incomplete approvals'])
    ('hides %s wages from final-only readers without any private fetch', async state => {
      const b = await approved(), version = db.state.versions[0];
      if (state === 'trial') db.state.batches[0].purpose = 'trial';
      else if (state === 'incomplete approvals') db.state.decisions.pop();
      else { db.state.batches[0].status = state; version.status = state; }
      clearPrivateReads();
      expect(await service.list(subject, finance)).toEqual([]);
      await expect(service.detail(b.id, finance)).rejects.toBeInstanceOf(ForbiddenException); expectNoPrivateReads();
    });
  it('merges quarter attribution months into one version and hashes each source consistently', async () => {
    const months = ['2026-09', '2026-10', '2026-11'];
    for (const month of months) confirmOpening(employee, month, 'fixed', '2000');
    sources.capture.mockImplementation(async (_tx, _subject, month) => ({ ...clone(capture), sourceHash: month === '2026-09' ? 'b'.repeat(64) : 'a'.repeat(64),
      gross: '400.00', lines: [{ ...clone(capture.lines[0]), attributionMonth: month, entitlement: '2400.00', paidBefore: '2000.00', amount: '400.00' }] }));
    const b = await service.create({ ...createInput(), additionalMonths: ['2026-10', '2026-09'] }, editor);
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    const latest = db.state.batches[0]; await service.submit(b.id, { expectedVersion: latest.version }, editor);
    expect(db.state.versions[0].gross.toString()).toBe('1200'); expect(db.state.lines).toHaveLength(3); expect(db.state.reservations).toHaveLength(3);
    expect(db.state.batches[0].additionalMonths).toEqual(['2026-09', '2026-10']);
    sources.capture.mockImplementation(async (_tx, _subject, month) => ({ ...clone(capture), sourceHash: month === '2026-09' ? 'd'.repeat(64) : 'a'.repeat(64),
      gross: '400.00', lines: [{ ...clone(capture.lines[0]), attributionMonth: month, entitlement: '2400.00', paidBefore: '2000.00', amount: '400.00' }] }));
    await expect(service.decide(b.id, { expectedVersion: latest.version, decision: 'approve', note: '' }, reviewer)).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks multi-month paths that disagree', async () => {
    sources.capture.mockImplementation(async (_tx, _subject, month) => ({ ...clone(capture),
      approvalPath: month === '2026-10' ? [approver.id, reviewer.id] : capture.approvalPath,
      lines: [{ ...clone(capture.lines[0]), attributionMonth: month }] }));
    const b = await service.create({ ...createInput(), additionalMonths: ['2026-10'] }, editor);
    await expect(service.calculate(b.id, { expectedVersion: 0 }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.versions).toHaveLength(0);
  });
  it('settlement is separate from export, signed/bounded, live-authorized and idempotent per actor/payload', async () => {
    const b = await approved(), request = payment(b); expect(db.state.settlements).toHaveLength(0);
    await expect(service.settle(b.id, request, editor)).rejects.toBeInstanceOf(ForbiddenException);
    for (const amount of ['0', '-1', '201', 'NaN', '0.001']) await expect(service.settle(b.id, { ...request, amount }, finance)).rejects.toThrow();
    await service.settle(b.id, request, finance); await service.settle(b.id, request, finance);
    expect(db.state.settlements).toHaveLength(1); expect(db.state.reservations).toHaveLength(1);
    await expect(service.settle(b.id, { ...request, amount: '149.00' }, finance)).rejects.toBeInstanceOf(ConflictException);
    db.state.grants.push({ userId: outsider.id, subjectId: subject, capabilities: ['payroll_settle'], revokedAt: null });
    await expect(service.settle(b.id, request, outsider)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.settle(b.id, { ...payment(b, '51.00') }, finance)).rejects.toBeInstanceOf(ConflictException);
    await service.settle(b.id, payment(b, '50.00'), finance); expect(db.state.settlements).toHaveLength(2); expect(db.state.reservations).toHaveLength(0);
  });
  it('requires exact settlement version, approved effective line and a financial reference', async () => {
    const b = await submitted(), request = payment(b);
    await expect(service.settle(b.id, request, finance)).rejects.toBeInstanceOf(ConflictException);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver);
    await expect(service.settle(b.id, { ...request, reference: ' ' }, finance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.settle(b.id, request, finance)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.settle(b.id, { ...payment(b), lineId: randomUUID() }, finance)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.state.settlements).toHaveLength(0);
  });
  it('cancels only remainder with evidence, preserving wages and enabling the next 50 delta', async () => {
    const b = await approved(); await service.settle(b.id, payment(b), finance); const frozen = clone(db.state.lines[0]);
    await service.cancelRemainder(b.id, { expectedVersion: b.version, lineId: frozen.id, reference: 'FICTIONAL-CANCEL-1' }, finance);
    expect(db.state.lines[0]).toEqual(frozen); expect(db.state.reservations).toHaveLength(0);
    expect(db.state.events.some(e => e.action === 'remainder_cancelled' && e.metadata.reference === 'FICTIONAL-CANCEL-1')).toBe(true);
    await expect(service.settle(b.id, payment(b, '50'), finance)).rejects.toBeInstanceOf(ConflictException);
    capture.sourceHash = 'e'.repeat(64); capture.lines[0].paidBefore = '150.00'; capture.lines[0].amount = capture.gross = '50.00';
    const correction = await service.create({ ...createInput(), correctionOfId: b.id }, editor);
    await service.calculate(correction.id, { expectedVersion: correction.version }, editor);
    await service.submit(correction.id, { expectedVersion: db.state.batches[1].version }, editor);
    expect(db.state.lines[1].amount.toString()).toBe('50'); expect(db.state.reservations).toHaveLength(1);
  });
  it('does not substitute actual past settlement records for a missing opening confirmation', async () => {
    const b = await approved(); await service.settle(b.id, payment(b), finance);
    await service.cancelRemainder(b.id, { expectedVersion: b.version, lineId: db.state.lines[0].id, reference: 'FICTIONAL-CANCEL' }, finance);
    db.state.openings = [];
    capture.sourceHash = 'd'.repeat(64); capture.lines[0].paidBefore = '150.00'; capture.lines[0].amount = capture.gross = '50.00';
    const next = await calculated();
    await expect(service.submit(next.id, { expectedVersion: next.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0);
  });
  it('tracks negative corrections with the original sign and disallows over-confirmation', async () => {
    capture.gross = capture.lines[0].amount = '-20.00'; capture.lines[0].entitlement = '-20.00';
    const b = await approved(); await expect(service.settle(b.id, payment(b, '1.00'), finance)).rejects.toBeInstanceOf(ConflictException);
    await service.settle(b.id, payment(b, '-15.00'), finance); await expect(service.settle(b.id, payment(b, '-6.00'), finance)).rejects.toBeInstanceOf(ConflictException);
    await service.settle(b.id, payment(b, '-5.00'), finance); expect(db.state.reservations).toHaveLength(0);
  });
  it('requires explicit unpaid financial confirmation after export and never voids any payment', async () => {
    const b = await approved(); db.state.exports.push({ versionId: db.state.versions[0].id, checksum: 'x' });
    await expect(service.voidApproved(b.id, { expectedVersion: b.version, note: 'FICTIONAL-UNPAID', confirmedUnpaid: false }, finance)).rejects.toBeInstanceOf(ConflictException);
    await service.voidApproved(b.id, { expectedVersion: b.version, note: 'FICTIONAL-UNPAID', confirmedUnpaid: true }, finance);
    expect(db.state.versions[0].status).toBe('voided'); expect(db.state.reservations).toHaveLength(0);
    const next = await approved(); await service.settle(next.id, payment(next), finance);
    await expect(service.voidApproved(next.id, { expectedVersion: next.version, note: 'FICTIONAL-UNPAID', confirmedUnpaid: true }, finance)).rejects.toBeInstanceOf(ConflictException);
  });
  it('never settles an older approved line after void/recalculation and a newly approved version', async () => {
    const b = await approved(), oldRequest = payment(b);
    await service.voidApproved(b.id, { expectedVersion: b.version, note: 'FICTIONAL-UNPAID', confirmedUnpaid: true }, finance);
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    await service.submit(b.id, { expectedVersion: b.version }, editor);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, reviewer);
    await service.decide(b.id, { expectedVersion: b.version, decision: 'approve', note: '' }, approver);
    await expect(service.settle(b.id, { ...oldRequest, expectedVersion: b.version }, finance)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.state.settlements).toHaveLength(0); expect(db.state.versions[0].status).toBe('voided');
  });

  it('marks approved cross-month conflicts and blocks new payments while preserving exact previous-payment replay', async () => {
    const others: any[] = [];
    (db.tx as any).payrollAttendanceSnapshot = { findMany: jest.fn(async () => others) };
    capture.sources = { attendance: { payload: { days: [{ records: [{ sourceId: 'night' }] }] } } };
    const b = await approved(), paid = payment(b);
    await service.settle(b.id, paid, finance);
    others.push({ month: '2026-12', version: 1, sourceHash: 'moved', payload: { days: [{ records: [{ sourceId: 'night' }] }] } });
    const frozen = clone(db.state.lines);
    expect((await service.detail(b.id, editor)).versions[0].needsUpdate).toBe(true);
    await expect(service.settle(b.id, payment(b, '50.00'), finance)).rejects.toBeInstanceOf(ConflictException);
    await service.settle(b.id, paid, finance);
    expect(db.state.settlements).toHaveLength(1);
    expect(db.state.lines).toEqual(frozen);
  });

  it('uses lock-protected read-committed only for settlement and keeps approval/cancellation serializable', async () => {
    const b = await approved();
    expect(db.prisma.$transaction.mock.calls.every(([, options]) => options.isolationLevel === 'Serializable')).toBe(true);
    await service.settle(b.id, payment(b), finance);
    expect(db.prisma.$transaction.mock.calls.at(-1)![1].isolationLevel).toBe('ReadCommitted');
    await service.cancelRemainder(b.id, { expectedVersion: b.version, lineId: db.state.lines[0].id, reference: 'Cancel remaining fictional balance' }, finance);
    expect(db.prisma.$transaction.mock.calls.at(-1)![1].isolationLevel).toBe('Serializable');
  });
});
