import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { saveDeductionDrafts, applyApprovedDeductionRules, emptyDeductionSettings } from '../../src/views/compensation/payroll/payroll-deduction-form';

test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'desktop', 'PG/API evidence runs once; responsive UI evidence is separate'); });
async function control(op: string, input = {}) {
  const response = await fetch(`http://127.0.0.1:3011/__usability-ui/${op}`, { method: 'POST',
    headers: { 'x-usability-ui-run': process.env.HRM_USABILITY_UI_RUN!, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json(); expect(response.status, body.message).toBe(200); return body;
}
async function sessions(request: APIRequestContext, f: any) {
  const tokens: Record<string, string> = {};
  for (const [role, credentials] of Object.entries(f.credentials)) {
    const response = await request.post('/api/v1/auth/login', { data: credentials });
    expect(response.status(), `actual AuthService ${role}`).toBe(200);
    tokens[role] = (await response.json()).data.token;
    expect(tokens[role]).toBeTruthy();
  }
  return async (role: string, method: string, path: string, data?: unknown, status = method === 'GET' ? 200 : 201) => {
    const response = await request.fetch(`/api/v1/payroll${path}`, { method, data, headers: { Authorization: `Bearer ${tokens[role]}` } });
    const body = await response.json();
    expect(response.status(), `${method} ${path}: ${body.message ?? ''}`).toBe(status);
    return body.data;
  };
}

test('API: paid history uses full entitlement for net/readiness while reconciliation cannot submit/export/pay', async ({ request }) => {
  const f = await control('create', { scenario: 'paid' }), api = await sessions(request, f);
  const batch = await api('hr', 'GET', `/batches/${f.batchId}`), version = batch.versions[0];
  expect(version.issues).toEqual([]);
  expect(version.netSnapshot.totals.gross).toBe('11234.56'); expect(version.netSnapshot.totals.net).toBe('9931.10');
  expect(version.lines.filter((line: any) => line.itemCode === 'fixed')[0].paidBefore).toBe('10000');
  expect(version.lines.every((line: any) => Number(line.amount) === 0)).toBe(true);
  const receiptId = randomUUID();
  let receipt = await api('hr', 'POST', '/readiness/requests', { batchId: f.batchId, expectedVersion: batch.version, firstMonth: '2025-11', requestId: receiptId, reference: 'fictional full net historical comparison' });
  await api('hr', 'POST', `/readiness/requests/${receiptId}/decide`, { expectedVersion: receipt.request.version, decision: 'approve', note: '' }, 403);
  for (const role of ['reviewer', 'approver']) receipt = await api(role, 'POST', `/readiness/requests/${receiptId}/decide`, { expectedVersion: receipt.request.version, decision: 'approve', note: 'fictional checked' });
  expect((await api('hr', 'GET', `/readiness?subjectId=${f.subjectId}`)).ready).toBe(true);
  await api('hr', 'POST', `/batches/${f.batchId}/submit`, { expectedVersion: batch.version }, 409);
  await api('hr', 'POST', `/batches/${f.batchId}/export`, { expectedVersion: batch.version, filePassword: randomUUID() }, 403);
  await api('approver', 'POST', `/batches/${f.batchId}/net-payment`, { expectedVersion: batch.version, employeeId: f.employeeId, requestId: randomUUID(), payDate: f.payDate, reference: 'must reject reconciliation payment' }, 409);
  const inspected = await control('inspect', { subjectId: f.subjectId });
  expect(inspected.finances).toEqual({ payments: 0, reservations: 0, settlements: 0, exports: 0 });
  expect(inspected.frozenUnchanged).toBe(true);
});

test('API: absence needs editor proposal/sealer proof, rejects unauthorized/stale/evidence drift and calculates a new sealed version', async ({ request }) => {
  const f = await control('create', { scenario: 'absence' }), api = await sessions(request, f);
  const input = { expectedVersion: f.absenceVersion, employeeId: f.employeeId, workDate: f.workDate, reference: 'fictional approved schedule and employee evidence', requestId: randomUUID() };
  await api('outsider', 'GET', `/attendance/${f.absenceId}/absence`, undefined, 403);
  await api('outsider', 'POST', `/attendance/${f.absenceId}/absence`, input, 403);
  await api('hr', 'POST', `/attendance/${f.absenceId}/absence`, { ...input, expectedVersion: 1 }, 409);
  await api('hr', 'POST', `/attendance/${f.absenceId}/absence`, input);
  await api('hr', 'POST', `/attendance/${f.absenceId}/absence/${input.requestId}/decide`, { expectedVersion: f.absenceVersion, decision: 'approve', note: 'not a sealer' }, 403);
  const accepted = await api('sealer', 'POST', `/attendance/${f.absenceId}/absence/${input.requestId}/decide`, { expectedVersion: f.absenceVersion, decision: 'approve', note: 'fictional independently checked' });
  expect(accepted.version).toBe(f.absenceVersion + 1); expect(accepted.payload.confirmedAbsences).toHaveLength(1);
  expect(accepted.payload.issues).toEqual([]);
  await api('hr', 'POST', `/attendance/${f.absenceId}/absence`, { ...input, requestId: randomUUID() }, 409);
  await api('hr', 'POST', `/attendance/${accepted.id}/review`, { note: 'fictional attendance checked' });
  await api('sealer', 'POST', `/attendance/${accepted.id}/seal`, { expectedVersion: accepted.version });
  const calculated = await api('hr', 'POST', `/batches/${f.batchId}/calculate`, { expectedVersion: f.batchVersion, payDate: f.payDate });
  expect(calculated.versions[0].issues).toEqual([]);
  expect(Number(calculated.versions[0].lines.find((line: any) => line.itemCode === 'absence').amount)).toBe(-500);
  const inspected = await control('inspect', { subjectId: f.subjectId });
  expect(inspected.frozenUnchanged).toBe(true);
  expect(inspected.events.map((event: any) => event.action)).toEqual(expect.arrayContaining(['absence_proposed', 'absence_confirmed']));
  const resynced = await control('resync-confirmed', { subjectId: f.subjectId });
  expect(resynced.payload.confirmedAbsences).toHaveLength(1);
  const revoked = await api('sealer', 'POST', `/attendance/${resynced.id}/absence/${input.requestId}/decide`, { expectedVersion: resynced.version, decision: 'revoke', note: 'fictional evidence withdrawn after resync' });
  expect(revoked.payload.confirmedAbsences).toEqual([]); expect(revoked.version).toBe(resynced.version + 1);
  const retained = await control('create', { scenario: 'absence' }), third = await sessions(request, retained);
  const retainedProposal = { ...input, employeeId: retained.employeeId, workDate: retained.workDate, expectedVersion: retained.absenceVersion, requestId: randomUUID() };
  await third('hr', 'POST', `/attendance/${retained.absenceId}/absence`, retainedProposal);
  const confirmed = await third('sealer', 'POST', `/attendance/${retained.absenceId}/absence/${retainedProposal.requestId}/decide`, { expectedVersion: retained.absenceVersion, decision: 'approve', note: 'fictional checked before scope change' });
  await control('expand-scope', { subjectId: retained.subjectId });
  const diff = await third('sealer', 'GET', `/attendance/${confirmed.id}/scope-diff`);
  const recovered = await third('sealer', 'POST', `/attendance/${confirmed.id}/recover-scope`, { snapshotVersion: diff.snapshotVersion, snapshotHash: diff.snapshotHash, scopeHash: diff.scopeHash, reason: 'fictional additional employee', requestId: randomUUID() });
  expect(recovered.payload.confirmedAbsences).toHaveLength(1);
  const withdrawn = await third('sealer', 'POST', `/attendance/${recovered.id}/absence/${retainedProposal.requestId}/decide`, { expectedVersion: recovered.version, decision: 'revoke', note: 'fictional withdrawal after scope recovery' });
  expect(withdrawn.payload.confirmedAbsences).toEqual([]);
  const changed = await control('create', { scenario: 'absence-evidence' }), second = await sessions(request, changed);
  const proposal = { ...input, employeeId: changed.employeeId, workDate: changed.workDate, expectedVersion: changed.absenceVersion, requestId: randomUUID() };
  await second('hr', 'POST', `/attendance/${changed.absenceId}/absence`, proposal);
  const advanced = await control('advance-evidence', { subjectId: changed.subjectId });
  await second('sealer', 'POST', `/attendance/${changed.absenceId}/absence/${proposal.requestId}/decide`, { expectedVersion: changed.absenceVersion, decision: 'approve', note: '' }, 409);
  await second('sealer', 'POST', `/attendance/${advanced.id}/absence/${proposal.requestId}/decide`, { expectedVersion: advanced.version, decision: 'approve', note: '' }, 409);
});

test('API: recovery/opening corrections preserve frozen sources and audit; stale/unauthorized/pending/paid arrangements reject', async ({ request }) => {
  for (const scenario of ['recovery', 'recovery-pending', 'recovery-paid']) {
    const f = await control('create', { scenario }), api = await sessions(request, f);
    const diff = await api('hr', 'GET', `/attendance/${f.attendanceId}/scope-diff`);
    expect(diff.added.length).toBe(31); expect(diff.removed).toEqual([]);
    const body = { snapshotVersion: diff.snapshotVersion, snapshotHash: diff.snapshotHash, scopeHash: diff.scopeHash, reason: 'fictional reviewed payer range changed', requestId: randomUUID() };
    const opening = await api('sealer', 'GET', `/openings/${f.openingId}/history`);
    const correction = { expectedHash: opening.currentHash, amount: '25', reference: 'fictional accounting correction receipt', reason: 'fictional data-entry error', requestId: randomUUID() };
    await api('outsider', 'POST', `/attendance/${f.attendanceId}/recover-scope`, body, 403);
    await api('hr', 'POST', `/attendance/${f.attendanceId}/recover-scope`, body, 403);
    if (scenario !== 'recovery') {
      expect(diff.blockedReason).toBeTruthy();
      await api('sealer', 'POST', `/attendance/${f.attendanceId}/recover-scope`, body, 409);
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, correction, 409);
    } else {
      await api('sealer', 'POST', `/attendance/${f.attendanceId}/recover-scope`, { ...body, scopeHash: '0'.repeat(64) }, 409);
      const restored = await api('sealer', 'POST', `/attendance/${f.attendanceId}/recover-scope`, body);
      expect(restored.version).toBe(diff.snapshotVersion + 1); expect(restored.status).toBe('draft');
      expect(restored.payload.sync.complete).toBe(false);
      await api('sealer', 'POST', `/attendance/${restored.id}/seal`, { expectedVersion: restored.version }, 409);
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, correction);
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, { ...correction, requestId: randomUUID(), amount: '30' }, 409);
      const history = await api('sealer', 'GET', `/openings/${f.openingId}/history`);
      expect(history.versions).toHaveLength(1); expect(history.versions[0].before.amount).toBe('0.00'); expect(history.versions[0].after.amount).toBe('25.00');
    }
    const inspected = await control('inspect', { subjectId: f.subjectId });
    expect(inspected.frozenUnchanged).toBe(true); expect(inspected.attendanceHistoryUnchanged).toBe(true);
  }
});

