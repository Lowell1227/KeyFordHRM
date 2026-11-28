const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
function load(relative) {
  const file = path.join(root, relative), loaded = new Module(file, module); loaded.paths = module.paths;
  loaded.require = id => id.startsWith('@/') ? load(id.slice(2) + '.ts') : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, file);
  return loaded.exports;
}
const presentation = () => load('views/talent/application-presentation.ts');
const snapshot = { departmentId: 'dept-a', positionId: 'job-a', positionName: 'Fictional engineer' };
const application = extra => ({ stage: 'accepted', deptId: 'dept-a', positionName: 'Fictional engineer', expectedEntryDate: '2037-01-11T00:00:00.000Z', recruitmentDemandSnapshot: snapshot, ...extra });

test('hiring preflight lists department and catalog position together and keeps independent missing inputs visible', () => {
  const { hiringPreflightIssues } = presentation();
  const issues = hiringPreflightIssues({ deptId: null, positionName: 'Unknown job' }, { departments: [], positions: [] }, null, '');
  assert.equal(issues.length, 4);
  for (const fragment of ['部门', '岗位', '需求', '意见']) assert.ok(issues.some(issue => issue.includes(fragment)), fragment);
});

test('offer termination and interview next steps describe actual records without silently changing stages', () => {
  const { applicationStageLabel, applicationNextStep } = presentation();
  assert.equal(applicationStageLabel({ stage: 'withdrawn', offerTerminated: true }), '录用已终止');
  assert.match(applicationNextStep({ stage: 'screening', nextInterview: { startsAt: '2037-01-11T01:00:00Z' } }, new Date('2037-01-11T02:00:00Z')), /确认.*面试结果/);
  assert.match(applicationNextStep({ stage: 'screening', nextInterview: { startsAt: '2037-01-11T01:00:00Z', endsAt: '2037-01-11T03:00:00Z' } }, new Date('2037-01-11T02:00:00Z')), /进行中/);
  assert.match(applicationNextStep({ stage: 'screening', latestInterview: { status: 'completed' }, activitySummary: { scheduledCount: 0, unsubmittedFeedbackCount: 2 } }), /反馈/);
  assert.match(applicationNextStep({ stage: 'screening', latestInterview: { status: 'completed' }, activitySummary: { scheduledCount: 0, unsubmittedFeedbackCount: 0 } }), /进入面试阶段/);
  assert.match(applicationNextStep({ stage: 'interviewing', latestInterview: { status: 'completed' }, activitySummary: { scheduledCount: 0, unsubmittedFeedbackCount: 0 } }), /录用|下一轮/);
});

test('onboarding prefill uses the accepted frozen identity only when live catalogs still match', () => {
  const { onboardingRecruitmentPrefill } = presentation();
  const departments = [{ id: 'dept-a', isActive: true }], positions = [{ id: 'job-a', name: 'Fictional engineer', isActive: true }];
  assert.deepEqual(onboardingRecruitmentPrefill(application(), departments, positions), { deptId: 'dept-a', positionId: 'job-a', expectedEntryDate: '2037-01-11' });
  assert.deepEqual(onboardingRecruitmentPrefill(application({ recruitmentDemandSnapshot: null }), departments, positions), { expectedEntryDate: '2037-01-11' });
  assert.deepEqual(onboardingRecruitmentPrefill(application(), departments, [{ ...positions[0], isActive: false }]), { deptId: 'dept-a', expectedEntryDate: '2037-01-11' });
  assert.deepEqual(onboardingRecruitmentPrefill(application({ stage: 'offered' }), departments, positions), {});
  assert.deepEqual(onboardingRecruitmentPrefill(application({ positionName: 'Changed job' }), departments, positions), { deptId: 'dept-a', expectedEntryDate: '2037-01-11' });
});
