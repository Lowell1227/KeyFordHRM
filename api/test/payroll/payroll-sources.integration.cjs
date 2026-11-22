const { execFileSync } = require('node:child_process');

// Standalone: node api/test/payroll/payroll-sources.integration.cjs after the final preview build.
async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { ConfigService } = require('@nestjs/config');
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { PayrollSourcesService } = require('./dist/src/payroll/payroll-sources.service');
  const { PayrollAccessService } = require('./dist/src/payroll/payroll-access.service');
  const { PayrollDataService, payrollDays } = require('./dist/src/payroll/payroll-data.service');
  const { PayrollBatchesService } = require('./dist/src/payroll/payroll-batches.service');
  const { readPayrollPerformance } = require('./dist/src/payroll/payroll-performance-source');
  const db = new PrismaClient({ log: [] });
  const access = new PayrollAccessService(db, new ConfigService());
  const sources = new PayrollSourcesService();
  const data = new PayrollDataService(db, access);
  const batches = new PayrollBatchesService(db, access, sources);
  const prefix = `PSPG_${randomUUID().slice(0, 8)}`;
  const own = { subject: randomUUID(), department: randomUUID(), employment: randomUUID(),
    cycles: [randomUUID(), randomUUID()], tasks: [randomUUID(), randomUUID()], appeal: randomUUID() };
  const users = Object.fromEntries(['admin', 'editor', 'reviewer', 'approver', 'employee', 'peer'].map(role => [role, randomUUID()]));
  const userIds = Object.values(users);
  const months = ['2035-01', '2035-02', '2035-03'];
  const employmentNo = `${prefix}_HIST`;
  const publishedAt = new Date('2035-04-01T08:00:00.000Z');
  const date = value => new Date(`${value}T00:00:00.000Z`);
  const actor = role => ({ id: users[role] });
  const cases = [];
  let current = 'preview-guards', guarded = false, policy, batch, blockedBatch, demoBefore;
  const record = (name, count = 1) => cases.push({ case: name, count });
  async function check(name, work, count = 1) {
    current = name;
    await work();
    record(name, count);
  }
  const json = value => JSON.parse(JSON.stringify(value));
  const cash = value => new Prisma.Decimal(String(value)).toFixed(2);
  const performanceLine = capture => {
    const lines = capture.lines.filter(line => line.employeeId === users.employee && line.itemCode === 'performance');
    assert.equal(lines.length, 1);
    return lines[0];
  };
  const total = (captures, field) => captures.reduce((sum, capture) =>
    sum.plus(String(performanceLine(capture)[field])), new Prisma.Decimal('0')).toFixed(2);
  const readResult = (employeeId = users.employee) => readPayrollPerformance(db,
    { employeeId, cycleId: own.cycles[0], registeredCycleIds: [own.cycles[0]] });
  const capture = month => db.$transaction(async tx => {
    await access.assert(tx, actor('editor'), own.subject, 'payroll_view');
    const domain = await access.assertDomain(tx, 'validation');
    return sources.capture(tx, own.subject, month, domain);
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  const quarter = async () => {
    const captures = [];
    for (const month of months) captures.push(await capture(month));
    return captures;
  };
  function complete(captures) {
    for (const captured of captures) {
      assert.deepEqual(captured.issues, []);
      assert.equal(captured.lines.length, 5);
      assert.ok(captured.lines.every(line => line.employeeId === users.employee
        && ['ready', 'not_applicable'].includes(line.status) && line.amount !== null));
      assert.ok(captured.sources.employments.length > 0);
      assert.ok(captured.sources.employments.every(row => row.contractSubjectId === own.subject
        && row.employeeNo === employmentNo && !Object.hasOwn(row.user, 'employeeNo')));
      assert.ok(captured.lines.every(line => line.evidence.employeeNo === employmentNo));
    }
  }
  const createBatch = () => batches.create({ subjectId: own.subject, month: months[2], additionalMonths: months.slice(0, 2),
    payMonth: '2035-04', purpose: 'validation' }, actor('editor'));
  const calculate = row => batches.calculate(row.id, { expectedVersion: row.version }, actor('editor'));
  const submit = row => batches.submit(row.id, { expectedVersion: row.version }, actor('editor'));
  const latest = async row => (await batches.detail(row.id, actor('editor'))).versions[0];
  const httpStatus = status => error => typeof error?.getStatus === 'function' && error.getStatus() === status;
  async function assertBlocked(month) {
    const captured = await capture(month);
    assert.equal(captured.gross, null);
    assert.ok(captured.issues.length > 0);
    assert.ok(captured.lines.every(line => line.amount === null));
    blockedBatch = await calculate(blockedBatch);
    const version = await latest(blockedBatch);
    assert.equal(version.gross, null);
    assert.ok(version.issues.length > 0);
    await assert.rejects(() => submit(blockedBatch), httpStatus(409));
    assert.equal(await db.payrollReservation.count({ where: { line: { versionId: version.id } } }), 0);
  }
  async function changePolicy(config, work) {
    try {
      await db.payrollPolicy.update({ where: { id: policy.id }, data: { config } });
      await work();
    } finally {
      await db.payrollPolicy.update({ where: { id: policy.id }, data: { config: policy.config } });
    }
  }
  async function cleanup() {
    await db.$transaction(async tx => {
      const subjects = await tx.contractSubject.findMany({ where: { id: own.subject }, select: { name: true } });
      const people = await tx.user.findMany({ where: { id: { in: userIds } }, select: { name: true } });
      const cycles = await tx.assessmentCycle.findMany({ where: { id: { in: own.cycles } }, select: { name: true } });
      const departments = await tx.department.findMany({ where: { id: own.department }, select: { name: true } });
      assert.ok([...subjects, ...people, ...cycles, ...departments].every(row => row.name.startsWith(prefix)));
      const ownedBatches = await tx.payrollBatch.findMany({ where: { subjectId: own.subject }, select: { id: true } });
      const batchIds = ownedBatches.map(row => row.id);
      const versions = await tx.payrollVersion.findMany({ where: { batchId: { in: batchIds } }, select: { id: true } });
      const versionIds = versions.map(row => row.id);
      const lines = await tx.payrollLine.findMany({ where: { versionId: { in: versionIds } }, select: { id: true } });
      const lineIds = lines.map(row => row.id);
      await tx.payrollSettlement.deleteMany({ where: { lineId: { in: lineIds } } });
      await tx.payrollReservation.deleteMany({ where: { subjectId: own.subject, lineId: { in: lineIds } } });
      await tx.payrollExportRecord.deleteMany({ where: { versionId: { in: versionIds } } });
      await tx.payrollDecision.deleteMany({ where: { versionId: { in: versionIds } } });
      await tx.payrollLine.deleteMany({ where: { id: { in: lineIds } } });
      await tx.payrollVersion.deleteMany({ where: { id: { in: versionIds } } });
      await tx.payrollBatch.deleteMany({ where: { id: { in: batchIds }, subjectId: own.subject } });
      await tx.payrollEvent.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollAdjustment.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollOpeningBalance.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollStandard.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollPolicy.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollAttendanceSnapshot.deleteMany({ where: { subjectId: own.subject } });
      await tx.payrollGrant.deleteMany({ where: { subjectId: own.subject, userId: { in: userIds } } });
      await tx.appeal.deleteMany({ where: { id: own.appeal, taskId: own.tasks[0] } });
      await tx.gradeResult.deleteMany({ where: { taskId: { in: own.tasks } } });
      await tx.assessmentTask.deleteMany({ where: { id: { in: own.tasks }, cycleId: { in: own.cycles } } });
      await tx.assessmentCycle.deleteMany({ where: { id: { in: own.cycles }, name: { startsWith: prefix } } });
      await tx.employmentRecord.deleteMany({ where: { id: own.employment, userId: users.employee } });
      await tx.user.deleteMany({ where: { id: { in: userIds }, name: { startsWith: prefix } } });
      await tx.department.deleteMany({ where: { id: own.department, name: { startsWith: prefix } } });
      await tx.contractSubject.deleteMany({ where: { id: own.subject, name: { startsWith: prefix } } });
      const remaining = await tx.user.count({ where: { id: { in: userIds } } })
        + await tx.contractSubject.count({ where: { id: own.subject } })
        + await tx.department.count({ where: { id: own.department } })
        + await tx.assessmentCycle.count({ where: { id: { in: own.cycles } } })
        + await tx.assessmentTask.count({ where: { id: { in: own.tasks } } })
        + await tx.employmentRecord.count({ where: { id: own.employment } })
        + await tx.payrollBatch.count({ where: { subjectId: own.subject } })
        + await tx.payrollEvent.count({ where: { subjectId: own.subject } });
      assert.equal(remaining, 0);
    }, { timeout: 60000 });
  }
  try {
    await check('preview-guards', async () => {
      const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
      assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
      assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional, true);
      assert.equal(process.env.PAYROLL_ENABLED, 'true');
      assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED, 'true');
      demoBefore = await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } });
      guarded = true;
    });
    await check('run-owned-fictional-fixtures', async () => {
      await db.$transaction(async tx => {
        await tx.contractSubject.create({ data: { id: own.subject, name: `${prefix}_subject` } });
        await tx.department.create({ data: { id: own.department, name: `${prefix}_department` } });
        for (const [role, id] of Object.entries(users)) await tx.user.create({ data: { id, name: `${prefix}_${role}`,
          employeeNo: `${prefix}_${role}`, deptId: own.department, status: 'active',
          accountType: ['employee', 'peer'].includes(role) ? 'employee' : 'service',
          sysRole: role === 'admin' ? 'system_admin' : role === 'editor' ? 'hr' : 'employee' } });
        await tx.employmentRecord.create({ data: { id: own.employment, userId: users.employee,
          employeeNo: employmentNo, contractSubjectId: own.subject, deptId: own.department,
          effectiveFrom: date('2035-01-01'), effectiveTo: date('2035-03-31'), entryDate: date('2035-01-01'),
          employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_source_integration', createdById: users.editor } });
        for (const [index, id] of own.cycles.entries()) await tx.assessmentCycle.create({ data: { id,
          name: `${prefix}_cycle_${index}`, type: 'quarterly', startDate: date('2035-01-01'), endDate: date('2035-03-31'),
          status: 'self_eval', workflowVersion: 2, goalWorkflowVersion: 2, notificationMode: 'off', createdBy: users.editor } });
        for (const [index, id] of own.tasks.entries()) await tx.assessmentTask.create({ data: { id, cycleId: own.cycles[0],
          employeeId: index === 0 ? users.employee : users.peer, deptId: own.department, managerId: users.reviewer,
          approverId: users.approver, status: index === 0 ? 'published' : 'confirmed', publishedAt: index === 0 ? publishedAt : null } });
        await tx.gradeResult.create({ data: { taskId: own.tasks[0], rawGrade: 'B', calibratedGrade: 'A', isPublished: true,
          publishedAt, hrCalibratedAt: date('2035-03-29'), approvedAt: date('2035-03-30') } });
        for (const [role, capabilities] of [
          ['editor', ['attendance_edit', 'attendance_seal', 'payroll_edit', 'payroll_view']],
          ['reviewer', ['payroll_review']], ['approver', ['payroll_approve', 'payroll_settle']],
        ]) await tx.payrollGrant.create({ data: { userId: users[role], subjectId: own.subject, capabilities, grantedById: users.admin } });
      }, { timeout: 60000 });
      current = 'fixture-policy-and-standard';
      const config = { rounding: 'item_half_up', cutoverMonth: months[0],
        monthlyUnits: Object.fromEntries(months.map(month => [month, '20'])),
        normalHourly: null, paidHourly: {}, overtime: {}, reviewers: [users.reviewer], approvers: [users.approver],
        performance: Object.fromEntries(months.map(month => [month,
          { cycleIds: [own.cycles[0]], sourceKind: 'fictional', coefficients: { A: '1.2', B: '1', C: '0.8', D: '0.6' } }])) };
      const draft = await data.saveRule({ subjectId: own.subject, effectiveFrom: '2035-01-01', effectiveTo: '2035-03-31', config }, actor('editor'));
      policy = await data.activate('rule', draft.id, actor('editor'));
      const standard = await data.saveStandard({ subjectId: own.subject, employeeId: users.employee,
        effectiveFrom: '2035-01-01', effectiveTo: '2035-03-31', fixedMonthly: '0', performanceBase: '2000',
        performanceMode: 'additional', evidence: 'Fictional source integration only' }, actor('editor'));
      await data.activate('standard', standard.id, actor('editor'));
      for (const month of months) {
        const expected = [], records = [];
        for (const [index, workDate] of payrollDays(month).entries()) {
          expected.push({ employeeId: users.employee, workDate, required: index < 20, units: index < 20 ? '1' : '0' });
          if (index < 20) records.push({ sourceId: `${prefix}:${workDate}`, sourceVersion: 1, employeeId: users.employee,
            workDate, startsAt: `${workDate}T08:00:00.000Z`, endsAt: `${workDate}T16:00:00.000Z`,
            type: 'normal', state: 'effective', hours: '8', unit: 'hour' });
        }
        current = 'fixture-complete-attendance-sync';
        const snapshot = await data.sync({ subjectId: own.subject, month, sourceKey: `${prefix}:${month}`,
          input: { month, complete: true, expected, records } }, actor('editor'));
        current = 'fixture-complete-attendance-seal';
        await data.seal(snapshot.id, snapshot.version, actor('editor'));
        current = 'fixture-opening-confirmation';
        for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) {
          await data.confirmOpening({ subjectId: own.subject, employeeId: users.employee, month, itemCode,
            amount: itemCode === 'performance' ? '2000' : '0', reference: `${prefix}:fictional-confirmed-opening` }, actor('approver'));
        }
      }
    });
    await check('individual-publication-before-cycle-publication', async () => {
      assert.equal((await db.assessmentCycle.findUniqueOrThrow({ where: { id: own.cycles[0] } })).status, 'self_eval');
      assert.equal((await readResult()).status, 'ready');
      assert.equal((await readResult(users.peer)).status, 'pending_publication');
    });
    await check('quarter-entitlement-confirmed-opening-and-pending-difference', async () => {
      const captures = await quarter(); complete(captures);
      assert.equal(total(captures, 'entitlement'), '7200.00');
      assert.equal(total(captures, 'paidBefore'), '6000.00');
      assert.equal(total(captures, 'amount'), '1200.00');
      for (const captured of captures) assert.equal(performanceLine(captured).amount, '400.00');
      batch = await calculate(await createBatch());
      assert.equal(cash((await latest(batch)).gross), '1200.00');
      batch = await submit(batch);
      assert.equal(batch.status, 'pending');
      assert.equal((await latest(batch)).needsUpdate, false);
    }, 3);
    await check('historical-archived-deleted-source-and-current-number-independence', async () => {
      const before = await readResult(), capturedBefore = await quarter();
      await db.user.update({ where: { id: users.employee }, data: { status: 'resigned', leaveDate: date('2035-03-31'),
        archivedAt: date('2035-04-02'), deletedAt: date('2035-04-03'), employeeNo: `${prefix}_CURRENT` } });
      assert.equal(before.status, 'ready'); assert.deepEqual(await readResult(), before);
      const after = await quarter(); complete(after);
      assert.deepEqual(after.map(row => row.sourceHash), capturedBefore.map(row => row.sourceHash));
      assert.equal((await latest(batch)).needsUpdate, false);
      await assert.rejects(() => batches.detail(batch.id, { id: users.admin, sysRole: 'system_admin', canViewAll: true }), httpStatus(403));
    });
    await check('confirmation-and-closure-preserve-payable-fingerprint', async () => {
      const before = await readResult(), capturedBefore = await quarter();
      for (const status of ['confirmed', 'closed']) {
        await db.assessmentTask.update({ where: { id: own.tasks[0] }, data: { status,
          ...(status === 'confirmed' ? { employeeConfirmedAt: date('2035-04-02') } : { closedAt: date('2035-04-03') }) } });
        if (status === 'confirmed') await db.gradeResult.update({ where: { taskId: own.tasks[0] }, data: { employeeConfirmedAt: date('2035-04-02') } });
        assert.deepEqual(await readResult(), before);
        assert.deepEqual((await quarter()).map(row => row.sourceHash), capturedBefore.map(row => row.sourceHash));
        assert.equal((await latest(batch)).needsUpdate, false);
      }
    }, 2);
    await check('grade-change-invalidates-pending-source', async () => {
      const before = await readResult();
      try {
        await db.gradeResult.update({ where: { taskId: own.tasks[0] }, data: { calibratedGrade: 'B' } });
        const after = await readResult(); assert.equal(after.status, 'ready');
        assert.notEqual(after.snapshot.version, before.snapshot.version);
        assert.equal((await latest(batch)).needsUpdate, true);
        await assert.rejects(() => batches.decide(batch.id, { expectedVersion: batch.version, decision: 'approve', note: '' }, actor('reviewer')), httpStatus(409));
      } finally { await db.gradeResult.update({ where: { taskId: own.tasks[0] }, data: { calibratedGrade: 'A' } }); }
      assert.equal((await latest(batch)).needsUpdate, false);
    });
    await check('pending-and-resolved-appeal-change-source', async () => {
      const before = await readResult();
      await db.appeal.create({ data: { id: own.appeal, taskId: own.tasks[0], cycleId: own.cycles[0], appellantId: users.employee,
        reason: 'Fictional appeal evidence', status: 'pending' } });
      assert.deepEqual(await readResult(), { status: 'in_review' });
      assert.equal((await latest(batch)).needsUpdate, true);
      const blocked = await capture(months[0]);
      assert.equal(blocked.gross, null); assert.ok(blocked.issues.length > 0);
      await db.appeal.update({ where: { id: own.appeal }, data: { status: 'resolved', finalResult: 'maintained', hrResolvedAt: date('2035-04-04') } });
      const after = await readResult(); assert.equal(after.status, 'ready');
      assert.notEqual(after.snapshot.version, before.snapshot.version);
      assert.equal((await latest(batch)).needsUpdate, true);
      batch = await batches.withdraw(batch.id, { expectedVersion: batch.version, note: 'Fictional appeal refresh' }, actor('editor'));
      batch = await submit(await calculate(batch));
      assert.equal((await latest(batch)).needsUpdate, false);
      blockedBatch = await createBatch();
    }, 2);
    await check('missing-cutover-blocks-calculation-and-submission', async () => {
      await changePolicy({ ...json(policy.config), cutoverMonth: null }, () => assertBlocked(months[0]));
    });
    await check('unconfirmed-opening-fields-block-calculation-and-submission', async () => {
      const opening = await db.payrollOpeningBalance.findUniqueOrThrow({ where: {
        subjectId_employeeId_domain_attributionMonth_itemCode: { subjectId: own.subject, employeeId: users.employee,
          domain: 'validation', attributionMonth: months[0], itemCode: 'performance' } } });
      for (const missing of [{ confirmedAt: null }, { confirmedById: null }, { reference: ' ' }]) {
        try {
          await db.payrollOpeningBalance.update({ where: { id: opening.id }, data: missing });
          assert.equal(performanceLine(await capture(months[0])).paidBefore, null);
          await assertBlocked(months[0]);
        } finally {
          await db.payrollOpeningBalance.update({ where: { id: opening.id }, data: {
            confirmedAt: opening.confirmedAt, confirmedById: opening.confirmedById, reference: opening.reference } });
        }
      }
    }, 3);
    await check('multiple-registered-cycles-block-calculation-and-submission', async () => {
      const conflict = json(policy.config);
      conflict.performance[months[0]].cycleIds = [...own.cycles];
      await changePolicy(conflict, () => assertBlocked(months[0]));
    });
    await check('real-independent-approval-and-settlement', async () => {
      for (const role of ['reviewer', 'approver']) batch = await batches.decide(batch.id,
        { expectedVersion: batch.version, decision: 'approve', note: '' }, actor(role));
      assert.equal(batch.status, 'approved');
      const version = await latest(batch);
      assert.equal(cash(version.gross), '1200.00');
      assert.equal(version.decisions.length, 2);
      assert.equal(total(await quarter(), 'amount'), '1200.00');
      const lines = version.lines.filter(line => line.itemCode === 'performance'); assert.equal(lines.length, 3);
      for (const line of lines) batch = await batches.settle(batch.id, { expectedVersion: batch.version,
        lineId: line.id, amount: cash(line.amount), reference: `${prefix}:fictional-settlement`, requestId: randomUUID() }, actor('approver'));
      assert.equal(await db.payrollSettlement.count({ where: { lineId: { in: lines.map(line => line.id) } } }), 3);
      assert.equal(await db.payrollReservation.count({ where: { subjectId: own.subject } }), 0);
    }, 3);
    await check('settled-quarter-recalculation-has-no-second-payable', async () => {
      const captures = await quarter(); complete(captures);
      assert.equal(total(captures, 'entitlement'), '7200.00');
      assert.equal(total(captures, 'paidBefore'), '7200.00');
      assert.equal(total(captures, 'amount'), '0.00');
      const recheck = await calculate(await createBatch());
      const version = await latest(recheck);
      assert.equal(cash(version.gross), '0.00'); assert.deepEqual(version.issues, []);
      assert.ok(version.lines.every(line => cash(line.amount) === '0.00'));
    });
  } catch {
    record(`failed:${current}`);
  } finally {
    if (guarded) {
      try { await cleanup(); record('owned-fixture-remaining', 0); }
      catch { record('failed:owned-fixture-cleanup'); }
      try {
        assert.deepEqual(await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }), demoBefore);
        record('demo-marker-preserved');
      } catch { record('failed:demo-marker-changed'); }
    }
    try { await db.$disconnect(); } catch { record('failed:disconnect'); }
  }
  return { cases, count: cases.length };
}

