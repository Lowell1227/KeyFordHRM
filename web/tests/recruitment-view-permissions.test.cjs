const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../src', relative);
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded.require = name => name in dependencies ? dependencies[name] : module.require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}

const { routes } = load('router/routes.ts');
const { buildNavigation, canAccessRoute } = load('router/navigation.ts');
const route = name => routes.find(item => item.name === name);
const auth = { user: null };
const { useTalentPermissions } = load('views/talent/useTalentPermissions.ts', { '@/stores/auth.store': { useAuthStore: () => auth } });

for (const sysRole of ['employee', 'manager', 'dept_head', 'vp', 'hr_user']) {
  test(`explicit ${sysRole} recruitment operator can work without legacy management capabilities`, () => {
    const user = { sysRole, hrCapabilities: ['recruitment_edit'], isAssessorOnly: false };
    auth.user = user;
    const permissions = useTalentPermissions();
    assert.equal(permissions.canEdit.value, true);
    assert.equal(permissions.canRead.value, true);
    for (const action of ['canDelete', 'canShare', 'canOnboard', 'canExport']) assert.equal(permissions[action]?.value, false, action);
    assert.equal(canAccessRoute(route('TalentPool'), user), true);
    assert.equal(route('TalentPool').meta.hrCapabilities.includes('recruitment_edit'), true);
    assert.deepEqual(buildNavigation(routes, user).find(item => item.key === 'recruitment').groups.flatMap(group => group.items.map(item => item.name)), ['TalentPool', 'TalentInterviews']);
    for (const name of ['Users', 'Organization', 'EntryExit', 'TalentHiringReview']) {
      const target = route(name);
      if (target) assert.equal(canAccessRoute(target, user), false, name);
    }
  });
}

for (const sysRole of ['employee', 'manager', 'dept_head', 'vp', 'hr_user']) {
  test(`explicit ${sysRole} recruitment reader has read-only navigation and hook`, () => {
    const user = { sysRole, hrCapabilities: ['recruitment_view'], isAssessorOnly: false };
    auth.user = user;
    const permissions = useTalentPermissions();
    assert.equal(permissions.canRead?.value, true);
    assert.equal(permissions.canEdit.value, false);
    assert.equal(permissions.canExport?.value, false);
    assert.equal(canAccessRoute(route('TalentPool'), user), true);
    assert.equal(route('TalentPool').meta.hrCapabilities.includes('recruitment_view'), true);
    assert.equal(canAccessRoute(route('RecruitmentOverview'), user), true);
    const recruitment = buildNavigation(routes, user).find(item => item.key === 'recruitment');
    assert.deepEqual(recruitment.groups.flatMap(group => group.items.map(item => item.name)), ['TalentPool', 'TalentInterviews']);
    for (const name of ['Users', 'TalentHiringReview', 'ConfirmationManage']) assert.equal(canAccessRoute(route(name), user), false);
  });
}

for (const sysRole of ['hr', 'system_admin', 'hr_user', 'employee']) {
  test(`assessor-only mixed ${sysRole} never has recruitment read/edit`, () => {
    const user = { sysRole, isAssessorOnly: true, hrCapabilities: ['recruitment_view', 'recruitment_edit', 'employee_archive_edit', 'employee_archive_review'] };
    auth.user = user;
    const permissions = useTalentPermissions();
    assert.equal(permissions.canRead?.value, false);
    assert.equal(permissions.canEdit.value, false);
    assert.equal(permissions.canExport?.value, false);
    assert.equal(canAccessRoute(route('TalentPool'), user), false);
    assert.equal(buildNavigation(routes, user).find(item => item.key === 'recruitment')?.groups.flatMap(group => group.items).some(item => item.name === 'TalentInterviews') ?? false, false);
    assert.equal(canAccessRoute(route('TalentInterviewDetail'), user), true);
  });
}

