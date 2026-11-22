import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollCapture } from './payroll-contracts';
import { PayrollBatchesService } from './payroll-batches.service';

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

// Only the persistence boundary is doubled; the service and live grant checks are real.
function database() {
  const state = { batches: [] as any[], versions: [] as any[], lines: [] as any[], decisions: [] as any[],
    reservations: [] as any[], settlements: [] as any[], openings: [] as any[], events: [] as any[], exports: [] as any[],
    grants: [
      { userId: editor.id, subjectId: subject, capabilities: ['payroll_edit'], revokedAt: null },
      { userId: reviewer.id, subjectId: subject, capabilities: ['payroll_review'], revokedAt: null },
      { userId: approver.id, subjectId: subject, capabilities: ['payroll_approve'], revokedAt: null },
      { userId: finance.id, subjectId: subject, capabilities: ['payroll_settle'], revokedAt: null },
    ] as any[] };
  const version = (v: any) => ({ ...v, lines: state.lines.filter(l => l.versionId === v.id).map(l => ({ ...l,
    settlements: state.settlements.filter(s => s.lineId === l.id), reservation: state.reservations.find(r => r.lineId === l.id) ?? null })),
    decisions: state.decisions.filter(d => d.versionId === v.id).sort((a, b) => a.step - b.step),
    exports: state.exports.filter(e => e.versionId === v.id) });
  const batch = (b: any, args: any = {}) => b && ({ ...b, versions: state.versions.filter(v => v.batchId === b.id)
    .sort((a, b) => b.version - a.version).slice(0, args.include?.versions?.take ?? 50).map(version) });
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payrollGrant: { findMany: jest.fn(async ({ where }) => state.grants.filter(g => g.userId === where.userId &&
      g.subjectId === where.subjectId && g.revokedAt === where.revokedAt)) },
    payrollBatch: {
      findUnique: jest.fn(async (args) => batch(state.batches.find(b => b.id === args.where.id), args)),
      findMany: jest.fn(async (args) => state.batches.filter(b => b.subjectId === args.where.subjectId)
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
    payrollOpeningBalance: { findMany: jest.fn(async ({ where }) => state.openings.filter(o => o.subjectId === where.subjectId && o.domain === where.domain)) },
    payrollSettlement: {
      findUnique: jest.fn(async ({ where }) => state.settlements.find(s => s.requestId === where.requestId) ?? null),
      findMany: jest.fn(async ({ where }) => state.settlements.map(s => ({ ...s, line: state.lines.find(l => l.id === s.lineId) }))
        .filter(s => { const b = state.batches.find(b => b.id === state.versions.find(v => v.id === s.line.versionId)?.batchId);
          const scope = where.line?.version?.batch;
          return !scope || b?.subjectId === scope.subjectId && (typeof scope.purpose === 'string' ? b.purpose === scope.purpose : scope.purpose.in.includes(b.purpose)); })),
      create: jest.fn(async ({ data }) => { const s = { id: randomUUID(), createdAt: new Date(), ...data }; state.settlements.push(s); return s; }),
    },
    payrollEvent: {
      create: jest.fn(async ({ data }) => { const e = { id: randomUUID(), createdAt: new Date(), ...data }; state.events.push(e); return e; }),
      findMany: jest.fn(async ({ where, take }) => state.events.filter(e => e.subjectId === where.subjectId && e.batchId === where.batchId).slice(0, take)),
    },
  };
  const prisma: any = { ...tx, $transaction: jest.fn(async (callback, options) => {
    expect(options.isolationLevel).toBe('Serializable'); const before = clone(state);
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
  });
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
  const payment = (b: any, amount = '150.00', requestId = randomUUID()) => ({ expectedVersion: b.version,
    lineId: db.state.lines.find(l => l.versionId === db.state.versions.filter(v => v.batchId === b.id).at(-1)!.id)!.id,
    amount, reference: 'FICTIONAL-RECEIPT-1', requestId });

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
    const b = await calculated(); db.state.openings.push({ subjectId: subject, employeeId: employee, domain: 'validation',
      attributionMonth: '2026-11', itemCode: 'fixed', amount: new Prisma.Decimal(100), confirmedAt: new Date(), confirmedById: finance.id, reference: 'OPEN-1' });
    await expect(service.submit(b.id, { expectedVersion: b.version }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.state.reservations).toHaveLength(0);
  });
  it('blocks duplicate obligation keys across batches and rolls back every partial reservation', async () => {
    const first = await submitted(); const second = await calculated();
    capture.lines.unshift({ ...clone(capture.lines[0]), employeeId: randomUUID() }); capture.gross = '400.00';
    await service.calculate(second.id, { expectedVersion: second.version }, editor);
    await expect(service.submit(second.id, { expectedVersion: second.version }, editor)).rejects.toMatchObject({
      response: expect.objectContaining({ batchId: first.id }),
    });
    expect(db.state.reservations).toHaveLength(1); expect(db.state.batches.find(b => b.id === second.id)!.status).toBe('calculated');
    expect(first.id).not.toBe(second.id);
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
  it('returns latest-only bounded lists and assignment-filtered histories, never old-assignment access', async () => {
    const b = await submitted(); expect((await service.list(subject, reviewer))[0].versions).toHaveLength(1);
    await service.withdraw(b.id, { expectedVersion: b.version, note: 'Change reviewers' }, editor);
    const next = randomUUID(); db.state.grants.push({ userId: next, subjectId: subject, capabilities: ['payroll_review'], revokedAt: null });
    capture.approvalPath[0] = next; capture.sourceHash = 'c'.repeat(64);
    await service.calculate(b.id, { expectedVersion: b.version }, editor);
    expect(await service.list(subject, reviewer)).toEqual([]);
    await expect(service.detail(b.id, reviewer)).rejects.toBeInstanceOf(ForbiddenException);
    const assigned = await service.detail(b.id, { id: next }); expect(assigned.versions).toHaveLength(1);
    expect(assigned.events.every(e => e.version === assigned.versions[0].version)).toBe(true);
    expect((await service.detail(b.id, editor)).versions).toHaveLength(2);
    expect(db.tx.payrollBatch.findMany.mock.calls.every(([args]) => args.take <= 100)).toBe(true);
  });
  it('merges quarter attribution months into one version and hashes each source consistently', async () => {
    const months = ['2026-09', '2026-10', '2026-11'];
    for (const month of months) db.state.openings.push({ subjectId: subject, employeeId: employee, domain: 'validation', attributionMonth: month,
      itemCode: 'fixed', amount: new Prisma.Decimal(2000), reference: 'OPEN-QUARTER', confirmedAt: new Date(), confirmedById: finance.id });
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
});
