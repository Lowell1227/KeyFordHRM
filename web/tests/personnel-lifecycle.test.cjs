const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
function loadTs(relative) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const lifecycle = loadTs('src/utils/employee-lifecycle.ts');
const pending = () => ({
  id: 'request-1', intakeType: 'new_hire', sourceType: 'manual_employee_create',
  recordStatus: 'submitted', onboardingStatus: 'pending_entry', requestVersion: 3,
  requiresArrivalConfirmation: true, arrivalConfirmedAt: null,
  profileReviewStatus: 'approved', performanceReviewStatus: 'not_required',
  proposedValue: { employee: { effectiveFrom: '2026-11-12', entryDate: '2026-11-12' } },
});

test('arrival remains pending even after the reviewed date and a profile applied timestamp', () => {
  const request = { ...pending(), appliedAt: '2026-11-12T00:00:00Z' };
  assert.equal(lifecycle.applicationProgress(request), '待确认到岗');
  assert.equal(lifecycle.isPendingArrival(request), true);
});

test('arrival requires reviewed intake and excludes cancellation, draft, legacy and completed records', () => {
  assert.equal(lifecycle.isPendingArrival(pending()), true);
  for (const override of [
    { requiresArrivalConfirmation: false }, { arrivalConfirmedAt: '2026-11-12T00:00:00Z' },
    { onboardingStatus: 'effective' }, { onboardingStatus: 'cancelled' }, { recordStatus: 'draft' },
    { profileReviewStatus: 'pending' }, { profileReviewStatus: 'rejected' }, { cancelledAt: '2026-11-12' },
  ]) assert.equal(lifecycle.isPendingArrival({ ...pending(), ...override }), false);
});

test('arrival must match reviewed date, carry a version, and not be future in Shanghai', () => {
  const now = new Date('2026-11-11T16:30:00Z');
  assert.equal(lifecycle.arrivalConfirmationError(pending(), '2026-11-12', now), '');
  assert.match(lifecycle.arrivalConfirmationError(pending(), '2026-11-11', now), /审核/);
  assert.match(lifecycle.arrivalConfirmationError(pending(), '2026-11-12', new Date('2026-11-11T15:30:00Z')), /未来/);
  assert.match(lifecycle.arrivalConfirmationError({ ...pending(), requestVersion: undefined }, '2026-11-12', now), /版本/);
  assert.match(lifecycle.arrivalConfirmationError({ ...pending(), requestVersion: 0 }, '2026-11-12', now), /版本/);
  assert.notEqual(lifecycle.arrivalConfirmationError({ ...pending(), proposedValue: { employee: { effectiveFrom: '2026-02-30' } } }, '2026-02-30', now), '');
  assert.equal(lifecycle.reviewedArrivalDate({ ...pending(), intakeType: 'reentry', proposedValue: { employee: { effectiveDate: '2026-11-12' } } }), '2026-11-12');
});

test('ordinary interview routes require login without talent-management authorization or menu entries', () => {
  const { routes } = loadTs('src/router/routes.ts');
  for (const routePath of ['/talent-interviews', '/talent-interviews/:id']) {
    const route = routes.find(item => item.path === routePath);
    assert.equal(route.meta.requiresAuth, true);
    assert.equal(route.meta.roles, undefined);
    assert.equal(route.meta.hrCapabilities, undefined);
    assert.equal(route.meta.navigation, undefined);
  }
  const performanceRoutes = routes.filter(item => item.path === '/interviews');
  assert.equal(performanceRoutes.length, 1);
  assert.equal(performanceRoutes[0].meta.title, '绩效面谈');
  assert.equal(new Set(routes.map(item => item.path)).size, routes.length);
});

test('entry-exit excludes transfers and archive edits without losing resignation or legacy onboarding', () => {
  assert.equal(lifecycle.isPersonnelLifecycleRequest(pending()), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ sourceType: 'manual_employee_create' }), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ proposedValue: { employee: { changeType: 'resignation' } } }), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ sourceType: 'manual_archive_change' }), false);
  const resignedProfileEdit = { sourceType: 'manual_archive_change', baseValue: { employee: { employeeStatus: 'resigned' } }, proposedValue: { employee: { employeeStatus: 'resigned' } } };
  assert.equal(lifecycle.isPersonnelLifecycleRequest(resignedProfileEdit), false);
  assert.equal(lifecycle.applicationType(resignedProfileEdit), '档案修改');
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ proposedValue: { employee: { changeType: 'transfer' } } }), false);
});

test('submission message separates exempt applied fields from pending review', () => {
  assert.equal(lifecycle.archiveSubmissionMessage({ directApplied: ['姓名'], request: null }), '档案已更新');
  assert.match(lifecycle.archiveSubmissionMessage({ directApplied: ['姓名'], request: { profileReviewStatus: 'pending' } }), /姓名已生效.*其余变更已提交审核/);
  assert.doesNotMatch(lifecycle.archiveSubmissionMessage({ directApplied: [], request: { profileReviewStatus: 'pending' } }), /已生效/);
});

test('legacy review and application links retain query context at entry-exit', () => {
  const { routes } = loadTs('src/router/routes.ts');
  assert.equal(routes.find(route => route.path === '/entry-exit').meta.navigation.label, '入离职');
  const oldReview = routes.find(route => route.path === '/personnel-change-reviews');
  assert.deepEqual(oldReview.redirect({ query: { category: 'position', requestId: 'r1' }, hash: '' }), {
    path: '/entry-exit', query: { category: 'position', requestId: 'r1', tab: 'reviews' }, hash: '',
  });
  const oldProcessing = routes.find(route => route.path === '/personnel-processing');
  assert.equal(oldProcessing.redirect({ query: { requestId: 'r2' }, hash: '' }).query.requestId, 'r2');
});

test('archive editor exposes one Submit command without manual save or policy modes', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/admin/UserManageView.vue'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeArchiveInlineEditor.vue'), 'utf8');
  assert.equal(/reviewMode|宽松模式|保存后关闭|saveArchiveAndClose/.test(view + editor), false);
  assert.match(view, /@click="archiveEditorRef\?\.submit\(\)">提交<\/el-button>/);
  assert.match(editor, /session !== generation/);
  assert.match(editor, /expectedVersion: draftId \? draftVersion/);
});

test('talent source travels in payloads, never from name/phone route parameters', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/admin/UserManageView.vue'), 'utf8');
  const create = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeCreateDrawer.vue'), 'utf8');
  const reentry = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeReentryDrawer.vue'), 'utf8');
  assert.equal(/fromTalent|route\.query\.phone|route\.query\.name/.test(view), false);
  assert.equal(view.includes('await talentPoolApi.detail(id)'), true);
  assert.equal(create.includes('talentCandidateId: sourceTalentId.value'), true);
  assert.equal(create.includes("emit('reentry', candidate.id, talentId)"), true);
  assert.equal(reentry.includes('talentCandidateId: currentRequest.value?.talentCandidateId ?? props.talentCandidateId'), true);
  assert.equal(/saveAndExit|保存并退出/.test(create), false);
});