test('existing archive read/edit and HR/admin permissions stay compatible', () => {
  for (const [sysRole, hrCapabilities, edit] of [
    ['hr', [], true], ['system_admin', [], true], ['hr_user', ['employee_archive_edit'], true], ['hr_user', ['employee_archive_review'], false],
  ]) {
    auth.user = { sysRole, hrCapabilities };
    const permissions = useTalentPermissions();
    assert.equal(permissions.canRead?.value, true);
    assert.equal(permissions.canEdit.value, edit);
    assert.equal(permissions.canExport?.value, true);
    for (const action of ['canDelete', 'canShare', 'canOnboard']) assert.equal(permissions[action]?.value, edit, action);
  }
  auth.user = null;
  assert.equal(useTalentPermissions().canRead?.value, false);
  assert.equal(useTalentPermissions().canEdit.value, false);
  assert.equal(useTalentPermissions().canExport?.value, false);
});

function talentList(t, user) {
  auth.user = user;
  const filename = path.resolve(__dirname, '../src/views/talent/TalentListView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'export-permissions' });
  let downloads = 0;
  const dependencies = {
    vue,
    'vue-router': { useRoute: () => ({ query: {} }), onBeforeRouteUpdate() {} },
    '@/stores/auth.store': { useAuthStore: () => auth },
    './useTalentPermissions': { useTalentPermissions },
    '@/api/talent-pool.api': { talentPoolApi: { list: async () => ({ items: [], total: 0 }), applicationPositions: async () => [] } },
    '@/composables/usePagination': { usePagination: () => ({ page: vue.ref(1), pageSize: vue.ref(20), total: vue.ref(0),
      pageSizeOptions: [], reset() {}, withParams: params => params }) },
    '@/composables/useExport': { useExport: () => ({ loading: vue.ref(false), download: async () => { downloads++; } }) },
  };
  const compiled = new Module(filename, module);
  compiled.require = id => id in dependencies ? dependencies[id] : id.endsWith('.vue')
    ? { default: { name: path.basename(id, '.vue') } } : id.startsWith('@/') ? {} : require(id);
  compiled._compile(ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  let state;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() { state = compiled.exports.default.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'export-permissions',
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const rendered = new Module(filename, module);
  rendered.require = () => ({ ...vue, resolveComponent: name => ({ name }), resolveDirective: () => ({}), withDirectives: node => node });
  rendered._compile(ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  const setup = vue.proxyRefs(state);
  const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node
    : node?.default ? text(node.default()) : node?.children ? text(node.children) : '';
  const buttons = () => rendered.exports.render(setup, [], {}, setup, {}, {}).children['primary-action']()
    .filter(node => node.type?.name === 'el-button').map(node => text(node.children));
  return { state, buttons, downloads: () => downloads };
}

test('recruitment-only reader cannot see or invoke the list Excel export', async t => {
  const view = talentList(t, { sysRole: 'employee', hrCapabilities: ['recruitment_view'], isAssessorOnly: false });
  assert.equal(view.buttons().includes('导出应聘记录'), false);
  await view.state.exportApplications();
  assert.equal(view.downloads(), 0);
});

test('existing archive reviewer keeps list export without gaining editor actions', async t => {
  const view = talentList(t, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'], isAssessorOnly: false });
  assert.equal(view.buttons().includes('导出应聘记录'), true);
  assert.equal(view.buttons().includes('新增人才'), false);
  await view.state.exportApplications();
  assert.equal(view.downloads(), 1);
});

test('new recruitment operator sees creation but cannot see or invoke whole-list export', async t => {
  const view = talentList(t, { sysRole: 'employee', hrCapabilities: ['recruitment_edit'], isAssessorOnly: false });
  assert.equal(view.buttons().includes('新增人才'), true);
  assert.equal(view.buttons().includes('导出应聘记录'), false);
  await view.state.exportApplications();
  assert.equal(view.downloads(), 0);
});
