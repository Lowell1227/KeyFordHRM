const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
function load(file, deps = {}, source = fs.readFileSync(file, 'utf8')) {
  const m = new Module(file, module); m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = id => id in deps ? deps[id] : id.endsWith('.vue') ? {}
    : id.startsWith('@/') ? load(path.join(root, `${id.slice(2)}.ts`), deps) : original(id);
  m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const cycle = { id: 'fictional-cycle', name: 'Fictional cycle', status: 'self_eval', planVersion: 3, canTerminate: true };
const preview = (hash = 'hash-1') => ({ cycle, canTerminate: true, previewHash: hash,
  summary: { total: 3, terminable: 1, protected: 1, alreadyEnded: 1, goalChanges: 2, reminders: 4 },
  tasks: [{ id: 'one', disposition: 'terminate' }, { id: 'two', disposition: 'protected' }, { id: 'three', disposition: 'already_ended' }] });
const failure = status => ({ response: { status, data: { message: `Fictional ${status}` } } });

test('termination API binds the preview hash and keeps field errors local', async () => {
  const calls = [];
  const http = { get: async (...args) => { calls.push(['get', ...args]); return preview(); },
    post: async (...args) => { calls.push(['post', ...args]); return { id: cycle.id }; } };
  const { cyclesApi } = load(path.join(root, 'api/cycles.api.ts'), { './http': http });
  assert.equal(typeof cyclesApi.terminationPreview, 'function');
  assert.equal(typeof cyclesApi.terminate, 'function');
  await cyclesApi.terminationPreview(cycle.id);
  const body = { reason: 'Fictional reason', expectedPreviewHash: 'hash-1' };
  await cyclesApi.terminate(cycle.id, body);
  assert.deepEqual(calls, [['get', `/cycles/${cycle.id}/termination-preview`, { params: undefined }],
    ['post', `/cycles/${cycle.id}/terminate`, body, { skipErrorMessage: true }]]);
});

function mount(t, options = {}) {
  const file = path.join(root, `views/admin/components/Cycle${options.deletion ? 'Deletion' : 'Termination'}Dialog.vue`);
  assert.ok(fs.existsSync(file), 'cycle termination impact dialog is implemented');
  const reads = [], writes = [], confirmations = [], events = [];
  const props = vue.reactive({ visible: true, cycle: options.deletion ? { ...cycle, canDelete: true, terminatedAt: '2038-01-01' } : cycle });
  const api = {
    terminationPreview: async id => { reads.push(id); return options.read ? options.read(reads.length, id) : preview(); },
    terminate: async (id, body) => { writes.push({ id, body }); return options.write ? options.write(id, body) : { id, terminatedAt: '2038-01-01T00:00:00Z' }; },
  };
  if (options.deletion) { api.deletionPreview = api.terminationPreview; api.logicalDelete = api.terminate; }
  const component = load(file, {
    '@/api/cycles.api': { cyclesApi: api },
    'element-plus': { ElMessageBox: { confirm: async () => { confirmations.push(true); if (options.cancel) throw 'cancel'; } } },
  }, compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: file }).content).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, props, reads, writes, confirmations, events };
}

const deletionPreview = (hash = 'delete-hash') => ({ cycle: { ...cycle, terminatedAt: '2038-01-01' },
  canDelete: true, previewHash: hash, tasks: [{ id: 'one', disposition: 'delete', reason: 'Fictional' }],
  summary: { total: 1, deletable: 1, blocked: 0, alreadyDeleted: 0, goalChanges: 1 } });
