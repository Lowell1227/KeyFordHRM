const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
function store(read) {
  const file = path.resolve(__dirname, '../src/stores/auth.store.ts'), m = new Module(file, module);
  m.require = name => name === 'pinia' ? { defineStore: (_, config) => config }
    : name === '@/api/auth.api' ? { authApi: {} }
    : name === '@/api/payroll.api' ? { payrollApi: { access: read } }
    : name === '@/stores/notification.store' ? { useNotificationStore: () => ({ setSession() {} }) }
    : require(name);
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
  return m.exports.useAuthStore.actions;
}
const allowed = { enabled: true, subjects: [{ id: 'subject', capabilities: ['payroll_view'] }] };
const denied = { enabled: true, subjects: [] };
test('fresh authorization replaces stale menus without replacing other identity fields', async () => {
  const actions = store(async () => denied), context = { payrollAccessSequence: 0, token: 'fictional-session', user: { id: 'person', name: 'fictional', payrollAccess: allowed } };
  assert.deepEqual(await actions.refreshPayrollAccess.call(context), denied);
  assert.deepEqual(context.user.payrollAccess, denied);
  assert.equal(context.user.name, 'fictional');
});
test('an old response cannot grant rights to a different session', async () => {
  let resolve;
  const actions = store(() => new Promise(done => resolve = done)), context = { payrollAccessSequence: 0, token: 'old', user: { id: 'old', payrollAccess: denied } };
  const result = actions.refreshPayrollAccess.call(context);
  context.token = 'new'; context.user = { id: 'new', payrollAccess: denied };
  resolve(allowed);
  await assert.rejects(result);
  assert.deepEqual(context.user.payrollAccess, denied);
});
test('failed refresh clears cached salary permissions but preserves the login session', async () => {
  const actions = store(async () => { throw new Error('offline'); }), context = { payrollAccessSequence: 0, token: 'fictional', user: { id: 'person', payrollAccess: allowed } };
  await assert.rejects(actions.refreshPayrollAccess.call(context));
  assert.deepEqual(context.user.payrollAccess, { enabled: false, subjects: [] });
  assert.equal(context.token, 'fictional');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const session = () => ({ payrollAccessSequence: 0, token: 'fictional', user: { id: 'person', payrollAccess: denied } });

for (const outcome of ['success', 'failure']) test(`old same-session ${outcome} cannot overwrite newer authorization`, async () => {
  const old = deferred(), latest = deferred(); let reads = 0;
  const actions = store(() => ++reads === 1 ? old.promise : latest.promise), context = session();
  const first = actions.refreshPayrollAccess.call(context), second = actions.refreshPayrollAccess.call(context);
  latest.resolve(denied); await second;
  const rejection = assert.rejects(first, { name: 'PayrollAccessSupersededError' });
  if (outcome === 'success') old.resolve(allowed); else old.reject(new Error('old offline response'));
  await rejection;
  assert.deepEqual(context.user.payrollAccess, denied);
});

test('a late failure cannot disable a newer successful authorization', async () => {
  const old = deferred(), latest = deferred(); let reads = 0;
  const actions = store(() => ++reads === 1 ? old.promise : latest.promise), context = session();
  const first = actions.refreshPayrollAccess.call(context), second = actions.refreshPayrollAccess.call(context);
  latest.resolve(allowed); await second;
  const rejection = assert.rejects(first, { name: 'PayrollAccessSupersededError' });
  old.reject(new Error('old offline response')); await rejection;
  assert.deepEqual(context.user.payrollAccess, allowed);
});

for (const outcome of ['success', 'failure']) test(`logout and same-identity re-login invalidate an old ${outcome} even with a reused token`, async () => {
  const pending = deferred(), actions = store(() => pending.promise), context = session();
  const first = actions.refreshPayrollAccess.call(context);
  actions.logout.call(context);
  actions.setSession.call(context, 'fictional', { id: 'person', payrollAccess: denied }, 3600);
  const rejection = assert.rejects(first, { name: 'PayrollAccessSupersededError' });
  if (outcome === 'success') pending.resolve(allowed); else pending.reject(new Error('old offline response'));
  await rejection; assert.deepEqual(context.user.payrollAccess, denied);
});

test('logout without a new session rejects a late authorization without recreating the user', async () => {
  const pending = deferred(), actions = store(() => pending.promise), context = session();
  const first = actions.refreshPayrollAccess.call(context); actions.logout.call(context);
  const rejection = assert.rejects(first, { name: 'PayrollAccessSupersededError' });
  pending.resolve(allowed); await rejection;
  assert.equal(context.user, null); assert.equal(context.token, null);
});

function payrollScope(auth, error = async cause => cause.message, options = {}) {
  const file = path.resolve(__dirname, '../src/views/compensation/payroll/usePayrollScope.ts'), m = new Module(file, module);
  const route = vue.reactive({ path: '/payroll/standards', query: { subjectId: 'subject', month: '2037-01' } }), replaced = [];
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = name => {
    if (name === 'vue-router') return { useRoute: () => route, useRouter: () => ({ replace: async target => { replaced.push(target); route.query = target.query; } }) };
    if (name === '@/api/payroll.api') return { payrollError: error };
    if (name === '@/stores/auth.store') return { useAuthStore: () => auth };
    if (name === './payroll-state') {
      const dependency = path.join(path.dirname(file), 'payroll-state.ts'), loaded = new Module(dependency, module);
      loaded._compile(ts.transpileModule(fs.readFileSync(dependency, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, dependency);
      return loaded.exports;
    }
    return original(name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
  const scope = vue.effectScope();
  return { scope, route, replaced, state: scope.run(() => m.exports.usePayrollScope(['payroll_view'], options)) };
}

test('explicit context persistence keeps selected month for menu navigation but never writes an ungranted company or another module', async t => {
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: async () => allowed });
  const f = payrollScope(auth, undefined, { persistQuery: true }); t.after(() => f.scope.stop());
  await f.state.refreshAccess(); f.state.month.value = '2026-10'; await flush();
  assert.deepEqual(f.route.query, { subjectId: 'subject', month: '2026-10' }); assert.equal(f.replaced.length, 1);
  f.state.subjectId.value = 'not-granted'; await flush(); assert.equal(f.replaced.length, 1);
  f.state.subjectId.value = 'subject'; f.route.path = '/dashboard'; f.state.month.value = '2026-09'; await flush();
  assert.equal(f.replaced.length, 1);
});

for (const outcome of ['success', 'failure']) test(`scope ignores old ${outcome} after the latest local refresh`, async t => {
  const old = deferred(), latest = deferred(); let reads = 0;
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: () => ++reads === 1 ? old.promise : latest.promise });
  const { scope, state } = payrollScope(auth); t.after(() => scope.stop());
  const first = state.refreshAccess(), second = state.refreshAccess();
  latest.resolve(allowed); await second;
  if (outcome === 'success') old.resolve(denied); else old.reject(new Error('old scope failure'));
  await first;
  assert.deepEqual(state.access.value, allowed); assert.equal(state.subjectId.value, 'subject');
  assert.equal(state.error.value, ''); assert.equal(state.loading.value, false);
});

test('an older scope response cannot release the latest pending spinner or set its error', async t => {
  const old = deferred(), latest = deferred(); let reads = 0;
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: () => ++reads === 1 ? old.promise : latest.promise });
  const { scope, state } = payrollScope(auth); t.after(() => scope.stop());
  const first = state.refreshAccess(), second = state.refreshAccess();
  old.reject(new Error('old failure')); await first;
  assert.equal(state.loading.value, true); assert.equal(state.error.value, '');
  latest.resolve(allowed); await second;
});

