const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(__dirname, '../src/router', file), loaded = new Module(filename, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}
const { buildNavigation, canAccessRoute } = load('navigation.ts');
const { routes } = load('routes.ts');
const route = name => { const row = routes.find(item => item.name === name); assert.ok(row, `missing ${name}`); return row; };
const user = (sysRole, hrCapabilities = [], businessCapabilities = {}, extra = {}) => ({ sysRole, hrCapabilities, canViewAll: false, businessCapabilities, ...extra });
const matrix = [
  ['employee', user('employee'), false, false],
  ['manager', user('manager', [], { canManageTeam: true, canViewReports: true }), false, false],
  ['company approver', user('vp', [], { canViewPerformanceApproval: true }), false, false],
  ['personnel HR organization', user('hr_user', ['organization_edit']), false, false],
  ['archive-edit / recruitment HR', user('hr_user', ['employee_archive_edit']), true, false],
  ['archive-review HR', user('hr_user', ['employee_archive_review']), true, false],
  ['interviewer', user('employee'), false, false],
  ['hiring confirmer', user('employee', ['talent_hiring_confirm']), false, true],
  ['performance specialist', user('hr_user', ['cycle_plan_edit', 'performance_publish']), false, false],
  ['HR admin', user('hr'), true, true],
  ['system admin', user('system_admin'), true, false],
  ['assessor-only', user('hr', ['talent_hiring_confirm'], {}, { isAssessorOnly: true }), false, false],
];
for (const [label, actor, talent, hiring] of matrix) test(`IA role matrix: ${label}`, () => {
  const navigation = buildNavigation(routes, actor);
  assert.equal(canAccessRoute(route('TalentPool'), actor), talent);
  assert.equal(canAccessRoute(route('TalentHiringReview'), actor), hiring);
  const recruitment = navigation.find(item => item.key === 'recruitment');
  const names = recruitment?.groups.flatMap(group => group.items.map(item => item.name)) ?? [];
  assert.equal(names.includes('TalentPool'), talent);
  assert.equal(names.includes('TalentInterviews'), talent);
  assert.equal(names.includes('TalentHiringReview'), hiring);
  assert.equal(names.includes('RecruitmentPlanning'), actor.sysRole === 'system_admin');
  assert.equal(recruitment?.status, undefined);
  if (recruitment) {
    assert.notEqual(recruitment.defaultPath, '/recruitment');
    assert.notEqual(recruitment.defaultPath, '/recruitment/planning');
    assert.ok(canAccessRoute(routes.find(item => item.path === recruitment.defaultPath), actor));
  }
  assert.equal(navigation.some(item => item.key === 'compensation'), actor.sysRole === 'system_admin');
  assert.equal(canAccessRoute(route('RecruitmentPlanning'), actor), actor.sysRole === 'system_admin');
  assert.equal(canAccessRoute(route('CompensationOverview'), actor), actor.sysRole === 'system_admin');
  assert.equal(canAccessRoute(route('TalentInterviews'), actor), true); // own queue, server filters objects
});

test('personnel and performance ownership, defaults and probation placement', () => {
  const nav = buildNavigation(routes, user('hr', [], { canViewReports: true }));
  const performance = nav.find(item => item.key === 'performance');
  assert.deepEqual(performance.groups.map(group => group.label), ['绩效任务', '绩效运营', '试用期与转正', '绩效分析', '绩效设置']);
  assert.equal(route('ConfirmationManage').meta.navigation.module, 'performance');
  assert.equal(route('ConfirmationMine').meta.navigation.module, 'performance');
  assert.deepEqual(nav.find(item => item.key === 'people').groups.map(group => group.label), ['人员档案']);
  assert.equal(route('BasicData').meta.navigation.label, '人事基础资料');
  assert.equal(route('Dashboard').meta.title, '全局工作台');
  assert.equal(route('MyTasks').meta.title, '绩效任务');
  assert.equal(route('Indicators').meta.navigation.groupLabel, '绩效设置');
  const recruitment = nav.find(item => item.key === 'recruitment');
  assert.equal(recruitment.defaultPath, '/recruitment/demands');
  assert.deepEqual(recruitment.groups.flatMap(group => group.items.map(item => item.label)),
    ['招聘需求', '简历收件', '人才库', '应聘与面试', '录用确认']);
  assert.equal(buildNavigation(routes, user('employee', ['talent_hiring_confirm'])).find(item => item.key === 'recruitment').defaultPath, '/talent-hiring');
  assert.equal(routes.filter(item => item.path === '/entry-exit' && item.meta.navigation).length, 1);
  assert.equal(route('PersonnelLifecycle').meta.navigation.module, 'people');
});

test('personnel and performance operators retain separate management capabilities', () => {
  const personnel = user('hr_user', ['employee_archive_edit', 'organization_edit']);
  const performance = user('hr_user', ['cycle_plan_edit', 'cycle_plan_review', 'performance_calibration', 'performance_publish', 'confirmation_manage']);
  for (const actor of [personnel, performance]) {
    const nav = buildNavigation(routes, actor);
    const probation = nav.find(item => item.key === 'performance').groups.find(group => group.key === 'performance-probation');
    assert.ok(probation);
    assert.equal(probation.label, '试用期与转正');
    assert.equal(probation.items.some(item => item.name === 'ConfirmationManage'), actor === performance);
    assert.ok(probation.items.some(item => item.name === 'ConfirmationMine'));
    assert.equal(nav.some(item => item.key === 'people'), actor === personnel);
    assert.equal(canAccessRoute(route('Users'), actor), actor === personnel);
  }
  assert.equal(canAccessRoute(route('ConfirmationManage'), personnel), false);
  assert.equal(canAccessRoute(route('ConfirmationManage'), user('employee', [], { canHandleConfirmationApprovals: true })), true);
});

test('preserves public share and existing legacy deep-link object/query/hash', () => {
  const publicShare = route('TalentShared');
  assert.equal(publicShare.path, '/talents/s/:token'); assert.equal(publicShare.meta.public, true);
  const query = { applicationId: 'fictional-id', tab: 'reviews' }, hash = '#history';
  assert.deepEqual(route('PersonnelProcessing').redirect({ query, hash }), { path: '/entry-exit', query, hash });
  assert.deepEqual(route('ConfirmationApprovalsLegacy').redirect({ params: { id: 'fictional-id' }, query, hash }), {
    path: '/confirmation-applications/manage/fictional-id', query, hash,
  });
  assert.equal(route('TalentInterviewDetail').meta.activeNavigationPath, '/talent-interviews');
  assert.equal(route('TaskDetail').meta.activeNavigationPath, '/tasks');
});
