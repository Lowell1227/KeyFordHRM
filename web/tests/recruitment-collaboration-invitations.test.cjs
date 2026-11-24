const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });

function mount(t, relative, { query = {}, canRead = true, canEdit = false, user, props = {}, poolApi = {}, recruitmentApi = {}, interviewsApi = {}, confirm = async () => { throw new Error('dismissed'); } } = {}) {
  const route = vue.reactive({ query, params: {} }), requests = [], navigations = [], guards = [];
  const permissions = { canRead: vue.ref(canRead), canEdit: vue.ref(canEdit), canDelete: vue.ref(canEdit), canShare: vue.ref(canEdit), canOnboard: vue.ref(canEdit), canExport: vue.ref(canEdit) };
  const auth = vue.reactive({ user: user ?? { id: 'synthetic-actor', sysRole: 'employee' } });
  const navigate = async target => { navigations.push(target); if (target.query) route.query = target.query; };
  const dependencies = {
    'element-plus': { ElMessage: { success() {}, error() {}, info() {} }, ElMessageBox: { confirm } },
    'vue-router': { useRoute: () => route, useRouter: () => ({ push: navigate, replace: navigate }), onBeforeRouteUpdate: guard => guards.push(guard), onBeforeRouteLeave: guard => guards.push(guard) },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/talent-pool.api': { talentInterviewsApi: { list: async () => [], participants: async () => ({ items: [], total: 0 }), queue: async query => { requests.push({ work: 'interviews', ...query }); return { items: [], total: 0 }; }, ...interviewsApi }, talentPoolApi: { list: async () => ({ items: [], total: 0 }), applicationPositions: async () => [], ...poolApi } },
    '@/api/departments.api': { departmentsApi: {} },
    '@/router/navigation': { canAccessRoute: () => false },
    '@/api/users.api': { usersApi: { findOne: async () => null, findAll: async () => ({ items: [], total: 0 }) } },
    '@/api/talent-recruitment.api': { recruitmentError: e => e.message, talentRecruitmentApi: { applications: async () => [], queue: async query => { requests.push({ work: 'applications', ...query }); return { items: [], total: 0 }; }, workbench: async () => ({ groups: [] }), ...recruitmentApi } },
  };
  function load(filename, source = fs.readFileSync(filename, 'utf8')) {
    const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = id => {
      if (id in dependencies) return dependencies[id];
      if (id.endsWith('useTalentPermissions')) return user ? load(path.join(root, 'views/talent/useTalentPermissions.ts')) : { useTalentPermissions: () => permissions };
      if (id.endsWith('.vue')) return { name: path.basename(id, '.vue') };
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + '.ts'));
      return original(id);
    };
    loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
    return loaded.exports;
  }
  const filename = path.join(root, relative), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const component = load(filename, script.content).default;
  const componentProps = vue.reactive(props);
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(componentProps, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  function nodes(row = {}) {
    const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    const loaded = new Module(filename, module);
    loaded.require = id => {
      assert.equal(id, 'vue');
      return { ...vue, resolveComponent: name => ({ name }), resolveDirective: () => ({}), withDirectives: node => node,
        renderSlot: (slots, name, props, fallback) => vue.h(vue.Fragment, null, slots?.[name]?.(props) ?? fallback?.() ?? []) };
    };
    loaded._compile(ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    const setup = vue.proxyRefs(state);
    const tree = loaded.exports.render(setup, [], componentProps, setup, {}, {});
    const children = node => Array.isArray(node) ? node : typeof node === 'object' && node
      ? typeof node.default === 'function' ? node.default({ row }) : Object.values(node).filter(value => typeof value === 'function').flatMap(slot => slot({ row })) : [node];
    const text = node => children(node).map(value => typeof value === 'string' ? value : value?.children ? text(value.children) : '').join('');
    const found = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      found.push({ type: node.type, children: node.children, label: node.type?.name === 'el-button' ? text(node.children) : '', props: node.props });
      children(node.children).forEach(visit);
    }
    visit(tree);
    return found;
  }
  const buttons = row => nodes(row).filter(node => node.type?.name === 'el-button');
  return { state, route, requests, navigations, guards, permissions, props: componentProps, buttons, nodes };
}
const interviewView = 'views/talent/TalentInterviewView.vue';

