const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const { ref } = require('vue');

const root = path.resolve(__dirname, '../src');
function evaluate(filename, source, dependencies = {}) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id in dependencies ? dependencies[id] : require(id);
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return loaded.exports;
}
function handlers(relative, names, context) {
  const filename = path.join(root, relative);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const ast = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text));
  const source = `export function bind(context) { const { ${Object.keys(context).join(',')} } = context;
    ${functions.map(node => node.getText(ast)).join('\n')} return { ${names.join(',')} }; }`;
  return evaluate(filename, source).bind(context);
}
const first = { id: 'request-a', requestVersion: 1, employeeName: 'Fictional A' };
const second = { id: 'request-b', requestVersion: 4, employeeName: 'Fictional B' };
const ok = { succeeded: [{ requestId: first.id, scopes: ['profile'] }], failed: [] };

test('API carries a separate seen version for each requested ID', async () => {
  const writes = [];
  const filename = path.join(root, 'api/employee-archives.api.ts');
  const { employeeArchivesApi: api } = evaluate(filename, fs.readFileSync(filename, 'utf8'), {
    './http': { default: { post: async (...args) => { writes.push(args); return ok; } } },
  });
  const versions = { [first.id]: 1, [second.id]: 4 };
  await api.approveReviews([first.id, second.id], ['profile'], versions);
  await api.rejectReviews([first.id, second.id], 'Fictional reason', versions);
  assert.deepEqual(writes.map(([, body]) => body.requestVersions), [versions, versions]);
});

function pending(api = {}) {
  const calls = [], prompts = [], messages = [], reloads = [];
  const context = {
    employeeLoading: ref(false), employeeRejectReasons: new Map(),
    employeeArchivesApi: Object.fromEntries(['approveReviews', 'rejectReviews'].map(name => [name, async (...args) => {
      calls.push([name, ...args]); return api[name] ? api[name](...args) : ok;
    }])),
    ElMessage: Object.fromEntries(['success', 'warning', 'error'].map(name => [name, message => messages.push(message)])),
    ElMessageBox: { prompt: async (_, __, options) => { prompts.push(options); return { value: 'Fictional correction' }; } },
    loadEmployeeReviews: async () => { reloads.push(true); }, notifyPersonnelChanged() {},
  };
  const bound = handlers('views/admin/components/PersonnelPendingReviews.vue', ['approveEmployeeReviews', 'rejectEmployeeReviews'], context);
  return { ...bound, calls, prompts, messages, reloads, context };
}

test('pending single and batch handlers send exactly the versions displayed', async () => {
  const f = pending();
  await f.approveEmployeeReviews([first]);
  await f.approveEmployeeReviews([first, second]);
  await f.rejectEmployeeReviews([first, second]);
  assert.deepEqual(f.calls.map(call => call[3]), [
    { [first.id]: 1 }, { [first.id]: 1, [second.id]: 4 }, { [first.id]: 1, [second.id]: 4 },
  ]);
});

test('rejected stale return keeps its entered reason and never refreshes/retries automatically', async () => {
  const f = pending({ rejectReviews: async () => { throw { response: { status: 409 } }; } });
  await f.rejectEmployeeReviews([first]);
  await f.rejectEmployeeReviews([first]);
  assert.equal(f.calls.length, 2, 'one write per explicit click');
  assert.equal(f.reloads.length, 0);
  assert.equal(f.prompts[1].inputValue, 'Fictional correction');
  assert.equal(f.context.employeeLoading.value, false);
});

test('mixed batch return reports failures rather than claiming all rows returned', async () => {
  const f = pending({ rejectReviews: async () => ({ succeeded: [{ requestId: second.id }],
    failed: [{ requestId: first.id, reason: '申请版本已变化，请刷新后重新核对' }] }) });
  await f.rejectEmployeeReviews([first, second]);
  assert.match(f.messages.join(' '), /刷新后重新核对/);
  assert.doesNotMatch(f.messages.join(' '), /已退回 2/);
});

for (const action of ['approve', 'reject']) test(`detail ${action} binds the open snapshot and preserves it on 409`, async () => {
  const calls = [], prompts = [], opens = [];
  const context = {
    applicationDetail: ref(first), applicationSaving: ref(false), applicationRejectReasons: new Map(),
    employeeArchivesApi: Object.fromEntries(['approveReviews', 'rejectReviews'].map(name => [name, async (...args) => {
      calls.push(args); throw { response: { status: 409 } };
    }])),
    ElMessage: { warning() {}, success() {}, error() {} },
    ElMessageBox: { prompt: async (_, __, options) => { prompts.push(options); return { value: 'Fictional correction' }; } },
    openApplication: async id => { opens.push(id); }, refreshCurrentView() {},
  };
  const f = handlers('views/admin/UserManageView.vue', ['reviewApplicationFromDetail'], context);
  await f.reviewApplicationFromDetail(action);
  assert.deepEqual(calls[0][2], { [first.id]: 1 });
  assert.deepEqual(opens, []);
  assert.equal(context.applicationDetail.value.requestVersion, 1);
  assert.equal(context.applicationSaving.value, false);
  if (action === 'reject') {
    await f.reviewApplicationFromDetail(action);
    assert.equal(prompts[1].inputValue, 'Fictional correction');
  }
});
