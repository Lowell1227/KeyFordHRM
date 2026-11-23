import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollRecoveryService } from './payroll-recovery.service';
import { payrollAttendanceHash } from './payroll-attendance-integrity';
import { PayrollAbsenceService } from './payroll-absence.service';
import { normalizeAttendance } from './payroll-attendance-normalizer';
import { payrollHash } from './payroll-transaction';
import { assertPayrollGrant } from './payroll-access';
import { PayrollCorrectOpeningDto, PayrollRecoverScopeDto } from './dto/payroll-recovery.dto';

const subjectId = randomUUID(), employeeId = randomUUID(), removedId = randomUUID();
const actor = { id: randomUUID() } as AuthUser, month = '2037-01';
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const day = (id: string, workDate: string) => ({ employeeId: id, workDate, required: false, units: '0', records: [], issues: [] });
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'metadata') return row.metadata?.[value.path[0]] === value.equals;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      return true;
    }
    return row[key] === value;
  });
}
function setup() {
  const payload = { month, days: [day(employeeId, '2037-01-30'), day(removedId, '2037-01-30')], issues: [], version: 'old-normalized',
    dingtalk: { sourceRefs: ['fictional-source'], responseHash: 'original-response' },
    sync: { complete: true, queryComplete: true, requestHash: 'original-request', scope: { employeeIds: [employeeId, removedId], from: '2037-01-30', to: '2037-01-30' },
      coverage: [employeeId, removedId].map(id => ({ employeeId: id, workDate: '2037-01-30', complete: true })) } };
  const snapshot = { id: randomUUID(), subjectId, domain: 'validation', month, version: 1, status: 'sealed', payload, sourceHash: payrollAttendanceHash(payload),
    review: [{ note: 'original check' }], sealedHash: 'old-seal', createdById: actor.id };
  const opening = { id: randomUUID(), subjectId, employeeId, domain: 'validation', attributionMonth: month, itemCode: 'base',
    amount: new Prisma.Decimal('123.45'), reference: 'fictional evidence A', confirmedAt: date('2037-02-01'), confirmedById: actor.id };
  const state = { snapshots: [snapshot] as any[], opening, events: [] as any[], blocked: false, reserved: false, settled: false, actorActive: true,
    grants: [{ subjectId, userId: actor.id, revokedAt: null, capabilities: ['attendance_edit', 'attendance_seal', 'payroll_settle'] }] };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    payrollAttendanceSnapshot: {
      findUnique: jest.fn(async ({ where }) => state.snapshots.find(row => row.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }) => state.snapshots.filter(row => matches(row, where)).sort((a, b) => b.version - a.version)[0] ?? null),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), status: 'draft', review: [], sealedAt: null, ...data }; state.snapshots.push(row); return row; }),
    },
    employmentRecord: { findMany: jest.fn(async () => [{ id: 'employment', userId: employeeId, contractSubjectId: subjectId,
      effectiveFrom: date('2037-01-30'), effectiveTo: null, entryDate: date('2037-01-30'), leaveDate: null, employeeStatus: 'active',
      createdAt: date('2037-01-01'), user: { id: employeeId, name: 'Fictional active employee' } }]) },
    user: { findMany: jest.fn(async () => [{ id: employeeId, name: 'Fictional active employee' }, { id: removedId, name: 'Fictional removed employee' }]) },
    payrollBatch: { findFirst: jest.fn(async () => state.blocked ? { id: 'blocked-batch' } : null) },
    payrollReservation: { findFirst: jest.fn(async () => state.reserved ? { lineId: 'reserved' } : null) },
    payrollLine: { findFirst: jest.fn(async () => state.settled ? { id: 'settled-line' } : null) },
    payrollOpeningBalance: {
      findUnique: jest.fn(async ({ where }) => where.id === opening.id ? state.opening : null),
      update: jest.fn(async ({ data }) => { state.opening = { ...state.opening, ...data }; return state.opening; }),
    },
    payrollEvent: {
      findFirst: jest.fn(async ({ where }) => state.events.find(row => matches(row, where)) ?? null),
      findMany: jest.fn(async ({ where }) => state.events.filter(row => matches(row, where))),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), createdAt: new Date(), ...data }; state.events.push(row); return row; }),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
  const access = { maintenancePurpose: () => 'validation',
    assert: jest.fn(async (_tx, user, id, capability) => {
      if (!state.actorActive) throw new ForbiddenException('Inactive actor');
      assertPayrollGrant(user, state.grants, id, capability, true);
    }),
    assertDomain: jest.fn(async (_tx, domain) => { if (domain !== 'validation') throw new ForbiddenException(); return domain; }) };
  return { state, tx, prisma, access, service: new PayrollRecoveryService(prisma as any, access as any) };
}
async function recoveryInput(s: ReturnType<typeof setup>) {
  const diff = await s.service.scopeDiff(s.state.snapshots[0].id, actor);
  return { snapshotVersion: diff.snapshotVersion, snapshotHash: diff.snapshotHash, scopeHash: diff.scopeHash,
    reason: 'Approved fictional scope changed', requestId: randomUUID() };
}

