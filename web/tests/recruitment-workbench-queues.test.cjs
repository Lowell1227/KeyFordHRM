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
function mount(t, read) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded), pushes = [];
  const auth = vue.reactive({ user: { id: 'operator', isAssessorOnly: false, hrCapabilities: ['recruitment_edit'] } });
  loaded.require = id => {
    if (id === 'vue-router') return { useRouter: () => ({ push: target => pushes.push(target) }) };
    if (id === '@/stores/auth.store') return { useAuthStore: () => auth };
    if (id === '@/api/talent-recruitment.api') return { talentRecruitmentApi: { workbench: read } };
    return original(id);
  };
  loaded._compile(ts.transpileModule(compileScript(descriptor, { id: filename }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = loaded.exports.default.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); return { state, auth, pushes };
}

test('new queues link to exact original records and preserve the same all-list filter', async t => {
  const view = mount(t, async () => ({ groups: [] })); await flush();
  for (const key of ['intake_review', 'intake_assignment']) {
    view.state.open(key, { id: 'receipt', intakeId: 'receipt' }); view.state.openAll(key);
  }
  view.state.open('entry_overdue', { id: 'app', candidateId: 'candidate', applicationId: 'app' });
  view.state.open('entry_overdue', { id: 'app', candidateId: 'candidate', applicationId: 'app', onboardingRequestId: 'request' });
  view.state.openAll('entry_overdue');
  assert.deepEqual(view.pushes, [
    { path: '/recruitment/intakes', query: { workQueue: 'review', ownerId: 'operator', intakeId: 'receipt' } },
    { path: '/recruitment/intakes', query: { workQueue: 'review', ownerId: 'operator' } },
    { path: '/recruitment/intakes', query: { workQueue: 'assignment', ownerId: 'operator', intakeId: 'receipt' } },
    { path: '/recruitment/intakes', query: { workQueue: 'assignment', ownerId: 'operator' } },
    { path: '/talent-interviews', query: { work: 'applications', scope: 'all', overdueOnly: 'true', candidateId: 'candidate', applicationId: 'app' } },
    { path: '/entry-exit', query: { requestId: 'request' } },
    { path: '/talent-interviews', query: { work: 'applications', scope: 'all', overdueOnly: 'true' } },
  ]);
  assert.equal(view.state.labels.intake_review, '待核对简历');
  assert.equal(view.state.labels.intake_assignment, '待归岗位');
  assert.equal(view.state.labels.entry_overdue, '到岗日期已过待确认');
});

test('incomplete new record identity cannot fall back to a different talent or intake', async t => {
  const view = mount(t, async () => ({ groups: [] })); await flush();
  view.state.open('intake_review', { id: 'wrong', candidateId: 'candidate' });
  view.state.open('entry_overdue', { id: 'wrong', candidateId: 'candidate' });
  assert.deepEqual(view.pushes, []);
});

test('loading and errors have an unknown total, not a false zero or stale success', async t => {
  let finish;
  let read = () => new Promise(resolve => { finish = resolve; });
  const view = mount(t, () => read());
  assert.equal(view.state.loading.value, true); assert.equal(view.state.total.value, null);
  finish({ groups: [{ key: 'intake_review', total: 2, items: [] }] }); await flush();
  assert.equal(view.state.total.value, 2);
  read = async () => { throw Error('unavailable'); };
  const retry = view.state.load(); assert.equal(view.state.total.value, null); await retry;
  assert.ok(view.state.error.value); assert.equal(view.state.total.value, null);
  read = async () => ({ groups: [] }); await view.state.load();
  assert.equal(view.state.error.value, ''); assert.equal(view.state.total.value, 0);
});

test('overdue dates are calendar dates and do not drift when formatted', async t => {
  const view = mount(t, async () => ({ groups: [] })); await flush();
  assert.equal(view.state.dateLabel('entry_overdue', '2026-11-21'), '2026-11-21');
});
