import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollAccessService } from './payroll-access.service';

const adminId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const subjectId = '33333333-3333-4333-8333-333333333333';
const grantId = '44444444-4444-4444-8444-444444444444';
const unknownId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2037-01-01T00:00:00.000Z';
const actor = { id: adminId, sysRole: 'system_admin', isAssessorOnly: false } as any;

function matches(row: any, where: any): boolean {
  return !!row && Object.entries(where).every(([key, value]: [string, any]) => {
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    if (value && typeof value === 'object') return matches(row[key], value);
    return row[key] === value;
  });
}
function project(row: any, select: any): any {
  if (!row) return null;
  if (!select) return structuredClone(row);
  return Object.fromEntries(Object.entries(select).map(([key, value]: [string, any]) => [key, value === true ? row[key] : project(row[key], value.select)]));
}
function fixture(existing?: Record<string, any>) {
  const person = (id: string, role = 'employee') => ({ id, name: 'Fictional person', employeeNo: id === adminId ? 'ADMIN-F' : 'STAFF-F',
    sysRole: role, status: 'active', isAssessorOnly: false, deletedAt: null, archivedAt: null, privateField: 'not-for-grant-metadata' });
  const state = { users: [person(adminId, 'system_admin'), person(userId)], subjects: [{ id: subjectId, name: 'Fictional directory', isActive: true }],
    grant: existing ? { id: grantId, subjectId, userId, capabilities: ['payroll_view'], revokedAt: null, grantedById: adminId,
      createdAt: new Date(timestamp), updatedAt: new Date(timestamp), ...existing } : null as any, events: [] as any[] };
  const hydrated = () => state.grant && { ...state.grant, user: state.users.find(row => row.id === state.grant.userId), subject: state.subjects.find(row => row.id === state.grant.subjectId) };
  const tx = {
    $queryRaw: jest.fn(async (..._args: any[]) => []),
    user: {
      findUnique: jest.fn(async ({ where, select }: any) => project(state.users.find(row => matches(row, where)), select)),
      findMany: jest.fn(async ({ where, select }: any) => state.users.filter(row => matches(row, where)).map(row => project(row, select))),
    },
    contractSubject: {
      findUnique: jest.fn(async ({ where, select }: any) => project(state.subjects.find(row => matches(row, where)), select)),
      findMany: jest.fn(async ({ where, select }: any) => state.subjects.filter(row => matches(row, where)).map(row => project(row, select))),
    },
    payrollGrant: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const key = where.userId_subjectId ?? where;
        return matches(state.grant, key) ? project(hydrated(), select) : null;
      }),
      findMany: jest.fn(async ({ where, select }: any) => matches(hydrated(), where) ? [project(hydrated(), select)] : []),
      create: jest.fn(async ({ data, select }: any) => {
        if (state.grant) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        state.grant = { id: grantId, createdAt: new Date(), revokedAt: null, ...data };
        return project(hydrated(), select);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!matches(state.grant, where)) return { count: 0 };
        Object.assign(state.grant, data); return { count: 1 };
      }),
    },
    payrollEvent: {
      create: jest.fn(async ({ data }: any) => { state.events.push(structuredClone(data)); return data; }),
      findMany: jest.fn(async (_query: any) => [] as any[]),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (work: (client: any) => Promise<any>, _options: any) => {
    const snapshot = structuredClone(state);
    try { return await work(tx); } catch (error) { Object.assign(state, snapshot); throw error; }
  }) };
  const service = () => {
    expect(existsSync(join(__dirname, 'payroll-grants.service.ts'))).toBe(true);
    const { PayrollGrantsService } = require('./payroll-grants.service');
    return new PayrollGrantsService(prisma);
  };
  return { state, tx, prisma, service };
}
const input = (overrides: any = {}) => ({ subjectId, userId, capabilities: ['payroll_view'], expectedUpdatedAt: null, reason: 'Fictional approved access', ...overrides });

