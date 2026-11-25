const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArguments, profilePath, validateProfile, runProbe, DECRYPT_SCRIPT } = require('./probe-recruitment-mail.cjs');

const scope = { account: 'hr@example.invalid', folder: 'Recruitment fixture' };
const credential = { version: 1, provider: 'alimail', ...scope, authorizedFrom: '2037-01-01T00:00:00.000Z', password: 'fictional-client-password' };

test('probe takes scope metadata, never a password or arbitrary credential path', () => {
  assert.deepEqual(parseArguments(['--account', scope.account, '--folder', scope.folder]), scope);
  for (const args of [[], ['--password', 'not-accepted'], ['--profile', 'other-file'], ['--account', scope.account],
    ['--account', 'display <hr@example.invalid>', '--folder', 'fixture'], ['--account', scope.account, '--folder', '../INBOX']]) {
    assert.throws(() => parseArguments(args));
  }
});
test('profile path is deterministic and remains in the current-user credential directory', () => {
  const file = profilePath(scope, 'C:\\Users\\Fixture');
  assert.match(path.win32.basename(file), /^[a-f0-9]{64}\.json\.dpapi$/);
  assert.equal(file, profilePath({ ...scope, account: 'HR@EXAMPLE.INVALID' }, 'C:\\Users\\Fixture'));
  assert.equal(path.win32.dirname(file), 'C:\\Users\\Fixture\\.codex\\secrets\\hrm-recruitment-mail');
});
test('profile validation binds the supplied scope and does not expose malformed contents', () => {
  assert.deepEqual(validateProfile(credential, scope), credential);
  for (const patch of [{ account: 'other@example.invalid' }, { folder: 'INBOX' }, { version: 2 }, { provider: 'other' }, { password: '' }]) {
    assert.throws(() => validateProfile({ ...credential, ...patch }, scope), error => !error.message.includes(credential.password));
  }
});
test('connection probe does not call readPage, import or return a client secret', async () => {
  let called = 0;
  const result = await runProbe(scope, { readProfile: async () => credential, createAdapter: config => {
    assert.equal(config.password, credential.password);
    return { probe: async () => { called++; return { readOnly: true, messages: 0 }; }, readPage: () => { throw new Error('Must not read messages'); } };
  } });
  assert.equal(called, 1); assert.deepEqual(result, { status: 'connected', folder: scope.folder, messages: 0, readOnly: true, imported: 0 });
  assert.equal(JSON.stringify(result).includes(credential.password), false);
});
test('connection failures remain redacted and never fall back to another scope', async () => {
  await assert.rejects(runProbe(scope, { readProfile: async () => credential, createAdapter: () => ({ probe: async () => { throw new Error(credential.password); } }) }),
    error => !error.message.includes(credential.password));
  let connected = false;
  await assert.rejects(runProbe(scope, { readProfile: async () => ({ ...credential, folder: 'Other mailbox' }), createAdapter: () => { connected = true; return {}; } }));
  assert.equal(connected, false);
});
test('DPAPI subprocess is current-user-only, bounds input, checks ACL and never accepts a secret argument', () => {
  assert.match(DECRYPT_SCRIPT, /DataProtectionScope\]::CurrentUser/);
  assert.match(DECRYPT_SCRIPT, /AreAccessRulesProtected/);
  assert.match(DECRYPT_SCRIPT, /ReparsePoint/);
  assert.match(DECRYPT_SCRIPT, /HRM-Recruitment-Mail-v1/);
  assert.match(DECRYPT_SCRIPT, /65536/);
  assert.match(DECRYPT_SCRIPT, /Array\]::Clear/);
  assert.doesNotMatch(DECRYPT_SCRIPT, /Read-Host|Get-Clipboard|Set-Clipboard|Write-Host/);
});
test('CLI rejects an unsupported secret argument with a redacted JSON result', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'probe-recruitment-mail.cjs'), '--password', 'fictional-never-accepted'], {encoding:'utf8'});
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {status:'not_connected',code:'MAIL_PREFLIGHT_FAILED'});
});
