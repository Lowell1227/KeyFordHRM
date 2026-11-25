const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const test = require('node:test');

const script = path.join(__dirname, 'configure-recruitment-mail.ps1');
const source = () => fs.readFileSync(script, 'utf8');

test('local helper exists without extending the application', () => {
  assert.ok(fs.existsSync(script), 'the local-only PowerShell helper is missing');
});

test('entry is masked, has visible scope, and never offers a CLI password', () => {
  const text = source();
  const parameters = text.slice(0, text.indexOf('Set-StrictMode'));
  assert.match(parameters, /\$Account/);
  assert.match(parameters, /\$Folder/);
  assert.match(parameters, /\$AuthorizedFrom/);
  assert.match(parameters, /\$SelfTest/);
  assert.doesNotMatch(parameters, /\$(?:Password|Secret|Credential)\b/i);
  assert.match(text, /UseSystemPasswordChar\s*=\s*\$true/);
  const visible = text.replace(/\\u([a-f\d]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  assert.ok(visible.includes('\u90ae\u7bb1\u7f51\u9875\u767b\u5f55\u5bc6\u7801\u4e0d\u7528\u4fee\u6539'));
  assert.ok(visible.includes('\u5728\u6b64\u7c98\u8d34\u5ba2\u6237\u7aef\u5b89\u5168\u5bc6\u7801'));
  assert.ok(visible.includes('\u4ec5\u672c\u673a\u52a0\u5bc6\u4fdd\u5b58\uff0c\u4e0d\u4f1a\u81ea\u52a8\u8fde\u63a5\u90ae\u7bb1'));
  assert.match(text, /MaxLength\s*=\s*512/);
  assert.match(text, /\$Password\.Length -gt 512/);
  assert.match(text, /AutoScaleDimensions/);
  assert.match(text, /MaximumSize/);
  assert.match(text, /GetCommandLineArgs/);
});

test('whole JSON is encrypted and file creation cannot overwrite', () => {
  const text = source();
  assert.match(text, /HRM-Recruitment-Mail-v1/);
  assert.match(text, /ConvertTo-Json/);
  assert.match(text, /ProtectedData\]::Protect/);
  assert.match(text, /DataProtectionScope\]::CurrentUser/);
  assert.match(text, /FileMode\]::CreateNew/);
  assert.match(text, /SetAccessRuleProtection\(\$true,\s*\$false\)/);
  assert.match(text, /ReparsePoint/);
  assert.match(text, /SHA256/);
  assert.doesNotMatch(text, /WriteAllText|Set-Content|Out-File|ConvertFrom-SecureString/i);
});

test('no clipboard, network, subprocess, or raw exception output', () => {
  const text = source();
  assert.doesNotMatch(text, /Get-Clipboard|Set-Clipboard|\[.*Clipboard\]|Invoke-WebRequest|Invoke-RestMethod|Start-Process|SendKeys/i);
  assert.doesNotMatch(text, /Write-(?:Host|Output|Error|Verbose|Debug).*\$(?:password|json|payload|plain|bytes|_)/i);
  assert.doesNotMatch(text, /\$_\.(?:Exception|ScriptStackTrace)|Write-Error\s+\$_/i);
});

test('Windows offline SelfTest verifies real DPAPI, ACL, validation, and no overwrite', {
  skip: process.platform !== 'win32',
}, () => {
  assert.ok(fs.existsSync(script), 'the local-only PowerShell helper is missing');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-SelfTest',
  ], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `SelfTest failed: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '');
  const metadata = JSON.parse(result.stdout.trim());
  assert.equal(metadata.status, 'selfTestPassed');
  assert.equal(metadata.fixtureRemoved, true);
  const hash = createHash('sha256').update('fixture@example.invalid/Recruitment fixture', 'utf8').digest('hex');
  assert.equal(path.basename(metadata.profilePath), `${hash}.json.dpapi`);
  assert.deepEqual(metadata.checks, [
    'validation', 'utcDefault', 'stableFilename', 'testPathOnly', 'dpapiRoundTrip',
    'privateAcl', 'overwriteRefused', 'unsafeDirectoryRefused', 'reparseRefused',
  ]);
  assert.equal(fs.existsSync(metadata.profilePath), false);
  assert.doesNotMatch(result.stdout, /fictional-client-password|"password"\s*:/i);
});

test('custom profile paths are rejected before any form or credential access', {
  skip: process.platform !== 'win32',
}, () => {
  assert.ok(fs.existsSync(script));
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', script,
    '-Account', 'fixture@example.invalid', '-ProfilePath', path.join(__dirname, 'forbidden.json.dpapi'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout.trim()), { status: 'error', code: 'TEST_PATH_ONLY' });
  assert.equal(fs.existsSync(path.join(__dirname, 'forbidden.json.dpapi')), false);
});

test('invalid non-secret configuration fails before touching a real profile or showing UI', {
  skip: process.platform !== 'win32',
}, () => {
  const cases = [
    [[], 'INVALID_ACCOUNT'],
    [['-Account', 'a.@example.invalid'], 'INVALID_ACCOUNT'],
    [['-Account', `${'a'.repeat(65)}@example.invalid`], 'INVALID_ACCOUNT'],
    [['-Account', 'fixture@example.invalid', '-Folder', '../escape'], 'INVALID_FOLDER'],
    [['-Account', 'fixture@example.invalid', '-AuthorizedFrom', '2037-01-01T00:00:00+00:00'], 'INVALID_UTC_START'],
    [['-Account', 'fixture@example.invalid'], 'NONINTERACTIVE_FORM_REFUSED'],
    [['-SelfTest', '-ProfilePath', path.join(__dirname, 'forbidden.json.dpapi')], 'UNSAFE_TEST_PATH'],
  ];
  for (const [args, code] of cases) {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', script, ...args,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 1, `invalid configuration should return ${code}`);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout.trim()), { status: 'error', code });
  }
});

test('custom SelfTest path is confined to a fresh disposable fixture', {
  skip: process.platform !== 'win32',
}, () => {
  const hash = createHash('sha256').update('fixture@example.invalid/Recruitment fixture').digest('hex');
  const directory = path.join(tmpdir(), `hrm-recruitment-mail-selftest-${randomUUID().replaceAll('-', '')}`);
  const profilePath = path.join(directory, `${hash}.json.dpapi`);
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', script, '-SelfTest', '-ProfilePath', profilePath,
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stderr, '');
  const metadata = JSON.parse(result.stdout.trim());
  assert.equal(metadata.profilePath, profilePath);
  assert.equal(metadata.status, 'selfTestPassed');
  assert.equal(fs.existsSync(directory), false);
});
