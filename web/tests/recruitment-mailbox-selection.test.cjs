const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const mailbox = id => ({ id, name: `虚构招聘邮箱${id}`, enabled: true, configured: true, lastSyncedAt: null });
function setup(t, options = {}) {
  const file = path.resolve(__dirname, '../src/views/recruitment/useRecruitmentMailbox.ts');
  assert.ok(fs.existsSync(file), 'mailbox choices must drive real intake reads');
  const m = new Module(file, module); m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m), reads = [], syncs = [], auth = vue.reactive({ user: { id: 'fictional-hr' } }), canEdit = vue.ref(true);
  let refreshed = 0;
  m.require = name => {
    if (name === '@/api/recruitment-intakes.api') return { recruitmentIntakesApi: {
      mailboxes: async () => options.mailboxes ?? [mailbox('A'), mailbox('B')],
      mailStatus: async id => { reads.push(id); return options.status?.(id) ?? { configured: true }; },
      syncMail: async (limit, id) => { syncs.push({ limit, id }); return options.sync?.() ?? { synced: 2, skipped: 0, failed: 0, complete: true, hasMore: false }; },
    } };
    if (name === '@/stores/auth.store') return { useAuthStore: () => auth };
    if (name === './intake-presentation') return { intakeError: () => '读取未完成，请重试' };
    return original(name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const scope = vue.effectScope(); const state = scope.run(() => m.exports.useRecruitmentMailbox(canEdit, async () => { refreshed++; }));
  t.after(() => scope.stop()); return { state, reads, syncs, auth, canEdit, get refreshed() { return refreshed; } };
}

test('multiple usable mailboxes require a choice and never read implicitly', async t => {
  const f = setup(t); await flush();
  assert.equal(f.state.selectedMailboxId.value, ''); assert.equal(f.reads.length, 0);
  await f.state.syncMailbox(); assert.equal(f.syncs.length, 0);
  f.state.selectedMailboxId.value = 'B'; await flush();
  assert.deepEqual(f.reads, ['B']); await f.state.syncMailbox();
  assert.deepEqual(f.syncs, [{ limit: 10, id: 'B' }]); assert.equal(f.refreshed, 1);
  assert.match(f.state.mailMessage.value, /虚构招聘邮箱B/);
});

test('one usable mailbox can be selected without reading mail automatically', async t => {
  const f = setup(t, { mailboxes: [mailbox('only')] }); await flush();
  assert.equal(f.state.selectedMailboxId.value, 'only'); assert.deepEqual(f.reads, ['only']); assert.equal(f.syncs.length, 0);
});

test('a late status for mailbox A cannot enable mailbox B', async t => {
  const old = deferred(); const f = setup(t, { status: id => id === 'A' ? old.promise : { configured: false } }); await flush();
  f.state.selectedMailboxId.value = 'A'; await flush(); f.state.selectedMailboxId.value = 'B'; await flush();
  old.resolve({ configured: true }); await flush();
  assert.equal(f.state.mailboxConfigured.value, false); await f.state.syncMailbox(); assert.equal(f.syncs.length, 0);
});

test('changing actor while a read is running cannot show the former actor a success or refresh records', async t => {
  const pending = deferred(); const f = setup(t, { mailboxes: [mailbox('only')], sync: () => pending.promise }); await flush();
  const read = f.state.syncMailbox(); f.auth.user = { id: 'different-hr' }; await flush();
  pending.resolve({ synced: 2, skipped: 0, failed: 0, complete: true, hasMore: false }); await read;
  assert.equal(f.refreshed, 0); assert.equal(f.state.mailMessage.value, '');
});

test('users without intake maintenance cannot fetch choices or synchronize', async t => {
  const f = setup(t); f.canEdit.value = false; await flush();
  assert.deepEqual(f.state.mailboxes.value, []); f.state.selectedMailboxId.value = 'A';
  await f.state.readMailboxStatus(); await f.state.syncMailbox(); assert.equal(f.reads.length, 0); assert.equal(f.syncs.length, 0);
});
