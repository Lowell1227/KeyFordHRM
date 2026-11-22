'use strict';

// Host: node api/test/payroll/payroll-lock-freshness.integration.cjs [--guards-only]
// Uses the existing preview dist, two real PG connections, and real local Excel encryption.
async function inPreview(guardsOnly) {
  const { randomUUID, randomBytes, createHash } = require('node:crypto');
  const { assertPreviewEnvironment } = require('./prisma/preview-guard.cjs');
  assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const { PrismaClient } = require('@prisma/client');
  const { ConfigService } = require('@nestjs/config');
  const { PayrollAccessService } = require('./dist/src/payroll/payroll-access.service');
  const { PayrollBatchesService } = require('./dist/src/payroll/payroll-batches.service');
  const { PayrollExportService } = require('./dist/src/payroll/payroll-export.service');
  const { RosterSensitiveExportService } = require('./dist/src/users/roster-sensitive-export.service');
  const { lockPayrollSubject, payrollHash } = require('./dist/src/payroll/payroll-transaction');
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  const check = (condition, label) => { if (!condition) { const error = new Error(); error.safeCase = label; throw error; } };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const digest = value => createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('connection_limit', '1');
  const options = { datasources: { db: { url: url.toString() } }, errorFormat: 'minimal' };
  const db = new PrismaClient({ ...options, log: [{ emit: 'event', level: 'query' }] });
  const writer = new PrismaClient({ ...options, log: [] });
  const config = new ConfigService(), access = new PayrollAccessService(db, config);
  const cipher = new RosterSensitiveExportService(db, config);
  let sourceReads = 0, batchReads = 0, observing = false;
  const sources = { capture: async () => { sourceReads++; throw new Error('Unexpected source reader'); } };
  const batches = new PayrollBatchesService(db, access, sources);
  db.$on('query', event => {
    // Observe query kind only. Never emit SQL, parameters, fixture IDs, or workbook bytes.
    if (observing && /SELECT/i.test(event.query) && /"payroll_batches"/.test(event.query)) batchReads++;
  });
  const runId = randomUUID(), prefix = `PAYLOCK-${runId.slice(0, 8)}`;
  const runKey = `payroll_lock_freshness_run_${runId}`;
  const users = Object.fromEntries(['editor', 'reviewer', 'approver', 'finance', 'employee'].map(role => [role, randomUUID()]));
  const itemCodes = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'];
  const month = '2035-11', otherMonth = '2035-12', fixedAt = new Date('2035-12-02T00:00:00Z');
  const fixtures = ['export', 'settle'].map(kind => ({ kind, subjectId: randomUUID(), batchId: randomUUID(), versionId: randomUUID(),
    lineIds: itemCodes.map(() => randomUUID()), decisionIds: [randomUUID(), randomUUID()],
    snapshotIds: [randomUUID(), randomUUID()], paymentId: randomUUID(), originalRequestId: randomUUID(),
    newRequestId: randomUUID(), grantIds: Array.from({ length: 4 }, () => randomUUID()), syncEventId: randomUUID(),
    sourceId: `lock-freshness:${runId}:${kind}` }));
  const manifest = { userIds: Object.values(users), fixtures };
  let marker, baseline, registered = false, failed = 0, passed = 0, phase = 'preview_guards';
  const actor = { id: users.finance, sysRole: 'employee', isAssessorOnly: false };
  const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

  async function guards() {
    check(process.env.PAYROLL_ENABLED === 'true' && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'payroll_preview_mode');
    for (const client of [db, writer]) {
      const [identity] = await client.$queryRaw`SELECT current_database() AS db, current_user AS role`;
      check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview', 'database_identity');
    }
    const local = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    marker = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
    check(local?.value?.fictional === true && marker?.fictional === true, 'fictional_markers');
    check(Array.isArray(marker.subjectIds) && marker.subjectIds.length >= 2 && Array.isArray(marker.employeeIds)
      && marker.employeeIds.length >= 2 && Array.isArray(marker.cycleIds) && marker.cycleIds.length > 0
      && marker.actors && Object.values(marker.actors).every(id => typeof id === 'string'), 'marker_shape');
    const people = await db.user.findMany({ where: { id: { in: marker.employeeIds } },
      select: { employeeNo: true, name: true, dingtalkId: true, dingtalkUnionId: true } });
    const actors = await db.user.findMany({ where: { id: { in: Object.values(marker.actors) } },
      select: { name: true, dingtalkId: true, dingtalkUnionId: true } });
    check(people.length === marker.employeeIds.length && people.every(row => row.employeeNo?.startsWith('PAY-DEMO-')
      && row.name.includes('\u865a\u6784') && !row.dingtalkId && !row.dingtalkUnionId), 'fictional_demo_employees');
    check(actors.length === Object.values(marker.actors).length && actors.every(row => row.name.startsWith('\u6d4b\u8bd5')
      && !row.dingtalkId && !row.dingtalkUnionId), 'fictional_marker_actors');
    check(require('./package.json').version === '0.9.2', 'compiled_package_version');
  }

  async function demoDigest() {
    return digest(await db.$transaction(async tx => {
      const scope = { subjectId: { in: marker.subjectIds } }, userIds = [...new Set([...marker.employeeIds, ...Object.values(marker.actors)])];
      return {
        markers: await tx.systemConfig.findMany({ where: { key: { in: ['local_preview_fixture_v1', 'payroll_preview_fixture_v1'] } }, orderBy: { key: 'asc' } }),
        people: await tx.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' }, select: {
          id: true, employeeNo: true, name: true, status: true, sysRole: true, hrCapabilities: true, isAssessorOnly: true,
          archivedAt: true, deletedAt: true, updatedAt: true } }),
        subjects: await tx.contractSubject.findMany({ where: { id: { in: marker.subjectIds } }, orderBy: { id: 'asc' } }),
        grants: await tx.payrollGrant.findMany({ where: scope, orderBy: { id: 'asc' } }),
        policies: await tx.payrollPolicy.findMany({ where: scope, orderBy: { id: 'asc' } }),
        standards: await tx.payrollStandard.findMany({ where: scope, orderBy: { id: 'asc' } }),
        attendance: await tx.payrollAttendanceSnapshot.findMany({ where: scope, orderBy: { id: 'asc' } }),
        openings: await tx.payrollOpeningBalance.findMany({ where: scope, orderBy: { id: 'asc' } }),
        adjustments: await tx.payrollAdjustment.findMany({ where: scope, orderBy: { id: 'asc' } }),
        batches: await tx.payrollBatch.findMany({ where: scope, orderBy: { id: 'asc' }, include: { versions: { orderBy: { id: 'asc' },
          include: { lines: { orderBy: { id: 'asc' }, include: { settlements: { orderBy: { id: 'asc' } }, reservation: true } },
            decisions: { orderBy: { step: 'asc' } }, exports: { orderBy: { id: 'asc' } } } } } }),
        events: await tx.payrollEvent.findMany({ where: scope, orderBy: { id: 'asc' } }),
        tasks: await tx.assessmentTask.findMany({ where: { cycleId: { in: marker.cycleIds } }, include: { gradeResult: true }, orderBy: { id: 'asc' } }),
      };
    }, { isolationLevel: 'RepeatableRead', timeout: 20000 }));
  }

  function payload(f, moved = false) {
    return { month: moved ? otherMonth : month, issues: [], sync: { complete: true }, days: [{ employeeId: users.employee,
      workDate: moved ? '2035-12-01' : '2035-11-30', units: '1', required: true, issues: [], records: [{ sourceId: f.sourceId,
        sourceVersion: moved ? 2 : 1, employeeId: users.employee, workDate: moved ? '2035-12-01' : '2035-11-30',
        type: 'overtime', state: 'effective', unit: 'hour', hours: '2', effectiveHours: '2', resolution: 'usable', overtimeKind: 'weekday',
        startsAt: '2035-11-30T23:00:00+08:00', endsAt: '2035-12-01T01:00:00+08:00' }] }] };
  }

  async function seed() {
    await db.$transaction(async tx => {
      await tx.systemConfig.create({ data: { key: runKey, value: { fictional: true, runId, manifest } } });
      for (const [role, id] of Object.entries(users)) await tx.user.create({ data: { id, name: `${prefix}-${role}`,
        employeeNo: `${prefix}-${role}`, status: 'active', accountType: role === 'employee' ? 'employee' : 'service', sysRole: 'employee' } });
      for (const f of fixtures) {
        await tx.contractSubject.create({ data: { id: f.subjectId, name: `${prefix}-${f.kind}` } });
        const capabilities = [['payroll_edit', 'payroll_view'], ['payroll_review'], ['payroll_approve'], ['payroll_export', 'payroll_settle']];
        for (const [index, role] of ['editor', 'reviewer', 'approver', 'finance'].entries()) await tx.payrollGrant.create({ data: {
          id: f.grantIds[index], subjectId: f.subjectId, userId: users[role], capabilities: capabilities[index], grantedById: users.editor } });
        const attendance = await tx.payrollAttendanceSnapshot.create({ data: { id: f.snapshotIds[0], subjectId: f.subjectId,
          domain: 'validation', month, version: 1, status: 'sealed', sourceKey: 'run-owned-original', sourceHash: payrollHash(payload(f)),
          payload: payload(f), sealedHash: payrollHash({ frozen: f.sourceId }), createdById: users.editor, sealedById: users.editor, sealedAt: fixedAt } });
        const frozen = { months: [{ month, sources: { subjectId: f.subjectId, month, domain: 'validation', attendance } }] };
        // Approved outlet fixtures only. This script does not claim to exercise calculation or business approval.
        await tx.payrollBatch.create({ data: { id: f.batchId, subjectId: f.subjectId, month, payMonth: otherMonth,
          purpose: 'validation', status: 'approved', version: 5, createdById: users.editor } });
        await tx.payrollVersion.create({ data: { id: f.versionId, batchId: f.batchId, version: 1, status: 'approved',
          sourceHash: payrollHash(frozen), sources: JSON.parse(JSON.stringify(frozen)), issues: [], approvalPath: [users.reviewer, users.approver],
          reviewerCount: 1, approvalStep: 2, gross: '200.00', calculatedById: users.editor, submittedById: users.editor,
          submittedAt: fixedAt, approvedAt: fixedAt,
          lines: { create: itemCodes.map((itemCode, index) => ({ id: f.lineIds[index], employeeId: users.employee,
            attributionMonth: month, itemCode, status: 'ready', entitlement: index === 0 ? '200.00' : '0.00', paidBefore: '0.00',
            amount: index === 0 ? '200.00' : '0.00', evidence: { employeeName: `${prefix}-employee`, employeeNo: `${prefix}-employee` } })) },
          decisions: { create: [users.reviewer, users.approver].map((actorId, step) => ({ id: f.decisionIds[step], step,
            actorId, action: 'approve', note: 'Run-owned frozen approval fixture' })) } } });
        await tx.payrollReservation.create({ data: { subjectId: f.subjectId, employeeId: users.employee, domain: 'validation',
          attributionMonth: month, itemCode: 'fixed', lineId: f.lineIds[0] } });
        const reference = 'Run-owned existing payment';
        await tx.payrollSettlement.create({ data: { id: f.paymentId, lineId: f.lineIds[0], requestId: f.originalRequestId,
          requestHash: payrollHash({ batchId: f.batchId, versionId: f.versionId, lineId: f.lineIds[0], amount: '50.00', reference, actorId: users.finance }),
          amount: '50.00', reference, confirmedById: users.finance } });
      }
    }, { timeout: 20000 });
    registered = true;
  }

  async function immutableDigest(f) {
    return digest({
      version: await db.payrollVersion.findUnique({ where: { id: f.versionId }, include: { lines: { orderBy: { id: 'asc' } }, decisions: { orderBy: { step: 'asc' } } } }),
      originalPayment: await db.payrollSettlement.findUnique({ where: { id: f.paymentId } }),
      originalAttendance: await db.payrollAttendanceSnapshot.findUnique({ where: { id: f.snapshotIds[0] } }),
    });
  }

  function startBlocker(f, endpointPid) {
    const held = defer();
    const state = { observed: false, committed: false, failed: false };
    const done = writer.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
      check(pid !== endpointPid, 'two_distinct_pg_connections');
      await lockPayrollSubject(tx, f.subjectId, 'validation');
      held.resolve(true);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [{ waiting }] = await tx.$queryRaw`SELECT EXISTS (
          SELECT 1 FROM pg_locks w JOIN pg_locks h ON w.locktype = h.locktype
            AND w.database IS NOT DISTINCT FROM h.database AND w.classid = h.classid
            AND w.objid = h.objid AND w.objsubid = h.objsubid
          WHERE w.locktype = 'advisory' AND w.pid = ${endpointPid} AND NOT w.granted
            AND h.pid = ${pid} AND h.granted
        ) AS waiting`;
        if (waiting) { state.observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      check(state.observed && batchReads > 0, 'outlet_read_batch_then_waited_on_subject_lock');
      await tx.payrollAttendanceSnapshot.create({ data: { id: f.snapshotIds[1], subjectId: f.subjectId, domain: 'validation',
        month: otherMonth, version: 1, status: 'draft', sourceKey: 'run-owned-cross-month', sourceHash: payrollHash(payload(f, true)),
        payload: payload(f, true), createdById: users.editor } });
      await tx.payrollEvent.create({ data: { id: f.syncEventId, subjectId: f.subjectId, actorId: users.editor,
        action: 'attendance_sync', metadata: { snapshotId: f.snapshotIds[1], version: 1 } } });
    }, { isolationLevel: 'Serializable', timeout: 10000 }).then(() => { state.committed = true; }, () => {
      state.failed = true; held.resolve(false);
    });
    return { held: held.promise, done, state };
  }

  async function scenario(f) {
    const before = await immutableDigest(f), batchBefore = await db.payrollBatch.findUnique({ where: { id: f.batchId } });
    const [{ pid }] = await db.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
    let barrier, outcome, encrypted = false, returnedFile = false;
    batchReads = 0;
    const filePassword = randomBytes(16).toString('hex');
    try {
      if (f.kind === 'export') {
        const exports = new PayrollExportService(db, access, { encryptWorkbook: async (plain, password) => {
          const result = await cipher.encryptWorkbook(plain, password);
          encrypted = true;
          barrier = startBlocker(f, pid);
          check(await barrier.held, 'export_blocker_acquired');
          observing = true; // Only the second approved transaction is observed.
          return result;
        } });
        outcome = await exports.download(f.batchId, { expectedVersion: 5, filePassword }, actor).then(file => {
          returnedFile = true;
          return { file };
        }, error => ({ error }));
      } else {
        barrier = startBlocker(f, pid);
        check(await barrier.held, 'settle_blocker_acquired');
        observing = true;
        outcome = await batches.settle(f.batchId, { expectedVersion: 5, lineId: f.lineIds[0], amount: '25.00',
          reference: 'Run-owned attempted payment', requestId: f.newRequestId }, actor).then(result => ({ result }), error => ({ error }));
      }
    } finally {
      observing = false;
      if (barrier) await barrier.done;
      if (outcome?.file) for await (const chunk of outcome.file.getStream()) if (Buffer.isBuffer(chunk)) chunk.fill(0);
    }
    check(barrier?.state.observed && barrier.state.committed && !barrier.state.failed, 'precise_lock_schedule_completed');
    if (f.kind === 'export') check(encrypted, 'real_excel_encryption_completed_before_blocker');
    emit(`${f.kind}_lock_wait_observed`, 1);
    emit(`${f.kind}_conflict_committed_before_outlet_resumed`, 1);
    const originalUnchanged = await immutableDigest(f) === before;
    check(originalUnchanged, 'original_approval_money_payment_or_attendance_changed');
    emit(`${f.kind}_original_approval_money_payment_unchanged`, 1);
    const exportCount = await db.payrollExportRecord.count({ where: { versionId: f.versionId } });
    const paymentCount = await db.payrollSettlement.count({ where: { lineId: { in: f.lineIds }, id: { not: f.paymentId } } });
    const reservationCount = await db.payrollReservation.count({ where: { subjectId: f.subjectId, lineId: f.lineIds[0] } });
    const crossMonthRejected = outcome.error?.getStatus?.() === 409 && /\u8de8\u6708/.test(outcome.error.message);
    emit(`${f.kind}_returned_file`, returnedFile ? 1 : 0);
    emit(`${f.kind}_new_export_records`, exportCount);
    emit(`${f.kind}_new_payment_records`, paymentCount);
    emit(`${f.kind}_cross_month_guard_rejected`, crossMonthRejected ? 1 : 0);
    check(reservationCount === 1, 'existing_reservation_preserved');
    if (crossMonthRejected) check(digest(await db.payrollBatch.findUnique({ where: { id: f.batchId } })) === digest(batchBefore), 'rejected_outlet_batch_unchanged');
    return crossMonthRejected && !returnedFile && exportCount === 0 && paymentCount === 0;
  }

  async function cleanup() {
    if (!registered) return;
    assertPreviewEnvironment(process.env);
    await db.$transaction(async tx => {
      const saved = await tx.systemConfig.findUnique({ where: { key: runKey } });
      const currentMarker = (await tx.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
      check(saved?.value?.fictional === true && saved.value.runId === runId && digest(saved.value.manifest) === digest(manifest), 'cleanup_manifest');
      check(fixtures.every(f => !currentMarker.subjectIds.includes(f.subjectId))
        && Object.values(users).every(id => !currentMarker.employeeIds.includes(id) && !Object.values(currentMarker.actors).includes(id)), 'cleanup_excludes_demo');
      const subjects = await tx.contractSubject.findMany({ where: { id: { in: fixtures.map(f => f.subjectId) } } });
      const people = await tx.user.findMany({ where: { id: { in: Object.values(users) } }, select: { id: true, employeeNo: true, name: true } });
      check(subjects.length === fixtures.length && subjects.every(row => row.name.startsWith(prefix + '-'))
        && people.length === Object.values(users).length && people.every(row => row.name.startsWith(prefix + '-') && row.employeeNo.startsWith(prefix + '-')), 'cleanup_exact_owned_records');
      for (const f of fixtures) {
        await tx.payrollSettlement.deleteMany({ where: { lineId: { in: f.lineIds } } });
        await tx.payrollReservation.deleteMany({ where: { subjectId: f.subjectId, lineId: { in: f.lineIds } } });
        await tx.payrollExportRecord.deleteMany({ where: { versionId: f.versionId } });
        await tx.payrollDecision.deleteMany({ where: { id: { in: f.decisionIds }, versionId: f.versionId } });
        await tx.payrollLine.deleteMany({ where: { id: { in: f.lineIds }, versionId: f.versionId } });
        await tx.payrollVersion.deleteMany({ where: { id: f.versionId, batchId: f.batchId } });
        await tx.payrollBatch.deleteMany({ where: { id: f.batchId, subjectId: f.subjectId } });
        await tx.payrollEvent.deleteMany({ where: { subjectId: f.subjectId, OR: [{ id: f.syncEventId }, { batchId: f.batchId }] } });
        await tx.payrollAttendanceSnapshot.deleteMany({ where: { id: { in: f.snapshotIds }, subjectId: f.subjectId } });
        await tx.payrollGrant.deleteMany({ where: { id: { in: f.grantIds }, subjectId: f.subjectId } });
        await tx.contractSubject.deleteMany({ where: { id: f.subjectId, name: `${prefix}-${f.kind}` } });
      }
      await tx.user.deleteMany({ where: { id: { in: Object.values(users) }, name: { startsWith: prefix + '-' } } });
      await tx.systemConfig.delete({ where: { key: runKey } });
      const remaining = await tx.user.count({ where: { id: { in: Object.values(users) } } })
        + await tx.contractSubject.count({ where: { id: { in: fixtures.map(f => f.subjectId) } } })
        + await tx.payrollBatch.count({ where: { id: { in: fixtures.map(f => f.batchId) } } })
        + await tx.payrollEvent.count({ where: { subjectId: { in: fixtures.map(f => f.subjectId) } } })
        + await tx.systemConfig.count({ where: { key: runKey } });
      check(remaining === 0, 'cleanup_zero_owned_residue');
    }, { timeout: 20000 });
    emit('owned_fixture_cleanup_complete', fixtures.length);
  }

  try {
    await guards(); emit('preview_guards', 1);
    if (guardsOnly) return;
    baseline = await demoDigest();
    phase = 'seed_owned_frozen_outlets'; await seed(); emit(phase, fixtures.length);
    for (const f of fixtures) {
      phase = `${f.kind}_lock_freshness`;
      try { if (await scenario(f)) { passed++; emit(phase + '_passed', 1); } else { failed++; emit(phase + '_failed', 0); } }
      catch (error) { failed++; emit(phase + '_failed_' + (error.safeCase ?? 'execution'), 0); }
    }
    check(sourceReads === 0, 'source_reader_not_used'); emit('source_reader_calls', sourceReads);
  } catch (error) {
    failed++; emit(phase + '_failed_' + (error.safeCase ?? 'execution'), 0);
  } finally {
    try { await cleanup(); } catch (error) { failed++; emit('cleanup_failed_' + (error.safeCase ?? 'execution'), 0); }
    if (baseline) {
      try { check(await demoDigest() === baseline, 'demo_digest'); emit('demo_digest_unchanged', 1); }
      catch { failed++; emit('demo_digest_changed', 0); }
    }
    for (const client of [db, writer]) try { await client.$disconnect(); } catch { failed++; emit('disconnect_failed', 0); }
    emit('passed', passed); emit('failed', failed);
    if (failed) process.exitCode = 1;
  }
}

