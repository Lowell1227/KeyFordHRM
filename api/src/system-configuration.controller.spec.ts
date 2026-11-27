import { ConfigService } from '@nestjs/config';
import { SysRole } from '@prisma/client';
import { SystemConfigurationController } from './system-configuration.controller';
import { AiConfigService } from './ai-progress/ai-config.service';
import { NotificationSettingsService } from './notifications/notification-settings.service';
import { DingtalkRecruitmentService } from './dingtalk/dingtalk-recruitment.service';
import { RecruitmentMailboxGateway } from './talent-pool/recruitment-mail-gateway';
import { ROLES_KEY } from './common/decorators/roles.decorator';

function setup(env: Record<string, string> = {}, aiFailure = false) {
  const ai = { getPublicState: jest.fn(async () => {
    if (aiFailure) throw new Error('private failure');
    return { encryptionReady: true, activeProvider: null, botEnabled: false, providers: [
      { provider: 'deepseek', configured: true, tested: true, testedAt: '2026-11-26T04:00:00.000Z' },
      { provider: 'qwen', configured: false, tested: false, testedAt: null },
    ] };
  }) };
  const notifications = { getDingtalkSettings: jest.fn(async () => ({ enabled: false, available: false, effectiveEnabled: false })) };
  const recruitment = { status: jest.fn(() => ({ configured: false })) };
  const mailbox = { status: jest.fn(() => ({ configured: false })) };
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  return new SystemConfigurationController(config, ai as unknown as AiConfigService,
    notifications as unknown as NotificationSettingsService, recruitment as unknown as DingtalkRecruitmentService,
    mailbox as unknown as RecruitmentMailboxGateway);
}

it('restricts configuration metadata to system administrators', () => {
  expect(Reflect.getMetadata(ROLES_KEY, SystemConfigurationController)).toEqual([SysRole.system_admin]);
});

it('reports field presence independently of verification and switches and omits all credential values', async () => {
  const result = await setup({
    DINGTALK_APP_KEY: 'fictional-app-key', DINGTALK_APP_SECRET: 'fictional-secret',
    RECRUITMENT_MAIL_CONFIG_FILE: '/private/fictional-location', AI_RESUME_PARSING_ENABLED: 'false',
  }).getStatus();
  const row = (id: string) => result.find(item => item.id === id);
  expect(row('ai-resume')).toMatchObject({ verification: 'passed', enabled: false, fields: expect.arrayContaining([
    { label: 'API Key', state: 'present' },
  ]) });
  expect(row('dingtalk-login')).toMatchObject({ verification: 'unknown', fields: expect.arrayContaining([
    { label: 'AppKey', state: 'present' }, { label: 'AppSecret', state: 'present' },
  ]) });
  expect(row('recruitment-mail')).toMatchObject({ enabled: false, verification: 'unknown', fields: expect.arrayContaining([
    { label: '邮箱配置文件', state: 'present' }, { label: '邮箱账号和授权', state: 'unknown' },
  ]) });
  expect(JSON.stringify(result)).not.toMatch(/fictional|encryptedKey|allowlist/);
});

it('reports unavailable metadata as unknown without hiding other domains', async () => {
  const result = await setup({}, true).getStatus();
  expect(result.find(row => row.id === 'ai-resume')).toMatchObject({ verification: 'unknown', fields: expect.arrayContaining([
    { label: 'API Key', state: 'unknown' },
  ]) });
  expect(result.find(row => row.id === 'recruitment-mail')).toBeDefined();
  expect(JSON.stringify(result)).not.toContain('private failure');
});
