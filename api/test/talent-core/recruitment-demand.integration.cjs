'use strict';

// Host command: node api/test/talent-core/recruitment-demand.integration.cjs
async function inPreview(reproduceCurrent = false) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('reflect-metadata');
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID, randomBytes } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { Test } = require('@nestjs/testing');
  const { ConfigService } = require('@nestjs/config');
  const { JwtService } = require('@nestjs/jwt');
  const { Reflector } = require('@nestjs/core');
  const { Logger, ValidationPipe } = require('@nestjs/common');
  Logger.overrideLogger(false);
  const load = (file, name) => require(`./dist/src/${file}`)[name];
  const { assertFictionalDatabase, fixtureGateway, httpFixtureNamespace, scope: sharedScope, fixtureRange } = require('./test/talent-core/recruitment-demand-preview.cjs');
  const PrismaService = load('prisma/prisma.service', 'PrismaService');
  const AuthService = load('auth/auth.service', 'AuthService');
  const BusinessCapabilitiesService = load('auth/business-capabilities.service', 'BusinessCapabilitiesService');
  const DingtalkService = load('dingtalk/dingtalk.service', 'DingtalkService');
  const DingtalkRecruitmentService = load('dingtalk/dingtalk-recruitment.service', 'DingtalkRecruitmentService');
  const RecruitmentDemandsService = load('talent-pool/recruitment-demands.service', 'RecruitmentDemandsService');
  const RecruitmentDemandsController = load('talent-pool/recruitment-demands.controller', 'RecruitmentDemandsController');
  const RecruitmentDemandApplicationsService = load('talent-pool/recruitment-demand-applications.service', 'RecruitmentDemandApplicationsService');
  const TalentRecruitmentService = load('talent-pool/talent-recruitment.service', 'TalentRecruitmentService');
  const TalentRecruitmentController = load('talent-pool/talent-recruitment.controller', 'TalentRecruitmentController');
  const TalentInterviewsService = load('talent-pool/talent-interviews.service', 'TalentInterviewsService');
  const TalentInterviewsController = load('talent-pool/talent-interviews.controller', 'TalentInterviewsController');
  const JwtAuthGuard = load('common/guards/jwt-auth.guard', 'JwtAuthGuard');
  const RolesGuard = load('common/guards/roles.guard', 'RolesGuard');
  const ResponseInterceptor = load('common/interceptors/response.interceptor', 'ResponseInterceptor');
  const HttpExceptionFilter = load('common/filters/http-exception.filter', 'HttpExceptionFilter');
  const prefix = `RDI_${randomUUID().slice(0, 8)}`, configKey = httpFixtureNamespace + prefix;
  const scope = { ...sharedScope, organizationKey: sharedScope.organizationKey + '-' + prefix };
  const clients = [], applications = [], candidates = [], actors = {}, apps = [], proof = [];
  let department, otherDepartment, position, currentCase = 'preview_guard', gatewayCalls = 0, observeVerification;
  const client = name => {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('connection_limit', '1'); url.searchParams.set('application_name', `${prefix}_${name}`);
    const db = new PrismaClient({ datasourceUrl: url.toString(), log: [], errorFormat: 'minimal' });
    clients.push(db); return db;
  };
  const db = client('observer'), httpDb = client('submitter'), refreshDb = client('refresher'), holder = client('holder');
  const pass = name => { proof.push(name); process.stdout.write(JSON.stringify({ case: name, passed: true }) + '\n'); };
  const tokenService = new JwtService({ secret: randomBytes(32).toString('hex'), signOptions: { expiresIn: '1h' } });
  const rawGateway = fixtureGateway(db, prefix);
  const gateway = { status: () => ({ ...rawGateway.status(), scope }), listIds: async input => {
    gatewayCalls++;
    const listed = await rawGateway.listIds(input);
    return { ...listed, instanceIds: [...listed.instanceIds, ...listed.instanceIds] };
  }, readInstance: async id => { gatewayCalls++; return { ...await rawGateway.readInstance(id), ...scope, salary: 'FORBIDDEN_SOURCE_FIELD', attachments: ['FORBIDDEN_ATTACHMENT'] }; },
    verifyForSubmission: async id => {
      gatewayCalls++;
      const result = await rawGateway.verifyForSubmission(id);
      if (observeVerification) await observeVerification(id);
      return { ...result, source: { ...result.source, ...scope }, relatedSources: result.relatedSources.map(source => ({ ...source, ...scope })) };
    },
  };

  async function nest(database) {
    const configuration = new ConfigService({ ...process.env });
    const auth = new AuthService(database, tokenService, configuration, new DingtalkService(configuration), new BusinessCapabilitiesService(database));
    const module = await Test.createTestingModule({ controllers: [RecruitmentDemandsController, TalentRecruitmentController, TalentInterviewsController],
      providers: [{ provide: PrismaService, useValue: database }, DingtalkRecruitmentService,
        RecruitmentDemandsService, RecruitmentDemandApplicationsService, TalentRecruitmentService, TalentInterviewsService] })
      .overrideProvider(DingtalkRecruitmentService).useValue(gateway).compile();
    const app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(new JwtAuthGuard(new Reflector(), tokenService, auth), new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); apps.push(app); return await app.getUrl();
  }
  async function http(origin, actor, method, path, data, expected = 200) {
    const result = await fetch(origin + '/api/v1' + path, { method, headers: {
      ...(actor ? { authorization: `Bearer ${actors[actor].token}` } : {}), 'content-type': 'application/json',
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(45000) });
    const body = await result.json();
    if (expected === null) return { status: result.status, code: body.code, message: body.message, data: body.data };
    assert.equal(result.status, expected, `${currentCase}: ${method} ${path}: ${body.message}`);
    if (expected < 300) assert.equal(body.code, 0);
    return expected < 300 ? body.data : body;
  }
  const source = (suffix, changes = {}) => ({ ...sharedScope, instanceId: `${prefix}_${suffix}`, status: 'approved',
    rawDepartment: `Fictional ${prefix} department`, rawPosition: `Fictional ${prefix} position`, rawHeadcount: 'one person',
    approvedAt: '2026-11-24T01:00:00.000Z', sourceCreatedAt: '2026-11-01T00:00:00.000Z',
    sourceUpdatedAt: '2026-11-24T01:00:00.000Z', sourceLink: `https://example.invalid/${prefix}_${suffix}`,
    mainInstanceId: null, bizAction: null, ...changes });
  async function sources(rows) {
    const prior = (await db.systemConfig.findUnique({ where: { key: configKey } }))?.value || {};
    const existing = prior.sources || [];
    const combined = new Map(existing.map(row => [row.instanceId, row]));
    for (const row of rows) combined.set(row.instanceId, row);
    const value = { ...prior, fictional: true, prefix, sources: [...combined.values()] };
    await db.systemConfig.upsert({ where: { key: configKey }, create: { key: configKey, value }, update: { value } });
  }
  async function verificationBehavior(verification) {
    const current = await db.systemConfig.findUniqueOrThrow({ where: { key: configKey } });
    await db.systemConfig.update({ where: { key: configKey }, data: { value: { ...current.value, verification } } });
  }
  async function cleanup() {
    const ownedActors = await db.user.findMany({ where: { employeeNo: { startsWith: prefix + '_' } }, select: { id: true } });
    const actorIds = ownedActors.map(row => row.id);
    const ownedCandidates = await db.talentCandidate.findMany({ where: { createdById: { in: actorIds }, name: { startsWith: `Fictional ${prefix}` } }, select: { id: true } });
    const candidateIds = ownedCandidates.map(row => row.id);
    await db.$transaction(async tx => {
      const now = new Date();
      await tx.notificationLog.deleteMany({ where: { userId: { in: actorIds } } });
      await tx.talentApplication.updateMany({ where: { candidateId: { in: candidateIds }, stage: 'hiring_review' }, data: { stage: 'withdrawn', revision: { increment: 1 } } });
      await tx.talentCandidate.updateMany({ where: { id: { in: candidateIds }, createdById: { in: actorIds } }, data: { deletedAt: now } });
      await tx.recruitmentDemand.updateMany({ where: { instanceId: { startsWith: prefix + '_' } }, data: { sourceState: 'withdrawn', mappedFingerprint: null } });
      await tx.user.updateMany({ where: { id: { in: actorIds }, employeeNo: { startsWith: prefix + '_' } }, data: { deletedAt: now, archivedAt: now, status: 'resigned' } });
      await tx.department.updateMany({ where: { id: { in: [department?.id, otherDepartment?.id].filter(Boolean) }, name: { startsWith: `Fictional ${prefix}` } }, data: { isActive: false } });
      if (position) await tx.position.updateMany({ where: { id: position.id, code: prefix }, data: { isActive: false } });
      await tx.systemConfig.deleteMany({ where: { key: configKey } });
    });
    assert.equal(await db.recruitmentDemand.count({ where: { instanceId: { startsWith: prefix + '_' }, sourceState: { notIn: ['withdrawn', 'rejected'] } } }), 0);
    assert.equal(await db.user.count({ where: { employeeNo: { startsWith: prefix + '_' }, archivedAt: null } }), 0);
    assert.equal(await db.talentCandidate.count({ where: { id: { in: candidateIds }, deletedAt: null } }), 0);
    assert.equal(await db.talentApplication.count({ where: { candidateId: { in: candidateIds }, stage: 'hiring_review' } }), 0);
    process.stdout.write(JSON.stringify({ case: 'owned_history_retained_without_disabling_triggers', prefix,
      demandEvents: await db.recruitmentDemandEvent.count({ where: { demand: { instanceId: { startsWith: prefix + '_' } } } }),
      syncRuns: await db.recruitmentDemandSyncRun.count({ where: { actorId: { in: actorIds } } }),
      syncItems: await db.recruitmentDemandSyncItem.count({ where: { run: { actorId: { in: actorIds } } } }),
      activeActors: 0, activeCandidates: 0, activeDemands: 0 }) + '\n');
  }
  try {
    for (const database of clients) await assertFictionalDatabase(database);
    assert.equal(await db.recruitmentDemand.count({ where: scope }), 0, 'HTTP proof must own a fresh private source scope');
    if (!reproduceCurrent) {
    const day = fixtureRange({ from: '2026-11-01', to: '2026-11-01' });
    assert.equal(day.start, Date.parse('2026-10-31T16:00:00Z')); assert.equal(day.end, Date.parse('2026-11-01T15:59:59.999Z'));
    await sources([source('range_boundary', { sourceCreatedAt: '2026-10-31T16:00:00Z' })]);
    assert.ok((await rawGateway.listIds({ from: '2026-11-01', to: '2026-11-01' })).instanceIds.includes(prefix + '_range_boundary'));
    await assert.rejects(() => rawGateway.readInstance(prefix + '_unknown'), /Unknown or duplicate/);
    await sources([source('proof_pending', { status: 'pending', supersedesInstanceId: prefix + '_range_boundary' }),
      source('proof_successor', { supersedesInstanceId: prefix + '_range_boundary' }), source('proof_unrelated')]);
    const finiteProof = await rawGateway.verifyForSubmission(prefix + '_range_boundary');
    assert.equal(finiteProof.replacementCoverage, 'complete'); assert.equal(finiteProof.source.instanceId, prefix + '_range_boundary');
    assert.deepEqual(finiteProof.relatedSources.map(row => row.instanceId), [prefix + '_proof_successor']);
    assert.ok(Number.isFinite(Date.parse(finiteProof.checkedAt)));
    await assert.rejects(() => rawGateway.verifyForSubmission(prefix + '_unknown'), /Unknown or duplicate/);
    await sources([source('range_boundary', { organizationKey: 'unowned-fictional-organization' })]);
    await assert.rejects(() => rawGateway.listIds({ from: '2026-11-01', to: '2026-11-01' }), /Unowned upstream/);
    await db.systemConfig.delete({ where: { key: configKey } });
    pass('fixture_gateway_shanghai_month_start_and_same_day_range');
    }
    department = await db.department.create({ data: { name: `Fictional ${prefix} department` } });
    otherDepartment = await db.department.create({ data: { name: `Fictional ${prefix} other department` } });
    position = await db.position.create({ data: { code: prefix, name: `Fictional ${prefix} position` } });
    for (const [kind, capabilities] of [['operator', ['recruitment_edit', 'recruitment_view']], ['viewer', ['recruitment_view']],
      ['confirmer', ['talent_hiring_confirm']], ['dual', ['recruitment_edit', 'recruitment_view', 'talent_hiring_confirm']], ['employee', []]]) {
      const user = await db.user.create({ data: { employeeNo: `${prefix}_${kind}`, name: `Fictional ${prefix} ${kind}`,
        deptId: department.id, accountType: 'employee', status: 'active', sysRole: 'employee', hrCapabilities: capabilities, mustChangePassword: false } });
      await db.employmentRecord.create({ data: { userId: user.id, employeeNo: user.employeeNo, deptId: department.id, company: 'fuede',
        effectiveFrom: new Date('2026-01-01'), entryDate: new Date('2026-01-01'), employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture', reason: prefix } });
      actors[kind] = { id: user.id, token: tokenService.sign({ sub: user.id, employeeNo: user.employeeNo }) };
    }
    const origin = await nest(httpDb), refreshOrigin = await nest(refreshDb);
    const get = (path, actor = 'operator') => http(origin, actor, 'GET', path);
    const sync = async () => {
      const input = { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z', requestId: randomUUID() };
      let result = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', input, 201);
      for (let batch = 0; !result.complete && result.cursor && batch < 20; batch++) {
        assert.equal(result.failed, 0);
        result = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', { ...input, cursor: result.cursor }, 201);
      }
      assert.equal(result.complete, true); return result;
    };
    const find = async instanceId => (await get(`/recruitment-demands?keyword=${instanceId}&page=1&pageSize=100`)).items.find(row => row.instanceId === instanceId);
    const detail = id => get('/recruitment-demands/' + id);
    const seats = async (id, expected) => {
      const current = await detail(id);
      for (const [field, value] of Object.entries(expected)) assert.equal(current[field], value, `${currentCase}: ${field}`);
      return current;
    };
    const map = (demand, changes = {}, expected = 200, actor = 'operator') => http(origin, actor, 'PATCH', `/recruitment-demands/${demand.id}/mapping`,
      { expectedRevision: demand.revision, deptId: department.id, positionId: position.id, approvedHeadcount: 1, reason: 'Fictional explicit mapping verification', ...changes }, expected);
    async function application(changes = {}) {
      const candidate = await db.talentCandidate.create({ data: { name: `Fictional ${prefix} candidate ${candidates.length}`, phone: `${prefix}_${candidates.length}`,
        sourceChannel: 'other', createdById: actors.operator.id } }); candidates.push(candidate.id);
      const row = await http(origin, 'operator', 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`,
        { positionName: position.name, deptId: department.id, ...changes }, 201);
      applications.push(row.id); assert.equal(row.recruitmentDemandId, null); return row;
    }
    const act = (app, demand, expected = 201, changes = {}, actor = 'operator') => http(origin, actor, 'POST', `/talent-recruitment/applications/${app.id}/actions`,
      { action: 'submit_hiring', expectedRevision: app.revision, note: `Fictional ${prefix} preserved hiring note`,
        ...(demand ? { recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision } : {}), ...changes }, expected);
    const unchanged = async (app, beforeEvents) => {
      assert.equal((await db.talentApplication.findUniqueOrThrow({ where: { id: app.id } })).stage, app.stage);
      assert.equal(await db.talentApplicationEvent.count({ where: { applicationId: app.id } }), beforeEvents);
    };
    const seedHistoricalWithdrawal = async app => {
      assert.ok(applications.includes(app.id) && candidates.includes(app.candidateId), 'Only this run owns historical compatibility fixtures');
      await db.$transaction(async tx => {
        const changed = await tx.talentApplication.update({ where: { id: app.id }, data: { stage: 'withdrawn', revision: { increment: 1 } } });
        await tx.talentApplicationEvent.create({ data: { applicationId: app.id, actorId: actors.operator.id, action: 'withdraw',
          fromStage: app.stage, toStage: 'withdrawn', version: changed.revision, note: 'Fictional pre-fix historical withdrawal fixture, not a successful current HTTP action' } });
      });
      return get(`/talent-recruitment/applications/${app.id}`);
    };

    if (reproduceCurrent) {
      const observations = [], regressions = [];
      const { createHash } = require('node:crypto'), fs = require('node:fs');
      const codeHashes = Object.fromEntries(['talent-recruitment.service.js', 'recruitment-demands.service.js', 'dto/talent-recruitment.dto.js']
        .map(file => [file, createHash('sha256').update(fs.readFileSync('dist/src/talent-pool/' + file)).digest('hex')]));
      currentCase = 'red_upstream_withdrawn_but_local_unrefereshed_submit';
      const upstream = source('red_stale'); await sources([upstream]); await sync();
      const demand = await map(await find(upstream.instanceId)), app = await application();
      await sources([{ ...upstream, status: 'withdrawn', sourceUpdatedAt: new Date().toISOString() }]);
      const latestUpstream = await gateway.readInstance(upstream.instanceId), cached = await detail(demand.id);
      assert.equal(latestUpstream.status, 'withdrawn'); assert.equal(cached.sourceState, 'approved'); assert.equal(cached.revision, demand.revision);
      const result = await http(origin, 'operator', 'POST', `/talent-recruitment/applications/${app.id}/actions`, {
        action: 'submit_hiring', expectedRevision: app.revision, recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision,
        note: 'Fictional RED: no refresh after upstream withdrawal',
      }, null);
      const after = await db.talentApplication.findUniqueOrThrow({ where: { id: app.id } });
      const sourceObservation = { case: currentCase, expected: 'reject stale approved source', actualStatus: result.status,
        upstreamState: latestUpstream.status, cachedState: cached.sourceState, cachedRevision: cached.revision,
        persistedStage: after.stage, submitEvents: await db.talentApplicationEvent.count({ where: { applicationId: app.id, action: 'submit_hiring' } }),
        reproduced: result.status === 201 && after.stage === 'hiring_review' };
      observations.push(sourceObservation); process.stdout.write(JSON.stringify(sourceObservation) + '\n');
      if (sourceObservation.reproduced) regressions.push(currentCase);

      currentCase = 'red_accepted_generic_withdraw_succeeds_explicit_termination_missing';
      const terminationSource = source('red_terminate'); await sources([terminationSource]); await sync();
      const terminationDemand = await map(await find(terminationSource.instanceId));
      let accepted = await act(await application(), terminationDemand);
      accepted = await act(accepted, null, 201, { action: 'approve_hiring' }, 'confirmer');
      accepted = await act(accepted, null, 201, { action: 'accept_offer' });
      const withdrawal = await http(origin, 'operator', 'POST', `/talent-recruitment/applications/${accepted.id}/actions`, {
        action: 'withdraw', expectedRevision: accepted.revision, note: 'Fictional RED ordinary withdrawal',
      }, null);
      assert.equal(withdrawal.status, 201); assert.equal(withdrawal.data.stage, 'withdrawn');
      const termination = await http(origin, 'operator', 'POST', `/talent-recruitment/applications/${accepted.id}/actions`, {
        action: 'terminate_offer', expectedRevision: withdrawal.data.revision, note: 'Fictional explicit accepted offer termination',
      }, null);
      const capacity = await detail(terminationDemand.id);
      const terminationObservation = { case: currentCase, expected: 'explicit authorized termination supported once',
        ordinaryWithdrawalStatus: withdrawal.status, terminationStatus: termination.status, terminationMessage: termination.message,
        occupiedCount: capacity.occupiedCount,
        terminationEvents: await db.talentApplicationEvent.count({ where: { applicationId: accepted.id, action: 'terminate_offer' } }),
        reproduced: termination.status === 400 };
      observations.push(terminationObservation); process.stdout.write(JSON.stringify(terminationObservation) + '\n');
      if (terminationObservation.reproduced) regressions.push(currentCase);
      process.stdout.write(JSON.stringify({ redEvidence: true, prefix, privateScope: scope, codeHashes,
        realPostgreSQL: true, realNestHttp: true, externalOverrideOnly: true, externalCalls: 0, observations }) + '\n');
      currentCase = 'red_current_regressions';
      assert.equal(regressions.length, 0, 'RED: ' + regressions.join(', '));
      return;
    }

    currentCase = 'create_interview_before_demand';
    let app = await application();
    await http(origin, 'operator', 'POST', '/talent-interviews', { candidateId: app.candidateId, applicationId: app.id,
      startsAt: '2037-01-15T02:00:00Z', endsAt: '2037-01-15T03:00:00Z', participantIds: [actors.employee.id], invitationText: 'Fictional interview; no external side effects' }, 201);
    const beforeEvents = await db.talentApplicationEvent.count({ where: { applicationId: app.id } });
    await act(app, null, 400); await unchanged(app, beforeEvents); pass(currentCase);

    currentCase = 'real_http_sync_duplicate_instance_idempotent_safe_ledger';
    const upstream = source('approved'); await sources([upstream]);
    assert.equal((await get('/recruitment-demands/status')).readOnly, true);
    const directories = await get('/recruitment-demands/directories');
    assert.ok(directories.departments.some(row => row.id === department.id)); assert.ok(directories.positions.some(row => row.id === position.id));
    await Promise.all([sync(), sync()]);
    let demand = await find(upstream.instanceId); assert.ok(demand); assert.equal(demand.usable, false);
    assert.equal(await db.recruitmentDemand.count({ where: { instanceId: upstream.instanceId } }), 1);
    const initialEvents = await db.recruitmentDemandEvent.count({ where: { demandId: demand.id } });
    await sync(); assert.equal(await db.recruitmentDemandEvent.count({ where: { demandId: demand.id } }), initialEvents);
    const stored = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: demand.id }, include: { events: true } });
    assert.equal(JSON.stringify(stored).includes('FORBIDDEN_'), false); pass(currentCase);

    currentCase = 'explicit_mapping_stale_version_and_exact_application_match';
    await map(demand, { approvedHeadcount: 0 }, 400);
    demand = await map(demand); assert.equal(demand.usable, true);
    const stale = { ...demand }; demand = await map(demand);
    await act(app, stale, 409); await unchanged(app, beforeEvents);
    for (const changes of [{ deptId: otherDepartment.id }, { positionName: position.name + ' junior' }, { deptId: null }]) {
      const mismatched = await application(changes), n = await db.talentApplicationEvent.count({ where: { applicationId: mismatched.id } });
      assert.equal((await get(`/recruitment-demands/options?applicationId=${mismatched.id}`)).total, 0);
      await act(mismatched, demand, 400); await unchanged(mismatched, n);
    }
    const options = await get(`/recruitment-demands/options?applicationId=${app.id}&page=1&pageSize=1`);
    assert.equal(options.total, 1); assert.equal(options.items[0].id, demand.id); pass(currentCase);

    currentCase = 'pending_rejected_withdrawn_unknown_not_submittable';
    for (const status of ['pending', 'rejected', 'withdrawn', 'unknown']) {
      const row = source(status, { status, approvedAt: null }); await sources([row]); await sync();
      const invalid = await find(row.instanceId); assert.equal(invalid.usable, false);
      await map(invalid, {}, 400);
      await act(app, invalid, 400); await unchanged(app, beforeEvents);
    }
    pass(currentCase);

    currentCase = 'current_scope_and_active_directories_required';
    await db.position.update({ where: { id: position.id }, data: { isActive: false } });
    assert.equal((await detail(demand.id)).usable, false); await act(app, demand, 400);
    await db.position.update({ where: { id: position.id }, data: { isActive: true } });
    const originalStatus = gateway.status;
    gateway.status = () => ({ ...originalStatus(), scope: { ...scope, processCode: 'different-fictional-form' } });
    assert.equal((await detail(demand.id)).usable, false);
    assert.equal((await get(`/recruitment-demands/options?applicationId=${app.id}`)).total, 0);
    await act(app, demand, 400); gateway.status = originalStatus; pass(currentCase);

    currentCase = 'source_change_invalidates_mapping_and_prior_revision';
    await sources([source('approved', { rawHeadcount: 'two people', sourceUpdatedAt: '2020-01-01T00:00:00Z' })]);
    const changed = await http(origin, 'operator', 'POST', `/recruitment-demands/${demand.id}/refresh`, {}, 201);
    assert.ok(changed.revision > demand.revision); assert.equal(changed.usable, false);
    await act(app, demand, 409); await act(app, changed, 400); demand = await map(changed, { approvedHeadcount: 2 }); pass(currentCase);

    currentCase = 'approved_capacity_unchanged_until_candidate_acceptance';
    const unoccupied = { approvedHeadcount: 2, occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2, overCount: 0 };
    await seats(demand.id, unoccupied);
    app = await act(app, demand); assert.equal(app.stage, 'hiring_review');
    assert.equal(app.recruitmentDemandId, demand.id); assert.equal(app.recruitmentDemandRevision, demand.revision);
    assert.equal(app.recruitmentDemandSnapshot.positionName, position.name);
    for (const field of ['occupiedCount', 'acceptedCount', 'hiredCount', 'remainingCount']) assert.equal(Object.hasOwn(app.recruitmentDemandSnapshot, field), false);
    let snapshot = JSON.stringify(app.recruitmentDemandSnapshot);
    await seats(demand.id, unoccupied);
    for (let extra = 0; extra < 2; extra++) {
      const otherApp = await application(); assert.equal((await act(otherApp, demand)).stage, 'hiring_review');
    }
    await seats(demand.id, unoccupied);
    await act(app, demand, 403, { action: 'approve_hiring' });
    app = await act(app, null, 201, { action: 'approve_hiring' }, 'confirmer'); assert.equal(app.stage, 'offered');
    await seats(demand.id, unoccupied);
    app = await act(app, null, 201, { action: 'accept_offer' }); assert.equal(app.stage, 'accepted');
    await seats(demand.id, { approvedHeadcount: 2, occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0 }); pass(currentCase);

    currentCase = 'self_confirmation_denied_even_with_explicit_confirm_capability';
    const dualApplication = await act(await application(), demand, 201, {}, 'dual');
    await act(dualApplication, null, 403, { action: 'approve_hiring' }, 'dual');
    assert.equal((await get(`/talent-recruitment/applications/${dualApplication.id}`)).stage, 'hiring_review'); pass(currentCase);

    currentCase = 'generic_withdraw_denied_and_legacy_reopen_cannot_move_an_accepted_seat';
    const occupied = { approvedHeadcount: 2, occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0 };
    const eventsBeforeWithdrawal = await db.talentApplicationEvent.count({ where: { applicationId: app.id } });
    await act(app, null, 400, { action: 'withdraw' }); await unchanged(app, eventsBeforeWithdrawal);
    app = await seedHistoricalWithdrawal(app); assert.equal(app.stage, 'withdrawn');
    await seats(demand.id, occupied);
    app = await act(app, null, 201, { action: 'reopen' }); assert.equal(app.stage, 'screening');
    await seats(demand.id, occupied);
    const alternativeSource = source('allocation_other'); await sources([alternativeSource]); await sync();
    const alternative = await map(await find(alternativeSource.instanceId), { approvedHeadcount: 2 });
    const beforeRejectedTransfer = await get(`/talent-recruitment/applications/${app.id}`);
    const transferEvents = await db.talentApplicationEvent.count({ where: { applicationId: app.id } });
    await act(app, alternative, 400); await unchanged(app, transferEvents);
    const afterRejectedTransfer = await get(`/talent-recruitment/applications/${app.id}`);
    assert.equal(afterRejectedTransfer.recruitmentDemandId, demand.id);
    assert.equal(afterRejectedTransfer.revision, beforeRejectedTransfer.revision);
    assert.deepEqual(afterRejectedTransfer.recruitmentDemandSnapshot, beforeRejectedTransfer.recruitmentDemandSnapshot);
    await seats(demand.id, occupied); await seats(alternative.id, unoccupied);
    app = await act(app, demand); assert.equal(app.stage, 'hiring_review'); await seats(demand.id, occupied);
    app = await act(app, null, 201, { action: 'approve_hiring' }, 'confirmer'); await seats(demand.id, occupied);
    app = await act(app, null, 201, { action: 'accept_offer' }); await seats(demand.id, occupied);
    snapshot = JSON.stringify(app.recruitmentDemandSnapshot); pass(currentCase);

    currentCase = 'withdrawal_old_response_cannot_restore_and_history_snapshot_preserved';
    await sources([source('approved', { status: 'withdrawn', sourceUpdatedAt: '2026-11-24T02:00:00Z' })]);
    await http(origin, 'operator', 'POST', `/recruitment-demands/${demand.id}/refresh`, {}, 201);
    await sources([upstream]); await sync();
    assert.equal((await detail(demand.id)).sourceState, 'withdrawn');
    assert.equal((await detail(demand.id)).usable, false);
    assert.equal(JSON.stringify((await get(`/talent-recruitment/applications/${app.id}`)).recruitmentDemandSnapshot), snapshot); pass(currentCase);

    currentCase = 'correction_supersedes_predecessor_and_cannot_be_undone';
    const predecessor = source('predecessor'), correction = source('correction', { supersedesInstanceId: predecessor.instanceId, mainInstanceId: predecessor.instanceId, bizAction: 'REVOKE' });
    await sources([predecessor]); await sync(); let previous = await map(await find(predecessor.instanceId));
    await sources([correction]); await sync();
    previous = await detail(previous.id); assert.equal(previous.usable, false);
    const fresh = await application(); await act(fresh, previous, 400);
    const replacement = await map(await find(correction.instanceId));
    assert.equal((await act(fresh, replacement)).stage, 'hiring_review');
    await sources([predecessor]); await sync(); assert.equal((await detail(previous.id)).usable, false); pass(currentCase);

    currentCase = 'unauthenticated_viewer_and_employee_boundary';
    await http(origin, null, 'GET', '/recruitment-demands', undefined, 401);
    const callsBeforeDenied = gatewayCalls;
    for (const actor of ['viewer', 'employee']) {
      for (const [method, path, body] of [['POST', '/recruitment-demands/sync', { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }],
        ['POST', `/recruitment-demands/${demand.id}/refresh`, {}], ['PATCH', `/recruitment-demands/${demand.id}/mapping`, { expectedRevision: demand.revision, deptId: department.id, positionId: position.id, approvedHeadcount: 1, reason: 'Denied fixture' }]]) {
        await http(origin, actor, method, path, body, 403);
      }
      if (actor === 'employee') for (const path of ['/recruitment-demands', '/recruitment-demands/status', '/recruitment-demands/directories', `/recruitment-demands/${demand.id}`, `/recruitment-demands/options?applicationId=${fresh.id}`]) {
        await http(origin, actor, 'GET', path, undefined, 403);
      }
    }
    assert.equal(gatewayCalls, callsBeforeDenied); pass(currentCase);

    currentCase = 'submitted_offered_accepted_legacy_history_no_backfill';
    let legacyAccepted;
    for (const stage of ['hiring_review', 'offered', 'accepted']) {
      let legacy = await application();
      await db.talentApplication.update({ where: { id: legacy.id }, data: { stage, hiringRequestedById: actors.operator.id } });
      legacy = await get(`/talent-recruitment/applications/${legacy.id}`); assert.equal(legacy.recruitmentDemandId, null);
      if (stage === 'hiring_review') legacy = await act(legacy, null, 201, { action: 'approve_hiring' }, 'confirmer');
      if (stage !== 'accepted') legacy = await act(legacy, null, 201, { action: 'accept_offer' });
      assert.equal(legacy.stage, 'accepted'); assert.equal(legacy.recruitmentDemandId, null); assert.equal(legacy.recruitmentDemandSnapshot, null);
      if (stage === 'offered') legacyAccepted = legacy;
    }
    pass(currentCase);

    currentCase = 'legacy_null_link_acceptance_cannot_be_backfilled_into_a_new_demand';
    assert.ok(legacyAccepted);
    await act(legacyAccepted, null, 400, { action: 'withdraw' });
    legacyAccepted = await seedHistoricalWithdrawal(legacyAccepted);
    legacyAccepted = await act(legacyAccepted, null, 201, { action: 'reopen' });
    const legacyEvents = await db.talentApplicationEvent.count({ where: { applicationId: legacyAccepted.id } });
    await seats(alternative.id, unoccupied);
    await act(legacyAccepted, alternative, 400); await unchanged(legacyAccepted, legacyEvents);
    const legacyAfter = await get(`/talent-recruitment/applications/${legacyAccepted.id}`);
    assert.equal(legacyAfter.recruitmentDemandId, null); assert.equal(legacyAfter.recruitmentDemandSnapshot, null);
    await seats(alternative.id, unoccupied); pass(currentCase);

    currentCase = 'zero_approved_headcount_cannot_be_mapped_to_positive_capacity';
    for (const [index, rawHeadcount] of ['0', '0人', '0名'].entries()) {
      const zeroSource = source('zero_' + index, { rawHeadcount }); await sources([zeroSource]); await sync();
      const zeroDemand = await find(zeroSource.instanceId);
      await map(zeroDemand, { approvedHeadcount: 1 }, 400);
      assert.equal((await detail(zeroDemand.id)).usable, false);
    }
    pass(currentCase);

    currentCase = 'real_postgres_invalidation_first_blocks_queued_http_submission';
    const raceSource = source('race'); await sources([raceSource]); await sync();
    const raceDemand = await map(await find(raceSource.instanceId)), raceApp = await application();
    await sources([{ ...raceSource, status: 'withdrawn', sourceUpdatedAt: '2026-11-24T03:00:00Z' }]);
    const [{ pid: holderPid }] = await holder.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const [{ pid: refreshPid }] = await refreshDb.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const [{ pid: submitPid }] = await httpDb.$queryRaw`SELECT pg_backend_pid() AS pid`;
    assert.equal(new Set([holderPid, refreshPid, submitPid]).size, 3);
    let release, held;
    const mayRelease = new Promise(resolve => { release = resolve; }), lockHeld = new Promise(resolve => { held = resolve; });
    const holding = holder.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-demand-ledger', 0))`;
      held(); await mayRelease;
    }, { isolationLevel: 'ReadCommitted', timeout: 30000 });
    const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
    const waitBlocked = async (pid, expectedPid) => {
      for (let n = 0; n < 250; n++) {
        const [state] = await db.$queryRaw`SELECT wait_event_type, wait_event, ${expectedPid}::integer = ANY(pg_blocking_pids(pid)) AS expected
          FROM pg_stat_activity WHERE datname = current_database() AND pid = ${pid}::integer`;
        if (state?.wait_event_type === 'Lock' && state.wait_event === 'advisory' && state.expected) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail('Expected real PostgreSQL advisory lock queue was not established');
    };
    let refreshing, submitting;
    try {
      await lockHeld;
      refreshing = outcome(http(refreshOrigin, 'operator', 'POST', `/recruitment-demands/${raceDemand.id}/refresh`, {}, 201));
      await waitBlocked(refreshPid, holderPid);
      submitting = outcome(act(raceApp, raceDemand, 409)); await waitBlocked(submitPid, refreshPid);
      pass('real_postgres_refresh_then_submit_lock_queue_observed');
    } finally {
      release(); await holding;
      const refreshed = refreshing && await refreshing, submitted = submitting && await submitting;
      if (refreshed?.error) throw refreshed.error; if (submitted?.error) throw submitted.error;
    }
    assert.equal((await detail(raceDemand.id)).sourceState, 'withdrawn');
    assert.equal((await get(`/talent-recruitment/applications/${raceApp.id}`)).stage, 'screening');
    assert.equal(await db.talentApplicationEvent.count({ where: { applicationId: raceApp.id, action: 'submit_hiring' } }), 0); pass(currentCase);

    currentCase = 'persistent_cursor_cap_plus_one_and_request_id_replay';
    const limit = (await sync()).limit;
    assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 500);
    const existingCount = await db.recruitmentDemand.count({ where: { ...scope, instanceId: { startsWith: prefix + '_' }, sourceState: { notIn: ['withdrawn', 'rejected'] } } });
    assert.ok(existingCount <= limit);
    await sources(Array.from({ length: limit + 1 - existingCount }, (_, index) => source('cursor_' + index)));
    const intent = { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z', requestId: randomUUID() };
    let batch = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', intent, 201);
    assert.equal(batch.complete, false); assert.ok(batch.cursor);
    assert.ok(batch.synced > 0 && batch.synced <= limit); assert.equal(batch.remaining, limit + 1 - batch.synced);
    const run = await db.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { requestId: intent.requestId } });
    assert.equal(run.id, batch.cursor); assert.equal(run.actorId, actors.operator.id);
    assert.equal(await db.recruitmentDemandSyncItem.count({ where: { runId: run.id } }), limit + 1);
    const progress = await db.recruitmentDemandSyncItem.findMany({ where: { runId: run.id }, orderBy: { ordinal: 'asc' } });
    await http(origin, 'dual', 'POST', '/recruitment-demands/sync', { ...intent, cursor: batch.cursor }, 403);
    assert.deepEqual(await db.recruitmentDemandSyncItem.findMany({ where: { runId: run.id }, orderBy: { ordinal: 'asc' } }), progress);
    const statusBeforeCursorScopeCheck = gateway.status;
    try {
      gateway.status = () => ({ ...statusBeforeCursorScopeCheck(), scope: { ...scope, organizationKey: scope.organizationKey + '-other' } });
      await http(origin, 'operator', 'POST', '/recruitment-demands/sync', { ...intent, cursor: batch.cursor }, 403);
    } finally { gateway.status = statusBeforeCursorScopeCheck; }
    await http(origin, 'operator', 'POST', '/recruitment-demands/sync', { ...intent, to: '2026-11-29T00:00:00Z', cursor: batch.cursor }, 409);
    for (let page = 0; !batch.complete && page < 20; page++) {
      const before = batch.synced;
      batch = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', { ...intent, cursor: batch.cursor }, 201);
      assert.equal(batch.failed, 0); assert.ok(batch.synced > before);
    }
    assert.equal(batch.complete, true); assert.equal(batch.cursor, null); assert.equal(batch.remaining, 0); assert.equal(batch.synced, limit + 1);
    const callsAfterComplete = gatewayCalls;
    const replay = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', intent, 201);
    assert.equal(replay.complete, true); assert.equal(replay.synced, limit + 1); assert.equal(replay.cursor, null);
    assert.equal(gatewayCalls, callsAfterComplete);
    assert.equal(await db.recruitmentDemandSyncRun.count({ where: { requestId: intent.requestId } }), 1);
    const completedItems = await db.recruitmentDemandSyncItem.findMany({ where: { runId: run.id } });
    assert.ok(completedItems.every(item => item.state === 'succeeded' && item.attempts === 1)); pass(currentCase);

    currentCase = 'discarded_http_outcome_recovers_same_request_intent_without_duplicate_reads';
    const recovery = { ...intent, requestId: randomUUID() };
    await http(origin, 'operator', 'POST', '/recruitment-demands/sync', recovery, 201);
    const recoveringRun = await db.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { requestId: recovery.requestId } });
    const succeededBeforeRecovery = await db.recruitmentDemandSyncItem.findMany({ where: { runId: recoveringRun.id, state: 'succeeded' } });
    assert.ok(succeededBeforeRecovery.length > 0 && succeededBeforeRecovery.length <= limit);
    let recovered = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', recovery, 201);
    for (let page = 0; !recovered.complete && page < 20; page++) {
      recovered = await http(origin, 'operator', 'POST', '/recruitment-demands/sync', { ...recovery, cursor: recovered.cursor }, 201);
    }
    assert.equal(recovered.complete, true); assert.equal(recovered.synced, limit + 1);
    assert.equal(await db.recruitmentDemandSyncRun.count({ where: { requestId: recovery.requestId } }), 1);
    assert.ok((await db.recruitmentDemandSyncItem.findMany({ where: { runId: recoveringRun.id } })).every(item => item.attempts === 1));
    pass(currentCase);

    const ready = async suffix => {
      const upstream = source(suffix, { rawHeadcount: '2人' }); await sources([upstream]); await verificationBehavior({}); await sync();
      return { upstream, demand: await map(await find(upstream.instanceId), { approvedHeadcount: 2 }), app: await application() };
    };
    const noSubmission = async id => {
      const row = await db.talentApplication.findUniqueOrThrow({ where: { id } });
      assert.equal(row.stage, 'screening');
      assert.equal(await db.talentApplicationEvent.count({ where: { applicationId: id, action: 'submit_hiring' } }), 0);
    };
    const [{ pid: verifyingPid }] = await httpDb.$queryRaw`SELECT pg_backend_pid() AS pid`;
    let outsideTransactionChecks = 0;
    const observeOutsideTransaction = async () => {
      const [activity] = await db.$queryRaw`SELECT state, xact_start FROM pg_stat_activity WHERE pid = ${verifyingPid}::integer`;
      assert.equal(activity.xact_start, null, 'Remote verification must run before the submission database transaction');
      outsideTransactionChecks++;
    };
    observeVerification = observeOutsideTransaction;

    currentCase = 'fresh_upstream_withdrawal_persists_invalidation_without_application_submission';
    const withdrawn = await ready('fresh_withdrawn');
    await sources([{ ...withdrawn.upstream, status: 'withdrawn', sourceUpdatedAt: new Date().toISOString() }]);
    assert.equal((await detail(withdrawn.demand.id)).sourceState, 'approved');
    await act(withdrawn.app, withdrawn.demand, 409); await noSubmission(withdrawn.app.id);
    assert.equal((await detail(withdrawn.demand.id)).sourceState, 'withdrawn'); pass(currentCase);

    currentCase = 'fresh_verified_successor_retires_cached_predecessor_without_prior_sync';
    const predecessorProof = await ready('fresh_predecessor');
    const successorSource = source('fresh_successor', { rawHeadcount: '2人', supersedesInstanceId: predecessorProof.upstream.instanceId,
      mainInstanceId: predecessorProof.upstream.instanceId, bizAction: 'REVOKE' });
    await sources([successorSource]);
    await act(predecessorProof.app, predecessorProof.demand, 409); await noSubmission(predecessorProof.app.id);
    const retired = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: predecessorProof.demand.id } });
    assert.equal(retired.supersededByInstanceId, successorSource.instanceId);
    assert.ok(await find(successorSource.instanceId)); pass(currentCase);

    currentCase = 'fresh_verification_unproven_permission_timeout_and_absent_method_fail_closed';
    for (const [suffix, behavior, issue] of [
      ['unproven', { replacementCoverage: 'unproven' }, 'replacement_verification_incomplete'],
      ['permission', { failure: 'permission' }, 'submission_verification_failed'],
      ['timeout', { failure: 'timeout' }, 'submission_verification_failed'],
    ]) {
      const f = await ready('fresh_' + suffix); await verificationBehavior(behavior);
      await act(f.app, f.demand, 503); await noSubmission(f.app.id);
      assert.equal((await db.recruitmentDemand.findUniqueOrThrow({ where: { id: f.demand.id } })).syncIssue, issue);
    }
    const absent = await ready('fresh_absent_method'), verifyMethod = gateway.verifyForSubmission;
    try { delete gateway.verifyForSubmission; await act(absent.app, absent.demand, 503); await noSubmission(absent.app.id); }
    finally { gateway.verifyForSubmission = verifyMethod; }
    for (const [suffix, receipt] of [['stale', { checkedAt: new Date(Date.now() - 60000).toISOString() }],
      ['future', { checkedAt: new Date(Date.now() + 60000).toISOString() }], ['invalid_date', { checkedAt: 'not-a-date' }]]) {
      const f = await ready('fresh_receipt_' + suffix);
      try {
        gateway.verifyForSubmission = async id => ({ ...await verifyMethod(id), ...receipt });
        await act(f.app, f.demand, 503); await noSubmission(f.app.id);
      } finally { gateway.verifyForSubmission = verifyMethod; }
    }
    await verificationBehavior({}); pass(currentCase);

    currentCase = 'fresh_remote_proof_rechecks_mapping_and_application_versions';
    const mappingRace = await ready('fresh_mapping_race');
    observeVerification = async instanceId => {
      await observeOutsideTransaction();
      if (instanceId === mappingRace.upstream.instanceId) await http(refreshOrigin, 'operator', 'PATCH', `/recruitment-demands/${mappingRace.demand.id}/mapping`, {
        expectedRevision: mappingRace.demand.revision, deptId: department.id, positionId: position.id, approvedHeadcount: 2, reason: 'Fictional concurrent mapping while source verification returns',
      }, 200);
    };
    await act(mappingRace.app, mappingRace.demand, 409); await noSubmission(mappingRace.app.id);
    const appRace = await ready('fresh_application_race');
    observeVerification = async instanceId => {
      await observeOutsideTransaction();
      if (instanceId === appRace.upstream.instanceId) await http(refreshOrigin, 'operator', 'PATCH', `/talent-recruitment/applications/${appRace.app.id}`, {
        expectedRevision: appRace.app.revision, recruitmentBatch: prefix + '_concurrent_edit',
      }, 200);
    };
    await act(appRace.app, appRace.demand, 409); await noSubmission(appRace.app.id); pass(currentCase);

    currentCase = 'fresh_remote_proof_rechecks_current_editor_after_verification';
    const actorRace = await ready('fresh_actor_race');
    observeVerification = async instanceId => {
      await observeOutsideTransaction();
      if (instanceId === actorRace.upstream.instanceId) await db.user.update({ where: { id: actors.operator.id }, data: { hrCapabilities: ['recruitment_view'] } });
    };
    try { await act(actorRace.app, actorRace.demand, 403); await noSubmission(actorRace.app.id); }
    finally {
      await db.user.update({ where: { id: actors.operator.id }, data: { hrCapabilities: ['recruitment_edit', 'recruitment_view'] } });
      observeVerification = observeOutsideTransaction;
    }
    assert.ok(outsideTransactionChecks > 0); pass(currentCase);

    currentCase = 'explicit_termination_releases_once_with_note_revision_and_edit_permission';
    const terminationFixture = await ready('explicit_termination');
    let offer = await act(terminationFixture.app, terminationFixture.demand);
    offer = await act(offer, null, 201, { action: 'approve_hiring' }, 'confirmer');
    const progressPath = `/recruitment-demands/${terminationFixture.demand.id}/applications`;
    const awaitingReply = await get(progressPath + '?category=awaiting_reply&page=1&pageSize=1');
    assert.equal(awaitingReply.total, 1); assert.equal(awaitingReply.items[0].id, offer.id); assert.equal(awaitingReply.items[0].occupied, false);
    offer = await act(offer, null, 201, { action: 'accept_offer' });
    await seats(terminationFixture.demand.id, { occupiedCount: 1, acceptedCount: 1, remainingCount: 1 });
    for (const actor of ['viewer', 'confirmer']) await act(offer, null, 403, { action: 'terminate_offer', note: 'Fictional denied termination' }, actor);
    await act(offer, null, 400, { action: 'terminate_offer', note: ' ' });
    const terminationInput = { action: 'terminate_offer', expectedRevision: offer.revision, note: 'Fictional accepted offer explicitly ended' };
    const terminated = await Promise.all([http(origin, 'operator', 'POST', `/talent-recruitment/applications/${offer.id}/actions`, terminationInput, null),
      http(refreshOrigin, 'operator', 'POST', `/talent-recruitment/applications/${offer.id}/actions`, terminationInput, null)]);
    assert.deepEqual(terminated.map(result => result.status).sort(), [201, 409]);
    const ended = terminated.find(result => result.status === 201).data;
    await act(ended, null, 400, { action: 'terminate_offer' });
    assert.equal(await db.talentApplicationEvent.count({ where: { applicationId: offer.id, action: 'terminate_offer' } }), 1);
    assert.equal(await db.auditLog.count({ where: { entityId: offer.id, action: 'terminate_offer' } }), 1);
    await seats(terminationFixture.demand.id, { occupiedCount: 0, acceptedCount: 0, remainingCount: 2 }); pass(currentCase);

    currentCase = 'legacy_withdrawn_acceptance_requires_explicit_termination_to_release';
    const compatible = await ready('legacy_explicit_termination');
    let legacyOffer = await act(compatible.app, compatible.demand);
    legacyOffer = await act(legacyOffer, null, 201, { action: 'approve_hiring' }, 'confirmer');
    legacyOffer = await act(legacyOffer, null, 201, { action: 'accept_offer' });
    legacyOffer = await seedHistoricalWithdrawal(legacyOffer);
    await seats(compatible.demand.id, { occupiedCount: 1, remainingCount: 1 });
    legacyOffer = await act(legacyOffer, null, 201, { action: 'terminate_offer', note: 'Fictional compatible historical acceptance explicitly ended' });
    assert.equal(legacyOffer.offerTerminated, true);
    await seats(compatible.demand.id, { occupiedCount: 0, remainingCount: 2 }); pass(currentCase);

    currentCase = 'demand_progress_categories_pagination_reoffer_and_deleted_candidate_privacy';
    const terminatedProgress = await get(progressPath + '?category=terminated&page=1&pageSize=1');
    assert.equal(terminatedProgress.total, 1); assert.equal(terminatedProgress.items[0].id, offer.id); assert.equal(terminatedProgress.items[0].occupied, false);
    await http(origin, 'confirmer', 'GET', progressPath + '?category=terminated', undefined, 403);
    await http(origin, 'employee', 'GET', progressPath, undefined, 403);
    await http(origin, 'operator', 'GET', progressPath + '?category=unknown', undefined, 400);
    const currentTerminationDemand = await detail(terminationFixture.demand.id);
    assert.equal(currentTerminationDemand.usable, true);
    assert.ok(currentTerminationDemand.revision >= terminationFixture.demand.revision);
    let reoffer = await act(ended, null, 201, { action: 'reopen' });
    reoffer = await act(reoffer, currentTerminationDemand);
    reoffer = await act(reoffer, null, 201, { action: 'approve_hiring' }, 'confirmer');
    assert.equal((await get(progressPath + '?category=terminated')).total, 0);
    assert.equal((await get(progressPath + '?category=awaiting_reply')).items[0].id, reoffer.id);
    let anotherOffer = await act(await application(), await detail(terminationFixture.demand.id));
    anotherOffer = await act(anotherOffer, null, 201, { action: 'approve_hiring' }, 'confirmer');
    const firstPage = await get(progressPath + '?category=awaiting_reply&page=1&pageSize=1');
    const secondPage = await get(progressPath + '?category=awaiting_reply&page=2&pageSize=1');
    assert.equal(firstPage.total, 2); assert.equal(secondPage.total, 2);
    assert.equal(firstPage.items.length, 1); assert.equal(secondPage.items.length, 1);
    assert.deepEqual(new Set([firstPage.items[0].id, secondPage.items[0].id]), new Set([reoffer.id, anotherOffer.id]));
    await http(origin, 'operator', 'GET', progressPath + '?page=0', undefined, 400);
    await http(origin, 'operator', 'GET', progressPath + '?pageSize=101', undefined, 400);
    reoffer = await act(reoffer, null, 201, { action: 'accept_offer' });
    const acceptedProgress = await get(progressPath + '?category=accepted&page=1&pageSize=1');
    assert.equal(acceptedProgress.items[0].id, reoffer.id); assert.equal(acceptedProgress.items[0].occupied, true);
    const candidate = await db.talentCandidate.findUniqueOrThrow({ where: { id: reoffer.candidateId } });
    await db.talentCandidate.update({ where: { id: candidate.id }, data: { deletedAt: new Date() } });
    const privateProgress = await get(progressPath + '?category=accepted');
    assert.equal(privateProgress.items[0].candidateName, null); assert.equal(privateProgress.items[0].candidateUnavailable, true);
    assert.equal(privateProgress.items[0].occupied, true); assert.equal(JSON.stringify(privateProgress).includes(candidate.name), false);
    await seats(terminationFixture.demand.id, { occupiedCount: 1, remainingCount: 1 }); pass(currentCase);
  } catch (error) {
    process.stdout.write(JSON.stringify({ passed: false, case: currentCase, name: error.name, message: error.message }) + '\n');
    throw error;
  } finally {
    for (const app of apps) await app.close();
    try { await cleanup(); pass('unique_prefix_archived_no_active_residual_append_only_history_retained'); }
    finally { for (const database of clients) await database.$disconnect(); }
  }
  process.stdout.write(JSON.stringify({ passed: true, fictionalOnly: true, realPostgreSQL: true, realNestHttp: true,
    realAuthGuards: true, externalProviderOverrideOnly: true, externalCalls: 0, cases: proof }) + '\n');
}

if (require.main === module) {
  const args = process.argv.slice(2), reproduceCurrent = args.length === 1 && args[0] === '--reproduce-current';
  if (args.length && !reproduceCurrent) throw new Error('Supported option: --reproduce-current');
  const { spawnSync } = require('node:child_process');
  const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
    input: `(${inPreview.toString()})(${reproduceCurrent}).catch(error => { process.stdout.write(JSON.stringify({case:'guarded_runner_failed',name:error.name,code:error.code})+'\\n');process.exitCode=1; });`,
  });
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.resolve(__dirname, '../../../test-results/recruitment-demand-http');
  fs.mkdirSync(directory, { recursive: true });
  const report = path.join(directory, (reproduceCurrent ? 'red-current-' : '') + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
  fs.writeFileSync(report, execution.stdout || 'No integration proof returned.\n');
  process.stdout.write(execution.stdout || 'No integration proof returned.\n');
  process.stdout.write(JSON.stringify({ report, exitCode: execution.status }) + '\n');
  if (execution.status !== 0 || execution.error || execution.signal) process.exitCode = 1;
}