describe('payroll grant administration metadata', () => {
  it.each(['list', 'options', 'save', 'revoke', 'events'])('does not trust a claimed admin role for %s', async operation => {
    const f = fixture(); f.state.users[0].sysRole = 'employee';
    const service = f.service();
    const call = () => operation === 'list' ? service.list({}, actor) : operation === 'options' ? service.options(actor)
      : operation === 'save' ? service.save(input(), actor) : operation === 'events' ? service.events(grantId, actor)
      : service.revoke(grantId, { expectedUpdatedAt: timestamp, reason: 'Fictional revoke' }, actor);
    await expect(call()).rejects.toThrow(ForbiddenException);
    expect(f.tx.payrollGrant.findMany).not.toHaveBeenCalled();
    expect(f.tx.payrollGrant.findUnique).not.toHaveBeenCalled();
    expect(f.tx.contractSubject.findMany).not.toHaveBeenCalled();
    expect(f.tx.payrollEvent.findMany).not.toHaveBeenCalled();
    expect(f.state.events).toEqual([]);
  });
  it.each([
    { status: 'probation' }, { status: 'inactive' }, { isAssessorOnly: true }, { deletedAt: new Date() }, { archivedAt: new Date() }, { sysRole: 'hr' },
  ])('requires a current active non-assessor administrator: %p', async changes => {
    const f = fixture(); Object.assign(f.state.users[0], changes);
    await expect(f.service().options(actor)).rejects.toThrow(ForbiddenException);
  });
  it('rejects missing admins and assessor request contexts, not only the database role', async () => {
    const f = fixture();
    await expect(f.service().options({ ...actor, id: unknownId })).rejects.toThrow(ForbiddenException);
    await expect(f.service().options({ ...actor, isAssessorOnly: true })).rejects.toThrow(ForbiddenException);
  });
  it('options work without payroll configuration and return only active directory and eligible minimal people', async () => {
    const f = fixture(); f.state.users[1].status = 'probation';
    f.state.users.push({ ...f.state.users[1], id: unknownId, isAssessorOnly: true });
    f.state.subjects.push({ id: unknownId, name: 'Inactive', isActive: false });
    const result = await f.service().options(actor);
    expect(result.subjects).toEqual([{ id: subjectId, name: 'Fictional directory' }]);
    expect(result.users).toEqual([
      { id: adminId, name: 'Fictional person', employeeNo: 'ADMIN-F' }, { id: userId, name: 'Fictional person', employeeNo: 'STAFF-F' },
    ]);
    expect(result.capabilities).toEqual(['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle']);
    expect(f.tx.payrollGrant.create).not.toHaveBeenCalled(); expect(f.state.events).toEqual([]);
  });
  it('lists explicit minimal metadata, filters subject and revoked status, and never grants admin salary access', async () => {
    const f = fixture({}); const service = f.service();
    const rows = await service.list({}, actor);
    expect(rows).toEqual([{ id: grantId, subjectId, userId, capabilities: ['payroll_view'], revokedAt: null, grantedById: adminId,
      createdAt: timestamp, updatedAt: timestamp, subject: { id: subjectId, name: 'Fictional directory', isActive: true },
      user: { id: userId, name: 'Fictional person', employeeNo: 'STAFF-F' } }]);
    expect(await service.list({ subjectId: unknownId }, actor)).toEqual([]);
    expect(await service.list({ status: 'revoked' }, actor)).toEqual([]);
    f.state.grant.revokedAt = new Date(timestamp);
    expect(await service.list({ status: 'active' }, actor)).toEqual([]);
    expect(await service.list({ status: 'revoked' }, actor)).toHaveLength(1);
    const access = new PayrollAccessService(f.prisma as any, { get: () => 'true' } as any);
    await expect(access.assert(f.tx as any, actor, subjectId, 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(f.tx.payrollGrant.create).not.toHaveBeenCalled();
  });
  it('history is scoped to the exact grant, target and subject, returns readable metadata and minimal actor identity only', async () => {
    const f = fixture({});
    f.tx.payrollEvent.findMany.mockResolvedValueOnce([{ id: 'event', subjectId, actorId: adminId, action: 'grant_saved', createdAt: new Date(timestamp), metadata: {
      grantId, targetUserId: userId, reason: 'Fictional approved access', oldCapabilities: [], newCapabilities: ['payroll_view'], previousUpdatedAt: null,
      updatedAt: timestamp, previousRevokedAt: null, revokedAt: null, privateField: 'must-not-return',
    } }]);
    expect(await f.service().events(grantId, actor)).toEqual([{ id: 'event', action: 'grant_saved', actor: { id: adminId, name: 'Fictional person' },
      createdAt: timestamp, reason: 'Fictional approved access', oldCapabilities: [], newCapabilities: ['payroll_view'], previousUpdatedAt: null,
      updatedAt: timestamp, previousRevokedAt: null, revokedAt: null }]);
    expect(f.tx.payrollEvent.findMany.mock.calls[0][0]).toMatchObject({ where: { subjectId, action: { in: ['grant_saved', 'grant_revoked'] }, AND: [
      { metadata: { path: ['grantId'], equals: grantId } }, { metadata: { path: ['targetUserId'], equals: userId } },
    ] } });
    expect(f.tx.user.findMany.mock.calls[0][0].select).toEqual({ id: true, name: true });
  });
  it('history rejects unknown grants and identifies a missing historical actor without exposing raw metadata', async () => {
    const f = fixture({}); const service = f.service();
    await expect(service.events(unknownId, actor)).rejects.toThrow(NotFoundException);
    f.tx.payrollEvent.findMany.mockResolvedValueOnce([{ id: 'event', actorId: unknownId, action: 'grant_revoked', createdAt: new Date(timestamp), metadata: {
      oldCapabilities: ['payroll_view'], newCapabilities: [], reason: 'Fictional revoked', previousUpdatedAt: timestamp,
      updatedAt: timestamp, previousRevokedAt: null, revokedAt: timestamp,
    } }]);
    expect((await service.events(grantId, actor))[0].actor).toEqual({ id: unknownId, name: '记录不可用' });
  });
});

describe('versioned payroll grant writes', () => {
  it('creates only the requested grant and audits effective before/after capabilities with versions', async () => {
    const f = fixture(); const result = await f.service().save(input({ capabilities: ['payroll_export', 'payroll_view'], reason: '  Fictional approved access  ' }), actor);
    expect(result).toMatchObject({ id: grantId, subjectId, userId, capabilities: ['payroll_view', 'payroll_export'], revokedAt: null });
    expect(f.tx.payrollGrant.create).toHaveBeenCalledTimes(1);
    expect(f.state.events).toEqual([{ subjectId, actorId: adminId, action: 'grant_saved', metadata: {
      grantId, targetUserId: userId, reason: 'Fictional approved access', oldCapabilities: [], newCapabilities: ['payroll_view', 'payroll_export'],
      previousUpdatedAt: null, updatedAt: result.updatedAt, previousRevokedAt: null, revokedAt: null,
    } }]);
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    expect(f.tx.$queryRaw.mock.calls[0][1]).toBe(`payroll:formal:${subjectId}`);
    expect(f.tx.$queryRaw.mock.calls[1][1]).toBe(`payroll:validation:${subjectId}`);
    expect(f.tx.$queryRaw.mock.calls.slice(2).map(call => call[0].join(' ')).join(' ')).toContain('FOR UPDATE');
  });
  it.each([
    { capabilities: [] }, { capabilities: ['payroll_parameter_review'] }, { capabilities: ['PAYROLL_VIEW'] }, { capabilities: ['payroll_view', 'payroll_view'] },
    { reason: '' }, { reason: '  ' }, { reason: 'x'.repeat(501) }, { expectedUpdatedAt: undefined }, { expectedUpdatedAt: 'not-a-date' },
    { subjectId: 'invalid' }, { userId: 'invalid' }, { actorId: userId }, { salary: '10000' }, { revokedAt: timestamp },
  ])('rejects invalid/extra save fields at the service boundary: %p', async changes => {
    const f = fixture();
    await expect(f.service().save(input(changes), actor)).rejects.toThrow(BadRequestException);
    expect(f.tx.payrollGrant.create).not.toHaveBeenCalled(); expect(f.state.events).toEqual([]);
  });
  it.each([{ status: 'inactive' }, { isAssessorOnly: true }, { deletedAt: new Date() }, { archivedAt: new Date() }])('cannot grant to an ineligible target: %p', async changes => {
    const f = fixture(); Object.assign(f.state.users[1], changes);
    await expect(f.service().save(input(), actor)).rejects.toThrow(BadRequestException);
    expect(f.state.events).toEqual([]);
  });
  it('requires a current valid subject and a known target', async () => {
    const f = fixture(); f.state.subjects[0].isActive = false;
    await expect(f.service().save(input(), actor)).rejects.toThrow(BadRequestException);
    f.state.subjects[0].isActive = true;
    await expect(f.service().save(input({ userId: unknownId }), actor)).rejects.toThrow(NotFoundException);
  });
  it.each([null, '2036-01-01T00:00:00.000Z'])('cannot overwrite an existing record with a stale or absent token: %p', async expectedUpdatedAt => {
    const f = fixture({});
    await expect(f.service().save(input({ expectedUpdatedAt }), actor)).rejects.toThrow(ConflictException);
    expect(f.tx.payrollGrant.updateMany).not.toHaveBeenCalled(); expect(f.state.events).toEqual([]);
  });
  it('a token for a disappeared record is a conflict, not permission to create again', async () => {
    const f = fixture();
    await expect(f.service().save(input({ expectedUpdatedAt: timestamp }), actor)).rejects.toThrow(ConflictException);
  });
  it('version timestamps increase even in the same millisecond and stale sequential writes cannot both win', async () => {
    const f = fixture({}); const service = f.service();
    const now = jest.spyOn(Date, 'now').mockReturnValue(new Date(timestamp).getTime());
    try {
      const result = await service.save(input({ expectedUpdatedAt: timestamp, capabilities: ['payroll_edit'] }), actor);
      expect(result.updatedAt).toBe('2037-01-01T00:00:00.001Z');
      await expect(service.save(input({ expectedUpdatedAt: timestamp }), actor)).rejects.toThrow(ConflictException);
      expect(f.state.events).toHaveLength(1);
    } finally { now.mockRestore(); }
  });
  it('a lost compare-and-set never records a successful audit', async () => {
    const f = fixture({}); f.tx.payrollGrant.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service().save(input({ expectedUpdatedAt: timestamp }), actor)).rejects.toThrow(ConflictException);
    expect(f.state.events).toEqual([]);
  });
  it('rechecks administrator state after waiting for write locks', async () => {
    const f = fixture(); f.tx.$queryRaw.mockImplementationOnce(async () => { f.state.users[0].sysRole = 'employee'; return []; });
    await expect(f.service().save(input(), actor)).rejects.toThrow(ForbiddenException);
    expect(f.tx.payrollGrant.create).not.toHaveBeenCalled();
  });
  it('audit failure rolls the grant back in the same transaction', async () => {
    const f = fixture({}); f.tx.payrollEvent.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.service().save(input({ expectedUpdatedAt: timestamp, capabilities: ['payroll_edit'] }), actor)).rejects.toThrow('audit unavailable');
    expect(f.state.grant.capabilities).toEqual(['payroll_view']); expect(f.state.grant.updatedAt.toISOString()).toBe(timestamp);
  });
  it('a conflict from the unique key is sanitized, not exposed as a Prisma error', async () => {
    const f = fixture(); f.tx.payrollGrant.create.mockRejectedValueOnce(Object.assign(new Error('private query'), { code: 'P2002' }));
    await expect(f.service().save(input(), actor)).rejects.toThrow(ConflictException);
  });
});

