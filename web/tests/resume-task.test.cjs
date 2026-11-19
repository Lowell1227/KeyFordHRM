const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const epoch = Date.parse('2026-11-19T01:00:00Z');
const task = (extra = {}) => ({ id: 'task-1', context: 'new', status: 'processing', stage: 'recognizing',
  fileName: 'fictional.pdf', createdAt: new Date(epoch).toISOString(), deadlineAt: new Date(epoch + 150000).toISOString(),
  expiresAt: new Date(epoch + 1800000).toISOString(), ...extra });

function load(relative, dependencies) {
  const filename = path.resolve(__dirname, '../src', relative);
  assert.ok(fs.existsSync(filename), 'recoverable resume task implementation exists');
  const loaded = new Module(filename, module);
  loaded.require = id => dependencies[id] ?? require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, filename);
  return loaded.exports;
}
function session(t, overrides = {}) {
  let now = epoch;
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const calls = [];
  const api = { current: async context => { calls.push(['current', context]); return null; },
    start: async (_file, context) => { calls.push(['start', context]); return task({ context }); },
    get: async id => { calls.push(['get', id]); return task(); },
    retry: async id => { calls.push(['retry', id]); return task({ id: 'task-2' }); },
    clear: async id => { calls.push(['clear', id]); }, ...overrides };
  const { useResumeTask } = load('views/talent/components/useResumeTask.ts', {
    vue, '@/api/talent-resume.api': { talentResumeApi: api },
  });
  const state = useResumeTask();
  t.after(() => state.stop());
  return { state, calls, async tick(ms) { now += ms; t.mock.timers.tick(ms); await flush(); } };
}

test('task API uses exact context, multipart, retry, retrieval and blob contracts; legacy parse stays', async () => {
  const calls = [];
  const blob = new Blob(['validated bytes']);
  const http = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, async (...args) => {
    calls.push([method, ...args]); return args[1]?.responseType === 'blob' ? { data: blob } : null;
  }]));
  const { talentResumeApi: api } = load('api/talent-resume.api.ts', { './http': { default: http } });
  assert.equal(typeof api.current, 'function');
  await api.current('candidate-A');
  await api.start(new File(['x'], 'fictional.pdf'), 'candidate-A');
  await api.get('task-1'); await api.retry('task-1');
  assert.equal(await api.file('task-1'), blob);
  await api.clear('task-1');
  assert.deepEqual(calls[0].slice(0, 2), ['get', '/talent-resume/tasks/current']);
  assert.equal(calls[0][2].params.context, 'candidate-A');
  assert.equal(calls[1][1], '/talent-resume/tasks');
  assert.equal(calls[1][2].get('file').name, 'fictional.pdf');
  assert.equal(calls[1][3].headers['X-Resume-Context'], 'candidate-A');
  assert.deepEqual(calls.slice(2).map(call => call.slice(0, 2)), [
    ['get', '/talent-resume/tasks/task-1'], ['post', '/talent-resume/tasks/task-1/retry'],
    ['get', '/talent-resume/tasks/task-1/file'], ['delete', '/talent-resume/tasks/task-1'],
  ]);
  assert.equal(calls.at(-1)[2].responseType, 'blob', '204 bypasses the shared JSON envelope interceptor');
  assert.equal(typeof api.parse, 'function');
});

test('open always retrieves matching current task; polls every two seconds with real stage and elapsed', async t => {
  let polls = 0;
  const { state, calls, tick } = session(t, { current: async () => task(), get: async () => { polls++; return task({ stage: 'extracting' }); } });
  await state.open('new');
  assert.equal(state.recovered.value, true); assert.equal(state.busy.value, true);
  await tick(1000); assert.equal(state.elapsed.value, 1); assert.equal(state.task.value.stage, 'recognizing');
  await tick(1000); assert.equal(state.task.value.stage, 'extracting');
  assert.equal(polls, 1); assert.deepEqual(calls, []);
  state.stop(); await tick(6000);
  assert.equal(polls, 1);
  assert.equal(state.task.value, null); assert.equal(state.busy.value, false);
});

test('closing leaves accepted work retrievable and ignores late start responses', async t => {
  const pending = deferred();
  const { state, calls } = session(t, { start: () => pending.promise });
  await state.open('new');
  const starting = state.start(new File(['x'], 'fictional.pdf'));
  state.stop();
  pending.resolve(task()); await starting;
  assert.equal(state.task.value, null); assert.equal(state.busy.value, false);
  assert.equal(calls.some(call => call[0] === 'clear'), false);
});

test('late same-context open and wrong-context data cannot replace the current session', async t => {
  const old = deferred(); let opens = 0;
  const { state } = session(t, { current: async () => ++opens === 1 ? old.promise : task({ context: 'B', id: 'B' }) });
  const first = state.open('A'); await state.open('B');
  old.resolve(task({ context: 'A' })); await first;
  assert.equal(state.task.value.id, 'B');
  await state.open('C'); assert.equal(state.task.value, null);
});

