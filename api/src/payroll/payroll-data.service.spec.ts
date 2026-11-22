import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollDataService } from './payroll-data.service';
import { normalizeAttendance, PayrollAttendanceInput } from './payroll-attendance-normalizer';
import { assertPayrollGrant, payrollAccess } from './payroll-access';

const subject = 'subject', other = 'other-subject', month = '2026-11';
const actor = { id: 'editor' } as AuthUser;
const finance = { id: 'finance' } as AuthUser;
const outsider = { id: 'outsider', sysRole: 'system_admin', canViewAll: true } as AuthUser;
const date = (day: string) => new Date(`${day}T00:00:00.000Z`);
const scope = { employeeIds: ['employee-a'], from: '2026-11-30', to: '2026-11-30' };

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value) as T;
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key.includes('_') && value && typeof value === 'object') return matches(row, value);
    const actual = row[key];
    if (!value || typeof value !== 'object' || value instanceof Date) return actual instanceof Date ? +actual === +value : actual === value;
    if ('in' in value) return value.in.includes(actual);
    if ('lte' in value && !(actual <= value.lte)) return false;
    if ('gte' in value && !(actual >= value.gte)) return false;
    if ('gt' in value && !(actual > value.gt)) return false;
    if ('not' in value) return actual !== value.not;
    return true;
  });
}
function project(row: any, select: any): any {
  if (!row) return null;
  if (!select) return clone(row);
  return Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key, value]: [string, any]) =>
    [key, value === true ? clone(row[key]) : project(row[key], value.select)]));
}
function employment(employeeId: string, patch: any = {}) {
  return { id: `employment:${employeeId}`, userId: employeeId, contractSubjectId: subject,
    effectiveFrom: date('2026-11-29'), effectiveTo: null, entryDate: date('2026-11-29'), leaveDate: null,
    employeeStatus: 'active', createdAt: date('2026-11-01'), employeeNo: employeeId, sourceRequestId: null,
    user: { id: employeeId, name: employeeId, employeeNo: employeeId, privateWage: 'never expose' }, ...patch };
}
function attendance(employeeIds = ['employee-a', 'employee-b'], days = ['2026-11-29', '2026-11-30']): PayrollAttendanceInput {
  const expected = employeeIds.flatMap(employeeId => days.map(workDate => ({ employeeId, workDate, required: true, units: '1' })));
  return { month, expected, records: expected.map(row => ({ employeeId: row.employeeId, workDate: row.workDate,
    sourceId: `${row.employeeId}:${row.workDate}`, sourceVersion: 1, startsAt: `${row.workDate}T09:00:00+08:00`,
    endsAt: `${row.workDate}T17:00:00+08:00`, type: 'normal', state: 'effective', hours: '8', unit: 'hour' })) };
}
const request = (sourceKey = 'full', input = attendance(), patch: any = {}) => ({ subjectId: subject, month, sourceKey, input, complete: true, ...patch });

// Prisma persistence is doubled. Normalization, employment selection, and capability decisions remain real.
function setup() {
  const state = { employments: [employment('employee-a'), employment('employee-b')], snapshots: [] as any[], standards: [] as any[],
    policies: [] as any[], events: [] as any[], locked: [{ id: 'locked', sources: { original: true }, status: 'approved' }],
    grants: [{ userId: actor.id, subjectId: subject, capabilities: ['attendance_edit', 'attendance_seal', 'payroll_edit'], revokedAt: null },
      { userId: finance.id, subjectId: subject, capabilities: ['payroll_settle'], revokedAt: null }] };
  const model = (name: 'snapshots' | 'standards' | 'policies') => ({
    findUnique: jest.fn(async ({ where, select }) => project(state[name].find(row => matches(row, where)), select)),
    findFirst: jest.fn(async ({ where, orderBy }) => project(state[name].filter(row => matches(row, where))
      .sort((a, b) => orderBy?.version === 'desc' ? b.version - a.version : 0)[0], null)),
    findMany: jest.fn(async ({ where, select }) => state[name].filter(row => matches(row, where)).map(row => project(row, select))),
    create: jest.fn(async ({ data }) => { const row = { id: `${name}:${state[name].length + 1}`, status: 'draft', review: [],
      createdAt: date('2026-11-22'), activatedAt: null, ...clone(data) }; state[name].push(row); return clone(row); }),
    update: jest.fn(async ({ where, data }) => { const row = state[name].find(row => matches(row, where)); Object.assign(row, clone(data)); return clone(row); }),
  });
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]), payrollAttendanceSnapshot: model('snapshots'), payrollStandard: model('standards'), payrollPolicy: model('policies'),
    systemConfig: { findUnique: jest.fn(async () => ({ value: { subjectIds: [subject], employeeIds: ['employee-a', 'employee-b'] } })) },
    employmentRecord: { findMany: jest.fn(async ({ where, select }) => state.employments.filter(row => matches(row, where)).map(row => project(row, select))) },
    payrollEvent: { create: jest.fn(async ({ data }) => { state.events.push(clone(data)); return clone(data); }) },
    payrollVersion: { update: jest.fn(() => { throw new Error('Frozen payroll versions must not be rewritten'); }) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async callback => { const before = clone(state);
    try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; } }) };
  const access = { getAccess: jest.fn(async user => payrollAccess(user, state.grants, true)),
    assert: jest.fn(async (_tx, user, subjectId, capability) => assertPayrollGrant(user, state.grants, subjectId, capability, true)),
    assertDomain: jest.fn(async (_tx, domain) => { if (domain !== 'validation') throw new ForbiddenException('Domain denied'); return 'validation'; }) };
  const service = new PayrollDataService(prisma as any, access as any);
  return { state, tx, prisma, access, service };
}

