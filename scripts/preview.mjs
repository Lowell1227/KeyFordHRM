import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import previewGuard from '../api/prisma/preview-guard.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateFile = resolve(root, '.env.preview.local');
const { offFlags } = previewGuard;
export const validatePreviewConfig = previewGuard.assertPreviewEnvironment;

export function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) throw new Error('Invalid preview configuration');
    result[match[1]] = match[2];
  }
  return result;
}

function writePrivateConfig(content) {
  const temporary = resolve(root, '.env.preview.next.local');
  writeFileSync(temporary, '', { flag: 'wx', mode: 0o600 });
  try {
    if (process.platform === 'win32') {
      const script = `$ErrorActionPreference='Stop'
$path='${temporary.replaceAll("'", "''")}'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
$acl.SetAccessRule($rule)
[System.IO.File]::SetAccessControl($path,$acl)
$actual=[System.IO.File]::GetAccessControl($path)
$rules=@($actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
if(-not $actual.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'Private ACL verification failed' }`;
      const acl = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8' });
      if (acl.status !== 0) throw new Error(`Cannot restrict preview secret file permissions: ${acl.error?.message || acl.stderr.slice(0, 1800)}`);
    } else chmodSync(temporary, 0o600);
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, privateFile);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function assertDevContainer(container, service) {
  const labels = container.Config.Labels;
  if (labels['com.docker.compose.project'] !== 'hrm' || labels['com.docker.compose.service'] !== service) {
    throw new Error(`Refusing non-development ${service} container`);
  }
}

function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    // SQL and environment values may contain secrets. Do not echo command input/output.
    throw new Error(`Docker ${args[0]} failed; inspect the local service safely before retrying`);
  }
  return result.stdout.trim();
}
const inspect = (name) => JSON.parse(docker(['inspect', name]))[0];
const containerEnv = (container) => Object.fromEntries(container.Config.Env.map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const productionIds = () => docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=kayford-deploy']).split(/\r?\n/).sort().join(',');
const hex = () => randomBytes(32).toString('hex');

async function startPreview() {
  const before = productionIds();
  const containers = Object.fromEntries(['api', 'web', 'postgres', 'redis', 'minio'].map((service) => {
    const item = inspect(`hrm-${service}-1`);
    assertDevContainer(item, service);
    return [service, item];
  }));
  const network = JSON.parse(docker(['network', 'inspect', 'hrm_internal']))[0];
  if (!network.Internal) throw new Error('Preview backend requires an internal-only network');
  const pgEnv = containerEnv(containers.postgres);
  const minioEnv = containerEnv(containers.minio);
  const oldApiEnv = containerEnv(containers.api);
  const sql = (query) => docker(['exec', '-i', 'hrm-postgres-1', 'psql', '-U', pgEnv.POSTGRES_USER, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], query);
  const databaseOwner = sql("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='hrm_preview';");
  let env;
  if (existsSync(privateFile)) {
    env = parseEnv(readFileSync(privateFile, 'utf8'));
    validatePreviewConfig(env);
  } else {
    if (databaseOwner || sql("SELECT rolname FROM pg_roles WHERE rolname='hrm_preview';")) {
      throw new Error('Existing preview database/role has no local ownership configuration; refusing to adopt it');
    }
    const redisPassword = oldApiEnv.REDIS_PASSWORD ?? '';
    env = {
      HRM_PREVIEW: 'true', NODE_ENV: 'development', PORT: '3000',
      DATABASE_URL: `postgresql://hrm_preview:${hex()}@postgres:5432/hrm_preview`,
      JWT_SECRET: hex(), JWT_EXPIRES_IN: '8h', EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: hex(), AI_PROVIDER_ENCRYPTION_KEY: hex(),
      ENABLE_TEST_QUICK_LOGIN: 'true',
      REDIS_HOST: 'redis', REDIS_PORT: '6379', REDIS_PASSWORD: redisPassword,
      REDIS_URL: `redis://:${encodeURIComponent(redisPassword)}@redis:6379/9`,
      MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false', MINIO_BUCKET: 'hrm-preview',
      MINIO_ACCESS_KEY: minioEnv.MINIO_ROOT_USER, MINIO_SECRET_KEY: minioEnv.MINIO_ROOT_PASSWORD,
      DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_CORP_ID: '', DINGTALK_AGENT_ID: '',
      DINGTALK_BOT_APP_KEY: '', DINGTALK_BOT_APP_SECRET: '', DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'false',
      DINGTALK_REDIRECT_URI: 'http://localhost:5173/auth/callback', DINGTALK_BOT_HRM_URL: '',
      ...Object.fromEntries(offFlags.map((key) => [key, 'false'])),
    };
  }
  if (databaseOwner && databaseOwner !== 'hrm_preview') throw new Error('Unexpected preview database owner');
  for (const service of ['api', 'web']) {
    const mount = containers[service].Mounts.find((item) => item.Destination === '/app/node_modules' && item.Type === 'volume');
    if (!mount) throw new Error(`Missing existing ${service} dependencies volume`);
    env[`PREVIEW_${service.toUpperCase()}_MODULES`] = mount.Name;
    env[`PREVIEW_${service.toUpperCase()}_IMAGE`] = containers[service].Image;
  }
  validatePreviewConfig(env);
  if (Object.values(env).some((value) => typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('Invalid environment value');
  writePrivateConfig(Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  const password = new URL(env.DATABASE_URL).password;
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid generated preview database password');
  if (!databaseOwner) {
    if (!sql("SELECT rolname FROM pg_roles WHERE rolname='hrm_preview';")) {
      sql(`CREATE ROLE hrm_preview LOGIN PASSWORD '${password}';`);
    }
    sql('CREATE DATABASE hrm_preview OWNER hrm_preview;');
  }
  console.log('Starting isolated preview API/Web; keeping existing infrastructure and production unchanged.');
  const compose = ['compose', '--env-file', '.env.preview.local', '-f', 'docker-compose.preview.yml', '-p', 'hrm'];
  docker([...compose, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'api']);
  docker([...compose, 'up', '-d', '--no-build', '--no-deps', 'web']);
  const deadline = Date.now() + 240000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:5173/api/v1/health', { signal: AbortSignal.timeout(4000) });
      const body = await response.json();
      if (response.ok && (body.status === 'ok' || body.data?.status === 'ok')) { ready = true; break; }
    } catch { /* API compilation and migrations may still be running. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
  }
  if (productionIds() !== before) throw new Error('Production container inventory changed during preview setup; investigate before continuing');
  if (!ready) throw new Error('Preview not healthy yet. Check hrm-api-1 logs; production was not restarted.');
  console.log('Preview ready: http://localhost:5173 (fictional data, local-only). Production container IDs unchanged.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const lock = resolve(root, '.preview-start.lock.local');
  let descriptor;
  try {
    descriptor = openSync(lock, 'wx', 0o600);
  } catch {
    console.error('Preview startup is locked. Wait for the existing run; inspect a stale lock before removing it.');
    process.exit(1);
  }
  const keepAlive = setInterval(() => {}, 1000);
  startPreview().catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => { clearInterval(keepAlive); closeSync(descriptor); unlinkSync(lock); });
}
