const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(file, dependencies = {}) {
  const m = new Module(file, module); m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = name => name in dependencies ? dependencies[name] : original(name);
  assert.ok(fs.existsSync(file), 'the configuration editor must exist');
  const source = fs.readFileSync(file, 'utf8');
  const code = file.endsWith('.vue') ? compileScript(parse(source).descriptor, { id: file }).content : source;
  m._compile(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
function mount(t, file, dependencies) {
  const component = load(path.join(root, file), dependencies).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); return state;
}
const saved = (overrides = {}) => ({ id: 'recruitment-mail', title: '招聘邮箱', description: '只读指定文件夹',
  revision: 4, appliedRevision: 3, source: 'database', encryptionReady: true,
  fields: [
    { key: 'account', label: '邮箱账号', type: 'text', required: true, configured: true, value: 'fictional@example.invalid' },
    { key: 'password', label: '客户端授权密码', type: 'secret', required: true, configured: true },
    { key: 'folder', label: '获准文件夹', type: 'text', required: true, configured: true, value: '招聘简历' },
    { key: 'enabled', label: '启用读取', type: 'boolean', required: false, configured: true, value: false },
  ], verification: 'untested', verifiedAt: null, verificationMessage: null, testKind: 'connection', requiresSample: false, ...overrides });
async function editor(t, options = {}) {
  const writes = [], tests = [], applications = [], route = vue.reactive({ params: { setting: 'recruitment-mail' }, query: { mailbox: 'recruitment-mail' } });
  let current = saved(options.view);
  const api = {
    get: async () => options.get?.() ?? structuredClone(current),
    save: async (id, body) => { writes.push({ id, body }); if (options.save) return options.save(id, body);
      current = saved({ revision: 5, fields: current.fields.map(f => ({ ...f, ...(f.type !== 'secret' ? { value: body.values[f.key] } : {}) })) }); return structuredClone(current); },
    test: async (id, body) => { tests.push({ id, body }); return saved({ verification: 'passed' }); },
    apply: async (id, body) => { applications.push({ id, body }); return saved({ verification: 'passed', appliedRevision: 4 }); },
  };
  const state = mount(t, 'views/system/SystemConfigurationView.vue', { vue,
    'vue-router': { useRoute: () => route, onBeforeRouteLeave() {}, onBeforeRouteUpdate() {} },
    'element-plus': { ElMessageBox: { confirm: async () => {} } },
    '@/api/system-configuration.api': { systemConfigurationApi: api },
    './RecruitmentMailboxesPanel.vue': {},
  });
  await flush(); return { state, writes, tests, applications, route };
}

test('every platform configuration opens a real editor and business maintenance retains its workflow', () => {
  const { configurationTargets: targets } = load(path.join(root, 'router/configuration-targets.ts'));
  const platform = ['ai-progress-kimi', 'ai-progress-deepseek', 'ai-progress-qwen', 'ai-resume', 'dingtalk-login',
    'dingtalk-notifications', 'dingtalk-calendar', 'recruitment-demand', 'recruitment-mail', 'payroll-attendance', 'payroll-access'];
  for (const id of platform) assert.ok(targets[id].path, `${id} needs an editable destination`);
  assert.equal(targets['recruitment-mail'].path, '/system/configurations/recruitment-mail');
  assert.equal(targets['ai-resume'].path, '/system/configurations/ai-resume');
  assert.equal(targets['ai-progress-deepseek'].query.provider, 'deepseek');
  assert.equal(targets['payroll-rules'].path, '/payroll/standards');
  assert.equal(targets['personnel-manager'].path, '/users');
});

test('default overview includes a fully verified DeepSeek rather than hiding it in pending', async t => {
  const targets = load(path.join(root, 'router/configuration-targets.ts'));
  const state = mount(t, 'views/system/ConfigurationStatusPanel.vue', { vue,
    'vue-router': { useRoute: () => ({ query: {} }) },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { sysRole: 'system_admin' } }) },
    '@/api/system-configuration.api': { getConfigurationStatus: async () => [
      { id: 'ai-progress-deepseek', fields: [{ label: 'API Key', state: 'present' }], verification: 'passed', verifiedAt: null, enabled: false },
      { id: 'recruitment-mail', fields: [{ label: '账号', state: 'missing' }], verification: 'untested', verifiedAt: null, enabled: false },
    ] },
    '@/components/common/ConfigurationLink.vue': {}, '@/router/configuration-targets': targets,
  });
  await flush();
  assert.equal(state.filter.value, 'all');
  assert.ok(state.display.value.flatMap(g => g.rows).some(row => row.id === 'ai-progress-deepseek'));
  state.filter.value = 'pending';
  assert.deepEqual(state.display.value.flatMap(g => g.rows).map(row => row.id), ['recruitment-mail']);
});

