import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { attachRecruitmentDemandSeats } from './recruitment-demand-seats';
import { RecruitmentDemandApplicationsQueryDto, RecruitmentDemandApplicationsService } from './recruitment-demand-applications.service';

describe('demand applications reader boundary', () => {
  it.each([
    { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'], status: 'active' },
    { sysRole: 'hr', hrCapabilities: [], status: 'resigned' },
    { sysRole: 'hr', hrCapabilities: [], status: 'active', isAssessorOnly: true },
    { sysRole: 'hr', hrCapabilities: [], status: 'active', archivedAt: new Date() },
    { sysRole: 'hr', hrCapabilities: [], status: 'active', deletedAt: new Date() },
  ])('checks fresh qualification before any demand or progress lookup: %j', async actor => {
    const tx = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'reader', ...actor }) }, recruitmentDemand: { findUnique: jest.fn() }, $queryRaw: jest.fn() };
    const db = { $transaction: jest.fn(async read => read(tx)) };
    await expect(new RecruitmentDemandApplicationsService(db as never).list('demand', new RecruitmentDemandApplicationsQueryDto(), { id: 'reader', sysRole: 'hr' } as AuthUser)).rejects.toThrow(ForbiddenException);
    expect(tx.recruitmentDemand.findUnique).not.toHaveBeenCalled(); expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('demand applications: owned PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService;
  let reader: AuthUser;
  let confirmer: AuthUser;
  let service: RecruitmentDemandApplicationsService;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_demand_applications_owned_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri(), url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_demand_applications_owned_test') throw new Error('Owned loopback database required');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Owned demand applications migration failed'); }
    db = new PrismaService({ datasources: { db: { url: databaseUrl } } }); await db.$connect();
    const users = await Promise.all([
      db.user.create({ data: { name: 'Synthetic progress reader', sysRole: 'employee', status: 'active', hrCapabilities: ['recruitment_view'] } }),
      db.user.create({ data: { name: 'Synthetic narrow confirmer', sysRole: 'employee', status: 'active', hrCapabilities: ['talent_hiring_confirm'] } }),
    ]);
    [reader, confirmer] = users.map(user => ({ id: user.id, name: user.name, sysRole: user.sysRole, deptId: null,
      isAssessorOnly: false, canViewAll: false, hrCapabilities: user.hrCapabilities }));
    service = new RecruitmentDemandApplicationsService(db);
  }, 150000);

  afterAll(async () => {
    try { await db?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function demand() {
    return db.recruitmentDemand.create({ data: { organizationKey: 'fictional-progress-org', processCode: 'fictional-progress-form', instanceId: randomUUID(),
      sourceFingerprint: 'f'.repeat(64), sourceState: 'approved', approvedHeadcount: 2, lastSyncedAt: new Date() } });
  }
  async function application(demandId: string, stage: string, events: Array<{ action: string; version: number }> = [], updatedAt?: Date) {
    const candidate = await db.talentCandidate.create({ data: { name: `Synthetic progress candidate ${++sequence}`, phone: `demo-${sequence}`, sourceChannel: 'referral', createdById: reader.id } });
    return db.talentApplication.create({ data: { candidateId: candidate.id, positionName: 'Synthetic position', ownerId: reader.id, createdById: reader.id,
      recruitmentDemandId: demandId, stage, revision: Math.max(0, ...events.map(event => event.version)), expectedEntryDate: new Date('2026-12-10T00:00:00Z'),
      ...(updatedAt ? { updatedAt } : {}), events: { create: events.map(event => ({ ...event, actorId: reader.id, toStage: stage })) } } });
  }
  function query(changes = {}) { return Object.assign(new RecruitmentDemandApplicationsQueryDto(), changes); }

  it('counts early intent once without occupying a seat and separates raw intake work', async () => {
    const row = await demand(), app = await application(row.id, 'screening');
    await db.talentApplication.update({ where: { id: app.id }, data: { recruitmentDemandId: null, intentDemandId: row.id } });
    await db.recruitmentIntake.create({ data: { demandId: row.id, ownerId: reader.id, createdById: reader.id, state: 'pending_review' } });
    expect(await service.list(row.id, query({ category: 'screening' }), reader)).toMatchObject({ total: 1, items: [{ id: app.id, category: 'screening', occupied: false }] });
    expect(await (service as any).progress(row.id, reader)).toMatchObject({ applications: { screening: 1 }, intakes: null });
    await db.user.update({ where: { id: reader.id }, data: { hrCapabilities: ['recruitment_view', 'recruitment_edit'] } });
    try { expect(await (service as any).progress(row.id, reader)).toMatchObject({ applications: { screening: 1 }, intakes: { awaiting_resume: 0, pending_review: 1, needs_material: 0 } }); }
    finally { await db.user.update({ where: { id: reader.id }, data: { hrCapabilities: ['recruitment_view'] } }); }
    const [counts] = await attachRecruitmentDemandSeats(db, [{ id: row.id, approvedHeadcount: 2, usable: true }]);
    expect(counts.occupiedCount).toBe(0);
  });

  it('uses an explicitly changed early intent instead of its historical frozen demand', async () => {
    const old = await demand(), current = await demand(), app = await application(old.id, 'screening');
    await db.talentApplication.update({ where: { id: app.id }, data: { intentDemandId: current.id } });
    expect((await service.list(old.id, query(), reader)).items.some(item => item.id === app.id)).toBe(false);
    expect(await service.list(current.id, query({ category: 'screening' }), reader)).toMatchObject({ total: 1, items: [{ id: app.id }] });
    expect((await db.talentApplication.findUniqueOrThrow({ where: { id: app.id } })).recruitmentDemandId).toBe(old.id);
  });

  it('does not restore a historical demand after the operator explicitly clears the intent', async () => {
    const row = await demand(), app = await application(row.id, 'screening', [{ action: 'change_intent', version: 1 }]);
    expect((await service.list(row.id, query(), reader)).items.some(item => item.id === app.id)).toBe(false);
  });
  it.each(['rejected','withdrawn'])('retains the revised intent after an early %s result rather than restoring a frozen demand',async stage=>{
    const old=await demand(),current=await demand(),app=await application(old.id,stage,[{action:'change_intent',version:1}]);
    await db.talentApplication.update({where:{id:app.id},data:{intentDemandId:current.id}});
    expect((await service.list(old.id,query(),reader)).total).toBe(0);
    expect((await service.list(current.id,query(),reader)).items.map(item=>item.id)).toEqual([app.id]);
    await db.talentApplication.update({where:{id:app.id},data:{intentDemandId:null}});
    expect((await service.list(old.id,query(),reader)).total).toBe(0);
    expect((await service.list(current.id,query(),reader)).total).toBe(0);
  });
  it('does not classify a later ordinary withdrawal as the earlier terminated offer',async()=>{
    const old=await demand(),current=await demand(),app=await application(old.id,'withdrawn',[
      {action:'accept_offer',version:1},{action:'terminate_offer',version:2},{action:'reopen',version:3},{action:'change_intent',version:4},{action:'withdraw',version:5}]);
    await db.talentApplication.update({where:{id:app.id},data:{intentDemandId:current.id}});
    expect((await service.list(old.id,query(),reader)).total).toBe(0);
    expect(await service.list(current.id,query(),reader)).toMatchObject({total:1,items:[{id:app.id,category:null,occupied:false}]});
  });

  it('classifies current relationships and reconciles accepted/hired occupancy with the shared helper', async () => {
    const row = await demand(), accept = { action: 'accept_offer', version: 2 }, terminate = { action: 'terminate_offer', version: 4 };
    await application(row.id, 'offered', [{ action: 'approve_hiring', version: 1 }]);
    await application(row.id, 'accepted', [accept]);
    await application(row.id, 'onboarding', [accept, { action: 'start_onboarding', version: 3 }]);
    const withdrawn = await application(row.id, 'withdrawn', [accept, { action: 'withdraw', version: 3 }]);
    await db.talentCandidate.update({ where: { id: withdrawn.candidateId }, data: { deletedAt: new Date() } });
    await application(row.id, 'withdrawn', [accept, terminate]);
    await application(row.id, 'hired', [accept, { action: 'activate_onboarding', version: 3 }]);
    await application(row.id, 'hiring_review');
    await application(row.id, 'accepted', [accept, terminate, { action: 'accept_offer', version: 6 }]);
    await application((await demand()).id, 'accepted', [accept]);
    const all = await service.list(row.id, query(), reader);
    expect(all).toMatchObject({ total: 8, page: 1, pageSize: 20 });
    expect(all.items.filter(item => item.category === 'awaiting_reply')).toHaveLength(1);
    expect(all.items.filter(item => item.category === 'accepted')).toHaveLength(4);
    expect(all.items.filter(item => item.category === 'terminated')).toHaveLength(1);
    expect(all.items.filter(item => item.category === 'hired')).toHaveLength(1);
    expect(all.items.filter(item => item.category === 'hiring_review')).toHaveLength(1);
    expect(all.items.filter(item => item.category === null)).toHaveLength(0);
    const [counts] = await attachRecruitmentDemandSeats(db, [{ id: row.id, approvedHeadcount: 2, usable: true }]);
    expect(all.items.filter(item => item.occupied)).toHaveLength(counts.occupiedCount);
    expect(all.items.filter(item => item.category === 'accepted')).toHaveLength(counts.acceptedCount);
    expect(all.items.filter(item => item.category === 'hired')).toHaveLength(counts.hiredCount);
  });

  it('applies category filtering in PostgreSQL before both pagination and total counting', async () => {
    const row = await demand();
    const awaiting = await application(row.id, 'offered', [], new Date('2026-11-01T00:00:00Z'));
    for (let i = 0; i < 5; i++) await application(row.id, 'accepted', [{ action: 'accept_offer', version: 2 }], new Date('2026-11-24T00:00:00Z'));
    expect(await service.list(row.id, query({ category: 'awaiting_reply', pageSize: 1 }), reader)).toMatchObject({ total: 1, items: [{ id: awaiting.id, category: 'awaiting_reply', occupied: false }] });
    const second = await service.list(row.id, query({ category: 'accepted', page: 2, pageSize: 2 }), reader);
    const third = await service.list(row.id, query({ category: 'accepted', page: 3, pageSize: 2 }), reader);
    expect(second.total).toBe(5); expect(second.items).toHaveLength(2); expect(third.items).toHaveLength(1);
    expect(new Set([...second.items, ...third.items].map(item => item.id)).size).toBe(3);
  });

  it('returns exactly the allowlisted metadata and chooses an active onboarding request over a newer cancelled one', async () => {
    const row = await demand(), app = await application(row.id, 'onboarding', [{ action: 'accept_offer', version: 2 }]);
    const base = { employeeName: 'Synthetic onboarding', sourceType: 'onboarding_intake', talentCandidateId: app.candidateId,
      talentApplicationId: app.id, proposedValue: { privateSyntheticField: 'not returned' }, createdById: reader.id };
    const active = await db.employeeDataChangeRequest.create({ data: { ...base, onboardingStatus: 'pending_entry', createdAt: new Date('2026-11-22T00:00:00Z') } });
    await db.employeeDataChangeRequest.create({ data: { ...base, onboardingStatus: 'draft', cancelledAt: new Date(), createdAt: new Date('2026-11-24T00:00:00Z') } });
    const { items: [item] } = await service.list(row.id, query(), reader);
    expect(Object.keys(item).sort()).toEqual(['id', 'candidateId', 'candidateName', 'candidateUnavailable', 'positionName', 'stage', 'revision', 'ownerName', 'expectedEntryDate', 'category', 'occupied', 'onboardingRequest'].sort());
    expect(item).toMatchObject({ id: app.id, candidateUnavailable: false, ownerName: reader.name, expectedEntryDate: '2026-12-10', onboardingRequest: { id: active.id, recordStatus: 'submitted', onboardingStatus: 'pending_entry' } });
    expect(Object.keys(item.onboardingRequest!).sort()).toEqual(['id', 'recordStatus', 'onboardingStatus'].sort());
    expect(JSON.stringify(item)).not.toContain('privateSyntheticField'); expect(JSON.stringify(item)).not.toContain('demo-');
  });

  it('rechecks database capability on every request and refuses narrow confirmers and stale grants', async () => {
    const row = await demand();
    await expect(service.list(row.id, query(), confirmer)).rejects.toThrow(ForbiddenException);
    await db.user.update({ where: { id: reader.id }, data: { hrCapabilities: [] } });
    try { await expect(service.list(row.id, query(), { ...reader, sysRole: 'hr' })).rejects.toThrow(ForbiddenException); }
    finally { await db.user.update({ where: { id: reader.id }, data: { hrCapabilities: ['recruitment_view'] } }); }
  });

  it('uses the current offered stage after termination, reopening and selecting another demand', async () => {
    const previous = await demand(), current = await demand();
    const app = await application(previous.id, 'withdrawn', [{ action: 'accept_offer', version: 1 }, { action: 'terminate_offer', version: 2 }]);
    await db.talentApplication.update({ where: { id: app.id }, data: { recruitmentDemandId: current.id, stage: 'offered' } });
    expect((await service.list(previous.id, query(), reader)).total).toBe(0);
    expect(await service.list(current.id, query(), reader)).toMatchObject({ total: 1, items: [{ id: app.id, category: 'awaiting_reply', occupied: false }] });
    expect(await service.list(current.id, query({ category: 'terminated' }), reader)).toMatchObject({ total: 0, items: [] });
    expect(await service.list(current.id, query({ category: 'awaiting_reply' }), reader)).toMatchObject({ total: 1, items: [{ id: app.id }] });
  });

  it.each(['screening', 'hiring_review'])('does not label a reopened %s application terminated because of an older event', async stage => {
    const row = await demand(), app = await application(row.id, stage, [{ action: 'accept_offer', version: 1 }, { action: 'terminate_offer', version: 2 }, { action: 'reopen', version: 3 }]);
    expect(await service.list(row.id, query(), reader)).toMatchObject({ total: 1, items: [{ id: app.id, category: stage, occupied: false }] });
    expect((await service.list(row.id, query({ category: 'terminated' }), reader)).total).toBe(0);
  });

  it('hides a deleted candidate name and marks it unavailable without releasing its accepted seat', async () => {
    const row = await demand(), app = await application(row.id, 'withdrawn', [{ action: 'accept_offer', version: 1 }, { action: 'withdraw', version: 2 }]);
    const candidate = await db.talentCandidate.findUniqueOrThrow({ where: { id: app.candidateId } });
    await db.talentCandidate.update({ where: { id: app.candidateId }, data: { deletedAt: new Date() } });
    const result = await service.list(row.id, query({ category: 'accepted' }), reader);
    expect(result).toMatchObject({ total: 1, items: [{ id: app.id, candidateId: app.candidateId, candidateName: null, candidateUnavailable: true, category: 'accepted', occupied: true }] });
    expect(JSON.stringify(result)).not.toContain(candidate.name);
    const [counts] = await attachRecruitmentDemandSeats(db, [{ id: row.id, approvedHeadcount: 2, usable: true }]);
    expect(counts).toMatchObject({ occupiedCount: 1, acceptedCount: 1 });
  });

  it('rejects invalid pagination/category and returns 404 for a missing demand after authorization', async () => {
    const row = await demand();
    for (const changes of [{ page: 0 }, { pageSize: 101 }, { category: 'arbitrary' }]) await expect(service.list(row.id, query(changes), reader)).rejects.toThrow(BadRequestException);
    await expect(service.list(randomUUID(), query(), reader)).rejects.toThrow(NotFoundException);
  });
});