describe('PayrollRecoveryService scope recovery', () => {
  it('keeps legacy attendance readable but refuses recovery until fresh verified synchronization', async () => {
    const s = setup(), row = s.state.snapshots[0]; row.sourceHash = payrollHash(row.payload);
    const original = JSON.stringify(row), diff = await s.service.scopeDiff(row.id, actor);
    expect(diff.blockedReason).toContain('重新同步'); expect(diff.current.length).toBeGreaterThan(0);
    await expect(s.service.recoverScope(row.id, { snapshotVersion: row.version, snapshotHash: row.sourceHash,
      scopeHash: diff.scopeHash, reason: 'Fictional legacy transition', requestId: randomUUID() }, actor)).rejects.toThrow(ConflictException);
    expect(JSON.stringify(row)).toBe(original);
  });
  it('shows minimal named date differences and creates a replacement without clearing retained facts or source evidence', async () => {
    const s = setup(), original = JSON.stringify(s.state.snapshots[0]);
    const diff = await s.service.scopeDiff(s.state.snapshots[0].id, actor);
    expect(diff.added).toEqual([{ employeeId, name: 'Fictional active employee', workDate: '2037-01-31' }]);
    expect(diff.removed).toEqual([{ employeeId: removedId, name: 'Fictional removed employee', workDate: '2037-01-30' }]);
    const input = await recoveryInput(s), result = await s.service.recoverScope(s.state.snapshots[0].id, input, actor);
    expect(result.version).toBe(2); expect(result.status).toBe('draft'); expect(JSON.stringify(s.state.snapshots[0])).toBe(original);
    const payload = result.payload as any;
    expect(payload.days).toHaveLength(2); expect(payload.days[0]).toEqual(s.state.snapshots[0].payload.days[0]);
    expect(payload.sync.coverage).toEqual([{ employeeId, workDate: '2037-01-30', complete: true }, { employeeId, workDate: '2037-01-31', complete: false }]);
    expect(payload.sync.complete).toBe(false); expect(payload.dingtalk).toEqual(s.state.snapshots[0].payload.dingtalk);
    expect(payload.recovery.previousSourceHash).toBe(s.state.snapshots[0].sourceHash);
    expect(payload.issues).toContainEqual(expect.objectContaining({ employeeId, workDate: '2037-01-31', code: 'SYNC_INCOMPLETE' }));
    expect(s.state.events[0]).toMatchObject({ actorId: actor.id, action: 'attendance_scope_recovered' });
    expect(await s.service.recoverScope(s.state.snapshots[0].id, input, actor)).toEqual(result);
    expect(s.state.snapshots).toHaveLength(2);
    await expect(s.service.recoverScope(s.state.snapshots[0].id, { ...input, reason: 'changed request' }, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['snapshotHash', 'scopeHash', 'snapshotVersion'])('rejects stale %s', async field => {
    const s = setup(), input = await recoveryInput(s);
    await expect(s.service.recoverScope(s.state.snapshots[0].id, { ...input, [field]: field === 'snapshotVersion' ? 9 : '0'.repeat(64) }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.payrollAttendanceSnapshot.create).not.toHaveBeenCalled();
  });
  it.each(['blocked', 'reserved', 'settled'])('blocks %s arrangements without deleting history or reservations', async field => {
    const s = setup(), input = await recoveryInput(s); (s.state as any)[field] = true;
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toThrow(/撤回|更正/);
    expect(s.state.snapshots).toHaveLength(1);
  });
  it('rejects old snapshots even if their own hash is valid', async () => {
    const s = setup(), input = await recoveryInput(s);
    s.state.snapshots.push({ ...s.state.snapshots[0], id: randomUUID(), version: 2 });
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('invalidates the reviewed scope fingerprint when underlying employment evidence changes even with identical day coverage', async () => {
    const s = setup(), input = await recoveryInput(s), records = await s.tx.employmentRecord.findMany();
    s.tx.employmentRecord.findMany.mockResolvedValue([{ ...records[0], effectiveFrom: date('2037-01-29') }]);
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.payrollAttendanceSnapshot.create).not.toHaveBeenCalled();
  });
  it('rechecks authorization after waiting for the subject lock', async () => {
    const s = setup(), input = await recoveryInput(s);
    s.tx.$queryRaw.mockImplementation(async () => { s.state.grants[0].capabilities = ['attendance_edit']; return []; });
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.tx.payrollAttendanceSnapshot.create).not.toHaveBeenCalled();
    expect(s.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
  });
  it('rechecks scope and protected arrangements after waiting rather than trusting a pre-lock diff', async () => {
    const s = setup(), input = await recoveryInput(s);
    s.tx.$queryRaw.mockImplementation(async () => { s.state.reserved = true; return []; });
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toThrow(/更正/);
    expect(s.tx.payrollAttendanceSnapshot.create).not.toHaveBeenCalled();
  });
  it('removes out-of-scope confirmed absences and candidates only from the replacement while retaining in-scope proof', async () => {
    const s = setup(), original = s.state.snapshots[0];
    const keep = { employeeId, workDate: '2037-01-30', proofHash: 'retained-proof', hours: '8' };
    const remove = { employeeId: removedId, workDate: '2037-01-30', proofHash: 'removed-proof', hours: '8' };
    const keptReview = { ...keep, kind: 'absence_proposed', id: randomUUID(), actorId: actor.id, at: '2037-02-01T00:00:00Z', reference: 'retained-check' };
    const removedReview = { ...remove, kind: 'absence_proposed', id: randomUUID(), actorId: actor.id, at: '2037-02-01T00:00:00Z', reference: 'old-check' };
    original.review.push(keptReview, removedReview, { ...keptReview, workDate: '2037-01-29' });
    original.payload.confirmedAbsences = [{ ...keep, reference: 'retained-check' }, { ...remove, reference: 'old-check' }];
    original.payload.dingtalk.absenceCandidates = [keep, remove]; original.sourceHash = payrollAttendanceHash(original.payload);
    const before = JSON.stringify(original), request = await recoveryInput(s);
    const result = await s.service.recoverScope(original.id, request, actor), payload = result.payload as any;
    expect(payload.confirmedAbsences).toEqual([{ ...keep, reference: 'retained-check' }]);
    expect(payload.dingtalk.absenceCandidates).toEqual([keep]); expect(JSON.stringify(original)).toBe(before);
    expect(result.review).toEqual([{ note: 'original check' }, keptReview]);
    expect(payload.recovery.previousReview).toEqual(original.review);
  });
  it('keeps an in-scope confirmed fact revocable after scope recovery while preserving the original snapshot and source link', async () => {
    const s = setup(), original = s.state.snapshots[0], workDate = '2037-01-30', proposalId = randomUUID();
    const interval = { startsAt: `${workDate}T09:00:00+08:00`, endsAt: `${workDate}T17:00:00+08:00` };
    const record = { ...interval, employeeId, workDate, sourceId: `hr-absence:${proposalId}:0`, sourceVersion: 1,
      type: 'absence', state: 'effective', unit: 'hour', hours: '8' };
    const fact = { employeeId, workDate, id: proposalId, proofHash: 'a'.repeat(64), hours: '8', intervals: [interval], records: [record],
      reference: 'Fictional retained proof', proposedById: actor.id, proposedAt: '2037-02-01T00:00:00Z', approvedById: actor.id, approvedAt: '2037-02-01T01:00:00Z', note: '' };
    const normalized = normalizeAttendance({ month, expected: [{ employeeId, workDate, required: true, units: '1' },
      { employeeId: removedId, workDate, required: false, units: '0' }], records: [record as any] });
    original.payload = { ...original.payload, ...normalized, confirmedAbsences: [fact] };
    original.review = [{ ...fact, kind: 'absence_proposed', actorId: actor.id, at: fact.proposedAt }];
    original.sourceHash = payrollAttendanceHash(original.payload);
    const before = JSON.stringify(original), request = await recoveryInput(s);
    const recovered = await s.service.recoverScope(original.id, request, actor);
    const absence = new PayrollAbsenceService(s.prisma as any, s.access as any);
    const revoked = await absence.decide(recovered.id, proposalId, { expectedVersion: recovered.version, decision: 'revoke', note: 'Fictional correction' }, actor);
    expect(revoked.payload.confirmedAbsences).toEqual([]);
    expect(revoked.payload.sync?.complete).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
    expect((recovered.payload as any).recovery).toMatchObject({ previousSnapshotId: original.id, previousSourceHash: original.sourceHash });
    expect(s.state.events.at(-1)).toMatchObject({ action: 'absence_revoked', metadata: { fromSnapshotId: recovered.id,
      proofHash: fact.proofHash, sourceIds: [record.sourceId], reference: fact.reference } });
  });
  it('rejects missing or corrupt source evidence rather than clearing the month', async () => {
    const s = setup(), input = await recoveryInput(s); s.state.snapshots[0].sourceHash = '0'.repeat(64);
    await expect(s.service.recoverScope(s.state.snapshots[0].id, input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.payrollAttendanceSnapshot.create).not.toHaveBeenCalled();
  });
});

describe('PayrollRecoveryService opening correction', () => {
  async function input(s: ReturnType<typeof setup>) {
    const history = await s.service.openingHistory(s.state.opening.id, actor);
    return { expectedHash: history.currentHash, amount: '120.00', reference: 'fictional evidence B', reason: 'Fix entry typo', requestId: randomUUID() };
  }
  it('updates only the explicit current opening and appends complete before/after audit, keeping frozen versions intact', async () => {
    const s = setup(), request = await input(s), before = { ...s.state.opening };
    const result = await s.service.correctOpening(before.id, request, actor);
    expect(result.opening.amount?.toString()).toBe('120'); expect(result.currentHash).not.toBe(request.expectedHash);
    const history = await s.service.openingHistory(before.id, actor);
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]).toMatchObject({ actorId: actor.id, reason: request.reason,
      before: { amount: '123.45', reference: 'fictional evidence A', confirmedById: actor.id },
      after: { amount: '120.00', reference: request.reference, confirmedById: actor.id } });
    expect(await s.service.correctOpening(before.id, request, actor)).toEqual(result);
    expect(s.tx.payrollOpeningBalance.update).toHaveBeenCalledTimes(1);
    await expect(s.service.correctOpening(before.id, { ...request, requestId: randomUUID() }, actor)).rejects.toBeInstanceOf(ConflictException);
    await expect(s.service.correctOpening(before.id, { ...request, amount: '1.00' }, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['reserved', 'settled', 'blocked'])('refuses opening corrections with %s arrangements', async field => {
    const s = setup(), request = await input(s); (s.state as any)[field] = true;
    await expect(s.service.correctOpening(s.state.opening.id, request, actor)).rejects.toThrow(/更正/);
    expect(s.tx.payrollOpeningBalance.update).not.toHaveBeenCalled();
  });
  it.each(['amount', 'reference', 'reason'])('does not silently default empty %s', async field => {
    const s = setup(), request = await input(s);
    await expect(s.service.correctOpening(s.state.opening.id, { ...request, [field]: '' }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('denies outsiders and post-lock revocation including history replay', async () => {
    const s = setup(), request = await input(s);
    await expect(s.service.openingHistory(s.state.opening.id, { id: randomUUID() } as AuthUser)).rejects.toBeInstanceOf(ForbiddenException);
    s.tx.$queryRaw.mockImplementation(async () => { s.state.grants[0].capabilities = []; return []; });
    await expect(s.service.correctOpening(s.state.opening.id, request, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.tx.payrollOpeningBalance.update).not.toHaveBeenCalled();
  });
  it('denies replay and history after revocation, and denies post-lock inactive actors', async () => {
    const s = setup(), request = await input(s); await s.service.correctOpening(s.state.opening.id, request, actor);
    s.state.grants[0].capabilities = [];
    await expect(s.service.correctOpening(s.state.opening.id, request, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.service.openingHistory(s.state.opening.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    s.state.grants[0].capabilities = ['payroll_settle'];
    s.tx.$queryRaw.mockImplementation(async () => { s.state.actorActive = false; return []; });
    await expect(s.service.correctOpening(s.state.opening.id, { ...request, requestId: randomUUID() }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.tx.payrollOpeningBalance.update).toHaveBeenCalledTimes(1);
  });
  it('rechecks the opening hash after the lock and never overwrites an unconfirmed opening', async () => {
    const s = setup(), request = await input(s);
    s.tx.$queryRaw.mockImplementation(async () => { s.state.opening.amount = new Prisma.Decimal('124.00'); return []; });
    await expect(s.service.correctOpening(s.state.opening.id, request, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.payrollOpeningBalance.update).not.toHaveBeenCalled();
    const unconfirmed = setup(); (unconfirmed.state.opening as any).confirmedAt = null;
    await expect(unconfirmed.service.correctOpening(unconfirmed.state.opening.id, await input(unconfirmed), actor)).rejects.toThrow(/原期初确认/);
  });
});

describe('Payroll recovery input contracts', () => {
  const validate = (type: any, body: unknown) => new ValidationPipe({ expectedType: type, whitelist: true, forbidNonWhitelisted: true, transform: true })
    .transform(body, { type: 'body' });
  it('trims audit reasons while rejecting missing version and client overrides', async () => {
    const input = { snapshotVersion: 1, snapshotHash: 'a'.repeat(64), scopeHash: 'b'.repeat(64), requestId: randomUUID(), reason: '  fixture repair  ' };
    expect((await validate(PayrollRecoverScopeDto, input)).reason).toBe('fixture repair');
    await expect(validate(PayrollRecoverScopeDto, { ...input, snapshotVersion: undefined })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate(PayrollRecoverScopeDto, { ...input, employeeIds: [employeeId] })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects fabricated opening confirmer, empty money and too many money decimals', async () => {
    const input = { expectedHash: 'a'.repeat(64), requestId: randomUUID(), reason: 'fixture repair', reference: 'fixture evidence', amount: '0.00' };
    expect((await validate(PayrollCorrectOpeningDto, input)).amount).toBe('0.00');
    for (const change of [{ amount: '' }, { amount: '1.001' }, { confirmedById: actor.id }, { expectedHash: 'old' }]) {
      await expect(validate(PayrollCorrectOpeningDto, { ...input, ...change })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
