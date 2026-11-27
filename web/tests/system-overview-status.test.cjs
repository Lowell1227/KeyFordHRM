const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const productVersion = readJson('web/package.json').version;

test('product version agrees across API, Web, lockfiles, README and agent guidance', () => {
  for (const directory of ['api', 'web']) {
    assert.equal(readJson(`${directory}/package.json`).version, productVersion);
    const lock = readJson(`${directory}/package-lock.json`);
    assert.equal(lock.version, productVersion);
    assert.equal(lock.packages[''].version, productVersion);
  }
  assert.ok(fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes(`当前产品版本：**${productVersion}**`));
  assert.ok(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes(`当前源码版本为 \`${productVersion}\`，包版本为 \`${productVersion}\``));
});

const filename = path.resolve(__dirname, '../src/views/system/SystemOverviewView.vue');
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
const script = compileScript(descriptor, { id: 'system-overview-test', genDefaultAs: 'Overview' });
const template = compileTemplate({
  source: descriptor.template.content, filename, id: 'system-overview-test',
  compilerOptions: { bindingMetadata: script.bindings },
});
assert.deepEqual(template.errors, []);
const compiled = ts.transpileModule(`${script.content}\n${template.code}\nOverview.render = render;\nexport default Overview;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function node(type, text = '') { return { type, text, props: {}, children: [], parent: null }; }
const renderer = vue.createRenderer({
  createElement: type => node(type), createText: text => node('#text', text), createComment: () => node('#comment'),
  insert(child, parent, anchor = null) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
    child.parent = parent;
  },
  remove(child) {
    child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = null;
  },
  setText: (child, text) => { child.text = text; },
  setElementText: (child, text) => { child.text = text; child.children = []; },
  patchProp: (child, key, previous, value) => { child.props[key] = value; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
function textContent(child) { return child.text + child.children.map(textContent).join(''); }
function findAll(child, predicate) {
  return [...(predicate(child) ? [child] : []), ...child.children.flatMap(item => findAll(item, predicate))];
}
function mount(t, read) {
  const calls = [];
  const api = new Proxy({}, { get(target, key) {
    assert.equal(key, 'getDingtalkNotificationSettings', 'overview may only read the existing settings GET');
    return (...args) => { calls.push(args); assert.deepEqual(args, []); return read(); };
  } });
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => id === '@/api/cycles.api' ? { cyclesApi: api }
    : id === './ConfigurationStatusPanel.vue' ? { render: () => null } : originalRequire(id);
  loaded._compile(compiled, filename);
  const component = loaded.exports.default;
  const setup = component.setup;
  let state;
  component.setup = (props, context) => { state = setup(props, context); return state; };
  const app = renderer.createApp(component);
  const root = node('root');
  let mounted = true;
  app.mount(root);
  function unmount() { if (mounted) { app.unmount(); mounted = false; } }
  t.after(unmount);
  return {
    state, calls, unmount,
    text: () => textContent(root),
    runtime: () => findAll(root, item => item.props['data-testid'] === 'dingtalk-notification-runtime')[0],
    retry: () => findAll(root, item => item.type === 'button' && item.props['aria-label'] === '重新读取钉钉通知状态')[0],
    rows: () => findAll(root, item => item.props['data-testid'] === 'system-capability-status'),
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const enabled = { available: true, enabled: true, effectiveEnabled: true };
const disabled = { available: true, enabled: false, effectiveEnabled: false };
function runtimeText(view) {
  assert.ok(view.runtime(), 'work notifications must expose a distinct runtime status');
  return textContent(view.runtime()).trim();
}

test('mount reads once and shows reading, never a guessed switch state', async t => {
  const pending = deferred();
  const view = mount(t, () => pending.promise);
  assert.equal(view.calls.length, 1);
  assert.equal(runtimeText(view), '读取中');
  assert.equal(view.retry().props.disabled, true);
  assert.ok(view.text().includes(productVersion));
  pending.resolve(enabled);
  await flush();
});

for (const [name, settings, expected] of [
  ['effective switch on', enabled, '已启用'],
  ['platform available but business switch off', disabled, '业务开关已关闭'],
  ['platform unavailable with business switch on', { available: false, enabled: true, effectiveEnabled: false }, '平台不可用或未启用'],
  ['platform unavailable with business switch off', { available: false, enabled: false, effectiveEnabled: false }, '平台不可用或未启用'],
]) {
  test(`runtime distinguishes ${name}`, async t => {
    const view = mount(t, async () => settings);
    await flush();
    assert.equal(runtimeText(view), expected);
    assert.equal(view.retry().props.disabled, false);
    if (!settings.available) assert.match(view.text(), /部署开关.*凭据/);
  });
}

test('malformed and contradictory settings are read failures, not disabled or pending', async t => {
  const malformed = [null, undefined, {}, [], true, 'enabled',
    { enabled: true, effectiveEnabled: true }, { available: true, effectiveEnabled: true },
    { available: true, enabled: true },
    { ...enabled, available: 'true' }, { ...enabled, enabled: 1 }, { ...enabled, effectiveEnabled: null },
    { ...enabled, effectiveEnabled: false }, { ...disabled, effectiveEnabled: true },
    { available: false, enabled: true, effectiveEnabled: true },
  ];
  for (const [index, settings] of malformed.entries()) {
    await t.test(`invalid payload ${index + 1}`, async t => {
      const view = mount(t, async () => settings);
      await flush();
      assert.equal(runtimeText(view), '读取失败');
      assert.equal(view.retry().props.disabled, false);
    });
  }
});

test('failed GET stays unknown and icon retry reads again without any writes', async t => {
  const pending = deferred();
  let attempts = 0;
  const view = mount(t, () => {
    if (++attempts === 1) throw new Error('private diagnostic must not be displayed');
    return pending.promise;
  });
  await flush();
  assert.equal(runtimeText(view), '读取失败');
  assert.doesNotMatch(view.text(), /private diagnostic/);
  assert.equal(view.retry().props.type, 'button');
  assert.ok(view.retry().children.length, 'retry must contain an icon');
  const retry = view.retry().props.onClick();
  await vue.nextTick();
  assert.equal(runtimeText(view), '读取中');
  assert.equal(view.calls.length, 2);
  pending.resolve(enabled);
  await retry;
  await flush();
  assert.equal(runtimeText(view), '已启用');
});

test('a rejected retry clears the previous enabled status and can recover', async t => {
  const pending = deferred();
  let attempts = 0;
  const view = mount(t, () => ++attempts === 2 ? pending.promise : Promise.resolve(enabled));
  await flush();
  assert.equal(runtimeText(view), '已启用');
  const retry = view.retry().props.onClick();
  await vue.nextTick();
  assert.equal(runtimeText(view), '读取中');
  pending.reject(new Error('network unavailable'));
  await retry;
  await flush();
  assert.equal(runtimeText(view), '读取失败');
  await view.retry().props.onClick();
  await flush();
  assert.equal(runtimeText(view), '已启用');
});

for (const outcome of ['resolve', 'reject']) {
  test(`late ${outcome} cannot stop a newer read or replace its result`, async t => {
    const old = deferred(), latest = deferred();
    let attempts = 0;
    const view = mount(t, () => ++attempts === 1 ? old.promise : latest.promise);
    const retry = view.state.loadNotificationSettings();
    old[outcome](outcome === 'resolve' ? disabled : new Error('obsolete'));
    await flush();
    assert.equal(runtimeText(view), '读取中');
    assert.equal(view.retry().props.disabled, true);
    latest.resolve(enabled);
    await retry;
    await flush();
    assert.equal(runtimeText(view), '已启用');
  });

  test(`old ${outcome} after retry succeeds cannot replace the latest status`, async t => {
    const old = deferred();
    let attempts = 0;
    const view = mount(t, () => ++attempts === 1 ? old.promise : Promise.resolve(enabled));
    await view.state.loadNotificationSettings();
    old[outcome](outcome === 'resolve' ? disabled : new Error('obsolete'));
    await flush();
    assert.equal(runtimeText(view), '已启用');
  });

  test(`unmount invalidates pending ${outcome} and prevents subsequent reads`, async t => {
    const pending = deferred();
    const view = mount(t, () => pending.promise);
    const before = view.state.notificationRuntime.value;
    view.unmount();
    pending[outcome](outcome === 'resolve' ? enabled : new Error('after unmount'));
    await flush();
    assert.deepEqual(view.state.notificationRuntime.value, before);
    await view.state.loadNotificationSettings();
    assert.equal(view.calls.length, 1);
  });
}

test('capability copy separates implementation, runtime, personnel and paused recruitment scope', async t => {
  const view = mount(t, async () => enabled);
  await flush();
  function row(name) {
    const result = view.rows().find(item => textContent(item.children[0]) === name);
    assert.ok(result, `missing capability: ${name}`);
    return textContent(result);
  }
  assert.match(row('人事基础资料'), /部分可用/);
  assert.match(row('站内通知'), /已实现/);
  assert.match(row('钉钉工作通知'), /已实现.*已启用/);
  assert.match(row('钉钉待办'), /未接入/);
  const calendar = row('钉钉面试日程');
  assert.match(calendar, /已实现/);
  assert.match(calendar, /配置/);
  assert.match(calendar, /运行状态未提供/);
  assert.doesNotMatch(calendar, /已启用|未启用|已关闭|已禁用/);
  const recruitment = row('人才库与招聘流转');
  assert.match(recruitment, /可用/);
  assert.match(recruitment, /面试.*录用确认.*入职衔接/);
  assert.doesNotMatch(recruitment, /日程未启用/);
  assert.match(row('招聘编制、职位发布与 Offer'), /已暂缓.*编制.*职位发布.*Offer.*薪资审批/);
  assert.doesNotMatch(view.text(), /钉钉待办与消息|全局字典与基础配置/);
});

test('payroll capability distinguishes implemented preview from unopened formal operations', async t => {
  const view = mount(t, async () => disabled);
  await flush();
  const salary = view.rows().find(item => textContent(item.children[0]) === '薪酬核算与独立权限');
  assert.ok(salary, 'the implemented payroll domain must not be described as paused HR role planning');
  assert.match(textContent(salary), /隔离预览/);
  assert.match(textContent(salary), /正式.*未启用/);
  assert.match(textContent(salary), /主体.*独立授权/);
});