describe('PayrollDataService focused regressions', () => {
  it('quarantines a cross-month source move without rewriting the sealed original month', async () => {
    const { service, state } = setup(), november = attendance();
    const overnight = { sourceId: 'cross-month-night', sourceVersion: 1, employeeId: 'employee-a',
      workDate: '2026-11-30', startsAt: '2026-11-30T23:00:00+08:00', endsAt: '2026-12-01T01:00:00+08:00',
      type: 'overtime' as const, state: 'effective' as const, hours: '2', unit: 'hour' as const, overtimeKind: 'weekday' as const };
    november.records.push(overnight);
    const original = await service.sync(request('november-night', november), actor);
    await service.seal(original.id, original.version, actor);
    const frozen = clone(state.snapshots[0]);
    const dates = Array.from({ length: 31 }, (_, index) => `2026-12-${String(index + 1).padStart(2, '0')}`);
    const december = { ...attendance(['employee-a', 'employee-b'], dates), month: '2026-12' };
    december.records.push({ ...overnight, sourceVersion: 2, workDate: '2026-12-01' });
    const moved = await service.sync({ ...request('december-night', december), month: '2026-12' }, actor);
    expect((moved.payload as any).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CROSS_MONTH_SOURCE_CONFLICT' })]));
    await expect(service.seal(moved.id, moved.version, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(state.snapshots[0]).toEqual(frozen);
    expect(state.locked).toEqual([{ id: 'locked', sources: { original: true }, status: 'approved' }]);
  });

  it('does not seal an older draft after the same source appears in another month', async () => {
    const { service, state } = setup();
    const original = await service.sync(request(), actor);
    state.snapshots.push({ ...clone(original), id: 'december-copy', month: '2026-12',
      payload: { days: [{ records: [{ sourceId: 'employee-a:2026-11-30' }] }] } });
    await expect(service.seal(original.id, original.version, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(state.snapshots[0].status).toBe('draft');
  });

  it('allows an explicitly authorized settlement operator to read only effective subject employee identities', async () => {
    const { service, state } = setup();
    state.employments.push(employment('outside', { contractSubjectId: other }));
    state.employments.push(employment('not-arrived', { entryDate: date('2026-12-01') }));
    const result = await service.employees(subject, month, finance);
    expect(result).toEqual([{ id: 'employee-a', name: 'employee-a', employeeNo: 'employee-a' }, { id: 'employee-b', name: 'employee-b', employeeNo: 'employee-b' }]);
    expect(JSON.stringify(result)).not.toContain('privateWage');
    await expect(service.employees(other, month, finance)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.employees(subject, month, outsider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not attach a review note to an employee outside the current snapshot', async () => {
    const { service, state } = setup();
    const row = await service.sync(request() as any, actor);
    await expect(service.review(row.id, { employeeId: 'foreign', note: 'fictional evidence' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.snapshots[0].review).toEqual([]);
    await service.review(row.id, { employeeId: 'employee-a', workDate: '2026-11-30', note: 'fictional evidence' }, actor);
    expect(state.snapshots[0].review).toEqual([expect.objectContaining({ employeeId: 'employee-a' })]);
  });

  it.each(['review', 'seal'] as const)('%s checks only the attendance header before rejecting unauthorized payload access', async method => {
    const { service, state, tx } = setup();
    state.snapshots.push({ id: 'secret', subjectId: subject, domain: 'validation', payload: { private: true } });
    const call = method === 'review' ? service.review('secret', { note: 'fictional' }, outsider) : service.seal('secret', 1, outsider);
    await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.payrollAttendanceSnapshot.findUnique.mock.calls).toEqual([[{ where: { id: 'secret' }, select: { id: true, subjectId: true, domain: true } }]]);
  });

  it('a complete full-month response can seal and a review note cannot erase unresolved attendance', async () => {
    const { service } = setup();
    const good = await service.sync(request() as any, actor);
    expect((good.payload as any).issues).toEqual([]);
    expect((await service.seal(good.id, good.version, actor)).status).toBe('sealed');
    const missing = attendance(); missing.records.pop();
    const fresh = setup().service;
    const bad = await fresh.sync(request('missing', missing) as any, actor);
    await fresh.review(bad.id, { note: 'Acknowledged, not resolved' }, actor);
    await expect(fresh.seal(bad.id, bad.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('the fictional full-query adapter explicitly declares completeness so its response can seal', async () => {
    const { service } = setup();
    const response: any = await service.fixtureResponse(subject, month, false, actor);
    expect(response.complete).toBe(true);
    expect(response.scope).toBeUndefined();
    const row = await service.sync({ subjectId: subject, month, ...response }, actor);
    expect((row.payload as any).issues).toEqual([]);
    expect((await service.seal(row.id, row.version, actor)).status).toBe('sealed');
  });

  it('accepts a first scoped response but keeps uncovered employees and dates incomplete', async () => {
    const { service } = setup();
    const row = await service.sync(request('partial', attendance(['employee-a'], ['2026-11-30']), { scope }) as any, actor);
    const payload = row.payload as any;
    expect(payload.days).toHaveLength(4);
    expect(payload.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SYNC_INCOMPLETE', employeeId: 'employee-b' })]));
    expect(payload.days.find((day: any) => day.employeeId === 'employee-b' && day.workDate === '2026-11-29')).toMatchObject({ units: null, required: null });
    await expect(service.seal(row.id, row.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('repairs one employee/date without overwriting outside facts or an old sealed snapshot', async () => {
    const { service, state } = setup();
    const original = await service.sync(request() as any, actor);
    await service.seal(original.id, original.version, actor);
    const frozen = clone(state.snapshots[0]);
    const correction = attendance(['employee-a'], ['2026-11-30']);
    correction.records[0] = { ...correction.records[0], sourceVersion: 2, type: 'unpaid_leave' };
    const updated = await service.sync(request('patch', correction, { scope }) as any, actor);
    const rows = (updated.payload as any).days.flatMap((day: any) => day.records);
    expect(rows).toHaveLength(4);
    expect(rows.find((row: any) => row.sourceId === 'employee-a:2026-11-30')).toMatchObject({ sourceVersion: 2, type: 'unpaid_leave' });
    expect(rows.filter((row: any) => row.employeeId === 'employee-b')).toHaveLength(2);
    expect(state.snapshots[0]).toEqual(frozen);
    expect((updated.payload as any).issues).toEqual([]);
  });

  it('preserves newer source facts and deduplicates scoped replay', async () => {
    const { service } = setup();
    const full = attendance(); full.records.forEach(row => row.sourceVersion = 3);
    await service.sync(request('newer', full) as any, actor);
    const stale = attendance(['employee-a'], ['2026-11-30']); stale.records[0].type = 'paid_leave';
    stale.records.push(clone(stale.records[0]));
    const row = await service.sync(request('older', stale, { scope }) as any, actor);
    expect((row.payload as any).days.flatMap((day: any) => day.records)).toHaveLength(4);
    expect((row.payload as any).days.find((day: any) => day.employeeId === 'employee-a' && day.workDate === '2026-11-30').records[0]).toMatchObject({ sourceVersion: 3, type: 'normal' });
  });

  it('uses sourceKey replay identity rather than comparing against a later merged snapshot', async () => {
    const { service, state } = setup();
    await service.sync(request() as any, actor);
    const patch = request('patch', attendance(['employee-a'], ['2026-11-30']), { scope });
    const original = await service.sync(patch as any, actor);
    const newer = attendance(['employee-a'], ['2026-11-30']); newer.records[0].sourceVersion = 2;
    await service.sync(request('later', newer, { scope }) as any, actor);
    expect(await service.sync(patch as any, actor)).toEqual(original);
    expect(state.snapshots).toHaveLength(3);
    await expect(service.sync({ ...patch, complete: false } as any, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an explicit newer revocation, retaining its tombstone against stale resurrection', async () => {
    const { service } = setup(); await service.sync(request() as any, actor);
    const revoked = attendance(['employee-a'], ['2026-11-30']); revoked.records[0] = { ...revoked.records[0], sourceVersion: 2, state: 'revoked' };
    await service.sync(request('revoke', revoked, { scope }) as any, actor);
    const row = await service.sync(request('replay-old', attendance(['employee-a'], ['2026-11-30']), { scope }) as any, actor);
    const records = (row.payload as any).days.find((day: any) => day.employeeId === 'employee-a' && day.workDate === '2026-11-30').records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ sourceVersion: 2, state: 'revoked', effectiveHours: null });
    expect((row.payload as any).issues).toContainEqual(expect.objectContaining({ code: 'REVOKED_RECORD' }));
  });

  it('does not infer deletion from a source omitted by a scoped response', async () => {
    const { service } = setup(); await service.sync(request() as any, actor);
    const empty = attendance(['employee-a'], ['2026-11-30']); empty.records = [];
    const row = await service.sync(request('no-delete', empty, { scope }) as any, actor);
    expect((row.payload as any).days.find((day: any) => day.employeeId === 'employee-a' && day.workDate === '2026-11-30').records).toHaveLength(1);
  });

  it.each([false, undefined])('never seals a response whose pagination complete marker is %j', async complete => {
    const { service } = setup();
    const row = await service.sync(request('incomplete', attendance(), { complete }) as any, actor);
    await service.review(row.id, { note: 'Pagination still incomplete' }, actor);
    await expect(service.seal(row.id, row.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('an explicitly incomplete refresh invalidates only its scope until a complete repair arrives', async () => {
    const { service } = setup(); await service.sync(request() as any, actor);
    const partial = attendance(['employee-a'], ['2026-11-30']);
    const broken = await service.sync(request('page', partial, { scope, complete: false }) as any, actor);
    expect((broken.payload as any).issues.filter((issue: any) => issue.code === 'SYNC_INCOMPLETE')).toHaveLength(1);
    await expect(service.seal(broken.id, broken.version, actor)).rejects.toBeInstanceOf(ConflictException);
    const repaired = await service.sync(request('repair', partial, { scope }) as any, actor);
    expect((repaired.payload as any).issues).toEqual([]);
    expect((await service.seal(repaired.id, repaired.version, actor)).status).toBe('sealed');
  });

  it('an older complete response cannot promote a newer incomplete scope to complete', async () => {
    const { service } = setup(); await service.sync(request() as any, actor);
    const newer = attendance(['employee-a'], ['2026-11-30']); newer.records[0].sourceVersion = 3;
    await service.sync(request('newer-page', newer, { scope, complete: false }) as any, actor);
    const row = await service.sync(request('stale-complete', attendance(['employee-a'], ['2026-11-30']), { scope }) as any, actor);
    expect((row.payload as any).issues).toContainEqual(expect.objectContaining({ code: 'SYNC_INCOMPLETE', employeeId: 'employee-a', workDate: '2026-11-30' }));
    await expect(service.seal(row.id, row.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not let a stale source overwrite newer schedule units', async () => {
    const { service } = setup(); const full = attendance(); full.records.forEach(row => row.sourceVersion = 3);
    await service.sync(request('newer', full) as any, actor);
    const old = attendance(['employee-a'], ['2026-11-30']); old.expected[0].units = '0.5';
    await expect(service.sync(request('stale-schedule', old, { scope }) as any, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('an explicitly incomplete stale query still invalidates its declared coverage', async () => {
    const { service } = setup(); const full = attendance(); full.records.forEach(row => row.sourceVersion = 3);
    await service.sync(request('newer', full) as any, actor);
    const row = await service.sync(request('stale-page', attendance(['employee-a'], ['2026-11-30']), { scope, complete: false }) as any, actor);
    await expect(service.seal(row.id, row.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not accept a complete query with missing expected dates, but can retain an explicitly incomplete page', async () => {
    const { service } = setup(); const page = attendance(['employee-a'], ['2026-11-30']); page.expected = [];
    await expect(service.sync(request('bad-complete', page, { scope }) as any, actor)).rejects.toBeInstanceOf(BadRequestException);
    const row = await service.sync(request('incomplete-page', page, { scope, complete: false }) as any, actor);
    await expect(service.seal(row.id, row.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects source identities or rows that could remove facts outside the declared scope', async () => {
    const { service } = setup(); await service.sync(request() as any, actor);
    await expect(service.sync(request('outside', attendance(), { scope }) as any, actor)).rejects.toBeInstanceOf(BadRequestException);
    const moved = attendance(['employee-a'], ['2026-11-30']); moved.records[0].sourceId = 'employee-b:2026-11-30'; moved.records[0].sourceVersion = 99;
    await expect(service.sync(request('moved', moved, { scope }) as any, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    { ...scope, from: '2026-11-31' }, { ...scope, from: '2026-12-01' }, { ...scope, from: '2026-11-30', to: '2026-11-29' },
    { ...scope, employeeIds: [] }, { ...scope, employeeIds: ['foreign'] },
  ])('rejects malformed scope %j without creating a snapshot', async invalid => {
    const { service, state } = setup();
    await expect(service.sync(request('bad', attendance(['employee-a'], ['2026-11-30']), { scope: invalid }) as any, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.snapshots).toHaveLength(0);
  });

  it('keeps legacy snapshots without proven query completeness unsealable', async () => {
    const { service, state } = setup(); state.snapshots.push({ id: 'legacy', subjectId: subject, domain: 'validation', month,
      version: 1, status: 'draft', payload: normalizeAttendance(attendance()), review: [] });
    await expect(service.seal('legacy', 1, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['standard', 'rule'] as const)('clones a %s into a fresh draft without altering frozen business evidence', async kind => {
    const { service, state } = setup(); const rows = kind === 'standard' ? state.standards : state.policies;
    rows.push({ id: 'original', subjectId: subject, domain: 'validation', employeeId: 'employee-a', version: 4,
      status: 'active', effectiveFrom: date('2026-11-01'), effectiveTo: null, activatedAt: date('2026-11-02'),
      fixedMonthly: new Prisma.Decimal('100'), performanceBase: null, performanceMode: null, evidence: 'fictional', config: { rounding: null } });
    const before = clone(rows[0]), locked = clone(state.locked);
    const copy = await (service as any).clone(kind, 'original', actor);
    expect(copy).toMatchObject({ status: 'draft', version: 5, createdById: actor.id, activatedAt: null });
    expect(copy.id).not.toBe('original'); expect(rows[0]).toEqual(before); expect(state.locked).toEqual(locked);
    if (kind === 'standard') expect(copy.fixedMonthly.toString()).toBe('100');
    else expect(copy.config).toEqual({ rounding: null });
  });

  it.each(['standard', 'rule'] as const)('disables an active %s in place, retaining old locked versions and idempotence', async kind => {
    const { service, state } = setup(); const rows = kind === 'standard' ? state.standards : state.policies;
    rows.push({ id: 'active', subjectId: subject, domain: 'validation', version: 1, status: 'active', config: {},
      effectiveFrom: date('2026-11-01'), effectiveTo: null, activatedAt: date('2026-11-01') });
    const frozen = clone(state.locked), original = clone(rows[0]);
    const disabled = await (service as any).disable(kind, 'active', actor);
    expect(disabled).toEqual({ ...original, status: 'disabled' });
    expect(rows.filter(row => row.status === 'active')).toEqual([]);
    expect(state.locked).toEqual(frozen);
    await (service as any).disable(kind, 'active', actor);
    expect(state.events.filter(row => row.action === `${kind}_disable`)).toHaveLength(1);
  });

  it.each(['activate', 'clone', 'disable'] as const)('%s never fetches private configuration before permission and domain checks', async method => {
    const { service, state, tx } = setup(); state.standards.push({ id: 'secret', subjectId: subject, domain: 'validation', status: 'draft', fixedMonthly: new Prisma.Decimal('100') });
    await expect((service as any)[method]('standard', 'secret', outsider)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.payrollStandard.findUnique.mock.calls).toEqual([[{ where: { id: 'secret' }, select: { id: true, subjectId: true, domain: true } }]]);
    tx.payrollStandard.findUnique.mockClear(); state.standards[0].domain = 'formal';
    await expect((service as any)[method]('standard', 'secret', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.payrollStandard.findUnique.mock.calls).toEqual([[{ where: { id: 'secret' }, select: { id: true, subjectId: true, domain: true } }]]);
  });
});
