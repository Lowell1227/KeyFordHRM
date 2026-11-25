'use strict';

const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { lstatSync } = require('node:fs');

function validateScope(scope) {
  if (typeof scope.account !== 'string' || scope.account.length > 254 || scope.account.includes('..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$/.test(scope.account) ||
    typeof scope.folder !== 'string' || !scope.folder.trim() || scope.folder !== scope.folder.trim() || scope.folder.length > 128 ||
    ['.', '..'].includes(scope.folder) || /[\\/:\x00-\x1f\x7f]/.test(scope.folder)) throw new Error('INVALID_SCOPE');
  return { account: scope.account.toLowerCase(), folder: scope.folder.normalize('NFC') };
}

function parseArguments(args) {
  if (args.length !== 4) throw new Error('EXPECTED_ACCOUNT_AND_FOLDER');
  const value = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--account': 'account', '--folder': 'folder' }[args[i]];
    if (!key || value[key] !== undefined) throw new Error('EXPECTED_ACCOUNT_AND_FOLDER');
    value[key] = args[i + 1];
  }
  return validateScope(value);
}

function profilePath(scope, home = os.homedir()) {
  const checked = validateScope(scope);
  const name = createHash('sha256').update(checked.account + '/' + checked.folder).digest('hex') + '.json.dpapi';
  return path.win32.join(home, '.codex', 'secrets', 'hrm-recruitment-mail', name);
}

const DECRYPT_SCRIPT = String.raw`
$ErrorActionPreference='Stop'; $plain=$null
try {
  Add-Type -AssemblyName System.Security
  $file=[Environment]::GetEnvironmentVariable('HRM_MAIL_PROFILE_PATH')
  $full=[IO.Path]::GetFullPath($file)
  if ($full -ne $file) { throw 'Invalid profile path' }
  $cursor=[IO.Path]::GetPathRoot($full)
  foreach($part in $full.Substring($cursor.Length).Split('\')) {
    $cursor=[IO.Path]::Combine($cursor,$part)
    if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid profile path' }
  }
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach($entry in @([IO.Path]::GetDirectoryName($file),$file)) {
    $acl=Get-Acl -LiteralPath $entry
    $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
      $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].IsInherited -or
      $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Invalid profile ACL' }
  }
  $length=([IO.FileInfo]$file).Length
  if ($length -lt 1 -or $length -gt 65536) { throw 'Invalid profile length' }
  $cipher=[IO.File]::ReadAllBytes($file)
  $entropy=[Text.Encoding]::ASCII.GetBytes('HRM-Recruitment-Mail-v1')
  $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
} catch { [Console]::Error.Write('LOCAL_PROFILE_UNAVAILABLE'); exit 1 }
finally { if($null -ne $plain) { [Array]::Clear($plain,0,$plain.Length) } }
`;

function validateProfile(value, scope) {
  const checked = validateScope(scope);
  const { isISO8601 } = require('../api/node_modules/class-validator');
  if (!value || Array.isArray(value) || value.version !== 1 || value.provider !== 'alimail' ||
    value.account !== checked.account || value.folder !== checked.folder ||
    typeof value.password !== 'string' || !value.password.trim() || value.password.length > 512 || /[\x00-\x1f\x7f]/.test(value.password) ||
    typeof value.authorizedFrom !== 'string' || !/Z$/.test(value.authorizedFrom) ||
    !isISO8601(value.authorizedFrom, { strict: true, strictSeparator: true })) throw new Error('APPROVED_SCOPE_MISMATCH');
  return value;
}

function windowsProfileEnvironment(file, parent = process.env) {
  return { ...parent, HRM_MAIL_PROFILE_PATH: file,
    PSModulePath: path.win32.join(parent.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') };
}

async function readProfile(scope) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_PROFILE_REQUIRED');
  const file = profilePath(scope);
  let text;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Invalid local profile');
    text = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DECRYPT_SCRIPT], {
      env: windowsProfileEnvironment(file), encoding: 'utf8', windowsHide: true,
      timeout: 20000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return validateProfile(JSON.parse(text), scope);
  } catch {
    throw new Error('LOCAL_PROFILE_UNAVAILABLE');
  } finally { text = undefined; }
}

function createAdapter(config) {
  const api = path.resolve(__dirname, '../api');
  require('../api/node_modules/ts-node').register({ project: path.join(api, 'tsconfig.json'), transpileOnly: true });
  require('../api/node_modules/tsconfig-paths').register({ baseUrl: api, paths: { '@/*': ['src/*'] } });
  const { AlimailRecruitmentAdapter } = require('../api/src/talent-pool/recruitment-alimail-adapter.ts');
  return new AlimailRecruitmentAdapter(config);
}

async function runProbe(scope, dependencies = {}) {
  const checked = validateScope(scope);
  let profile = validateProfile(await (dependencies.readProfile || readProfile)(checked), checked);
  try {
    const adapter = (dependencies.createAdapter || createAdapter)({ account: profile.account, folder: profile.folder,
      authorizedFrom: profile.authorizedFrom, password: profile.password });
    const result = await adapter.probe();
    if (result.readOnly !== true || !Number.isSafeInteger(result.messages) || result.messages < 0) throw new Error('Unexpected probe response');
    return { status: 'connected', folder: checked.folder, messages: result.messages, readOnly: true, imported: 0 };
  } catch {
    throw new Error('MAIL_CONNECT_FAILED');
  } finally { profile = undefined; }
}

module.exports = { parseArguments, profilePath, validateProfile, runProbe, DECRYPT_SCRIPT, windowsProfileEnvironment };
if (require.main === module) {
  Promise.resolve().then(() => runProbe(parseArguments(process.argv.slice(2)))).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    const safe = ['LOCAL_PROFILE_UNAVAILABLE', 'WINDOWS_PROFILE_REQUIRED', 'APPROVED_SCOPE_MISMATCH', 'MAIL_CONNECT_FAILED'];
    process.stdout.write(JSON.stringify({ status: 'not_connected', code: safe.includes(error.message) ? error.message : 'MAIL_PREFLIGHT_FAILED' }) + '\n');
    process.exitCode = 1;
  });
}