test('saved secrets start empty and blank secrets are omitted while explicit false is saved', async t => {
  const f = await editor(t);
  assert.equal(f.state.draft.password, '');
  f.state.draft.folder = '新获准目录'; await f.state.save();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].body.expectedRevision, 4);
  assert.equal('password' in f.writes[0].body.values, false);
  assert.equal(f.writes[0].body.values.enabled, false);
  assert.equal(f.state.config.value.revision, 5);
  assert.equal(f.tests.length, 0); assert.equal(f.applications.length, 0);
});

test('a replacement secret is sent once, cleared after saving and never exposed by the response', async t => {
  const f = await editor(t);
  f.state.draft.password = 'fictional-replacement'; await f.state.save();
  assert.equal(f.writes[0].body.values.password, 'fictional-replacement');
  assert.equal(f.state.draft.password, '');
  assert.equal(f.state.config.value.fields.find(field => field.key === 'password').value, undefined);
});

test('incomplete drafts can be saved and report required field errors before connection verification', async t => {
  const f = await editor(t);
  f.state.draft.account = ' '; await f.state.save();
  assert.equal(f.writes.length, 1);
  await f.state.testConfiguration();
  assert.match(f.state.errors.account, /邮箱账号/);
  assert.equal(f.tests.length, 0);
});

test('409 keeps every input and requires an explicit latest-version read before retrying', async t => {
  let version = 4;
  const f = await editor(t, { get: () => saved({ revision: version }), save: async () => { throw { response: { status: 409 } }; } });
  f.state.draft.folder = '手工输入'; f.state.draft.password = 'fictional-unsaved';
  await f.state.save();
  assert.equal(f.state.draft.folder, '手工输入'); assert.equal(f.state.draft.password, 'fictional-unsaved');
  assert.equal(f.state.conflict.value, true); assert.match(f.state.feedback.value, /输入已保留/);
  version = 7; await f.state.syncRevision();
  assert.equal(f.state.config.value.revision, 7); assert.equal(f.state.draft.folder, '手工输入');
  assert.equal(f.state.draft.password, 'fictional-unsaved'); assert.equal(f.state.conflict.value, false);
});

test('reading after 409 compares current nonsecret values with retained inputs without exposing secrets', async t => {
  let latest = false;
  const f = await editor(t, { get: () => saved({ revision: latest ? 7 : 4,
    fields: saved().fields.map(field => field.key === 'folder' && latest ? { ...field, value: '其他管理员保存的目录' } : field) }),
  save: async () => { throw { response: { status: 409 } }; } });
  f.state.draft.folder = '我保留的目录'; f.state.draft.password = 'fictional-kept-secret';
  await f.state.save(); latest = true; await f.state.syncRevision();
  const difference = f.state.differences.value.find(field => field.key === 'folder');
  assert.equal(difference.current, '其他管理员保存的目录'); assert.equal(difference.retained, '我保留的目录');
  assert.equal(f.state.differences.value.some(field => field.key === 'password'), false);
  assert.ok(!JSON.stringify(f.state.differences.value).includes('fictional-kept-secret'));
  f.state.useCurrentValue('folder');
  assert.equal(f.state.draft.folder, '其他管理员保存的目录');
  assert.equal(f.state.draft.password, 'fictional-kept-secret');
  assert.equal(f.state.differences.value.some(field => field.key === 'folder'), false);
});

