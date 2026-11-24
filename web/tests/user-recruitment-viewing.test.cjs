const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const { ref } = require('vue');

const filename = path.resolve(__dirname, '../src/views/admin/UserManageView.vue');
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
const ast = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['setRecruitmentViewing', 'setRecruitmentEditing', 'confirmPersonSettings'].includes(node.name.text));
const options = ast.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText(ast) === 'hrCapabilityOptions'));

function fixture(overrides = {}) {
  const writes = [];
  const state = ref({ visible: true, userId: 'fictional-employee', saving: false, sysRole: 'employee',
    originalSysRole: 'employee', hrCapabilities: [], originalHrCapabilities: [], ...overrides });
  const context = {
    personSettingsDialog: state, isSystemAdmin: ref(true), selectedManagerRelationChanged: ref(false),
    usersApi: { updateSettings: async (...args) => { writes.push(args); } },
    ElMessage: { warning() {}, success() {}, info() {} }, loadUsers: async () => {}, loadOrgMembers: async () => {},
  };
  const source = `const { ${Object.keys(context).join(',')} } = context;
    ${options.getText(ast)} ${functions.map(node => node.getText(ast)).join('\n')}
    return { options: hrCapabilityOptions, confirmPersonSettings,
      setRecruitmentViewing: typeof setRecruitmentViewing === 'function' ? setRecruitmentViewing : undefined,
      setRecruitmentEditing: typeof setRecruitmentEditing === 'function' ? setRecruitmentEditing : undefined };`;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { ...new Function('context', js)(context), state, writes };
}

test('both HR capability options and the employee recruitment block expose viewing', () => {
  const f = fixture();
  assert.deepEqual(f.options.find(item => item.value === 'recruitment_view'), { value: 'recruitment_view', label: '招聘查看' });
  const block = descriptor.template.content.match(/<el-form-item[^>]*label="招聘职责">([\s\S]*?)<\/el-form-item>/)?.[1];
  assert.match(block, /hrCapabilities\.includes\('recruitment_view'\)/);
  assert.match(block, /@change="setRecruitmentViewing"/);
});

test('an employee can save viewing without becoming HR or receiving hiring confirmation', async () => {
  const f = fixture();
  assert.equal(typeof f.setRecruitmentViewing, 'function');
  f.setRecruitmentViewing(true);
  f.setRecruitmentViewing(true);
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'employee', hrCapabilities: ['recruitment_view'] }]]);
});

test('changing HR user to employee preserves only the existing independent recruitment capabilities', async () => {
  const f = fixture({ originalSysRole: 'hr_user', hrCapabilities: ['talent_hiring_confirm', 'cycle_plan_edit', 'recruitment_view'],
    originalHrCapabilities: ['talent_hiring_confirm', 'cycle_plan_edit', 'recruitment_view'] });
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'employee', hrCapabilities: ['recruitment_view', 'talent_hiring_confirm'] }]]);
});

test('revoking viewing does not remove an existing hiring confirmation capability', async () => {
  const f = fixture({ hrCapabilities: ['recruitment_view', 'talent_hiring_confirm'],
    originalHrCapabilities: ['recruitment_view', 'talent_hiring_confirm'] });
  assert.equal(typeof f.setRecruitmentViewing, 'function');
  f.setRecruitmentViewing(false);
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] }]]);
});

test('unchanged independent recruitment capabilities do not trigger an unnecessary save', async () => {
  const f = fixture({ hrCapabilities: ['talent_hiring_confirm', 'recruitment_view'],
    originalHrCapabilities: ['recruitment_view', 'talent_hiring_confirm'] });
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, []);
});

test('both HR options and standard-user checkbox expose recruitment operating', () => {
  const f = fixture();
  assert.deepEqual(f.options.find(item => item.value === 'recruitment_edit'), { value: 'recruitment_edit', label: '招聘经办' });
  const block = descriptor.template.content.match(/<el-form-item[^>]*label="招聘职责">([\s\S]*?)<\/el-form-item>/)?.[1];
  assert.match(block, /hrCapabilities\.includes\('recruitment_edit'\)/);
  assert.match(block, /@change="setRecruitmentEditing"/);
});

test('operator checkbox preserves viewing and hiring confirmation without changing employee role', async () => {
  const f = fixture({ hrCapabilities: ['recruitment_view', 'talent_hiring_confirm'], originalHrCapabilities: ['recruitment_view', 'talent_hiring_confirm'] });
  assert.equal(typeof f.setRecruitmentEditing, 'function');
  f.setRecruitmentEditing(true); f.setRecruitmentEditing(true);
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'employee', hrCapabilities: ['recruitment_edit', 'recruitment_view', 'talent_hiring_confirm'] }]]);
});

test('revoking viewing preserves the existing operator and independent confirmer', async () => {
  const f = fixture({ hrCapabilities: ['recruitment_edit', 'recruitment_view', 'talent_hiring_confirm'], originalHrCapabilities: ['recruitment_edit', 'recruitment_view', 'talent_hiring_confirm'] });
  f.setRecruitmentViewing(false);
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'employee', hrCapabilities: ['recruitment_edit', 'talent_hiring_confirm'] }]]);
});

test('HR operator checkbox keeps all other HR capabilities', async () => {
  const f = fixture({ sysRole: 'hr_user', originalSysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'employee_archive_review'], originalHrCapabilities: ['cycle_plan_edit', 'employee_archive_review'] });
  assert.equal(typeof f.setRecruitmentEditing, 'function');
  f.setRecruitmentEditing(true);
  await f.confirmPersonSettings();
  assert.deepEqual(f.writes, [['fictional-employee', { sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'employee_archive_review', 'recruitment_edit'] }]]);
});
