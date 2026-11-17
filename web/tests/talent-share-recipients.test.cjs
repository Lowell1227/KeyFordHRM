const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { renderToString } = require('@vue/server-renderer');

const root = path.resolve(__dirname, '../src');
function load(relative, dependencies = {}, inlineTemplate = false) {
  const filename = path.join(root, relative);
  let source = fs.readFileSync(filename, 'utf8');
  if (relative.endsWith('.vue')) source = compileScript(parse(source).descriptor, { id: relative, inlineTemplate }).content;
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => id in dependencies ? dependencies[id] : id.startsWith('@/') ? {} : originalRequire(id);
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
  setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
function drawer(t, api) {
  const sharedUserCalls = [];
  const component = load('views/talent/components/TalentShareDrawer.vue', {
    '@/api/talent-pool.api': { talentPoolApi: api },
    '@/api/users.api': { usersApi: { findAll: async (...args) => { sharedUserCalls.push(args); return { items: [] }; } } },
    '@/utils/date': { formatDate: value => value },
    'element-plus': { ElMessage: { success() {}, warning() {} }, ElMessageBox: { confirm: async () => {} } },
  }).default;
  const props = vue.reactive({ modelValue: true, candidateId: 'talent-1', candidateName: '虚构候选人', shares: [] });
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { emit() {}, expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => app.unmount());
  return { state, props, sharedUserCalls };
}

test('share API uses only the dedicated paginated recipient route', async () => {
  const requests = [];
  const result = { items: [], page: 1, pageSize: 20, total: 0 };
  const api = load('api/talent-pool.api.ts', { './http': { get: async (...args) => { requests.push(args); return result; } } }).talentPoolApi;
  assert.equal(typeof api.searchShareRecipients, 'function');
  assert.equal(await api.searchShareRecipients({ keyword: 'F001', page: 1, pageSize: 20 }), result);
  assert.deepEqual(requests, [['/talents/share-recipients', { params: { keyword: 'F001', page: 1, pageSize: 20 } }]]);
});

test('drawer shows server-approved HR and real managers without local role filtering or shared users lookup', async t => {
  const calls = [];
  const items = [
    { id: 'hr-user', name: '虚构HR', employeeNo: 'F001', deptName: '人事部' },
    { id: 'actual-manager', name: '虚构主管', employeeNo: 'F002', deptName: '业务部' },
  ];
  const { state, sharedUserCalls } = drawer(t, { searchShareRecipients: async query => { calls.push(query); return { items }; } });
  await state.searchRecipients('虚构');
  assert.deepEqual(state.recipientOptions.value, items);
  assert.deepEqual(calls, [{ keyword: '虚构', page: 1, pageSize: 20 }]);
  assert.deepEqual(sharedUserCalls, []);
  assert.match(state.recipientLabel(items[0]), /F001/);
  assert.match(state.recipientLabel(items[0]), /人事部/);
});

test('failed share creation retains selections, message and original-resume default off', async t => {
  let body;
  const { state } = drawer(t, { createShare: async (id, value) => { body = value; throw new Error('接收人资格已变化，请重新选择'); } });
  state.recipientIds.value = ['actual-manager'];
  state.message.value = '请评估';
  await state.createShare();
  assert.equal(body.includeResume, false);
  assert.equal(body.expiresInDays, 7);
  assert.deepEqual(state.recipientIds.value, ['actual-manager']);
  assert.equal(state.message.value, '请评估');
  assert.match(state.createError.value, /资格已变化/);
});

test('overview renders talent and simple invitations separately from unfinished recruitment and retains version 0.8', async () => {
  const component = load('views/system/SystemOverviewView.vue', {}, true).default;
  const html = await renderToString(vue.createSSRApp(component));
  assert.match(html, /人才库与简单面试邀约/);
  assert.match(html, /招聘职位发布、面试评价与 Offer/);
  assert.match(html, /职位发布、面试评价和 Offer 流程尚未建设/);
  assert.match(html, /建设清单/);
  assert.match(html, /非实时.*健康/);
  assert.match(html, /版本 0\.8/);
  assert.doesNotMatch(html, /未建设候选人/);
});