test('recruitment readers default to all authorized applications and interviews without edit rights', async t => {
  const view = mount(t, interviewView); await flush();
  assert.equal(view.state.canManage.value, true);
  assert.equal(view.requests.at(-1).work, 'applications');
  assert.equal(view.requests.at(-1).scope, 'all');
  await view.state.changeMode('interviews'); await flush();
  assert.equal(view.requests.at(-1).scope, 'all');
});

test('scope query remains selectable and reset returns to all authorized records', async t => {
  const view = mount(t, interviewView, { query: { work: 'interviews', scope: 'created', bucket: 'feedback' } }); await flush();
  assert.equal(view.requests.at(-1).scope, 'created');
  assert.equal(view.requests.at(-1).view, 'feedback');
  view.route.query = { work: 'applications', scope: 'owned', keyword: 'synthetic', page: '2' }; await flush();
  assert.equal(view.requests.at(-1).scope, 'owned');
  assert.equal(view.requests.at(-1).page, 2);
  await view.state.reset(); await flush();
  assert.equal(view.requests.at(-1).scope, 'all');
});

test('ordinary interview participant cannot request collaboration scopes or candidate editing', async t => {
  const view = mount(t, interviewView, { canRead: false, query: { work: 'applications', scope: 'all', candidateId: 'candidate', applicationId: 'application' } }); await flush();
  assert.equal(view.requests.at(-1).work, 'interviews');
  assert.equal(view.requests.at(-1).scope, 'mine');
  assert.equal(typeof view.state.openEdit, 'function');
  await view.state.openEdit('candidate');
  assert.equal(view.state.formOpen.value, false);
});

test('candidate editor keeps exact application and filter context and protects leaving', async t => {
  const query = { work: 'applications', scope: 'owned', keyword: 'synthetic', stage: 'interviewing', page: '3', candidateId: 'candidate', applicationId: 'application' };
  const view = mount(t, interviewView, { canEdit: true, query }); await flush();
  assert.equal(typeof view.state.openEdit, 'function');
  await view.state.openEdit('candidate');
  assert.equal(view.state.formOpen.value, true);
  assert.equal(view.state.editCandidateId.value, 'candidate');
  assert.equal(view.state.drawerOpen.value, false);
  assert.deepEqual({ ...view.route.query }, query);
  view.state.formDrawer.value = { prepareToLeave: async () => false };
  assert.equal(await view.state.canLeave(), false);
  view.state.formDrawer.value = { prepareToLeave: async () => true };
  await view.state.closeForm(false);
  assert.equal(view.state.drawerOpen.value, true);
  assert.deepEqual(view.state.applicationMatch.value, { id: 'application' });
  assert.deepEqual({ ...view.route.query }, query);
});

test('detail close emitted while switching to candidate edit cannot remove IDs or reset form props', async t => {
  const query = { keyword: 'synthetic', scope: 'all', page: '2', candidateId: 'synthetic-candidate', applicationId: 'synthetic-application' };
  const view = mount(t, interviewView, { canEdit: true, query }); await flush();
  const detail = view.nodes().find(node => node.type?.name === 'TalentDetailDrawer');
  assert.equal(detail.props['model-value'], true);
  await detail.props.onEdit('synthetic-candidate'); await flush();
  await detail.props['onUpdate:modelValue'](false); await flush();
  assert.deepEqual({ ...view.route.query }, query);
  assert.deepEqual(view.navigations, []);
  const form = view.nodes().find(node => node.type?.name === 'TalentFormDrawer');
  assert.equal(form.props['model-value'], true);
  assert.equal(form.props['candidate-id'], 'synthetic-candidate');
  assert.equal(view.state.formOpen.value, true);
  assert.equal(view.state.editCandidateId.value, 'synthetic-candidate');
  await form.props['onUpdate:modelValue'](false); await flush();
  const returned = view.nodes().find(node => node.type?.name === 'TalentDetailDrawer');
  assert.equal(returned.props['model-value'], true);
  assert.equal(returned.props['candidate-id'], 'synthetic-candidate');
  assert.deepEqual(returned.props['application-match'], { id: 'synthetic-application' });
  assert.deepEqual({ ...view.route.query }, query);
});

