import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const path = new URL('./performance.js', import.meta.url);
const source = (() => {
  try { return readFileSync(path, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
})();
// Evaluate only pure parsers; never import k6, open a manifest or issue HTTP.
const pure = source.split('// k6 runtime.')[0]
  .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
const api = source ? vm.runInNewContext(`${pure}; ({
  parseManifest, profileOptions, participantForVu, dailyOperation,
  decodeEnvelope, validateLogin, validateRead, validateTask,
  indicatorBody, validateWrite,
})`) : {};
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixture = () => ({
  runId: 'capacity-20261126-test', baseURL: 'http://127.0.0.1:49177',
  participants: Array.from({ length: 100 }, (_, i) => ({
    employeeNo: `SYNTH-${i + 1}`, password: 'fictional-only', taskId: uuid(i + 1),
  })),
  actors: Object.fromEntries(['manager', 'head', 'leader', 'hr'].map(role => [
    role, { employeeNo: `SYNTH-${role}`, password: 'fictional-only' },
  ])),
});
const parse = value => {
  assert.equal(typeof api.parseManifest, 'function', 'manifest parser is not implemented');
  return api.parseManifest(JSON.stringify(value));
};
const participant = fixture().participants[0];

test('each emitted read route has its own latency gate instead of only an overall average', () => {
  for (const name of ['readAuthMeMs', 'readMyTasksMs', 'readMyCyclesMs', 'readMyGoalsMs', 'readTaskDetailMs']) {
    assert.equal(JSON.stringify(api.profileOptions('daily-100').thresholds[name]), '["p(95)<=1000","p(99)<=2000"]');
  }
  assert.equal(api.profileOptions('auth-only-burst').thresholds.writeMs, undefined);
  assert.equal(api.profileOptions('auth-only-burst').thresholds.readMyTasksMs, undefined);
});
const userId = uuid(201);
test('refresh regression keeps normal per-route latency gates and proves polling coverage', () => {
  for (const count of [10, 100]) {
    const options = api.profileOptions(`refresh-${count}`);
    assert.equal(options.scenarios.performance.vus, count);
    assert.equal(JSON.stringify(options.thresholds.readMyGoalsMs), '["p(95)<=1000","p(99)<=2000"]');
    assert.equal(options.thresholds.goalRefreshSuccess[0], `count>=${count * 5}`);
  }
});
const task = () => ({
  id: participant.taskId, employeeId: userId, status: 'indicator_drafting',
  updatedAt: '2037-01-02T00:00:00.000Z',
  indicatorInstances: [{ name: 'Synthetic fixture goal', weight: 1 }],
});

test('accepts the manifest contract without changing participant ownership', () => {
  const manifest = parse(fixture());
  assert.equal(manifest.runId, 'capacity-20261126-test');
  assert.equal(manifest.participants.length, 100);
  assert.equal(api.participantForVu(manifest, 1).taskId, uuid(1));
  assert.equal(api.participantForVu(manifest, 100).taskId, uuid(100));
  for (const id of [0, 101, 1.5, NaN]) {
    assert.throws(() => api.participantForVu(manifest, id));
  }
});

for (const url of [
  'https://127.0.0.1:49177', 'http://example.com:49177',
  'http://127.0.0.2:49177', 'http://127.0.0.1.evil:49177',
  'http://127.0.0.1:80', 'http://127.0.0.1:443',
  'http://127.0.0.1:5173', 'http://127.0.0.1:0',
  'http://127.0.0.1:65536', 'http://127.0.0.1:049177',
  'http://user:pass@127.0.0.1:49177', 'http://127.0.0.1:49177/api',
  'http://127.0.0.1:49177?other=1', 'http://127.0.0.1:49177#fragment',
  'http://127.0.0.1:49177\n',
]) {
  test('rejects unsafe or ambiguous target ' + JSON.stringify(url), () => {
    assert.throws(() => parse({ ...fixture(), baseURL: url }));
  });
}

test('rejects malformed manifest, run IDs, missing and colliding credentials/tasks', () => {
  assert.throws(() => api.parseManifest('{broken'));
  for (const runId of ['', '../escape', 'run.name', 'x\n', 'x'.repeat(65)]) {
    assert.throws(() => parse({ ...fixture(), runId }));
  }
  const mutations = [
    m => m.participants.pop(),
    m => { delete m.actors.hr; },
    m => { m.actors.head.password = ''; },
    m => { m.participants[0].password = ''; },
    m => { m.participants[0].employeeNo = ' bad '; },
    m => { m.participants[1].employeeNo = m.participants[0].employeeNo; },
    m => { m.actors.manager.employeeNo = m.participants[0].employeeNo; },
    m => { m.actors.hr.employeeNo = m.actors.head.employeeNo; },
    m => { m.participants[1].taskId = m.participants[0].taskId; },
    m => { m.participants[0].taskId = '../other-task'; },
    m => { m.participants[0].taskId += '\n'; },
  ];
  for (const mutate of mutations) {
    const manifest = fixture();
    mutate(manifest);
    assert.throws(() => parse(manifest));
  }
});

test('uses native fixed VUs and bounded one-iteration bursts with hard success gates', () => {
  for (const [profile, vus, duration] of [
    ['baseline', 1, '1m'], ['daily-10', 10, '2m'],
    ['daily-30', 30, '3m'], ['daily-100', 100, '5m'],
  ]) {
    const options = api.profileOptions(profile);
    const [scenario] = Object.values(options.scenarios);
    assert.equal(scenario.executor, 'constant-vus');
    assert.equal(scenario.vus, vus);
    assert.equal(scenario.duration, duration);
    assert.deepEqual(copy(options.thresholds.loginSuccess), [`count==${vus}`]);
    assert.deepEqual(copy(options.thresholds.semanticFailure), ['count==0']);
    assert.equal(options.systemTags.includes('url'), false);
    assert.equal(options.maxRedirects, 0);
  }
  for (const profile of ['login-burst', 'submit-burst']) {
    const options = api.profileOptions(profile);
    const [scenario] = Object.values(options.scenarios);
    assert.equal(scenario.executor, 'per-vu-iterations');
    assert.equal(scenario.vus, 100);
    assert.equal(scenario.iterations, 1);
    assert.deepEqual(copy(options.thresholds.iterations), ['count==100']);
    assert.deepEqual(copy(options.thresholds.loginSuccess), ['count==100']);
    if (profile === 'submit-burst') {
      assert.deepEqual(copy(options.thresholds.submitSuccess), ['count==100']);
    }
  }
  assert.throws(() => api.profileOptions('daily'));
});

test('daily mix is deterministic 80/20 and covers every read route', () => {
  const operations = Array.from({ length: 25 }, (_, i) => api.dailyOperation(i));
  assert.equal(operations.filter(value => value === 'save').length, 5);
  for (const route of ['me', 'tasks', 'cycles', 'goals', 'detail']) {
    assert.equal(operations.filter(value => value === route).length, 4);
  }
});

test('does not accept HTTP errors, malformed JSON or a business error inside HTTP 200', () => {
  assert.deepEqual(copy(api.decodeEnvelope(200, '{"code":0,"data":{"ok":true}}')), { ok: true });
  for (const status of [0, 201, 302, 401, 403, 409, 429, 500]) {
    assert.throws(() => api.decodeEnvelope(status, '{"code":0,"data":{}}'));
  }
  for (const body of ['<html>bad</html>', '{}', 'null', '{"code":4009,"data":{}}', '{"code":0,"data":null}']) {
    assert.throws(() => api.decodeEnvelope(200, body));
  }
});

test('login requires a usable real token and no forced-password-change detour', () => {
  const login = { token: 'synthetic-test-token', user: { id: userId }, passwordChangeRequired: false };
  assert.equal(api.validateLogin(login).user.id, userId);
  for (const invalid of [{ ...login, token: '' }, { ...login, user: {} }, { ...login, passwordChangeRequired: true }]) {
    assert.throws(() => api.validateLogin(invalid));
  }
});

test('read contracts reject empty lists, wrong ownership and unrelated tasks', () => {
  const row = { id: participant.taskId, employeeId: userId };
  const page = { total: 1, page: 1, pageSize: 20, items: [row] };
  for (const kind of ['tasks', 'goals']) {
    api.validateRead(kind, page, participant, userId);
    assert.throws(() => api.validateRead(kind, { ...page, items: [] }, participant, userId));
    assert.throws(() => api.validateRead(kind, { ...page, items: [{ ...row, employeeId: uuid(202) }] }, participant, userId));
    assert.throws(() => api.validateRead(kind, { ...page, total: 0 }, participant, userId));
  }
  api.validateRead('cycles', [{ personalTask: row }], participant, userId);
  assert.throws(() => api.validateRead('cycles', [], participant, userId));
  api.validateRead('me', { id: userId, employeeNo: participant.employeeNo }, participant, userId);
  assert.throws(() => api.validateRead('me', { id: userId, employeeNo: 'SYNTH-OTHER' }, participant, userId));
});

test('task checks require the assigned draft, a valid version and one fixture indicator', () => {
  api.validateTask(task(), participant, userId, 'indicator_drafting');
  for (const patch of [
    { id: uuid(9) }, { employeeId: uuid(9) }, { status: 'indicator_reviewing' },
    { updatedAt: 'not-a-date' }, { indicatorInstances: [] },
    { indicatorInstances: [{}, {}] },
  ]) {
    assert.throws(() => api.validateTask({ ...task(), ...patch }, participant, userId, 'indicator_drafting'));
  }
});

test('writes contain only fictional goal fields and the latest read version', () => {
  assert.deepEqual(copy(api.indicatorBody('submit', task().updatedAt)), {
    instances: [{
      name: 'Synthetic capacity goal', weight: 1, dimensionWeight: 1,
      indicatorType: 'kpi', targetValue: 10, visibilityScopes: ['supervisors'],
      visibleDepartmentIds: [], visibleUserIds: [], alignedObjectiveIds: [],
    }], action: 'submit', expectedUpdatedAt: '2037-01-02T00:00:00.000Z',
  });
  assert.throws(() => api.indicatorBody('approve', task().updatedAt));
});

test('success requires advanced revision, expected state and persisted synthetic fields', () => {
  for (const action of ['save', 'submit']) {
    const result = {
      ...task(), updatedAt: '2037-01-02T00:00:00.001Z',
      status: action === 'save' ? 'indicator_drafting' : 'indicator_reviewing',
      indicatorInstances: [{
        name: 'Synthetic capacity goal', weight: 1, dimensionWeight: 1,
        indicatorType: 'kpi', targetValue: 10, visibilityScopes: ['supervisors'],
        visibleDepartmentIds: [], visibleUserIds: [], alignedObjectives: [],
      }],
    };
    api.validateWrite(result, participant, userId, action, task().updatedAt);
    for (const patch of [
      { updatedAt: task().updatedAt }, { status: 'goal_confirmed' },
      { indicatorInstances: [{ ...result.indicatorInstances[0], targetValue: 0 }] },
      { indicatorInstances: [{ ...result.indicatorInstances[0], visibilityScopes: ['all'] }] },
      { indicatorInstances: [{ ...result.indicatorInstances[0], alignedObjectives: [{ id: uuid(9) }] }] },
    ]) {
      assert.throws(() => api.validateWrite({ ...result, ...patch }, participant, userId, action, task().updatedAt));
    }
  }
});
