import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { RecruitmentDemandsController } from './recruitment-demands.controller';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { RecruitmentDemandApplicationsService } from './recruitment-demand-applications.service';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { TalentRecruitmentController } from './talent-recruitment.controller';

describe('local recruitment demands: isolated HTTP and PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService, other: PrismaService, app: INestApplication;
  let service: RecruitmentDemandsService;
  let editor: AuthUser, secondEditor: AuthUser, reviewer: AuthUser, selfReviewer: AuthUser, reader: AuthUser, hiringConfirmer: AuthUser;
  let departmentId: string, positionId: string;
  const identities = new Map<string, AuthUser>();
  const gateway = { status: () => ({ configured: false, missing: ['fictional_missing_source'], readOnly: true as const }),
    listIds: jest.fn(), readInstance: jest.fn(), verifyForSubmission: jest.fn() };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_local_demands_owned_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri(), url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_local_demands_owned_test') throw new Error('Owned loopback database required');
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 90000,
      });
    } catch { throw new Error('Owned local demand migration failed'); }
    db = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    other = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await db.$connect(); await other.$connect();
    const accounts = await Promise.all([
      ['Synthetic local operator', ['recruitment_edit']], ['Synthetic second local operator', ['recruitment_edit']],
      ['Synthetic independent demand reviewer', ['recruitment_demand_review']],
      ['Synthetic dual-capability operator', ['recruitment_edit', 'recruitment_demand_review']],
      ['Synthetic local demand viewer', ['recruitment_view']],
      ['Synthetic narrow hiring confirmer', ['talent_hiring_confirm']],
    ].map(([name, hrCapabilities]) => db.user.create({ data: { name: name as string, sysRole: 'employee', status: 'active', hrCapabilities: hrCapabilities as string[] } })));
    [editor, secondEditor, reviewer, selfReviewer, reader, hiringConfirmer] = accounts.map(account => ({ id: account.id, name: account.name, sysRole: account.sysRole,
      hrCapabilities: account.hrCapabilities, deptId: null, isAssessorOnly: false, canViewAll: false }));
    for (const actor of [editor, secondEditor, reviewer, selfReviewer, reader, hiringConfirmer]) identities.set(actor.id, actor);
    departmentId = (await db.department.create({ data: { name: 'Synthetic local department' } })).id;
    positionId = (await db.position.create({ data: { code: 'LOCAL-SYN', name: 'Synthetic local position' } })).id;
    service = new RecruitmentDemandsService(db, gateway);
    const module = await Test.createTestingModule({ controllers: [RecruitmentDemandsController, TalentRecruitmentController], providers: [
      { provide: RecruitmentDemandsService, useValue: service }, { provide: RecruitmentDemandApplicationsService, useValue: new RecruitmentDemandApplicationsService(db) },
      { provide: TalentRecruitmentService, useValue: new TalentRecruitmentService(db, service) },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req, _res, next) => { req.user = identities.get(req.headers['x-test-user']); next(); });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 150000);

  afterAll(async () => {
    try { await app?.close(); await other?.$disconnect(); await db?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  function payload(changes = {}) { return { requestId: randomUUID(), deptId: departmentId, positionId, headcount: 2, reason: 'Synthetic local business justification', ...changes }; }
  const api = (actor: AuthUser) => ({
    create: (body: object) => request(app.getHttpServer()).post('/recruitment-demands/local').set('x-test-user', actor.id).send(body),
    update: (id: string, body: object) => request(app.getHttpServer()).patch(`/recruitment-demands/${id}/local`).set('x-test-user', actor.id).send(body),
    act: (id: string, body: object) => request(app.getHttpServer()).post(`/recruitment-demands/${id}/local-actions`).set('x-test-user', actor.id).send(body),
    get: (path: string) => request(app.getHttpServer()).get(`/recruitment-demands${path}`).set('x-test-user', actor.id),
  });

  async function approvedLocal(actor = editor) {
    const draft = (await api(actor).create(payload()).expect(201)).body;
    const submitted = (await api(actor).act(draft.id, { expectedRevision: draft.revision, action: 'submit' }).expect(201)).body;
    return (await api(reviewer).act(draft.id, { expectedRevision: submitted.revision, action: 'approve' }).expect(201)).body;
  }
  async function applicationFixture() {
    const candidate = await db.talentCandidate.create({ data: { name: 'Synthetic native demand candidate', phone: `test-${randomUUID().slice(0, 12)}`,
      sourceChannel: 'referral', createdById: editor.id } });
    const recruitment = new TalentRecruitmentService(db, service);
    const application = await recruitment.create(candidate.id, { positionName: 'Synthetic local position', deptId: departmentId }, editor);
    return { recruitment, application };
  }

  it('gives narrow hiring confirmers only approved association evidence, not the local demand request context', async () => {
    const demand = await approvedLocal(), fixture = await applicationFixture();
    const submitted = await fixture.recruitment.act(fixture.application.id, { expectedRevision: 0, action: 'submit_hiring', note: 'Synthetic hiring decision',
      recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision }, editor);
    const path = `/talent-recruitment/applications/${fixture.application.id}`;
    const narrow = (await request(app.getHttpServer()).get(path).set('x-test-user', hiringConfirmer.id).expect(200)).body;
    const full = (await request(app.getHttpServer()).get(path).set('x-test-user', editor.id).expect(200)).body;
    expect(narrow.recruitmentDemandCurrent).toMatchObject({ id: demand.id, sourceKind: 'local', instanceId: null, sourceState: 'approved', approvedHeadcount: 2 });
    for (const field of ['requestReason', 'requestedHeadcount', 'createdById', 'submittedById', 'approvedById', 'allowedActions', 'rawDepartment', 'rawPosition', 'rawHeadcount']) {
      expect(narrow.recruitmentDemandCurrent).not.toHaveProperty(field);
    }
    expect(full.recruitmentDemandCurrent).toMatchObject({ requestReason: 'Synthetic local business justification', requestedHeadcount: 2,
      createdById: editor.id, submittedById: editor.id, approvedById: reviewer.id, allowedActions: ['withdraw'] });
    expect(narrow.recruitmentDemandSnapshot).toEqual(submitted.recruitmentDemandSnapshot);
    await api(hiringConfirmer).get('').expect(403);
    await request(app.getHttpServer()).get(path).set('x-test-user', reviewer.id).expect(403);
  });

  it('creates one native local draft for the same request and actor, refusing mismatched intents or another actor', async () => {
    const body = payload();
    const first = await api(editor).create(body).expect(201);
    expect(first.body).toMatchObject({ sourceKind: 'local', sourceState: 'draft', instanceId: null, lastSyncedAt: null,
      requestedHeadcount: 2, requestReason: body.reason, createdById: editor.id, submittedById: null, approvedById: null,
      approvedHeadcount: null, usable: false, allowedActions: ['edit', 'submit', 'withdraw'] });
    expect(first.body.issues).not.toContain('请核对批准人数');
    expect(first.body.issues.join('')).toContain('先提交');
    expect((await api(editor).create(body).expect(201)).body.id).toBe(first.body.id);
    await api(editor).create({ ...body, headcount: 3 }).expect(409);
    await api(secondEditor).create(body).expect(403);
    expect(await db.recruitmentDemandEvent.count({ where: { demandId: first.body.id } })).toBe(1);
    expect(gateway.readInstance).not.toHaveBeenCalled();
    expect(gateway.verifyForSubmission).not.toHaveBeenCalled();
  });

  it('uses independent review, immutable pending/approved fields, return-edit-resubmit and source-specific actions', async () => {
    const draft = (await api(editor).create(payload()).expect(201)).body;
    const submitted = (await api(editor).act(draft.id, { expectedRevision: draft.revision, action: 'submit' }).expect(201)).body;
    expect(submitted).toMatchObject({ sourceState: 'pending', submittedById: editor.id, allowedActions: ['withdraw'] });
    expect(submitted.issues).not.toContain('请核对批准人数');
    expect(submitted.issues.join('')).toContain('待审核');
    await api(editor).update(draft.id, { expectedRevision: submitted.revision, headcount: 3 }).expect(400);
    await api(editor).act(draft.id, { expectedRevision: submitted.revision, action: 'approve' }).expect(403);
    const returned = (await api(reviewer).act(draft.id, { expectedRevision: submitted.revision, action: 'return', reason: 'Synthetic missing justification' }).expect(201)).body;
    expect(returned).toMatchObject({ sourceState: 'rejected' });
    expect(returned.issues).not.toContain('请核对批准人数');
    expect(returned.issues.join('')).toContain('退回意见');
    const edited = (await api(editor).update(draft.id, { expectedRevision: returned.revision, headcount: 3, reason: 'Synthetic clarified justification' }).expect(200)).body;
    const resubmitted = (await api(editor).act(draft.id, { expectedRevision: edited.revision, action: 'submit' }).expect(201)).body;
    const approved = (await api(reviewer).act(draft.id, { expectedRevision: resubmitted.revision, action: 'approve' }).expect(201)).body;
    expect(approved).toMatchObject({ sourceKind: 'local', sourceState: 'approved', approvedById: reviewer.id, requestedHeadcount: 3, approvedHeadcount: 3, usable: true });
    await api(editor).update(draft.id, { expectedRevision: approved.revision, headcount: 4 }).expect(400);
    await request(app.getHttpServer()).post(`/recruitment-demands/${draft.id}/refresh`).set('x-test-user', editor.id).expect(400);
    await request(app.getHttpServer()).patch(`/recruitment-demands/${draft.id}/mapping`).set('x-test-user', editor.id)
      .send({ expectedRevision: approved.revision, deptId: departmentId, positionId, approvedHeadcount: 4, reason: 'Synthetic invalid cross-source edit' }).expect(400);
    expect(gateway.readInstance).not.toHaveBeenCalled(); expect(gateway.verifyForSubmission).not.toHaveBeenCalled();
  });

  it('searches and paginates local directory names and exact native ids without an external source', async () => {
    const suffix = randomUUID();
    const department = await db.department.create({ data: { name: `Synthetic searchable department ${suffix}` } });
    const position = await db.position.create({ data: { code: suffix, name: `Synthetic searchable position ${suffix}` } });
    const approved: Array<{ id: string }> = [];
    for (let i = 0; i < 2; i++) {
      const draft = (await api(editor).create(payload({ deptId: department.id, positionId: position.id })).expect(201)).body;
      const pending = (await api(editor).act(draft.id, { expectedRevision: draft.revision, action: 'submit' }).expect(201)).body;
      approved.push((await api(reviewer).act(draft.id, { expectedRevision: pending.revision, action: 'approve' }).expect(201)).body);
    }
    const first = (await api(editor).get(`?keyword=${encodeURIComponent(position.name)}&page=1&pageSize=1`).expect(200)).body;
    const second = (await api(editor).get(`?keyword=${encodeURIComponent(position.name)}&page=2&pageSize=1`).expect(200)).body;
    expect(first.total).toBe(2); expect(second.total).toBe(2);
    expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
    expect(new Set([first.items[0].id, second.items[0].id])).toEqual(new Set(approved.map(row => row.id)));
    const byDepartment = (await api(editor).get(`?keyword=${encodeURIComponent(department.name)}`).expect(200)).body;
    expect(byDepartment.total).toBe(2);
    const byId = (await api(editor).get(`?keyword=${approved[0].id}`).expect(200)).body;
    expect(byId.total).toBe(1); expect(byId.items[0].id).toBe(approved[0].id);
    const candidate = await db.talentCandidate.create({ data: { name: 'Synthetic search candidate', phone: `test-${suffix.slice(0, 12)}`,
      sourceChannel: 'referral', createdById: editor.id } });
    const application = await new TalentRecruitmentService(db, service).create(candidate.id, { deptId: department.id, positionName: position.name }, editor);
    const options = (await api(editor).get(`/options?applicationId=${application.id}&keyword=${encodeURIComponent(position.name)}&pageSize=1`).expect(200)).body;
    expect(options.total).toBe(2); expect(options.items).toHaveLength(1);
    expect(options.items[0].sourceKind).toBe('local'); expect(options.items[0].usable).toBe(true);
    expect(gateway.listIds).not.toHaveBeenCalled(); expect(gateway.verifyForSubmission).not.toHaveBeenCalled();
  });
});
