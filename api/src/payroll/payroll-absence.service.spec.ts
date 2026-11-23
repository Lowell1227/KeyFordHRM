import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PayrollAbsenceService } from './payroll-absence.service';
import { PayrollDataService } from './payroll-data.service';
import { normalizeAttendance } from './payroll-attendance-normalizer';
import { payrollAttendanceHash } from './payroll-attendance-integrity';

const employeeId = '00000000-0000-4000-8000-000000000011';
const editor = { id: 'editor' } as any, sealer = { id: 'sealer' } as any;
const day = '2026-11-02', month = '2026-11', proofHash = 'a'.repeat(64);
function setup(domain = 'formal') {
  const normalized = normalizeAttendance({ month, expected: [{ employeeId, workDate: day, units: '1', required: true }], records: [] });
  const initial = { id: 'snapshot-1', subjectId: 'subject', domain, month, version: 1, status: 'draft', sourceHash: 'b'.repeat(64), review: [],
    payload: { ...normalized, dingtalk: { schema: 1, provider: 'dingtalk', absenceCandidates: [{ employeeId, workDate: day, proofHash,
      intervals: [{ startsAt: `${day}T09:00:00+08:00`, endsAt: `${day}T17:00:00+08:00` }], hours: '8' }] },
      sync: { requestHash: 'prior', scope: { employeeIds: [employeeId], from: day, to: day }, queryComplete: false, complete: false,
        coverage: [{ employeeId, workDate: day, complete: false }] } } };
  initial.sourceHash = payrollAttendanceHash(initial.payload);
  const state = { rows: [initial] as any[], events: [] as any[], allowEditor: true, allowSealer: true };
  const tx = { $queryRaw: jest.fn(async () => []),
    payrollAttendanceSnapshot: {
      findUnique: jest.fn(async ({ where }) => structuredClone(state.rows.find(row => where.id ? row.id === where.id : row.sourceKey === where.subjectId_domain_month_sourceKey?.sourceKey) ?? null)),
      findFirst: jest.fn(async () => structuredClone(state.rows[state.rows.length - 1])),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ where, data }) => { const row = state.rows.find(value => value.id === where.id); Object.assign(row, structuredClone(data)); return structuredClone(row); }),
      create: jest.fn(async ({ data }) => { const row = { id: `snapshot-${state.rows.length + 1}`, status: 'draft', review: [], ...structuredClone(data) }; state.rows.push(row); return structuredClone(row); }),
    },
    employmentRecord: { findMany: jest.fn(async () => [{ id: 'employment', userId: employeeId, contractSubjectId: 'subject',
      effectiveFrom: new Date(`${day}T00:00:00Z`), effectiveTo: new Date(`${day}T00:00:00Z`),
      entryDate: new Date(`${day}T00:00:00Z`), leaveDate: null, employeeStatus: 'active', createdAt: new Date('2026-01-01'),
      user: { id: employeeId, name: 'Fictional employee' } }]) },
    payrollEvent: { create: jest.fn(async ({ data }) => { state.events.push(structuredClone(data)); return data; }) },
  };
  const access = { maintenancePurpose: () => domain, assertDomain: jest.fn(async () => domain), assert: jest.fn(async (_tx, actor, _subject, capability) => {
    if (capability === 'attendance_edit' && (actor.id !== editor.id || !state.allowEditor)
      || capability === 'attendance_seal' && (actor.id !== sealer.id || !state.allowSealer)) throw new ForbiddenException();
  }) };
  const prisma = { ...tx, $transaction: jest.fn(async work => { const before = structuredClone(state); try { return await work(tx); }
    catch (error) { Object.assign(state, before); throw error; } }) };
  return { state, tx, access, prisma, service: new PayrollAbsenceService(prisma as any, access as any) };
}
const proposal = { expectedVersion: 1, employeeId, workDate: day, reference: 'Fictional verified attendance decision', requestId: '00000000-0000-4000-8000-000000000012' };

