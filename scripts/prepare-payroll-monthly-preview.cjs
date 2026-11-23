'use strict';

const { spawnSync } = require('node:child_process');
const { ensureFictionalPayrollManager } = require('./payroll-preview-manager.cjs');

async function prepare(inspectOnly, finishPreparing) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { randomUUID } = require('node:crypto');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const key = 'payroll_monthly_rules_preview_v1', month = '2036-11', payMonth = '2036-12';
  const check = (ok, code) => { if (!ok) throw new Error(code); };
  let stage = 'guard';
  const tokens = {};
  async function http(actor, method, path, body) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    check(response.ok, `http_${response.status}`);
    const json = await response.json(); check(json.code === 0, 'api_response'); return json.data;
  }
  const receipt = value => ({ fictional: true, month, payMonth, subjectId: value.subjectId, employeeIds: value.employeeIds,
    cycleIds: value.cycleIds, actors: value.actors, batchId: value.batchId,
    preview: `http://localhost:5173/payroll/batches/${value.batchId}?subjectId=${value.subjectId}&month=${month}` });
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview' && process.env.PAYROLL_ENABLED === 'true'
      && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'isolated_database');
    const base = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
    check(base?.fictional === true && base.actors, 'fictional_base');
    const actors = await db.user.findMany({ where: { id: { in: Object.values(base.actors) } }, select: { name: true, dingtalkId: true, dingtalkUnionId: true } });
    check(actors.length === Object.values(base.actors).length && actors.every(row => row.name.startsWith('测试') && !row.dingtalkId && !row.dingtalkUnionId), 'fictional_actors');
    const prior = (await db.systemConfig.findUnique({ where: { key } }))?.value;
    if (prior) {
      check(prior.fictional === true && (prior.state === 'ready' || finishPreparing === true && prior.state === 'preparing')
        && prior.month === month && prior.employeeIds.length === 2, 'existing_manifest');
      const subject = await db.contractSubject.findUnique({ where: { id: prior.subjectId } });
      const users = await db.user.findMany({ where: { id: { in: prior.employeeIds } }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
      check(subject?.name.startsWith('月度算薪验收（虚构）') && users.length === 2
        && users.every(row => row.employeeNo?.startsWith('PAY-MONTH-') && !row.dingtalkId && !row.dingtalkUnionId), 'existing_owned_records');
      if (prior.state === 'preparing') {
        const batches = await db.payrollBatch.findMany({ where: { subjectId: prior.subjectId, month, purpose: 'trial' },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        check(batches.length === 1 && batches[0].status === 'calculated' && batches[0].versions[0]?.gross?.eq('16400')
          && batches[0].versions[0].issues.length === 0, 'monthly_math');
        prior.batchId = batches[0].id; prior.subjectIds = [prior.subjectId]; prior.state = 'ready';
        await db.systemConfig.update({ where: { key }, data: { value: prior } });
      }
      return receipt(prior);
    }
    check(!inspectOnly, 'fixture_not_prepared');
    await ensureFictionalPayrollManager(db, base.actors);
    const runId = randomUUID(), subjectId = randomUUID(), employeeIds = [randomUUID(), randomUUID()], cycleId = randomUUID();
    const value = { fictional: true, state: 'preparing', month, payMonth, runId, subjectId, subjectIds: [subjectId], employeeIds, cycleIds: [cycleId], actors: base.actors, batchId: null };
    const publishedAt = new Date();
    stage = 'owned_fixture';
    await db.$transaction(async tx => {
      await tx.contractSubject.create({ data: { id: subjectId, name: `月度算薪验收（虚构）-${runId.slice(0, 8)}` } });
      for (const [i, id] of employeeIds.entries()) {
        const employeeNo = `PAY-MONTH-${runId.slice(0, 8)}-${i + 1}`, from = new Date(`2036-11-${i ? '11' : '01'}T00:00:00Z`);
        await tx.user.create({ data: { id, name: `月度样例${i ? '乙' : '甲'}（虚构）`, employeeNo, entryDate: from, directManagerId: base.actors.MGR001 } });
        await tx.employmentRecord.create({ data: { userId: id, employeeNo, effectiveFrom: from, entryDate: from, contractSubjectId: subjectId,
          employeeStatus: 'active', directManagerId: base.actors.MGR001, changeType: 'initial', sourceType: 'payroll_preview', reason: runId, createdById: base.actors.HR001 } });
      }
      await tx.assessmentCycle.create({ data: { id: cycleId, name: '月度最终公示验收（虚构）', type: 'monthly', scoringFrequency: 'monthly',
        startDate: new Date('2036-11-01'), endDate: new Date('2036-11-30'), status: 'published', workflowVersion: 2, goalWorkflowVersion: 2,
        createdBy: base.actors.HR001, hrOwnerId: base.actors.HR001, notificationMode: 'off' } });
      const task = await tx.assessmentTask.create({ data: { cycleId, employeeId: employeeIds[0], managerId: base.actors.MGR001,
        deptHeadId: base.actors.MGR001, approverId: base.actors.VP001, status: 'published', publishedAt } });
      await tx.gradeResult.create({ data: { taskId: task.id, rawGrade: 'A', calibratedGrade: 'A', isPublished: true, publishedAt,
        hrCalibratorId: base.actors.HR001, hrCalibratedAt: publishedAt, approverId: base.actors.VP001, approvedAt: publishedAt } });
      for (const [actor, capabilities] of [['HR001', ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit']],
        ['MGR001', ['payroll_review']], ['VP001', ['payroll_approve', 'payroll_export', 'payroll_settle']]]) {
        await tx.payrollGrant.create({ data: { userId: base.actors[actor], subjectId, capabilities, grantedById: base.actors.ADMIN } });
      }
      await tx.systemConfig.create({ data: { key, value } });
    }, { timeout: 20000 });
    for (const actor of ['HR001', 'MGR001', 'VP001']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor })).token;
    async function publish(kind, row) {
      const release = await http('HR001', 'POST', `/payroll/parameters/${kind}/${row.id}/submit`, { expectedVersion: row.version });
      await http('MGR001', 'POST', `/payroll/parameter-releases/${release.id}/decide`, { expectedVersion: release.attempt, decision: 'approve', note: '虚构主管确认' });
    }
    stage = 'standards_and_calendar';
    for (const [i, employeeId] of employeeIds.entries()) {
      const standard = await http('HR001', 'POST', '/payroll/standards', { subjectId, employeeId, effectiveFrom: '2036-11-01',
        fixedMonthly: i ? '8000' : '10000', performanceBase: i ? '0' : '2000', performanceMode: i ? 'none' : 'additional', evidence: '虚构已审批标准来源，仅验证数学和流程' });
      await publish('standard', standard);
      for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) await http('VP001', 'POST', '/payroll/opening-balances',
        { subjectId, employeeId, month, itemCode, amount: '0', reference: '虚构确认：无历史入薪' });
    }
    const days = Array.from({ length: 30 }, (_, i) => ({ workDate: `${month}-${String(i + 1).padStart(2, '0')}`, units: i < 20 ? '1' : '0' }));
    const rule = await http('HR001', 'POST', '/payroll/rules', { subjectId, effectiveFrom: '2036-11-01', config: {
      fixedSalaryBasis: 'monthly_workdays', workCalendars: { [month]: { sourceVersion: 'fictional-calendar-v1', evidenceRef: '虚构确认日历，非真实法定排班', days } },
      rounding: 'item_half_up', monthlyUnits: { [month]: '20' }, cutoverMonth: month, reviewers: [base.actors.MGR001], approvers: [base.actors.VP001],
      performance: { [month]: { cycleIds: [cycleId], sourceKind: 'fictional', coefficientVersion: 'fictional-table-v1', evidenceRef: '虚构系数表批准依据', coefficients: { A: '1.2' } } } } });
    await publish('rule', rule);
    const expected = [], records = [];
    for (const [i, employeeId] of employeeIds.entries()) for (const day of days.filter(day => !i || day.workDate >= '2036-11-11')) {
      expected.push({ employeeId, ...day, required: day.units === '1' });
      if (day.units === '1') records.push({ sourceId: `monthly:${runId}:${employeeId}:${day.workDate}`, sourceVersion: 1,
        employeeId, workDate: day.workDate, startsAt: `${day.workDate}T09:00:00+08:00`, endsAt: `${day.workDate}T17:00:00+08:00`, hours: '8', unit: 'hour', type: 'normal', state: 'effective' });
    }
    stage = 'attendance_and_batch';
    const attendance = await http('HR001', 'POST', '/payroll/attendance/sync', { subjectId, month, sourceKey: `monthly:${runId}`, complete: true, input: { month, expected, records } });
    check(attendance.payload.issues.length === 0, 'attendance_complete');
    await http('HR001', 'POST', `/payroll/attendance/${attendance.id}/seal`, { expectedVersion: attendance.version });
    let batch = await http('HR001', 'POST', '/payroll/batches', { subjectId, month, payMonth, purpose: 'trial' });
    batch = await http('HR001', 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version });
    check(new Prisma.Decimal(batch.versions[0].gross).eq('16400') && !batch.versions[0].issues.length, 'monthly_math');
    value.batchId = batch.id; value.state = 'ready';
    await db.systemConfig.update({ where: { key }, data: { value } });
    return receipt(value);
  } catch (error) { throw new Error(`monthly_preview_${stage}_${/^(http_\d+|attendance_complete|monthly_math|api_response|existing_manifest|existing_owned_records|fixture_not_prepared|isolated_database|fictional_base|fictional_actors)$/.test(error.message) ? error.message : 'failed'}`); }
  finally { await db.$disconnect(); }
}

function run(inspectOnly, finishPreparing = false) {
  const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
  if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') throw new Error('preview_container_guard');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    input: `const ensureFictionalPayrollManager=${ensureFictionalPayrollManager.toString()};(${prepare.toString()})(${inspectOnly === true},${finishPreparing === true}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || 'monthly_fixture_refused');
  return JSON.parse(result.stdout);
}
module.exports = { inspectFixture: () => run(true) };
if (require.main === module) {
  try { console.log(JSON.stringify(run(process.argv.includes('--inspect'), process.argv.includes('--finish-preparing')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
