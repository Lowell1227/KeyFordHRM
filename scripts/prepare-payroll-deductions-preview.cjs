'use strict';

const { spawnSync } = require('node:child_process');

async function prepare() {
  const { PrismaClient } = require('@prisma/client');
  const { randomUUID, createHash } = require('node:crypto');
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const key = 'payroll_deductions_preview_fixture_v1', month = '2035-11', payMonth = '2035-12';
  const check = (value, code) => { if (!value) { const error = new Error(code); error.safeCode = code; throw error; } };
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const tokens = {};
  let stage = 'guard';
  async function http(actor, method, route, body) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + route, { method, redirect: 'error',
      signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    check(response.ok, `http_${response.status}`); const value = await response.json();
    check(value.code === 0, 'api_response'); return value.data;
  }
  const latest = value => value.versions?.[0];
  async function baseState(base) {
    return sha(await db.$transaction(async tx => ({ marker: await tx.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }),
      standards: await tx.payrollStandard.findMany({ where: { subjectId: { in: base.subjectIds } }, orderBy: { id: 'asc' } }),
      rules: await tx.payrollPolicy.findMany({ where: { subjectId: { in: base.subjectIds } }, orderBy: { id: 'asc' } }),
      batches: await tx.payrollBatch.findMany({ where: { subjectId: { in: base.subjectIds } }, orderBy: { id: 'asc' } }),
      snapshots: await tx.payrollAttendanceSnapshot.findMany({ where: { subjectId: { in: base.subjectIds } }, orderBy: { id: 'asc' } }),
      grants: await tx.payrollGrant.findMany({ where: { subjectId: { in: base.subjectIds } }, orderBy: { id: 'asc' } }),
    })));
  }
  function receipt(value, preserved) {
    return { prepared: true, preserved, fictional: true, month, payMonth, subjectCount: value.subjectIds.length, employeeCount: value.employeeIds.length,
      subjects: value.subjectIds.map((id, index) => ({ id, batchId: value.batchIds[index], preview: `http://localhost:5173/payroll/batches/${value.batchIds[index]}?subjectId=${id}&month=${month}` })),
      approvedBatchId: value.approvedBatchId };
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview' && process.env.PAYROLL_ENABLED === 'true'
      && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'isolated_database');
    const local = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    const base = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
    check(local?.value?.fictional === true && base?.fictional === true && base.actors, 'fictional_base');
    const actorRows = await db.user.findMany({ where: { id: { in: Object.values(base.actors) } }, select: { id: true, name: true, employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    check(actorRows.length === Object.values(base.actors).length && actorRows.every(row => row.name.startsWith('测试') && !row.dingtalkId && !row.dingtalkUnionId), 'fictional_actors');
    const prior = await db.systemConfig.findUnique({ where: { key } });
    if (prior) {
      const value = prior.value;
      check(value.fictional === true && value.state === 'ready' && value.month === month && value.payMonth === payMonth
        && Array.isArray(value.subjectIds) && value.subjectIds.length === 2 && Array.isArray(value.employeeIds) && value.employeeIds.length === 3
        && Array.isArray(value.batchIds) && value.batchIds.length === 2 && typeof value.approvedBatchId === 'string', 'existing_owned_manifest');
      const subjects = await db.contractSubject.findMany({ where: { id: { in: value.subjectIds } }, select: { name: true } });
      const users = await db.user.findMany({ where: { id: { in: value.employeeIds } }, select: { employeeNo: true, name: true, dingtalkId: true, dingtalkUnionId: true } });
      check(subjects.length === 2 && subjects.every(row => row.name.startsWith('扣缴预览') && row.name.includes('虚构'))
        && users.length === 3 && users.every(row => row.employeeNo?.startsWith('PAY-DEDUCT-') && row.name.includes('虚构') && !row.dingtalkId && !row.dingtalkUnionId), 'existing_owned_records');
      check(await db.payrollBatch.count({ where: { id: { in: [...value.batchIds, value.approvedBatchId] }, subjectId: { in: value.subjectIds } } }) === 3, 'existing_batches');
      return receipt(value, true);
    }
    const baseline = await baseState(base), runId = randomUUID();
    const subjectIds = [randomUUID(), randomUUID()], employeeIds = [randomUUID(), randomUUID(), randomUUID()];
    const value = { fictional: true, state: 'preparing', runId, month, payMonth, subjectIds, employeeIds, batchIds: [], approvedBatchId: null, actors: base.actors };
    stage = 'seed_owned_identity';
    await db.$transaction(async tx => {
      for (const [index, id] of subjectIds.entries()) await tx.contractSubject.create({ data: { id, name: `扣缴预览${index ? '乙' : '甲'}（虚构）-${runId.slice(0, 8)}` } });
      for (const [index, id] of employeeIds.entries()) {
        const employeeNo = `PAY-DEDUCT-${runId.slice(0, 8)}-${index + 1}`;
        await tx.user.create({ data: { id, employeeNo, name: `扣缴验收样例${index + 1}（虚构）`, entryDate: new Date('2035-01-01T00:00:00Z'), directManagerId: base.actors.MGR001 } });
        await tx.employmentRecord.create({ data: { userId: id, employeeNo, effectiveFrom: new Date('2035-01-01T00:00:00Z'), entryDate: new Date('2035-01-01T00:00:00Z'),
          contractSubjectId: subjectIds[index === 2 ? 1 : 0], employeeStatus: 'active', directManagerId: base.actors.MGR001,
          changeType: 'initial', sourceType: 'payroll_preview', reason: runId, createdById: base.actors.HR001 } });
      }
      for (const [index, subjectId] of subjectIds.entries()) for (const [actor, capabilities] of [
        ['HR001', index === 0 ? ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit'] : ['attendance_edit', 'attendance_seal']],
        ['MGR001', ['payroll_review']], ['VP001', ['payroll_approve', 'payroll_export', 'payroll_settle']],
        ['EMP002', ['payroll_view']], ['EMP003', index === 1 ? ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit'] : []],
      ]) if (capabilities.length) await tx.payrollGrant.create({ data: { userId: base.actors[actor], subjectId, capabilities, grantedById: base.actors.ADMIN } });
      await tx.systemConfig.create({ data: { key, value } });
    }, { timeout: 20000 });
    for (const actor of ['HR001', 'MGR001', 'VP001', 'EMP002', 'EMP003']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor })).token;
    const itemCodes = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'];
    for (const [index, subjectId] of subjectIds.entries()) {
      stage = `prepare_subject_${index + 1}`; const editor = index === 0 ? 'HR001' : 'EMP003';
      const ids = employeeIds.filter((_, employeeIndex) => (employeeIndex === 2 ? 1 : 0) === index);
      for (const employeeId of ids) {
        const fixed = ['10000', '8000', '3000'][employeeIds.indexOf(employeeId)];
        const standard = await http(editor, 'POST', '/payroll/standards', { subjectId, employeeId, effectiveFrom: '2035-01-01', fixedMonthly: fixed,
          performanceBase: '0', performanceMode: 'none', evidence: '扣缴预览虚构标准，非正式工资' });
        await http(editor, 'POST', `/payroll/standards/${standard.id}/activate`);
        for (const itemCode of itemCodes) await http('VP001', 'POST', '/payroll/opening-balances', { subjectId, employeeId, month, itemCode, amount: '0', reference: '虚构期初：该样例无历史入薪' });
      }
      const rule = await http(editor, 'POST', '/payroll/rules', { subjectId, effectiveFrom: '2035-01-01', config: { rounding: 'item_half_up', monthlyUnits: { [month]: '20' }, normalHourly: '100',
        paidHourly: { unpaid_leave: '0', sick_leave: null, absence: '0' }, overtime: { hourlyBase: '100', weekday: '1.5', restday: '2', holiday: '3' },
        reviewers: [base.actors.MGR001], approvers: [base.actors.VP001], cutoverMonth: month, performance: {} } });
      await http(editor, 'POST', `/payroll/rules/${rule.id}/activate`);
      const expected = [], records = [];
      for (const employeeId of ids) for (let day = 1; day <= 30; day++) {
        const workDate = `${month}-${String(day).padStart(2, '0')}`, required = day <= 20;
        expected.push({ employeeId, workDate, units: required ? '1' : '0', required });
        if (required) for (const [part, from, to] of [['am', '08:00', '12:00'], ['pm', '13:00', '17:00']]) records.push({
          sourceId: `deduction-demo:${runId}:${employeeId}:${workDate}:${part}`, sourceVersion: 1, employeeId, workDate,
          startsAt: `${workDate}T${from}:00+08:00`, endsAt: `${workDate}T${to}:00+08:00`, hours: '4', unit: 'hour', type: 'normal', state: 'effective' });
      }
      const attendance = await http(editor, 'POST', '/payroll/attendance/sync', { subjectId, month, sourceKey: `deduction-demo:${runId}:${index}`, complete: true, input: { month, expected, records } });
      check(attendance.payload.issues.length === 0, 'attendance_complete');
      await http(editor, 'POST', `/payroll/attendance/${attendance.id}/seal`, { expectedVersion: attendance.version });
      let batch = await http(editor, 'POST', '/payroll/batches', { subjectId, month, payMonth, purpose: 'trial' });
      batch = await http(editor, 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version });
      check(latest(batch)?.gross !== null && latest(batch)?.issues.length === 0 && latest(batch)?.lines.length === ids.length * 5, 'calculation_complete');
      value.batchIds.push(batch.id);
    }
    stage = 'prepare_owned_approved_version';
    let approved = await http('HR001', 'POST', '/payroll/batches', { subjectId: subjectIds[0], month, payMonth, purpose: 'validation' });
    approved = await http('HR001', 'POST', `/payroll/batches/${approved.id}/calculate`, { expectedVersion: approved.version });
    approved = await http('HR001', 'POST', `/payroll/batches/${approved.id}/submit`, { expectedVersion: approved.version });
    approved = await http('MGR001', 'POST', `/payroll/batches/${approved.id}/decide`, { expectedVersion: approved.version, decision: 'approve', note: '虚构隔离复核' });
    approved = await http('VP001', 'POST', `/payroll/batches/${approved.id}/decide`, { expectedVersion: approved.version, decision: 'approve', note: '虚构隔离批准' });
    check(approved.status === 'approved' && latest(approved)?.decisions.length === 2, 'approved_fixture_complete');
    value.approvedBatchId = approved.id; value.state = 'ready';
    await db.systemConfig.update({ where: { key }, data: { value } });
    check(await baseState(base) === baseline, 'original_demo_unchanged');
    return receipt(value, false);
  } catch (error) {
    throw new Error(`deductions_preview_${stage}_${error.safeCode ?? 'failed'}`);
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  try {
    const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
    if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') throw new Error('preview_container_guard');
    const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { input: `(${prepare.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`,
      encoding: 'utf8', timeout: 240000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) { process.stderr.write(result.stderr || 'Guarded fixture preparation failed'); process.exitCode = 1; }
    else process.stdout.write(result.stdout);
  } catch { console.error('Guarded deductions preview preparation refused'); process.exitCode = 1; }
}
