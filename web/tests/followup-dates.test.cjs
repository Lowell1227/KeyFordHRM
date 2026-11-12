const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/utils/talent-follow-up-date.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { beijingFollowUpToday, isFollowUpDate, formatFollowUpDate } = loaded.exports;

for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  test(`Beijing default and stored day labels are independent of ${timezone}`, () => {
    const original = process.env.TZ;
    process.env.TZ = timezone;
    try {
      for (const [now, expected] of [
        ['2026-11-12T15:59:59.999Z', '2026-11-12'],
        ['2026-11-12T16:00:00.000Z', '2026-11-13'],
        ['2026-11-12T17:00:00.000Z', '2026-11-13'],
        ['2026-11-12T23:59:59.999Z', '2026-11-13'],
        ['2026-12-31T16:00:00.000Z', '2027-01-01'],
        ['2028-02-28T16:00:00.000Z', '2028-02-29'],
      ]) assert.equal(beijingFollowUpToday(new Date(now)), expected);
      assert.equal(formatFollowUpDate('2026-11-13T00:00:00.000Z'), '2026-11-13');
      assert.equal(formatFollowUpDate('2028-02-29'), '2028-02-29');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
}

test('calendar validation rejects rolled dates, invalid years, months, days and non-date inputs', () => {
  for (const value of [
    '2026-02-31', '2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31',
    '2026-00-10', '2026-13-10', '2026-01-00', '2026-01-32', '0000-01-01',
    '10000-01-01', '-2026-01-01', '2026-2-01', '2026-01-01T00:00:00Z', '', null, undefined, 20261113,
  ]) assert.equal(isFollowUpDate(value), false, String(value));
  assert.equal(formatFollowUpDate('2026-02-31T00:00:00.000Z'), '-');
  assert.equal(formatFollowUpDate(null), '-');
});

test('real leap days and four-digit years preserve the exact date-only label', () => {
  for (const value of ['0001-01-01', '0099-12-31', '2000-02-29', '2028-02-29', '2026-04-30', '9999-12-31']) {
    assert.equal(isFollowUpDate(value), true, value);
    assert.equal(formatFollowUpDate(`${value}T00:00:00.000Z`), value);
  }
});
