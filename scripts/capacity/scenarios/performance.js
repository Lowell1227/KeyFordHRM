import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { safeSummary } from '../safe-summary.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseManifest(text) {
  let manifest;
  try { manifest = JSON.parse(text); } catch (_) { throw new Error('Invalid capacity manifest JSON'); }
  if (!manifest || typeof manifest.runId !== 'string'
    || manifest.runId.trim() !== manifest.runId
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(manifest.runId)) {
    throw new Error('Invalid capacity runId');
  }
  // Literal IPv4 loopback only: no DNS, credentials, path, query or redirects.
  const target = typeof manifest.baseURL === 'string'
    && manifest.baseURL.trim() === manifest.baseURL
    && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(manifest.baseURL);
  const port = target ? Number(target[1]) : 0;
  if (port < 1024 || port > 65535 || port === 5173) {
    throw new Error('Capacity target must be a dedicated loopback port, not 80/443/5173');
  }
  if (!Array.isArray(manifest.participants) || manifest.participants.length < 100) {
    throw new Error('Capacity manifest requires at least 100 participants');
  }
  const accounts = new Set();
  const tasks = new Set();
  function credential(actor) {
    if (!actor || typeof actor.employeeNo !== 'string' || !actor.employeeNo
      || /\s/.test(actor.employeeNo) || typeof actor.password !== 'string'
      || !actor.password || accounts.has(actor.employeeNo)) {
      throw new Error('Missing or duplicate capacity credential');
    }
    accounts.add(actor.employeeNo);
  }
  for (const participant of manifest.participants) {
    credential(participant);
    if (typeof participant.taskId !== 'string' || participant.taskId.trim() !== participant.taskId
      || !UUID.test(participant.taskId)
      || tasks.has(participant.taskId.toLowerCase())) {
      throw new Error('Missing, invalid or duplicate capacity task');
    }
    tasks.add(participant.taskId.toLowerCase());
    participant.taskId = participant.taskId.toLowerCase();
  }
  for (const role of ['manager', 'head', 'leader', 'hr']) {
    credential(manifest.actors && manifest.actors[role]);
  }
  return manifest;
}

export function profileOptions(profile) {
  const daily = {
    baseline: [1, '1m'], 'daily-10': [10, '2m'],
    'daily-30': [30, '3m'], 'daily-100': [100, '5m'],
    'refresh-10': [10, '1m'], 'refresh-100': [100, '2m'],
  };
  const burst = profile === 'login-burst' || profile === 'submit-burst' || profile === 'auth-only-burst';
  if (!burst && !Object.prototype.hasOwnProperty.call(daily, profile)) {
    throw new Error('Unknown capacity profile');
  }
  const vus = burst ? 100 : daily[profile][0];
  const thresholds = {
    semanticFailure: ['count==0'], checks: ['rate==1'], http_req_failed: ['rate==0'],
    loginSuccess: [`count==${vus}`],
    iterations: [burst ? 'count==100' : 'count>0'],
    loginMs: burst ? ['p(95)<=5000', 'max<=10000'] : ['p(95)<=2000', 'p(99)<=4000'],
    readMs: burst ? ['p(95)<=5000', 'max<=10000'] : ['p(95)<=1000', 'p(99)<=2000'],
  };
  if (profile.startsWith('refresh-')) thresholds.goalRefreshSuccess = [`count>=${vus * 5}`];
  const routeMetrics = profile === 'submit-burst' ? ['readTaskDetailMs']
    : profile === 'auth-only-burst' ? ['readAuthMeMs']
      : ['readAuthMeMs', 'readMyTasksMs', 'readMyCyclesMs', 'readMyGoalsMs', 'readTaskDetailMs'];
  for (const metric of routeMetrics) thresholds[metric] = [...thresholds.readMs];
  if (profile !== 'login-burst' && profile !== 'auth-only-burst') {
    thresholds.writeMs = burst ? ['p(95)<=5000', 'max<=10000'] : ['p(95)<=2000', 'p(99)<=4000'];
    thresholds[burst ? 'submitSuccess' : 'draftSaveSuccess'] = [burst ? 'count==100' : 'count>0'];
  }
  return {
    scenarios: {
      performance: burst
        ? { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '1m', gracefulStop: '15s' }
        : { executor: 'constant-vus', vus, duration: daily[profile][1], gracefulStop: '15s' },
    },
    thresholds, maxRedirects: 0,
    systemTags: ['status', 'method', 'name', 'scenario', 'group', 'check', 'error_code', 'expected_response'],
    summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  };
}

