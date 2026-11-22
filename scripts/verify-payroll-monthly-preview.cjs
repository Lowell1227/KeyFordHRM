'use strict';
const { spawnSync } = require('node:child_process');

async function verify() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient, Prisma } = require('@prisma/client');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' }), tokens = {}, passed = [];
  const check = (ok, code) => { if (!ok) throw new Error(code); passed.push(code); };
  let manifest, cycle, standard, stage = 'guard';
  async function http(actor, method, path, body, status = 201) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status !== status) throw new Error(`unexpected_http_${response.status}`);
    const json = await response.json(); return json.data;
  }
  async function calculate() {
    const batch = await http('HR001', 'GET', `/payroll/batches/${manifest.batchId}`, null, 200);
    return http('HR001', 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version });
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    check(identity.db === 'hrm_preview' && identity.role === 'hrm_preview' && process.env.PAYROLL_FORMAL_ENABLED !== 'true', 'isolated_database');
    manifest = (await db.systemConfig.findUnique({ where: { key: 'payroll_monthly_rules_preview_v1' } }))?.value;
    check(manifest?.fictional === true && manifest.state === 'ready' && manifest.month === '2036-11' && manifest.employeeIds.length === 2, 'owned_manifest');
    const users = await db.user.findMany({ where: { id: { in: manifest.employeeIds } }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    check(users.length === 2 && users.every(row => row.employeeNo?.startsWith('PAY-MONTH-') && !row.dingtalkId && !row.dingtalkUnionId), 'owned_fictional_users');
    stage = 'login';
    for (const actor of ['HR001', 'ADMIN', 'VP001']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor }, 200)).token;
    stage = 'access';
    await http('ADMIN', 'GET', `/payroll/batches/${manifest.batchId}`, null, 403); passed.push('administrator_without_payroll_grant_denied');
    await http('HR001', 'POST', '/payroll/batches', { subjectId: manifest.subjectId, month: manifest.month, payMonth: manifest.payMonth, purpose: 'formal' }, 403);
    passed.push('formal_channel_stays_closed');
    let batch = await calculate();
    check(new Prisma.Decimal(batch.versions[0].gross).eq('16400'), 'midmonth_fixed_plus_fullmonth_additional');
    await http('HR001', 'POST', `/payroll/batches/${batch.id}/submit`, { expectedVersion: batch.version }, 409);
    passed.push('trial_cannot_enter_approval');
    const policy = await db.payrollPolicy.findFirst({ where: { subjectId: manifest.subjectId, domain: 'validation', status: 'active' } });
    const broken = JSON.parse(JSON.stringify(policy.config)); broken.workCalendars[manifest.month].days.pop();
    await http('HR001', 'POST', '/payroll/rules', { subjectId: manifest.subjectId, effectiveFrom: '2036-11-01', config: broken }, 400);
    passed.push('incomplete_calendar_rejected_by_real_api');
    const ownedCycle = await db.assessmentCycle.findUnique({ where: { id: manifest.cycleIds[0] } });
    check(ownedCycle?.name === '月度最终公示验收（虚构）' && ownedCycle.notificationMode === 'off', 'owned_fictional_cycle');
    cycle = ownedCycle;
    stage = 'quarterly_rejection';
    await db.assessmentCycle.update({ where: { id: cycle.id }, data: { type: 'quarterly' } });
    batch = await calculate();
    check(batch.versions[0].gross === null && batch.versions[0].issues.join().includes('正式月度'), 'quarterly_result_is_not_monthly_pay');
    stage = 'wrong_period';
    await db.assessmentCycle.update({ where: { id: cycle.id }, data: { type: 'monthly', startDate: new Date('2036-10-01'), endDate: new Date('2036-10-31') } });
    batch = await calculate();
    check(batch.versions[0].gross === null && batch.versions[0].issues.join().includes('归属月'), 'wrong_attribution_month_is_blocked');
    await db.assessmentCycle.update({ where: { id: cycle.id }, data: { type: cycle.type, startDate: cycle.startDate, endDate: cycle.endDate, updatedAt: cycle.updatedAt } });
    stage = 'performance_proration';
    standard = await db.payrollStandard.findFirst({ where: { subjectId: manifest.subjectId, employeeId: manifest.employeeIds[1], domain: 'validation', status: 'active' } });
    check(standard?.performanceMode === 'none', 'owned_midmonth_standard');
    await db.payrollStandard.update({ where: { id: standard.id }, data: { performanceMode: 'additional', performanceBase: '2000' } });
    batch = await calculate();
    check(batch.versions[0].gross === null && batch.versions[0].issues.join().includes('绩效计发比例'), 'unconfirmed_midmonth_performance_is_not_prorated');
  } catch { throw new Error(`monthly_verification_${stage}_failed`); }
  finally {
    try {
      if (cycle) await db.assessmentCycle.update({ where: { id: cycle.id }, data: { type: cycle.type, startDate: cycle.startDate, endDate: cycle.endDate, updatedAt: cycle.updatedAt } });
      if (standard) await db.payrollStandard.update({ where: { id: standard.id }, data: { performanceMode: standard.performanceMode, performanceBase: standard.performanceBase, updatedAt: standard.updatedAt } });
      if (manifest && tokens.HR001) {
        const restored = await calculate();
        check(restored.versions[0].issues.length === 0 && new Prisma.Decimal(restored.versions[0].gross).eq('16400'), 'retained_preview_restored');
      }
    } finally { await db.$disconnect(); }
  }
  return { passed: passed.length, checks: passed, fictional: true, productionTouched: false };
}
const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') { console.error('preview_container_guard'); process.exitCode = 1; }
else {
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 180000,
    input: `(${verify.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});` });
  if (result.status !== 0) { console.error(result.stderr?.trim() || 'monthly_verification_failed'); process.exitCode = 1; }
  else process.stdout.write(result.stdout);
}
