const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const filename = path.resolve(__dirname, '../src/composables/useVisibleRefresh.ts');
const loaded = new Module(filename, module);
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const flush = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve(); };
function harness(t, refresh, intervalMs = 10000) {
  const oldWindow = global.window, oldDocument = global.document;
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false;
  global.window = window; global.document = document;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const enabled = vue.ref(true), blocked = vue.ref(false);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() {
    loaded.exports.useVisibleRefresh({ refresh, intervalMs, enabled: () => enabled.value, blocked: () => blocked.value });
    return () => null;
  } }); app.mount({});
  t.after(() => { app.unmount(); global.window = oldWindow; global.document = oldDocument; });
  return { enabled, blocked, app, window, document,
    async tick(ms) { now += ms; t.mock.timers.tick(ms); await flush(); },
    async visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); await flush(); },
    async focus() { window.dispatchEvent(new Event('focus')); await flush(); },
  };
}
test('polls only visible, enabled pages and resumes on returning without duplicate focus requests', async t => {
  let calls = 0; const h = harness(t, async () => { calls++; });
  assert.equal(calls, 0); await h.tick(10000); assert.equal(calls, 1);
  await h.visibility(true); await h.tick(30000); assert.equal(calls, 1);
  await h.visibility(false); await h.focus(); assert.equal(calls, 2);
  h.enabled.value = false; await h.tick(30000); assert.equal(calls, 2);
  h.enabled.value = true; await flush(); await h.tick(10000); assert.equal(calls, 3);
  h.app.unmount(); await h.tick(30000); await h.focus(); assert.equal(calls, 3);
});
test('blocks while editing and invalidates already running responses, then refreshes once', async t => {
  const guards = [], resolves = []; const h = harness(t, guard => {
    guards.push(guard); return new Promise(resolve => resolves.push(resolve));
  });
  await h.tick(10000); assert.equal(guards.length, 1); assert.equal(guards[0](), true);
  h.blocked.value = true; await flush(); assert.equal(guards[0](), false);
  await h.tick(30000); await h.focus(); assert.equal(guards.length, 1);
  resolves[0](); await flush(); h.blocked.value = false; await flush();
  await h.tick(1000); assert.equal(guards.length, 2);
  h.enabled.value = false; await flush(); assert.equal(guards[1](), false);
  resolves[1](); await flush();
});
test('focus-only workbench does not poll and survives a failed refresh', async t => {
  let calls = 0; const h = harness(t, async () => { calls++; throw Error('network'); }, 0);
  await h.tick(60000); assert.equal(calls, 0);
  await h.focus(); assert.equal(calls, 1); await h.focus(); assert.equal(calls, 1);
  await h.tick(1000); await h.focus(); assert.equal(calls, 2);
});
test('a quick hide/show invalidates the first response and schedules one coalesced recovery', async t => {
  const guards = [], resolves = []; const h = harness(t, guard => {
    guards.push(guard); return new Promise(resolve => resolves.push(resolve));
  });
  await h.focus(); assert.equal(guards.length, 1);
  await h.visibility(true); await h.visibility(false); await h.focus();
  assert.equal(guards[0](), false); resolves[0](); await flush();
  await h.tick(750); assert.equal(guards.length, 2); assert.equal(guards[1](), true);
  resolves[1](); await flush(); await h.tick(10000); assert.equal(guards.length, 3);
  resolves[2](); await flush();
});
test('a new focus during a slow request queues one trailing refresh instead of dropping the event', async t => {
  const resolves = []; let calls = 0;
  const h = harness(t, () => { calls++; return new Promise(resolve => resolves.push(resolve)); }, 0);
  await h.focus(); await h.tick(1000); await h.focus(); await h.focus();
  assert.equal(calls, 1); resolves[0](); await flush(); assert.equal(calls, 2);
  resolves[1](); await flush(); assert.equal(calls, 2);
});
