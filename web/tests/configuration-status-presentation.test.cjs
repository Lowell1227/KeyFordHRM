const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/views/system/configuration-status-presentation.ts');
const m = new Module(file, module);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { configurationSource, configurationDraft, verificationText, businessState, configurationAction } = m.exports;
const row = (extra = {}) => ({ id: 'dingtalk-login', fields: [], verification: 'unknown', verifiedAt: null,
  enabled: true, revision: 0, appliedRevision: 0, testKind: 'connection', ...extra });

test('deployment login keeps its existing runtime separate from missing page verification', () => {
  const value = row({ fields: [{ label: 'AppKey', state: 'present' }] });
  assert.equal(configurationSource(value), '系统内配置尚未应用；运行时读取部署设置');
  assert.equal(verificationText(value), '本页面无核验记录');
  assert.equal(businessState(value), '登录入口已启用');
});

test('an absent or unknown deployment configuration does not claim it exists', () => {
  assert.equal(configurationSource(row({ fields: [{ label: 'AppKey', state: 'missing' }] })), '系统内配置尚未应用；运行时读取部署设置');
  assert.equal(configurationSource(row({ fields: [{ label: 'AppKey', state: 'unknown' }] })), '系统内配置尚未应用；运行时读取部署设置');
});

test('draft verification never replaces the older applied version', () => {
  const value = row({ id: 'dingtalk-calendar', revision: 5, appliedRevision: 3, verification: 'passed', testKind: 'configuration' });
  assert.equal(configurationSource(value), '当前使用系统配置 · 版本 3');
  assert.equal(configurationDraft(value), '草稿版本 5 · 尚未应用');
  assert.equal(verificationText(value), '草稿配置核验通过');
});

test('business-specific statuses describe the right action and verification scope', () => {
  assert.equal(businessState(row({ id: 'ai-progress-deepseek', enabled: false })), '目标进展识别未使用');
  assert.equal(businessState(row({ id: 'recruitment-demand', enabled: false })), '审批表接入配置不完整');
  assert.equal(verificationText(row({ id: 'recruitment-demand', revision: 2, appliedRevision: 2, verification: 'passed', testKind: 'scope' })), '指定样本核验通过');
  assert.equal(businessState(row({ id: 'dingtalk-notifications', enabled: false })), '通知实际开关未启用');
  assert.equal(businessState(row({ id: 'recruitment-mail', configuredCount: 2, enabledCount: 1 })), '已配置 2 个 · 已启用 1 个');
  assert.equal(verificationText(row({ id: 'recruitment-mail', verification: 'passed' })), '各邮箱核验状态请查看邮箱管理');
  assert.equal(configurationAction(row({ id: 'recruitment-mail' })), '管理招聘邮箱');
});
