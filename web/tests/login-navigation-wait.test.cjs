const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vue = require('vue');
const vueRouter = require('vue-router');
const pinia = require('pinia');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { renderToString } = require('@vue/server-renderer');

const root = path.resolve(__dirname, '../src');
const filename = path.join(root, 'views/auth/LoginView.vue');
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'login-navigation-wait' }).content;
const template = compileTemplate({ source: descriptor.template.content, filename, id: 'login-navigation-wait',
  compilerOptions: { mode: 'function' } });
assert.deepEqual(template.errors, []);
const render = new Function('Vue', template.code)(vue);
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred(t) {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Keep the red run's dropped router promise from becoming an unhandled rejection.
  promise.catch(() => {});
  t.after(() => resolve());
  return { promise, resolve, reject };
}

function login(t, options = {}) {
  const posts = [], targets = [], messages = [], sdkRequests = [];
  const storage = new Map();
  const localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const browser = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    location: { origin: 'http://localhost', href: '' } };
  const navigator = { userAgent: options.dingtalk ? 'DingTalk' : 'Node login test' };
  const env = { VITE_DINGTALK_CORP_ID: 'fictional-corp' };
  function load(file, dependencies, source = fs.readFileSync(file, 'utf8')) {
    const compiled = ts.transpileModule(source.replaceAll('import.meta.env', JSON.stringify(env)), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    const localRequire = id => id in dependencies ? dependencies[id] : require(id);
    new Function('require', 'module', 'exports', 'window', 'navigator', 'document', 'localStorage', compiled)(
      localRequire, module, module.exports, browser, navigator, { hidden: false }, localStorage);
    return module.exports;
  }
  const response = { token: 'fictional-session', user: { id: 'fictional-user' }, expiresIn: 3600,
    passwordChangeRequired: options.changePassword ?? false };
  const account = { employeeNo: 'HR001', name: 'Fictional HR', sysRole: 'hr', roleLabel: 'HR' };
  const { authApi } = load(path.join(root, 'api/auth.api.ts'), { './http': { default: {
    post: (url, body) => { posts.push({ url, body }); return options.authenticate?.() ?? Promise.resolve(response); },
    get: async () => ({ enabled: true, accounts: [account] }),
  } } });
  const { useAuthStore } = load(path.join(root, 'stores/auth.store.ts'), {
    pinia, '@/api/auth.api': { authApi }, '@/api/payroll.api': { payrollApi: {} },
    '@/stores/notification.store': { useNotificationStore: () => ({ setSession() {} }) },
  });
  const auth = useAuthStore(pinia.createPinia());
  let cleared = 0, sdkLoads = 0;
  const sdk = { requestAuthCode: request => { sdkRequests.push(request); } };
  const component = load(filename, {
    vue, 'vue-router': { ...vueRouter, useRoute: () => ({ query: options.redirect ? { redirect: options.redirect } : {} }),
      useRouter: () => ({ replace: target => { targets.push(target); return options.navigate?.() ?? Promise.resolve(); } }) },
    'element-plus': { ElMessage: { error: message => messages.push(message) } },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/utils/dingtalk-jsapi': { loadDingTalkJsApi: () => { sdkLoads++; return options.loadSdk?.() ?? Promise.resolve(sdk); } },
    '@/utils/dingtalk-login-error': load(path.join(root, 'utils/dingtalk-login-error.ts'), {}),
    '@/utils/dingtalk-oauth': { clearArchiveOAuthReturn: () => { cleared++; },
      rememberArchiveOAuthReturn() {}, buildDingTalkOAuthUrl: () => 'https://example.invalid/oauth' },
    '@/api/auth.api': { authApi }, '@/utils/preview-mode': { isLocalPreview: options.preview ?? false },
  }, script).default;
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup({}, { expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => app.unmount());
  state.showPasswordForm.value = true;
  state.form.employeeNo = 'fictional-employee';
  state.form.password = 'fictional-password';
  async function html() {
    const output = vue.createSSRApp({ setup: () => () => render(vue.proxyRefs(state), []) });
    const container = { setup: (_, { slots }) => () => vue.h('div', slots.default?.()) };
    for (const name of ['el-form', 'el-select', 'el-option', 'el-input']) output.component(name, container);
    output.component('el-form-item', { props: ['error'], setup: (props, { slots }) => () => vue.h('div', [
      slots.default?.(), props.error ? vue.h('span', { role: 'alert' }, props.error) : null,
    ]) });
    output.component('el-button', { props: ['loading'], setup: (props, { slots }) => () => vue.h('button', {
      'data-loading': String(props.loading),
    }, slots.default?.()) });
    return renderToString(output);
  }
  return { state, posts, targets, messages, sdkRequests, sdk, response, html, auth,
    get cleared() { return cleared; }, get sdkLoads() { return sdkLoads; } };
}

test('redirect helper returns a promise that stays pending until router.replace completes', async t => {
  const navigation = deferred(t), view = login(t, { navigate: () => navigation.promise });
  const redirect = view.state.redirectAfterLogin();
  assert.equal(typeof redirect?.then, 'function');
  let completed = false;
  redirect.then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  navigation.resolve(); await redirect;
  assert.equal(completed, true);
  assert.deepEqual(view.targets, ['/dashboard']);
  assert.equal(view.cleared, 1);
});

test('password loading and the button stay busy after auth succeeds until navigation finishes', async t => {
  const authentication = deferred(t), navigation = deferred(t);
  const view = login(t, { authenticate: () => authentication.promise, navigate: () => navigation.promise });
  const pending = view.state.onPasswordLogin();
  assert.equal(view.state.loading.value, true);
  authentication.resolve(view.response); await flush();
  assert.equal(view.auth.isLoggedIn, true);
  assert.deepEqual(view.targets, ['/dashboard']);
  assert.equal(view.state.loading.value, true);
  assert.match(await view.html(), /data-testid="login-submit"[^>]*data-loading="true"|data-loading="true"[^>]*data-testid="login-submit"/);
  navigation.resolve(); await pending;
  assert.equal(view.state.loading.value, false);
});

for (const phase of ['authentication', 'navigation']) test(`duplicate password submits during ${phase} never send a second POST`, async t => {
  const authentication = deferred(t), navigation = deferred(t);
  const view = login(t, { authenticate: () => authentication.promise, navigate: () => navigation.promise });
  const first = view.state.onPasswordLogin();
  if (phase === 'navigation') { authentication.resolve(view.response); await flush(); }
  const second = view.state.onPasswordLogin();
  assert.equal(view.posts.length, 1);
  assert.equal(view.posts[0].url, '/auth/login');
  authentication.resolve(view.response); navigation.resolve();
  await first; await second;
});

test('password success preserves the requested redirect without a second authentication POST', async t => {
  const view = login(t, { redirect: '/tasks/fictional-task?tab=goals' });
  await view.state.onPasswordLogin();
  assert.deepEqual(view.targets, ['/tasks/fictional-task?tab=goals']);
  assert.equal(view.posts.length, 1);
  assert.equal(view.state.loading.value, false);
});

test('mandatory password change keeps its named route and waits for navigation', async t => {
  const navigation = deferred(t), view = login(t, { changePassword: true,
    redirect: '/tasks/fictional-task', navigate: () => navigation.promise });
  const pending = view.state.onPasswordLogin(); await flush();
  assert.deepEqual(view.targets, [{ name: 'ChangePassword' }]);
  assert.equal(view.state.loading.value, true);
  assert.equal(view.cleared, 1);
  navigation.resolve(); await pending;
  assert.equal(view.state.loading.value, false);
});

for (const changePassword of [false, true]) test(`navigation rejection after password auth shows a retry error, not a credential error (change=${changePassword})`, async t => {
  const navigation = deferred(t), view = login(t, { changePassword, navigate: () => navigation.promise });
  const pending = view.state.onPasswordLogin(); await flush();
  navigation.reject(Object.assign(new Error('route failed'), { response: { status: 401 } }));
  await pending; await flush();
  assert.equal(view.state.loading.value, false);
  assert.match(view.state.formErrors.password, /登录.*成功.*页面.*失败.*重试/);
  assert.doesNotMatch(view.state.formErrors.password, /工号或密码错误/);
  assert.match(await view.html(), /role="alert"[^>]*>[^<]*页面[^<]*重试/);
  assert.equal(view.posts.length, 1, 'a navigation error must not automatically retry the password');
});

test('password 401 still appears beside the password field and can be retried explicitly', async t => {
  let rejected = true;
  const view = login(t, { authenticate: () => rejected
    ? Promise.reject({ response: { status: 401 } }) : Promise.resolve(view.response) });
  await view.state.onPasswordLogin();
  assert.equal(view.state.loading.value, false);
  assert.equal(view.state.formErrors.password, '工号或密码错误');
  assert.match(await view.html(), /role="alert">工号或密码错误/);
  assert.deepEqual(view.targets, []);
  rejected = false; await view.state.onPasswordLogin();
  assert.equal(view.state.formErrors.password, '');
  assert.deepEqual(view.targets, ['/dashboard']);
  assert.equal(view.posts.length, 2);
});

test('empty password fields keep local validation and do not authenticate', async t => {
  const view = login(t);
  view.state.form.employeeNo = ''; view.state.form.password = '';
  await view.state.onPasswordLogin();
  assert.equal(view.state.formErrors.employeeNo, '请输入工号');
  assert.equal(view.state.formErrors.password, '请输入密码');
  assert.equal(view.posts.length, 0);
});

test('preview login waits for navigation and blocks repeat or cross-entry submissions', async t => {
  const navigation = deferred(t), view = login(t, { preview: true,
    redirect: '/payroll/batches', navigate: () => navigation.promise });
  await flush();
  const pending = view.state.onPreviewLogin(); await flush();
  assert.equal(view.state.loading.value, true);
  await view.state.onPreviewLogin(); await view.state.onPasswordLogin();
  assert.equal(view.posts.length, 1);
  assert.equal(view.posts[0].url, '/auth/test-login');
  assert.deepEqual(view.targets, ['/payroll/batches']);
  navigation.resolve(); await pending;
  assert.equal(view.state.loading.value, false);
});

test('preview router rejection reaches the existing visible error and releases loading', async t => {
  const navigation = deferred(t), view = login(t, { preview: true, navigate: () => navigation.promise });
  await flush();
  const pending = view.state.onPreviewLogin(); await flush();
  navigation.reject(new Error('route failed')); await pending; await flush();
  assert.equal(view.state.loading.value, false);
  assert.match(view.state.previewError.value, /页面.*失败.*重试/);
  assert.match(await view.html(), /role="alert"[^>]*>[^<]*页面[^<]*重试/);
  assert.equal(view.posts.length, 1);
});

test('DingTalk SDK loading already holds the shared busy guard against double clicks', async t => {
  const sdkLoading = deferred(t), view = login(t, { dingtalk: true, loadSdk: () => sdkLoading.promise });
  const pending = view.state.onDingTalkLogin();
  const busyWhileLoading = view.state.loading.value;
  const second = view.state.onDingTalkLogin();
  sdkLoading.resolve(view.sdk); await pending; await second;
  assert.equal(busyWhileLoading, true);
  assert.equal(view.sdkLoads, 1);
  assert.equal(view.sdkRequests.length, 1);
});

test('DingTalk auth and navigation keep loading, ignore duplicate callbacks and preserve redirect', async t => {
  const authentication = deferred(t), navigation = deferred(t);
  const view = login(t, { dingtalk: true, redirect: '/dashboard?tab=team',
    authenticate: () => authentication.promise, navigate: () => navigation.promise });
  await view.state.onDingTalkLogin();
  const request = view.sdkRequests[0];
  const pending = request.onSuccess({ code: 'fictional-auth-code' });
  await request.onSuccess({ code: 'duplicate-code' });
  authentication.resolve(view.response); await flush();
  assert.equal(view.state.loading.value, true);
  await view.state.onDingTalkLogin(); await view.state.onPasswordLogin();
  assert.equal(view.posts.length, 1);
  assert.equal(view.posts[0].url, '/auth/dingtalk');
  assert.deepEqual(view.posts[0].body, { authCode: 'fictional-auth-code', loginMode: 'internal' });
  assert.deepEqual(view.targets, ['/dashboard?tab=team']);
  navigation.resolve(); await pending;
  assert.equal(view.state.loading.value, false);
});

test('DingTalk router rejection reaches the existing message catch and releases loading', async t => {
  const navigation = deferred(t), view = login(t, { dingtalk: true, navigate: () => navigation.promise });
  await view.state.onDingTalkLogin();
  const pending = view.sdkRequests[0].onSuccess({ code: 'fictional-auth-code' }); await flush();
  navigation.reject(new Error('route failed')); await pending; await flush();
  assert.equal(view.state.loading.value, false);
  assert.match(view.messages[0] ?? '', /页面.*失败.*重试/);
  assert.equal(view.posts.length, 1);
});

test('DingTalk SDK rejection restores the guard without sending an authentication request', async t => {
  const view = login(t, { dingtalk: true, loadSdk: () => Promise.reject(new Error('SDK unavailable')) });
  await view.state.onDingTalkLogin();
  assert.equal(view.state.loading.value, false);
  assert.match(view.messages[0], /JSAPI 未加载/);
  assert.equal(view.posts.length, 0);
});

async function navigationFailure(t, kind) {
  const router = vueRouter.createRouter({ history: vueRouter.createMemoryHistory(),
    routes: ['/', '/held', '/other'].map(path => ({ path, component: {} })) });
  await router.replace('/');
  let failure;
  if (kind === 'aborted') {
    router.beforeEach(() => false);
    failure = await router.replace('/held');
  } else {
    const entered = deferred(t), release = deferred(t);
    router.beforeEach(to => {
      if (to.path === '/held') { entered.resolve(); return release.promise; }
    });
    const pending = router.replace('/held');
    await entered.promise;
    await router.replace('/other');
    release.resolve(true);
    failure = await pending;
  }
  assert.equal(vueRouter.isNavigationFailure(failure, vueRouter.NavigationFailureType[kind]), true);
  return failure;
}

for (const kind of ['aborted', 'cancelled']) for (const entry of ['password', 'changePassword', 'preview', 'dingtalk']) {
  test(`${entry} treats a fulfilled ${kind} navigation failure as a visible retry error`, async t => {
    const failure = await navigationFailure(t, kind), navigation = deferred(t);
    const view = login(t, { changePassword: entry === 'changePassword', preview: entry === 'preview',
      dingtalk: entry === 'dingtalk', navigate: () => navigation.promise });
    await flush();
    let pending;
    if (entry === 'dingtalk') {
      await view.state.onDingTalkLogin();
      pending = view.sdkRequests[0].onSuccess({ code: 'fictional-auth-code' });
    } else pending = entry === 'preview' ? view.state.onPreviewLogin() : view.state.onPasswordLogin();
    await flush();
    assert.equal(view.state.loading.value, true);
    navigation.resolve(failure); await pending;
    assert.equal(view.state.loading.value, false);
    const message = entry === 'dingtalk' ? view.messages[0]
      : entry === 'preview' ? view.state.previewError.value : view.state.formErrors.password;
    assert.match(message ?? '', /登录.*成功.*页面.*失败.*重试/);
    assert.equal(view.posts.length, 1);
    if (entry === 'changePassword') assert.deepEqual(view.targets, [{ name: 'ChangePassword' }]);
  });
}

for (const kind of ['network', '503']) test(`password ${kind} failure stays visible beside the field without leaking the raw error`, async t => {
  const error = new Error('raw-error-must-not-be-displayed');
  if (kind === '503') error.response = { status: 503, data: { message: error.message } };
  let rejected = true;
  const view = login(t, { authenticate: () => rejected ? Promise.reject(error) : Promise.resolve(view.response) });
  await view.state.onPasswordLogin();
  assert.equal(view.state.loading.value, false);
  assert.match(view.state.formErrors.password, /登录.*失败.*重试/);
  assert.match(await view.html(), /role="alert"[^>]*>[^<]*重试/);
  assert.doesNotMatch(await view.html(), /raw-error-must-not-be-displayed|工号或密码错误/);
  assert.equal(view.posts.length, 1);
  assert.deepEqual(view.targets, []);
  rejected = false; await view.state.onPasswordLogin();
  assert.equal(view.state.formErrors.password, '');
  assert.equal(view.posts.length, 2);
  assert.deepEqual(view.targets, ['/dashboard']);
});
