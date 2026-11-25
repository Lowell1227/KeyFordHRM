'use strict';

// Host command: node api/test/talent-core/recruitment-intake.integration.cjs
async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('reflect-metadata');
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID, randomInt } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { Test } = require('@nestjs/testing');
  const { Logger, ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('./dist/src/app.module');
  const { PrismaService } = require('./dist/src/prisma/prisma.service');
  const { RecruitmentMailboxGateway } = require('./dist/src/talent-pool/recruitment-mail-gateway');
  const { TalentResumeService } = require('./dist/src/talent-pool/talent-resume.service');
  const { ResponseInterceptor } = require('./dist/src/common/interceptors/response.interceptor');
  const { HttpExceptionFilter } = require('./dist/src/common/filters/http-exception.filter');
  const { StorageService } = require('./dist/src/storage/storage.service');
  const { archiveLocalFixture, assertFictionalDatabase } = require('./test/talent-core/recruitment-demand-preview.cjs');
  const fixtures = require('./test/talent-core/recruitment-intake-fixtures.cjs');
  Logger.overrideLogger(false);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.searchParams.set('application_name', 'fictional-intake-http-proof');
  databaseUrl.searchParams.set('connection_limit', '5');
  const db = new PrismaClient({ datasourceUrl: databaseUrl.toString(), log: [], errorFormat: 'minimal' });
  databaseUrl.searchParams.set('application_name', 'fictional-intake-race-holder');
  databaseUrl.searchParams.set('connection_limit', '1');
  const holder = new PrismaClient({ datasourceUrl: databaseUrl.toString(), log: [], errorFormat: 'minimal' });
  let app, f, origin, currentCase = 'preview_guard', passed = false;
  const cases = [], intakes = new Set(), postings = new Set(), demands = new Set();
  const pass = name => { cases.push(name); process.stdout.write(JSON.stringify({ case: name, passed: true }) + '\n'); };
  async function http(actor, method, path, data, expected = 200) {
    const result = await fetch(origin + '/api/v1' + path, { method, headers: {
      authorization: 'Bearer ' + f.actors[actor].token, ...(data instanceof FormData ? {} : { 'content-type': 'application/json' }),
    }, ...(data === undefined ? {} : { body: data instanceof FormData ? data : JSON.stringify(data) }), signal: AbortSignal.timeout(60000) });
    if (expected === 'bytes') { assert.equal(result.status, 200); return { bytes: Buffer.from(await result.arrayBuffer()), headers: result.headers }; }
    const envelope = await result.json();
    if (expected === null) return { status: result.status, body: envelope };
    assert.equal(result.status, expected, `${currentCase}: ${method} ${path}: ${envelope.message}`);
    if (expected < 300) assert.equal(envelope.code, 0);
    return expected < 300 ? envelope.data : envelope;
  }
  const detail = id => http('operator', 'GET', '/recruitment-intakes/' + id);
  async function parseToTerminal(row, actor = 'operator', expectedStatus = 'succeeded', fileId = row.files[0]?.id) {
    const manual = { candidateDraft: row.candidateDraft, applicationDraft: row.applicationDraft };
    let current = await http(actor, 'POST', `/recruitment-intakes/${row.id}/parse`, { expectedRevision: row.revision, ...(fileId ? { fileId } : {}) }, 201);
    assert.equal(current.parseStatus, 'processing', 'Parsing starts asynchronously and must not claim an immediate result');
    const deadline = Date.now() + 15000;
    while (true) {
      assert.deepEqual(current.candidateDraft, manual.candidateDraft, 'Every parse poll must retain the manual candidate draft');
      assert.deepEqual(current.applicationDraft, manual.applicationDraft, 'Every parse poll must retain the manual application draft');
      if (['succeeded', 'failed'].includes(current.parseStatus)) break;
      assert.equal(current.parseStatus, 'processing');
      if (Date.now() > deadline) throw new Error('Fictional parser did not reach its explicit terminal state within 15 seconds');
      await new Promise(resolve => setTimeout(resolve, 75)); current = await detail(row.id);
    }
    assert.equal(current.parseStatus, expectedStatus); return current;
  }
  const create = async (changes = {}) => {
    const row = await http('operator', 'POST', '/recruitment-intakes', { requestId: randomUUID(), state: 'awaiting_resume',
      sourceChannel: 'job_site', sourceNotes: `虚构${f.prefix}允许用于本轮招聘验收的来源资料`, positionName: f.position.name, ...changes }, 201);
    intakes.add(row.id); return row;
  };
  async function upload(row, marker, actor = 'operator') {
    const input = new FormData(); input.append('expectedRevision', String(row.revision));
    input.append('file', new Blob([fixtures.resumePdf(marker)], { type: 'application/pdf' }), marker + '.pdf');
    return http(actor, 'POST', `/recruitment-intakes/${row.id}/files`, input, 201);
  }
  const candidate = (label, changes = {}) => ({ name: `虚构${f.prefix}_${label}`, phone: `170${randomInt(10000000, 100000000)}`,
    sourceChannel: 'job_site', educationReferenceDataId: f.education.id, ...changes });
  const confirm = (row, input, expected = 201, actor = 'operator') => http(actor, 'POST', `/recruitment-intakes/${row.id}/confirm`,
    { expectedRevision: row.revision, requestId: randomUUID(), ...input }, expected);
  async function approvedDemand(position = f.position) {
    let row = await http('operator', 'POST', '/recruitment-demands/local', { requestId: randomUUID(), deptId: f.department.id,
      positionId: position.id, headcount: 2, reason: `虚构${f.prefix}招聘收件链路需求依据` }, 201);
    demands.add(row.id);
    row = await http('operator', 'POST', `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'submit' }, 201);
    return http('reviewer', 'POST', `/recruitment-demands/${row.id}/local-actions`, { expectedRevision: row.revision, action: 'approve' }, 201);
  }
  async function changeFixture(run) {
    const value = await fixtures.configuration(db, f.prefix); run(value);
    await db.systemConfig.update({ where: { key: fixtures.namespace + f.prefix }, data: { value } });
  }
  async function ownedObject(intakeId, fileId) {
    assert.ok(intakes.has(intakeId));
    const record = await db.recruitmentIntakeFile.findUniqueOrThrow({ where: { id: fileId } });
    assert.equal(record.intakeId, intakeId); assert.ok(record.fileName.startsWith(f.prefix + '_'));
    assert.ok(record.objectKey.startsWith('recruitment-intake/')); return record.objectKey;
  }
  try {
    await assertFictionalDatabase(db); await assertFictionalDatabase(holder);
    const mailboxBefore = await db.recruitmentMailboxState.findUnique({ where: { id: 'primary' } });
    if (mailboxBefore?.mailboxKey && (mailboxBefore.mailboxKey !== fixtures.mailboxKey
      || mailboxBefore.authorizedFrom?.toISOString() !== new Date(fixtures.authorizedFrom).toISOString() || mailboxBefore.cursor)) {
      throw new Error('Existing mailbox scope or unfinished cursor is not owned by this intake acceptance; preserve it and coordinate recovery');
    }
    f = await fixtures.createIntakeFixture(db, 'RDI_' + randomUUID().slice(0, 8));
    const gateway = fixtures.mailboxGateway(db, f.prefix), parser = fixtures.realResumeServiceWithFixtureProvider(db, process.env, f.prefix);
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
      .overrideProvider(RecruitmentMailboxGateway).useValue(gateway).overrideProvider(TalentResumeService).useValue(parser.service).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();

    currentCase = 'editor_only_intake_posting_mail_and_file_boundaries';
    const awaiting = await create();
    for (const actor of ['viewer', 'reviewer', 'confirmer', 'outsider', 'assessor']) {
      for (const path of ['/recruitment-intakes', '/recruitment-intakes/' + awaiting.id, '/recruitment-postings', '/recruitment-intakes/mailbox/status']) {
        await http(actor, 'GET', path, undefined, 403);
      }
      await http(actor, 'POST', '/recruitment-intakes', { requestId: randomUUID(), state: 'awaiting_resume' }, 403);
      await http(actor, 'POST', `/recruitment-intakes/${awaiting.id}/close`, { expectedRevision: awaiting.revision, reason: '虚构无权关闭' }, 403);
    }
    pass(currentCase);

    currentCase = 'concurrent_create_and_reconnect_reuse_one_source_intent';
    const createBody = { requestId: randomUUID(), state: 'awaiting_resume', sourceChannel: 'other',
      sourceNotes: `虚构${f.prefix}同一次收件意图`, positionName: f.position.name };
    const [sourceA, sourceB] = await Promise.all([
      http('operator', 'POST', '/recruitment-intakes', createBody, 201),
      http('operator', 'POST', '/recruitment-intakes', createBody, 201),
    ]);
    intakes.add(sourceA.id); intakes.add(sourceB.id); assert.equal(sourceA.id, sourceB.id);
    assert.equal((await http('operator', 'POST', '/recruitment-intakes', createBody, 201)).id, sourceA.id);
    await http('operator', 'POST', '/recruitment-intakes', { ...createBody, sourceNotes: '虚构已变化的同一请求内容' }, 409);
    pass(currentCase);

    currentCase = 'strict_calendar_dates_and_explicit_false_posting_flags';
    for (const nextFollowUpAt of ['2037-02-30T10:00:00+08:00', '2037-13-01T10:00:00+08:00']) {
      await http('operator', 'POST', '/recruitment-intakes', { requestId: randomUUID(), nextFollowUpAt }, 400);
    }
    const beijing = await create({ nextFollowUpAt: '2037-01-09T00:15:00+08:00' });
    assert.equal(beijing.nextFollowUpAt, '2037-01-08T16:15:00.000Z');
    const demand = await approvedDemand();
    const postingPayload = { requestId: randomUUID(), demandId: demand.id, channel: 'job_site', name: `虚构${f.prefix}外部职位A`,
      url: `https://example.invalid/${f.prefix}/job-a`, externalId: f.prefix + '_job_A', verifiedIdentity: false, active: false };
    let posting = await http('operator', 'POST', '/recruitment-postings', postingPayload, 201); postings.add(posting.id);
    assert.equal(posting.verifiedIdentity, false); assert.equal(posting.active, false);
    const booleanStrings = { ...postingPayload, requestId: randomUUID(), name: `虚构${f.prefix}不得把字符串转为真`,
      evidence: '虚构核对依据，不代表字符串false可转换为true', verifiedIdentity: 'false', active: 'false' };
    const stringResponse = await fetch(origin + '/api/v1/recruitment-postings', { method: 'POST', headers: {
      authorization: 'Bearer ' + f.actors.operator.token, 'content-type': 'application/json' }, body: JSON.stringify(booleanStrings) });
    const stringResult = await stringResponse.json();
    if (stringResponse.status === 201) { postings.add(stringResult.data.id); assert.equal(stringResult.data.verifiedIdentity, false); assert.equal(stringResult.data.active, false); }
    else assert.equal(stringResponse.status, 400);
    posting = await http('operator', 'PATCH', `/recruitment-postings/${posting.id}`, { expectedRevision: posting.revision,
      verifiedIdentity: true, active: true, evidence: '虚构外部职位ID及链接已独立核对', reason: '虚构启用当前归属' });
    const replay = await http('operator', 'POST', '/recruitment-postings', postingPayload, 201); assert.equal(replay.id, posting.id);
    const postingB = await http('operator', 'POST', '/recruitment-postings', { ...postingPayload, requestId: randomUUID(),
      name: `虚构${f.prefix}外部职位B`, url: `https://example.invalid/${f.prefix}/job-b`, externalId: f.prefix + '_job_B',
      verifiedIdentity: true, active: true, evidence: '虚构同一获批需求的另一外部职位，身份单独核对' }, 201);
    postings.add(postingB.id); assert.notEqual(postingB.id, posting.id); assert.equal(postingB.demandId, posting.demandId);
    pass(currentCase);

    currentCase = 'waiting_upload_real_minio_guarded_read_and_atomic_candidate_only';
    const marker = f.parserPlans[0].marker, bytes = fixtures.resumePdf(marker);
    let row = await create({ postingId: posting.id, demandId: demand.id, nextFollowUpAt: '2037-01-10T10:00:00+08:00' });
    const originalFollowUp = row.nextFollowUpAt;
    row = await upload(row, marker); assert.equal(row.files.length, 1);
    const file = row.files[0], objectKey = await ownedObject(row.id, file.id);
    const rawPath = '/storage/download?key=' + encodeURIComponent(objectKey);
    const guardedPath = `/recruitment-intakes/${row.id}/files/${file.id}`;
    assert.deepEqual((await http('operator', 'GET', guardedPath, undefined, 'bytes')).bytes, bytes);
    for (const actor of ['operator', 'viewer', 'confirmer', 'outsider']) await http(actor, 'GET', rawPath, undefined, 403);
    for (const actor of ['viewer', 'reviewer', 'confirmer', 'outsider', 'assessor']) await http(actor, 'GET', guardedPath, undefined, 403);
    const editorCaps = (await db.user.findUniqueOrThrow({ where: { id: f.actors.operator.id } })).hrCapabilities;
    await db.user.update({ where: { id: f.actors.operator.id }, data: { hrCapabilities: ['recruitment_view'] } });
    try {
      await http('operator', 'GET', '/recruitment-intakes/' + row.id, undefined, 403);
      await http('operator', 'GET', guardedPath, undefined, 403);
      await http('operator', 'PATCH', '/recruitment-intakes/' + row.id, { expectedRevision: row.revision, sourceNotes: '虚构撤权旧会话必须拒绝' }, 403);
    } finally { await db.user.update({ where: { id: f.actors.operator.id }, data: { hrCapabilities: editorCaps } }); }
    const storage = module.get(StorageService);
    assert.equal((await storage.statObject(objectKey)).size, bytes.length);
    const stale = row;
    row = await http('operator', 'PATCH', `/recruitment-intakes/${row.id}`, { expectedRevision: row.revision,
      candidateDraft: candidate('人工保留姓名'), sourceNotes: `虚构${f.prefix}更新后的来源依据` });
    const beforeConflict = await detail(row.id);
    await http('operator', 'PATCH', `/recruitment-intakes/${row.id}`, { expectedRevision: stale.revision, sourceNotes: '虚构过期输入' }, 409);
    assert.deepEqual(await detail(row.id), beforeConflict);
    row = await parseToTerminal(row);
    assert.equal(row.candidateDraft.name, beforeConflict.candidateDraft.name);
    const input = { requestId: randomUUID(), mode: 'candidate_only', candidate: candidate('只入库'), expectedRevision: row.revision };
    const [first, duplicate] = await Promise.all([confirm(row, input), confirm(row, input)]);
    assert.equal(first.id, row.id); assert.equal(first.state, 'completed'); assert.equal(duplicate.candidateId, first.candidateId);
    assert.ok(first.candidateId); assert.equal(first.applicationId, null); assert.equal(first.nextFollowUpAt, originalFollowUp);
    assert.equal(await db.talentCandidate.count({ where: { phone: input.candidate.phone } }), 1);
    assert.equal(await db.talentApplication.count({ where: { candidateId: first.candidateId } }), 0);
    const binding = await db.talentResumeFile.findMany({ where: { candidateId: first.candidateId, objectKey } }); assert.equal(binding.length, 1);
    assert.deepEqual((await http('viewer', 'GET', rawPath, undefined, 'bytes')).bytes, bytes);
    const viewer = await db.user.findUniqueOrThrow({ where: { id: f.actors.viewer.id } });
    await db.user.update({ where: { id: viewer.id }, data: { hrCapabilities: [] } });
    try { await http('viewer', 'GET', rawPath, undefined, 403); }
    finally { await db.user.update({ where: { id: viewer.id }, data: { hrCapabilities: viewer.hrCapabilities } }); }
    await confirm(row, { ...input, candidate: { ...input.candidate, name: `虚构${f.prefix}不得改写已办结请求` } }, 409);
    pass(currentCase);

    currentCase = 'intake_and_posting_remap_keep_frozen_source_and_public_before_after_whitelist';
    const remapDemand = await approvedDemand();
    const beforePosting = await http('operator', 'GET', '/recruitment-postings/' + posting.id);
    const frozenSource = await db.recruitmentIntake.findUniqueOrThrow({ where: { id: first.id } });
    const oldCreationMapping = (await detail(first.id)).events.find(event => event.action === 'create_intake').metadata.mapping;
    assert.deepEqual(oldCreationMapping, { before: null, after: { postingId: posting.id, postingRevision: beforePosting.revision, demandId: demand.id } });
    const remapped = await http('operator', 'PATCH', '/recruitment-postings/' + posting.id, { expectedRevision: beforePosting.revision,
      demandId: remapDemand.id, reason: '虚构外部职位改归属，既有收件及录用依据保持原版本' });
    assert.equal(remapped.demandId, remapDemand.id);
    assert.deepEqual((await db.recruitmentIntake.findUniqueOrThrow({ where: { id: first.id } })).postingSnapshot, frozenSource.postingSnapshot);
    assert.equal((await detail(first.id)).demandId, demand.id);
    const future = await create({ postingId: posting.id });
    assert.equal(future.demandId, remapDemand.id);
    let changing = await create({ postingId: null, demandId: demand.id });
    const oldRevision = changing.revision;
    changing = await http('operator', 'PATCH', '/recruitment-intakes/' + changing.id, { expectedRevision: changing.revision,
      postingId: posting.id, demandId: remapDemand.id });
    const event = changing.events.find(item => item.revision === oldRevision + 1);
    assert.deepEqual(event.metadata.mapping, { before: { postingId: null, postingRevision: null, demandId: demand.id },
      after: { postingId: posting.id, postingRevision: remapped.revision, demandId: remapDemand.id } });
    for (const mapping of [event.metadata.mapping.before, event.metadata.mapping.after]) {
      assert.deepEqual(Object.keys(mapping).sort(), ['demandId', 'postingId', 'postingRevision']);
    }
    for (const forbidden of ['candidateDraft', 'bodyText', 'parseResult', 'sourceNotes', 'objectKey']) assert.equal(forbidden in event.metadata, false);
    const remapEvent = remapped.events.find(item => item.action === 'remap_posting');
    assert.equal(remapEvent.snapshot.demandId, remapDemand.id);
    assert.equal(remapped.events.find(item => item.action === 'create_posting').snapshot.demandId, demand.id);
    pass(currentCase);

    currentCase = 'original_talent_create_vs_intake_confirm_same_phone_race_has_one_winner_and_no_half_writes';
    let racing = await create({ state: 'pending_review', sourceChannel: 'job_site' });
    racing = await upload(racing, f.parserPlans[3].marker);
    const raceCandidate = candidate('并发原人才建档'), confirmId = randomUUID();
    const raceConfirmBody = { requestId: confirmId, expectedRevision: racing.revision, mode: 'candidate_application',
      candidate: { ...raceCandidate, name: `虚构${f.prefix}_并发收件建档` },
      application: { deptId: f.department.id, positionName: f.position.name } };
    let originalRequest, intakeRequest;
    try {
      await holder.$transaction(async tx => {
        // This short-lived relation lock lets both real HTTP requests pass their reads before their INSERTs race.
        await tx.$executeRaw`LOCK TABLE talent_candidates IN SHARE ROW EXCLUSIVE MODE`;
        originalRequest = http('operator', 'POST', '/talents', raceCandidate, null);
        intakeRequest = http('operator', 'POST', `/recruitment-intakes/${racing.id}/confirm`, raceConfirmBody, null);
        const deadline = Date.now() + 5000;
        let waiting = 0;
        while (Date.now() < deadline) {
          await tx.$queryRaw`SELECT 1 AS cleared FROM pg_stat_clear_snapshot()`;
          const [row] = await tx.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND application_name='fictional-intake-http-proof' AND wait_event_type='Lock'
              AND query LIKE '%INSERT%' AND query LIKE '%talent_candidates%'
              AND pg_backend_pid()=ANY(pg_blocking_pids(pid))`;
          waiting = row.count; if (waiting === 2) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(waiting, 2, 'Both actual original/create and intake/confirm INSERTs must wait on this other PG connection');
      }, { timeout: 12000, maxWait: 5000 });
      const [original, intake] = await Promise.all([originalRequest, intakeRequest]);
      assert.deepEqual([original.status, intake.status].sort(), [201, 409], 'Unique-phone contention must be an ordinary conflict, never P2002/500');
      const people = await db.talentCandidate.findMany({ where: { phone: raceCandidate.phone, deletedAt: null } });
      assert.equal(people.length, 1);
      const afterRace = await detail(racing.id), intakeWon = intake.status === 201;
      assert.equal(afterRace.state, intakeWon ? 'completed' : 'pending_review');
      assert.equal(afterRace.candidateId, intakeWon ? people[0].id : null);
      assert.equal(await db.talentApplication.count({ where: { candidateId: people[0].id } }), intakeWon ? 1 : 0);
      assert.equal(await db.talentResumeFile.count({ where: { candidateId: people[0].id } }), intakeWon ? 1 : 0);
      assert.equal(await db.recruitmentIntakeEvent.count({ where: { intakeId: racing.id, action: 'confirm_intake' } }), intakeWon ? 1 : 0);
      assert.equal(await db.auditLog.count({ where: { entityType: 'recruitment_intake', entityId: racing.id, action: 'confirm_intake' } }), intakeWon ? 1 : 0);
      if (intakeWon) assert.ok(afterRace.applicationId); else assert.equal(afterRace.applicationId, null);
    } finally { await Promise.all([originalRequest, intakeRequest].filter(Boolean)); }
    pass(currentCase);

    currentCase = 'same_phone_explicit_reuse_different_job_preserves_candidate_followup_and_original_application';
    const existingCandidate = await http('operator', 'GET', '/talents/' + first.candidateId);
    const followUp = await http('operator', 'POST', `/talents/${first.candidateId}/follow-ups`, { channel: 'other',
      summary: `虚构${f.prefix}原沟通记录不得覆盖`, occurredAt: '2037-01-08', nextFollowUpAt: '2037-01-12' }, 201);
    let existingApp = await http('operator', 'POST', `/talent-recruitment/candidates/${first.candidateId}/applications`,
      { deptId: f.department.id, positionName: f.position.name }, 201);
    const preservedCandidate = await db.talentCandidate.findUniqueOrThrow({ where: { id: first.candidateId } });
    const preservedFollowUp = await db.talentFollowUp.findUniqueOrThrow({ where: { id: followUp.id } });
    const preservedApplication = await db.talentApplication.findUniqueOrThrow({ where: { id: existingApp.id } });
    const anotherDemand = await approvedDemand(f.secondPosition);
    let other = await create({ state: 'pending_review', demandId: anotherDemand.id, positionName: f.secondPosition.name,
      candidateDraft: candidate('同手机号另岗位', { phone: existingCandidate.phone }) });
    await confirm(other, { mode: 'candidate_application', candidate: candidate('不得覆盖原人才', { phone: existingCandidate.phone }),
      application: { deptId: f.department.id, positionName: f.secondPosition.name } }, 409);
    assert.equal((await detail(other.id)).state, 'pending_review');
    const checked = await http('operator', 'GET', '/talents/check-phone?phone=' + existingCandidate.phone);
    assert.ok(JSON.stringify(checked).includes(first.candidateId));
    const reusedInput = { requestId: randomUUID(), mode: 'candidate_application', existingCandidateId: first.candidateId,
      application: { deptId: f.department.id, positionName: f.secondPosition.name } };
    const reused = await confirm(other, reusedInput); assert.equal(reused.candidateId, first.candidateId); assert.ok(reused.applicationId);
    assert.notEqual(reused.applicationId, existingApp.id);
    assert.equal((await confirm(other, reusedInput)).applicationId, reused.applicationId);
    assert.deepEqual(await db.talentCandidate.findUniqueOrThrow({ where: { id: first.candidateId } }), preservedCandidate);
    assert.deepEqual(await db.talentFollowUp.findUniqueOrThrow({ where: { id: followUp.id } }), preservedFollowUp);
    assert.deepEqual(await db.talentApplication.findUniqueOrThrow({ where: { id: existingApp.id } }), preservedApplication);
    const newApp = await http('operator', 'GET', '/talent-recruitment/applications/' + reused.applicationId);
    assert.equal(newApp.stage, 'screening'); assert.equal(newApp.recruitmentDemandId, null); assert.equal(newApp.recruitmentDemandSnapshot, null);
    pass(currentCase);

    currentCase = 'existing_hiring_demand_gate_independent_confirmation_accept_and_explicit_termination';
    const appPath = '/talent-recruitment/applications/' + newApp.id + '/actions';
    const act = (row, action, actor = 'operator', expected = 201, changes = {}) => http(actor, 'POST', appPath,
      { expectedRevision: row.revision, action, note: `虚构${f.prefix}原招聘规则复验`, ...changes }, expected);
    await act(newApp, 'submit_hiring', 'operator', 400);
    let hired = await act(newApp, 'submit_hiring', 'operator', 201,
      { recruitmentDemandId: anotherDemand.id, expectedDemandRevision: anotherDemand.revision });
    await act(hired, 'approve_hiring', 'operator', 403); await act(hired, 'approve_hiring', 'reviewer', 403);
    hired = await act(hired, 'approve_hiring', 'confirmer'); hired = await act(hired, 'accept_offer');
    assert.equal((await http('operator', 'GET', '/recruitment-demands/' + anotherDemand.id)).occupiedCount, 1);
    hired = await act(hired, 'terminate_offer'); assert.equal(hired.offerTerminated, true);
    assert.equal((await http('operator', 'GET', '/recruitment-demands/' + anotherDemand.id)).occupiedCount, 0);
    pass(currentCase);

    currentCase = 'deleted_candidate_keeps_history_but_blocks_staged_and_published_source_download';
    await db.talentCandidate.update({ where: { id: first.candidateId }, data: { deletedAt: new Date() } });
    await http('operator', 'GET', guardedPath, undefined, 404);
    await http('viewer', 'GET', rawPath, undefined, 403);
    assert.equal(await db.talentResumeFile.count({ where: { candidateId: first.candidateId, objectKey } }), 1);
    pass(currentCase);

    currentCase = 'close_requires_reason_and_missing_identity_never_completes';
    const closable = await create();
    await http('operator', 'POST', `/recruitment-intakes/${closable.id}/close`, { expectedRevision: closable.revision, reason: '   ' }, 400);
    const closed = await http('operator', 'POST', `/recruitment-intakes/${closable.id}/close`, { expectedRevision: closable.revision, reason: '虚构候选人明确结束沟通' }, 201);
    assert.equal(closed.state, 'closed'); assert.ok(closed.closeReason);
    const noPhone = await create({ candidateDraft: { name: `虚构${f.prefix}_无手机号待核` } });
    await confirm(noPhone, { mode: 'candidate_only', candidate: { name: `虚构${f.prefix}_无手机号待核`, sourceChannel: 'other' } }, 400);
    assert.equal((await detail(noPhone.id)).candidateId, null);
    pass(currentCase);

    currentCase = 'parser_failure_explicit_retry_and_late_suggestions_do_not_overwrite_manual_draft';
    await changeFixture(value => { value.parserPlans[1].mode = 'fail_once'; });
    let retryable = await create({ candidateDraft: candidate('解析失败也须保留人工稿') });
    retryable = await upload(retryable, f.parserPlans[1].marker);
    const manual = retryable.candidateDraft;
    retryable = await parseToTerminal(retryable, 'dual', 'failed');
    assert.equal(retryable.parseStatus, 'failed'); assert.equal(retryable.state, 'needs_material');
    assert.deepEqual(retryable.candidateDraft, manual); assert.equal(retryable.files.length, 1);
    retryable = await parseToTerminal(retryable, 'dual');
    assert.equal(retryable.parseStatus, 'succeeded'); assert.deepEqual(retryable.candidateDraft, manual);
    assert.equal(retryable.parseResult.fields.name, f.parserPlans[1].fields.name);
    pass(currentCase);

    currentCase = 'mail_pages_replay_material_classification_and_awaiting_association_preserve_provenance';
    const peopleBeforeMail = await db.user.count(), applicationsBeforeMail = await db.talentApplication.count();
    const sync = () => http('operator', 'POST', '/recruitment-intakes/mailbox/sync', { limit: 20 }, 201);
    let synced = await sync(); assert.equal(synced.failed, 0);
    await changeFixture(value => { value.mailbox.failPages = [1]; });
    if (synced.hasMore) {
      const cursorBeforeFailure = await db.recruitmentMailboxState.findUniqueOrThrow({ where: { id: 'primary' } });
      const retainedBeforeFailure = await db.recruitmentIntake.findMany({ where: { mailboxKey: fixtures.mailboxKey,
        messageId: { startsWith: f.prefix + '_' } }, orderBy: { id: 'asc' } });
      const failed = await http('operator', 'POST', '/recruitment-intakes/mailbox/sync', { limit: 20 }, null);
      assert.ok(failed.status >= 500 && failed.status <= 599, 'A failed upstream page must be an explicit API failure');
      const afterFailure = await db.recruitmentMailboxState.findUniqueOrThrow({ where: { id: 'primary' } });
      for (const field of ['cursor', 'mailboxKey']) assert.equal(afterFailure[field], cursorBeforeFailure[field]);
      assert.deepEqual(afterFailure.authorizedFrom, cursorBeforeFailure.authorizedFrom);
      assert.deepEqual(afterFailure.lastSyncedAt, cursorBeforeFailure.lastSyncedAt);
      assert.equal(afterFailure.leaseToken, null);
      assert.deepEqual(await db.recruitmentIntake.findMany({ where: { mailboxKey: fixtures.mailboxKey,
        messageId: { startsWith: f.prefix + '_' } }, orderBy: { id: 'asc' } }), retainedBeforeFailure);
      await changeFixture(value => { value.mailbox.failPages = []; });
      synced = await sync(); assert.equal(synced.failed, 0);
    } else throw new Error('Expected the bounded mailbox cursor to retain a second page');
    const mails = async () => (await http('operator', 'GET', '/recruitment-intakes?keyword=' + f.prefix + '&page=1&pageSize=100')).items.filter(row => row.transport === 'email');
    const imported = await mails(); for (const row of imported) intakes.add(row.id);
    const rows = await Promise.all(imported.map(row => detail(row.id)));
    assert.equal(rows.filter(row => row.mail?.messageId.endsWith('_two_people')).length, 2);
    assert.equal(rows.length, 9);
    assert.ok(rows.every(row => row.candidateId === null && row.applicationId === null));
    const otherJobMail = rows.find(row => row.mail?.messageId.endsWith('_same_resume_other_job'));
    const firstJobMail = rows.filter(row => row.mail?.messageId.endsWith('_two_people'));
    assert.ok(firstJobMail.every(row => row.postingId === posting.id && row.demandId === remapDemand.id));
    assert.equal(otherJobMail.postingId, postingB.id); assert.equal(otherJobMail.demandId, demand.id);
    for (const suffix of ['link_only', 'unsupported', 'broken_word']) {
      const row = rows.find(item => item.mail?.messageId.endsWith('_' + suffix)); assert.ok(row); assert.equal(row.state, 'needs_material'); assert.ok(row.issues.length);
    }
    assert.equal(rows.find(row => row.mail?.messageId.endsWith('_body_only')).sourceChannel, 'referral');
    assert.equal(rows.find(row => row.mail?.messageId.endsWith('_unknown_job')).sourceChannel, null);
    const bodyOnly = rows.find(row => row.mail?.messageId.endsWith('_body_only'));
    const parsedBody = await parseToTerminal(bodyOnly, 'dual', 'succeeded', null);
    assert.equal(parsedBody.parseStatus, 'succeeded'); assert.equal(parsedBody.files.length, 0);
    assert.equal(parsedBody.parseResult.source.kind, 'text');
    assert.equal(parsedBody.parseResult.fields.name, f.parserPlans[2].fields.name);
    const beforeReplayIds = imported.map(row => row.id).sort();
    let replayed = await sync();
    if (replayed.hasMore) replayed = await sync();
    assert.equal(replayed.hasMore, false); assert.equal(replayed.failed, 0);
    assert.deepEqual((await mails()).map(row => row.id).sort(), beforeReplayIds);
    assert.equal((await db.recruitmentMailboxState.findUniqueOrThrow({ where: { id: 'primary' } })).cursor, null);
    const waiting = await create({ nextFollowUpAt: '2037-01-11T09:30:00+08:00', sourceNotes: `虚构${f.prefix}原待收沟通线索` });
    const mail = await detail(bodyOnly.id);
    await http('operator', 'POST', `/recruitment-intakes/${mail.id}/associate`, { expectedRevision: mail.revision,
      targetIntakeId: waiting.id, expectedTargetRevision: waiting.revision }, 201);
    const joined = await detail(waiting.id); assert.ok(joined.associatedFromIds.includes(mail.id));
    assert.equal(joined.nextFollowUpAt, waiting.nextFollowUpAt); assert.equal(joined.ownerId, waiting.ownerId);
    assert.equal(joined.positionName, waiting.positionName); assert.ok(joined.sourceNotes.includes(waiting.sourceNotes));
    assert.equal((await detail(mail.id)).associatedToId, waiting.id);
    assert.equal((await detail(mail.id)).mail.messageId, mail.mail.messageId);
    assert.equal(await db.user.count(), peopleBeforeMail); assert.equal(await db.talentApplication.count(), applicationsBeforeMail);
    assert.equal(gateway.evidence().externalCalls, 0); assert.equal(parser.client.evidence().externalCalls, 0);
    pass(currentCase); passed = true;
  } catch (error) {
    process.stdout.write(JSON.stringify({ case: currentCase, passed: false, name: error.name, message: error.message }) + '\n'); throw error;
  } finally {
    try {
      if (f && origin) {
        for (const id of intakes) {
          const row = await detail(id);
          if (!['completed', 'closed'].includes(row.state)) await http('operator', 'POST', `/recruitment-intakes/${id}/close`,
            { expectedRevision: row.revision, reason: '虚构验收结束，仅关闭本轮来源待办' }, 201);
        }
        for (const id of postings) {
          const row = await http('operator', 'GET', '/recruitment-postings/' + id);
          if (row.active) await http('operator', 'PATCH', '/recruitment-postings/' + id, { expectedRevision: row.revision, active: false, reason: '虚构验收结束，保留历史归属' });
        }
        for (const id of demands) {
          const row = await http('operator', 'GET', '/recruitment-demands/' + id);
          if (row.sourceState !== 'withdrawn') await http('operator', 'POST', `/recruitment-demands/${id}/local-actions`,
            { expectedRevision: row.revision, action: 'withdraw', reason: '虚构验收结束，只撤回本轮需求' }, 201);
        }
        await archiveLocalFixture(db, f.prefix);
        await db.user.updateMany({ where: { id: f.actors.assessor.id, employeeNo: f.prefix + '_assessor' }, data: { archivedAt: new Date(), deletedAt: new Date(), status: 'resigned' } });
        await db.position.updateMany({ where: { id: f.secondPosition.id, code: f.prefix + '_B' }, data: { isActive: false } });
        await fixtures.assertProtectedBaseline(db, f.baseline);
        pass('owned_sources_closed_history_and_minio_evidence_retained_original_demands_and_payroll32_unchanged');
      }
    } finally { if (app) await app.close(); await holder.$disconnect(); await db.$disconnect(); }
  }
  process.stdout.write(JSON.stringify({ passed, fictionalOnly: true, realNestHttp: true, realPostgreSQL: true, realMinio: true,
    externalCalls: 0, cases }) + '\n');
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 240000,
    maxBuffer: 1024 * 1024, input: `(${inPreview.toString()})().catch(error=>{process.stdout.write(JSON.stringify({case:'guarded_intake_runner_failed',name:error.name,code:error.code})+'\\n');process.exitCode=1;});` });
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.resolve(__dirname, '../../../test-results/recruitment-intake-http'); fs.mkdirSync(directory, { recursive: true });
  const report = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
  fs.writeFileSync(report, execution.stdout || 'No intake proof returned.\n'); process.stdout.write(execution.stdout || 'No intake proof returned.\n');
  process.stdout.write(JSON.stringify({ report, exitCode: execution.status }) + '\n');
  if (execution.status !== 0 || execution.error || execution.signal) process.exitCode = 1;
}
