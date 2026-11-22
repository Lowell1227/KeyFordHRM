'use strict';

// Run from the host with node. Database access and HTTP stay inside hrm-api-1.
async function run(guardsOnly) {
  const { randomUUID, createHash } = require('node:crypto');
  const { PrismaClient, Prisma } = require('@prisma/client');
  const office = require('officecrypto-tool');
  const ExcelJS = require('exceljs');
  const { assertPreviewEnvironment } = require(process.cwd() + '/prisma/preview-guard.cjs');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const runId = randomUUID(), runKey = `payroll_http_run_${runId}`;
  const owned = { subjectIds: [], employeeIds: [], cycleIds: [] };
  const tokens = {}, actors = {}, itemCodes = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'];
  const base = 'http://127.0.0.1:3000/api/v1';
  let marker, baseline, markerCreated = false, failed = 0, passed = 0, phase = 'preview_guards';
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  const check = (condition, label) => { if (!condition) { const error = new Error(); error.safeCase = label; throw error; } };
  const equalMoney = (value, expected, label) => check(value !== null && value !== undefined && new Prisma.Decimal(String(value)).eq(expected), label);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const monthStart = month => new Date(`${month}-01T00:00:00.000Z`);
  const days = month => {
    const start = monthStart(month), count = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  };

  async function guarded() {
    assertPreviewEnvironment(process.env);
    check(process.env.PAYROLL_ENABLED === 'true' && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'payroll_preview_mode');
    const [identity] = await db.$queryRaw`SELECT current_database() AS db, current_user AS role`;
    check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview', 'database_identity');
    const local = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    const payroll = await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } });
    check(local?.value?.fictional === true && payroll?.value?.fictional === true, 'fictional_markers');
    const value = payroll.value;
    check(Array.isArray(value.subjectIds) && value.subjectIds.length >= 2 && Array.isArray(value.employeeIds) && value.employeeIds.length >= 2
      && Array.isArray(value.cycleIds) && value.cycleIds.length > 0 && value.month === '2026-11' && value.actors, 'payroll_marker_shape');
    const subjects = await db.contractSubject.findMany({ where: { id: { in: value.subjectIds } }, select: { name: true } });
    const employees = await db.user.findMany({ where: { id: { in: value.employeeIds } }, select: { employeeNo: true, name: true, dingtalkId: true, dingtalkUnionId: true } });
    const cycles = await db.assessmentCycle.findMany({ where: { id: { in: value.cycleIds } }, select: { name: true, notificationMode: true } });
    check(subjects.length === value.subjectIds.length && subjects.every(subject => subject.name.includes('\u865a\u6784'))
      && employees.length === value.employeeIds.length && employees.every(employee => employee.employeeNo?.startsWith('PAY-DEMO-')
        && employee.name.includes('\u865a\u6784') && !employee.dingtalkId && !employee.dingtalkUnionId)
      && cycles.length === value.cycleIds.length && cycles.every(cycle => cycle.name.includes('\u865a\u6784') && cycle.notificationMode === 'off'), 'marker_records_are_fictional');
    return value;
  }

  async function request(actor, method, path, body, expected, binary = false) {
    const response = await fetch(base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(100000),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const allowed = expected ?? [200, 201];
    const route = path.split('?')[0].split('/').filter(part => part && !/^[0-9a-f-]{36}$/i.test(part)).join('_').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    check(allowed.includes(response.status), `http_${method.toLowerCase()}_${route}_${response.status}`);
    if (binary && response.ok) {
      check(response.headers.get('content-type')?.includes('spreadsheetml'), 'excel_content_type');
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    const payload = await response.json();
    return { status: response.status, data: Object.hasOwn(payload, 'data') ? payload.data : payload };
  }
  const api = async (actor, method, path, body, expected) => {
    const data = (await request(actor, method, path, body, expected)).data;
    if (path.startsWith('/payroll/batches')) for (const batch of Array.isArray(data) ? data : [data]) {
      for (const version of batch?.versions ?? []) {
        if (version.gross !== null) check(typeof version.gross === 'string', 'http_gross_exact_decimal_string');
        for (const line of version.lines ?? []) for (const field of ['entitlement', 'paidBefore', 'amount']) {
          if (line[field] !== null) check(typeof line[field] === 'string', 'http_line_exact_decimal_string');
        }
      }
    }
    return data;
  };
  const latest = batch => { check(batch?.versions?.length > 0, 'latest_version_present'); return batch.versions[0]; };
  const immutableLines = version => version.lines.map(({ settlements, reservation, ...line }) => line).sort((a, b) => a.id.localeCompare(b.id));
  const detail = id => api('HR001', 'GET', `/payroll/batches/${id}`);
  const action = (batch, name, actor = 'HR001', input = {}) => api(actor, 'POST', `/payroll/batches/${batch.id}/${name}`,
    { expectedVersion: batch.version, ...input });
  const batchWhere = subjectId => ({ line: { version: { batch: { subjectId } } } });

  async function demoLedger() {
    return digest(await db.$transaction(async tx => ({
      openings: await tx.payrollOpeningBalance.findMany({ where: { subjectId: { in: marker.subjectIds } }, orderBy: { id: 'asc' } }),
      payments: await tx.payrollSettlement.findMany({ where: { line: { version: { batch: { subjectId: { in: marker.subjectIds } } } } }, orderBy: { id: 'asc' } }),
      reservations: await tx.payrollReservation.findMany({ where: { subjectId: { in: marker.subjectIds } },
        orderBy: [{ subjectId: 'asc' }, { employeeId: 'asc' }, { attributionMonth: 'asc' }, { itemCode: 'asc' }] }),
      tasks: await tx.assessmentTask.findMany({ where: { cycleId: { in: marker.cycleIds } }, include: { gradeResult: true }, orderBy: { id: 'asc' } }),
    })));
  }

  async function fixture(label, options = {}) {
    const subjectId = randomUUID(), employeeId = randomUUID(), months = options.months ?? [marker.month];
    const cycleId = options.performance ? randomUUID() : null;
    const start = monthStart(months[0]);
    const name = `PAY-HTTP-${runId}-${label}`;
    await db.$transaction(async tx => {
      await tx.contractSubject.create({ data: { id: subjectId, name } });
      const employeeNo = `PAYHTTP-${employeeId.replace(/-/g, '').slice(0, 20)}`;
      await tx.user.create({ data: { id: employeeId, name: `Fictional payroll HTTP ${label}`, employeeNo,
        entryDate: start, directManagerId: actors.MGR001 } });
      await tx.employmentRecord.create({ data: { userId: employeeId, employeeNo, effectiveFrom: start,
        entryDate: start, contractSubjectId: subjectId, directManagerId: actors.MGR001, employeeStatus: 'active',
        changeType: 'initial', sourceType: 'payroll_http_fixture', reason: runId, createdById: actors.HR001 } });
      for (const [actor, capabilities] of [
        ['HR001', ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit']],
        ['MGR001', ['payroll_review']], ['VP001', ['payroll_approve', 'payroll_export', 'payroll_settle']],
        ['EMP002', ['attendance_edit', 'attendance_seal']],
      ]) await tx.payrollGrant.create({ data: { userId: actors[actor], subjectId, capabilities, grantedById: actors.ADMIN } });
      if (cycleId) {
        const publishedAt = new Date();
        await tx.assessmentCycle.create({ data: { id: cycleId, name: `PAY-HTTP-${runId}-performance`, type: 'quarterly',
          startDate: start, endDate: new Date(`${months.at(-1)}-${days(months.at(-1)).length}T00:00:00Z`),
          status: 'self_eval', workflowVersion: 2, goalWorkflowVersion: 2, createdBy: actors.HR001,
          hrOwnerId: actors.HR001, notificationMode: 'off' } });
        const task = await tx.assessmentTask.create({ data: { cycleId, employeeId, managerId: actors.MGR001,
          deptHeadId: actors.MGR001, approverId: actors.VP001, status: 'published', publishedAt } });
        await tx.gradeResult.create({ data: { taskId: task.id, rawGrade: 'B', calibratedGrade: 'A', isPublished: true, publishedAt,
          hrCalibratorId: actors.HR001, hrCalibratedAt: publishedAt, approverId: actors.VP001, approvedAt: publishedAt } });
      }
      const next = { subjectIds: [...owned.subjectIds, subjectId], employeeIds: [...owned.employeeIds, employeeId],
        cycleIds: [...owned.cycleIds, ...(cycleId ? [cycleId] : [])] };
      await tx.systemConfig.update({ where: { key: runKey }, data: { value: { fictional: true, runId, ...next } } });
    }, { timeout: 20000 });
    owned.subjectIds.push(subjectId); owned.employeeIds.push(employeeId); if (cycleId) owned.cycleIds.push(cycleId);
    const config = { rounding: 'item_half_up', monthlyUnits: Object.fromEntries(months.map(month => [month, '20'])), normalHourly: '100',
      paidHourly: { unpaid_leave: '0', sick_leave: null, absence: '0' },
      overtime: { hourlyBase: '100', weekday: '1.5', restday: '2', holiday: '3' }, reviewers: [actors.MGR001], approvers: [actors.VP001],
      cutoverMonth: months[0], performance: cycleId ? Object.fromEntries(months.map(month => [month,
        { cycleIds: [cycleId], sourceKind: 'fictional', coefficients: { A: '1.2', B: '1', C: '0.8', D: '0.6' } }])) : {} };
    const standard = await api('HR001', 'POST', '/payroll/standards', { subjectId, employeeId, effectiveFrom: months[0] + '-01',
      fixedMonthly: options.fixed ?? '17400', performanceBase: options.performance ? '2000' : '0',
      performanceMode: options.performance ? 'additional' : 'none', evidence: 'Run-owned fictional integration standard' });
    await api('HR001', 'POST', `/payroll/standards/${standard.id}/activate`);
    const rule = await api('HR001', 'POST', '/payroll/rules', { subjectId, effectiveFrom: months[0] + '-01', config });
    await api('HR001', 'POST', `/payroll/rules/${rule.id}/activate`);
    for (const month of months) for (const itemCode of itemCodes) await api('VP001', 'POST', '/payroll/opening-balances', {
      subjectId, employeeId, month, itemCode, amount: options.performance && itemCode === 'performance' ? '2000' : '0',
      reference: 'Run-owned fictional financial opening confirmation',
    });
    return { subjectId, employeeId, cycleId, months, revision: 0 };
  }

  function attendanceInput(f, month, type = 'unpaid_leave', overtime = true) {
    const expected = [], records = [];
    for (const [index, workDate] of days(month).entries()) {
      const required = index < 20;
      expected.push({ employeeId: f.employeeId, workDate, required, units: required ? '1' : '0' });
      if (!required) continue;
      const add = (part, kind, from, to, hours) => records.push({ sourceId: `http:${f.employeeId}:${workDate}:${part}`,
        sourceVersion: f.revision, employeeId: f.employeeId, workDate, type: kind, state: 'effective', unit: 'hour', hours,
        startsAt: `${workDate}T${from}:00+08:00`, endsAt: `${workDate}T${to}:00+08:00`,
        ...(kind === 'overtime' ? { overtimeKind: 'weekday' } : {}) });
      if (index === 0) { add('am-first', 'normal', '08:00', '10:00', '2'); add('am-last', type, '10:00', '12:00', '2'); }
      else add('am', 'normal', '08:00', '12:00', '4');
      add('pm', 'normal', '13:00', '17:00', '4');
      if (index === 0 && overtime) add('overtime', 'overtime', '18:00', '20:00', '2');
    }
    return { month, expected, records };
  }
  async function sync(f, type = 'unpaid_leave', overtime = true, month = marker.month, complete = true) {
    f.revision++;
    const input = { subjectId: f.subjectId, month, sourceKey: `${runId}:${randomUUID()}`, complete, input: attendanceInput(f, month, type, overtime) };
    const snapshot = await api('HR001', 'POST', '/payroll/attendance/sync', input);
    check(snapshot.payload?.days?.length === days(month).length, 'natural_month_coverage');
    return { snapshot, input };
  }
  async function seal(f, type = 'unpaid_leave', overtime = true, month = marker.month) {
    const { snapshot } = await sync(f, type, overtime, month);
    check(snapshot.payload.issues.length === 0, 'attendance_no_remaining_issues');
    await api('HR001', 'POST', `/payroll/attendance/${snapshot.id}/review`, { note: 'Run-owned fictional attendance verified' });
    const sealed = await api('HR001', 'POST', `/payroll/attendance/${snapshot.id}/seal`, { expectedVersion: snapshot.version });
    check(sealed.status === 'sealed' && sealed.sealedHash, 'attendance_sealed');
    return sealed;
  }
  async function calculate(f, purpose = 'validation', correctionOfId) {
    const batch = await api('HR001', 'POST', '/payroll/batches', { subjectId: f.subjectId, month: marker.month,
      additionalMonths: f.months.filter(month => month !== marker.month), payMonth: '2026-12', purpose, ...(correctionOfId ? { correctionOfId } : {}) });
    const calculated = await action(batch, 'calculate');
    check(latest(calculated).issues.length === 0 && latest(calculated).lines.length === 5 * f.months.length, 'calculation_complete');
    return calculated;
  }
  async function approve(batch) {
    let next = await action(batch, 'submit');
    await request('VP001', 'POST', `/payroll/batches/${batch.id}/decide`, { expectedVersion: next.version, decision: 'approve', note: 'Wrong stage' }, [403]);
    next = await action(next, 'decide', 'MGR001', { decision: 'approve', note: 'Run-owned independent review' });
    next = await action(next, 'decide', 'VP001', { decision: 'approve', note: 'Run-owned independent approval' });
    check(next.status === 'approved' && latest(next).decisions.length === 2 && latest(next).approvalStep === 2, 'complete_fixed_approval_path');
    check(latest(next).decisions[0].actorId === actors.MGR001 && latest(next).decisions[1].actorId === actors.VP001, 'distinct_assigned_actors');
    return next;
  }
  async function excel(batch, expectedTotal, expectedRows = 1, actor = 'VP001') {
    const filePassword = randomUUID();
    const response = await request(actor, 'POST', `/payroll/batches/${batch.id}/export`, { expectedVersion: batch.version, filePassword }, undefined, true);
    const encrypted = response.bytes;
    check(office.isEncrypted(encrypted) && encrypted.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1', 'encrypted_workbook_required');
    let wrongRejected = false;
    try { const incorrect = await office.decrypt(encrypted, { password: randomUUID() }); incorrect.fill(0); } catch { wrongRejected = true; }
    check(wrongRejected, 'wrong_excel_password_rejected');
    const plain = Buffer.from(await office.decrypt(encrypted, { password: filePassword }));
    try {
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(plain);
      const sheet = workbook.worksheets[0];
      check(sheet && sheet.rowCount === expectedRows + 2 && sheet.getCell(1, 1).value === '\u6d4b\u8bd5\u73af\u5883', 'test_watermark_and_row_count');
      let sum = new Prisma.Decimal(0);
      for (let row = 3; row <= sheet.rowCount; row++) {
        check(sheet.getCell(row, 12).value === batch.id && sheet.getCell(row, 13).value === latest(batch).version, 'excel_fixed_batch_version');
        for (let col = 6; col <= 11; col++) check(typeof sheet.getCell(row, col).value === 'number', 'excel_numeric_values_not_formulas');
        const month = sheet.getCell(row, 4).value;
        const amounts = latest(batch).lines.filter(line => line.attributionMonth === month);
        for (const [index, code] of itemCodes.entries()) equalMoney(sheet.getCell(row, index + 6).value,
          String(amounts.find(line => line.itemCode === code).amount), 'excel_matches_approved_items');
        sum = sum.plus(sheet.getCell(row, 11).value);
      }
      equalMoney(sum.toString(), expectedTotal, 'excel_expected_total');
    } finally { plain.fill(0); encrypted.fill(0); }
  }
  async function caseRun(name, work) {
    phase = name;
    try { await work(); passed++; emit(name, 1); }
    catch (error) { failed++; emit(`${name}_failed_${error.safeCase ?? (/^P\d{4}$/.test(error.code ?? '') ? error.code.toLowerCase() : 'execution')}`, 0); }
  }

  async function cleanup() {
    if (!markerCreated) return;
    const currentMarker = await guarded();
    const manifest = await db.systemConfig.findUnique({ where: { key: runKey } });
    check(manifest?.value?.fictional === true && manifest.value.runId === runId
      && digest(manifest.value.subjectIds) === digest(owned.subjectIds) && digest(manifest.value.employeeIds) === digest(owned.employeeIds)
      && digest(manifest.value.cycleIds) === digest(owned.cycleIds), 'cleanup_ownership_manifest');
    check(owned.subjectIds.every(id => !marker.subjectIds.includes(id)) && owned.employeeIds.every(id => !marker.employeeIds.includes(id))
      && owned.cycleIds.every(id => !marker.cycleIds.includes(id)) && owned.subjectIds.every(id => !currentMarker.subjectIds.includes(id))
      && owned.employeeIds.every(id => !currentMarker.employeeIds.includes(id)) && owned.cycleIds.every(id => !currentMarker.cycleIds.includes(id)), 'cleanup_excludes_demo');
    const subjects = await db.contractSubject.findMany({ where: { id: { in: owned.subjectIds } }, select: { id: true, name: true } });
    const employees = await db.user.findMany({ where: { id: { in: owned.employeeIds } }, select: { id: true, employeeNo: true } });
    check(subjects.length === owned.subjectIds.length && subjects.every(subject => subject.name.startsWith(`PAY-HTTP-${runId}-`))
      && employees.length === owned.employeeIds.length && employees.every(employee => employee.employeeNo === `PAYHTTP-${employee.id.replace(/-/g, '').slice(0, 20)}`), 'cleanup_exact_run_records');
    await db.$transaction(async tx => {
      const inSubjects = { in: owned.subjectIds }, inEmployees = { in: owned.employeeIds }, inCycles = { in: owned.cycleIds };
      const versions = { version: { batch: { subjectId: inSubjects } } };
      await tx.payrollSettlement.deleteMany({ where: { line: versions } });
      await tx.payrollReservation.deleteMany({ where: { subjectId: inSubjects } });
      await tx.payrollExportRecord.deleteMany({ where: versions });
      await tx.payrollDecision.deleteMany({ where: versions });
      await tx.payrollLine.deleteMany({ where: versions });
      await tx.payrollVersion.deleteMany({ where: { batch: { subjectId: inSubjects } } });
      for (const model of ['payrollEvent', 'payrollBatch', 'payrollAttendanceSnapshot', 'payrollStandard', 'payrollPolicy', 'payrollOpeningBalance', 'payrollAdjustment', 'payrollGrant']) {
        await tx[model].deleteMany({ where: { subjectId: inSubjects } });
      }
      await tx.gradeResult.deleteMany({ where: { task: { cycleId: inCycles, employeeId: inEmployees } } });
      await tx.assessmentTask.deleteMany({ where: { cycleId: inCycles, employeeId: inEmployees } });
      await tx.assessmentCycle.deleteMany({ where: { id: inCycles, name: { startsWith: `PAY-HTTP-${runId}-` } } });
      await tx.employmentRecord.deleteMany({ where: { contractSubjectId: inSubjects, userId: inEmployees, sourceType: 'payroll_http_fixture', reason: runId } });
      await tx.user.deleteMany({ where: { id: inEmployees, employeeNo: { startsWith: 'PAYHTTP-' } } });
      await tx.contractSubject.deleteMany({ where: { id: inSubjects, name: { startsWith: `PAY-HTTP-${runId}-` } } });
      await tx.systemConfig.delete({ where: { key: runKey } });
    }, { timeout: 30000 });
    check(await db.contractSubject.count({ where: { id: { in: owned.subjectIds } } }) === 0
      && await db.user.count({ where: { id: { in: owned.employeeIds } } }) === 0
      && await db.payrollReservation.count({ where: { subjectId: { in: owned.subjectIds } } }) === 0
      && await db.payrollSettlement.count({ where: { line: { employeeId: { in: owned.employeeIds } } } }) === 0, 'cleanup_zero_owned_residue');
    emit('owned_records_cleaned', owned.subjectIds.length);
  }

  try {
    marker = await guarded();
    check(require(process.cwd() + '/package.json').version === '0.9.1', 'preview_package_version');
    const health = await api(null, 'GET', '/health', undefined, [200]);
    check(health.status === 'ok' && health.db === 'ok', 'preview_http_database_health');
    for (const employeeNo of ['ADMIN', 'HR001', 'MGR001', 'VP001', 'EMP001', 'EMP002', 'EMP003']) {
      const id = marker.actors[employeeNo];
      const user = id && await db.user.findUnique({ where: { id }, select: { id: true, employeeNo: true, name: true, status: true,
        deletedAt: true, archivedAt: true, dingtalkId: true, dingtalkUnionId: true, isAssessorOnly: true } });
      check(user && user.employeeNo === employeeNo && user.name.startsWith('\u6d4b\u8bd5') && user.status === 'active'
        && !user.deletedAt && !user.archivedAt && !user.dingtalkId && !user.dingtalkUnionId && !user.isAssessorOnly, 'marker_actor_identity');
      actors[employeeNo] = id;
      const login = await api(null, 'POST', '/auth/test-login', { employeeNo }, [200]);
      check(login.user?.id === id && typeof login.token === 'string' && login.token.length > 20, 'actual_http_login');
      tokens[employeeNo] = login.token;
    }
    const access = await api('HR001', 'GET', '/payroll/access');
    check(access.enabled === true && access.subjects.some(subject => marker.subjectIds.includes(subject.id)), 'payroll_http_enabled');
    baseline = await demoLedger();
    emit('preview_guards_and_http_login', 1);
    if (guardsOnly) return;
    await db.systemConfig.create({ data: { key: runKey, value: { fictional: true, runId, ...owned } } }); markerCreated = true;

    await caseRun('complete_month_seal_approve_encrypted_excel', async () => {
      const f = await fixture('full-month');
      const uncompleted = await sync(f, 'normal', true, marker.month, false);
      await request('HR001', 'POST', `/payroll/attendance/${uncompleted.snapshot.id}/seal`, { expectedVersion: uncompleted.snapshot.version }, [409]);
      const missing = await sync(f, 'missing_punch');
      check(missing.snapshot.payload.issues.length > 0, 'missing_punch_is_not_zero');
      await request('HR001', 'POST', `/payroll/attendance/${missing.snapshot.id}/seal`, { expectedVersion: missing.snapshot.version }, [409]);
      await api('HR001', 'POST', `/payroll/attendance/${missing.snapshot.id}/review`, { note: 'Missing punch requires corrected source' });
      await seal(f);
      let batch = await calculate(f); equalMoney(latest(batch).gross, '17500', 'base_calculation_expected');
      await request('VP001', 'POST', `/payroll/batches/${batch.id}/export`, { expectedVersion: batch.version, filePassword: randomUUID() }, [409]);
      batch = await approve(batch);
      await excel(batch, '17500'); await excel(batch, '17500');
      check(await db.payrollExportRecord.count({ where: { versionId: latest(batch).id } }) === 2, 'repeat_exports_audited');
      check(await db.payrollEvent.count({ where: { subjectId: f.subjectId, action: 'attendance_review' } }) >= 2
        && await db.payrollEvent.count({ where: { subjectId: f.subjectId, batchId: batch.id, action: 'final_export' } }) === 2, 'subject_scoped_business_audit');
      check(await db.payrollSettlement.count({ where: batchWhere(f.subjectId) }) === 0, 'export_does_not_confirm_payments');
    });
    await caseRun('return_recalculate_resubmit_no_old_approval', async () => {
      const f = await fixture('returned'); await seal(f);
      let batch = await calculate(f); batch = await action(batch, 'submit');
      batch = await action(batch, 'decide', 'MGR001', { decision: 'approve', note: 'First review' });
      batch = await action(batch, 'decide', 'VP001', { decision: 'return', note: 'Recheck fictional source' });
      const old = latest(batch), oldDecisions = digest(old.decisions);
      check(await db.payrollReservation.count({ where: { subjectId: f.subjectId } }) === 0, 'return_releases_claims');
      await request('HR001', 'POST', `/payroll/batches/${batch.id}/submit`, { expectedVersion: batch.version }, [409]);
      batch = await action(batch, 'calculate'); check(latest(batch).version === old.version + 1 && latest(batch).decisions.length === 0, 'new_calculation_has_no_old_approval');
      batch = await action(batch, 'submit');
      await request('VP001', 'POST', `/payroll/batches/${batch.id}/decide`, { expectedVersion: batch.version, decision: 'approve', note: 'Old review cannot apply' }, [403]);
      batch = await action(batch, 'decide', 'MGR001', { decision: 'approve', note: 'New version review' });
      batch = await action(batch, 'decide', 'VP001', { decision: 'approve', note: 'New version approval' });
      check(digest(batch.versions.find(version => version.id === old.id).decisions) === oldDecisions, 'old_decisions_preserved');
      await excel(batch, '17500');
    });
    await caseRun('pending_source_update_pauses_approval', async () => {
      const f = await fixture('source-change'); await seal(f);
      let batch = await calculate(f); batch = await action(batch, 'submit');
      const old = latest(batch), frozenSources = digest(old.sources), frozenLines = digest(immutableLines(old));
      await seal(f, 'paid_leave');
      batch = await detail(batch.id); check(latest(batch).needsUpdate === true, 'pending_needs_update_derived');
      await request('MGR001', 'POST', `/payroll/batches/${batch.id}/decide`, { expectedVersion: batch.version, decision: 'approve', note: 'Changed source must block' }, [409]);
      check(await db.payrollDecision.count({ where: { versionId: old.id } }) === 0, 'changed_source_no_approval_written');
      batch = await action(batch, 'withdraw', 'HR001', { note: 'Recalculate with corrected sealed source' });
      batch = await action(batch, 'calculate'); equalMoney(latest(batch).gross, '17700', 'late_source_new_entitlement');
      const historical = batch.versions.find(version => version.id === old.id);
      check(digest(historical.sources) === frozenSources, 'old_sources_immutable');
      check(digest(immutableLines(historical)) === frozenLines, 'old_wages_immutable');
      batch = await approve(batch); await excel(batch, '17700');
    });
    await caseRun('serial_obligation_reservation_conflict', async () => {
      const f = await fixture('serial'); await seal(f);
      const first = await calculate(f), second = await calculate(f);
      await action(first, 'submit');
      await request('HR001', 'POST', `/payroll/batches/${second.id}/submit`, { expectedVersion: second.version }, [409]);
      const claims = await db.payrollReservation.findMany({ where: { subjectId: f.subjectId }, include: { line: { select: { versionId: true } } } });
      check(claims.length === 3 && claims.every(claim => claim.employeeId === f.employeeId && claim.line.versionId === latest(first).id), 'serial_one_complete_claim_set');
      check((await detail(second.id)).status === 'calculated', 'serial_loser_rolled_back');
    });
    await caseRun('postgres_concurrent_obligation_reservation', async () => {
      const f = await fixture('concurrent'); await seal(f);
      const batches = [await calculate(f), await calculate(f)];
      const responses = await Promise.all(batches.map(batch => request('HR001', 'POST', `/payroll/batches/${batch.id}/submit`,
        { expectedVersion: batch.version }, [200, 201, 409])));
      const success = responses.map((response, index) => ({ ...response, index })).filter(response => response.status < 300);
      check(success.length === 1 && responses.filter(response => response.status === 409).length === 1, 'concurrent_one_success_one_conflict');
      const winner = batches[success[0].index], loser = batches[1 - success[0].index];
      const claims = await db.payrollReservation.findMany({ where: { subjectId: f.subjectId }, include: { line: { select: { versionId: true } } } });
      check(claims.length === 3 && claims.every(claim => claim.line.versionId === latest(winner).id), 'concurrent_no_partial_or_duplicate_claims');
      check((await detail(loser.id)).status === 'calculated' && await db.payrollVersion.count({ where: { batchId: loser.id, submittedAt: { not: null } } }) === 0, 'concurrent_loser_transaction_rolled_back');
    });
    await caseRun('settlement_idempotence_partial_cancel_delta', async () => {
      const f = await fixture('settlements', { fixed: '200' }); await seal(f, 'normal', false);
      let batch = await approve(await calculate(f)); const versionId = latest(batch).id;
      const line = latest(batch).lines.find(row => row.itemCode === 'fixed');
      const input = { expectedVersion: batch.version, lineId: line.id, amount: '150.00', reference: 'Fictional actual payment receipt', requestId: randomUUID() };
      for (const amount of ['0', '-1', '201']) await request('VP001', 'POST', `/payroll/batches/${batch.id}/settlements`, { ...input, amount }, [409]);
      batch = await api('VP001', 'POST', `/payroll/batches/${batch.id}/settlements`, input);
      await api('VP001', 'POST', `/payroll/batches/${batch.id}/settlements`, input);
      await request('VP001', 'POST', `/payroll/batches/${batch.id}/settlements`, { ...input, amount: '149' }, [409]);
      check(await db.payrollSettlement.count({ where: { requestId: input.requestId } }) === 1, 'settlement_request_idempotent');
      check(await db.payrollReservation.count({ where: { subjectId: f.subjectId } }) === 1, 'partial_payment_keeps_reservation');
      let correction = await calculate(f, 'validation', batch.id); equalMoney(latest(correction).gross, '50', 'only_confirmed_paid_reduces_delta');
      await request('HR001', 'POST', `/payroll/batches/${correction.id}/submit`, { expectedVersion: correction.version }, [409]);
      batch = await action(batch, 'cancel-remainder', 'VP001', { lineId: line.id, reference: 'Fictional cancellation of unpaid remainder' });
      equalMoney(latest(batch).lines.find(row => row.id === line.id).amount, '200', 'cancel_preserves_original_output');
      check(await db.payrollReservation.count({ where: { subjectId: f.subjectId } }) === 0, 'explicit_cancel_releases_claim');
      await request('VP001', 'POST', `/payroll/batches/${batch.id}/settlements`, { expectedVersion: batch.version, lineId: line.id,
        amount: '50', reference: 'Cancelled arrangement must not pay again', requestId: randomUUID() }, [409]);
      correction = await action(correction, 'calculate'); correction = await approve(correction); await excel(correction, '50');
      const nextLine = latest(correction).lines.find(row => row.itemCode === 'fixed');
      correction = await action(correction, 'settlements', 'VP001', { lineId: nextLine.id, amount: '50', reference: 'Fictional remainder actual receipt', requestId: randomUUID() });
      const payments = await db.payrollSettlement.findMany({ where: batchWhere(f.subjectId) });
      equalMoney(payments.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toString(), '200', 'confirmed_cumulative_no_double_pay');
      check(payments.length === 2 && await db.payrollReservation.count({ where: { subjectId: f.subjectId } }) === 0, 'full_payment_closes_claim');
      equalMoney(latest(await calculate(f)).gross, '0', 'settled_rerun_delta_zero');
      equalMoney((await db.payrollLine.findFirstOrThrow({ where: { versionId, itemCode: 'fixed' } })).amount.toString(), '200', 'settlement_preserves_approved_wages');
    });
    await caseRun('trial_scope_and_live_grant_revocation', async () => {
      const f = await fixture('authorization'); await seal(f);
      const trial = await calculate(f, 'trial');
      await request('HR001', 'POST', `/payroll/batches/${trial.id}/submit`, { expectedVersion: trial.version }, [409]);
      await request('VP001', 'POST', `/payroll/batches/${trial.id}/export`, { expectedVersion: trial.version, filePassword: randomUUID() }, [403]);
      for (const actor of ['ADMIN', 'EMP001', 'EMP002', 'EMP003']) {
        await request(actor, 'GET', `/payroll/batches?subjectId=${f.subjectId}`, undefined, [403]);
        await request(actor, 'GET', `/payroll/batches/${trial.id}`, undefined, [403]);
        await request(actor, 'GET', `/payroll/standards?subjectId=${f.subjectId}`, undefined, [403]);
        await request(actor, 'POST', `/payroll/batches/${trial.id}/export`, { expectedVersion: trial.version, filePassword: randomUUID() }, [403]);
      }
      await request('HR001', 'POST', `/payroll/batches/${trial.id}/export`, { expectedVersion: trial.version, filePassword: randomUUID() }, [403]);
      const narrowGrant = await db.payrollGrant.create({ data: { userId: actors.EMP003, subjectId: f.subjectId, capabilities: ['payroll_review'], grantedById: actors.ADMIN } });
      check((await api('EMP003', 'GET', `/payroll/batches?subjectId=${f.subjectId}`)).length === 0, 'unassigned_reviewer_sees_no_batches');
      await request('EMP003', 'GET', `/payroll/batches/${trial.id}`, undefined, [403]);
      await db.payrollGrant.update({ where: { id: narrowGrant.id }, data: { capabilities: ['payroll_export', 'payroll_settle'] } });
      check((await api('EMP003', 'GET', `/payroll/batches?subjectId=${f.subjectId}`)).length === 0, 'finance_only_hides_unapproved');
      await request('EMP003', 'GET', `/payroll/batches/${trial.id}`, undefined, [403]);
      let batch = await calculate(f); batch = await action(batch, 'submit');
      const reviewerGrant = await db.payrollGrant.findUniqueOrThrow({ where: { userId_subjectId: { userId: actors.MGR001, subjectId: f.subjectId } } });
      await db.payrollGrant.update({ where: { id: reviewerGrant.id }, data: { revokedAt: new Date() } });
      await request('MGR001', 'POST', `/payroll/batches/${batch.id}/decide`, { expectedVersion: batch.version, decision: 'approve', note: 'Revoked live grant' }, [403]);
      check(await db.payrollDecision.count({ where: { versionId: latest(batch).id } }) === 0, 'revocation_old_token_cannot_approve');
      await db.payrollGrant.update({ where: { id: reviewerGrant.id }, data: { revokedAt: null } });
      batch = await action(batch, 'decide', 'MGR001', { decision: 'approve', note: 'Restored run-owned reviewer grant' });
      batch = await action(batch, 'decide', 'VP001', { decision: 'approve', note: 'Run-owned approval' });
      const finals = await api('EMP003', 'GET', `/payroll/batches?subjectId=${f.subjectId}`);
      check(finals.length === 1 && finals[0].id === batch.id && finals[0].versions.length === 1, 'finance_only_current_approved');
      await excel(batch, '17500', 1, 'EMP003');
      const grant = await db.payrollGrant.findUniqueOrThrow({ where: { userId_subjectId: { userId: actors.EMP003, subjectId: f.subjectId } } });
      await db.payrollGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      await request('EMP003', 'GET', `/payroll/batches/${batch.id}`, undefined, [403]);
      await request('EMP003', 'POST', `/payroll/batches/${batch.id}/export`, { expectedVersion: batch.version, filePassword: randomUUID() }, [403]);
      const fixed = latest(batch).lines.find(row => row.itemCode === 'fixed');
      await request('EMP003', 'POST', `/payroll/batches/${batch.id}/settlements`, { expectedVersion: batch.version, lineId: fixed.id,
        amount: '1', reference: 'Revoked grant cannot confirm', requestId: randomUUID() }, [403]);
      check(await db.payrollSettlement.count({ where: batchWhere(f.subjectId) }) === 0, 'revoked_financial_grant_no_payment');
    });
    await caseRun('quarter_published_performance_backpay_one_file', async () => {
      const f = await fixture('quarter', { fixed: '0', performance: true, months: ['2026-09', '2026-10', '2026-11'] });
      const sourceBefore = digest(await db.assessmentTask.findMany({ where: { cycleId: f.cycleId }, include: { gradeResult: true } }));
      for (const month of f.months) await seal(f, 'normal', false, month);
      let batch = await calculate(f); equalMoney(latest(batch).gross, '1200', 'quarter_delta_expected');
      for (const month of f.months) {
        const line = latest(batch).lines.find(row => row.itemCode === 'performance' && row.attributionMonth === month);
        equalMoney(line.entitlement, '2400', 'quarter_month_entitlement'); equalMoney(line.paidBefore, '2000', 'quarter_confirmed_opening'); equalMoney(line.amount, '400', 'quarter_month_delta');
      }
      batch = await approve(batch); await excel(batch, '1200', 3);
      check(digest(await db.assessmentTask.findMany({ where: { cycleId: f.cycleId }, include: { gradeResult: true } })) === sourceBefore, 'payroll_does_not_write_performance');
    });
  } catch (error) {
    failed++; emit(`${phase}_failed_${error.safeCase ?? 'execution'}`, 0);
  } finally {
    try { await cleanup(); } catch (error) { failed++; emit(`cleanup_failed_${error.safeCase ?? 'execution'}`, 0); }
    try { if (baseline) { check(await demoLedger() === baseline, 'demo_ledger_not_modified'); emit('demo_ledger_unchanged', 1); } }
    catch { failed++; emit('demo_ledger_changed', 0); }
    for (const key of Object.keys(tokens)) tokens[key] = '';
    await db.$disconnect();
    emit('passed', passed); emit('failed', failed);
    if (failed) process.exitCode = 1;
  }
}

function launch() {
  const { spawnSync } = require('node:child_process');
  const emit = (name, count) => process.stdout.write(JSON.stringify({ case: name, count }) + '\n');
  try {
    const guardsOnly = process.argv.includes('--guards-only');
    if (process.argv.slice(2).some(arg => arg !== '--guards-only')) throw new Error();
    const format = '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"cwd":{{json .Config.WorkingDir}}}';
    const inspection = spawnSync('docker', ['inspect', '--format', format, 'hrm-api-1'], { encoding: 'utf8', timeout: 15000 });
    if (inspection.status !== 0) throw new Error();
    const container = JSON.parse(inspection.stdout);
    if (container.name !== '/hrm-api-1' || container.project !== 'hrm' || container.service !== 'api' || !container.running || container.cwd !== '/app') throw new Error();
    const source = `(${run.toString()})(${guardsOnly}).catch(() => { process.stdout.write(JSON.stringify({case:'runner_failed',count:0})+String.fromCharCode(10)); process.exitCode=1; });`;
    const execution = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 900000, maxBuffer: 1024 * 1024,
    });
    let messages = 0;
    for (const line of (execution.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      try { const result = JSON.parse(line); if (typeof result.case !== 'string' || !/^[a-z0-9_]+$/.test(result.case) || !Number.isInteger(result.count)) throw new Error();
        emit(result.case, result.count); messages++; } catch { throw new Error(); }
    }
    if (!messages || execution.status !== 0) process.exitCode = 1;
    if (execution.error || execution.signal) { emit('container_execution_interrupted', 0); process.exitCode = 1; }
  } catch { emit('isolated_preview_runner_refused', 0); process.exitCode = 1; }
}

if (require.main === module) launch();