test('test and apply never use unsaved inputs and applying requires a matching successful test', async t => {
  const f = await editor(t);
  f.state.draft.folder = '未保存'; await f.state.testConfiguration(); await f.state.apply();
  assert.equal(f.tests.length, 0); assert.equal(f.applications.length, 0);
  f.state.draft.folder = '招聘简历'; await f.state.apply(); assert.equal(f.applications.length, 0);
  await f.state.testConfiguration(); assert.deepEqual(f.tests[0], { id: 'recruitment-mail', body: { expectedRevision: 4 } });
  await f.state.apply(); assert.equal(f.applications.length, 1); assert.equal(f.state.config.value.appliedRevision, 4);
  assert.equal(f.writes.length, 0);
});

test('scope verification requires an explicit sample and sends it only to the test action', async t => {
  const f = await editor(t, { view: { testKind: 'scope', requiresSample: true } });
  await f.state.testConfiguration(); assert.equal(f.tests.length, 0); assert.match(f.state.errors.sampleInstanceId, /样本/);
  f.state.sampleInstanceId.value = 'fictional-instance'; await f.state.testConfiguration();
  assert.equal(f.tests[0].body.sampleInstanceId, 'fictional-instance'); assert.equal(f.applications.length, 0);
});

test('an untested first save with no recorded test kind can be checked but cannot be applied', async t => {
  const f = await editor(t, { view: { testKind: 'none', verification: 'untested' } });
  await f.state.apply(); assert.equal(f.applications.length, 0);
  await f.state.testConfiguration(); assert.equal(f.tests.length, 1);
});

test('a selected Shanghai local date is sent as an equivalent UTC ISO timestamp', async t => {
  const f = await editor(t, { view: { fields: [...saved().fields,
    { key: 'authorizedFrom', label: '允许读取起始时间', type: 'datetime', required: true, configured: false, value: '' }] } });
  f.state.draft.authorizedFrom = '2038-02-03T09:30:00+08:00'; await f.state.save();
  assert.equal(f.writes[0].body.values.authorizedFrom, '2038-02-03T01:30:00.000Z');
});

test('server field validation stays beside the matching field and retains the user input', async t => {
  const f = await editor(t, { save: async () => { throw { response: { status: 400, data: { data: { fieldErrors: {
    account: '请填写正确的邮箱账号', unexpected: 'must not show unknown fields',
  } } } } }; } });
  f.state.draft.account = 'invalid account'; await f.state.save();
  assert.equal(f.state.errors.account, '请填写正确的邮箱账号'); assert.equal(f.state.errors.unexpected, undefined);
  assert.equal(f.state.draft.account, 'invalid account');
});

test('mailbox provider is selected from server presets and an unknown provider stays beside the field', async t => {
  const f = await editor(t, { view: { fields: [...saved().fields, { key: 'RECRUITMENT_MAIL_PROVIDER', label: '邮箱服务商',
    type: 'select', required: true, configured: true, value: 'alimail', options: [{ value: 'alimail', label: '阿里企业邮箱' }, { value: 'qq', label: 'QQ 邮箱' }] }] } });
  f.state.draft.RECRUITMENT_MAIL_PROVIDER = 'unsupported'; await f.state.save();
  assert.equal(f.writes.length, 0); assert.match(f.state.errors.RECRUITMENT_MAIL_PROVIDER, /邮箱服务商/);
  f.state.draft.RECRUITMENT_MAIL_PROVIDER = 'qq'; await f.state.save();
  assert.equal(f.writes[0].body.values.RECRUITMENT_MAIL_PROVIDER, 'qq');
});

