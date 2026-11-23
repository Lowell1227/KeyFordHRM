const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

// Standalone, after preview build: node api/test/payroll/payroll-formal-entry.integration.cjs
// Formal service context, fictional run-owned records, existing isolated PostgreSQL only.
// PAYROLL_VERIFY_CONTAINER may select only the shared preview or the task-owned verification API.
async function inPreview(guardsOnly, sourceHashes) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID, randomBytes, createHash } = require('node:crypto');
  const { readFileSync, statSync, existsSync } = require('node:fs');
  const { ConfigService } = require('@nestjs/config');
  const { VALIDATED_ENV_PROPNAME } = require('@nestjs/config/dist/config.constants');
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { PayrollAccessService } = require('./dist/src/payroll/payroll-access.service');
  const { PayrollGrantsService } = require('./dist/src/payroll/payroll-grants.service');
  const { PayrollDataService, payrollDays } = require('./dist/src/payroll/payroll-data.service');
  const { PayrollParameterReleasesService } = require('./dist/src/payroll/payroll-parameter-releases.service');
  const { PayrollSourcesService } = require('./dist/src/payroll/payroll-sources.service');
  const { PayrollBatchesService } = require('./dist/src/payroll/payroll-batches.service');
  const { PayrollExportService } = require('./dist/src/payroll/payroll-export.service');
  const { RosterSensitiveExportService } = require('./dist/src/users/roster-sensitive-export.service');
  const { fictionalDeductionsInput } = require('./dist/src/payroll/payroll-deductions-preview.fixture');
  const ExcelJS = require('exceljs');
  const officecrypto = require('officecrypto-tool');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const peer = new PrismaClient({ log: [], errorFormat: 'minimal' });
  // Nest Config v3 reads environment before plain config; this instance-only layer wins without changing it.
  const scopedConfig = values => new ConfigService({ ...values, [VALIDATED_ENV_PROPNAME]: { ...values } });
  const config = scopedConfig({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' });
  const services = client => {
    const access = new PayrollAccessService(client, config);
    return { access, grants: new PayrollGrantsService(client), data: new PayrollDataService(client, access),
      releases: new PayrollParameterReleasesService(client, access),
      batches: new PayrollBatchesService(client, access, new PayrollSourcesService()),
      exports: new PayrollExportService(client, access, new RosterSensitiveExportService(client, config)) };
  };
  const s = services(db), concurrent = services(peer);
  const runId = randomUUID(), prefix = `PFE_${runId.slice(0, 8)}`;
  const runKey = `payroll_formal_entry_run_${runId}`;
  const own = { subjects: [randomUUID(), randomUUID(), randomUUID()], department: randomUUID(), employment: randomUUID(),
    readinessRequests: Array.from({ length: 10 }, () => randomUUID()) };
  const [subjectId, otherSubjectId, contractSubjectId] = own.subjects;
  const users = Object.fromEntries(['admin', 'hr', 'manager', 'reviewer', 'approver', 'employee', 'viewer']
    .map(role => [role, randomUUID()]));
  const readinessKey = `payroll_formal_readiness:${subjectId}`;
  const userIds = Object.values(users), manifest = { own, users, readinessKey };
  // A past fictional period permits the explicit-paid check without changing the system clock.
  const month = '2025-10', payMonth = '2025-11', payDate = '2025-11-10';
  const from = `${month}-01`, to = `${month}-31`, days = payrollDays(month);
  const json = value => JSON.parse(JSON.stringify(value));
  const hash = value => {
    const sorted = input => Array.isArray(input) ? input.map(sorted) : input && typeof input === 'object'
      ? Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted(input[key])])) : input;
    return createHash('sha256').update(JSON.stringify(sorted(json(value)))).digest('hex');
  };
  const cash = value => new Prisma.Decimal(String(value)).toFixed(2);
  const date = value => new Date(`${value}T00:00:00.000Z`);
  const actor = role => ({ id: users[role], name: `${prefix}_${role}`, deptId: own.department,
    sysRole: role === 'admin' ? 'system_admin' : role === 'hr' ? 'hr' : 'employee',
    isAssessorOnly: false, canViewAll: false });
  const status = code => error => typeof error?.getStatus === 'function' && error.getStatus() === code;
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  const cases = [];
  let phase = 'isolation_guards', failed = 0, blocked = 0, registered = false, baseline, demo, environment;
  let batch, unsignedReconciliation, reconciliation, correction, ruleConfig, deductionSettings, readinessReceipt;
  let readinessService, readinessRequest, readinessAttempt = 0;
  const check = async (name, work) => { phase = name; await work(); cases.push(name); emit(name, 1); };
  const latest = async row => (await s.batches.detail(row.id, actor('hr'))).versions[0];
  const calculate = row => s.batches.calculate(row.id, { expectedVersion: row.version, payDate }, actor('hr'));
  const submit = row => s.batches.submit(row.id, { expectedVersion: row.version }, actor('hr'));
  const decide = (row, role, decision = 'approve') => s.batches.decide(row.id,
    { expectedVersion: row.version, decision, note: `${prefix}:fictional-${decision}` }, actor(role));
  const create = (purpose, extra = {}) => s.batches.create({ subjectId, month, payMonth, purpose, ...extra }, actor('hr'));
  const grant = async (role, capabilities, payer = subjectId, expectedUpdatedAt = null) => s.grants.save({
    subjectId: payer, userId: users[role], capabilities, expectedUpdatedAt, reason: `${prefix}:fictional-grant`,
  }, actor('admin'));
  async function publish(kind, parameter) {
    assert.equal(parameter.status, 'draft');
    const release = await s.releases.submit(kind, parameter.id, parameter.version, actor('hr'));
    assert.equal(release.reviewerId, users.manager);
    await assert.rejects(() => s.releases.decide(release.id,
      { expectedVersion: release.attempt, decision: 'approve', note: 'fictional self review' }, actor('hr')), status(403));
    await s.releases.decide(release.id,
      { expectedVersion: release.attempt, decision: 'approve', note: `${prefix}:fictional-manager-review` }, actor('manager'));
    return release;
  }
  async function saveRule(configValue = ruleConfig, payer = subjectId) {
    return s.data.saveRule({ subjectId: payer, effectiveFrom: from, effectiveTo: to, config: json(configValue) }, actor('hr'));
  }
  async function acceptReconciliation() {
    unsignedReconciliation = await calculate(unsignedReconciliation);
    const before = await finances(), batchHash = hash(await db.payrollBatch.findUniqueOrThrow({ where: { id: unsignedReconciliation.id } }));
    const requestId = own.readinessRequests[readinessAttempt++]; assert.ok(requestId);
    let detail = await readinessService.submit({ batchId: unsignedReconciliation.id, expectedVersion: unsignedReconciliation.version,
      firstMonth: month, reference: 'Fictional signed acceptance', requestId }, actor('hr'));
    readinessRequest = detail.request;
    const input = { expectedVersion: readinessRequest.version, decision: 'approve', note: 'Fictional independent acceptance' };
    await assert.rejects(() => readinessService.decide(requestId, input, actor('hr')), status(403));
    await assert.rejects(() => readinessService.decide(requestId, input, actor('approver')), status(403));
    detail = await readinessService.decide(requestId, input, actor('reviewer'));
    assert.equal(detail.request.status, 'pending');
    assert.notEqual((await db.systemConfig.findUnique({ where: { key: readinessKey } }))?.value?.state, 'approved');
    detail = await readinessService.decide(requestId, { ...input, expectedVersion: detail.request.version }, actor('approver'));
    readinessRequest = detail.request; assert.equal(readinessRequest.status, 'approved');
    readinessReceipt = (await db.systemConfig.findUniqueOrThrow({ where: { key: readinessKey } })).value;
    assert.equal(readinessReceipt.requestId, requestId); assert.equal(readinessReceipt.approvedById, users.approver);
    assert.deepEqual(await finances(), before);
    assert.equal(hash(await db.payrollBatch.findUniqueOrThrow({ where: { id: unsignedReconciliation.id } })), batchHash);
  }
  async function withoutReadiness(work) {
    await readinessService.revoke(readinessRequest.id, { expectedVersion: readinessRequest.version,
      note: 'Fictional acceptance requires recheck' }, actor('approver'));
    readinessReceipt = (await db.systemConfig.findUniqueOrThrow({ where: { key: readinessKey } })).value;
    assert.equal(readinessReceipt.state, 'revoked');
    try { await work(); } finally { await acceptReconciliation(); }
  }
  async function authorizationRace(kind, reverse) {
    const { lockPayrollSubject } = require('./dist/src/payroll/payroll-transaction');
    const { PayrollReadinessService } = require('./dist/src/payroll/payroll-readiness.service');
    const connect = suffix => {
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.set('connection_limit', '1');
      url.searchParams.set('application_name', `${prefix}_${kind}_${reverse ? 'reverse' : 'forward'}_${suffix}`);
      return new PrismaClient({ datasourceUrl: url.toString(), log: [], errorFormat: 'minimal' });
    };
    const holder = connect('holder'), revoker = connect('revoker'), creator = connect('creator');
    const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
    let release, held, releaseUser, userWritten;
    const releaseLock = new Promise(resolve => { release = resolve; });
    const lockHeld = new Promise(resolve => { held = resolve; });
    const userMayCommit = new Promise(resolve => { releaseUser = resolve; });
    const userHasWritten = new Promise(resolve => { userWritten = resolve; });
    let holding, revoking, creating, writerFinished;
    const originalGrant = await db.payrollGrant.findUniqueOrThrow({ where: { userId_subjectId: { userId: users.hr, subjectId } } });
    const originalStatus = (await db.user.findUniqueOrThrow({ where: { id: users.hr }, select: { status: true } })).status;
    async function waitForBlock(pid, blockingPid, advisory, observeWriter = false) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (observeWriter && writerFinished) {
          if (writerFinished.error) throw writerFinished.error;
          emit('authorization_race_writer_committed_before_prior_operation', 1);
          assert.fail('Authority change must wait for the already authorized operation');
        }
        const [state] = await db.$queryRaw`SELECT wait_event_type, wait_event,
          ${blockingPid}::integer = ANY(pg_blocking_pids(pid)) AS blocked_by_expected
          FROM pg_stat_activity WHERE datname = current_database() AND pid = ${pid}::integer`;
        if (state?.wait_event_type === 'Lock' && (!advisory || state.wait_event === 'advisory') && state.blocked_by_expected) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      emit('authorization_race_expected_lock_queue_missing', 0);
      throw new Error('Run-owned advisory queue was not established');
    }
    function startWriter() {
      let work;
      if (kind === 'receipt') {
        const service = new PayrollReadinessService(revoker, new PayrollAccessService(revoker, config), new PayrollSourcesService());
        work = service.revoke(readinessRequest.id, { expectedVersion: readinessRequest.version,
          note: 'Fictional deterministic revocation race' }, actor('approver'));
      } else if (kind === 'user_inactive') {
        // Personnel writes need not know payroll locks; test the real user-row conflict directly.
        work = revoker.$transaction(async tx => {
          await tx.user.update({ where: { id: users.hr }, data: { status: 'resigned' } });
          userWritten(); if (!reverse) await userMayCommit;
        }, { isolationLevel: 'ReadCommitted', timeout: 45000 });
      } else {
        const service = new PayrollGrantsService(revoker);
        const expectedUpdatedAt = originalGrant.updatedAt.toISOString();
        work = kind === 'grant_revoke'
          ? service.revoke(originalGrant.id, { expectedUpdatedAt, reason: 'Fictional deterministic grant revoke' }, actor('admin'))
          : service.save({ subjectId, userId: users.hr, expectedUpdatedAt,
            capabilities: originalGrant.capabilities.filter(value => value !== 'payroll_edit'),
            reason: 'Fictional deterministic capability removal' }, actor('admin'));
      }
      revoking = outcome(work).then(result => { writerFinished = result; return result; });
    }
    try {
      const pids = [];
      for (const client of [holder, revoker, creator]) {
        const [identity] = await client.$queryRaw`SELECT current_database() AS db, current_user AS role, pg_backend_pid() AS pid`;
        assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview'); pids.push(identity.pid);
      }
      assert.equal(new Set(pids).size, 3);
      const before = await finances(), batchesBefore = await db.payrollBatch.count({ where: { subjectId, purpose: 'formal' } });
      const decisionsBefore = await db.payrollDecision.count({ where: { version: { batch: { subjectId } } } });
      holding = outcome(holder.$transaction(async tx => {
        if (reverse) {
          // Pause create at its FK write, after authorization locks, without taking its advisory lock.
          await tx.$queryRaw`SELECT "id" FROM "contract_subjects" WHERE "id" = ${subjectId}::uuid FOR UPDATE`;
        } else await lockPayrollSubject(tx, subjectId, 'formal');
        held(); await releaseLock;
      }, { isolationLevel: 'ReadCommitted', timeout: 45000 }));
      await Promise.race([lockHeld, holding.then(result => { throw result.error ?? new Error('Lock holder ended early'); })]);
      const startCreate = () => { creating = outcome(services(creator).batches.create({ subjectId, month, payMonth, purpose: 'formal' }, actor('hr'))); };
      if (reverse) {
        startCreate(); await waitForBlock(pids[2], pids[0], false);
        startWriter(); await waitForBlock(pids[1], pids[2], kind !== 'user_inactive', true);
      } else {
        startWriter();
        if (kind === 'user_inactive') {
          await Promise.race([userHasWritten, revoking.then(result => { throw result.error ?? new Error('User writer ended early'); })]);
          startCreate(); await waitForBlock(pids[2], pids[0], true);
          releaseUser(); const result = await revoking; if (result.error) throw result.error;
        } else {
          await waitForBlock(pids[1], pids[0], true);
          startCreate(); await waitForBlock(pids[2], pids[1], true);
        }
      }
      emit(`authorization_race_${kind}_${reverse ? 'operation_first' : 'revocation_first'}_lock_order_established`, 1);
      release(); assert.ok(!(await holding).error);
      const written = await revoking; if (written.error) throw written.error;
      if (kind === 'receipt') {
        assert.equal(written.value.request.status, 'revoked');
        readinessReceipt = (await db.systemConfig.findUniqueOrThrow({ where: { key: readinessKey } })).value;
        assert.equal(readinessReceipt.state, 'revoked');
      }
      const created = await creating;
      if (!reverse) {
        const code = typeof created.error?.getStatus === 'function' ? created.error.getStatus() : null;
        const serialization = created.error && (created.error.code === 'P2034' || String(created.error.code) === '40001'
          || String(created.error.meta?.code) === '40001');
        const allowed = kind === 'receipt' ? code === 409 || serialization : [401, 403, 409].includes(code);
        emit('authorization_race_stale_formal_create_committed', Number(!created.error));
        if (created.error) emit(`authorization_race_waiter_raw_${code ? `http_${code}`
          : created.error.meta?.code === '40001' || created.error.code === '40001' ? 'sqlstate_40001'
          : /^P\d{4}$/.test(created.error.code ?? '') ? created.error.code.toLowerCase() : 'unexpected'}`, 1);
        if (allowed) emit(code ? `authorization_race_waiter_rejected_http_${code}` : 'authorization_race_waiter_serialization_conflict', 1);
        assert.ok(allowed, 'Revocation must reject stale create with its specified authorization or serialization error');
      } else {
        if (created.error) throw created.error;
        assert.equal(created.value.status, 'draft');
      }
      const batchesAfter = await db.payrollBatch.count({ where: { subjectId, purpose: 'formal' } });
      emit('authorization_race_formal_batches_added', batchesAfter - batchesBefore);
      const decisionsAfter = await db.payrollDecision.count({ where: { version: { batch: { subjectId } } } });
      const factsAfter = await finances();
      emit('authorization_race_payroll_decisions_added', decisionsAfter - decisionsBefore);
      emit('authorization_race_payroll_reservations_added', factsAfter.reservations - before.reservations);
      emit('authorization_race_annual_reservations_added', factsAfter.annualReservations - before.annualReservations);
      assert.equal(batchesAfter, batchesBefore + Number(reverse));
      assert.equal(decisionsAfter, decisionsBefore); assert.deepEqual(factsAfter, before);
    } finally {
      release(); releaseUser();
      await Promise.all([holding, revoking, creating].filter(Boolean));
      for (const client of [holder, revoker, creator]) await client.$disconnect();
    }
    if (kind === 'receipt') await acceptReconciliation();
    else if (kind === 'user_inactive') await db.user.update({ where: { id: users.hr }, data: { status: originalStatus } });
    else {
      const current = await db.payrollGrant.findUniqueOrThrow({ where: { id: originalGrant.id } });
      await grant('hr', originalGrant.capabilities, subjectId, current.updatedAt.toISOString());
    }
  }
  async function frozenVersion(id) {
    return hash(await db.payrollVersion.findUniqueOrThrow({ where: { id }, include: {
      lines: { orderBy: { id: 'asc' } }, decisions: { orderBy: { step: 'asc' } },
    } }));
  }
  async function finances(payer = subjectId) {
    return { payments: await db.payrollNetPayment.count({ where: { subjectId: payer } }),
      settlements: await db.payrollSettlement.count({ where: { line: { version: { batch: { subjectId: payer } } } } }),
      reservations: await db.payrollReservation.count({ where: { subjectId: payer } }),
      annualReservations: await db.payrollNetReservation.count({ where: { subjectId: payer } }) };
  }
  async function demoDigest() {
    return hash(await db.$transaction(async tx => {
      const scope = { subjectId: { in: demo.subjectIds } };
      const result = {
        markers: await tx.systemConfig.findMany({ where: { key: { in: demo.keys } }, orderBy: { key: 'asc' } }),
        subjects: await tx.contractSubject.findMany({ where: { id: { in: demo.subjectIds } }, orderBy: { id: 'asc' } }),
        people: await tx.user.findMany({ where: { id: { in: demo.userIds } }, orderBy: { id: 'asc' }, select: {
          id: true, name: true, employeeNo: true, sysRole: true, hrCapabilities: true, status: true, directManagerId: true,
          updatedAt: true, archivedAt: true, deletedAt: true, isAssessorOnly: true,
        } }),
        employments: await tx.employmentRecord.findMany({ where: { userId: { in: demo.userIds } }, orderBy: { id: 'asc' } }),
        batches: await tx.payrollBatch.findMany({ where: scope, orderBy: { id: 'asc' }, include: {
          versions: { orderBy: { id: 'asc' }, include: {
            lines: { orderBy: { id: 'asc' }, include: { settlements: { orderBy: { id: 'asc' } }, reservation: true } },
            decisions: { orderBy: { step: 'asc' } }, exports: { orderBy: { id: 'asc' } },
            netPayments: { orderBy: { id: 'asc' } }, netReservations: { orderBy: { employeeId: 'asc' } },
          } },
        } }),
        tasks: await tx.assessmentTask.findMany({ where: { cycleId: { in: demo.cycleIds } },
          include: { gradeResult: true }, orderBy: { id: 'asc' } }),
      };
      for (const table of ['payrollGrant', 'payrollPolicy', 'payrollStandard', 'payrollDeductionProfile',
        'payrollParameterRelease', 'payrollAttendanceSnapshot', 'payrollOpeningBalance', 'payrollAdjustment', 'payrollEvent']) {
        result[table] = await tx[table].findMany({ where: scope, orderBy: { id: 'asc' } });
      }
      return result;
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 }));
  }
  async function cleanup() {
    if (!registered) return;
    await db.$transaction(async tx => {
      const marker = await tx.systemConfig.findUniqueOrThrow({ where: { key: runKey } });
      assert.equal(hash(marker.value.manifest), hash(manifest));
      assert.equal(marker.value.fictional, true);
      assert.ok(own.subjects.every(id => !demo.subjectIds.includes(id)) && userIds.every(id => !demo.userIds.includes(id)));
      const subjects = await tx.contractSubject.findMany({ where: { id: { in: own.subjects } } });
      const people = await tx.user.findMany({ where: { id: { in: userIds } } });
      assert.ok([...subjects, ...people].every(row => row.name.startsWith(`${prefix}_`)));
      assert.ok(people.every(row => row.employeeNo?.startsWith(`${prefix}_`) && !row.dingtalkId && !row.dingtalkUnionId));
      const receipt = await tx.systemConfig.findUnique({ where: { key: readinessKey } });
      if (receipt) {
        assert.ok(own.readinessRequests.includes(receipt.value.requestId));
        assert.equal(receipt.value.subjectId, subjectId);
        await tx.systemConfig.delete({ where: { key: readinessKey } });
      }
      const requestKeys = own.readinessRequests.map(id => `payroll_readiness_request:${id}`);
      const requests = await tx.systemConfig.findMany({ where: { key: { in: requestKeys } } });
      assert.ok(requests.every(row => row.value.subjectId === subjectId && row.value.submittedById === users.hr));
      await tx.systemConfig.deleteMany({ where: { key: { in: requestKeys } } });
      const subjectScope = { subjectId: { in: own.subjects } };
      const versionScope = { version: { batch: subjectScope } };
      const lineScope = { line: versionScope };
      await tx.payrollNetReservation.deleteMany({ where: subjectScope });
      await tx.payrollNetPayment.deleteMany({ where: subjectScope });
      await tx.payrollSettlement.deleteMany({ where: lineScope });
      await tx.payrollReservation.deleteMany({ where: subjectScope });
      await tx.payrollDecision.deleteMany({ where: versionScope });
      await tx.payrollExportRecord.deleteMany({ where: versionScope });
      await tx.payrollLine.deleteMany({ where: versionScope });
      await tx.payrollVersion.deleteMany({ where: { batch: subjectScope } });
      for (const table of ['payrollBatch', 'payrollEvent', 'payrollParameterRelease', 'payrollAdjustment',
        'payrollOpeningBalance', 'payrollStandard', 'payrollDeductionProfile', 'payrollPolicy', 'payrollAttendanceSnapshot', 'payrollGrant']) {
        await tx[table].deleteMany({ where: subjectScope });
      }
      await tx.employmentRecord.deleteMany({ where: { id: own.employment, userId: users.employee, contractSubjectId } });
      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { directManagerId: null } });
      await tx.user.deleteMany({ where: { id: { in: userIds }, name: { startsWith: `${prefix}_` } } });
      await tx.department.deleteMany({ where: { id: own.department, name: { startsWith: `${prefix}_` } } });
      await tx.contractSubject.deleteMany({ where: { id: { in: own.subjects }, name: { startsWith: `${prefix}_` } } });
      assert.equal(await tx.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(await tx.employmentRecord.count({ where: { id: own.employment } }), 0);
      assert.equal(await tx.department.count({ where: { id: own.department } }), 0);
      assert.equal(await tx.contractSubject.count({ where: { id: { in: own.subjects } } }), 0);
      assert.equal(await tx.systemConfig.count({ where: { key: readinessKey } }), 0);
      assert.equal(await tx.systemConfig.count({ where: { key: { in: requestKeys } } }), 0);
      // Retain a non-financial run audit marker; never retain fictional payroll facts.
      await tx.systemConfig.update({ where: { key: runKey }, data: { value: {
        fictional: true, runId, state: 'cleaned', passed: cases.length, failed, blocked, ownedRowsRemaining: 0,
      } } });
    }, { timeout: 60000 });
  }
  try {
    await check('isolation_and_build_guards', async () => {
      assert.equal(process.env.PAYROLL_ENABLED, 'true');
      assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED, 'true');
      const loaded = new Set(Object.values(require.cache).map(module => module.filename));
      for (const [file, expected] of Object.entries(sourceHashes)) {
        const source = `src/payroll/${file}`, compiled = `dist/src/payroll/${file.replace(/\.ts$/, '.js')}`;
        if (!loaded.has(require('node:path').resolve(compiled))) continue;
        phase = `compiled_${file.replace(/[^a-z0-9]/g, '_')}`;
        assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), expected);
        assert.ok(statSync(compiled).mtimeMs >= statSync(source).mtimeMs, 'build_required');
      }
      phase = 'preview_database_identity';
      const backendPids = [];
      for (const client of [db, peer]) {
        const [identity] = await client.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role, pg_backend_pid() AS pid');
        assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
        backendPids.push(identity.pid);
      }
      assert.equal(new Set(backendPids).size, 2);
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      // Prisma initializes SSL_CERT_DIR on its first connection; snapshot after that bootstrap.
      environment = hash(process.env);
      phase = 'preview_fictional_markers';
      const local = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
      assert.equal(local?.value?.fictional, true);
      const markers = await db.systemConfig.findMany({ where: { OR: [
        { key: 'local_preview_fixture_v1' }, { key: { startsWith: 'payroll_', endsWith: '_v1' } },
      ] }, orderBy: { key: 'asc' } });
      assert.equal(markers.find(row => row.key === 'payroll_preview_fixture_v1')?.value?.fictional, true);
      const fixtures = markers.filter(row => row.key !== 'local_preview_fixture_v1');
      assert.ok(fixtures.every(row => row.value?.fictional === true));
      demo = { keys: markers.map(row => row.key),
        subjectIds: [...new Set(fixtures.flatMap(row => [...(row.value.subjectIds ?? []), ...(row.value.subjectId ? [row.value.subjectId] : [])]))],
        userIds: [...new Set(fixtures.flatMap(row => [...(row.value.employeeIds ?? []), ...(row.value.employeeId ? [row.value.employeeId] : []),
          ...Object.values(row.value.actors ?? {})]))],
        cycleIds: [...new Set(fixtures.flatMap(row => row.value.cycleIds ?? []))] };
      assert.ok(demo.subjectIds.length > 0 && demo.userIds.length > 0);
      demo.keys.push(...demo.subjectIds.map(id => `payroll_formal_readiness:${id}`));
      phase = 'preview_reconciliation_migration';
      const constraints = await db.$queryRawUnsafe("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'payroll_batches'::regclass AND contype = 'c'");
      assert.ok(constraints.some(row => row.definition.includes('reconciliation')), 'reconciliation_migration_required');
      phase = 'formal_domain_configuration';
      assert.equal(s.access.maintenancePurpose(), 'formal');
      assert.equal(typeof s.access.assertFormalPayrollReady, 'function');
      assert.equal(await s.access.assertDomain(db, 'reconciliation'), 'formal');
      const closed = new PayrollAccessService(db, scopedConfig({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'false', HRM_PREVIEW: 'false' }));
      await assert.rejects(() => closed.assertDomain(db, 'reconciliation'), status(403));
      await assert.rejects(() => closed.assertDomain(db, 'formal'), status(403));
      phase = 'original_demo_baseline';
      baseline = await demoDigest();
    });
    if (guardsOnly) return;
    await check('run_owned_fictional_identities', async () => {
      await db.$transaction(async tx => {
        await tx.systemConfig.create({ data: { key: runKey, value: { fictional: true, runId, manifest, state: 'running' } } });
        for (const [index, id] of own.subjects.entries()) await tx.contractSubject.create({ data: { id, name: `${prefix}_subject_${index}` } });
        await tx.department.create({ data: { id: own.department, name: `${prefix}_department` } });
        for (const [role, id] of Object.entries(users)) await tx.user.create({ data: {
          id, name: `${prefix}_${role}`, employeeNo: `${prefix}_${role}`, deptId: own.department, status: 'active',
          accountType: role === 'employee' ? 'employee' : 'service', sysRole: actor(role).sysRole,
        } });
        await tx.user.update({ where: { id: users.hr }, data: { directManagerId: users.manager } });
        await tx.employmentRecord.create({ data: { id: own.employment, userId: users.employee, employeeNo: `${prefix}_employee`,
          deptId: own.department, contractSubjectId, effectiveFrom: date(from), effectiveTo: date(to), entryDate: date(from),
          employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_formal_integration', createdById: users.hr } });
      }, { timeout: 60000 });
      registered = true;
      await grant('hr', ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit']);
      await grant('hr', ['payroll_view', 'payroll_edit'], otherSubjectId);
      await grant('hr', ['payroll_view'], contractSubjectId);
      await grant('reviewer', ['payroll_review']);
      await grant('approver', ['payroll_approve', 'payroll_export', 'payroll_settle']);
    });
    await check('live_grants_stale_concurrency_revocation_and_no_admin_salary', async () => {
      await assert.rejects(() => grant('admin', ['payroll_view']), status(403));
      await assert.rejects(() => s.data.employees(subjectId, month, actor('admin')), status(403));
      await assert.rejects(() => s.grants.save({ subjectId, userId: users.viewer, capabilities: ['payroll_view'],
        expectedUpdatedAt: null, reason: 'fictional nonadmin' }, actor('hr')), status(403));
      const first = await grant('viewer', ['payroll_view']);
      const outcomes = await Promise.allSettled([s.grants, concurrent.grants].map((service, index) => service.save({
        subjectId, userId: users.viewer, capabilities: ['payroll_view'], expectedUpdatedAt: first.updatedAt,
        reason: `${prefix}:fictional-concurrent-${index}`,
      }, actor('admin'))));
      assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(row => row.status === 'rejected' && status(409)(row.reason)).length, 1);
      const current = outcomes.find(row => row.status === 'fulfilled').value;
      await assert.rejects(() => grant('viewer', ['payroll_view'], subjectId, first.updatedAt), status(409));
      await s.data.employees(subjectId, month, actor('viewer'));
      await s.grants.revoke(current.id, { expectedUpdatedAt: current.updatedAt, reason: `${prefix}:fictional-revoke` }, actor('admin'));
      await assert.rejects(() => s.data.employees(subjectId, month, actor('viewer')), status(403));
      assert.ok((await s.grants.events(current.id, actor('admin'))).some(row => row.action === 'grant_revoked'));
    });
    await check('formal_scope_requires_review_not_contract_inference', async () => {
      assert.deepEqual(await s.data.employees(contractSubjectId, month, actor('hr')), []);
      assert.deepEqual(await s.data.employees(subjectId, month, actor('hr')), []);
      ruleConfig = { employeeScope: { employeeIds: [users.employee], evidenceRef: `${prefix}:fictional-payer-assignment` },
        fixedSalaryBasis: 'monthly_workdays', workCalendars: { [month]: { sourceVersion: `${prefix}:calendar-v1`,
          evidenceRef: 'fictional calendar, not a statutory calendar', days: days.map((workDate, index) => ({ workDate, units: index < 20 ? '1' : '0' })) } },
        rounding: 'item_half_up', cutoverMonth: month, monthlyUnits: {}, normalHourly: null, paidHourly: {}, overtime: {},
        reviewers: [users.reviewer], approvers: [users.approver], performance: { [month]: {
          sourceKind: 'manual', cycleIds: [], coefficients: {}, manualAmounts: { [users.employee]: '1234.56' },
          evidenceRef: `${prefix}:fictional-manual-amount`,
        } } };
      const draft = await saveRule();
      assert.deepEqual(await s.data.employees(subjectId, month, actor('hr')), []);
      const release = await publish('rule', draft);
      assert.equal(release.domain, 'formal');
      const visible = await s.data.employees(subjectId, month, actor('hr'));
      assert.equal(visible.length, 1); assert.equal(visible[0].id, users.employee);
      assert.deepEqual(await s.data.employees(contractSubjectId, month, actor('hr')), []);
      const assigned = await s.releases.list(subjectId, actor('manager'));
      assert.ok(assigned.some(row => row.id === release.id));
      await assert.rejects(() => s.data.employees(subjectId, month, actor('manager')), status(403));
      const overlap = await saveRule(ruleConfig, otherSubjectId);
      const pending = await s.releases.submit('rule', overlap.id, overlap.version, actor('hr'));
      await assert.rejects(() => s.releases.decide(pending.id,
        { expectedVersion: pending.attempt, decision: 'approve', note: 'fictional overlapping payer' }, actor('manager')), status(409));
      assert.equal((await db.payrollPolicy.findUniqueOrThrow({ where: { id: overlap.id } })).status, 'pending');
    });
    await check('unsigned_reconciliation_missing_sources_suspend_without_defaults', async () => {
      unsignedReconciliation = await calculate(await create('reconciliation'));
      const version = await latest(unsignedReconciliation);
      assert.equal(version.gross, null); assert.ok(version.issues.length > 0);
      await assert.rejects(() => submit(unsignedReconciliation), status(409));
      assert.deepEqual(await finances(), { payments: 0, settlements: 0, reservations: 0, annualReservations: 0 });
      await assert.rejects(() => s.data.saveStandard({ subjectId: otherSubjectId, employeeId: users.employee,
        effectiveFrom: from, fixedMonthly: '10000', performanceBase: null, performanceMode: 'additional', evidence: 'fictional out of scope' }, actor('hr')), status(400));
    });
    await check('standards_and_deductions_are_manager_approved', async () => {
      await publish('standard', await s.data.saveStandard({ subjectId, employeeId: users.employee, effectiveFrom: from,
        effectiveTo: to, fixedMonthly: '10000', performanceBase: null, performanceMode: 'additional', evidence: `${prefix}:fictional-fixed-standard` }, actor('hr')));
      const facts = fictionalDeductionsInput({ subjectId, employeeId: users.employee, month, payDate, gross: '0' });
      const { subjectId: _subject, employeeId: _employee, payDate: _date, gross: _gross, ...settings } = facts;
      const { subjectId: _openingSubject, employeeId: _openingEmployee, year: _year, ...opening } = settings.tax.opening;
      settings.tax.opening = opening;
      settings.ledger = { startDate: '2025-01-01', priorInPayMonth: Object.fromEntries(Object.keys(settings.tax.current).map(key => [key, '0'])),
        priorSocialInsurance: '0', priorHousingFund: '0' };
      deductionSettings = json(settings);
      await publish('deduction', await s.data.saveDeductions({ subjectId, employeeId: users.employee, payDate, settings }, actor('hr')));
      for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) await s.data.confirmOpening({
        subjectId, employeeId: users.employee, month, itemCode, amount: '0', reference: `${prefix}:fictional-confirmed-opening`,
      }, actor('approver'));
    });
    await check('raw_formal_sync_rejected_verified_callback_atomic_and_sealed', async () => {
      const input = { subjectId, month, sourceKey: `${prefix}:verified-v1`, complete: true, input: { month,
        expected: days.map((workDate, index) => ({ employeeId: users.employee, workDate, required: index < 20, units: index < 20 ? '1' : '0' })),
        records: days.slice(0, 20).map(workDate => ({ sourceId: `${prefix}:${workDate}`, sourceVersion: 1, employeeId: users.employee,
          workDate, startsAt: `${workDate}T08:00:00+08:00`, endsAt: `${workDate}T16:00:00+08:00`, type: 'normal', state: 'effective', hours: '8', unit: 'hour' })),
      } };
      await assert.rejects(() => s.data.sync(input, actor('hr')), status(403));
      await assert.rejects(() => s.data.syncVerified(input, actor('hr')), status(403));
      const sentinel = new Error('fictional verification failure');
      await assert.rejects(() => s.data.syncVerified(input, actor('hr'), async tx => {
        await tx.payrollEvent.create({ data: { subjectId, action: 'fixture_callback_probe', actorId: users.hr, metadata: { fictional: true } } });
        throw sentinel;
      }), error => error === sentinel);
      assert.equal(await db.payrollEvent.count({ where: { subjectId, action: 'fixture_callback_probe' } }), 0);
      assert.equal(await db.payrollAttendanceSnapshot.count({ where: { subjectId } }), 0);
      const trustedEvidence = { fictional: true, runId, requestHash: hash(input.input), complete: true, source: 'test-only-trusted-callback' };
      const callback = async tx => { assert.equal(await tx.user.count({ where: { id: users.employee } }), 1); return json(trustedEvidence); };
      const snapshot = await s.data.syncVerified(input, actor('hr'), callback);
      assert.deepEqual(snapshot.payload.dingtalk, trustedEvidence);
      assert.equal(snapshot.domain, 'formal');
      assert.equal((await s.data.syncVerified(input, actor('hr'), callback)).id, snapshot.id);
      await assert.rejects(() => s.data.syncVerified({ ...input, input: { ...input.input, records: [] } }, actor('hr'), callback), status(409));
      await s.data.review(snapshot.id, { note: `${prefix}:fictional-attendance-checked` }, actor('hr'));
      const sealed = await s.data.seal(snapshot.id, snapshot.version, actor('hr'));
      assert.equal(sealed.status, 'sealed'); assert.ok(sealed.sealedHash);
      assert.equal(await db.payrollAttendanceSnapshot.count({ where: { subjectId } }), 1);
    });
    await check('missing_readiness_blocks_formal_but_not_complete_reconciliation', async () => {
      assert.equal(await db.systemConfig.findUnique({ where: { key: readinessKey } }), null);
      await assert.rejects(() => s.access.assertFormalPayrollReady(db, subjectId, month), status(409));
      await assert.rejects(() => create('formal'), status(409));
      unsignedReconciliation = await calculate(unsignedReconciliation);
      const version = await latest(unsignedReconciliation);
      assert.deepEqual(version.issues, []); assert.equal(version.netSnapshot.totals.net, '9931.10');
      unsignedReconciliation = await calculate(unsignedReconciliation);
      assert.equal(await db.payrollBatch.count({ where: { subjectId, purpose: 'formal' } }), 0);
      assert.deepEqual(await finances(), { payments: 0, settlements: 0, reservations: 0, annualReservations: 0 });
      assert.equal(await db.systemConfig.findUnique({ where: { key: readinessKey } }), null);
    });
    await check('reconciliation_uses_formal_sources_without_financial_side_effects', async () => {
      const before = await finances();
      reconciliation = await calculate(await create('reconciliation'));
      const first = await latest(reconciliation);
      assert.equal(first.netSnapshot.domain, 'formal'); assert.deepEqual(first.issues, []);
      assert.equal(first.netSnapshot.totals.net, '9931.10');
      const results = await Promise.allSettled([s.batches, concurrent.batches].map(service => service.calculate(reconciliation.id,
        { expectedVersion: reconciliation.version, payDate }, actor('hr'))));
      assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal(results.filter(row => row.status === 'rejected' && status(409)(row.reason)).length, 1);
      reconciliation = results.find(row => row.status === 'fulfilled').value;
      reconciliation = await calculate(reconciliation);
      assert.deepEqual(await finances(), before);
      assert.ok((await s.batches.list(subjectId, actor('hr'), month)).some(row => row.id === reconciliation.id));
      await assert.rejects(() => s.batches.detail(reconciliation.id, actor('reviewer')), status(403));
      await assert.rejects(() => s.batches.create({ subjectId, month, payMonth, purpose: 'reconciliation', correctionOfId: unsignedReconciliation.id }, actor('hr')), status(400));
    });
    await check('reconciliation_all_approval_export_and_payment_outlets_reject', async () => {
      const before = await finances(), version = await latest(reconciliation);
      const expectedVersion = reconciliation.version, lineId = version.lines[0].id;
      await assert.rejects(() => submit(reconciliation), status(409));
      await assert.rejects(() => decide(reconciliation, 'reviewer'), status(409));
      await assert.rejects(() => s.batches.withdraw(reconciliation.id, { expectedVersion, note: 'fictional' }, actor('hr')), status(409));
      await assert.rejects(() => s.exports.download(reconciliation.id, { expectedVersion, filePassword: randomBytes(18).toString('hex') }, actor('approver')), status(403));
      await assert.rejects(() => s.batches.netPayment(reconciliation.id, { expectedVersion, employeeId: users.employee, requestId: randomUUID(), reference: 'fictional', payDate }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.settle(reconciliation.id, { expectedVersion, lineId, requestId: randomUUID(), reference: 'fictional', amount: '1' }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.cancelRemainder(reconciliation.id, { expectedVersion, lineId, reference: 'fictional' }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.cancelNetRemainder(reconciliation.id, { expectedVersion, employeeId: users.employee, reference: 'fictional' }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.voidApproved(reconciliation.id, { expectedVersion, note: 'fictional', confirmedUnpaid: true }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.deductionsPreview(reconciliation.id, { expectedVersion, payDate }, actor('hr')), status(409));
      assert.deepEqual(await finances(), before);
      assert.equal(await db.payrollReservation.count({ where: { line: { version: { batchId: reconciliation.id } } } }), 0);
      assert.equal(await db.payrollNetReservation.count({ where: { version: { batchId: reconciliation.id } } }), 0);
      assert.equal(await db.payrollNetPayment.count({ where: { version: { batchId: reconciliation.id } } }), 0);
      assert.equal(await db.payrollExportRecord.count({ where: { version: { batchId: reconciliation.id } } }), 0);
    });
    await check('existing_preview_http_is_not_formal_readiness_ui_evidence', async () => {
      const { JwtService } = require('@nestjs/jwt');
      let token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ ...actor('hr'), sub: users.hr,
        employeeNo: `${prefix}_hr` }, { expiresIn: '2m' });
      const request = path => fetch(`http://127.0.0.1:3000/api/v1/payroll/${path}`, {
        headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      try {
        const metadata = await request('access'); assert.equal(metadata.status, 200);
        const body = await metadata.json(), actual = Object.hasOwn(body, 'data') ? body.data : body;
        assert.equal(actual.enabled, true);
        assert.ok(actual.subjects.length > 0 && actual.subjects.every(row => own.subjects.includes(row.id)));
        const readiness = await request(`readiness?subjectId=${encodeURIComponent(subjectId)}`);
        assert.equal(readiness.status, 403); await readiness.arrayBuffer();
        const endpoint = await request(`readiness/requests?subjectId=${encodeURIComponent(subjectId)}`);
        assert.ok([403, 404].includes(endpoint.status)); await endpoint.arrayBuffer();
      } finally { token = ''; }
    });
    phase = 'controlled_readiness_service_build';
    if (!sourceHashes['payroll-readiness.service.ts'] || !existsSync('dist/src/payroll/payroll-readiness.service.js')) {
      blocked++; emit('formal_workflow_pending_controlled_readiness_service', 0); return;
    }
    const { PayrollReadinessService } = require('./dist/src/payroll/payroll-readiness.service');
    const readinessFile = 'payroll-readiness.service.ts';
    assert.equal(createHash('sha256').update(readFileSync(`src/payroll/${readinessFile}`)).digest('hex'), sourceHashes[readinessFile]);
    assert.ok(statSync('dist/src/payroll/payroll-readiness.service.js').mtimeMs >= statSync(`src/payroll/${readinessFile}`).mtimeMs);
    readinessService = new PayrollReadinessService(db, s.access, new PayrollSourcesService());
    await check('controlled_independent_readiness_unlocks_only_accepted_scope', async () => {
      await acceptReconciliation();
      await s.access.assertFormalPayrollReady(db, subjectId, month);
      await assert.rejects(() => s.access.assertFormalPayrollReady(db, subjectId, '2025-09'), status(409));
      await assert.rejects(() => s.access.assertFormalPayrollReady(db, otherSubjectId, month), status(409));
      await assert.rejects(() => s.batches.create({ subjectId: otherSubjectId, month, payMonth, purpose: 'formal' }, actor('hr')), status(409));
      await assert.rejects(() => create('formal', { correctionOfId: reconciliation.id }), status(400));
      await db.user.update({ where: { id: users.approver }, data: { status: 'resigned', archivedAt: new Date() } });
      try { await s.access.assertFormalPayrollReady(db, subjectId, month); }
      finally { await db.user.update({ where: { id: users.approver }, data: { status: 'active', archivedAt: null } }); }
      assert.equal(hash((await db.systemConfig.findUniqueOrThrow({ where: { key: readinessKey } })).value), hash(readinessReceipt));
    });
    for (const kind of ['receipt', 'grant_revoke', 'capability_removed', 'user_inactive']) for (const reverse of [false, true]) {
      await check(`authorization_race_${kind}_${reverse ? 'operation_first' : 'revocation_first'}`, () => authorizationRace(kind, reverse));
    }
    await check('manual_additional_performance_full_tax_and_net', async () => {
      batch = await calculate(await create('formal'));
      const version = await latest(batch);
      assert.deepEqual(version.issues, []); assert.equal(cash(version.gross), '11234.56');
      assert.equal(cash(version.lines.find(row => row.itemCode === 'performance').amount), '1234.56');
      assert.deepEqual(version.netSnapshot.totals, { gross: '11234.56', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '1103.46', net: '9931.10' });
      assert.equal(version.netSnapshot.domain, 'formal');
      await assert.rejects(() => s.batches.detail(batch.id, actor('viewer')), status(403));
      await assert.rejects(() => s.batches.create({ subjectId: otherSubjectId, month, payMonth, purpose: 'formal' }, actor('reviewer')), status(403));
    });
    await check('revoked_readiness_blocks_formal_recalculation_and_submission', async () => {
      const before = await finances(), version = await latest(batch), frozen = await frozenVersion(version.id);
      await withoutReadiness(async () => {
        await assert.rejects(() => calculate(batch), status(409));
        await assert.rejects(() => submit(batch), status(409));
      });
      assert.deepEqual(await finances(), before);
      assert.equal(await frozenVersion(version.id), frozen);
    });
    await check('return_resubmit_preserves_versions_and_blocks_self_review', async () => {
      batch = await submit(batch);
      await assert.rejects(() => decide(batch, 'hr'), status(403));
      await assert.rejects(() => decide(batch, 'approver'), status(403));
      const returnedId = (await latest(batch)).id;
      await withoutReadiness(async () => {
        await assert.rejects(() => decide(batch, 'reviewer'), status(409));
        batch = await decide(batch, 'reviewer', 'return');
      });
      assert.equal(batch.status, 'returned');
      const frozen = await frozenVersion(returnedId);
      assert.deepEqual(await finances(), { payments: 0, settlements: 0, reservations: 0, annualReservations: 0 });
      batch = await submit(await calculate(batch));
      assert.notEqual((await latest(batch)).id, returnedId);
      assert.equal(await frozenVersion(returnedId), frozen);
      await withoutReadiness(async () => {
        batch = await s.batches.withdraw(batch.id, { expectedVersion: batch.version, note: 'fictional corrective withdrawal' }, actor('hr'));
      });
      batch = await submit(await calculate(batch));
    });
    await check('reviewed_source_change_blocks_inflight_approval', async () => {
      const pendingId = (await latest(batch)).id, frozen = await frozenVersion(pendingId);
      const settings = json(deductionSettings);
      settings.tax.evidenceRef = `${prefix}:fictional-reviewed-revision`;
      await publish('deduction', await s.data.saveDeductions({ subjectId, employeeId: users.employee, payDate, settings }, actor('hr')));
      assert.equal((await latest(batch)).needsUpdate, true);
      await assert.rejects(() => decide(batch, 'reviewer'), status(409));
      assert.equal(await frozenVersion(pendingId), frozen);
      batch = await decide(batch, 'reviewer', 'return');
      batch = await submit(await calculate(batch));
      batch = await decide(batch, 'reviewer');
      batch = await decide(batch, 'approver');
      assert.equal(batch.status, 'approved');
      assert.equal((await latest(batch)).needsUpdate, false);
    });
    await check('approved_unpaid_manual_change_blocks_export_payment_and_marks_detail', async () => {
      const original = await latest(batch), frozen = await frozenVersion(original.id), before = await finances();
      ruleConfig.performance[month].evidenceRef = `${prefix}:fictional-reviewed-manual-revision`;
      await publish('rule', await saveRule());
      assert.equal((await latest(batch)).needsUpdate, true);
      await assert.rejects(() => s.exports.download(batch.id, { expectedVersion: batch.version,
        filePassword: randomBytes(18).toString('hex') }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.netPayment(batch.id, { expectedVersion: batch.version, employeeId: users.employee,
        requestId: randomUUID(), reference: 'fictional changed unpaid source', payDate }, actor('approver')), status(409));
      assert.equal(await frozenVersion(original.id), frozen);
      assert.deepEqual(await finances(), before);
      batch = await s.batches.voidApproved(batch.id, { expectedVersion: batch.version, confirmedUnpaid: true,
        note: 'fictional changed source requires fresh approval' }, actor('approver'));
      const voided = await frozenVersion(original.id);
      batch = await decide(await submit(await calculate(batch)), 'reviewer');
      batch = await decide(batch, 'approver');
      assert.notEqual((await latest(batch)).id, original.id);
      assert.equal(await frozenVersion(original.id), voided);
    });
    await check('revoked_readiness_blocks_approved_export_and_new_payment', async () => {
      const version = await latest(batch), frozen = await frozenVersion(version.id), before = await finances();
      await withoutReadiness(async () => {
        await assert.rejects(() => s.exports.download(batch.id, { expectedVersion: batch.version,
          filePassword: randomBytes(18).toString('hex') }, actor('approver')), status(409));
        await assert.rejects(() => s.batches.netPayment(batch.id, { expectedVersion: batch.version, employeeId: users.employee,
          requestId: randomUUID(), reference: 'fictional missing acceptance', payDate }, actor('approver')), status(409));
      });
      assert.deepEqual(await finances(), before); assert.equal(await frozenVersion(version.id), frozen);
    });
    await check('approved_encrypted_excel_does_not_record_payment', async () => {
      const version = await latest(batch), frozen = await frozenVersion(version.id);
      let password = randomBytes(18).toString('hex'), encrypted, plain;
      try {
        const file = await s.exports.download(batch.id, { expectedVersion: batch.version, filePassword: password }, actor('approver'));
        const chunks = [];
        for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
        encrypted = Buffer.concat(chunks);
        assert.ok(encrypted.length > 0); assert.equal(encrypted.readUInt32LE(0), 0xe011cfd0);
        plain = Buffer.from(await officecrypto.decrypt(encrypted, { password }));
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(plain);
        assert.equal(workbook.getWorksheet('工资实发').getCell('F3').value, 11234.56);
        assert.equal(workbook.getWorksheet('工资实发').getCell('J3').value, 9931.1);
        assert.equal(workbook.getWorksheet('工资明细').getCell('I3').value, 1234.56);
        assert.ok(workbook.getWorksheet('审批依据'));
        assert.match(file.getHeaders().disposition, /payroll-formal-net-/);
      } finally { password = ''; encrypted?.fill(0); plain?.fill(0); }
      assert.equal(await frozenVersion(version.id), frozen);
      const facts = await finances(); assert.equal(facts.payments, 0); assert.equal(facts.settlements, 0);
      assert.equal(await db.payrollExportRecord.count({ where: { versionId: version.id } }), 1);
    });
    await check('revoked_export_grant_immediately_blocks_download', async () => {
      const current = (await s.grants.list({ subjectId, status: 'active' }, actor('admin'))).find(row => row.userId === users.approver);
      const revoked = await s.grants.revoke(current.id, { expectedUpdatedAt: current.updatedAt, reason: `${prefix}:fictional-export-revoke` }, actor('admin'));
      await assert.rejects(() => s.exports.download(batch.id, { expectedVersion: batch.version, filePassword: randomBytes(18).toString('hex') }, actor('approver')), status(403));
      await grant('approver', ['payroll_approve', 'payroll_export', 'payroll_settle'], subjectId, revoked.updatedAt);
    });
    await check('cross_batch_duplicate_reservations_rejected', async () => {
      const duplicate = await calculate(await create('formal'));
      const before = await finances();
      await assert.rejects(() => submit(duplicate), status(409));
      assert.deepEqual(await finances(), before);
    });
    await check('explicit_payment_is_idempotent_and_paid_history_immutable', async () => {
      const version = await latest(batch), frozen = await frozenVersion(version.id);
      const input = { expectedVersion: batch.version, employeeId: users.employee, requestId: randomUUID(), reference: `${prefix}:fictional-paid-fact`, payDate };
      const outcomes = await Promise.allSettled([s.batches, concurrent.batches].map(service => service.netPayment(batch.id, input, actor('approver'))));
      assert.ok(outcomes.every(row => row.status === 'fulfilled'));
      batch = await db.payrollBatch.findUniqueOrThrow({ where: { id: batch.id } });
      assert.equal(await db.payrollNetPayment.count({ where: { versionId: version.id } }), 1);
      assert.equal(cash((await db.payrollNetPayment.findFirstOrThrow({ where: { versionId: version.id } })).net), '9931.10');
      assert.equal(await db.payrollSettlement.count({ where: { line: { versionId: version.id } } }), 2);
      await withoutReadiness(async () => {
        await s.batches.netPayment(batch.id, input, actor('approver'));
        await assert.rejects(() => s.batches.netPayment(batch.id, { ...input, expectedVersion: batch.version,
          requestId: randomUUID() }, actor('approver')), status(409));
      });
      await assert.rejects(() => s.batches.netPayment(batch.id, { ...input, expectedVersion: batch.version, requestId: randomUUID() }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.voidApproved(batch.id, { expectedVersion: batch.version, note: 'fictional paid cannot void', confirmedUnpaid: true }, actor('approver')), status(409));
      await assert.rejects(() => s.batches.cancelNetRemainder(batch.id, { expectedVersion: batch.version, employeeId: users.employee, reference: 'fictional paid cannot cancel' }, actor('approver')), status(409));
      await assert.rejects(() => calculate(batch), status(409));
      assert.equal(await frozenVersion(version.id), frozen);
    });
    await check('approved_correction_does_not_repeat_contributions_or_overwrite_paid', async () => {
      const original = await latest(batch), frozen = await frozenVersion(original.id);
      await s.data.addAdjustment({ subjectId, employeeId: users.employee, month, itemCode: 'adjustment', amount: '500',
        reason: 'fictional late correction', reference: `${prefix}:fictional-correction-source` }, actor('hr'));
      correction = await calculate(await create('formal', { correctionOfId: batch.id }));
      const version = await latest(correction);
      assert.deepEqual(version.issues, []);
      assert.deepEqual(version.netSnapshot.totals, { gross: '500.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '50.00', net: '450.00' });
      assert.equal(cash(version.lines.find(row => row.itemCode === 'performance').amount), '0.00');
      correction = await decide(await submit(correction), 'reviewer');
      correction = await decide(correction, 'approver');
      assert.equal(correction.status, 'approved');
      assert.equal(await db.payrollNetPayment.count({ where: { subjectId } }), 1);
      assert.equal(await frozenVersion(original.id), frozen);
      assert.equal((await latest(batch)).needsUpdate, false);
      assert.equal((await latest(correction)).needsUpdate, false);
    });
    await check('paid_and_cancelled_history_skip_later_manual_source_changes', async () => {
      const paid = await latest(batch), cancelled = await latest(correction);
      const paidHash = await frozenVersion(paid.id), cancelledHash = await frozenVersion(cancelled.id);
      correction = await s.batches.cancelNetRemainder(correction.id, { expectedVersion: correction.version,
        employeeId: users.employee, reference: 'fictional cancellation retains unpaid history' }, actor('approver'));
      ruleConfig.performance[month].manualAmounts[users.employee] = '1300.00';
      await publish('rule', await saveRule());
      assert.equal((await latest(batch)).needsUpdate, false);
      assert.equal((await latest(correction)).needsUpdate, false);
      assert.equal(await frozenVersion(paid.id), paidHash);
      assert.equal(await frozenVersion(cancelled.id), cancelledHash);
      await assert.rejects(() => s.batches.netPayment(correction.id, { expectedVersion: correction.version,
        employeeId: users.employee, requestId: randomUUID(), reference: 'fictional cancelled cannot pay', payDate }, actor('approver')), status(409));
      assert.equal(await db.payrollNetPayment.count({ where: { subjectId } }), 1);
    });
  } catch (error) {
    failed++; emit(`${phase}_failed`, 0);
    const kind = typeof error?.getStatus === 'function' ? `http_${error.getStatus()}`
      : error?.code === 'ERR_ASSERTION' ? 'assertion'
      : /^P\d{4}$/.test(error?.code ?? '') ? `prisma_${error.code.toLowerCase()}`
      : error instanceof TypeError ? 'type_error' : 'unexpected';
    emit(`failure_kind_${kind}`, 1);
  } finally {
    if (registered) {
      try { await cleanup(); emit('run_owned_cleanup_and_audit_marker', 1); }
      catch { failed++; emit('run_owned_cleanup_failed', 0); }
    }
    if (baseline) {
      try { assert.equal(await demoDigest(), baseline); emit('original_demo_digest_unchanged', 1); }
      catch { failed++; emit('original_demo_digest_changed', 0); }
    }
    if (environment) {
      try { assert.equal(hash(process.env), environment); emit('process_environment_unchanged_after_prisma_bootstrap', 1); }
      catch { failed++; emit('process_environment_changed', 0); }
    }
    for (const client of [db, peer]) try { await client.$disconnect(); } catch { failed++; emit('disconnect_failed', 0); }
    emit('passed', cases.length); emit('failed', failed);
    emit('blocked', blocked);
    if (failed) process.exitCode = 1;
    else if (blocked) process.exitCode = 2;
  }
}

function launch() {
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  try {
    const args = process.argv.slice(2), guardsOnly = args.length === 1 && args[0] === '--guards-only';
    if (args.length && !guardsOnly) throw new Error();
    const containerName = process.env.PAYROLL_VERIFY_CONTAINER ?? 'hrm-api-1';
    const allowed = {
      'hrm-api-1': { project: 'hrm', service: 'api' },
      'hrm-payroll-verify-payrollverifyapi-1': { project: 'hrm-payroll-verify', service: 'payrollverifyapi' },
    };
    if (!Object.hasOwn(allowed, containerName)) throw new Error();
    const expected = allowed[containerName];
    const api = resolve(__dirname, '../..'), source = resolve(api, 'src/payroll');
    const sourceHashes = Object.fromEntries(readdirSync(source, { recursive: true }).map(file => file.replace(/\\/g, '/'))
      .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
      .map(file => [file, createHash('sha256').update(readFileSync(resolve(source, file))).digest('hex')]));
    const format = '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"cwd":{{json .Config.WorkingDir}},"mounts":{{json .Mounts}}}';
    const inspection = spawnSync('docker', ['inspect', '--format', format, containerName], { encoding: 'utf8', timeout: 10000 });
    if (inspection.status !== 0) throw new Error();
    const container = JSON.parse(inspection.stdout);
    if (container.name !== `/${containerName}` || container.project !== expected.project || container.service !== expected.service || !container.running || container.cwd !== '/app') throw new Error();
    const normalize = value => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    const mount = container.mounts.find(row => row.Destination === '/app');
    if (!mount || normalize(mount.Source) !== normalize(api)) {
      emit('preview_source_mount_mismatch', 0); process.exitCode = 1; return;
    }
    const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', containerName, 'node'], {
      input: `(${inPreview.toString()})(${guardsOnly},${JSON.stringify(sourceHashes)}).catch(() => {process.stdout.write(JSON.stringify({case:'guarded_runner_failed',count:0})+'\\n');process.exitCode=1;});`,
      encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024,
    });
    let messages = 0;
    for (const line of (execution.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      if (typeof row.case !== 'string' || !/^[a-z0-9_]+$/.test(row.case) || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error();
      emit(row.case, row.count); messages++;
    }
    if (!messages) process.exitCode = 1;
    else if (execution.status !== 0) process.exitCode = execution.status === 2 ? 2 : 1;
    if (execution.error || execution.signal) { emit('container_execution_interrupted_cleanup_unconfirmed', 0); process.exitCode = 1; }
  } catch { emit('isolated_preview_runner_refused', 0); process.exitCode = 1; }
}

if (require.main === module) launch();