test('API: shared rule application does not carry personal opening; actual batch draft saves report partial success without approval', async ({ request }) => {
  const f = await control('create', { scenario: 'copy' });
  const response = await request.post('/api/v1/auth/login', { data: f.credentials.hr });
  const token = (await response.json()).data.token, headers = { Authorization: `Bearer ${token}` };
  const existing = await request.get(`/api/v1/payroll/deduction-profiles?subjectId=${f.subjectId}`, { headers });
  const source = (await existing.json()).data.find((row: any) => row.status === 'active');
  const common = applyApprovedDeductionRules(emptyDeductionSettings(), source, f.subjectId);
  expect(common.tax.opening.confirmed).toBe(false); expect(common.tax.opening.income).toBe('');
  expect(common.socialInsurance.items[0].base).toBe(''); expect(common.tax.ruleVersion).toBe(source.settings.tax.ruleVersion);
  const payloads = [f.employee2Id, f.users.outsider, f.employeeId].map(employeeId => ({ subjectId: f.subjectId, employeeId, payDate: '2025-11-12', settings: JSON.parse(JSON.stringify(f.settings)) }));
  const snapshots: any[] = [];
  const results = await saveDeductionDrafts(payloads, async input => {
    const saved = await request.post('/api/v1/payroll/deduction-profiles', { headers, data: input });
    const body = await saved.json();
    if (!saved.ok()) throw { response: { status: saved.status(), data: body } };
    expect(body.data.status).toBe('draft'); return body.data;
  }, rows => snapshots.push(rows));
  expect(results.map(row => row.status)).toEqual(['saved', 'failed', 'saved']);
  expect(results.filter(row => row.status === 'saved').every(row => row.message.includes('尚未提交主管审核'))).toBe(true);
  expect(snapshots.at(-1)).toEqual(results);
  const state = await control('inspect', { subjectId: f.subjectId });
  expect(state.profiles.filter((row: any) => row.payDate.startsWith('2025-11-12') && row.status === 'draft')).toHaveLength(2);
  expect(state.finances).toEqual({ payments: 0, reservations: 0, settlements: 0, exports: 0 });
});

