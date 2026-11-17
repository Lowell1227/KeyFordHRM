const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/utils/task-attachment-download.ts');
const origin = 'http://localhost:5173';
const attachment = { name: 'fictional-evidence.pdf', url: '/storage/download?key=uploads%2Ffictional.pdf' };

function subject(t, download = async () => new Blob(['%PDF-1.4 fictional'], { type: 'application/pdf' })) {
  assert.ok(fs.existsSync(filename), 'task attachment clicks require a shared authenticated download function');
  const calls = [], messages = [], revoked = [], timers = [], links = [];
  const previous = { window: global.window, document: global.document };
  global.window = { location: { origin }, setTimeout: (fn, delay) => { timers.push({ fn, delay }); } };
  global.document = {
    body: { appendChild(link) { link.attached = true; } },
    createElement(tag) {
      assert.equal(tag, 'a');
      const link = { click() { this.clicked = true; }, remove() { this.removed = true; } };
      links.push(link);
      return link;
    },
  };
  t.after(() => { global.window = previous.window; global.document = previous.document; });
  t.mock.method(URL, 'createObjectURL', blob => {
    assert.ok(blob instanceof Blob);
    return 'blob:fictional-download';
  });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id === '@/api/upload.api') return { uploadApi: { download: async url => { calls.push(url); return download(url); } } };
    if (id === 'element-plus') return { ElMessage: { error: message => messages.push(message) } };
    return originalRequire(id);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return { run: loaded.exports.downloadTaskAttachment, calls, messages, revoked, timers, links };
}

for (const url of [attachment.url, `/api/v1${attachment.url}`, `${origin}${attachment.url}`, `${origin}/api/v1${attachment.url}`]) {
  test(`authenticated download normalizes ${url} without a second API prefix`, async t => {
    const s = subject(t);
    await s.run({ ...attachment, url });
    assert.deepEqual(s.calls, [attachment.url]);
    assert.deepEqual(s.messages, []);
    assert.equal(s.links[0].href, 'blob:fictional-download');
    assert.equal(s.links[0].download, attachment.name);
    assert.equal(s.links[0].clicked, true);
    assert.equal(s.links[0].removed, true);
    assert.deepEqual(s.revoked, [], 'let the browser consume the Blob URL first');
    assert.equal(s.timers.length, 1);
    assert.ok(s.timers[0].delay > 0 && s.timers[0].delay <= 60_000);
    s.timers[0].fn();
    assert.deepEqual(s.revoked, ['blob:fictional-download']);
  });
}

for (const url of [
  'https://evil.example/storage/download?key=x', '//evil.example/storage/download?key=x',
  'javascript:alert(1)', 'data:text/html,download', `${origin}.evil.example/storage/download?key=x`,
  'http://user:password@localhost:5173/storage/download?key=x',
  '/api/v1/api/v1/storage/download?key=x', '/storage/upload?key=x', '/storage/download',
  '/storage/download?key=', '/storage/download?key=x&key=y',
  '/storage/download?key=x&token=secret', '/storage/download?key=x#fragment',
]) {
  test(`invalid attachment URL never reaches the authenticated client: ${url}`, async t => {
    const s = subject(t);
    await s.run({ ...attachment, url });
    assert.deepEqual(s.calls, []);
    assert.equal(s.messages.length, 1, 'invalid download must be visible');
    assert.deepEqual(s.links, []);
    assert.deepEqual(s.timers, []);
  });
}

for (const status of [401, 403, 404, undefined]) {
  test(`failed download (${status ?? 'network'}) reports failure without a fake file`, async t => {
    const s = subject(t, async () => { throw { response: { status } }; });
    await s.run(attachment);
    assert.deepEqual(s.calls, [attachment.url]);
    assert.equal(s.messages.length, 1);
    if (status === 403) assert.match(s.messages[0], /无权限/);
    assert.deepEqual(s.links, []);
    assert.deepEqual(s.timers, []);
  });
}

test('a failed browser click still removes the anchor and revokes its Blob URL', async t => {
  const s = subject(t);
  const createElement = document.createElement;
  document.createElement = tag => {
    const link = createElement(tag);
    link.click = () => { throw new Error('browser download failed'); };
    return link;
  };
  await s.run(attachment);
  assert.equal(s.messages.length, 1);
  assert.equal(s.links[0].removed, true);
  s.timers.forEach(timer => timer.fn());
  assert.deepEqual(s.revoked, ['blob:fictional-download']);
});