test('cycle deletion API never calls the old draft DELETE path', async () => {
  const calls = []; const http = { get: async (...a) => { calls.push(a); return deletionPreview(); }, post: async (...a) => { calls.push(a); return {}; } };
  const { cyclesApi } = load(path.join(root, 'api/cycles.api.ts'), { './http': http });
  await cyclesApi.deletionPreview(cycle.id);
  await cyclesApi.logicalDelete(cycle.id, { reason: 'Fictional', expectedPreviewHash: 'fresh' });
  assert.equal(calls[0][0], `/cycles/${cycle.id}/deletion-preview`);
  assert.deepEqual(calls[1], [`/cycles/${cycle.id}/delete`, { reason: 'Fictional', expectedPreviewHash: 'fresh' }, { skipErrorMessage: true }]);
});
test('report cycle options retain deleted historical choices and read all authorized pages', async () => {
  const calls = [];
  const http = { get: async (...args) => { calls.push(args); return { items: [{ id: `page-${calls.length}` }], total: 2 }; } };
  const { cyclesApi } = load(path.join(root, 'api/cycles.api.ts'), { './http': http });
  assert.deepEqual(await cyclesApi.findAllOptions({ recordScope: 'all' }), [{ id: 'page-1' }, { id: 'page-2' }]);
  assert.deepEqual(calls.map(call => call[1].params), [
    { recordScope: 'all', page: 1, pageSize: 100 }, { recordScope: 'all', page: 2, pageSize: 100 },
  ]);
});
test('deletion previews the whole cascade, requires reason and confirms before writing', async t => {
  const f = mount(t, { deletion: true, read: () => deletionPreview() }); await flush();
  await f.state.submit(); assert.match(f.state.reasonError.value, /原因/); assert.equal(f.writes.length, 0);
  f.state.reason.value = '  Fictional deletion  '; await f.state.submit();
  assert.equal(f.confirmations.length, 1); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].body, { reason: 'Fictional deletion', expectedPreviewHash: 'delete-hash' });
  assert.equal(f.events.filter(e => e[0] === 'completed').length, 1);
});
for (const status of [403, 409, 503]) test(`deletion ${status} preserves reason and blocks blind retry`, async t => {
  const f = mount(t, { deletion: true, read: n => deletionPreview(`delete-${n}`), write: () => { throw failure(status); } }); await flush();
  f.state.reason.value = 'Keep deletion reason'; await f.state.submit();
  assert.equal(f.state.reason.value, 'Keep deletion reason'); assert.equal(f.writes.length, 1);
  assert.equal(f.events.some(e => e[0] === 'completed'), false); assert.equal(f.state.busy.value, false);
  if (status === 409) { assert.equal(f.reads.length, 2); assert.equal(f.state.preview.value.previewHash, 'delete-2'); }
  else { assert.equal(f.state.maySubmit.value, false); await f.state.submit(); assert.equal(f.writes.length, 1); }
});
test('one unfinished task blocks the entire cascade and already deleted cycle cannot submit', async t => {
  const f = mount(t, { deletion: true, read: () => ({ ...deletionPreview(), canDelete: false, summary: { blocked: 1 } }) }); await flush();
  f.state.reason.value = 'Not allowed'; await f.state.submit(); assert.equal(f.writes.length, 0);
  f.props.cycle = { ...cycle, canDelete: true, deletedAt: '2038-01-02' }; await flush();
  await f.state.submit(); assert.equal(f.writes.length, 0);
});

test('reason is required and capped at 1000 characters before second confirmation', async t => {
  const f = mount(t); await flush();
  f.state.reason.value = '   '; await f.state.submit();
  assert.match(f.state.reasonError.value, /原因/);
  f.state.reason.value = 'x'.repeat(1001); await f.state.submit();
  assert.match(f.state.reasonError.value, /1000/);
  assert.equal(f.writes.length, 0); assert.equal(f.confirmations.length, 0);
});

test('409 reloads the whole impact preview, preserves reason and requires a new confirmation', async t => {
  let attempt = 0;
  const f = mount(t, { read: count => preview(`hash-${count}`), write: () => {
    if (++attempt === 1) throw failure(409);
    return { id: cycle.id, terminatedAt: '2038-01-01T00:00:00Z' };
  } }); await flush();
  f.state.reason.value = 'Keep this reason'; await f.state.submit();
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 1);
  assert.equal(f.state.reason.value, 'Keep this reason');
  assert.equal(f.state.preview.value.previewHash, 'hash-2');
  assert.match(f.state.actionError.value, /重新/);
  assert.equal(f.events.some(event => event[0] === 'completed'), false);
  assert.equal(f.state.busy.value, false, '409 refresh must release busy so a real retry is possible');
  assert.equal(f.state.maySubmit.value, true);
  await f.state.submit();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].body.expectedPreviewHash, 'hash-2');
  assert.equal(f.confirmations.length, 2);
  assert.equal(f.events.filter(event => event[0] === 'completed').length, 1);
});

test('403 blocks resubmission and preview retry without losing the reason', async t => {
  const f = mount(t, { write: () => { throw failure(403); } }); await flush();
  f.state.reason.value = 'Keep on forbidden'; await f.state.submit(); await f.state.submit(); await f.state.loadPreview();
  assert.equal(f.writes.length, 1); assert.equal(f.reads.length, 1);
  assert.equal(f.state.forbidden.value, true); assert.equal(f.state.reason.value, 'Keep on forbidden');
  assert.equal(f.state.busy.value, false); assert.equal(f.state.maySubmit.value, false);
});

