import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import type { AuthUser } from '@/common/types/auth.types';
import type { RecruitmentDemandSource } from './recruitment-demands.types';
import { RecruitmentDemandOptionsQueryDto, RecruitmentDemandQueryDto } from './recruitment-demands.dto';
import { randomUUID } from 'node:crypto';

const actor = { id: 'editor', name: 'Synthetic editor', sysRole: 'employee', status: 'active', hrCapabilities: ['recruitment_edit'] };
const user = { id: actor.id } as AuthUser;
const sourceFixture = (changes = {}): RecruitmentDemandSource => ({ organizationKey: 'fictional-org', processCode: 'fictional-form', instanceId: 'instance-1',
  status: 'approved', rawDepartment: 'Synthetic department', rawPosition: 'Synthetic position', rawHeadcount: '2 people',
  approvedAt: '2026-11-24T01:00:00.000Z', sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null, ...changes });

function setup() {
  const demands: any[] = [], events: any[] = [], runs: any[] = [], syncItems: any[] = [];
  const department = { id: 'dept', name: 'Synthetic department', fullPath: 'Synthetic / Department', isActive: true };
  const position = { id: 'position', code: 'SYN', name: 'Synthetic position', isActive: true };
  const application = { id: 'application', deptId: department.id, positionName: ` ${position.name} `, stage: 'interviewing', candidate: { deletedAt: null } };
  const currentActor = { ...actor };
  const matches = (row: any, where: any) => !where || Object.entries(where).every(([key, value]: any) => {
    if (key === 'organizationKey_instanceId') return row.organizationKey === value.organizationKey && row.instanceId === value.instanceId;
    if (key === 'NOT') return !matches(row, value);
    if (value && typeof value === 'object' && 'equals' in value) return row[key] === row.sourceFingerprint;
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    if (value && typeof value === 'object' && 'notIn' in value) return !value.notIn.includes(row[key]);
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    if (value && typeof value === 'object' && 'is' in value) return matches(key === 'department' ? department : position, value.is);
    if (value && typeof value === 'object' && 'name' in value) return position.name === value.name && position.isActive;
    return row[key] === value;
  });
  const hydrated = (row: any) => row ? { ...row, department: row.deptId ? { ...department } : null, position: row.positionId ? { ...position } : null } : null;
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn(async () => ({ ...currentActor })), findMany: jest.fn(async () => [currentActor]) },
    department: { findUnique: jest.fn(async () => ({ ...department })), findMany: jest.fn(async () => [department]) },
    position: { findUnique: jest.fn(async () => ({ ...position })), findMany: jest.fn(async () => [position]) },
    talentApplication: { findUnique: jest.fn(async () => application), findMany: jest.fn(async () => []) },
    recruitmentDemand: {
      fields: { sourceFingerprint: { _ref: 'sourceFingerprint' } },
      findUnique: jest.fn(async ({ where }) => hydrated(demands.find(row => matches(row, where)))),
      findFirst: jest.fn(async ({ where }) => hydrated(demands.find(row => matches(row, where)))),
      findMany: jest.fn(async ({ where, skip = 0, take } = {}) => demands.filter(row => matches(row, where)).slice(skip, take === undefined ? undefined : skip + take).map(hydrated)),
      count: jest.fn(async ({ where }) => demands.filter(row => matches(row, where)).length),
      create: jest.fn(async ({ data }) => { const row = { id: `demand-${demands.length + 1}`, revision: 1, deptId: null, positionId: null,
        mappedFingerprint: null, approvedHeadcount: null, supersedesInstanceId: null, supersededByInstanceId: null, syncIssue: null, ...data }; demands.push(row); return hydrated(row); }),
      update: jest.fn(async ({ where, data }) => { const row = demands.find(row => matches(row, where)); Object.assign(row, data); return hydrated(row); }),
    },
    recruitmentDemandEvent: { create: jest.fn(async ({ data }) => { events.push({ id: `event-${events.length + 1}`, createdAt: new Date(), ...data }); return data; }),
      findMany: jest.fn(async ({ where }) => events.filter(row => row.demandId === where.demandId)) },
    recruitmentDemandSyncRun: {
      findUnique: jest.fn(async ({ where }) => runs.find(row => matches(row, where)) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }) => { const row = runs.find(row => matches(row, where)); if (!row) throw new Error('Unknown test run'); return { ...row }; }),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), state: 'listing', listSealedAt: null, ...data }; runs.push(row); return { ...row }; }),
      update: jest.fn(async ({ where, data }) => { const row = runs.find(row => matches(row, where)); Object.assign(row, data); return { ...row }; }),
    },
    recruitmentDemandSyncItem: {
      createMany: jest.fn(async ({ data }) => { for (const item of data) syncItems.push({ id: randomUUID(), state: 'pending', attempts: 0, ...item }); return { count: data.length }; }),
      findFirst: jest.fn(async ({ where }) => syncItems.filter(row => matches(row, where)).sort((a, b) => b.state.localeCompare(a.state) || a.ordinal - b.ordinal)[0] ?? null),
      findMany: jest.fn(async ({ where }) => syncItems.filter(row => matches(row, where))),
      update: jest.fn(async ({ where, data }) => { const row = syncItems.find(row => matches(row, where)); Object.assign(row, data); return { ...row }; }),
      count: jest.fn(async ({ where }) => syncItems.filter(row => matches(row, where)).length),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async fn => fn(tx)) };
  const readInstance = jest.fn(async (_id: string) => sourceFixture());
  const gateway = { status: jest.fn(() => ({ configured: true, missing: [] as string[], readOnly: true as const, scope: { organizationKey: 'fictional-org', processCode: 'fictional-form' } })),
    listIds: jest.fn(async () => ({ instanceIds: ['instance-1', 'instance-1'], complete: true })),
    readInstance, verifyForSubmission: jest.fn(async (id: string) => ({ source: await readInstance(id), relatedSources: [] as RecruitmentDemandSource[],
      replacementCoverage: 'complete' as 'complete' | 'unproven', checkedAt: new Date().toISOString() })) };
  const sut = new RecruitmentDemandsService(prisma as never, gateway);
  const sync = () => sut.sync({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }, user);
  const map = (revision = demands[0].revision) => sut.map(demands[0].id, { expectedRevision: revision, deptId: department.id, positionId: position.id,
    approvedHeadcount: 2, reason: 'Synthetic explicit source verification' }, user);
  const gate = async (revision = demands[0]?.revision) => {
    const proof = await sut.prepareSubmission(demands[0]?.id, revision, user);
    return sut.assertSubmission(tx, application, demands[0]?.id, revision, user, proof);
  };
  return { sut, tx, demands, events, runs, syncItems, department, position, application, currentActor, gateway, sync, map, gate };
}

