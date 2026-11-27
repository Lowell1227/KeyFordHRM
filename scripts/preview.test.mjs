import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validatePreviewConfig, assertDevContainer, parseEnv, reuseRunningPreviewConfig } from './preview.mjs';

const valid = () => ({
  HRM_PREVIEW: 'true', NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://hrm_preview:fixture@postgres:5432/hrm_preview',
  REDIS_URL: 'redis://:fixture@redis:6379/9', MINIO_BUCKET: 'hrm-preview',
  MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false',
  JWT_SECRET: 'a'.repeat(64), EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: 'b'.repeat(64),
  ENABLE_TEST_QUICK_LOGIN: 'true',
  DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'false',
  DINGTALK_BOT_STREAM_ENABLED: 'false', ARCHIVE_ASSISTANT_PILOT_ENABLED: 'false',
});

test('the container refuses a non-preview environment before running migrations', () => {
  const result = spawnSync(process.execPath, ['api/prisma/preview-guard.cjs'], {
    env: { ...process.env, ...valid(), HRM_PREVIEW: 'false' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /before migrations/);
  const compose = readFileSync('docker-compose.preview.yml', 'utf8');
  assert.ok(compose.indexOf('node prisma/preview-guard.cjs') < compose.indexOf('prisma migrate deploy'));
});

test('preview config accepts only isolated data and disabled integrations', () => {
  assert.doesNotThrow(() => validatePreviewConfig(valid()));
  for (const change of [
    { DATABASE_URL: 'postgresql://hrm_preview:fixture@postgres:5432/kayford_perf' },
    { DATABASE_URL: 'postgresql://postgres:fixture@postgres:5432/hrm_preview' },
    { REDIS_URL: 'redis://redis:6379/0' }, { MINIO_BUCKET: 'kayford-perf' },
    { NODE_ENV: 'production' }, { HRM_PREVIEW: 'false' },
    { DINGTALK_NOTIFICATION_ENABLED: 'true' }, { DINGTALK_APP_SECRET: 'real-secret' },
    { DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'true' }, { JWT_SECRET: 'short' },
  ]) assert.throws(() => validatePreviewConfig({ ...valid(), ...change }));
});

test('container checks reject production and unrelated services', () => {
  const container = (project, service) => ({ Config: { Labels: {
    'com.docker.compose.project': project, 'com.docker.compose.service': service,
  } } });
  assert.doesNotThrow(() => assertDevContainer(container('hrm', 'api'), 'api'));
  assert.throws(() => assertDevContainer(container('kayford-deploy', 'api'), 'api'));
  assert.throws(() => assertDevContainer(container('hrm', 'postgres'), 'api'));
});

test('private generated env parsing does not evaluate shell syntax', () => {
  assert.deepEqual(parseEnv('# comment\nA=one=two\nB=\n'), { A: 'one=two', B: '' });
  assert.throws(() => parseEnv('not an env assignment'));
});

test('explicit preview reuse needs the original isolated running environment, database owner and fictional marker', () => {
  const input = { ...valid(), AI_PROVIDER_ENCRYPTION_KEY: 'a'.repeat(43) + '=', UNRELATED_SECRET: 'not-copied' };
  const result = reuseRunningPreviewConfig(input, 'hrm_preview', true);
  assert.equal(result.JWT_SECRET, input.JWT_SECRET);
  assert.equal(result.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY, input.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY);
  assert.equal(result.UNRELATED_SECRET, undefined);
  assert.equal(result.RECRUITMENT_MAIL_ENABLED, 'false');
  assert.equal(result.AI_RESUME_PARSING_ENABLED, 'false');
  assert.throws(() => reuseRunningPreviewConfig(input, 'postgres', true));
  assert.throws(() => reuseRunningPreviewConfig(input, 'hrm_preview', false));
  assert.throws(() => reuseRunningPreviewConfig({ ...input, NODE_ENV: 'production' }, 'hrm_preview', true));
});