export function participantForVu(manifest, vu) {
  if (!Number.isInteger(vu) || vu < 1 || vu > 100) throw new Error('Capacity VU has no owned participant');
  return manifest.participants[vu - 1];
}

export function dailyOperation(iteration) {
  // Business actions are 80% reads / 20% saves; version reads and verification are additional HTTP.
  if (iteration % 5 === 4) return 'save';
  return ['me', 'tasks', 'cycles', 'goals', 'detail'][(Math.floor(iteration / 5) * 4 + iteration % 5) % 5];
}

export function decodeEnvelope(status, body) {
  if (status !== 200) throw new Error('Unexpected capacity HTTP status');
  let envelope;
  try { envelope = JSON.parse(body); } catch (_) { throw new Error('Invalid capacity response JSON'); }
  if (!envelope || envelope.code !== 0 || envelope.data == null) {
    throw new Error('Unexpected capacity business response');
  }
  return envelope.data;
}

export function validateLogin(data) {
  if (!data || typeof data.token !== 'string' || !data.token.trim()
    || !data.user || !UUID.test(data.user.id) || data.passwordChangeRequired !== false) {
    throw new Error('Capacity login did not produce a usable session');
  }
  return data;
}

export function validateTask(data, participant, userId, status) {
  if (!data || data.id !== participant.taskId || data.employeeId !== userId || data.status !== status
    || typeof data.updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(data.updatedAt)
    || !Number.isFinite(Date.parse(data.updatedAt))
    || !Array.isArray(data.indicatorInstances) || data.indicatorInstances.length !== 1
    || !data.indicatorInstances[0] || typeof data.indicatorInstances[0].name !== 'string'
    || !data.indicatorInstances[0].name.trim()) {
    throw new Error('Unexpected capacity task ownership, state, revision or indicators');
  }
  return data;
}

export function validateRead(kind, data, participant, userId) {
  const ownTask = row => row && row.id === participant.taskId && row.employeeId === userId;
  let valid = false;
  if (kind === 'me') valid = data && data.id === userId && data.employeeNo === participant.employeeNo;
  if (kind === 'cycles') valid = Array.isArray(data) && data.some(cycle => ownTask(cycle.personalTask));
  if (kind === 'tasks' || kind === 'goals') {
    valid = data && Array.isArray(data.items) && Number.isInteger(data.total)
      && data.total >= data.items.length && Number.isInteger(data.page) && data.page > 0
      && Number.isInteger(data.pageSize) && data.pageSize > 0
      && data.items.some(ownTask) && data.items.every(row => row.employeeId === userId);
  }
  if (kind === 'detail') return validateTask(data, participant, userId, 'indicator_drafting');
  if (!valid) throw new Error('Unexpected capacity read scope or missing fixture');
  return data;
}

export function indicatorBody(action, expectedUpdatedAt) {
  if (action !== 'save' && action !== 'submit') throw new Error('Invalid capacity write action');
  return {
    instances: [{
      name: 'Synthetic capacity goal', weight: 1, dimensionWeight: 1,
      indicatorType: 'kpi', targetValue: 10, visibilityScopes: ['supervisors'],
      visibleDepartmentIds: [], visibleUserIds: [], alignedObjectiveIds: [],
    }], action, expectedUpdatedAt,
  };
}

