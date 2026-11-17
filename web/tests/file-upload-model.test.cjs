const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
function load(filename, dependencies, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), dependencies);
    return originalRequire(id);
  };
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

// Exercise the real SFC setup, props and Vue lifecycle. Rendering is covered by the real preview spec.
function mount(t, relative, input, dependencies = {}, listeners = {}) {
  const messages = [];
  const filename = path.join(root, relative);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, {
    'element-plus': { ElMessage: Object.fromEntries(['success', 'warning', 'error'].map(type =>
      [type, value => messages.push([type, value])])) },
    ...dependencies,
  }, compileScript(descriptor, { id: relative }).content).default;
  const props = vue.reactive(input), events = [];
  let state, mounted = true;
  const subject = { ...component, setup(input, context) {
    state = component.setup(input, { ...context, emit: (...args) => {
      events.push(args);
      listeners[args[0]]?.(...args.slice(1));
    } });
    return () => null;
  } };
  const app = renderer.createApp({ setup: () => () => vue.h(subject, props) });
  app.mount({});
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  t.after(unmount);
  return { state, props, events, messages, unmount };
}
const attachment = name => ({ name: `${name}.pdf`, url: `/storage/download?key=${name}`, size: 10 });
const names = attachments => attachments.map(item => item.name);
const file = name => new File(['fictional evidence'], `${name}.pdf`, { type: 'application/pdf' });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function uploader(t, initial = [attachment('A'), attachment('B')], extra = {}) {
  const editor = mount(t, 'components/common/FileUpload.vue', { modelValue: initial, ...extra }, {
    '@/api/upload.api': { uploadApi: {} },
  }, {
    'update:modelValue': next => { editor.props.modelValue = next.map(item => ({ ...item })); },
  });
  return editor;
}

test('#15 delete -> upload replaces parent model -> delete preserves the new attachment', async t => {
  const editor = uploader(t);
  editor.state.onRemove(0);
  await vue.nextTick();
  editor.props.modelValue = [...editor.props.modelValue, attachment('C')];
  await vue.nextTick();
  editor.state.onRemove(0);
  assert.deepEqual(names(editor.events.filter(([event]) => event === 'update:modelValue').at(-1)[1]), ['C.pdf']);
  assert.deepEqual(names(editor.events.filter(([event]) => event === 'change').at(-1)[1]), ['C.pdf']);
});

test('#15 parent clear and target replacement never retain the previous list', async t => {
  const editor = uploader(t);
  editor.props.modelValue = [];
  await vue.nextTick();
  assert.deepEqual(names(editor.state.fileList.value), []);
  editor.props.modelValue = [attachment('target-B'), attachment('new-B')];
  await vue.nextTick();
  editor.state.onRemove(0);
  assert.deepEqual(names(editor.props.modelValue), ['new-B.pdf']);
});

test('#15 maxCount is checked against the latest parent list', async t => {
  const editor = uploader(t, [], { maxCount: 1 });
  editor.props.modelValue = [attachment('A')];
  await vue.nextTick();
  editor.state.onFileChange([file('B')]);
  assert.equal(editor.events.filter(([event]) => event === 'upload').length, 0);
  assert.equal(editor.messages[0][0], 'warning');
});

test('#15 deletion does not mutate a parent-owned array', t => {
  const initial = Object.freeze([attachment('A'), attachment('B')]);
  const editor = uploader(t, initial);
  editor.state.onRemove(0);
  assert.deepEqual(names(initial), ['A.pdf', 'B.pdf']);
  assert.deepEqual(names(editor.props.modelValue), ['B.pdf']);
});