test('an actual detail close still removes only selection and retains the list filters', async t => {
  const view = mount(t, interviewView, { canEdit: true, query: { keyword: 'synthetic', scope: 'owned', page: '3', candidateId: 'synthetic-candidate', applicationId: 'synthetic-application' } }); await flush();
  const detail = view.nodes().find(node => node.type?.name === 'TalentDetailDrawer');
  await detail.props['onUpdate:modelValue'](false); await flush();
  assert.equal(view.route.query.candidateId, undefined);
  assert.equal(view.route.query.applicationId, undefined);
  assert.equal(view.route.query.keyword, 'synthetic');
  assert.equal(view.route.query.scope, 'owned');
  assert.equal(view.route.query.page, '3');
  assert.equal(view.state.formOpen.value, false);
});

test('partial candidate save events refresh the queue without discarding the active editor', async t => {
  const view = mount(t, interviewView, { canEdit: true, query: { candidateId: 'candidate', applicationId: 'application' } }); await flush();
  await view.state.openEdit('candidate');
  view.state.onCandidateSaved(); await flush();
  assert.equal(view.state.formOpen.value, true);
  assert.equal(view.state.editCandidateId.value, 'candidate');
  assert.equal(view.state.drawerOpen.value, false);
});

test('read-only recruitment reader cannot enter candidate editor', async t => {
  const view = mount(t, interviewView, { query: { candidateId: 'candidate', applicationId: 'application' } }); await flush();
  assert.equal(typeof view.state.openEdit, 'function');
  await view.state.openEdit('candidate');
  assert.equal(view.state.formOpen.value, false);
  assert.equal(view.state.drawerOpen.value, true);
});

test('read-only application list offers viewing, not handling or a stale candidate picker', async t => {
  const view = mount(t, interviewView); await flush();
  const row = { id: 'synthetic-application', candidateId: 'synthetic-candidate', candidateName: 'Synthetic candidate', positionName: 'Synthetic role', stage: 'screening', ownerName: null, nextInterview: null };
  view.state.applications.value = [row];
  view.state.pickerOpen.value = true;
  const buttons = view.buttons(row);
  assert.ok(buttons.some(button => button.label === '查看'));
  for (const label of ['办理', '新增应聘', '填写应聘']) assert.ok(!buttons.some(button => button.label === label), label);
});

test('workbench all-invitations retains the personal feedback or upcoming intent', async t => {
  const view = mount(t, 'views/dashboard/DashboardRecruitment.vue'); await flush();
  view.state.openAll('feedback');
  view.state.openAll('interview');
  assert.deepEqual(view.navigations, [
    { path: '/talent-interviews', query: { work: 'interviews', scope: 'mine', bucket: 'feedback' } },
    { path: '/talent-interviews', query: { work: 'interviews', scope: 'mine', bucket: 'upcoming' } },
  ]);
});

const invitation = {
  id: 'synthetic-interview', candidateId: 'synthetic-candidate', applicationId: 'synthetic-application',
  application: { positionName: 'Synthetic engineer', recruitmentBatch: null }, candidateNameSnapshot: 'Synthetic candidate',
  startsAt: '2037-01-07T02:00:00.000Z', endsAt: '2037-01-07T03:00:00.000Z',
  invitationText: 'Hand-edited candidate wording. Please contact the coordinator.',
  meetingUrl: 'https://meeting.tencent.com/dm/synthetic-interview', status: 'scheduled', version: 1,
  sourceDeleted: false, participantNames: ['Synthetic interviewer'], participants: [],
  note: 'Internal scheduling note. Never copy outside.', feedback: 'Other participant private feedback.',
};

function browser() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://hrm.example.test' }, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => { copied.push(text); } } } });
  copied.restore = () => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  };
  return copied;
}

