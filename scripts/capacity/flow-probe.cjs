const { readFileSync, writeFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const path = require('node:path');

async function main() {
  const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (!/^CAP_[a-f0-9]{12}$/.test(manifest.runId || '') || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(manifest.baseURL)
    || [80, 443, 5173].includes(Number(new URL(manifest.baseURL).port))) throw new Error('unsafe-fixture');
  const { docker, assertOwned } = await import('./isolation.mjs');
  const proxy = `hrm-cap-${manifest.runId.toLowerCase()}-proxy`;
  assertOwned(JSON.parse(docker(['inspect', proxy]))[0], manifest.runId);
  if (manifest.baseURL !== `http://127.0.0.1:${docker(['port', proxy, '80/tcp']).split(':').at(-1)}`
    || path.dirname(path.resolve(process.argv[3])) !== path.dirname(path.resolve(process.argv[2]))) throw new Error('flow-target-or-output-not-owned');
  const timings = [];
  async function api(method, route, token, body, expected = 200) {
    const start = performance.now();
    const response = await fetch(manifest.baseURL + '/api/v1' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    timings.push({ method, operation: route.includes('/auth/') ? 'login' : route.endsWith('/approve') ? 'approve' : route.endsWith('/confirm') ? 'confirm' : 'detail', status: response.status, ms: performance.now() - start });
    if (response.status !== expected || (expected === 200 && data.code !== 0)) throw new Error('flow-http-contract-failed');
    return data.data;
  }
  const tokens = {};
  for (const key of ['manager', 'head', 'leader', 'hr']) tokens[key] = (await api('POST', '/auth/login', null, manifest.actors[key])).token;
  const results = [];
  for (let offset = 0; offset < 100; offset += 5) {
    const group = await Promise.all(manifest.participants.slice(offset, offset + 5).map(async (person) => {
      const path = `/tasks/${person.taskId}`;
      const token = (await api('POST', '/auth/login', null, { employeeNo: person.employeeNo, password: person.password })).token;
      let detail = await api('GET', path, token);
      if (detail.status !== 'indicator_reviewing') throw new Error('flow-start-state-not-submitted');
      for (const [role, state] of [['manager', 'indicator_dept_reviewing'], ['head', 'indicator_confirming']]) {
        const decided = await api('POST', `${path}/indicators/approve`, tokens[role], { expectedUpdatedAt: detail.updatedAt });
        if (decided.status !== state) throw new Error('flow-approval-state-invalid');
        detail = await api('GET', path, token);
      }
      const before = await api('GET', path, token);
      detail = await api('POST', `${path}/indicators/confirm`, token, { expectedUpdatedAt: before.updatedAt });
      if (detail.status !== 'indicator_approving') throw new Error('flow-confirm-state-invalid');
      // Deliberate stale repeat must not count as another successful decision.
      await api('POST', `${path}/indicators/confirm`, token, { expectedUpdatedAt: before.updatedAt }, 409);
      detail = await api('GET', path, token);
      const final = await api('POST', `${path}/indicators/approve`, tokens.leader, { expectedUpdatedAt: detail.updatedAt });
      if (final.status !== 'self_eval') throw new Error('flow-final-state-invalid');
      const after = await api('GET', path, token);
      if (after.status !== 'self_eval' || !after.goalApprovedAt) throw new Error('flow-readback-invalid');
      return { success: true };
    }));
    results.push(...group);
  }
  const first = manifest.participants[0];
  const second = manifest.participants[1];
  const secondToken = (await api('POST', '/auth/login', null, { employeeNo: second.employeeNo, password: second.password })).token;
  await api('GET', `/tasks/${first.taskId}`, secondToken, null, 403);
  const racePath = `/tasks/${manifest.handoff.taskId}`;
  const raceBefore = await api('GET', racePath, tokens.leader);
  if (raceBefore.status !== 'indicator_approving') throw new Error('race-fixture-not-awaiting-leader');
  const raceStart = performance.now();
  const raceResults = await Promise.all([0, 1].map(async () => {
    const response = await fetch(manifest.baseURL + '/api/v1' + racePath + '/indicators/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.leader },
      body: JSON.stringify({ expectedUpdatedAt: raceBefore.updatedAt }), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    await response.arrayBuffer();
    return response.status;
  }));
  if (JSON.stringify(raceResults.sort()) !== '[200,409]') throw new Error('race-did-not-have-one-winner');
  const p = (items, percentile) => items.sort((a, b) => a - b)[Math.min(items.length - 1, Math.ceil(items.length * percentile) - 1)];
  const output = { count: results.length, expected: 100, success: results.filter((item) => item.success).length,
    rejectedDuplicates: timings.filter((item) => item.status === 409).length,
    deniedCrossEmployeeRead: true, concurrentFinalApproval: { statuses: raceResults, ms: performance.now() - raceStart },
    timingsByOperation: Object.fromEntries(['login', 'detail', 'approve', 'confirm'].map((operation) => {
      const values = timings.filter((item) => item.operation === operation && item.status === 200).map((item) => item.ms);
      return [operation, { count: values.length, p95Ms: p(values, 0.95), maxMs: Math.max(...values) }];
    })) };
  writeFileSync(process.argv[3], JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}
main().catch(() => { console.error('flow-probe-failed-sensitive-detail-omitted'); process.exitCode = 1; });
