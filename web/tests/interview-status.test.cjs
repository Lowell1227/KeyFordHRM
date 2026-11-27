const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/views/talent/interview-status.ts');

function load() {
  const mod = new Module(filename, module);
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = () => ({ INTERVIEW_STATUS_LABELS: { scheduled: '待面试', completed: '已完成', cancelled: '已取消' } });
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports.interviewStatusLabel;
}
test('overdue interview status is shared by desktop and mobile without changing completed or cancelled records', () => {
  const label = load(), now = Date.parse('2026-11-26T04:00:00Z');
  assert.equal(label({ status: 'scheduled', endsAt: '2026-11-26T03:59:00Z' }, now), '待确认实际结果');
  assert.equal(label({ status: 'scheduled', endsAt: '2026-11-26T04:01:00Z' }, now), '待面试');
  assert.equal(label({ status: 'completed', endsAt: '2026-11-26T03:59:00Z' }, now), '已完成');
  assert.equal(label({ status: 'cancelled', endsAt: '2026-11-26T03:59:00Z' }, now), '已取消');
  assert.equal(label({ status: 'scheduled', endsAt: 'invalid' }, now), '待面试');
  const view = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/TalentInterviewView.vue'), 'utf8');
  assert.equal((view.match(/interviewStatusLabel\(row as TalentInterviewView\)/g) || []).length, 2);
});
