'use strict';
const { spawnSync } = require('node:child_process');

async function verify(inspectOnly = false) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient, Prisma } = require('@prisma/client');
  const assert = require('node:assert/strict');
  const { randomUUID, randomBytes } = require('node:crypto');
  const D = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' }), tokens = {}, passed = [];
  let stage = 'guard';
  async function http(actor, method, path, body, status = method === 'GET' ? 200 : 201) {
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, {
      method, signal: AbortSignal.timeout(30000), redirect: 'error',
      headers: { 'content-type': 'application/json', ...(tokens[actor] ? { authorization: 'Bearer ' + tokens[actor] } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status !== status) throw Object.assign(new Error('unexpected_http_status'), { check: `http_${response.status}_expected_${status}` });
    if (status >= 400) { await response.body?.cancel(); return; }
    const json = await response.json(); assert.equal(json.code, 0); return json.data;
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal(process.env.PAYROLL_ENABLED, 'true'); assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED, 'true');
    const m = (await db.systemConfig.findUnique({ where: { key: 'payroll_net_preview_net-manual-api_v1' } }))?.value;
    const owner = (await db.systemConfig.findUnique({ where: { key: 'payroll_parameter_preview_net-manual-api_v1' } }))?.value;
    for (const marker of [m, owner]) {
      assert.equal(marker?.fictional, true); assert.equal(marker.state, 'ready');
      assert.equal(marker.scope, 'net-manual-api'); assert.equal(marker.month, '2037-01'); assert.equal(marker.payMonth, '2037-02');
    }
    assert.equal(m.subjectId, owner.subjectId); assert.equal(m.employeeId, owner.employeeId); assert.equal(m.payDate, '2037-02-10');
    assert.notEqual(m.batchId, owner.batchId);
    const subject = await db.contractSubject.findUnique({ where: { id: m.subjectId }, select: { name: true } });
    assert.ok(subject?.name.startsWith('\u53c2\u6570\u53d1\u5e03\uff08\u865a\u6784\uff09-net-manual-api-'));
    const employee = await db.user.findUnique({ where: { id: m.employeeId }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    assert.ok(employee?.employeeNo.startsWith('PAY-PARAM-')); assert.ok(!employee.dingtalkId && !employee.dingtalkUnionId);
    for (const actor of ['HR001', 'MGR001', 'VP001', 'EMP001']) {
      assert.equal(m.actors[actor], owner.actors[actor]);
      const user = await db.user.findUnique({ where: { id: m.actors[actor] }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
      assert.equal(user?.employeeNo, actor); assert.ok(!user.dingtalkId && !user.dingtalkUnionId);
    }
    assert.notEqual(m.employeeId, m.actors.EMP001);
    assert.equal(await db.employmentRecord.count({ where: { userId: m.actors.EMP001, contractSubjectId: m.subjectId } }), 0);
    const base = (await db.systemConfig.findUnique({ where: { key: 'payroll_preview_fixture_v1' } }))?.value;
    assert.equal(base?.fictional, true); assert.ok(base.employeeIds?.length); assert.ok(base.subjectIds?.length);
    assert.ok(!base.subjectIds.includes(m.subjectId));
    const foreignEmployeeId = base.employeeIds[0];
    const foreignEmployee = await db.user.findUnique({ where: { id: foreignEmployeeId }, select: { employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    assert.ok(foreignEmployee?.employeeNo.startsWith('PAY-DEMO-')); assert.ok(!foreignEmployee.dingtalkId && !foreignEmployee.dingtalkUnionId);
    assert.ok(await db.employmentRecord.count({ where: { userId: foreignEmployeeId, contractSubjectId: { in: base.subjectIds } } }) > 0);
    assert.equal(await db.employmentRecord.count({ where: { userId: foreignEmployeeId, contractSubjectId: m.subjectId } }), 0);
    const facts = async () => ({
      paid: await db.payrollNetPayment.count({ where: { subjectId: m.subjectId } }),
      gross: await db.payrollSettlement.count({ where: { line: { version: { batch: { subjectId: m.subjectId } } } } }),
    });
    const noPaidFacts = async () => assert.deepEqual(await facts(), { paid: 0, gross: 0 });
    const profile = await db.payrollDeductionProfile.findUnique({ where: { id: m.profileId } });
    assert.equal(profile.subjectId, m.subjectId); assert.equal(profile.employeeId, m.employeeId);
    assert.equal(profile.domain, 'validation'); assert.equal(profile.status, 'active');
    assert.equal(profile.payDate.toISOString().slice(0, 10), m.payDate);
    const settings = profile.settings, fields = ['exemptIncome', 'standardDeduction', 'specialDeduction', 'additionalDeduction', 'otherDeduction', 'taxRelief'];
    const money = value => new D(value).toFixed(2);
    assert.equal(settings.rounding, 'component_half_up');
    for (const kind of ['socialInsurance', 'housingFund']) {
      assert.equal(settings[kind].ruleVersion, 'fictional-preview-contribution-v1'); assert.equal(settings[kind].status, 'applicable');
      assert.equal(settings[kind].items.length, 1); assert.equal(money(settings[kind].items[0].base), '1000.00');
      assert.equal(new D(settings[kind].items[0].rate).toString(), '0.1');
    }
    assert.equal(settings.tax.ruleVersion, 'fictional-preview-tax-v1'); assert.equal(settings.tax.method, 'resident_cumulative_wage');
    assert.deepEqual(settings.tax.brackets, [{ upTo: null, rate: '0.1', quickDeduction: '0' }]);
    assert.equal(settings.tax.opening.confirmed, true); assert.equal(settings.ledger.startDate, '2037-01-01');
    for (const field of [...fields, 'income', 'taxPaid']) assert.equal(money(settings.tax.opening[field]), '0.00');
    for (const field of fields) {
      assert.equal(money(settings.tax.current[field]), field === 'specialDeduction' ? '200.00' : '0.00');
      assert.equal(money(settings.ledger.priorInPayMonth[field]), '0.00');
    }
    assert.equal(money(settings.ledger.priorSocialInsurance), '0.00'); assert.equal(money(settings.ledger.priorHousingFund), '0.00');
    // Independent arithmetic for this pinned fictional profile, not a second call to the production calculator.
    function expectedNet(gross) {
      const contribution = kind => money(settings[kind].items.reduce((sum, item) => sum.plus(new D(item.base).times(item.rate)), new D(0)));
      const socialInsurance = contribution('socialInsurance'), housingFund = contribution('housingFund');
      const deductions = fields.filter(field => field !== 'taxRelief').reduce((sum, field) => sum.plus(settings.tax.current[field]), new D(0));
      const bracket = settings.tax.brackets[0];
      const incomeTax = money(D.max(0, new D(gross).minus(deductions).times(bracket.rate).minus(bracket.quickDeduction).minus(settings.tax.current.taxRelief)));
      return { gross: money(gross), socialInsurance, housingFund, incomeTax, net: money(new D(gross).minus(socialInsurance).minus(housingFund).minus(incomeTax)) };
    }
    await noPaidFacts();
    for (const actor of ['HR001', 'MGR001', 'VP001', 'EMP001']) tokens[actor] = (await http('', 'POST', '/auth/test-login', { employeeNo: actor }, 200)).token;
    let batch = await http('HR001', 'GET', `/payroll/batches/${m.batchId}`);
    if (inspectOnly) {
      stage = 'inspect_approved_count';
      const where = { batch: { subjectId: m.subjectId } }, orderBy = { id: 'asc' };
      const before = JSON.stringify(await db.payrollVersion.findMany({ where, orderBy }));
      const rows = await db.payrollBatch.findMany({ where: { subjectId: m.subjectId, purpose: 'validation', status: 'approved' }, select: { id: true } });
      assert.equal(rows.length, 2);
      for (const row of rows) {
        stage = row.id === m.batchId ? 'inspect_cancelled_original' : 'inspect_corrected_current';
        const value = await http('HR001', 'GET', `/payroll/batches/${row.id}`);
        assert.equal(value.versions[0].needsUpdate, false);
        if (row.id !== m.batchId) {
          stage = 'inspect_corrected_gross';
          assert.equal(money(value.versions[0].gross), '11300.00');
          stage = 'inspect_corrected_net';
          assert.equal(value.versions[0].netSnapshot.totals.net, '9990.00');
        }
      }
      stage = 'inspect_unchanged_snapshots';
      await http('EMP001', 'GET', `/payroll/batches/${rows[0].id}`, undefined, 403);
      await noPaidFacts();
      assert.equal(JSON.stringify(await db.payrollVersion.findMany({ where, orderBy })), before);
      return { fictional: true, ok: true, inspectOnly: true, count: 2, paidFacts: 0, snapshotsUnchanged: true, productionTouched: false };
    }
    assert.equal(batch.status, 'draft'); assert.equal(batch.subjectId, m.subjectId); assert.equal(batch.purpose, 'validation');
    assert.equal(batch.month, m.month); assert.equal(batch.payMonth, m.payMonth);
    const rules = await http('HR001', 'GET', `/payroll/rules?subjectId=${m.subjectId}`);
    assert.equal(rules.length, 1);
    const rule0 = rules[0]; assert.equal(rule0.status, 'active'); assert.equal(rule0.domain, 'validation');
    const initial = rule0.config.performance[m.month];
    assert.equal(initial.sourceKind, 'manual'); assert.deepEqual(initial.manualAmounts, { [m.employeeId]: '0.00' }); assert.ok(initial.evidenceRef);
    function ruleBody(amount, evidenceRef, employeeId = m.employeeId) {
      const config = structuredClone(rule0.config);
      config.performance[m.month] = { sourceKind: 'manual', manualAmounts: { [employeeId]: amount }, evidenceRef, cycleIds: [], coefficients: {} };
      return { subjectId: m.subjectId, effectiveFrom: `${m.month}-01`, config };
    }
    async function activeRule(id, amount) {
      const row = (await http('HR001', 'GET', `/payroll/rules?subjectId=${m.subjectId}`)).find(rule => rule.id === id);
      assert.equal(row?.status, 'active'); assert.equal(row.config.performance[m.month].manualAmounts[m.employeeId], amount);
    }
    stage = 'scope';
    const rulesBefore = await db.payrollPolicy.count({ where: { subjectId: m.subjectId } });
    await http('HR001', 'POST', '/payroll/rules', ruleBody('1.00', 'Fictional cross-subject rejection', foreignEmployeeId), 400);
    await http('EMP001', 'POST', '/payroll/rules', ruleBody('1234.56', 'Fictional unauthorized rejection'), 403);
    await http('EMP001', 'GET', `/payroll/rules?subjectId=${m.subjectId}`, null, 403);
    await http('EMP001', 'GET', `/payroll/batches/${batch.id}`, null, 403);
    assert.equal(await db.payrollPolicy.count({ where: { subjectId: m.subjectId } }), rulesBefore);
    passed.push('explicit_zero_manual_rule_cross_subject_400_and_unauthorized_403');

    stage = 'parameter_return_resubmit';
    const rule = await http('HR001', 'POST', '/payroll/rules', ruleBody('1234.56', 'Fictional HR confirmed manual performance 1234.56'));
    assert.equal(rule.status, 'draft');
    let release = await http('HR001', 'POST', `/payroll/parameters/rule/${rule.id}/submit`, { expectedVersion: rule.version });
    assert.equal(release.status, 'pending'); assert.equal(release.reviewerId, m.actors.MGR001);
    await http('HR001', 'POST', `/payroll/parameter-releases/${release.id}/decide`, { expectedVersion: release.attempt, decision: 'approve', note: '' }, 403);
    release = await http('MGR001', 'POST', `/payroll/parameter-releases/${release.id}/decide`, { expectedVersion: release.attempt, decision: 'return', note: 'Fictional manual basis review returned' });
    assert.equal(release.status, 'returned');
    const previousAttempt = release.attempt, returnedReleaseId = release.id;
    release = await http('HR001', 'POST', `/payroll/parameters/rule/${rule.id}/submit`, { expectedVersion: rule.version });
    assert.equal(release.attempt, previousAttempt + 1); assert.notEqual(release.id, returnedReleaseId);
    release = await http('MGR001', 'POST', `/payroll/parameter-releases/${release.id}/decide`, { expectedVersion: release.attempt, decision: 'approve', note: 'Fictional reviewed manual amount and evidence' });
    assert.equal(release.status, 'approved'); await activeRule(rule.id, '1234.56');
    passed.push('hr_manual_parameter_manager_return_resubmit_publish_and_self_review_403');

    function assertCalculation(value, amount, policyId) {
      const version = value.versions[0], gross = money(new D(10000).plus(amount));
      assert.deepEqual(version.issues, []); assert.equal(money(version.gross), gross);
      assert.equal(version.netSnapshot.payDate, m.payDate); assert.equal(version.netSnapshot.domain, 'validation');
      assert.deepEqual(version.netSnapshot.totals, expectedNet(gross)); assert.equal(version.netSnapshot.rows.length, 1);
      const row = version.netSnapshot.rows[0]; assert.equal(row.employeeId, m.employeeId); assert.equal(row.result.status, 'ready');
      for (const [key, expected] of Object.entries(expectedNet(gross))) assert.equal(row.result[key], expected);
      assert.equal(row.result.evidence.parameter.id, m.profileId); assert.deepEqual(row.ledger.factIds, []);
      assert.equal(version.lines.length, 5);
      assert.deepEqual(version.lines.map(line => line.itemCode).sort(), ['absence', 'adjustment', 'fixed', 'overtime', 'performance']);
      for (const line of version.lines) {
        assert.equal(line.employeeId, m.employeeId); assert.equal(line.attributionMonth, m.month); assert.equal(money(line.paidBefore), '0.00');
        const expected = line.itemCode === 'fixed' ? '10000.00' : line.itemCode === 'performance' ? amount : '0.00';
        assert.equal(money(line.entitlement), expected); assert.equal(money(line.amount), expected);
      }
      const sources = version.sources.months.find(entry => entry.month === m.month).sources;
      assert.deepEqual(sources.performance, []); assert.equal(sources.manualPerformance.length, 1);
      assert.deepEqual(sources.manualPerformance[0].entries, [{ policyId, amount, evidenceRef: amount === '1234.56'
        ? 'Fictional HR confirmed manual performance 1234.56' : 'Fictional HR corrected manual performance 1300' }]);
    }
    async function approve(value) {
      value = await http('HR001', 'POST', `/payroll/batches/${value.id}/submit`, { expectedVersion: value.version });
      assert.equal(value.status, 'pending'); assert.deepEqual(value.versions[0].approvalPath, [m.actors.MGR001, m.actors.VP001]);
      assert.equal(value.versions[0].reviewerCount, 1);
      value = await http('MGR001', 'POST', `/payroll/batches/${value.id}/decide`, { expectedVersion: value.version, decision: 'approve', note: 'Fictional independent review' });
      assert.equal(value.status, 'pending'); assert.equal(value.versions[0].approvalStep, 1);
      value = await http('VP001', 'POST', `/payroll/batches/${value.id}/decide`, { expectedVersion: value.version, decision: 'approve', note: 'Fictional independent approval' });
      assert.equal(value.status, 'approved'); assert.equal(value.versions[0].needsUpdate, false);
      assert.deepEqual(value.versions[0].decisions.map(item => [item.step, item.actorId, item.action]), [[0, m.actors.MGR001, 'approve'], [1, m.actors.VP001, 'approve']]);
      await noPaidFacts(); return value;
    }
    const filePassword = randomBytes(16).toString('hex');
    async function excel(value, gross, performance) {
      const response = await fetch(`http://127.0.0.1:3000/api/v1/payroll/batches/${value.id}/export`, {
        method: 'POST', signal: AbortSignal.timeout(30000), redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens.VP001 },
        body: JSON.stringify({ expectedVersion: value.version, filePassword }),
      });
      assert.equal(response.status, 201);
      const encrypted = Buffer.from(await response.arrayBuffer()); assert.equal(encrypted.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
      const plain = await require('officecrypto-tool').decrypt(encrypted, { password: filePassword });
      const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(plain);
      const sheet = workbook.getWorksheet('\u5de5\u8d44\u5b9e\u53d1'); assert.equal(sheet.getCell('A1').value, '\u6d4b\u8bd5\u73af\u5883');
      assert.equal(sheet.getCell('E3').value, m.payDate);
      assert.deepEqual(['F3', 'G3', 'H3', 'I3', 'J3'].map(cell => sheet.getCell(cell).value), Object.values(expectedNet(gross)).map(Number));
      assert.equal(workbook.getWorksheet('\u5de5\u8d44\u660e\u7ec6').getCell('I3').value, Number(performance));
      assert.ok(workbook.getWorksheet('\u5ba1\u6279\u4f9d\u636e')); await noPaidFacts();
    }
    stage = 'first_calculation_approval';
    batch = await http('HR001', 'POST', `/payroll/batches/${batch.id}/calculate`, { expectedVersion: batch.version, payDate: m.payDate });
    assertCalculation(batch, '1234.56', rule.id); assert.deepEqual(expectedNet('11234.56'), { gross: '11234.56', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '1103.46', net: '9931.10' });
    batch = await approve(batch);
    const approvedId = batch.versions[0].id;
    const approvedJSON = async () => JSON.stringify(await db.payrollVersion.findUnique({ where: { id: approvedId },
      include: { lines: { orderBy: { id: 'asc' } }, decisions: { orderBy: { step: 'asc' } } } }));
    const original = await approvedJSON();
    await excel(batch, '11234.56', '1234.56'); assert.equal(await approvedJSON(), original);
    passed.push('approved_11234_56_gross_9931_10_net_and_encrypted_excel_without_payment');

    stage = 'published_manual_source_change';
    const revision = await http('HR001', 'POST', '/payroll/rules', ruleBody('1300.00', 'Fictional HR corrected manual performance 1300'));
    const amendment = await http('HR001', 'POST', `/payroll/parameters/rule/${revision.id}/submit`, { expectedVersion: revision.version });
    const published = await http('MGR001', 'POST', `/payroll/parameter-releases/${amendment.id}/decide`, { expectedVersion: amendment.attempt, decision: 'approve', note: 'Fictional corrected manual amount reviewed' });
    assert.equal(published.status, 'approved'); await activeRule(revision.id, '1300.00');
    batch = await http('HR001', 'GET', `/payroll/batches/${batch.id}`);
    assert.equal(batch.status, 'approved'); assert.equal(batch.versions[0].needsUpdate, true);
    await http('VP001', 'POST', `/payroll/batches/${batch.id}/export`, { expectedVersion: batch.version, filePassword }, 409);
    await http('VP001', 'POST', `/payroll/batches/${batch.id}/net-payment`, { expectedVersion: batch.version, employeeId: m.employeeId,
      payDate: m.payDate, reference: 'Fictional stale payment must be refused', requestId: randomUUID() }, 409);
    await noPaidFacts(); assert.equal(await approvedJSON(), original);
    passed.push('published_1300_marks_unpaid_approval_stale_blocks_export_and_payment_preserves_snapshot');

    stage = 'cancel_unpaid_recover';
    batch = await http('VP001', 'POST', `/payroll/batches/${batch.id}/cancel-net-remainder`, { expectedVersion: batch.version,
      employeeId: m.employeeId, reference: 'Fictional unpaid manual arrangement cancelled for recalculation' });
    assert.equal(await db.payrollNetReservation.count({ where: { subjectId: m.subjectId } }), 0);
    assert.equal(await db.payrollReservation.count({ where: { subjectId: m.subjectId } }), 0);
    assert.equal(await approvedJSON(), original); await noPaidFacts();
    await http('VP001', 'POST', `/payroll/batches/${batch.id}/export`, { expectedVersion: batch.version, filePassword }, 409);
    let next = await http('HR001', 'POST', '/payroll/batches', { subjectId: m.subjectId, month: m.month, payMonth: m.payMonth,
      purpose: 'validation', correctionOfId: batch.id });
    assert.notEqual(next.id, batch.id);
    next = await http('HR001', 'POST', `/payroll/batches/${next.id}/calculate`, { expectedVersion: next.version, payDate: m.payDate });
    assertCalculation(next, '1300.00', revision.id); assert.deepEqual(expectedNet('11300.00'), { gross: '11300.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '1110.00', net: '9990.00' });
    next = await approve(next); await excel(next, '11300.00', '1300.00');
    assert.equal(await approvedJSON(), original); await noPaidFacts();
    assert.equal(await db.payrollNetReservation.count({ where: { subjectId: m.subjectId } }), 1);
    assert.equal(await db.payrollReservation.count({ where: { subjectId: m.subjectId } }), 2);
    passed.push('cancelled_unpaid_new_approval_1300_once_11300_gross_9990_net_original_json_unchanged');

    stage = 'trial';
    let trial = await http('HR001', 'GET', `/payroll/batches/${owner.batchId}`);
    assert.equal(trial.subjectId, m.subjectId); assert.equal(trial.purpose, 'trial');
    trial = await http('HR001', 'POST', `/payroll/batches/${trial.id}/calculate`, { expectedVersion: trial.version, payDate: m.payDate });
    assertCalculation(trial, '1300.00', revision.id);
    await http('HR001', 'POST', `/payroll/batches/${trial.id}/submit`, { expectedVersion: trial.version }, 409);
    await http('VP001', 'POST', `/payroll/batches/${trial.id}/export`, { expectedVersion: trial.version, filePassword }, 403);
    await noPaidFacts(); assert.equal(await approvedJSON(), original);
    passed.push('trial_submit_409_export_403_no_paid_facts');
    return { fictional: true, ok: true, count: passed.length, passed, paidFacts: 0, productionTouched: false };
  } catch (error) {
    return { fictional: true, ok: false, stage, check: /^http_\d{3}_expected_\d{3}$/.test(error?.check) ? error.check
      : error?.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'operation_failed', passed, productionTouched: false };
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  // Only the fixed preview container is eligible; no fixture preparation, cleanup, or production commands.
  const inspection = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}', 'hrm-api-1'], { encoding: 'utf8', timeout: 10000 });
  if (inspection.status !== 0 || inspection.stdout.trim() !== 'hrm api true') {
    process.stderr.write('manual_preview_container_guard_refused\n'); process.exitCode = 1;
  } else {
    const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 180000,
      input: `(${verify.toString()})(${process.argv.includes('--inspect')}).then(r=>{console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({fictional:true,ok:false,stage:'guard',check:'verification_refused'}));process.exitCode=1;});` });
    try {
      const summary = JSON.parse(result.stdout);
      if (summary?.fictional !== true || typeof summary.ok !== 'boolean') throw new Error('invalid_summary');
      process.stdout.write(JSON.stringify(summary) + '\n');
      if (result.status !== 0 || !summary.ok) process.exitCode = 1;
    } catch { process.stderr.write('manual_preview_verification_refused\n'); process.exitCode = 1; }
  }
}