export function validateWrite(data, participant, userId, action, previousUpdatedAt) {
  const expected = indicatorBody(action, previousUpdatedAt).instances[0];
  validateTask(data, participant, userId, action === 'save' ? 'indicator_drafting' : 'indicator_reviewing');
  const indicator = data.indicatorInstances[0];
  if (!(Date.parse(data.updatedAt) > Date.parse(previousUpdatedAt))
    // TaskDetail returns alignedObjectives, while SetIndicatorsDto accepts alignedObjectiveIds.
    || !Object.keys(expected).filter(key => key !== 'alignedObjectiveIds')
      .every(key => JSON.stringify(indicator[key]) === JSON.stringify(expected[key]))
    || !Array.isArray(indicator.alignedObjectives) || indicator.alignedObjectives.length !== 0) {
    throw new Error('Capacity write did not persist the expected synthetic goal and new revision');
  }
  return data;
}

// k6 runtime. Pure tests stop before this marker and cannot issue requests.
const profile = __ENV.CAPACITY_PROFILE || 'baseline';
export const options = profileOptions(profile);
let manifest;
try {
  if (!__ENV.CAPACITY_MANIFEST || !__ENV.CAPACITY_MANIFEST.trim()) throw new Error();
  manifest = parseManifest(open(__ENV.CAPACITY_MANIFEST));
} catch (_) {
  throw new Error('Capacity manifest unavailable or unsafe; no requests started');
}

const loginMs = new Trend('loginMs', true);
const readMs = new Trend('readMs', true);
const writeMs = new Trend('writeMs', true);
const routeTrends = {
  '/auth/me': new Trend('readAuthMeMs', true),
  '/tasks/mine': new Trend('readMyTasksMs', true),
  '/cycles/mine': new Trend('readMyCyclesMs', true),
  '/goal-plans?scope=mine': new Trend('readMyGoalsMs', true),
  '/tasks/:id': new Trend('readTaskDetailMs', true),
};
const semanticFailure = new Counter('semanticFailure');
const loginSuccess = new Counter('loginSuccess');
const submitSuccess = new Counter('submitSuccess');
const draftSaveSuccess = new Counter('draftSaveSuccess');
const goalRefreshSuccess = new Counter('goalRefreshSuccess');
let nextGoalRefresh = 0;
const tags = { runId: manifest.runId, profile, role: 'employee' };
const trends = { login: loginMs, read: readMs, write: writeMs };
http.setResponseCallback(http.expectedStatuses(200));
let loginAttempted = false;
let authenticated = false;
let token;
let userId;

function reject() {
  semanticFailure.add(1, tags);
  check(false, { 'business contract': value => value }, tags);
  fail('Capacity business contract failed; sensitive response omitted');
}

function request(kind, method, path, route, validate, payload) {
  return group(kind, () => {
    const requestTags = { ...tags, name: `/api/v1${route}`, operation: payload ? (payload.action || kind) : kind };
    let data;
    try {
      const response = http.request(method, `${manifest.baseURL}/api/v1${path}`,
        payload ? JSON.stringify(payload) : null, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          tags: requestTags, redirects: 0, timeout: '10s', responseType: 'text',
        });
      trends[kind].add(response.timings.duration, requestTags);
      if (kind === 'read' && routeTrends[route]) routeTrends[route].add(response.timings.duration, requestTags);
      data = decodeEnvelope(response.status, response.body);
      validate(data);
    } catch (_) { reject(); }
    check(true, { 'business contract': value => value }, requestTags);
    return data;
  });
}

function read(kind, participant) {
  const routes = {
    me: '/auth/me', tasks: '/tasks/mine', cycles: '/cycles/mine',
    goals: '/goal-plans?scope=mine', detail: `/tasks/${participant.taskId}`,
  };
  return request('read', 'GET', routes[kind], kind === 'detail' ? '/tasks/:id' : routes[kind],
    data => validateRead(kind, data, participant, userId));
}

