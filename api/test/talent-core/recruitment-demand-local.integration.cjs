'use strict';

// Host command: node api/test/talent-core/recruitment-demand-local.integration.cjs
async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('reflect-metadata');
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { Test } = require('@nestjs/testing');
  const { Logger, ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('./dist/src/app.module');
  const { PrismaService } = require('./dist/src/prisma/prisma.service');
  const { DingtalkRecruitmentService } = require('./dist/src/dingtalk/dingtalk-recruitment.service');
  const { ResponseInterceptor } = require('./dist/src/common/interceptors/response.interceptor');
  const { HttpExceptionFilter } = require('./dist/src/common/filters/http-exception.filter');
  const { assertFictionalDatabase, createLocalFixture, archiveLocalFixture, payrollPreviewFingerprint } = require('./test/talent-core/recruitment-demand-preview.cjs');
  Logger.overrideLogger(false);
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  let app, fixture, payrollBefore, currentCase = 'preview_guard', gatewayCalls = 0;
  const cases = [], demands = new Set();
  const pass = name => { cases.push(name); process.stdout.write(JSON.stringify({ case: name, passed: true }) + '\n'); };
  const gateway = {
    status: () => ({ configured: false, missing: ['fictional_process_not_configured'], readOnly: true }),
    listIds: async () => { gatewayCalls++; throw new Error('Local demand must not call DingTalk'); },
    readInstance: async () => { gatewayCalls++; throw new Error('Local demand must not call DingTalk'); },
    verifyForSubmission: async () => { gatewayCalls++; throw new Error('Local demand must not call DingTalk'); },
  };
  let origin;
  async function http(actor, method, path, data, expected = 200) {
    const result = await fetch(origin + '/api/v1' + path, { method, headers: {
      ...(actor ? { authorization: `Bearer ${fixture.actors[actor].token}` } : {}), 'content-type': 'application/json',
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(60000) });
    const body = await result.json();
    if (expected === null) return { status: result.status, body };
    assert.equal(result.status, expected, `${currentCase}: ${method} ${path}: ${body.message}`);
    if (expected < 300) assert.equal(body.code, 0);
    return expected < 300 ? body.data : body;
  }
  const detail = id => http('operator', 'GET', '/recruitment-demands/' + id);
  const action = (row, verb, actor = 'operator', reason, expected = 201) => http(actor, 'POST', `/recruitment-demands/${row.id}/local-actions`,
    { expectedRevision: row.revision, action: verb, ...(reason === undefined ? {} : { reason }) }, expected);
  let initial;
  const create = async (actor = 'operator', changes = {}) => {
    const row = await http(actor, 'POST', '/recruitment-demands/local', { ...initial, requestId: randomUUID(), ...changes }, 201);
    demands.add(row.id); return row;
  };
  const update = (row, changes = {}, expected = 200) => http('operator', 'PATCH', `/recruitment-demands/${row.id}/local`,
    { deptId: fixture.department.id, positionId: fixture.position.id, headcount: 2, reason: '虚构审核后修改招聘原因', expectedRevision: row.revision, ...changes }, expected);
  const auditCount = id => db.recruitmentDemandEvent.count({ where: { demandId: id } });
  async function unchanged(row, events) {
    assert.deepEqual(await detail(row.id), row);
    assert.equal(await auditCount(row.id), events);
  }
  try {
    await assertFictionalDatabase(db);
    payrollBefore = await payrollPreviewFingerprint(db);
    assert.equal(payrollBefore.count, 32, 'Preserve the known 32 existing January 2037 payroll batches');
    fixture = await createLocalFixture(db, 'RDI_' + randomUUID().slice(0, 8));
    initial = { deptId: fixture.department.id, positionId: fixture.position.id, headcount: 2, reason: `虚构${fixture.prefix}系统需求` };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider(DingtalkRecruitmentService).useValue(gateway).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();

    currentCase = 'narrow_review_read_and_direct_mutation_boundaries';
    for (const actor of ['reviewer', 'viewer', 'outsider', 'confirmer']) {
      await http(actor, 'POST', '/recruitment-demands/local', { ...initial, requestId: randomUUID() }, 403);
    }
    await http('outsider', 'GET', '/recruitment-demands', undefined, 403);
    await http('reviewer', 'GET', '/recruitment-demands');
    await http('reviewer', 'GET', '/talents', undefined, 403);
    await http('reviewer', 'GET', '/talent-recruitment/hiring-reviews', undefined, 403);
    assert.equal((await http('operator', 'GET', '/recruitment-demands/status')).configured, false);
    pass(currentCase);

    currentCase = 'uuid_create_retry_has_one_draft_and_one_create_event';
    const requestId = randomUUID();
    let demand = await create('operator', { requestId });
    const repeated = await http('operator', 'POST', '/recruitment-demands/local', { ...initial, requestId }, 201);
    assert.equal(demand.id, repeated.id); assert.equal(repeated.revision, demand.revision);
    assert.equal(await db.recruitmentDemand.count({ where: { id: demand.id } }), 1);
    assert.equal(await db.recruitmentDemand.count({ where: { sourceKind: 'local', createdById: fixture.actors.operator.id } }), 1);
    assert.equal(await auditCount(demand.id), 1);
    assert.equal(demand.sourceKind, 'local'); assert.equal(demand.instanceId, null); assert.equal(demand.sourceLink, null);
    assert.equal(demand.sourceState, 'draft'); assert.equal(demand.usable, false);
    assert.equal(demand.requestedHeadcount, 2);
    pass(currentCase);

    currentCase = 'stale_write_and_cross_source_commands_leave_ledger_unchanged';
    const stale = demand;
    demand = await update(demand);
    const baseline = await detail(demand.id), baselineEvents = await auditCount(demand.id);
    await update(stale, { reason: '虚构应保留但不得写入的旧版本输入' }, 409);
    await action(stale, 'submit', 'operator', undefined, 409);
    for (const [method, suffix, body] of [
      ['POST', 'refresh', {}], ['PATCH', 'mapping', { expectedRevision: demand.revision, deptId: fixture.department.id,
        positionId: fixture.position.id, approvedHeadcount: 2, reason: '虚构不得跨来源核对' }],
    ]) {
      const rejected = await http('operator', method, `/recruitment-demands/${demand.id}/${suffix}`, body, null);
      assert.ok([400, 409].includes(rejected.status), `${suffix} must reject local rows`);
    }
    await unchanged(baseline, baselineEvents); assert.equal(gatewayCalls, 0);
    pass(currentCase);

    currentCase = 'submit_freezes_edit_return_requires_reason_and_keeps_history';
    demand = await action(demand, 'submit');
    assert.equal(demand.usable, false); assert.equal(demand.submittedById, fixture.actors.operator.id);
    const submitted = await detail(demand.id), submittedEvents = await auditCount(demand.id);
    await update(demand, {}, 400);
    await action(demand, 'approve', 'operator', undefined, 403);
    await action(demand, 'approve', 'viewer', undefined, 403);
    await action(demand, 'approve', 'confirmer', undefined, 403);
    await action(demand, 'return', 'reviewer', '   ', 400);
    await unchanged(submitted, submittedEvents);
    const returnReason = `虚构${fixture.prefix}请补充招聘依据`;
    demand = await action(demand, 'return', 'reviewer', returnReason);
    demand = await detail(demand.id);
    assert.ok(demand.allowedActions.includes('edit'));
    assert.equal(demand.usable, false);
    const returned = await detail(demand.id);
    assert.ok(returned.events.some(event => event.reason === returnReason));
    demand = await update(demand, { reason: `虚构${fixture.prefix}已补充独立审核依据` });
    demand = await action(demand, 'submit');
    const submittedAgain = demand;
    demand = await action(demand, 'approve', 'reviewer', '虚构独立需求审核通过');
    assert.equal(demand.sourceState, 'approved'); assert.equal(demand.usable, true);
    assert.equal(demand.approvedHeadcount, 2); assert.equal(demand.approvedById, fixture.actors.reviewer.id);
    assert.notEqual(demand.approvedById, demand.submittedById);
    await action(submittedAgain, 'approve', 'reviewer', undefined, 409);
    await update(demand, {}, 400);
    const approvedEvents = (await detail(demand.id)).events;
    assert.ok(approvedEvents.some(event => event.reason === returnReason));
    assert.equal(new Set(approvedEvents.map(event => event.revision)).size, approvedEvents.length);
    pass(currentCase);

    currentCase = 'dual_capability_cannot_approve_own_submission';
    let own = await create('dual'); own = await action(own, 'submit', 'dual');
    const ownEvents = await auditCount(own.id);
    await action(own, 'approve', 'dual', '虚构自审必须被拒绝', 403);
    assert.equal(await auditCount(own.id), ownEvents); assert.equal((await detail(own.id)).usable, false);
    pass(currentCase);

    currentCase = 'reviewer_capability_revocation_rechecked_from_database';
    const prior = await db.user.findUniqueOrThrow({ where: { id: fixture.actors.reviewer.id }, select: { hrCapabilities: true } });
    await db.user.update({ where: { id: fixture.actors.reviewer.id }, data: { hrCapabilities: [] } });
    try { await action(own, 'approve', 'reviewer', undefined, 403); }
    finally { await db.user.update({ where: { id: fixture.actors.reviewer.id }, data: { hrCapabilities: prior.hrCapabilities } }); }
    pass(currentCase);

    currentCase = 'approved_local_hiring_without_dingtalk_then_independent_confirmation_and_acceptance';
    const candidate = await db.talentCandidate.create({ data: { name: `虚构${fixture.prefix}_候选人`,
      phone: fixture.prefix, sourceChannel: 'other', createdById: fixture.actors.operator.id } });
    let application = await http('operator', 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`,
      { deptId: fixture.department.id, positionName: fixture.position.name }, 201);
    assert.equal(application.recruitmentDemandId, null);
    const options = await http('operator', 'GET', `/recruitment-demands/options?applicationId=${application.id}&page=1&pageSize=100`);
    assert.ok(options.items.some(item => item.id === demand.id && item.sourceKind === 'local'));
    const applicationAction = (row, verb, actor = 'operator', expected = 201, extras = {}) => http(actor, 'POST', `/talent-recruitment/applications/${row.id}/actions`,
      { action: verb, expectedRevision: row.revision, note: `虚构${fixture.prefix}录用意见`, ...extras }, expected);
    await applicationAction(application, 'submit_hiring', 'operator', 409, { recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision - 1 });
    application = await applicationAction(application, 'submit_hiring', 'operator', 201,
      { recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision });
    assert.equal(application.stage, 'hiring_review');
    const snapshot = application.recruitmentDemandSnapshot;
    assert.equal(snapshot.demandId, demand.id); assert.equal(snapshot.instanceId, null);
    assert.equal(snapshot.approvedHeadcount, 2);
    await applicationAction(application, 'approve_hiring', 'operator', 403);
    await applicationAction(application, 'approve_hiring', 'reviewer', 403);
    application = await applicationAction(application, 'approve_hiring', 'confirmer');
    assert.equal(application.stage, 'offered'); assert.equal(application.hiringReviewedById, fixture.actors.confirmer.id);
    assert.notEqual(application.hiringReviewedById, application.hiringRequestedById);
    application = await applicationAction(application, 'accept_offer');
    assert.equal(application.stage, 'accepted');
    const occupied = await detail(demand.id);
    assert.equal(occupied.occupiedCount, 1); assert.equal(occupied.acceptedCount, 1); assert.equal(occupied.remainingCount, 1);
    assert.equal(gatewayCalls, 0);
    pass(currentCase);

    currentCase = 'withdraw_stops_future_selection_but_keeps_accepted_seat_and_frozen_snapshot';
    const futureCandidate = await db.talentCandidate.create({ data: { name: `虚构${fixture.prefix}_后续候选人`,
      phone: fixture.prefix + '_future', sourceChannel: 'other', createdById: fixture.actors.operator.id } });
    const futureApplication = await http('operator', 'POST', `/talent-recruitment/candidates/${futureCandidate.id}/applications`,
      { deptId: fixture.department.id, positionName: fixture.position.name }, 201);
    const futureOptions = `/recruitment-demands/options?applicationId=${futureApplication.id}&page=1&pageSize=100`;
    assert.equal((await http('operator', 'GET', futureOptions)).items.some(item => item.id === demand.id), true);
    demand = await action(occupied, 'withdraw', 'operator', '虚构需求撤回，不释放已接受名额');
    assert.equal(demand.usable, false); assert.equal(demand.occupiedCount, 1);
    assert.equal(demand.acceptedCount, 1);
    const later = await http('operator', 'GET', `/talent-recruitment/applications/${application.id}`);
    assert.deepEqual(later.recruitmentDemandSnapshot, snapshot);
    const noOption = await http('operator', 'GET', futureOptions);
    assert.equal(noOption.items.some(item => item.id === demand.id), false);
    pass(currentCase);
  } catch (error) {
    process.stdout.write(JSON.stringify({ passed: false, case: currentCase, name: error.name, message: error.message }) + '\n');
    throw error;
  } finally {
    try {
      if (fixture && origin) {
        for (const id of demands) {
          const row = await detail(id);
          if (row.sourceState !== 'withdrawn') await action(row, 'withdraw', 'operator', '虚构测试结束，仅撤回本轮需求');
        }
        const archived = await archiveLocalFixture(db, fixture.prefix);
        assert.equal(archived.activeActors, 0); assert.equal(archived.activeCandidates, 0); assert.equal(archived.activeDemands, 0);
        pass('owned_fixture_archived_append_only_history_retained');
      }
      if (payrollBefore) {
        assert.deepEqual(await payrollPreviewFingerprint(db), payrollBefore);
        pass('existing_2037_01_payroll_32_batches_unchanged');
      }
    } finally { if (app) await app.close(); await db.$disconnect(); }
  }
  process.stdout.write(JSON.stringify({ passed: true, fictionalOnly: true, realNestHttp: true, realPostgreSQL: true,
    realAuthGuards: true, dingtalkConfigured: false, externalCalls: gatewayCalls, cases }) + '\n');
}

async function prepareDemoInPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict');
  const { PrismaClient } = require('@prisma/client');
  const { JwtService } = require('@nestjs/jwt');
  const { assertFictionalDatabase, ensureDefaultReviewer, payrollPreviewFingerprint, fixtureNamespace } = require('./test/talent-core/recruitment-demand-preview.cjs');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  try {
    await assertFictionalDatabase(db);
    const payrollBefore = await payrollPreviewFingerprint(db); assert.equal(payrollBefore.count, 32);
    await ensureDefaultReviewer(db);
    const key = 'recruitment_local_preview_draft_v1', existing = await db.systemConfig.findUnique({ where: { key } });
    if (existing) {
      assert.equal(existing.value?.fictional, true);
      const row = await db.recruitmentDemand.findUniqueOrThrow({ where: { id: existing.value.demandId } });
      assert.equal(row.sourceKind, 'local');
      assert.deepEqual(await payrollPreviewFingerprint(db), payrollBefore);
      process.stdout.write(JSON.stringify({ case: 'existing_user_preview_preserved', demandId: row.id, state: row.sourceState, created: false }) + '\n');
      return;
    }
    const owned = (await db.systemConfig.findUnique({ where: { key: fixtureNamespace + 'RDI_5173dede' } }))?.value;
    assert.equal(owned?.fictional, true); assert.equal(owned.prefix, 'RDI_5173dede');
    const department = await db.department.findFirstOrThrow({ where: { name: '虚构需求演练部门_RDI_5173dede', isActive: true } });
    const position = await db.position.findUniqueOrThrow({ where: { code: 'RDI_5173dede' } }); assert.equal(position.isActive, true);
    const operator = await db.user.findUniqueOrThrow({ where: { employeeNo: 'ADMIN' } });
    assert.equal(operator.sysRole, 'system_admin'); assert.ok(operator.name.startsWith('测试·'));
    assert.equal(operator.dingtalkId, null); assert.equal(operator.dingtalkUnionId, null);
    const token = new JwtService().sign({ sub: operator.id, employeeNo: operator.employeeNo }, { secret: process.env.JWT_SECRET, expiresIn: '5m' });
    const response = await fetch('http://127.0.0.1:3000/api/v1/recruitment-demands/local', { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ requestId: '41db17a8-9807-4d3b-aee9-aaa6253e3ea5', deptId: department.id, positionId: position.id,
        headcount: 1, reason: '虚构验收草稿：请核对部门、岗位和人数后提交，由独立审核人审核。不产生真实招聘或通知。' }) });
    assert.equal(response.status, 201);
    const envelope = await response.json(); assert.equal(envelope.code, 0);
    const row = envelope.data; assert.equal(row.sourceKind, 'local'); assert.equal(row.sourceState, 'draft');
    await db.systemConfig.create({ data: { key, value: { fictional: true, demandId: row.id, requestId: '41db17a8-9807-4d3b-aee9-aaa6253e3ea5' } } });
    assert.deepEqual(await payrollPreviewFingerprint(db), payrollBefore);
    process.stdout.write(JSON.stringify({ case: 'one_minimal_user_preview_draft_ready', demandId: row.id, state: row.sourceState, created: true,
      operator: 'ADMIN', independentReviewer: 'HR001', url: 'http://localhost:5173/recruitment/demands', payrollPreserved: true }) + '\n');
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  const args = process.argv.slice(2), prepareDemo = args.length === 1 && args[0] === '--prepare-demo';
  if (args.length && !prepareDemo) throw new Error('Supported option: --prepare-demo (only after coordinated acceptance cleanup)');
  const { spawnSync } = require('node:child_process');
  const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
    input: `(${prepareDemo ? prepareDemoInPreview.toString() : inPreview.toString()})().catch(error=>{process.stdout.write(JSON.stringify({case:'guarded_local_runner_failed',name:error.name,code:error.code})+'\\n');process.exitCode=1;});`,
  });
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.resolve(__dirname, '../../../test-results/recruitment-demand-local-http');
  fs.mkdirSync(directory, { recursive: true });
  const report = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
  fs.writeFileSync(report, execution.stdout || 'No integration proof returned.\n');
  process.stdout.write(execution.stdout || 'No integration proof returned.\n');
  process.stdout.write(JSON.stringify({ report, exitCode: execution.status }) + '\n');
  if (execution.status !== 0 || execution.error || execution.signal) process.exitCode = 1;
}
