const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const filename = path.join(root, 'views/talent/TalentHiringReviewView.vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });

async function review(t, fields) {
  const requests = [], writes = [];
  const row = { id: 'fictional-application', candidateName: 'Fictional candidate', positionName: 'Fictional job',
    revision: 4, stage: 'hiring_review', allowedActions: ['approve_hiring', 'return_hiring'], hiringReason: 'Fictional submitted opinion', events: [], ...fields };
  const dependencies = {
    'vue-router': { useRoute: () => ({ query: { applicationId: row.id } }) },
    './useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
    '@/api/talent-recruitment.api': { recruitmentError: error => error.message, talentRecruitmentApi: {
      hiringReviews: async () => { requests.push('hiringReviews'); return [row]; },
      detail: async id => { requests.push(`detail:${id}`); return row; },
      action: async (id, body) => { writes.push({ id, ...body }); return { ...row, allowedActions: [], stage: 'offered' }; },
    } },
  };
  function load(file, source = fs.readFileSync(file, 'utf8')) {
    const loaded = new Module(file, module); loaded.paths = module.paths;
    loaded.require = id => {
      if (id in dependencies) return dependencies[id];
      if (id.startsWith('@/api/')) throw new Error(`Narrow hiring review must not fetch additional API modules: ${id}`);
      if (id.endsWith('.vue')) return { name: path.basename(id, '.vue') };
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      return require(id);
    };
    loaded._compile(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, file);
    return loaded.exports;
  }
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const component = load(filename, script.content).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush();
  function summaryNodes() {
    const template = compileTemplate({ source: descriptor.template.content, filename, id: filename,
      compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    const rendered = new Module(filename, module);
    rendered.require = () => ({ ...vue, resolveComponent: name => ({ name }), resolveDirective: () => ({}), withDirectives: node => node });
    rendered._compile(ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
    const setup = vue.proxyRefs(state), tree = rendered.exports.render(setup, [], {}, setup, {}, {});
    function walk(node) {
      if (Array.isArray(node)) return node.flatMap(walk);
      if (!node || typeof node !== 'object') return [];
      const children = node.children?.default ? node.children.default() : node.children;
      return [node, ...(typeof children === 'string' ? [] : walk(children))];
    }
    return walk(tree).filter(node => node.type?.name === 'RecruitmentDemandSummary');
  }
  return { state, requests, writes, row, summaryNodes };
}

const snapshot = { demandId: 'fictional-demand', revision: 2, instanceId: 'FIC-001', departmentId: 'fictional-department',
  departmentName: 'Frozen department', positionId: 'fictional-position', positionName: 'Frozen job', approvedHeadcount: 2,
  approvedAt: '2037-01-01T00:00:00Z', sourceLink: null, syncedAt: '2037-01-02T00:00:00Z' };

test('independent hiring review displays the exact frozen snapshot alongside safe current detail fields without catalog requests', async t => {
  const currentDemand = { id: 'fictional-demand', revision: 5, sourceState: 'withdrawn', usable: false,
    departmentName: 'Current department', positionName: 'Current job', approvedHeadcount: 3, acceptedCount: 1, hiredCount: 1, remainingCount: 1 };
  const view = await review(t, { recruitmentDemandSnapshot: snapshot, recruitmentDemandCurrent: currentDemand });
  const nodes = view.summaryNodes(); assert.equal(nodes.length, 1);
  assert.equal(nodes[0].props.snapshot, view.state.current.value.recruitmentDemandSnapshot);
  assert.equal(nodes[0].props.current, view.state.current.value.recruitmentDemandCurrent);
  assert.equal(nodes[0].props.snapshot.revision, 2); assert.equal(nodes[0].props.current.revision, 5);
  assert.deepEqual(view.requests, ['hiringReviews', 'detail:fictional-application']);
  await view.state.begin('approve_hiring'); await view.state.execute();
  assert.deepEqual(view.writes, [{ id: 'fictional-application', expectedRevision: 4, action: 'approve_hiring', note: undefined }]);
  assert.equal(snapshot.approvedHeadcount, 2);
});

test('unavailable current demand stays null in the reused summary, without requesting a broader data source', async t => {
  const view = await review(t, { recruitmentDemandSnapshot: snapshot, recruitmentDemandCurrent: null });
  const nodes = view.summaryNodes(); assert.equal(nodes.length, 1); assert.equal(nodes[0].props.current, null);
  assert.deepEqual(view.requests, ['hiringReviews', 'detail:fictional-application']);
});

for (const action of ['approve_hiring', 'return_hiring']) {
  test(`legacy null demand snapshot retains the existing ${action} path without a new selection gate`, async t => {
    const view = await review(t, { recruitmentDemandSnapshot: null, recruitmentDemandCurrent: null });
    assert.deepEqual(view.summaryNodes(), []);
    await view.state.begin(action); view.state.note.value = 'Fictional review opinion'; await view.state.execute();
    assert.deepEqual(view.writes, [{ id: 'fictional-application', expectedRevision: 4, action, note: 'Fictional review opinion' }]);
    assert.deepEqual(view.requests, ['hiringReviews', 'detail:fictional-application']);
  });
}