function login(participant) {
  if (authenticated) return;
  // Failed authentication is not retried on every iteration.
  if (loginAttempted) reject();
  loginAttempted = true;
  const data = request('login', 'POST', '/auth/login', '/auth/login', validateLogin, {
    employeeNo: participant.employeeNo, password: participant.password,
  });
  token = data.token;
  userId = data.user.id;
  read('me', participant);
  authenticated = true;
  loginSuccess.add(1, tags);
}

function write(action, participant) {
  const before = read('detail', participant);
  const path = `/tasks/${participant.taskId}`;
  const validate = data => validateWrite(data, participant, userId, action, before.updatedAt);
  const written = request('write', 'PUT', `${path}/indicators`, '/tasks/:id/indicators', validate,
    indicatorBody(action, before.updatedAt));
  request('read', 'GET', path, '/tasks/:id', data => {
    validate(data);
    if (data.updatedAt !== written.updatedAt) throw new Error('Capacity write readback revision mismatch');
  });
  (action === 'submit' ? submitSuccess : draftSaveSuccess).add(1, tags);
}

export function setup() {
  if (profile !== 'submit-burst' && !profile.startsWith('refresh-')) return null;
  const sessions = [];
  semanticFailure.add(0, tags);
  const count = profile === 'refresh-10' ? 10 : 100;
  for (const participant of manifest.participants.slice(0, count)) {
    const response = http.post(`${manifest.baseURL}/api/v1/auth/login`, JSON.stringify({ employeeNo: participant.employeeNo, password: participant.password }), {
      headers: { 'Content-Type': 'application/json' }, tags: { ...tags, name: '/api/v1/auth/login', phase: 'prepare-submit-burst' }, timeout: '10s', redirects: 0,
    });
    loginMs.add(response.timings.duration, tags);
    let data;
    try { data = validateLogin(decodeEnvelope(response.status, response.body)); }
    catch (_) { reject(); }
    sessions.push({ token: data.token, userId: data.user.id });
    loginSuccess.add(1, tags);
  }
  return { sessions };
}

export function handleSummary(data) {
  if (!__ENV.CAPACITY_SUMMARY_PATH) throw new Error('Missing private capacity summary path');
  return { [__ENV.CAPACITY_SUMMARY_PATH]: JSON.stringify(safeSummary(data), null, 2) };
}

export default function (prepared) {
  const participant = participantForVu(manifest, __VU);
  const burst = profile === 'login-burst' || profile === 'submit-burst' || profile === 'auth-only-burst';
  semanticFailure.add(0, tags);
  try {
    if (profile === 'login-burst') sleep(__VU / 10);
    if (profile === 'submit-burst' || profile.startsWith('refresh-')) {
      if (!prepared?.sessions?.[__VU - 1]) reject();
      token = prepared.sessions[__VU - 1].token;
      userId = prepared.sessions[__VU - 1].userId;
    } else login(participant);
    if (profile === 'auth-only-burst') {
      return;
    } else if (profile === 'login-burst') {
      for (const kind of ['tasks', 'cycles', 'goals', 'detail']) read(kind, participant);
    } else if (profile === 'submit-burst') {
      sleep(__VU / 10);
      write('submit', participant);
    } else {
      const operation = dailyOperation(__ITER);
      if (operation === 'save') write('save', participant);
      else read(operation, participant);
      if (profile.startsWith('refresh-')) {
        if (nextGoalRefresh === 0) nextGoalRefresh = Date.now() + (__VU % 10) * 1000;
        if (Date.now() >= nextGoalRefresh) {
          read('goals', participant); goalRefreshSuccess.add(1, tags); nextGoalRefresh = Date.now() + 10000;
        }
      }
    }
  } finally {
    if (!burst) sleep(3);
  }
}
