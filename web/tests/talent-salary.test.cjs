const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/utils/talent-salary.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { talentSalaryYuan, formatTalentSalary } = loaded.exports;

test('canonical exact yuan takes precedence over compatibility K fields', () => {
  const value = { expectSalaryMin: 5.501, expectSalaryMax: 6.809, expectSalaryUnit: 'yuan', expectSalaryMinYuan: 5501, expectSalaryMaxYuan: 6809 };
  assert.deepEqual(talentSalaryYuan(value), { min: 5501, max: 6809, needsReview: false });
  assert.equal(formatTalentSalary(value), '5501–6809元/月');
});
test('unchanged historical K values convert only for display', () => {
  const value = Object.freeze({ expectSalaryMin: 7, expectSalaryMax: 10 });
  assert.equal(formatTalentSalary(value), '7000–10000元/月');
  assert.equal(value.expectSalaryMin, 7);
});
for (const value of [{ expectSalaryMin: 999, expectSalaryMax: 10 }, { expectSalaryMin: 1, expectSalaryMax: 999 }, { salaryNeedsReview: true, expectSalaryMinYuan: 999000 }]) {
  test(`historical suspicious salary stays unknown ${JSON.stringify(value)}`, () => {
    assert.deepEqual(talentSalaryYuan(value), { min: null, max: null, needsReview: true });
    assert.equal(formatTalentSalary(value), '历史薪资待核对');
  });
}
test('new yuan 999 is valid and zero is not treated as absent', () => {
  assert.equal(formatTalentSalary({ expectSalaryUnit: 'yuan', expectSalaryMinYuan: 999, expectSalaryMaxYuan: 999 }), '999–999元/月');
  assert.equal(formatTalentSalary({ expectSalaryUnit: 'yuan', expectSalaryMinYuan: 0, expectSalaryMaxYuan: 0 }), '0–0元/月');
});
test('empty and open ranges retain their meaning', () => {
  assert.equal(formatTalentSalary({ expectSalaryMinYuan: null, expectSalaryMaxYuan: null }), '面议');
  assert.equal(formatTalentSalary({}, '—'), '—');
  assert.equal(formatTalentSalary({ expectSalaryMinYuan: 5501 }), '5501元/月以上');
  assert.equal(formatTalentSalary({ expectSalaryMaxYuan: 6809 }), '6809元/月以下');
});
