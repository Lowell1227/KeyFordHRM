'use strict';

const { spawnSync } = require('node:child_process');

// Runs only inside the existing isolated preview container; tokens never leave that process.
async function inspectOrVerify(verify) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient } = require('@prisma/client');
  const { createHash } = require('node:crypto');
  const assert = require('node:assert/strict');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  let stage = 'guard';
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal(process.env.PAYROLL_ENABLED, 'true'); assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED, 'true');
    const markers = await db.systemConfig.findMany({ where: { key: { in: ['local_preview_fixture_v1', 'payroll_preview_fixture_v1', 'payroll_deductions_preview_fixture_v1'] } }, orderBy: { key: 'asc' } });
    assert.equal(markers.length, 3); assert.ok(markers.every(row => row.value.fictional === true));
    const fixture = markers.find(row => row.key === 'payroll_deductions_preview_fixture_v1').value;
    assert.equal(fixture.state, 'ready'); assert.equal(fixture.subjectIds.length, 2); assert.equal(fixture.employeeIds.length, 3);
    const subjects = await db.contractSubject.findMany({ where: { id: { in: fixture.subjectIds } }, select: { id: true, name: true } });
    assert.equal(subjects.length, 2); assert.ok(subjects.every(row => row.name.startsWith('扣缴预览') && row.name.includes('虚构')));
    const employees = await db.user.findMany({ where: { id: { in: fixture.employeeIds } }, select: { id: true, name: true, employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    assert.equal(employees.length, 3); assert.ok(employees.every(row => row.name.includes('虚构') && row.employeeNo.startsWith('PAY-DEDUCT-') && !row.dingtalkId && !row.dingtalkUnionId));
    const actors = await db.user.findMany({ where: { id: { in: Object.values(fixture.actors) } }, select: { name: true, dingtalkId: true, dingtalkUnionId: true } });
    assert.equal(actors.length, Object.values(fixture.actors).length); assert.ok(actors.every(row => row.name.startsWith('测试') && !row.dingtalkId && !row.dingtalkUnionId));
    async function fingerprint() {
      const values = await db.$transaction(async tx => {
        const result = {};
        for (const model of ['payrollGrant', 'payrollPolicy', 'payrollStandard', 'payrollAttendanceSnapshot', 'payrollBatch', 'payrollVersion', 'payrollLine', 'payrollDecision', 'payrollSettlement', 'payrollOpeningBalance', 'payrollExportRecord', 'payrollEvent', 'payrollAdjustment']) {
          result[model] = await tx[model].findMany({ orderBy: { id: 'asc' } });
        }
        result.reservations = await tx.payrollReservation.findMany({ orderBy: [{ subjectId: 'asc' }, { employeeId: 'asc' }, { attributionMonth: 'asc' }, { itemCode: 'asc' }] });
        result.markers = await tx.systemConfig.findMany({ where: { key: { in: markers.map(row => row.key) } }, orderBy: { key: 'asc' } });
        return result;
      });
      return createHash('sha256').update(JSON.stringify(values)).digest('hex');
    }
    const baseline = await fingerprint();
    const batches = await db.payrollBatch.findMany({ where: { id: { in: [...fixture.batchIds, fixture.approvedBatchId] }, subjectId: { in: fixture.subjectIds } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { lines: true, decisions: true } } } });
    assert.equal(batches.length, 3);
    const receipt = { fictional: true, month: fixture.month, payMonth: fixture.payMonth, actors: fixture.actors, baseline,
      subjects: fixture.subjectIds.map((id, index) => ({ id, name: subjects.find(row => row.id === id).name, batchId: fixture.batchIds[index] })),
      approvedBatchId: fixture.approvedBatchId, batches: batches.map(batch => ({ id: batch.id, subjectId: batch.subjectId, version: batch.version, status: batch.status,
        calculationVersion: batch.versions[0].version, sourceHash: batch.versions[0].sourceHash })), employees: employees.map(({ id, name }) => ({ id, name })) };
    if (!verify) return receipt;
    const tokens = {};
    async function http(actor, path, body) {
      const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}) }, body: JSON.stringify(body) });
      return { response, body: await response.json() };
    }
    stage = 'fictional_auth';
    for (const actor of ['HR001', 'EMP001', 'EMP002', 'EMP003']) {
      const result = await http('', '/auth/test-login', { employeeNo: actor });
      assert.equal(result.response.status, 200); assert.equal(result.body.data.user.id, fixture.actors[actor]); tokens[actor] = result.body.data.token;
    }
    let checks = 0;
    const payDate = `${fixture.payMonth}-05`;
    for (const [index, id] of [...fixture.batchIds, fixture.approvedBatchId].entries()) {
      stage = `complete_batch_${index + 1}`;
      const batch = batches.find(row => row.id === id), actor = index === 1 ? 'EMP003' : 'HR001';
      const result = await http(actor, `/payroll/batches/${id}/deductions-preview`, { expectedVersion: batch.version, payDate, mode: 'complete' });
      assert.equal(result.response.status, 201); assert.match(result.response.headers.get('cache-control'), /no-store/);
      const value = result.body.data; assert.equal(value.basis, 'fictional'); assert.equal(value.approvalStatus, 'not_submitted');
      assert.equal(value.subjectId, batch.subjectId); assert.equal(value.batchVersion, batch.version); assert.equal(value.sourceHash, batch.versions[0].sourceHash);
      assert.equal(value.calculationVersion, batch.versions[0].version); assert.equal(value.calculationVersionId, batch.versions[0].id);
      assert.equal(value.payDate, payDate); assert.equal(value.rows.length, index === 1 ? 1 : 2);
      for (const row of value.rows) {
        assert.equal(row.status, 'ready'); assert.match(row.evidence.sourceHash, /^[a-f0-9]{64}$/);
        const amount = batch.versions[0].lines.filter(line => line.employeeId === row.employeeId).reduce((sum, line) => sum.add(line.amount), new (require('@prisma/client').Prisma.Decimal)(0));
        assert.equal(row.gross, amount.toFixed(2)); assert.equal(row.socialInsurance, '100.00'); assert.equal(row.housingFund, '100.00');
        assert.equal(row.incomeTax, amount.sub(200).mul('0.1').toFixed(2)); assert.equal(row.net, amount.sub(200).mul('0.9').toFixed(2));
      }
      assert.equal(value.totals.gross, index === 1 ? '3000.00' : '18000.00'); assert.equal(value.totals.net, index === 1 ? '2520.00' : '15840.00'); checks++;
      stage = `missing_batch_${index + 1}`;
      const missing = await http(actor, `/payroll/batches/${id}/deductions-preview`, { expectedVersion: batch.version, payDate, mode: 'missing' });
      assert.equal(missing.response.status, 201); assert.equal(missing.body.data.totals, null);
      assert.equal(missing.body.data.rows.filter(row => row.status === 'needs_configuration').length, 1);
      assert.equal(missing.body.data.rows.find(row => row.status === 'needs_configuration').net, null); checks++;
    }
    const first = batches.find(row => row.id === fixture.batchIds[0]), path = `/payroll/batches/${first.id}/deductions-preview`;
    const valid = { expectedVersion: first.version, payDate, mode: 'complete' };
    stage = 'invalid_requests';
    for (const body of [{ ...valid, payDate: '2035-02-31' }, { ...valid, payDate: '2036-01-01' }, { ...valid, payDate: undefined }, { ...valid, gross: '1' }, { ...valid, employeeId: fixture.employeeIds[2] }, { ...valid, mode: 'formal' }]) {
      assert.equal((await http('HR001', path, body)).response.status, 400); checks++;
    }
    assert.equal((await http('HR001', path, { ...valid, expectedVersion: first.version - 1 })).response.status, 409); checks++;
    stage = 'scope_denials';
    for (const actor of ['EMP001', 'EMP002', 'EMP003']) { assert.equal((await http(actor, path, valid)).response.status, 403); checks++; }
    const second = batches.find(row => row.id === fixture.batchIds[1]);
    assert.equal((await http('HR001', `/payroll/batches/${second.id}/deductions-preview`, { ...valid, expectedVersion: second.version })).response.status, 403); checks++;
    assert.equal((await http('', path, valid)).response.status, 401); checks++;
    stage = 'persistent_state_unchanged'; assert.equal(await fingerprint(), baseline); checks++;
    return { passed: true, checks, fictional: true, persistentStateUnchanged: true, baseline, batchCount: 3, subjectCount: 2 };
  } catch { throw new Error(`deductions_preview_verification_failed:${stage}`); }
  finally { await db.$disconnect(); }
}

function run(verify = false) {
  const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
  if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') throw new Error('Preview container guard refused');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    input: `(${inspectOrVerify.toString()})(${verify}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`,
    encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || 'Guarded verification refused');
  return JSON.parse(result.stdout);
}
module.exports.inspectFixture = () => run(false);
if (require.main === module) {
  try { console.log(JSON.stringify(run(true))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
