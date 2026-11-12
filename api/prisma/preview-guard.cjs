const offFlags = ['DINGTALK_NOTIFICATION_ENABLED', 'DINGTALK_INTERVIEW_CALENDAR_ENABLED',
  'DINGTALK_BOT_STREAM_ENABLED', 'ARCHIVE_ASSISTANT_PILOT_ENABLED'];

function assertPreviewEnvironment(env) {
  const db = new URL(env.DATABASE_URL);
  const redis = new URL(env.REDIS_URL);
  if (env.HRM_PREVIEW !== 'true' || env.NODE_ENV !== 'development'
    || db.protocol !== 'postgresql:' || db.hostname !== 'postgres' || db.port !== '5432'
    || db.pathname !== '/hrm_preview' || db.username !== 'hrm_preview' || db.search || db.hash
    || redis.protocol !== 'redis:' || redis.hostname !== 'redis' || redis.port !== '6379'
    || redis.pathname !== '/9' || redis.search || redis.hash
    || env.MINIO_ENDPOINT !== 'minio' || env.MINIO_PORT !== '9000' || env.MINIO_USE_SSL !== 'false'
    || env.MINIO_BUCKET !== 'hrm-preview' || env.ENABLE_TEST_QUICK_LOGIN !== 'true'
    || !/^[a-f0-9]{64}$/.test(env.JWT_SECRET ?? '')
    || !/^[a-f0-9]{64}$/.test(env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY ?? '')
    || offFlags.some((key) => env[key] !== 'false')
    || Object.entries(env).some(([key, value]) => /DINGTALK_.*(SECRET|APP_KEY|CORP_ID|AGENT_ID)$/.test(key) && value)) {
    throw new Error('Refusing non-isolated preview configuration');
  }
}

module.exports = { assertPreviewEnvironment, offFlags };

if (require.main === module) {
  try {
    assertPreviewEnvironment(process.env);
  } catch {
    console.error('Preview isolation guard refused startup before migrations.');
    process.exitCode = 1;
  }
}
