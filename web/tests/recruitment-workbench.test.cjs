const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const filename = path.resolve(__dirname, '../src/views/dashboard/DashboardRecruitment.vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function mount(t, read) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded), pushes = [];
  const auth = vue.reactive({ user: { id: 'user', isAssessorOnly: false } });
  loaded.require = id => {
    if (id === 'vue-router') return { useRouter: () => ({ push: target => pushes.push(target) }) };
    if (id === '@/stores/auth.store') return { useAuthStore: () => auth };
    if (id === '@/api/talent-recruitment.api') return { talentRecruitmentApi: { workbench: read } };
    return original(id);
  };
  loaded._compile(ts.transpileModule(compileScript(descriptor, { id: filename }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = loaded.exports.default.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); return { state, auth, pushes };
}
test('reads one authorized projection, keeps feedback separate and links exact objects', async t => {
  let calls = 0;
  const view = mount(t, async () => { calls++; return { groups: [{ key: 'feedback', total: 1, items: [{ id: 'interview', title: '候选人', subtitle: '面试已结束', date: null }] }] }; }); await flush();
  assert.equal(calls, 1); assert.equal(view.state.activeKey.value, 'feedback');
  view.state.open('feedback', { id: 'interview' });
  view.state.open('hiring_review', { id: 'application' });
  view.state.open('follow_up', { id: 'candidate', candidateId: 'candidate' });
  view.state.open('onboarding', { id: 'application', candidateId: 'candidate', applicationId: 'application' });
  assert.deepEqual(view.pushes, [
    { path: '/talent-interviews/interview', query: { work: 'interviews', scope: 'mine', bucket: 'feedback' } },
    { path: '/talent-hiring', query: { applicationId: 'application' } },
    { path: '/talents', query: { candidateId: 'candidate' } },
    { path: '/entry-exit', query: { talentId: 'candidate', talentApplicationId: 'application' } },
  ]);
});
test('error clears stale entries; retry and empty response are distinguishable', async t => {
  let fail = true;
  const view = mount(t, async () => { if (fail) throw Error('offline'); return { groups: [] }; }); await flush();
  assert.ok(view.state.error.value); assert.deepEqual(view.state.groups.value, []);
  fail = false; await view.state.load(); assert.equal(view.state.error.value, ''); assert.deepEqual(view.state.groups.value, []);
});
test('account change invalidates late response and assessor-only actor never fetches', async t => {
  const pending = deferred(); let calls = 0;
  const view = mount(t, () => { calls++; return pending.promise; });
  view.auth.user = { id: 'assessor', isAssessorOnly: true }; await flush();
  pending.resolve({ groups: [{ key: 'hiring_review', total: 1, items: [] }] }); await flush();
  assert.equal(calls, 1); assert.deepEqual(view.state.groups.value, []); assert.equal(view.state.loading.value, false);
});