test('connection failure preserves task and input opportunity, reconnect does not start another parse', async t => {
  let online = false;
  const { state, calls, tick } = session(t, { current: async () => task(), get: async () => {
    if (!online) throw Error('offline'); return task({ status: 'succeeded', result: { fields: { name: 'Synthetic' }, reviewItems: [] } });
  } });
  await state.open('new'); await tick(2000);
  assert.equal(state.task.value.id, 'task-1'); assert.match(state.error.value, /连接|重连/);
  online = true; await state.refresh();
  assert.equal(state.task.value.status, 'succeeded'); assert.equal(state.error.value, '');
  assert.equal(state.busy.value, false); assert.equal(calls.some(call => call[0] === 'start'), false);
});

test('150-second deadline releases busy immediately and definitive fetch wins over an in-flight poll', async t => {
  const poll = deferred(), final = deferred(); let gets = 0;
  const { state, tick } = session(t, { current: async () => task(), get: () => ++gets === 1 ? poll.promise : final.promise });
  await state.open('new'); await tick(2000);
  await tick(148000);
  assert.equal(state.busy.value, false); assert.equal(state.elapsed.value, 150); assert.equal(gets, 2);
  final.resolve(task({ status: 'timed_out', message: 'Deadline reached' })); await flush();
  poll.resolve(task({ status: 'processing' })); await flush();
  assert.equal(state.task.value.status, 'timed_out');
  await tick(20000); assert.equal(gets, 2);
});

test('lost start response recovers current accepted work without a duplicate POST', async t => {
  let currentCalls = 0;
  const { state, calls } = session(t, { start: async () => { calls.push(['start']); throw Error('connection lost'); },
    current: async () => ++currentCalls === 1 ? null : task() });
  await state.open('new'); await state.start(new File(['x'], 'fictional.pdf'));
  assert.equal(state.task.value.id, 'task-1'); assert.equal(state.recovered.value, true);
  assert.equal(calls.filter(call => call[0] === 'start').length, 1);
});

test('retry is explicit, uses retained file task ID, is single-flight and never automatically repeats', async t => {
  const pending = deferred(); let retries = 0;
  const { state, tick } = session(t, { current: async () => task({ status: 'failed' }),
    retry: () => { retries++; return pending.promise; } });
  await state.open('new'); await tick(5000); assert.equal(retries, 0);
  const first = state.retry(); await state.retry(); assert.equal(retries, 1);
  pending.resolve(task({ id: 'task-2', createdAt: new Date(epoch + 5000).toISOString() })); await first;
  assert.equal(state.task.value.id, 'task-2'); assert.equal(state.busy.value, true);
});

test('expired retained file cannot be retried; explicit clear is the only destructive session action', async t => {
  const { state, calls, tick } = session(t, { current: async () => task({ status: 'failed' }) });
  await state.open('new'); await tick(1800001); await state.retry();
  assert.equal(calls.some(call => call[0] === 'retry'), false);
  assert.match(state.error.value, /过期/);
  await state.clear(); assert.deepEqual(calls.at(-1), ['clear', 'task-1']);
  assert.equal(state.task.value, null);
});

test('clear supersedes an in-flight poll without leaving checking busy or restoring the old task', async t => {
  const pending = deferred();
  const { state, tick } = session(t, { current: async () => task(), get: () => pending.promise });
  await state.open('new'); await tick(2000);
  assert.equal(state.checking.value, true);
  assert.equal(await state.clear(), true);
  assert.equal(state.checking.value, false);
  pending.resolve(task()); await flush();
  assert.equal(state.task.value, null); assert.equal(state.busy.value, false);
});

test('failed clear keeps the retained task observable and its deadline still ends busy', async t => {
  const pending = deferred(); let gets = 0;
  const { state, tick } = session(t, { current: async () => task(), clear: async () => { throw Error('offline'); },
    get: () => ++gets === 1 ? pending.promise : Promise.resolve(task({ status: 'timed_out' })) });
  await state.open('new');
  assert.equal(await state.clear(), false);
  assert.equal(state.task.value.id, 'task-1');
  await tick(2000); await tick(148000);
  assert.equal(state.busy.value, false);
  assert.equal(state.task.value.status, 'timed_out');
});

test('opening an overdue retained task fetches definitive status and cannot restart a billable attempt', async t => {
  let gets = 0;
  const { state, tick, calls } = session(t, { current: async () => task(), get: async () => { gets++; return task({ status: 'timed_out' }); } });
  await tick(151000); await state.open('new');
  assert.equal(gets, 1); assert.equal(state.task.value.status, 'timed_out');
  assert.equal(state.busy.value, false); assert.equal(calls.some(call => call[0] === 'start'), false);
});

test('resume state never writes candidate, fields or file data to browser persistence', () => {
  for (const relative of ['views/talent/components/useResumeTask.ts', 'views/talent/components/TalentFormDrawer.vue']) {
    const filename = path.resolve(__dirname, '../src', relative);
    assert.ok(fs.existsSync(filename));
    assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /localStorage|sessionStorage|indexedDB/);
  }
});
