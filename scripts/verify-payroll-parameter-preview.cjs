'use strict';
const { spawnSync } = require('node:child_process');
const { inspectFixture } = require('./prepare-payroll-parameter-preview.cjs');

async function verify(manifest) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient } = require('@prisma/client'), assert = require('node:assert/strict');
  const { effectivePayrollParameters } = require('./dist/src/payroll/payroll-parameter-timeline');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' }), tokens = {}, passed = [];
  let stage = 'guard';
  const { subjectId, employeeId, actors, month } = manifest;
  async function http(actor, method, path, body, status = method === 'GET' ? 200 : 201) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, `http_${response.status}_expected_${status}`);
    const json = await response.json(); if (response.ok) assert.equal(json.code, 0); return json.data;
  }
  const decide = (id, attempt, decision = 'approve', note = 'Fictional manager verification', actor = 'MGR001', status = 201) => http(actor, 'POST', `/payroll/parameter-releases/${id}/decide`, { expectedVersion: attempt, decision, note }, status);
  const draft = (amount, from = '2037-02-01', to = '2037-02-28') => http('HR001', 'POST', '/payroll/standards', { subjectId, employeeId, effectiveFrom: from, effectiveTo: to, fixedMonthly: amount, performanceBase: '0', performanceMode: 'none', evidence: 'Fictional reviewed payroll source' });
  const submit = row => http('HR001', 'POST', `/payroll/parameters/standard/${row.id}/submit`, { expectedVersion: row.version });
  async function calculate() {
    const batch = await http('HR001', 'GET', `/payroll/batches/${manifest.batchId}`);
    return http('HR001', 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version });
  }
  let originalManager, originalGrant;
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview'); assert.equal(process.env.PAYROLL_FORMAL_ENABLED, 'false');
    const marker = (await db.systemConfig.findUnique({ where: { key: 'payroll_parameter_preview_api_v1' } }))?.value;
    assert.equal(marker?.fictional, true); assert.equal(marker?.subjectId, subjectId);
    const user = await db.user.findUnique({ where: { id: employeeId }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    assert.ok(user.employeeNo.startsWith('PAY-PARAM-')); assert.ok(!user.dingtalkId && !user.dingtalkUnionId);
    for (const actor of ['HR001', 'MGR001', 'VP001', 'ADMIN']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor }, 200)).token;
    const current = await db.payrollStandard.findMany({ where: { subjectId, employeeId, status: 'active' } });
    assert.equal(current.length, 1, 'fresh_api_fixture_required'); const original = JSON.stringify(current[0]);
    originalManager = (await db.user.findUnique({ where: { id: actors.HR001 }, select: { directManagerId: true } })).directManagerId;
    assert.equal(originalManager, actors.MGR001);
    originalGrant = await db.payrollGrant.findFirst({ where: { subjectId, userId: actors.HR001, revokedAt: null } }); assert.ok(originalGrant);
    stage = 'scope';
    const access = await http('MGR001', 'GET', '/payroll/access');
    assert.deepEqual(access.subjects.find(row => row.id === subjectId).capabilities, ['payroll_parameter_review']);
    for (const path of [`/payroll/standards?subjectId=${subjectId}`, `/payroll/batches/${manifest.batchId}`]) await http('MGR001', 'GET', path, null, 403);
    await http('MGR001', 'POST', `/payroll/batches/${manifest.batchId}/export`, { expectedVersion: 1, filePassword: 'fictional-only' }, 403);
    await http('ADMIN', 'GET', `/payroll/parameter-releases?subjectId=${subjectId}`, null, 403);
    passed.push('assigned_only_no_salary_list_or_export_or_admin_bypass');
    stage = 'review';
    const next = await draft('12000');
    await http('HR001', 'POST', `/payroll/standards/${next.id}/activate`, null, 409);
    for (const invalidManager of [null, actors.HR001]) {
      await db.user.update({ where: { id: actors.HR001 }, data: { directManagerId: invalidManager } });
      await http('HR001', 'POST', `/payroll/parameters/standard/${next.id}/submit`, { expectedVersion: next.version }, 409);
    }
    await db.user.update({ where: { id: actors.HR001 }, data: { directManagerId: originalManager } });
    const first = await submit(next);
    await decide(first.id, first.attempt, 'approve', '', 'HR001', 403);
    await decide(first.id, first.attempt, 'approve', '', 'ADMIN', 403);
    await decide(first.id, first.attempt + 1, 'approve', '', 'MGR001', 409);
    await decide(first.id, first.attempt, 'return', '', 'MGR001', 400);
    await db.user.update({ where: { id: actors.HR001 }, data: { directManagerId: actors.VP001 } });
    await decide(first.id, first.attempt, 'approve', '', 'MGR001', 403);
    const removed = await http('MGR001', 'GET', '/payroll/access'); assert.ok(!removed.subjects.some(row => row.id === subjectId));
    await db.user.update({ where: { id: actors.HR001 }, data: { directManagerId: originalManager } });
    await db.payrollGrant.update({ where: { id: originalGrant.id }, data: { revokedAt: new Date() } });
    await decide(first.id, first.attempt, 'approve', '', 'MGR001', 403);
    await http('MGR001', 'GET', `/payroll/parameter-releases?subjectId=${subjectId}`, null, 403);
    await db.payrollGrant.update({ where: { id: originalGrant.id }, data: { revokedAt: null } });
    await db.payrollStandard.update({ where: { id: next.id }, data: { evidence: 'Fictional tamper probe' } });
    await decide(first.id, first.attempt, 'approve', '', 'MGR001', 409);
    await db.payrollStandard.update({ where: { id: next.id }, data: { evidence: next.evidence } });
    await decide(first.id, first.attempt, 'return');
    const second = await submit(next); assert.equal(second.attempt, first.attempt + 1);
    await decide(second.id, second.attempt);
    await decide(second.id, second.attempt, 'approve', '', 'MGR001', 409);
    passed.push('missing_manager_self_review_relation_change_revocation_and_snapshot_conflict_denied', 'return_resubmit_immutable_attempts');
    stage = 'effective_dates';
    assert.equal(JSON.stringify(await db.payrollStandard.findUnique({ where: { id: current[0].id } })), original);
    await http('HR001', 'POST', `/payroll/standards/${next.id}/disable`, null, 409);
    await http('HR001', 'POST', `/payroll/standards/${current[0].id}/disable`, null, 409);
    const jan = await calculate(); assert.equal(Number(jan.versions[0].gross), 10000); assert.deepEqual(jan.versions[0].issues, []);
    async function effective(at) {
      const standards = await db.payrollStandard.findMany({ where: { subjectId, employeeId, status: 'active' } });
      const links = (await db.payrollParameterRelease.findMany({ where: { subjectId, status: 'approved', standardId: { not: null } } }))
        .map(row => ({ parameterId: row.standardId, previousParameterId: row.previousParameterId }));
      return effectivePayrollParameters(standards, links, new Date(at));
    }
    assert.equal((await effective('2037-01-31'))[0].id, current[0].id);
    assert.equal((await effective('2037-02-01'))[0].id, next.id);
    assert.deepEqual(await effective('2037-03-01'), []);
    const earlier = await draft('13000', '2037-01-01');
    await http('HR001', 'POST', `/payroll/parameters/standard/${earlier.id}/submit`, { expectedVersion: earlier.version }, 409);
    passed.push('future_date_switch_expiry_no_resurrection_old_definition_immutable');
    stage = 'concurrency';
    const competing = [await draft('13000'), await draft('14000')], requests = [];
    for (const row of competing) requests.push(await submit(row));
    const responses = await Promise.all(requests.map(row => fetch(`http://127.0.0.1:3000/api/v1/payroll/parameter-releases/${row.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.MGR001}` },
      body: JSON.stringify({ expectedVersion: row.attempt, decision: 'approve', note: 'Fictional concurrent publication' }), signal: AbortSignal.timeout(30000), redirect: 'error' })));
    assert.deepEqual(responses.map(row => row.status).sort(), [201, 409]);
    const loser = requests[responses.findIndex(row => row.status === 409)];
    await http('HR001', 'POST', `/payroll/parameter-releases/${loser.id}/withdraw`, { expectedVersion: loser.attempt, note: 'Fictional stale predecessor withdrawn' });
    assert.equal((await effective('2037-02-01')).length, 1); assert.deepEqual(await effective('2037-03-01'), []);
    passed.push('concurrent_publish_one_success_no_fork_same_date_revision');
    stage = 'constraints';
    const release = await db.payrollParameterRelease.findUnique({ where: { id: second.id } });
    const payload = { subjectId, domain: 'validation', kind: 'standard', standardId: release.standardId, attempt: 99, parameterVersion: release.parameterVersion,
      submittedById: actors.HR001, reviewerId: actors.HR001, snapshot: release.snapshot, snapshotHash: release.snapshotHash };
    await assert.rejects(db.payrollParameterRelease.create({ data: payload }));
    await assert.rejects(db.payrollParameterRelease.create({ data: { ...payload, reviewerId: actors.MGR001, status: 'approved' } }));
    assert.equal(await db.payrollParameterRelease.count({ where: { subjectId, attempt: 99 } }), 0);
    passed.push('database_no_self_review_and_single_approved_version_constraints');
    stage = 'approved_definition';
    const policy = await db.payrollPolicy.findFirst({ where: { subjectId, status: 'active' } });
    const broken = structuredClone(policy.config); broken.workCalendars[month].sourceVersion = 'fictional-tamper';
    try {
      await db.payrollPolicy.update({ where: { id: policy.id }, data: { config: broken } });
      const blocked = await calculate(); assert.equal(blocked.versions[0].gross, null); assert.ok(blocked.versions[0].issues.some(issue => issue.includes('审核快照')));
    } finally { await db.payrollPolicy.update({ where: { id: policy.id }, data: { config: policy.config } }); }
    assert.equal(Number((await calculate()).versions[0].gross), 10000);
    passed.push('published_snapshot_tamper_blocks_calculation_and_restore_recovers');
    return { fictional: true, count: passed.length, passed, productionTouched: false };
  } catch { throw new Error(`parameter_verification_${stage}_failed`); }
  finally {
    if (originalManager) await db.user.update({ where: { id: actors.HR001 }, data: { directManagerId: originalManager } });
    if (originalGrant) await db.payrollGrant.update({ where: { id: originalGrant.id }, data: { revokedAt: originalGrant.revokedAt } });
    await db.$disconnect();
  }
}
if (require.main === module) {
  try {
    const value = inspectFixture('api');
    const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 180000,
      input: `(${verify.toString()})(${JSON.stringify(value)}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});` });
    if (result.status !== 0) throw new Error(result.stderr?.trim() || 'parameter_verification_refused'); process.stdout.write(result.stdout);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