function launch() {
  const { spawnSync } = require('node:child_process');
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  try {
    const args = process.argv.slice(2), guardsOnly = args.length === 1 && args[0] === '--guards-only';
    if (args.length && !guardsOnly) throw new Error();
    const format = '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"cwd":{{json .Config.WorkingDir}}}';
    const inspection = spawnSync('docker', ['inspect', '--format', format, 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
    if (inspection.status !== 0) throw new Error();
    const container = JSON.parse(inspection.stdout);
    if (container.name !== '/hrm-api-1' || container.project !== 'hrm' || container.service !== 'api' || !container.running || container.cwd !== '/app') throw new Error();
    const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      input: `(${inPreview.toString()})(${guardsOnly}).catch(() => {process.stdout.write(JSON.stringify({case:'guarded_runner_failed',count:0})+'\\n');process.exitCode=1;});`,
      encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
    });
    let messages = 0;
    for (const line of (execution.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      if (typeof row.case !== 'string' || !/^[a-z0-9_]+$/.test(row.case) || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error();
      emit(row.case, row.count); messages++;
    }
    if (!messages || execution.status !== 0) process.exitCode = 1;
    if (execution.error || execution.signal) { emit('container_execution_interrupted_cleanup_unconfirmed', 0); process.exitCode = 1; }
  } catch { emit('isolated_preview_runner_refused', 0); process.exitCode = 1; }
}

if (require.main === module) launch();