test('mailbox guidance follows the selected provider and leaves the folder editable until explicitly choosing INBOX', async t => {
  const fields = [
    { key: 'RECRUITMENT_MAIL_PROVIDER', label: '邮箱服务商', type: 'select', required: true, configured: true, value: 'qq', options: [{ value: 'qq', label: 'QQ' }, { value: 'netease163', label: '网易163' }] },
    { key: 'RECRUITMENT_MAIL_PASSWORD', label: '客户端授权码', type: 'secret', required: true, configured: true },
    { key: 'RECRUITMENT_MAIL_FOLDER', label: '指定文件夹', type: 'text', required: true, configured: true, value: '原获准目录' },
  ];
  const f = await editor(t, { view: { fields } });
  assert.match(f.state.fieldHelp(fields[1]), /QQ.*IMAP.*客户端授权码/);
  f.state.draft.RECRUITMENT_MAIL_PROVIDER = 'netease163';
  assert.match(f.state.fieldHelp(fields[1]), /163.*IMAP.*客户端授权码/);
  assert.match(f.state.fieldHelp(fields[2]), /INBOX/);
  assert.equal(f.state.draft.RECRUITMENT_MAIL_FOLDER, '原获准目录');
  f.state.useInbox(); assert.equal(f.state.draft.RECRUITMENT_MAIL_FOLDER, 'INBOX');
  assert.equal(f.state.draft.RECRUITMENT_MAIL_PROVIDER, 'netease163');
});

test('resume credential maintenance focuses on DeepSeek without loading the progress-bot trial list', async t => {
  let userReads = 0;
  const state = mount(t, 'views/system/AiServiceConfigView.vue', { vue,
    'vue-router': { useRoute: () => ({ query: { provider: 'deepseek', feature: 'resume' } }), onBeforeRouteUpdate() {} },
    '@/api/ai-progress.api': { aiProgressApi: { getConfig: async () => ({ encryptionReady: true, providers: [], allowlist: [] }) } },
    '@/api/users.api': { usersApi: { findAll: async () => { userReads++; return { items: [] }; } } },
  });
  await flush(); assert.equal(state.isResume.value, true); assert.equal(state.selected.value, 'deepseek');
  assert.equal(userReads, 0);
});

test('returning to resume within the same AI view selects DeepSeek and retains other provider drafts', async t => {
  const route = vue.reactive({ query: { provider: 'deepseek', feature: 'resume' } }), guards = [];
  const state = mount(t, 'views/system/AiServiceConfigView.vue', { vue,
    'vue-router': { useRoute: () => route, onBeforeRouteUpdate: guard => guards.push(guard) },
    '@/api/ai-progress.api': { aiProgressApi: { getConfig: async () => ({ encryptionReady: true, providers: [], allowlist: [] }) } },
    '@/api/users.api': { usersApi: { findAll: async () => ({ items: [] }) } },
  });
  await flush(); route.query = {}; await flush(); state.selected.value = 'kimi';
  state.drafts.kimi.apiKey = 'fictional-unsaved-kimi';
  route.query = { provider: 'deepseek', feature: 'resume' }; await flush();
  assert.equal(state.selected.value, 'deepseek'); assert.equal(state.drafts.kimi.apiKey, 'fictional-unsaved-kimi');
  state.busy.value = 'save'; assert.equal(await guards[0](), false);
});

test('mailbox collection creates a distinct editable draft without testing or applying it', async t => {
  const requests = [], route = { params: { setting: 'recruitment-mail' }, query: {} }, destinations = [];
  const state = mount(t, 'views/system/RecruitmentMailboxesPanel.vue', { vue,
    'vue-router': { useRouter: () => ({ push: async to => destinations.push(to) }), useRoute: () => route },
    '@/api/system-configuration.api': { systemConfigurationApi: {
      mailboxes: async () => [saved()], createMailbox: async () => { requests.push('create'); return saved({ id: 'recruitment-mail:fictional-new' }); },
    } },
    '@/api/recruitment-intakes.api': { recruitmentIntakesApi: { mailboxes: async () => [] } },
    '@/components/common/business-list/BusinessListPage.vue': {}, '@/components/common/MobileResultCard.vue': {},
  });
  await flush(); assert.equal(state.rows.value.length, 1);
  await state.createMailbox();
  assert.deepEqual(requests, ['create']);
  assert.ok(JSON.stringify(destinations[0]).includes('recruitment-mail:fictional-new'));
});
