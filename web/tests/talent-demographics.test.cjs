const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/utils/talent-demographics.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, file);
const { formatTalentBirth, formatReportedTalentAge } = loaded.exports;

test('preserves explicitly known birth precision', () => {
  assert.equal(formatTalentBirth({ birthYear: 1998, birthMonth: 5 }), '1998年5月');
  assert.equal(formatTalentBirth({ birthYear: 1998 }), '1998年');
  assert.equal(formatTalentBirth({ birthMonth: 5 }), '—');
  assert.equal(formatTalentBirth({}), '—');
});

test('shows resume age only and never derives exact age from partial birth facts', () => {
  assert.equal(formatReportedTalentAge({ reportedAge: 28 }), '28岁');
  assert.equal(formatReportedTalentAge({ reportedAge: 0 }), '0岁');
  assert.equal(formatReportedTalentAge({ birthYear: 1998, birthMonth: 5 }), '—');
});
