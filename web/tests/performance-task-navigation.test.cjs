const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const filename = path.resolve(__dirname, '../src/components/performance/PerformanceTaskNavigation.vue');

function setup(input = {}) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(ts.transpileModule(compileScript(descriptor, { id: filename }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  const props = vue.reactive({ active: 'tasks', canMonitor: false, canSeeChanges: false,
    reviewTotal: undefined, reviewError: false, ...input });
  return { props, state: loaded.exports.default.setup(props, { expose() {} }) };
}

test('fixed task entries keep the legacy URLs and explicit capability visibility', () => {
  const view = setup();
  assert.deepEqual(view.state.entries.value.map(item => [item.key, item.label, item.to]), [
    ['mine', '我的目标', '/tasks?goalView=mine'], ['review', '目标审核', '/tasks?goalView=review'], ['tasks', '绩效待办', '/tasks'],
  ]);
  view.props.canMonitor = true; view.props.canSeeChanges = true;
  assert.deepEqual(view.state.entries.value.map(item => item.key), ['mine', 'review', 'monitor', 'tasks', 'changes']);
  view.props.canMonitor = false; view.props.canSeeChanges = false;
  assert.deepEqual(view.state.entries.value.map(item => item.key), ['mine', 'review', 'tasks']);
  view.props.active = 'changes';
  assert.deepEqual(view.state.entries.value.map(item => item.key), ['mine', 'review', 'tasks', 'changes']);
});

test('review badge distinguishes unknown and failed counts without changing the entry label', () => {
  const view = setup(); assert.equal(view.state.reviewBadge.value, null);
  view.props.reviewTotal = null; assert.equal(view.state.reviewBadge.value.text, '...');
  assert.match(view.state.reviewBadge.value.title, /待更新/);
  view.props.reviewError = true; assert.equal(view.state.reviewBadge.value.text, '!');
  assert.match(view.state.reviewBadge.value.title, /暂不可用/);
  view.props.reviewError = false; view.props.reviewTotal = 0; assert.equal(view.state.reviewBadge.value, null);
  view.props.reviewTotal = 132; assert.equal(view.state.reviewBadge.value.text, '99+');
  assert.match(view.state.reviewBadge.value.title, /132/);
  assert.equal(view.state.entries.value.find(item => item.key === 'review').label, '目标审核');
});

test('original third-level performance menu is not renamed or reordered', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/performance/PerformanceWorkspace.vue'), 'utf8');
  const section = source.slice(source.indexOf('const allSections'), source.indexOf('const visibleSections'));
  assert.deepEqual([...section.matchAll(/label: '([^']+)'/g)].map(match => match[1]), ['目标跟进', '目标地图', '绩效待办', '目标变更']);
  assert.match(section, /key: 'tasks', label: '绩效待办', to: '\/tasks'/);
});