test('a delayed error formatter cannot change a newer scope result', async t => {
  const pendingError = deferred(); let reads = 0;
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: async () => { if (++reads === 1) throw new Error('old failure'); return allowed; } });
  const { scope, state } = payrollScope(auth, () => pendingError.promise); t.after(() => scope.stop());
  const first = state.refreshAccess(); await flush(); await state.refreshAccess();
  pendingError.resolve('old formatted failure'); await first;
  assert.equal(state.error.value, ''); assert.deepEqual(state.access.value, allowed);
});

test('a globally superseded refresh is not reported as a current scope authorization failure', async t => {
  const superseded = Object.assign(new Error('superseded'), { name: 'PayrollAccessSupersededError' });
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: async () => { throw superseded; } });
  const { scope, state } = payrollScope(auth); t.after(() => scope.stop());
  state.access.value = allowed;
  await state.refreshAccess();
  assert.deepEqual(state.access.value, allowed); assert.equal(state.subjectId.value, 'subject'); assert.equal(state.error.value, '');
});

test('scope identity changes invalidate pending reads and discard the previous identity authorization immediately', async t => {
  const pending = deferred();
  const auth = vue.reactive({ token: 'old', user: { id: 'old' }, refreshPayrollAccess: () => pending.promise });
  const { scope, state } = payrollScope(auth); t.after(() => scope.stop());
  state.access.value = allowed; const first = state.refreshAccess();
  auth.token = 'new'; auth.user = { id: 'new' };
  assert.equal(state.access.value, undefined); assert.equal(state.subjectId.value, '');
  pending.resolve(allowed); await first;
  assert.equal(state.access.value, undefined); assert.equal(state.error.value, ''); assert.equal(state.loading.value, false);
});

test('disposing a scope makes a late read inert', async () => {
  const pending = deferred();
  const auth = vue.reactive({ token: 'session', user: { id: 'person' }, refreshPayrollAccess: () => pending.promise });
  const { scope, state } = payrollScope(auth);
  const first = state.refreshAccess(); scope.stop(); pending.resolve(allowed); await first;
  assert.equal(state.access.value, undefined);
});
