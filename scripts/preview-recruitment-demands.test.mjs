import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

const preview = await import('./preview-recruitment-demands.mjs').catch(() => null);
const root = resolve('.');
const env = {
  HRM_PREVIEW: 'true', NODE_ENV: 'development', DATABASE_URL: 'postgresql://hrm_preview:fictional@postgres:5432/hrm_preview',
  REDIS_URL: 'redis://redis:6379/9', MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false', MINIO_BUCKET: 'hrm-preview',
  ENABLE_TEST_QUICK_LOGIN: 'true', JWT_SECRET: 'a'.repeat(64), EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: 'b'.repeat(64),
  DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'false',
  DINGTALK_BOT_STREAM_ENABLED: 'false', ARCHIVE_ASSISTANT_PILOT_ENABLED: 'false',
};
function container(changes = {}) {
  return { Config: { Labels: { 'com.docker.compose.project': 'hrm', 'com.docker.compose.service': 'api' },
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`) }, Mounts: [{ Destination: '/app', Source: resolve(root, 'api') }], ...changes };
}
test('fixture launcher requires its scoped validation entrypoint', () => assert.equal(typeof preview?.assertRecruitmentPreviewTarget, 'function'));
test('allows only guarded fictional preview source', () => preview.assertRecruitmentPreviewTarget(container(), root));
test('rejects production project even with fictional-looking environment', () => {
  const row = container(); row.Config.Labels['com.docker.compose.project'] = 'kayford-deploy';
  assert.throws(() => preview.assertRecruitmentPreviewTarget(row, root));
});
test('rejects another worktree source rather than replacing its preview', () => {
  assert.throws(() => preview.assertRecruitmentPreviewTarget(container({ Mounts: [{ Destination: '/app', Source: resolve(root, '../other/api') }] }), root));
});
test('rejects external credentials and notification configuration', () => {
  for (const value of ['DINGTALK_APP_KEY=fictional-nonempty', 'DINGTALK_INTERVIEW_CALENDAR_ENABLED=true']) {
    const row = container(); row.Config.Env.push(value);
    assert.throws(() => preview.assertRecruitmentPreviewTarget(row, root));
  }
});
