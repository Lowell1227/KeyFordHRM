import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { RecruitmentAnalyticsService } from './recruitment-analytics.service';
import { RecruitmentAnalyticsQueryDto } from './recruitment-lifecycle.dto';
import { RecruitmentLifecycleService } from './recruitment-lifecycle.service';
import { RecruitmentDemandsService } from './recruitment-demands.service';

describe('recruitment channels and lifecycle: owned PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService;
  let reader: AuthUser;
  let editor: AuthUser;
  let service: RecruitmentAnalyticsService;
  let lifecycle: RecruitmentLifecycleService;
  let serial = 0;
  let deptId: string;
  let positionId: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_recruitment_analytics_owned_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri(), url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_recruitment_analytics_owned_test') throw new Error('Owned loopback database required');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Owned recruitment analytics migration failed'); }
    db = new PrismaService({ datasources: { db: { url: databaseUrl } } }); await db.$connect();
    const users = await Promise.all([
      db.user.create({ data: { name: 'Synthetic analytics reader', status: 'active', sysRole: 'employee', hrCapabilities: ['recruitment_view'] } }),
      db.user.create({ data: { name: 'Synthetic lifecycle editor', status: 'active', sysRole: 'employee', hrCapabilities: ['recruitment_edit'] } }),
    ]);
    [reader, editor] = users.map(row => ({ id: row.id, name: row.name, sysRole: row.sysRole, deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: row.hrCapabilities }));
    deptId = (await db.department.create({ data: { name: 'Synthetic analytics department' } })).id;
    positionId = (await db.position.create({ data: { name: 'Synthetic analysis position', code: 'SYN-ANALYTICS' } })).id;
    const demands = new RecruitmentDemandsService(db, { status: () => ({ configured: true, missing: [], readOnly: true,
      scope: { organizationKey: 'synthetic-analytics-org', processCode: 'synthetic-analytics-form' } }) } as never);
    service = new RecruitmentAnalyticsService(db); lifecycle = new RecruitmentLifecycleService(db, demands);
  }, 150000);
  afterAll(async () => { try { await db?.$disconnect(); } finally { await container?.stop(); } }, 30000);
  const query = (changes = {}) => Object.assign(new RecruitmentAnalyticsQueryDto(), changes);
  async function demand() {
    return db.recruitmentDemand.create({ data: { organizationKey: 'synthetic-analytics-org', processCode: 'synthetic-analytics-form', instanceId: randomUUID(),
      sourceState: 'approved', sourceFingerprint: 's'.repeat(64), mappedFingerprint: 's'.repeat(64), approvedHeadcount: 2,
      lastSyncedAt: new Date(), deptId, positionId } });
  }
  async function application(demandId: string | null, options: {
    sourceChannel?: string | null; intentDemandId?: string | null; stage?: string; candidateId?: string; createdAt?: Date;
    events?: Array<{ action: string; version: number }>;
  } = {}) {
    const candidateId = options.candidateId ?? (await db.talentCandidate.create({ data: {
      name: `Synthetic analysis candidate ${++serial}`, phone: `analytics-${serial}`, sourceChannel: 'referral', createdById: editor.id,
    } })).id;
    return db.talentApplication.create({ data: { candidateId, positionName: 'Synthetic analysis position', ownerId: editor.id, createdById: editor.id,
      recruitmentDemandId: demandId, intentDemandId: options.intentDemandId, sourceChannel: options.sourceChannel ?? null, stage: options.stage ?? 'screening',
      ...(options.createdAt ? { createdAt: options.createdAt } : {}), events: { create: (options.events ?? []).map(event => ({ ...event, actorId: editor.id, toStage: options.stage ?? 'screening' })) } } });
  }
  it('counts unique applications rather than people, repeated interviews, messages or old candidate source', async () => {
    const row = await demand();
    const first = await application(null, { intentDemandId: row.id, sourceChannel: 'boss' });
    await application(null, { intentDemandId: row.id, sourceChannel: 'boss', candidateId: first.candidateId });
    await application(null, { intentDemandId: row.id });
    for (const status of ['scheduled', 'completed', 'cancelled']) await db.talentInterview.create({ data: {
      candidateId: first.candidateId, applicationId: first.id, candidateNameSnapshot: 'Synthetic candidate', startsAt: new Date('2037-01-10T01:00:00Z'), endsAt: new Date('2037-01-10T02:00:00Z'),
      invitationText: 'Synthetic interview', status, createdById: editor.id,
    } });
    const summary = await service.channels(query({ demandId: row.id }), reader);
    expect(summary.items).toEqual(expect.arrayContaining([
      { sourceChannel: 'boss', applicationCount: 2, interviewedCount: 1, offeredCount: 0, acceptedCount: 0, hiredCount: 0 },
      { sourceChannel: null, applicationCount: 1, interviewedCount: 0, offeredCount: 0, acceptedCount: 0, hiredCount: 0 },
    ]));
    expect(summary.totals.applicationCount).toBe(3); expect(summary.items.some(item => item.sourceChannel === 'referral')).toBe(false);
    expect((await service.applications(query({ demandId: row.id, metric: 'interviewed' }), reader)).items.map(item => item.id)).toEqual([first.id]);
  });
  it('uses current intention, preserves explicit legacy links, and never restores a link after intention was explicitly cleared', async () => {
    const old = await demand(), current = await demand();
    const moved = await application(old.id, { intentDemandId: current.id });
    const legacy = await application(old.id);
    await application(old.id, { events: [{ action: 'change_intent', version: 1 }] });
    await application(null);
    const occupied = await application(old.id, { intentDemandId: current.id, stage: 'reserve', events: [{ action: 'accept_offer', version: 1 }] });
    const offered = await application(old.id, { intentDemandId: current.id, stage: 'offered' });
    expect((await service.applications(query({ demandId: current.id }), reader)).items.map(item => item.id)).toEqual([moved.id]);
    expect(new Set((await service.applications(query({ demandId: old.id }), reader)).items.map(item => item.id))).toEqual(new Set([legacy.id, occupied.id, offered.id]));
  });
  it('separates hiring approval, active acceptance, explicit termination and actual arrival', async () => {
    const row = await demand(), approved = { action: 'approve_hiring', version: 1 }, accepted = { action: 'accept_offer', version: 2 };
    await application(row.id, { stage: 'offered', events: [approved] });
    await application(row.id, { stage: 'onboarding', events: [approved, accepted] });
    await application(row.id, { stage: 'withdrawn', events: [approved, accepted, { action: 'terminate_offer', version: 3 }] });
    await application(row.id, { stage: 'hired', events: [approved, accepted] });
    const summary = await service.channels(query({ demandId: row.id }), reader);
    expect(summary.totals).toEqual({ applicationCount: 4, interviewedCount: 0, offeredCount: 4, acceptedCount: 2, hiredCount: 1 });
    expect((await service.applications(query({ demandId: row.id, metric: 'accepted' }), reader)).total).toBe(2);
    expect((await service.applications(query({ demandId: row.id, metric: 'hired' }), reader)).total).toBe(1);
  });
  it('filters both totals and details by Beijing creation-day boundaries, not event dates', async () => {
    const row = await demand();
    await application(null, { intentDemandId: row.id, createdAt: new Date('2026-11-23T15:59:59.999Z') });
    const start = await application(null, { intentDemandId: row.id, createdAt: new Date('2026-11-23T16:00:00Z') });
    const end = await application(null, { intentDemandId: row.id, createdAt: new Date('2026-11-24T15:59:59.999Z') });
    await application(null, { intentDemandId: row.id, createdAt: new Date('2026-11-24T16:00:00Z') });
    const filter = query({ demandId: row.id, from: '2026-11-24', to: '2026-11-24', unknownSource: true });
    expect((await service.channels(filter, reader)).totals.applicationCount).toBe(2);
    expect(new Set((await service.applications(filter, reader)).items.map(item => item.id))).toEqual(new Set([start.id, end.id]));
  });
  it('does not truncate channel totals at a page limit and returns unique matching detail pages', async () => {
    const row = await demand();
    const first = await application(null, { intentDemandId: row.id, sourceChannel: 'mail' });
    await db.talentApplication.createMany({ data: Array.from({ length: 104 }, () => ({ candidateId: first.candidateId, positionName: 'Synthetic repeated role', ownerId: editor.id,
      createdById: editor.id, intentDemandId: row.id, sourceChannel: 'mail' })) });
    expect((await service.channels(query({ demandId: row.id, sourceChannel: 'mail' }), reader)).totals.applicationCount).toBe(105);
    const a = await service.applications(query({ demandId: row.id, sourceChannel: 'mail', pageSize: 100 }), reader);
    const b = await service.applications(query({ demandId: row.id, sourceChannel: 'mail', page: 2, pageSize: 100 }), reader);
    expect(a.total).toBe(105); expect(b.items).toHaveLength(5); expect(new Set([...a.items, ...b.items].map(item => item.id)).size).toBe(105);
  });
  it('hides deleted candidate identity without losing the historical application count or exposing contact fields', async () => {
    const row = await demand(), app = await application(null, { intentDemandId: row.id });
    await db.talentCandidate.update({ where: { id: app.candidateId }, data: { deletedAt: new Date() } });
    const result = await service.applications(query({ demandId: row.id }), reader);
    expect(result).toMatchObject({ total: 1, items: [{ id: app.id, candidateName: null, candidateUnavailable: true }] });
    expect(JSON.stringify(result)).not.toContain('analytics-'); expect(JSON.stringify(result)).not.toContain('Synthetic analysis candidate');
  });
  it.each(['talent_hiring_confirm', 'recruitment_demand_review', ''])('refuses narrow reader %j, ignoring claims in the stale token', async capability => {
    const narrow = await db.user.create({ data: { name: 'Synthetic narrow actor', status: 'active', sysRole: 'employee', hrCapabilities: capability ? [capability] : [] } });
    const stale = { ...reader, id: narrow.id, sysRole: 'hr' } as AuthUser;
    await expect(service.channels(query(), stale)).rejects.toThrow(ForbiddenException);
    await expect(service.applications(query(), stale)).rejects.toThrow(ForbiddenException);
    await expect(lifecycle.detail(randomUUID(), stale)).rejects.toThrow(ForbiddenException);
  });
  it('rejects ambiguous source/date/metric/pagination filters rather than silently returning another cohort', async () => {
    for (const changes of [{ sourceChannel: 'boss', unknownSource: true }, { from: '2026-02-30' }, { from: '2026-12-01', to: '2026-11-01' }, { page: 0 }, { pageSize: 101 }, { metric: 'unknown' }]) {
      await expect(service.applications(query(changes), reader)).rejects.toThrow(BadRequestException);
    }
  });
  it('records closure without modifying approval evidence, applications, accepted seats or external posting state', async () => {
    const row = await demand();
    const app = await application(row.id, { stage: 'accepted', events: [{ action: 'accept_offer', version: 1 }] });
    const posting = await db.recruitmentPosting.create({ data: { requestId: randomUUID(), creationFingerprint: 'x'.repeat(64), demandId: row.id, channel: 'boss',
      name: 'Synthetic external job', url: 'https://www.zhipin.com/fictional', verifiedIdentity: true, evidence: 'Synthetic verified identity', active: true, ownerId: editor.id, createdById: editor.id } });
    const before = await db.talentApplication.findUniqueOrThrow({ where: { id: app.id } });
    const result = await lifecycle.change(row.id, { expectedRevision: row.revision, trackingState: 'filled', reason: 'Synthetic closure' }, editor);
    expect(result).toMatchObject({ trackingState: 'filled', summary: { occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, inProgressCount: 1 }, externalPostings: [{ id: posting.id, active: true }] });
    const after = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ sourceState: row.sourceState, sourceFingerprint: row.sourceFingerprint, mappedFingerprint: row.mappedFingerprint, approvedHeadcount: 2 });
    expect(await db.talentApplication.findUniqueOrThrow({ where: { id: app.id } })).toEqual(before);
    expect((await db.recruitmentPosting.findUniqueOrThrow({ where: { id: posting.id } })).active).toBe(true);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id, action: 'tracking_change' } })).toBe(1);
    expect(await lifecycle.detail(row.id, reader)).toMatchObject({ canEdit: false, externalPostings: [], events: [{ reason: 'Synthetic closure' }] });
  });
  it('keeps remaining capacity unknown when the original demand usability rejects an inactive directory', async () => {
    const row = await demand();
    await db.position.update({ where: { id: positionId }, data: { isActive: false } });
    try { expect(await lifecycle.detail(row.id, reader)).toMatchObject({ summary: { approvedHeadcount: 2, remainingCount: null, overCount: null } }); }
    finally { await db.position.update({ where: { id: positionId }, data: { isActive: true } }); }
  });
  it('serializes competing changes at the shared revision and appends exactly one audit event', async () => {
    const row = await demand();
    const results = await Promise.allSettled([
      lifecycle.change(row.id, { expectedRevision: 1, trackingState: 'paused', reason: 'Synthetic pause' }, editor),
      lifecycle.change(row.id, { expectedRevision: 1, trackingState: 'filled', reason: 'Synthetic filled' }, editor),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id } })).toBe(1);
    expect((await db.recruitmentDemand.findUniqueOrThrow({ where: { id: row.id } })).revision).toBe(2);
  });
  it('rechecks revocation committed by a lock holder before a queued change may write', async () => {
    const row = await demand();
    const target = await db.user.create({ data: { name: 'Synthetic revocable lifecycle editor', status: 'active', sysRole: 'employee', hrCapabilities: ['recruitment_edit'] } });
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const holder = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-demand-ledger', 0))`;
      await tx.user.update({ where: { id: target.id }, data: { hrCapabilities: [] } }); acquired(); await gate;
    }, { timeout: 15000 });
    await Promise.race([locked, holder.then(() => { throw new Error('Lock holder finished before acquisition'); })]);
    const result = lifecycle.change(row.id, { expectedRevision: 1, trackingState: 'cancelled', reason: 'Synthetic queued' }, { ...editor, id: target.id })
      .then(() => null, error => error);
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const [locks] = await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*)::bigint AS total FROM pg_locks lock
          JOIN pg_stat_activity activity ON activity.pid = lock.pid WHERE activity.datname = current_database() AND lock.locktype = 'advisory' AND NOT lock.granted`;
        if (Number(locks.total) > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); await holder; }
    expect(await result).toBeInstanceOf(ForbiddenException);
    expect((await db.recruitmentDemand.findUniqueOrThrow({ where: { id: row.id } })).revision).toBe(1);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: row.id } })).toBe(0);
  }, 15000);
});