test('API: opening correction independently audits before/after and blocks stale, unauthorized, pending and paid cases', async ({ request }) => {
  for (const scenario of ['recovery', 'recovery-pending', 'recovery-paid']) {
    const f = await control('create', { scenario }), api = await sessions(request, f);
    await api('outsider', 'GET', `/openings/${f.openingId}/history`, undefined, 403);
    const opening = await api('sealer', 'GET', `/openings/${f.openingId}/history`);
    const correction = { expectedHash: opening.currentHash, amount: '25', reference: 'fictional independently checked receipt', reason: 'fictional correction audit', requestId: randomUUID() };
    await api('hr', 'POST', `/openings/${f.openingId}/correct`, correction, 403);
    if (scenario !== 'recovery') {
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, correction, 409);
      expect((await api('sealer', 'GET', `/openings/${f.openingId}/history`)).versions).toEqual([]);
    } else {
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, { ...correction, expectedHash: '0'.repeat(64) }, 409);
      const auth = await request.post('/api/v1/auth/login', { data: f.credentials.sealer }); expect(auth.status()).toBe(200);
      const headers = { Authorization: `Bearer ${(await auth.json()).data.token}` };
      const responses = await Promise.all([correction, { ...correction, requestId: randomUUID() }].map(data =>
        request.post(`/api/v1/payroll/openings/${f.openingId}/correct`, { headers, data })));
      expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
      const stale = responses.find(response => response.status() === 409)!;
      expect((await stale.json()).message).toContain('历史已付登记已更新');
      await api('sealer', 'POST', `/openings/${f.openingId}/correct`, { ...correction, amount: '30', requestId: randomUUID() }, 409);
      const history = await api('sealer', 'GET', `/openings/${f.openingId}/history`);
      expect(history.current.amount).toBe('25.00'); expect(history.versions).toHaveLength(1);
      expect(history.versions[0].before.amount).toBe('0.00'); expect(history.versions[0].after.amount).toBe('25.00');
      expect(history.versions[0].reason).toBe(correction.reason);
    }
    const state = await control('inspect', { subjectId: f.subjectId }); expect(state.frozenUnchanged).toBe(true);
    expect(state.attendanceHistoryUnchanged).toBe(true);
    expect(state.events.filter((event: any) => event.action === 'opening_corrected')).toHaveLength(scenario === 'recovery' ? 1 : 0);
    expect(state.finances).toEqual({ payments: 0, reservations: 0, exports: 0, settlements: scenario === 'recovery-paid' ? 1 : 0 });
  }
});