describe('self-authorization and revocation', () => {
  it.each([undefined, { userId: adminId }, { userId: adminId, revokedAt: new Date(timestamp) }])('cannot self-create, expand or restore grants: %p', async existing => {
    const f = fixture(existing);
    await expect(f.service().save(input({ userId: adminId, capabilities: ['payroll_view', 'payroll_export'], expectedUpdatedAt: existing ? timestamp : null }), actor)).rejects.toThrow(ForbiddenException);
    expect(f.state.events).toEqual([]);
  });
  it('UUID casing cannot bypass self-grant prevention', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const f = fixture(); f.state.users[0].id = id;
    await expect(f.service().save(input({ userId: id.toUpperCase() }), { ...actor, id })).rejects.toThrow(ForbiddenException);
  });
  it('an administrator can reduce existing own capabilities without acquiring new ones', async () => {
    const f = fixture({ userId: adminId, capabilities: ['payroll_view', 'payroll_export'] });
    expect((await f.service().save(input({ userId: adminId, expectedUpdatedAt: timestamp }), actor)).capabilities).toEqual(['payroll_view']);
  });
  it('only a current version can reactivate another eligible person and history records effective old capabilities as empty', async () => {
    const f = fixture({ revokedAt: new Date(timestamp) });
    const row = await f.service().save(input({ expectedUpdatedAt: timestamp }), actor);
    expect(row.revokedAt).toBeNull();
    expect(f.state.events[0].metadata).toMatchObject({ oldCapabilities: [], newCapabilities: ['payroll_view'], previousRevokedAt: timestamp });
  });
  it('revokes an inactive target on an inactive subject, retains capabilities/history and immediately denies access', async () => {
    const f = fixture({}); f.state.users[1].status = 'inactive'; f.state.subjects[0].isActive = false;
    const service = f.service();
    const row = await service.revoke(grantId, { expectedUpdatedAt: timestamp, reason: 'Fictional cleanup' }, actor);
    expect(row.revokedAt).not.toBeNull(); expect(row.capabilities).toEqual(['payroll_view']);
    expect(f.state.events[0]).toMatchObject({ action: 'grant_revoked', metadata: { oldCapabilities: ['payroll_view'], newCapabilities: [], previousUpdatedAt: timestamp, updatedAt: row.updatedAt } });
    const access = new PayrollAccessService(f.prisma as any, { get: () => 'true' } as any);
    await expect(access.assert(f.tx as any, { id: userId }, subjectId, 'payroll_view')).rejects.toThrow(ForbiddenException);
  });
  it('an administrator may revoke their own existing grant', async () => {
    const f = fixture({ userId: adminId });
    expect((await f.service().revoke(grantId, { expectedUpdatedAt: timestamp, reason: 'Fictional self reduction' }, actor)).revokedAt).not.toBeNull();
  });
  it('the next payroll request rejects a revoked grant even when the user is still active and their JWT is unchanged', async () => {
    const f = fixture({});
    const access = new PayrollAccessService(f.prisma as any, { get: () => 'true' } as any);
    const employee = { id: userId, sysRole: 'employee' };
    await expect(access.assert(f.tx as any, employee, subjectId, 'payroll_view')).resolves.toBeUndefined();
    await f.service().revoke(grantId, { expectedUpdatedAt: timestamp, reason: 'Fictional revoke' }, actor);
    await expect(access.assert(f.tx as any, employee, subjectId, 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(f.state.users[1].status).toBe('active');
  });
  it.each([
    { expectedUpdatedAt: null, reason: 'Fictional' }, { expectedUpdatedAt: timestamp, reason: '' },
    { expectedUpdatedAt: timestamp, reason: 'Fictional', userId: unknownId },
  ])('validates revoke fields independently of HTTP: %p', async value => {
    const f = fixture({}); await expect(f.service().revoke(grantId, value, actor)).rejects.toThrow(BadRequestException);
  });
  it('rejects missing, stale and already revoked targets without adding events', async () => {
    const f = fixture({}); const service = f.service();
    await expect(service.revoke(unknownId, { expectedUpdatedAt: timestamp, reason: 'Fictional' }, actor)).rejects.toThrow(NotFoundException);
    await expect(service.revoke(grantId, { expectedUpdatedAt: '2036-01-01T00:00:00.000Z', reason: 'Fictional' }, actor)).rejects.toThrow(ConflictException);
    f.state.grant.revokedAt = new Date(timestamp);
    await expect(service.revoke(grantId, { expectedUpdatedAt: timestamp, reason: 'Fictional' }, actor)).rejects.toThrow(ConflictException);
    expect(f.state.events).toEqual([]);
  });
});
