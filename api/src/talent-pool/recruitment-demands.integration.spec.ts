import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { RecruitmentDemandOptionsQueryDto, RecruitmentDemandQueryDto } from './recruitment-demands.dto';
import type { RecruitmentDemandGateway, RecruitmentDemandSource } from './recruitment-demands.types';

const scope = { organizationKey: 'fictional-recruitment-demands', processCode: 'fictional-recruitment-demand-form' };
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('recruitment demands: disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService;
  let other: PrismaService;
  let editor: AuthUser, confirmer: AuthUser;
  let demands: RecruitmentDemandsService, recruitment: TalentRecruitmentService;
  const sources = new Map<string, RecruitmentDemandSource>();
  const readInstance = jest.fn(async (id: string) => {
    const source = sources.get(id);
    if (!source) throw new Error('Synthetic source unavailable');
    return { ...source };
  });
  const gateway: RecruitmentDemandGateway = { status: () => ({ configured: true, missing: [], readOnly: true, scope }),
    listIds: async () => ({ instanceIds: [...sources.keys()], complete: true }), readInstance,
    verifyForSubmission: async id => ({ source: await readInstance(id),
      relatedSources: [...sources.values()].filter(source => source.supersedesInstanceId === id),
      replacementCoverage: 'complete', checkedAt: new Date().toISOString() }) };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_recruitment_demand_owned_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri(), url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_recruitment_demand_owned_test') throw new Error('Test-owned loopback database required');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Test-owned migration initialization failed'); }
    db = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    other = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await db.$connect(); await other.$connect();
    const accounts = await Promise.all([
      db.user.create({ data: { name: 'Synthetic demand editor', sysRole: 'employee', status: 'active', hrCapabilities: ['recruitment_edit'] } }),
      db.user.create({ data: { name: 'Synthetic narrow confirmer', sysRole: 'employee', status: 'active', hrCapabilities: ['talent_hiring_confirm'] } }),
    ]);
    [editor, confirmer] = accounts.map(row => ({ id: row.id, name: row.name, sysRole: row.sysRole, deptId: null, hrCapabilities: row.hrCapabilities,
      isAssessorOnly: false, canViewAll: false }));
    demands = new RecruitmentDemandsService(db, gateway);
    recruitment = new TalentRecruitmentService(db, demands);
  }, 150000);

  afterAll(async () => {
    try { await other?.$disconnect(); await db?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function fixture() {
    const key = randomUUID();
    const department = await db.department.create({ data: { name: `Synthetic department ${key}`, fullPath: 'Synthetic / Department' } });
    const position = await db.position.create({ data: { code: key, name: `Synthetic position ${key}` } });
    const instanceId = `fictional-${key}`;
    sources.set(instanceId, { ...scope, instanceId, status: 'approved', rawDepartment: department.name, rawPosition: position.name, rawHeadcount: '2',
      approvedAt: '2026-11-24T01:00:00.000Z', sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: 'NONE' });
    await demands.sync({ from: '2026-11-01', to: '2026-11-30' }, editor);
    const row = await db.recruitmentDemand.findUniqueOrThrow({ where: { organizationKey_instanceId: { organizationKey: scope.organizationKey, instanceId } } });
    const demand = await demands.map(row.id, { expectedRevision: row.revision, deptId: department.id, positionId: position.id, approvedHeadcount: 2, reason: 'Synthetic verified source' }, editor);
    const candidate = await db.talentCandidate.create({ data: { name: 'Synthetic demand candidate', phone: `test-${key.slice(0, 12)}`, sourceChannel: 'referral', createdById: editor.id } });
    const application = await recruitment.create(candidate.id, { positionName: ` ${position.name} `, deptId: department.id }, editor);
    const input = { expectedRevision: application.revision, action: 'submit_hiring' as const, note: 'Synthetic hiring reason', recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision };
    return { department, position, instanceId, demand, candidate, application, input };
  }

  async function waitForDatabaseLock(fragment: string) {
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}`;
      if (rows[0].count > 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected a real database lock waiter');
  }

  it('persists one demand/event per source fingerprint and returns real paginated exact-match options', async () => {
    const f = await fixture();
    await Promise.all([demands.refresh(f.demand.id, editor), demands.refresh(f.demand.id, editor)]);
    expect(await db.recruitmentDemand.count({ where: { instanceId: f.instanceId } })).toBe(1);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: f.demand.id } })).toBe(2);
    const options = await demands.options(Object.assign(new RecruitmentDemandOptionsQueryDto(), { applicationId: f.application.id }), editor);
    expect(options).toMatchObject({ total: 1, items: [{ id: f.demand.id, usable: true }] });
    expect((await recruitment.detail(f.application.id, editor)).stage).toBe('screening');
  });

  it('freezes only safe submission evidence, shows current changes to the narrow confirmer, and preserves later flow', async () => {
    const f = await fixture();
    const submitted = await recruitment.act(f.application.id, f.input, editor);
    const frozen = submitted.recruitmentDemandSnapshot;
    expect(frozen).toEqual(expect.objectContaining({ demandId: f.demand.id, revision: f.demand.revision, departmentId: f.department.id, syncedAt: expect.any(String) }));
    expect(frozen).not.toHaveProperty('rawDepartment');
    sources.get(f.instanceId)!.status = 'withdrawn';
    await demands.refresh(f.demand.id, editor);
    const detail = await recruitment.detail(f.application.id, confirmer);
    expect(detail).toMatchObject({ recruitmentDemandSnapshot: frozen, recruitmentDemandCurrent: { sourceState: 'withdrawn', usable: false } });
    await expect(demands.list(new RecruitmentDemandQueryDto(), confirmer)).rejects.toThrow(ForbiddenException);
    await expect(demands.directories(confirmer)).rejects.toThrow(ForbiddenException);
    await expect(demands.detail(f.demand.id, confirmer)).rejects.toThrow(ForbiddenException);
    const approved = await recruitment.act(f.application.id, { expectedRevision: submitted.revision, action: 'approve_hiring' }, confirmer);
    await expect(recruitment.act(f.application.id, { expectedRevision: approved.revision, action: 'accept_offer' }, editor)).resolves.toMatchObject({ stage: 'accepted', recruitmentDemandSnapshot: frozen });
  });

  it('does not add a demand prerequisite to already-submitted historical null-link records', async () => {
    const f = await fixture();
    await db.talentApplication.update({ where: { id: f.application.id }, data: { stage: 'hiring_review', hiringRequestedById: editor.id, reviewReturnStage: 'screening' } });
    const legacy = new TalentRecruitmentService(db);
    await expect(legacy.act(f.application.id, { expectedRevision: 0, action: 'approve_hiring' }, confirmer)).resolves.toMatchObject({ stage: 'offered', recruitmentDemandId: null, recruitmentDemandSnapshot: null });
    await expect(legacy.act(f.application.id, { expectedRevision: 1, action: 'accept_offer' }, editor)).resolves.toMatchObject({ stage: 'accepted' });
  });

  it('rejects missing, changed, mismatched and inactive sources without any stage/event writes', async () => {
    const f = await fixture();
    await expect(recruitment.act(f.application.id, { expectedRevision: 0, action: 'submit_hiring', note: 'Synthetic reason' }, editor)).rejects.toThrow(BadRequestException);
    await db.talentApplication.update({ where: { id: f.application.id }, data: { positionName: 'Other synthetic position' } });
    await expect(recruitment.act(f.application.id, f.input, editor)).rejects.toThrow(BadRequestException);
    await db.talentApplication.update({ where: { id: f.application.id }, data: { positionName: f.position.name } });
    await db.position.update({ where: { id: f.position.id }, data: { isActive: false } });
    await expect(recruitment.act(f.application.id, f.input, editor)).rejects.toThrow(BadRequestException);
    await db.position.update({ where: { id: f.position.id }, data: { isActive: true } });
    sources.get(f.instanceId)!.rawHeadcount = '3';
    await demands.refresh(f.demand.id, editor);
    await expect(recruitment.act(f.application.id, f.input, editor)).rejects.toThrow(ConflictException);
    expect((await db.talentApplication.findUniqueOrThrow({ where: { id: f.application.id } })).stage).toBe('screening');
    expect(await db.talentApplicationEvent.count({ where: { applicationId: f.application.id, action: 'submit_hiring' } })).toBe(0);
  });

  it('does not confuse different applications or implement a headcount occupation rule', async () => {
    const f = await fixture();
    const otherApp = await recruitment.create(f.candidate.id, { deptId: f.department.id, positionName: f.position.name }, editor);
    const thirdApp = await recruitment.create(f.candidate.id, { deptId: f.department.id, positionName: f.position.name }, editor);
    await expect(recruitment.act(f.application.id, f.input, editor)).resolves.toMatchObject({ stage: 'hiring_review' });
    await expect(recruitment.act(otherApp.id, { ...f.input, expectedRevision: 0 }, editor)).resolves.toMatchObject({ stage: 'hiring_review', recruitmentDemandId: f.demand.id });
    await expect(recruitment.act(thirdApp.id, { ...f.input, expectedRevision: 0 }, editor)).resolves.toMatchObject({ stage: 'hiring_review', recruitmentDemandId: f.demand.id });
    expect(await db.talentApplication.count({ where: { candidateId: f.candidate.id, recruitmentDemandId: f.demand.id, stage: 'hiring_review' } })).toBe(3);
  });

  it('serializes source reads with writes so a later stale response cannot restore a revoked source', async () => {
    const f = await fixture(), entered = signal(), release = signal();
    readInstance.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { ...sources.get(f.instanceId)!, status: 'withdrawn' }; });
    const first = demands.refresh(f.demand.id, editor);
    await entered.promise;
    const second = demands.refresh(f.demand.id, editor);
    try { await waitForDatabaseLock('pg_advisory_xact_lock'); }
    finally { release.resolve(); }
    await first; await second;
    expect((await demands.detail(f.demand.id, editor)).sourceState).toBe('withdrawn');
  });

  it('reads the post-lock source revision after an earlier withdrawal commits, not a pre-wait snapshot', async () => {
    const f = await fixture(), entered = signal(), release = signal();
    readInstance.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { ...sources.get(f.instanceId)!, status: 'withdrawn' }; });
    const refresh = demands.refresh(f.demand.id, editor);
    await entered.promise;
    const submission = recruitment.act(f.application.id, f.input, editor).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try { await waitForDatabaseLock('pg_advisory_xact_lock'); }
    finally { release.resolve(); }
    await refresh;
    expect((await submission).error).toBeInstanceOf(ConflictException);
    expect((await db.talentApplication.findUniqueOrThrow({ where: { id: f.application.id } })).stage).toBe('screening');
  });

  it('locks the current actor after the ledger, preventing a queued submission from passing an earlier revocation', async () => {
    const f = await fixture(), changed = signal(), release = signal();
    const revocation = other.$transaction(async tx => {
      await tx.user.update({ where: { id: editor.id }, data: { hrCapabilities: [] } });
      changed.resolve(); await release.promise;
    }, { timeout: 10000 });
    await changed.promise;
    const submission = recruitment.act(f.application.id, f.input, editor).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try { await waitForDatabaseLock('FOR SHARE'); }
    finally { release.resolve(); }
    await revocation;
    expect((await submission).error).toBeInstanceOf(ForbiddenException);
    expect((await db.talentApplication.findUniqueOrThrow({ where: { id: f.application.id } })).stage).toBe('screening');
    await db.user.update({ where: { id: editor.id }, data: { hrCapabilities: ['recruitment_edit'] } });
  });

  it('commits refresh failure evidence separately from rejected submission, retaining previous source fields', async () => {
    const f = await fixture();
    const confirmed = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: f.demand.id } });
    readInstance.mockRejectedValueOnce(new Error('Synthetic unavailable upstream'));
    await expect(demands.refresh(f.demand.id, editor)).rejects.toThrow(ServiceUnavailableException);
    const row = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: f.demand.id } });
    expect(row).toMatchObject({ sourceState: 'approved', rawHeadcount: '2', syncIssue: 'source_unavailable', mappedFingerprint: confirmed.mappedFingerprint });
    await expect(recruitment.act(f.application.id, { ...f.input, expectedDemandRevision: row.revision }, editor)).rejects.toThrow(BadRequestException);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id, action: 'sync_failed' } })).toBe(1);
    const recovered = await demands.refresh(f.demand.id, editor);
    expect(recovered.usable).toBe(true);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id, action: 'map' } })).toBe(1);
    await expect(recruitment.act(f.application.id, { ...f.input, expectedDemandRevision: recovered.revision }, editor)).resolves.toMatchObject({ stage: 'hiring_review' });
    await expect(db.recruitmentDemandEvent.updateMany({ where: { demandId: row.id }, data: { reason: 'Attempted rewrite' } })).rejects.toThrow('append-only');
  });

  it('blocks a deferred confirmed demand, then restores unchanged mapping when its persistent batch resumes', async () => {
    const f = await fixture(), batchScope = { ...scope, processCode: `preserve-${randomUUID()}` };
    const ids = Array.from({ length: 11 }, (_, i) => `preserve-${randomUUID()}-${i}`);
    const read = async (instanceId: string): Promise<RecruitmentDemandSource> => ({ ...batchScope, instanceId, status: 'approved',
      rawDepartment: f.department.name, rawPosition: f.position.name, rawHeadcount: '2', approvedAt: '2026-11-24T01:00:00.000Z',
      sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: 'NONE' });
    const service = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true, scope: batchScope }),
      listIds: async () => ({ instanceIds: ids, complete: true }),
      readInstance: read, verifyForSubmission: async instanceId => ({ source: await read(instanceId), relatedSources: [], replacementCoverage: 'complete', checkedAt: new Date().toISOString() }) });
    const initial = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    const first = await service.sync(initial, editor);
    await service.sync({ ...initial, cursor: first.cursor! }, editor);
    for (const instanceId of ids) {
      const row = await db.recruitmentDemand.findUniqueOrThrow({ where: { organizationKey_instanceId: { organizationKey: scope.organizationKey, instanceId } } });
      await service.map(row.id, { expectedRevision: row.revision, deptId: f.department.id, positionId: f.position.id, approvedHeadcount: 2, reason: 'Synthetic confirmed original mapping' }, editor);
    }
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    const incomplete = await service.sync(input, editor);
    expect(incomplete).toMatchObject({ complete: false, remaining: 1 });
    const item = await db.recruitmentDemandSyncItem.findFirstOrThrow({ where: { run: { requestId: input.requestId }, state: 'pending' } });
    const row = await db.recruitmentDemand.findUniqueOrThrow({ where: { organizationKey_instanceId: { organizationKey: scope.organizationKey, instanceId: item.instanceId } } });
    expect(row).toMatchObject({ syncIssue: 'incomplete_sync', mappedFingerprint: row.sourceFingerprint });
    expect((await service.detail(row.id, editor)).usable).toBe(false);
    const appService = new TalentRecruitmentService(db, service);
    await expect(appService.act(f.application.id, { ...f.input, recruitmentDemandId: row.id, expectedDemandRevision: row.revision }, editor)).rejects.toThrow(BadRequestException);
    expect(await service.sync({ ...input, cursor: incomplete.cursor! }, editor)).toMatchObject({ complete: true, remaining: 0 });
    const restored = await service.detail(row.id, editor);
    expect(restored.usable).toBe(true);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id, action: 'map' } })).toBe(1);
    await expect(appService.act(f.application.id, { ...f.input, recruitmentDemandId: row.id, expectedDemandRevision: restored.revision }, editor)).resolves.toMatchObject({ stage: 'hiring_review' });
  });

  it('completes cap+1 across a persistent cursor and replays a completed requestId without fetching or reordering again', async () => {
    const batchScope = { ...scope, processCode: `batch-${randomUUID()}` };
    const ids = Array.from({ length: 11 }, (_, index) => `batch-instance-${index}`);
    const listIds = jest.fn(async () => ({ instanceIds: ids, complete: true }));
    const read = jest.fn(async (instanceId: string): Promise<RecruitmentDemandSource> => ({ ...batchScope, instanceId, status: 'pending',
      rawDepartment: null, rawPosition: null, rawHeadcount: null, approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null }));
    const service = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true, scope: batchScope }), listIds, readInstance: read });
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    const first: any = await service.sync(input as never, editor);
    expect(first).toMatchObject({ synced: 10, failed: 0, remaining: 1, complete: false, cursor: expect.any(String) });
    const second: any = await service.sync({ ...input, cursor: first.cursor } as never, editor);
    expect(second).toMatchObject({ synced: 11, failed: 0, remaining: 0, complete: true, cursor: null });
    expect(await service.sync(input as never, editor)).toMatchObject({ synced: 11, remaining: 0, complete: true, cursor: null });
    expect(listIds).toHaveBeenCalledTimes(1); expect(read.mock.calls.map(([id]) => id)).toEqual(ids);
  });

  it('keeps failed items for explicit recovery, without repeatedly reading successful items in the same intent', async () => {
    const batchScope = { ...scope, processCode: `retry-${randomUUID()}` };
    let unavailable = true;
    const listIds = jest.fn(async () => ({ instanceIds: ['retry-one', 'retry-two'], complete: true }));
    const read = jest.fn(async (instanceId: string): Promise<RecruitmentDemandSource> => {
      if (instanceId === 'retry-two' && unavailable) throw new Error('Synthetic temporary failure');
      return { ...batchScope, instanceId, status: 'pending', rawDepartment: null, rawPosition: null, rawHeadcount: null,
        approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null };
    });
    const service = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true, scope: batchScope }), listIds, readInstance: read });
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    const first: any = await service.sync(input as never, editor);
    expect(first).toMatchObject({ synced: 1, failed: 1, remaining: 1, complete: false, cursor: expect.any(String) });
    expect(read).toHaveBeenCalledTimes(2);
    unavailable = false;
    expect(await service.sync({ ...input, cursor: first.cursor } as never, editor)).toMatchObject({ synced: 2, failed: 0, remaining: 0, complete: true });
    expect(read.mock.calls.map(([id]) => id)).toEqual(['retry-one', 'retry-two', 'retry-two']);
    expect(listIds).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-user/source/date continuation and protects the sealed manifest in PostgreSQL', async () => {
    const batchScope = { ...scope, processCode: `ownership-${randomUUID()}` };
    let currentScope = batchScope;
    const listIds = jest.fn(async () => ({ instanceIds: ['ownership-instance'], complete: true }));
    const service = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true, scope: currentScope }), listIds,
      readInstance: async instanceId => ({ ...batchScope, instanceId, status: 'pending', rawDepartment: null, rawPosition: null, rawHeadcount: null,
        approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null }) });
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    await service.sync(input, editor);
    const run = await db.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { requestId: input.requestId } });
    const otherEditor = await db.user.create({ data: { name: 'Synthetic other batch editor', sysRole: 'employee', status: 'active', hrCapabilities: ['recruitment_edit'] } });
    await expect(service.sync({ ...input, cursor: run.id }, { ...editor, id: otherEditor.id })).rejects.toThrow(ForbiddenException);
    currentScope = { ...batchScope, organizationKey: 'other-fictional-org' };
    await expect(service.sync({ ...input, cursor: run.id }, editor)).rejects.toThrow(ForbiddenException);
    currentScope = batchScope;
    await expect(service.sync({ ...input, from: '2026-11-02', cursor: run.id }, editor)).rejects.toThrow(ConflictException);
    await expect(db.recruitmentDemandSyncItem.updateMany({ where: { runId: run.id }, data: { instanceId: 'Tampered manifest' } })).rejects.toThrow('immutable');
    await expect(db.recruitmentDemandSyncItem.create({ data: { runId: run.id, instanceId: 'Extra instance', ordinal: 1 } })).rejects.toThrow('sealed');
    await expect(db.recruitmentDemandSyncRun.update({ where: { id: run.id }, data: { actorId: otherEditor.id } })).rejects.toThrow('immutable');
    expect(listIds).toHaveBeenCalledTimes(1);
  });

  it('rolls back ledger and item progress together, and recovers a lost outcome using the already sealed requestId', async () => {
    const batchScope = { ...scope, processCode: `atomic-${randomUUID()}` };
    const instanceId = `atomic-instance-${randomUUID()}`;
    const listIds = jest.fn(async () => ({ instanceIds: [instanceId], complete: true }));
    const service = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true, scope: batchScope }), listIds,
      readInstance: async id => ({ ...batchScope, instanceId: id, status: 'pending', rawDepartment: null, rawPosition: null, rawHeadcount: null,
        approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null }) });
    const input = { from: '2026-11-01', to: '2026-11-30', requestId: randomUUID() };
    await db.$executeRawUnsafe(`CREATE FUNCTION test_demand_sync_progress_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic progress failure'; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_demand_sync_progress_failure BEFORE UPDATE ON recruitment_demand_sync_items FOR EACH ROW EXECUTE FUNCTION test_demand_sync_progress_failure()`);
    try { await expect(service.sync(input, editor)).rejects.toThrow('Synthetic progress failure'); }
    finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_demand_sync_progress_failure ON recruitment_demand_sync_items');
      await db.$executeRawUnsafe('DROP FUNCTION test_demand_sync_progress_failure()');
    }
    expect(await db.recruitmentDemand.count({ where: { instanceId } })).toBe(0);
    const run = await db.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { requestId: input.requestId } });
    expect(run.listSealedAt).not.toBeNull();
    expect(await db.recruitmentDemandSyncItem.findFirst({ where: { runId: run.id } })).toMatchObject({ state: 'pending', attempts: 0 });
    expect(await service.sync(input, editor)).toMatchObject({ complete: true, synced: 1, failed: 0, remaining: 0 });
    expect(await db.recruitmentDemand.count({ where: { instanceId } })).toBe(1);
    expect(listIds).toHaveBeenCalledTimes(1);
  });
});
