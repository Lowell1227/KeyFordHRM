const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { createRouter, createMemoryHistory, RouterView, isNavigationFailure, NavigationFailureType } = require('vue-router');
const { parse, compileScript } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function editor(t, confirm = async () => { throw Error('keep editing'); }) {
  let prompts = 0, list, form;
  const dependencies = {
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'hr', sysRole: 'hr' } }) },
    '@/composables/useExport': { useExport: () => ({ loading: vue.ref(false), download() {} }) },
    '@/api/talent-pool.api': { talentPoolApi: {
      list: async () => ({ items: [], total: 0 }), applicationPositions: async () => [],
      detail: async id => ({ id, editVersion: 'v1', name: id, phone: '', gender: 'unknown',
        sourceChannel: 'referral', tags: [], status: 'new', files: [], note: `saved-${id}` }),
    } },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: { owners: async () => ({ items: [] }) } },
    '@/api/talent-resume.api': { talentResumeApi: { status: async () => ({ enabled: false, configured: false }) } },
    '@/utils/image-compress': { isImageFile: () => false },
    './talent-file-upload': { TALENT_MAX_FILES: 3, TALENT_FILE_EXTENSIONS: ['pdf'] },
    'element-plus': { ElMessage: {}, ElMessageBox: { confirm: (...args) => { prompts++; return confirm(...args); } } },
    './useResumeTask': { useResumeTask: () => ({
      task: vue.ref(null), error: vue.ref(''), recovered: vue.ref(false), checking: vue.ref(false),
      acting: vue.ref(false), elapsed: vue.ref(0), busy: vue.ref(false), open() {}, stop() {},
    }) },
  };
  function load(filename) {
    const loaded = new Module(filename, module);
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = id => {
      if (id in dependencies) return dependencies[id];
      if (id.endsWith('.vue')) return {};
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + '.ts'));
      return original(id);
    };
    let source = fs.readFileSync(filename, 'utf8');
    if (filename.endsWith('.vue')) source = compileScript(parse(source).descriptor, { id: filename }).content;
    loaded._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, filename);
    return loaded.exports;
  }
  const formComponent = load(path.join(root, 'views/talent/components/TalentFormDrawer.vue')).default;
  const listComponent = load(path.join(root, 'views/talent/TalentListView.vue')).default;
  const Form = { props: formComponent.props, setup(props, context) {
    form = formComponent.setup(props, context);
    form.formRef.value = { validate: async () => true, clearValidate() {} };
    return () => null;
  } };
  const List = { setup(props, context) {
    list = listComponent.setup(props, context);
    return () => vue.h(Form, {
      modelValue: list.formVisible.value, candidateId: list.activeCandidateId.value,
      'onUpdate:modelValue': value => { list.formVisible.value = value; },
      ref: value => { if (list.formDrawer) list.formDrawer.value = value; },
    });
  } };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/talents', component: List }] });
  await router.push('/talents?candidateId=A');
  const app = renderer.createApp({ render: () => vue.h(RouterView) });
  app.use(router); app.mount({}); t.after(() => app.unmount());
  await flush();
  await router.push('/talents');
  list.openEdit('B'); await flush();
  return { list, form, router, prompts: () => prompts };
}

test('cancelled linked navigation preserves route, B input and pending files', async t => {
  const view = await editor(t);
  view.form.form.note = 'unsaved-B';
  const file = new File(['fictional'], 'fictional.pdf');
  view.form.pendingFiles.value = [file];
  const navigation = new Promise(resolve => {
    const stop = view.router.afterEach((_to, _from, failure) => { stop(); resolve(failure); });
  });
  view.router.back();
  const result = await navigation; await flush();
  assert.ok(isNavigationFailure(result, NavigationFailureType.aborted));
  assert.equal(view.router.currentRoute.value.fullPath, '/talents');
  assert.equal(view.list.activeCandidateId.value, 'B');
  assert.equal(view.form.form.note, 'unsaved-B');
  assert.deepEqual(view.form.pendingFiles.value, [file]);
  assert.equal(view.list.formVisible.value, true);
  assert.equal(view.list.detailVisible.value, false);
  assert.equal(view.prompts(), 1);
});