test('candidate and interviewer copies share the meeting but never copy internal notes or other feedback', async t => {
  const copied = browser();
  const view = mount(t, 'views/talent/components/TalentInterviewContent.vue', { props: { invitation } });
  t.after(copied.restore);
  await view.state.copy();
  assert.equal(copied[0], `${invitation.invitationText}\n${invitation.meetingUrl}`);
  assert.ok(view.state.audience, 'separate invitation audiences must be selectable');
  view.state.audience.value = 'interviewer';
  await view.state.copy();
  assert.match(copied[1], /Synthetic candidate/);
  assert.match(copied[1], /Synthetic engineer/);
  assert.match(copied[1], /2037-01-07 10:00:00.*2037-01-07 11:00:00/);
  assert.ok(copied[1].includes(invitation.meetingUrl));
  assert.ok(copied[1].includes('https://hrm.example.test/talent-interviews/synthetic-interview'));
  for (const text of copied) {
    assert.ok(!text.includes(invitation.note));
    assert.ok(!text.includes(invitation.feedback));
  }
  assert.ok(!copied[0].includes('hrm.example.test'));
  assert.equal(invitation.invitationText, 'Hand-edited candidate wording. Please contact the coordinator.');
});

test('ordinary participant copy uses only the minimal interview response, without fetching candidate or application', async t => {
  const copied = browser();
  const { candidateId, applicationId, application, note, participants, feedback, ...minimal } = invitation;
  const view = mount(t, 'views/talent/components/TalentInterviewContent.vue', { canRead: false, props: { invitation: minimal } });
  t.after(copied.restore);
  assert.ok(view.state.audience);
  view.state.audience.value = 'interviewer'; await view.state.copy();
  assert.match(copied[0], /Synthetic candidate/);
  assert.ok(!copied[0].includes('Synthetic engineer'));
  assert.ok(!copied[0].includes('synthetic-candidate'));
  assert.deepEqual(view.requests, []);
});

test('changing an existing interview schedule never regenerates hand-edited candidate wording', async t => {
  const copied = browser();
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', { props: { candidateId: 'synthetic-candidate', editable: true } }); await flush();
  t.after(copied.restore);
  await view.state.openEditor({ ...invitation }); await flush();
  view.state.form.startsAt = '2037-01-08 10:00:00';
  view.state.inviteMode.value = '线上面试'; await flush();
  assert.equal(view.state.form.invitationText, invitation.invitationText);
  assert.equal(view.state.form.meetingUrl, invitation.meetingUrl);
});

test('replacing a hand-edited invitation template requires explicit confirmation', async t => {
  const copied = browser();
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', { props: { candidateId: 'synthetic-candidate', editable: true } }); await flush();
  t.after(copied.restore);
  await view.state.openEditor({ ...invitation }); await flush();
  await view.state.useInviteTemplate();
  assert.equal(view.state.form.invitationText, invitation.invitationText);
  assert.equal(view.state.form.meetingUrl, invitation.meetingUrl);
});

test('late template confirmation cannot replace the text after leaving that editor session', async t => {
  const copied = browser();
  let resolve;
  const answer = new Promise(yes => { resolve = yes; });
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', {
    props: { candidateId: 'synthetic-candidate', editable: true }, confirm: () => answer,
  }); await flush();
  t.after(copied.restore);
  await view.state.openEditor({ ...invitation }); await flush();
  const pending = view.state.useInviteTemplate();
  view.state.resetEditor();
  view.state.form.invitationText = 'Different editor session text';
  resolve(); await pending;
  assert.equal(view.state.form.invitationText, 'Different editor session text');
});

test('read-only interview panel has no mutation buttons and mutation handlers make no writes', async t => {
  const copied = browser(), writes = [];
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', {
    props: { candidateId: 'synthetic-candidate', editable: false },
    interviewsApi: { action: async (...args) => writes.push(args), reconcileCalendar: async (...args) => writes.push(args), update: async (...args) => writes.push(args) },
  }); await flush();
  t.after(copied.restore);
  view.state.rows.value = [invitation];
  const labels = view.buttons().map(button => button.label);
  for (const label of ['新增面试', '修改邀约', '完成面试', '取消面试', '保存邀约', '重试日程同步', '核对钉钉日程']) assert.ok(!labels.includes(label), label);
  await view.state.openEditor(invitation);
  await view.state.save();
  await view.state.action(invitation, 'complete');
  await view.state.action(invitation, 'cancel');
  await view.state.action(invitation, 'retry-sync');
  await view.state.reconcile(invitation);
  assert.equal(view.state.editing.value, false);
  assert.deepEqual(writes, []);
});