function run() {
  let result;
  try {
    const format = '{"project":"{{ index .Config.Labels "com.docker.compose.project" }}","service":"{{ index .Config.Labels "com.docker.compose.service" }}","running":{{ .State.Running }}}';
    const container = JSON.parse(execFileSync('docker', ['inspect', '--format', format, 'hrm-api-1'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }));
    if (container.project !== 'hrm' || container.service !== 'api' || container.running !== true) throw Error('guard');
    const output = execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 240000, maxBuffer: 1024 * 1024,
      input: `(${inPreview.toString()})().then(result=>process.stdout.write(JSON.stringify(result)))
        .catch(()=>{process.stdout.write(JSON.stringify({cases:[{case:'failed:preview-setup',count:1}],count:1}));});`,
    });
    result = JSON.parse(output);
    if (!Array.isArray(result.cases) || result.cases.some(row => typeof row.case !== 'string'
      || !/^[a-z0-9:-]+$/.test(row.case) || !Number.isSafeInteger(row.count) || row.count < 0)) throw Error('output');
    result = { cases: result.cases.map(row => ({ case: row.case, count: row.count })), count: result.cases.length };
  } catch {
    result = { cases: [{ case: 'failed:runner-or-guard-cleanup-unconfirmed', count: 1 }], count: 1 };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.cases.some(row => row.case.startsWith('failed:'))) process.exitCode = 1;
}

if (require.main === module) run();