test('failed preview refresh after 409 releases busy but never reuses the stale hash', async t => {
  const f = mount(t, { read: count => { if (count > 1) throw failure(503); return preview(); }, write: () => { throw failure(409); } });
  await flush(); f.state.reason.value = 'Keep after refresh failure'; await f.state.submit();
  assert.equal(f.state.busy.value, false); assert.equal(f.state.loading.value, false);
  assert.equal(f.state.preview.value, null); assert.equal(f.state.maySubmit.value, false);
  assert.equal(f.state.reason.value, 'Keep after refresh failure');
  await f.state.submit(); assert.equal(f.writes.length, 1);
});

test('uncertain network outcome invalidates the preview but keeps the draft', async t => {
  const f = mount(t, { write: () => { throw new Error('timeout'); } }); await flush();
  f.state.reason.value = 'Keep after timeout'; await f.state.submit(); await f.state.submit();
  assert.equal(f.writes.length, 1); assert.equal(f.state.preview.value, null);
  assert.equal(f.state.reason.value, 'Keep after timeout');
  assert.equal(f.state.busy.value, false); assert.equal(f.state.maySubmit.value, false);
});

test('submit is single flight, includes exact hash, and reports success only after the write', async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const f = mount(t, { write: () => pending }); await flush();
  f.state.reason.value = '  Final reason  '; const first = f.state.submit(); await flush(); await f.state.submit();
  assert.equal(f.writes.length, 1); assert.equal(f.confirmations.length, 1);
  assert.deepEqual(f.writes[0].body, { reason: 'Final reason', expectedPreviewHash: 'hash-1' });
  assert.equal(f.events.length, 0);
  finish({ id: cycle.id, terminatedAt: '2038-01-01T00:00:00Z' }); await first;
  assert.equal(f.events.filter(event => event[0] === 'completed').length, 1);
});

test('backend denial and already terminated cycles never submit; role names do not grant permission', async t => {
  const f = mount(t, { read: () => ({ ...preview(), canTerminate: false }) }); await flush();
  f.state.reason.value = 'Not allowed'; await f.state.submit(); assert.equal(f.writes.length, 0);
  f.props.cycle = { ...cycle, terminatedAt: '2038-01-01T00:00:00Z' }; await flush();
  await f.state.submit(); assert.equal(f.writes.length, 0);
});

for (const outcome of ['success', 'failure']) test(`old submit ${outcome} after switching cycles cannot unlock or complete the new submission`, async t => {
  const pending = new Map();
  const f = mount(t, {
    read: (count, id) => ({ ...preview(`hash-${id}`), cycle: { ...cycle, id } }),
    write: id => new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
  }); await flush();
  f.state.reason.value = 'Cycle A reason'; const first = f.state.submit(); await flush();
  f.props.cycle = { ...cycle, id: 'cycle-B' }; await flush();
  f.state.reason.value = 'Cycle B reason'; const second = f.state.submit(); await flush();
  assert.equal(f.state.busy.value, true);
  if (outcome === 'failure') pending.get(cycle.id).reject(failure(409));
  else pending.get(cycle.id).resolve({ id: cycle.id });
  await first;
  assert.equal(f.state.busy.value, true);
  assert.equal(f.state.preview.value.cycle.id, 'cycle-B');
  assert.equal(f.state.reason.value, 'Cycle B reason');
  assert.equal(f.events.length, 0);
  pending.get('cycle-B').resolve({ id: 'cycle-B' }); await second;
  assert.deepEqual(f.events.filter(event => event[0] === 'completed').map(event => event[1].id), ['cycle-B']);
  assert.equal(f.state.busy.value, false);
});

test('late preview for a previous cycle cannot replace the new impact or release its loading', async t => {
  const pending = [];
  const f = mount(t, { read: (count, id) => new Promise(resolve => pending.push({ id, resolve })) }); await flush();
  f.props.cycle = { ...cycle, id: 'cycle-B' }; await flush();
  pending[0].resolve(preview('hash-A')); await flush();
  assert.equal(f.state.preview.value, null); assert.equal(f.state.loading.value, true);
  pending[1].resolve({ ...preview('hash-B'), cycle: { ...cycle, id: 'cycle-B' } }); await flush();
  assert.equal(f.state.preview.value.cycle.id, 'cycle-B'); assert.equal(f.state.loading.value, false);
});
