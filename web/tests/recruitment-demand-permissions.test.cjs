const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, '../src', file);
  const loaded = new Module(filename, module);
  const original = loaded.require.bind(loaded);
  loaded.require = name => name in overrides ? overrides[name] : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}

const { routes } = load('router/routes.ts');
const { canAccessRoute, buildNavigation } = load('router/navigation.ts');
const byName = name => routes.find(route => route.name === name);
const actor = { sysRole: 'employee', hrCapabilities: ['recruitment_demand_review'], canViewAll: false };

test('demand review is a narrow entry, not talent reading or hiring confirmation', () => {
  assert.equal(canAccessRoute(byName('RecruitmentDemands'), actor), true);
  assert.equal(canAccessRoute(byName('RecruitmentOverview'), actor), true);
  assert.equal(canAccessRoute(byName('TalentPool'), actor), false);
  assert.equal(canAccessRoute(byName('TalentHiringReview'), actor), false);
  const recruitment = buildNavigation(routes, actor).find(module => module.key === 'recruitment');
  assert.deepEqual(recruitment.groups.flatMap(group => group.items.map(item => item.name)), ['RecruitmentDemands']);
  assert.equal(canAccessRoute(byName('RecruitmentDemands'), { ...actor, isAssessorOnly: true }), false);
});

test('demand permission composable has no implicit HR review or candidate privileges', () => {
  const auth = { user: actor };
  const { useTalentPermissions } = load('views/talent/useTalentPermissions.ts', {
    '@/stores/auth.store': { useAuthStore: () => auth },
    vue: { computed: getter => ({ get value() { return getter(); } }) },
  });
  const permissions = useTalentPermissions();
  assert.equal(permissions.canReadDemand.value, true);
  assert.equal(permissions.canReviewDemand.value, true);
  for (const key of ['canRead', 'canEdit', 'canExport', 'canDelete', 'canShare', 'canOnboard']) assert.equal(permissions[key].value, false);
  auth.user = { ...actor, sysRole: 'hr', hrCapabilities: [] };
  assert.equal(permissions.canReadDemand.value, true);
  assert.equal(permissions.canReviewDemand.value, false);
  auth.user = { ...actor, isAssessorOnly: true };
  assert.equal(permissions.canReadDemand.value, false);
  assert.equal(permissions.canReviewDemand.value, false);
});

test('administrator can maintain the explicit review grant without hardcoded identities', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/admin/UserManageView.vue'), 'utf8');
  assert.ok(/label: '招聘需求审核', value: 'recruitment_demand_review'/.test(source));
  assert.ok(/data-testid="recruitment-demand-review-capability"/.test(source));
  assert.ok(/\['recruitment_view', 'recruitment_edit', 'recruitment_demand_review', 'talent_hiring_confirm'\]/.test(source));
});