describe('confirmed absence lifecycle', () => {
  it('keeps the attendance digest valid after JSONB recursively reorders object keys', async () => {
    const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().reverse().map(key => [key, reorder(value[key])])) : value;
    const s = setup(); s.state.rows[0].payload = reorder(s.state.rows[0].payload);
    await s.service.propose('snapshot-1', proposal, editor);
    const approved = await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer);
    s.state.rows[1].payload = reorder(s.state.rows[1].payload);
    const revoked = await s.service.decide(approved.id, proposal.requestId, { expectedVersion: 2, decision: 'revoke', note: 'Fictional JSONB roundtrip' }, sealer);
    expect(revoked.payload.confirmedAbsences).toEqual([]);
  });
  it('records a proposal without turning a missing punch into effective absence', async () => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor);
    expect(s.state.rows).toHaveLength(1); expect(s.state.rows[0].payload.days[0].records).toEqual([]);
    expect(s.state.rows[0].payload.sync.complete).toBe(false);
    expect(s.state.events[0].action).toBe('absence_proposed');
  });
  it('requires a sealer and creates a new traceable source version after approval', async () => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor); const before = structuredClone(s.state.rows[0]);
    await expect(s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, editor)).rejects.toThrow(ForbiddenException);
    const result = await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: 'Verified fictional evidence' }, sealer);
    expect(result.version).toBe(2); expect(s.state.rows[0]).toEqual(before);
    expect(result.payload.days[0].records[0]).toMatchObject({ type: 'absence', state: 'effective', effectiveHours: '8', resolution: 'usable' });
    expect(result.payload.issues).toEqual([]); expect(result.payload.sync?.complete).toBe(true);
    expect(result.payload.confirmedAbsences?.[0]).toMatchObject({ proofHash, proposedById: editor.id, approvedById: sealer.id });
    expect(result.sourceHash).toBe(payrollAttendanceHash(result.payload));
  });
  it('rejects absent or changed server-verified plan evidence and stale versions', async () => {
    const s = setup(); s.state.rows[0].payload.dingtalk.absenceCandidates = []; s.state.rows[0].sourceHash = payrollAttendanceHash(s.state.rows[0].payload);
    await expect(s.service.propose('snapshot-1', proposal, editor)).rejects.toThrow(ConflictException);
    expect(s.state.events).toEqual([]);
    const next = setup(); await next.service.propose('snapshot-1', proposal, editor);
    next.state.rows.push({ ...structuredClone(next.state.rows[0]), id: 'new', version: 2 });
    await expect(next.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer)).rejects.toThrow(ConflictException);
  });
  it('rejects a payload that no longer matches its stored source hash', async () => {
    const s = setup(); s.state.rows[0].payload.days[0].units = '0';
    await expect(s.service.propose('snapshot-1', proposal, editor)).rejects.toThrow(ConflictException);
    expect(s.state.events).toEqual([]);
  });
  it('rechecks authorization after the shared lock and does not write on revocation', async () => {
    const s = setup(); s.tx.$queryRaw.mockImplementation(async () => { s.state.allowEditor = false; return []; });
    await expect(s.service.propose('snapshot-1', proposal, editor)).rejects.toThrow(ForbiddenException);
    expect(s.state.events).toEqual([]); expect(s.state.rows[0].review).toEqual([]);
  });
  it('keeps overlapping sources and unrelated unresolved days blocked', async () => {
    const s = setup(); const payload = s.state.rows[0].payload;
    const unresolved = { employeeId, workDate: '2026-11-03', units: '1', required: true, records: [], issues: ['MISSING_RECORD'] };
    payload.days.push(unresolved); payload.issues.push({ employeeId, workDate: unresolved.workDate, code: 'MISSING_RECORD', message: 'Missing source' });
    payload.sync.coverage.push({ employeeId, workDate: unresolved.workDate, complete: false });
    s.state.rows[0].sourceHash = payrollAttendanceHash(payload);
    await s.service.propose('snapshot-1', proposal, editor);
    const result = await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer);
    expect(result.payload.sync?.complete).toBe(false);
    expect(result.payload.issues.some(issue => issue.workDate === unresolved.workDate)).toBe(true);
  });
  it('makes duplicate proposal/approval retries idempotent and retains approved facts', async () => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor); await s.service.propose('snapshot-1', proposal, editor);
    expect(s.state.rows[0].review).toHaveLength(1);
    const input = { expectedVersion: 1, decision: 'approve' as const, note: '' };
    const first = await s.service.decide('snapshot-1', proposal.requestId, input, sealer);
    const second = await s.service.decide('snapshot-1', proposal.requestId, input, sealer);
    expect(second.id).toBe(first.id); expect(s.state.rows).toHaveLength(2);
  });
  it('preserves review and allows sealer revocation after real data-service resynchronization without changing old versions', async () => {
    const s = setup('validation'); await s.service.propose('snapshot-1', proposal, editor);
    const approved = await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer);
    const originals = structuredClone(s.state.rows), fact = approved.payload.confirmedAbsences![0];
    const data = new PayrollDataService(s.prisma as any, s.access as any);
    const synced = await data.syncVerified({ subjectId: 'subject', month, sourceKey: 'fictional-resync', complete: true,
      scope: { employeeIds: [employeeId], from: day, to: day },
      input: { month, expected: [{ employeeId, workDate: day, required: true, units: '1' }], records: fact.records } }, editor,
      async () => approved.payload.dingtalk as any);
    expect(synced.review).toEqual(approved.review);
    const result = await s.service.decide(synced.id, fact.id, { expectedVersion: synced.version, decision: 'revoke', note: 'Fictional correction' }, sealer);
    expect(result.payload.confirmedAbsences).toEqual([]); expect(result.payload.sync?.complete).toBe(false);
    expect(result.payload.days[0].records.some(record => fact.records.some(source => source.sourceId === record.sourceId))).toBe(false);
    expect(s.state.rows.slice(0, originals.length)).toEqual(originals);
    expect(s.state.events.at(-1)).toMatchObject({ action: 'absence_revoked', metadata: { fromSnapshotId: synced.id, proposalId: fact.id, reference: fact.reference } });
  });
  it.each(['missing', 'misleading'] as const)('revokes from the current confirmed fact with %s inherited proposal history', async history => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor);
    const approved = await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer);
    const fact = approved.payload.confirmedAbsences![0], originals = structuredClone(s.state.rows);
    const derived = await s.tx.payrollAttendanceSnapshot.create({ data: { ...structuredClone(approved), id: 'derived', version: 3,
      sourceKey: 'fictional-derived', review: history === 'missing' ? [] : [{ ...proposal, id: fact.id, kind: 'absence_proposed',
        actorId: editor.id, at: fact.proposedAt, workDate: '2026-11-03', reference: 'Stale unrelated reference' }] } } as any);
    await expect(s.service.decide(derived.id, fact.id, { expectedVersion: 3, decision: 'revoke', note: 'Fictional correction' }, editor)).rejects.toThrow(ForbiddenException);
    const result = await s.service.decide(derived.id, fact.id, { expectedVersion: 3, decision: 'revoke', note: 'Fictional correction' }, sealer);
    expect(result.payload.confirmedAbsences).toEqual([]);
    expect(result.payload.sync?.coverage.find(row => row.workDate === day)?.complete).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ action: 'absence_revoked', metadata: { reference: fact.reference, proofHash: fact.proofHash,
      sourceIds: fact.records.map(record => record.sourceId), fromSnapshotId: derived.id } });
    expect(s.state.rows.slice(0, originals.length)).toEqual(originals);
  });
  it('does not revoke from a historical proposal when no current confirmed fact exists', async () => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor);
    await expect(s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'revoke', note: 'Fictional correction' }, sealer)).rejects.toThrow(ConflictException);
    expect(s.state.rows).toHaveLength(1);
  });
  it('returns a pending proposal and permits a fresh proposal without making the returned one effective', async () => {
    const s = setup(); await s.service.propose('snapshot-1', proposal, editor);
    await s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'return', note: 'Evidence incomplete' }, sealer);
    await expect(s.service.decide('snapshot-1', proposal.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer)).rejects.toThrow(ConflictException);
    const next = { ...proposal, requestId: '00000000-0000-4000-8000-000000000013' };
    await s.service.propose('snapshot-1', next, editor);
    const approved = await s.service.decide('snapshot-1', next.requestId, { expectedVersion: 1, decision: 'approve', note: '' }, sealer);
    expect(approved.payload.confirmedAbsences?.map(fact => fact.id)).toEqual([next.requestId]);
  });
});
