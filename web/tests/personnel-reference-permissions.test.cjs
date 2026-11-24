const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/utils/personnel-reference-permissions.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { canReadPersonnelReferenceData, canWritePersonnelReferenceData } = loaded.exports;
const otherKinds = ['work_location', 'job_family', 'job_grade', 'marital_status', 'political_status',
  'household_type', 'contact_relation', 'bank_name', 'contract_name'];

for (const sysRole of ['employee', 'hr_user', 'manager']) {
  test(`${sysRole} recruitment operator reads only education and never maintains reference data`, () => {
    const user = { sysRole, hrCapabilities: ['recruitment_edit'] };
    assert.equal(canReadPersonnelReferenceData(user, 'education'), true);
    assert.equal(canWritePersonnelReferenceData(user), false);
    for (const kind of otherKinds) assert.equal(canReadPersonnelReferenceData(user, kind), false);
  });
}

test('legacy archive roles retain their reference read/write scopes', () => {
  for (const [sysRole, hrCapabilities, write] of [
    ['hr', [], true], ['system_admin', [], true],
    ['hr_user', ['employee_archive_edit', 'recruitment_edit'], true],
    ['hr_user', ['employee_archive_review', 'recruitment_edit'], false],
  ]) {
    const user = { sysRole, hrCapabilities };
    assert.equal(canWritePersonnelReferenceData(user), write);
    for (const kind of ['education', ...otherKinds]) assert.equal(canReadPersonnelReferenceData(user, kind), true);
  }
  const organization = { sysRole: 'hr_user', hrCapabilities: ['organization_edit'] };
  assert.equal(canReadPersonnelReferenceData(organization, 'job_family'), true);
  assert.equal(canReadPersonnelReferenceData(organization, 'education'), false);
});

test('recruitment viewers and missing users gain no education read/write scope', () => {
  for (const user of [null, undefined, { sysRole: 'employee', hrCapabilities: ['recruitment_view'] }]) {
    assert.equal(canReadPersonnelReferenceData(user, 'education'), false);
    assert.equal(canWritePersonnelReferenceData(user), false);
  }
});