function parentEditor(t, kind, upload) {
  const windowBefore = global.window;
  global.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout, clearTimeout };
  const snapshot = kind === 'IndicatorSnapshot';
  const props = snapshot
    ? { taskId: 'A', selfEvalUserId: 'employee', instances: [], selfEvalMode: true, canConfirm: false, selfEvalSummary: null }
    : { task: { id: 'A' }, instances: [], summary: null };
  const editor = mount(t, `views/task/components/${kind}.vue`, props, {
    // Only the network is substituted; these tests are not real upload/backend evidence.
    '@/api/upload.api': { uploadApi: { upload } },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'employee' } }) },
    ...Object.fromEntries(['indicators', 'templates', 'departments', 'objectives', 'users'].map(name =>
      [`@/api/${name}.api`, { [`${name}Api`]: {} }])),
  });
  t.after(() => { global.window = windowBefore; });
  return {
    ...editor, form: snapshot ? editor.state.selfEvalForm : editor.state.form,
    reset: () => { editor.props[snapshot ? 'selfEvalSummary' : 'summary'] = { attachments: [] }; },
    switchTarget: id => { if (snapshot) editor.props.taskId = id; else editor.props.task = { id }; },
    readonly: () => { editor.props[snapshot ? 'selfEvalReadonly' : 'readonly'] = true; },
  };
}

for (const kind of ['IndicatorSnapshot', 'SelfEvalForm']) {
  for (const boundary of ['reset', 'switchTarget', 'unmount', 'readonly']) {
    for (const outcome of ['resolve', 'reject']) {
      test(`#15 ${kind} ignores late upload ${outcome} after ${boundary}`, async t => {
        const pending = deferred();
        let uploads = 0;
        const editor = parentEditor(t, kind, () => { uploads++; return pending.promise; });
        const request = editor.state.handleUpload([file('old'), file('queued-old')]);
        editor[boundary]('B');
        await vue.nextTick();
        pending[outcome](outcome === 'resolve' ? attachment('old') : new Error('obsolete request'));
        await request;
        assert.deepEqual(names(editor.form.attachments), []);
        assert.deepEqual(editor.messages, []);
        assert.equal(uploads, 1, 'an obsolete batch must not start its next upload');
      });
    }
  }
  test(`#15 ${kind} valid inflight upload appends to the latest list without resurrecting deleted files`, async t => {
    const pending = deferred();
    const editor = parentEditor(t, kind, () => pending.promise);
    editor.form.attachments = [attachment('A'), attachment('B')];
    const request = editor.state.handleUpload([file('C')]);
    editor.state.handleAttachmentsChange([attachment('B')]);
    pending.resolve(attachment('C'));
    await request;
    assert.deepEqual(names(editor.form.attachments), ['B.pdf', 'C.pdf']);
    assert.equal(editor.messages[0][0], 'success');
  });
  test(`#15 ${kind} accepts a fresh upload after resetting the form`, async t => {
    const pending = deferred();
    let calls = 0;
    const editor = parentEditor(t, kind, () => ++calls === 1 ? pending.promise : Promise.resolve(attachment('new')));
    const obsolete = editor.state.handleUpload([file('old')]);
    editor.reset();
    await vue.nextTick();
    await editor.state.handleUpload([file('new')]);
    pending.resolve(attachment('old'));
    await obsolete;
    assert.deepEqual(names(editor.form.attachments), ['new.pdf']);
  });
  test(`#15 ${kind} keeps both valid uploads that finish out of order`, async t => {
    const first = deferred(), second = deferred();
    let calls = 0;
    const editor = parentEditor(t, kind, () => ++calls === 1 ? first.promise : second.promise);
    const a = editor.state.handleUpload([file('A')]);
    const b = editor.state.handleUpload([file('B')]);
    second.resolve(attachment('B')); await b;
    first.resolve(attachment('A')); await a;
    assert.deepEqual(names(editor.form.attachments), ['B.pdf', 'A.pdf']);
  });
}

test('#15 clearing the self-evaluation draft invalidates the current upload', async t => {
  const pending = deferred();
  const editor = parentEditor(t, 'IndicatorSnapshot', () => pending.promise);
  const request = editor.state.handleUpload([file('old')]);
  editor.state.clearSelfEvalDraft();
  pending.resolve(attachment('old'));
  await request;
  assert.deepEqual(names(editor.form.attachments), []);
  assert.deepEqual(editor.messages, []);
});