test('revoked interview edit rights stop a confirmed action before any write', async t => {
  const copied = browser(), writes = [];
  let resolve;
  const answer = new Promise(yes => { resolve = yes; });
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', {
    props: { candidateId: 'synthetic-candidate', editable: true }, confirm: () => answer,
    interviewsApi: { action: async (...args) => writes.push(args) },
  }); await flush();
  t.after(copied.restore);
  const pending = view.state.action(invitation, 'complete'); await flush();
  view.props.editable = false;
  resolve(); await pending;
  assert.deepEqual(writes, []);
});

test('revoked interview edit rights stop a save after asynchronous validation', async t => {
  const copied = browser(), writes = [];
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', {
    props: { candidateId: 'synthetic-candidate', editable: true },
    interviewsApi: { update: async (...args) => writes.push(args) },
  }); await flush();
  t.after(copied.restore);
  await view.state.openEditor(invitation); await flush();
  view.state.formRef.value = { validate: async () => { view.props.editable = false; return true; } };
  await view.state.save();
  assert.deepEqual(writes, []);
});

const operator = { id: 'synthetic-operator', sysRole: 'employee', hrCapabilities: ['recruitment_edit'], isAssessorOnly: false };
const talent = { id: 'synthetic-candidate', name: 'Synthetic candidate', status: 'new', tags: [], files: [], shares: [], followUps: [], convertedUserId: 'synthetic-employee', onboardingRequest: { id: 'synthetic-entry', recordStatus: 'draft', onboardingStatus: 'draft' } };

test('operator list allows creation/edit but offers neither deletion checkboxes nor whole-table export', async t => {
  const view = mount(t, 'views/talent/TalentListView.vue', { user: operator }); await flush();
  view.state.list.value = [talent];
  const labels = view.buttons(talent).map(button => button.label);
  assert.ok(labels.includes('新增人才'));
  assert.ok(labels.includes('编辑'));
  for (const label of ['删除', '批量删除', '导出应聘记录']) assert.ok(!labels.includes(label), label);
  assert.ok(!view.nodes(talent).some(node => node.type?.name === 'el-checkbox'));
  view.state.toggleSelected(talent.id); view.state.toggleAll(); view.state.openDelete([talent]);
  assert.deepEqual(view.state.selectedIds.value, []);
  assert.equal(view.state.deleteVisible.value, false);
});

test('operator candidate detail keeps editing but hides and refuses delete/share/personnel handoff entries', async t => {
  const copied = browser(), managementCalls = [];
  const view = mount(t, 'views/talent/components/TalentDetailDrawer.vue', {
    user: operator, props: { modelValue: true, candidateId: talent.id },
    poolApi: { detail: async () => talent, deleteImpact: async id => { managementCalls.push(id); return { candidateId: id, interviews: [], requests: [] }; } },
  }); await flush(); t.after(copied.restore);
  const labels = view.buttons().map(button => button.label);
  assert.ok(labels.includes('编辑'));
  for (const label of ['删除', '转发', '查看入职申请', '查看员工档案']) assert.ok(!labels.includes(label), label);
  await view.state.removeCandidate(); view.state.openShare(); view.state.goOnboarding(); view.state.openEmployeeArchive();
  assert.deepEqual(managementCalls, []);
  assert.equal(view.state.shareVisible.value, false);
  assert.deepEqual(view.navigations, []);
});

test('operator cannot load deletion impacts or confirm deletion even if a stale dialog is mounted', async t => {
  const calls = [];
  const view = mount(t, 'views/talent/components/TalentDeleteDialog.vue', {
    user: operator, props: { modelValue: false, targets: [talent] },
    poolApi: { deleteImpact: async id => { calls.push('impact'); return { candidateId: id, version: 'v1', requiresForce: false, interviews: [], requests: [] }; }, remove: async () => calls.push('delete') },
  });
  view.props.modelValue = true; await flush();
  assert.equal(view.state.ready.value, false);
  assert.equal(view.state.visible.value, false);
  await view.state.confirmDelete();
  assert.deepEqual(calls, []);
});