test('confirmed navigation closes the editor only after approval and opens exact A without overlap', async t => {
  const decision = deferred();
  const view = await editor(t, () => decision.promise);
  view.form.form.note = 'unsaved-B';
  const states = [];
  const stop = vue.watch(() => [view.list.formVisible.value, view.list.detailVisible.value],
    value => states.push(value), { flush: 'sync' });
  t.after(stop);
  const navigation = view.router.push('/talents?candidateId=A&applicationId=application-A'); await flush();
  assert.equal(view.router.currentRoute.value.fullPath, '/talents');
  assert.equal(view.list.activeCandidateId.value, 'B');
  assert.equal(view.form.form.note, 'unsaved-B');
  assert.equal(view.list.formVisible.value, true);
  decision.resolve(); await navigation; await flush();
  assert.equal(view.router.currentRoute.value.query.candidateId, 'A');
  assert.equal(view.list.activeCandidateId.value, 'A');
  assert.deepEqual(view.list.activeApplicationMatch.value, { id: 'application-A' });
  assert.equal(view.list.formVisible.value, false);
  assert.equal(view.list.detailVisible.value, true);
  assert.ok(states.every(([editing, detail]) => !(editing && detail)));
  assert.equal(view.prompts(), 1);
});

test('saving and attachment upload block identity changes without opening discard confirmation', async t => {
  const view = await editor(t, async () => true);
  view.form.form.note = 'unsaved-B';
  for (const flag of ['saving', 'pendingUploading']) {
    view.form[flag].value = true;
    const result = await view.router.push('/talents?candidateId=A'); await flush();
    assert.ok(isNavigationFailure(result, NavigationFailureType.aborted), flag);
    assert.equal(view.router.currentRoute.value.fullPath, '/talents');
    assert.equal(view.list.activeCandidateId.value, 'B');
    assert.equal(view.form.form.note, 'unsaved-B');
    assert.equal(view.list.formVisible.value, true);
    view.form[flag].value = false;
  }
  assert.equal(view.prompts(), 0);
});

test('clean editor leaves without a prompt and does not cover the target detail', async t => {
  const view = await editor(t);
  await view.router.push('/talents?candidateId=A'); await flush();
  assert.equal(view.prompts(), 0);
  assert.equal(view.list.formVisible.value, false);
  assert.equal(view.list.detailVisible.value, true);
  assert.equal(view.list.activeCandidateId.value, 'A');
});

test('a superseded navigation cannot close B when its old discard prompt resolves', async t => {
  const decision = deferred();
  const view = await editor(t, () => decision.promise);
  view.form.form.note = 'unsaved-B';
  const first = view.router.push('/talents?candidateId=A'); await flush();
  const second = await view.router.push('/talents?candidateId=C');
  assert.ok(isNavigationFailure(second, NavigationFailureType.aborted));
  decision.resolve(); await first; await flush();
  assert.equal(view.router.currentRoute.value.fullPath, '/talents');
  assert.equal(view.list.activeCandidateId.value, 'B');
  assert.equal(view.form.form.note, 'unsaved-B');
  assert.equal(view.list.formVisible.value, true);
  assert.equal(view.prompts(), 1);
});

test('filter-only navigation does not discard an open editor', async t => {
  const view = await editor(t);
  view.form.form.note = 'unsaved-B';
  await view.router.push('/talents?dueOnly=true'); await flush();
  assert.equal(view.form.form.note, 'unsaved-B');
  assert.equal(view.list.activeCandidateId.value, 'B');
  assert.equal(view.list.formVisible.value, true);
  assert.equal(view.prompts(), 0);
});