describe('recruitment demand ledger', () => {
  it('requires fresh one-use proof and rechecks local versions after the remote read', async () => {
    const f = setup(); await f.sync(); await f.map();
    await expect(f.sut.assertSubmission(f.tx, f.application, 'demand-1', 2, user)).rejects.toThrow(ConflictException);
    const proof = await f.sut.prepareSubmission('demand-1', 2, user);
    await expect(f.sut.assertSubmission(f.tx, f.application, 'demand-1', 2, user, { ...proof })).rejects.toThrow(ConflictException);
    await expect(f.sut.assertSubmission(f.tx, f.application, 'demand-1', 2, user, proof)).resolves.toHaveProperty('snapshot.verifiedAt');
    await expect(f.sut.assertSubmission(f.tx, f.application, 'demand-1', 2, user, proof)).rejects.toThrow(ConflictException);
    const next = await f.sut.prepareSubmission('demand-1', 2, user);
    f.demands[0].revision++;
    await expect(f.sut.assertSubmission(f.tx, f.application, 'demand-1', 2, user, next)).rejects.toThrow(ConflictException);
  });

  it('persists upstream invalidation while refusing a submission based on the prior local version', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.readInstance.mockResolvedValue(sourceFixture({ status: 'withdrawn' }));
    await expect(f.gate(2)).rejects.toThrow(ConflictException);
    expect(f.demands[0]).toMatchObject({ sourceState: 'withdrawn', mappedFingerprint: null, revision: 3 });
    expect(f.events.at(-1)).toMatchObject({ action: 'sync', revision: 3 });
  });

  it('blocks unproven replacement coverage and records a verified successor without restoring the predecessor', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.verifyForSubmission.mockResolvedValueOnce({ source: sourceFixture(), relatedSources: [], replacementCoverage: 'unproven', checkedAt: new Date().toISOString() });
    await expect(f.gate(2)).rejects.toThrow(ServiceUnavailableException);
    expect(f.demands[0].syncIssue).toBe('replacement_verification_incomplete');
    await f.sut.refresh('demand-1', user);
    const revision = f.demands[0].revision;
    f.gateway.verifyForSubmission.mockResolvedValueOnce({ source: sourceFixture(),
      relatedSources: [sourceFixture({ instanceId: 'replacement', supersedesInstanceId: 'instance-1' })], replacementCoverage: 'complete', checkedAt: new Date().toISOString() });
    await expect(f.gate(revision)).rejects.toThrow(ConflictException);
    expect(f.demands[0].supersededByInstanceId).toBe('replacement');
  });

  it('fails closed on a stale external verification timestamp', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.verifyForSubmission.mockResolvedValueOnce({ source: sourceFixture(), relatedSources: [], replacementCoverage: 'complete', checkedAt: '2000-01-01T00:00:00Z' });
    await expect(f.gate(2)).rejects.toThrow(ServiceUnavailableException);
  });
  it('projects current seat facts consistently without adding them to immutable source snapshots', async () => {
    const f = setup(); await f.sync();
    const initial = await f.map();
    expect(initial).toMatchObject({ occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2 });
    f.tx.talentApplication.findMany.mockResolvedValue([{ id: 'accepted-application', recruitmentDemandId: initial.id,
      stage: 'accepted', events: [{ action: 'accept_offer', version: 3 }] }]);
    const expected = { occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0 };
    expect((await f.sut.list(new RecruitmentDemandQueryDto(), user)).items[0]).toMatchObject(expected);
    expect((await f.sut.options(Object.assign(new RecruitmentDemandOptionsQueryDto(), { applicationId: f.application.id }), user)).items[0]).toMatchObject(expected);
    expect(await f.sut.detail(initial.id, user)).toMatchObject(expected);
    expect(await f.sut.currentForApplication(f.tx, { recruitmentDemandId: initial.id, stage: 'hiring_review', hiringRequestedById: 'other' }, f.currentActor)).toMatchObject(expected);
    expect(await f.map()).toMatchObject(expected);
    expect(await f.sut.refresh(initial.id, user)).toMatchObject(expected);
    expect(f.events.every(event => event.snapshot.occupiedCount === undefined)).toBe(true);
    f.gateway.readInstance.mockRejectedValue(new Error('Fictional upstream temporarily unavailable'));
    await expect(f.sut.refresh(initial.id, user)).rejects.toThrow(ServiceUnavailableException);
    expect(await f.sut.detail(initial.id, user)).toMatchObject({ occupiedCount: 1, remainingCount: null });
  });

  it('deduplicates IDs and identical fingerprints without extra events, and preserves explicit mapping', async () => {
    const f = setup();
    await f.sync(); await f.map(); await f.sync();
    expect(f.demands).toHaveLength(1); expect(f.events).toHaveLength(2);
    expect(f.demands[0]).toMatchObject({ revision: 2, approvedHeadcount: 2 });
    expect((await f.gate()).snapshot).toEqual({ demandId: 'demand-1', revision: 2, instanceId: 'instance-1', departmentId: 'dept',
      departmentName: f.department.name, positionId: 'position', positionName: f.position.name, approvedHeadcount: 2,
      approvedAt: '2026-11-24T01:00:00.000Z', sourceLink: null, syncedAt: expect.any(String), verifiedAt: expect.any(String) });
  });

  it('changes invalidate mapping even with null or backwards source timestamps; identical retries are idempotent', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.readInstance.mockResolvedValue(sourceFixture({ rawHeadcount: '3', sourceUpdatedAt: '2020-01-01T00:00:00Z' }));
    await f.sync(); await f.sync();
    expect(f.events).toHaveLength(3); expect(f.demands[0].mappedFingerprint).toBeNull();
    await expect(f.gate()).rejects.toThrow(BadRequestException);
    await expect(f.map(2)).rejects.toThrow(ConflictException);
  });

  it.each(['pending', 'rejected', 'withdrawn', 'unknown'])('does not submit a %s source', async status => {
    const f = setup(); f.gateway.readInstance.mockResolvedValue(sourceFixture({ status })); await f.sync();
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it('never restores withdrawn approval from an old response', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.readInstance.mockResolvedValue(sourceFixture({ status: 'withdrawn' })); await f.sync();
    f.gateway.readInstance.mockResolvedValue(sourceFixture()); await f.sut.refresh('demand-1', user);
    expect(f.demands[0].sourceState).toBe('withdrawn');
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it('retains a verified supersession even when the predecessor first arrives later or is refreshed', async () => {
    const f = setup();
    f.gateway.listIds.mockResolvedValue({ instanceIds: ['instance-2'], complete: true });
    f.gateway.readInstance.mockResolvedValue(sourceFixture({ instanceId: 'instance-2', supersedesInstanceId: 'instance-1' }));
    await f.sync();
    f.gateway.listIds.mockResolvedValue({ instanceIds: ['instance-1'], complete: true });
    f.gateway.readInstance.mockImplementation(async id => sourceFixture(id === 'instance-2' ? { instanceId: id, supersedesInstanceId: 'instance-1' } : {})); await f.sync(); await f.sync();
    expect(f.demands.find(row => row.instanceId === 'instance-1').supersededByInstanceId).toBe('instance-2');
    expect((await f.sut.detail('demand-2', user)).usable).toBe(false);
  });

  it('keeps confirmed mapping evidence during a failed refresh and restores the identical source without remapping', async () => {
    const f = setup(); await f.sync(); await f.map();
    const fingerprint = f.demands[0].sourceFingerprint;
    f.gateway.readInstance.mockRejectedValue(new Error('Synthetic unavailable source'));
    await expect(f.sut.refresh('demand-1', user)).rejects.toThrow(ServiceUnavailableException);
    expect(f.demands[0]).toMatchObject({ sourceState: 'approved', sourceFingerprint: fingerprint, mappedFingerprint: fingerprint, syncIssue: 'source_unavailable' });
    await expect(f.gate()).rejects.toThrow(BadRequestException);
    f.gateway.readInstance.mockResolvedValue(sourceFixture());
    expect(await f.sut.refresh('demand-1', user)).toMatchObject({ usable: true });
    expect(f.demands[0]).toMatchObject({ sourceFingerprint: fingerprint, mappedFingerprint: fingerprint, syncIssue: null });
    expect(f.events.filter(event => event.action === 'map')).toHaveLength(1);
    await expect(f.gate()).resolves.toHaveProperty('snapshot');
  });

  it.each([{ rawHeadcount: '3' }, { status: 'withdrawn' }])('invalidates preserved mapping if recovery actually changes the source: %j', async changes => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.readInstance.mockRejectedValueOnce(new Error('Synthetic source outage'));
    await expect(f.sut.refresh('demand-1', user)).rejects.toThrow(ServiceUnavailableException);
    f.gateway.readInstance.mockResolvedValue(sourceFixture(changes));
    expect(await f.sut.refresh('demand-1', user)).toMatchObject({ usable: false });
    expect(f.demands[0].mappedFingerprint).toBeNull();
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it('does not invent an unconfirmed mapping when an identical source recovers', async () => {
    const f = setup(); await f.sync();
    f.gateway.readInstance.mockRejectedValueOnce(new Error('Synthetic source outage'));
    await expect(f.sut.refresh('demand-1', user)).rejects.toThrow(ServiceUnavailableException);
    expect(await f.sut.refresh('demand-1', user)).toMatchObject({ usable: false });
    expect(f.demands[0].mappedFingerprint).toBeNull();
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it.each([{ deptId: 'other' }, { positionName: 'Synthetic position junior' }])('matches the actual application exactly: %j', async changes => {
    const f = setup(); await f.sync(); await f.map(); Object.assign(f.application, changes);
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it('requires active directories, positive integer headcount, explicit reason and current revision', async () => {
    const f = setup(); await f.sync();
    for (const approvedHeadcount of [0, -1, 1.5]) await expect(f.sut.map('demand-1', { expectedRevision: 1, deptId: 'dept', positionId: 'position', approvedHeadcount, reason: 'Synthetic reason' }, user)).rejects.toThrow(BadRequestException);
    await expect(f.sut.map('demand-1', { expectedRevision: 1, deptId: 'dept', positionId: 'position', approvedHeadcount: 2, reason: ' ' }, user)).rejects.toThrow(BadRequestException);
    await f.map(); f.position.isActive = false;
    await expect(f.gate()).rejects.toThrow(BadRequestException);
  });

  it.each(['0', '0人', '0名', '1', '1人', '1名'])('cannot inflate the unambiguous approved headcount %s', async rawHeadcount => {
    const f = setup(); f.gateway.readInstance.mockResolvedValue(sourceFixture({ rawHeadcount })); await f.sync();
    await expect(f.sut.map('demand-1', { expectedRevision: 1, deptId: 'dept', positionId: 'position', approvedHeadcount: 3, reason: 'Synthetic reason' }, user)).rejects.toThrow(BadRequestException);
    expect(f.events).toHaveLength(1);
  });

  it('allows an ambiguous count only with an explicit verified number and reason', async () => {
    const f = setup(); f.gateway.readInstance.mockResolvedValue(sourceFixture({ rawHeadcount: '若干' })); await f.sync();
    await expect(f.sut.map('demand-1', { expectedRevision: 1, deptId: 'dept', positionId: 'position', approvedHeadcount: 2, reason: '' }, user)).rejects.toThrow(BadRequestException);
    await expect(f.map()).resolves.toMatchObject({ approvedHeadcount: 2, usable: true });
  });

  it('uses verified terminal status, not REVOKE wording: approved reissue replaces the original and remains usable', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.listIds.mockResolvedValue({ instanceIds: ['instance-2'], complete: true });
    f.gateway.readInstance.mockImplementation(async id => sourceFixture(id === 'instance-2'
      ? { instanceId: id, status: 'pending', supersedesInstanceId: 'instance-1', bizAction: 'MODIFY' } : {}));
    await f.sync(); expect(f.demands[0].supersededByInstanceId).toBeNull();
    f.gateway.readInstance.mockImplementation(async id => sourceFixture(id === 'instance-2'
      ? { instanceId: id, status: 'approved', supersedesInstanceId: 'instance-1', bizAction: 'REVOKE' } : {}));
    await f.sync(); expect(f.demands[0].supersededByInstanceId).toBe('instance-2');
    await expect(f.gate()).rejects.toThrow(BadRequestException);
    const reissued = f.demands.find(row => row.instanceId === 'instance-2');
    await expect(f.sut.map(reissued.id, { expectedRevision: reissued.revision, deptId: 'dept', positionId: 'position', approvedHeadcount: 2, reason: 'Synthetic verified reissue' }, user)).resolves.toMatchObject({ usable: true, sourceState: 'approved' });
  });

  it('refreshes previously synchronized nonterminal requests even if the new time window lists no IDs', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.listIds.mockResolvedValue({ instanceIds: [], complete: true });
    f.gateway.readInstance.mockResolvedValue(sourceFixture({ status: 'withdrawn' }));
    await f.sync(); expect(f.demands[0].sourceState).toBe('withdrawn');
  });

  it('keeps other source scopes readable but unusable and outside sync or failed-list invalidation', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.demands.push({ ...f.demands[0], id: 'historical-demand', organizationKey: 'other-org', instanceId: 'other-instance' });
    expect((await f.sut.detail('historical-demand', user)).usable).toBe(false);
    await expect(f.sut.map('historical-demand', { expectedRevision: 2, deptId: 'dept', positionId: 'position', approvedHeadcount: 2, reason: 'Synthetic reason' }, user)).rejects.toThrow(BadRequestException);
    await expect(f.sut.assertSubmission(f.tx, f.application, 'historical-demand', 2, user)).rejects.toThrow(BadRequestException);
    await expect(f.sut.refresh('historical-demand', user)).rejects.toThrow(BadRequestException);
    f.gateway.listIds.mockResolvedValue({ instanceIds: [], complete: false });
    await expect(f.sync()).rejects.toThrow(ServiceUnavailableException);
    expect(f.demands[1]).toMatchObject({ revision: 2, syncIssue: null });
    expect(f.gateway.readInstance).not.toHaveBeenCalledWith('other-instance');
  });

  it('does not mutate a historical other-form row even if upstream presents the same organization/instance under the current form', async () => {
    const f = setup(); await f.sync(); await f.map();
    const row = f.demands[0]; row.processCode = 'historical-form';
    const before = { ...row };
    await expect(f.sut.refresh(row.id, user)).rejects.toThrow(BadRequestException);
    expect(await f.sync()).toMatchObject({ complete: false, failed: 1 });
    expect(row).toEqual(before);
  });

  it('caps each run explicitly and makes deferred existing requests unusable rather than reporting full synchronization', async () => {
    const f = setup(); await f.sync(); await f.map();
    for (let i = 2; i <= 11; i++) f.demands.push({ ...f.demands[0], id: `demand-${i}`, instanceId: `instance-${i}` });
    f.gateway.listIds.mockResolvedValue({ instanceIds: [], complete: true });
    f.gateway.readInstance.mockImplementation(async instanceId => sourceFixture({ instanceId }));
    f.gateway.readInstance.mockClear();
    const first = await f.sync();
    expect(first).toMatchObject({ complete: false, remaining: 1, limit: 10, synced: 10, cursor: expect.any(String) });
    expect(f.gateway.readInstance).toHaveBeenCalledTimes(10);
    expect(f.demands[10]).toMatchObject({ syncIssue: 'incomplete_sync', mappedFingerprint: f.demands[0].mappedFingerprint });
    expect(await f.sut.sync({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z', cursor: first.cursor! }, user)).toMatchObject({ complete: true, remaining: 0, synced: 11, cursor: null });
    expect(f.gateway.readInstance).toHaveBeenCalledTimes(11);
  });

  it.each([
    { from: '2025-01-01', to: '2026-11-30' },
    { from: '2026-11-31', to: '2026-12-01' },
    { from: '2026-11-01T08:00:00', to: '2026-11-30T08:00:00' },
    { from: '2026-11-30T01:00:00Z', to: '2026-11-01T01:00:00Z' },
  ])('rejects invalid user ranges without calling upstream or changing the ledger: %j', async input => {
    const f = setup(); await f.sync(); await f.map();
    const before = { ...f.demands[0] }, eventCount = f.events.length;
    f.gateway.listIds.mockClear();
    await expect(f.sut.sync(input, user)).rejects.toThrow(BadRequestException);
    expect(f.gateway.listIds).not.toHaveBeenCalled();
    expect(f.demands[0]).toEqual(before); expect(f.events).toHaveLength(eventCount);
  });

  it('propagates an explicit adapter range error without treating it as an upstream synchronization failure', async () => {
    const f = setup(); await f.sync(); await f.map();
    const before = { ...f.demands[0] }, eventCount = f.events.length;
    f.gateway.listIds.mockRejectedValue(new BadRequestException('RECRUITMENT_RANGE_INVALID'));
    await expect(f.sync()).rejects.toThrow(BadRequestException);
    expect(f.demands[0]).toEqual(before); expect(f.events).toHaveLength(eventCount);
  });

  it('binds continuation and replay to the original actor, source and dates', async () => {
    const f = setup();
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    const done = await f.sut.sync(input, user), cursor = f.runs[0].id;
    expect(done.complete).toBe(true);
    f.currentActor.id = 'other-editor';
    await expect(f.sut.sync({ ...input, cursor }, { id: 'other-editor' } as AuthUser)).rejects.toThrow(ForbiddenException);
    f.currentActor.id = actor.id;
    f.gateway.status.mockReturnValue({ configured: true, missing: [], readOnly: true, scope: { organizationKey: 'other-org', processCode: 'fictional-form' } });
    await expect(f.sut.sync({ ...input, cursor }, user)).rejects.toThrow(ForbiddenException);
    f.gateway.status.mockReturnValue({ configured: true, missing: [], readOnly: true, scope: { organizationKey: 'fictional-org', processCode: 'fictional-form' } });
    await expect(f.sut.sync({ ...input, from: '2026-11-02' }, user)).rejects.toThrow(ConflictException);
    expect(f.gateway.listIds).toHaveBeenCalledTimes(1);
    expect(f.gateway.readInstance).toHaveBeenCalledTimes(1);
  });

  it('records a failed directory attempt before external results, and recovers with the same requestId', async () => {
    const f = setup(), input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    f.gateway.listIds.mockRejectedValueOnce(new Error('Synthetic directory unavailable'));
    await expect(f.sut.sync(input, user)).rejects.toThrow(ServiceUnavailableException);
    expect(f.runs).toHaveLength(1); expect(f.runs[0]).toMatchObject({ requestId: input.requestId, state: 'listing_failed', listSealedAt: null });
    expect(f.syncItems).toHaveLength(0);
    expect(await f.sut.sync(input, user)).toMatchObject({ complete: true, synced: 1, cursor: null });
    expect(await f.sut.sync(input, user)).toMatchObject({ complete: true, synced: 1 });
    expect(f.runs).toHaveLength(1); expect(f.gateway.listIds).toHaveBeenCalledTimes(2);
    expect(f.gateway.readInstance).toHaveBeenCalledTimes(1);
  });

  it('stops initiating item reads after its time budget and resumes the sealed manifest without listing again', async () => {
    const f = setup(), input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    let now = 0;
    f.gateway.listIds.mockImplementation(async () => { now = 10001; return { instanceIds: ['instance-1'], complete: true }; });
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let first: Awaited<ReturnType<RecruitmentDemandsService['sync']>>;
    try { first = await f.sut.sync(input, user); } finally { clock.mockRestore(); }
    expect(first!).toMatchObject({ synced: 0, remaining: 1, complete: false, cursor: expect.any(String) });
    expect(f.gateway.readInstance).not.toHaveBeenCalled();
    expect(await f.sut.sync({ ...input, cursor: first!.cursor! }, user)).toMatchObject({ synced: 1, remaining: 0, complete: true });
    expect(f.gateway.listIds).toHaveBeenCalledTimes(1);
  });

  it('permits narrow confirmers to inspect only their actionable application association, not the ledger', async () => {
    const f = setup(); await f.sync(); await f.map(); f.currentActor.hrCapabilities = ['talent_hiring_confirm'];
    const app = { recruitmentDemandId: 'demand-1', stage: 'hiring_review', hiringRequestedById: 'other' };
    await expect(f.sut.currentForApplication(f.tx, app, f.currentActor)).resolves.toMatchObject({ id: 'demand-1' });
    await expect(f.sut.list(new RecruitmentDemandQueryDto(), user)).rejects.toThrow(ForbiddenException);
    await expect(f.sut.directories(user)).rejects.toThrow(ForbiddenException);
    await expect(f.sut.currentForApplication(f.tx, { ...app, hiringRequestedById: actor.id }, f.currentActor)).rejects.toThrow(ForbiddenException);
    f.currentActor.hrCapabilities = [];
    await expect(f.sut.currentForApplication(f.tx, app, f.currentActor)).rejects.toThrow(ForbiddenException);
  });

  it('fails closed on missing adapter/configuration, and uses current qualification after the lock', async () => {
    const f = setup(); await f.sync(); await f.map();
    f.gateway.status.mockReturnValue({ configured: false, missing: ['processCode'], readOnly: true, scope: { organizationKey: 'fictional-org', processCode: 'fictional-form' } });
    await expect(f.gate()).rejects.toThrow(ServiceUnavailableException);
    f.gateway.status.mockReturnValue({ configured: true, missing: [], readOnly: true, scope: { organizationKey: 'fictional-org', processCode: 'fictional-form' } });
    f.tx.$queryRaw.mockImplementation(async () => { f.currentActor.status = 'resigned'; return []; });
    await expect(f.gate()).rejects.toThrow(ForbiddenException);
    await expect(new RecruitmentDemandsService({} as never).status(user)).rejects.toThrow();
  });

  it('denies viewer writes and all unauthorized reads without fetching external instances', async () => {
    const f = setup(); f.currentActor.hrCapabilities = ['recruitment_view'];
    await expect(f.sync()).rejects.toThrow(ForbiddenException);
    f.currentActor.hrCapabilities = [];
    await expect(f.sut.list(new RecruitmentDemandQueryDto(), user)).rejects.toThrow(ForbiddenException);
    expect(f.gateway.readInstance).not.toHaveBeenCalled();
  });

  it('serves minimal active directories and loads the actual application for paginated usable options', async () => {
    const f = setup(); await f.sync(); await f.map();
    expect(await f.sut.directories(user)).toEqual({ departments: [{ id: 'dept', name: f.department.name, fullPath: f.department.fullPath }],
      positions: [{ id: 'position', code: 'SYN', name: f.position.name }] });
    const query = Object.assign(new RecruitmentDemandOptionsQueryDto(), { applicationId: 'application' });
    expect(await f.sut.options(query, user)).toMatchObject({ total: 1, page: 1, pageSize: 20, items: [{ id: 'demand-1', usable: true }] });
    expect(f.tx.talentApplication.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'application' } }));
    const timeline = await f.sut.detail('demand-1', user);
    expect(timeline.events).toEqual([expect.objectContaining({ action: 'sync', revision: 1, actorName: actor.name, reason: null }),
      expect.objectContaining({ action: 'map', revision: 2, actorName: actor.name, reason: expect.any(String) })]);
  });
});