test('operator cannot create or revoke public sharing through a stale share drawer', async t => {
  const copied = browser(), calls = [];
  const view = mount(t, 'views/talent/components/TalentShareDrawer.vue', {
    user: operator, props: { modelValue: true, candidateId: talent.id, candidateName: talent.name, shares: [] },
    poolApi: { createShare: async () => { calls.push('create'); return { url: '/synthetic-share' }; }, revokeShare: async () => calls.push('revoke') }, confirm: async () => {},
  }); t.after(copied.restore);
  assert.equal(view.state.visible.value, false);
  await view.state.createShare(); await view.state.revoke({ id: 'synthetic-share' });
  assert.deepEqual(calls, []);
});

test('accepted operator application tells personnel handoff and provides no invalid onboarding or archive links', async t => {
  const copied = browser();
  const application = { id: 'synthetic-application', stage: 'accepted', allowedActions: [], positionName: 'Synthetic role', onboardingRequest: { id: 'synthetic-entry', recordStatus: 'archived', onboardingStatus: 'cancelled' } };
  const view = mount(t, 'views/talent/components/TalentApplicationPanel.vue', {
    user: operator, props: { candidateId: talent.id, editable: true, convertedUserId: 'synthetic-employee' }, recruitmentApi: { applications: async () => [application] },
  }); await flush(); t.after(copied.restore);
  assert.equal(view.state.canOnboard.value, false);
  const labels = view.buttons().map(button => button.label);
  for (const label of ['办理入职', '查看历史入职', '查看入职申请', '查看员工档案']) assert.ok(!labels.includes(label), label);
  assert.ok(view.nodes().some(node => typeof node.children === 'string' && node.children.includes('交人事办理入职')));
  view.state.openOnboarding(); view.state.openOnboardingRequest();
  assert.deepEqual(view.navigations, []);
});

test('legacy HR still has delete/share and onboarding actions', async t => {
  const copied = browser();
  const view = mount(t, 'views/talent/components/TalentDetailDrawer.vue', {
    user: { id: 'synthetic-hr', sysRole: 'hr' }, props: { modelValue: true, candidateId: talent.id }, poolApi: { detail: async () => talent },
  }); await flush(); t.after(copied.restore);
  const labels = view.buttons().map(button => button.label);
  for (const label of ['编辑', '删除', '转发', '查看入职申请']) assert.ok(labels.includes(label), label);
});

test('participant search uses only recruitment API, once for options and once per selected ID, retaining invalid people', async t => {
  const copied = browser(), calls = [];
  const active = { id: 'synthetic-active', name: 'Synthetic active', employeeNo: 'S-A', status: 'active', archivedAt: null };
  const view = mount(t, 'views/talent/components/TalentInterviewPanel.vue', {
    user: operator, props: { candidateId: talent.id, editable: true }, interviewsApi: { participants: async query => { calls.push(query); return { items: query.id ? query.id === active.id ? [active] : [] : [active], total: 1 }; } },
  }); await flush(); t.after(copied.restore);
  await view.state.openEditor({ ...invitation, participants: [{ userId: active.id, userNameSnapshot: active.name }, { userId: 'synthetic-missing', userNameSnapshot: 'Synthetic unavailable' }] }); await flush();
  calls.length = 0;
  await view.state.searchPeople('Synthetic');
  assert.deepEqual(calls, [
    { id: 'synthetic-active', page: 1, pageSize: 1 },
    { id: 'synthetic-missing', page: 1, pageSize: 1 },
    { keyword: 'Synthetic', page: 1, pageSize: 30 },
  ]);
  assert.deepEqual([...view.state.form.participantIds], ['synthetic-active', 'synthetic-missing']);
  assert.ok(view.state.participantIssues.value['synthetic-missing']);
  assert.deepEqual(view.state.people.value.map(person => person.id), ['synthetic-active']);
});
