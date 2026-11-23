'use strict';
const { spawnSync } = require('node:child_process');
const { ensureFictionalPayrollManager } = require('./payroll-preview-manager.cjs');

async function prepare(scope, inspectOnly) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient } = require('@prisma/client'), { randomUUID } = require('node:crypto');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' }), tokens = {};
  const check = (value, code) => { if (!value) throw new Error(code); };
  const key = `payroll_parameter_preview_${scope}_v1`, month = '2037-01';
  async function http(actor, method, path, body) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method, signal: AbortSignal.timeout(30000), redirect: 'error',
      headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    check(response.ok, `fixture_http_${response.status}`); const json = await response.json(); check(json.code === 0, 'fixture_response'); return json.data;
  }
  try {
    check(['desktop', 'mobile', 'tablet', 'api', 'demo', 'net-desktop', 'net-mobile', 'net-api', 'net-demo', 'net-recovery', 'net-desktop-final', 'net-mobile-final'].includes(scope), 'fixture_scope');
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview' && process.env.PAYROLL_ENABLED === 'true'
      && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'fixture_database');
    const base = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
    check(base?.fictional === true, 'fixture_base');
    const prior = (await db.systemConfig.findUnique({ where: { key } }))?.value;
    if (prior) {
      const employee = await db.user.findUnique({ where: { id: prior.employeeId }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
      const subject = await db.contractSubject.findUnique({ where: { id: prior.subjectId }, select: { name: true } });
      check(prior.fictional === true && prior.state === 'ready' && prior.month === month && employee?.employeeNo?.startsWith('PAY-PARAM-')
        && !employee.dingtalkId && !employee.dingtalkUnionId && subject?.name.startsWith('参数发布（虚构）'), 'fixture_owned');
      return prior;
    }
    check(!inspectOnly, 'fixture_missing');
    await ensureFictionalPayrollManager(db, base.actors);
    const subjectId = randomUUID(), employeeId = randomUUID(), runId = randomUUID(), actors = base.actors;
    const value = { fictional: true, state: 'preparing', subjectId, employeeId, month, payMonth: '2037-02', actors, batchId: null, scope };
    await db.$transaction(async tx => {
      await tx.contractSubject.create({ data: { id: subjectId, name: `参数发布（虚构）-${scope}-${runId.slice(0, 8)}` } });
      const employeeNo = `PAY-PARAM-${runId.slice(0, 8)}`;
      await tx.user.create({ data: { id: employeeId, employeeNo, name: '参数样例（虚构）', entryDate: new Date('2037-01-01'), directManagerId: actors.MGR001 } });
      await tx.employmentRecord.create({ data: { userId: employeeId, employeeNo, effectiveFrom: new Date('2037-01-01'), entryDate: new Date('2037-01-01'),
        contractSubjectId: subjectId, employeeStatus: 'active', directManagerId: actors.MGR001, changeType: 'initial', sourceType: 'payroll_preview', reason: runId, createdById: actors.HR001 } });
      await tx.payrollGrant.create({ data: { userId: actors.HR001, subjectId, capabilities: ['payroll_edit', 'payroll_view', 'attendance_edit', 'attendance_seal'], grantedById: actors.ADMIN } });
      await tx.payrollGrant.create({ data: { userId: actors.VP001, subjectId, capabilities: ['payroll_approve', 'payroll_settle'], grantedById: actors.ADMIN } });
      await tx.systemConfig.create({ data: { key, value } });
    });
    for (const actor of ['HR001', 'MGR001', 'VP001']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor })).token;
    async function publish(kind, row) {
      const release = await http('HR001', 'POST', `/payroll/parameters/${kind}/${row.id}/submit`, { expectedVersion: row.version });
      await http('MGR001', 'POST', `/payroll/parameter-releases/${release.id}/decide`, { expectedVersion: release.attempt, decision: 'approve', note: '虚构初版参数确认' });
    }
    const standard = await http('HR001', 'POST', '/payroll/standards', { subjectId, employeeId, effectiveFrom: `${month}-01`, fixedMonthly: '10000', performanceBase: '0', performanceMode: 'none', evidence: '虚构已审批工资标准来源' });
    await publish('standard', standard);
    const days = Array.from({ length: 31 }, (_, i) => ({ workDate: `${month}-${String(i + 1).padStart(2, '0')}`, units: i < 20 ? '1' : '0' }));
    const rule = await http('HR001', 'POST', '/payroll/rules', { subjectId, effectiveFrom: `${month}-01`, config: {
      fixedSalaryBasis: 'monthly_workdays', workCalendars: { [month]: { sourceVersion: 'fictional-v1', evidenceRef: '虚构日历，非真实排班', days } },
      rounding: 'item_half_up', cutoverMonth: month, reviewers: [actors.MGR001], approvers: [actors.VP001], performance: {} } });
    await publish('rule', rule);
    for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) await http('VP001', 'POST', '/payroll/opening-balances', { subjectId, employeeId, month, itemCode, amount: '0', reference: '虚构确认零期初' });
    const attendance = await http('HR001', 'POST', '/payroll/attendance/sync', { subjectId, month, sourceKey: `parameter:${runId}`, complete: true,
      input: { month, expected: days.map(day => ({ ...day, employeeId, required: day.units === '1' })), records: days.filter(day => day.units === '1').map(day => ({
        sourceId: `${runId}:${day.workDate}`, sourceVersion: 1, employeeId, workDate: day.workDate, startsAt: `${day.workDate}T09:00:00+08:00`, endsAt: `${day.workDate}T17:00:00+08:00`, hours: '8', unit: 'hour', type: 'normal', state: 'effective' })) } });
    await http('HR001', 'POST', `/payroll/attendance/${attendance.id}/seal`, { expectedVersion: attendance.version });
    let batch = await http('HR001', 'POST', '/payroll/batches', { subjectId, month, payMonth: value.payMonth, purpose: 'trial' });
    batch = await http('HR001', 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version });
    check(Number(batch.versions[0].gross) === 10000 && batch.versions[0].issues.length === 0, 'fixture_calculation');
    value.batchId = batch.id; value.state = 'ready';
    await db.systemConfig.update({ where: { key }, data: { value } }); return value;
  } finally { await db.$disconnect(); }
}
function run(scope, inspectOnly = false) {
  const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
  if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') throw new Error('preview_container_guard');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 180000,
    input: `const ensureFictionalPayrollManager=${ensureFictionalPayrollManager.toString()};(${prepare.toString()})(${JSON.stringify(scope)},${inspectOnly}).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('parameter_fixture_refused');process.exitCode=1;});` });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || 'parameter_fixture_refused'); return JSON.parse(result.stdout);
}
module.exports = { inspectFixture: scope => run(scope, true) };
if (require.main === module) { try { console.log(JSON.stringify(run(process.argv[2] ?? 'demo', process.argv.includes('--inspect')))); } catch (error) { console.error(error.message); process.exitCode = 1; } }
