import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SysRole } from '@prisma/client';
import { Roles } from './common/decorators/roles.decorator';
import { AiConfigService } from './ai-progress/ai-config.service';
import { DingtalkRecruitmentService } from './dingtalk/dingtalk-recruitment.service';
import { NotificationSettingsService } from './notifications/notification-settings.service';
import { RecruitmentMailboxGateway } from './talent-pool/recruitment-mail-gateway';

type FieldState = 'present' | 'missing' | 'unknown' | 'managed';
type Verification = 'unknown' | 'untested' | 'passed' | 'failed';
type ConfigurationField = { label: string; state: FieldState };
type ConfigurationStatus = {
  id: string;
  fields: ConfigurationField[];
  verification: Verification;
  verifiedAt: Date | string | null;
  enabled: boolean | null;
};

const field = (label: string, present: boolean | null): ConfigurationField => ({
  label,
  state: present === null ? 'unknown' : present ? 'present' : 'missing',
});

@Controller('system/configuration-status')
@Roles(SysRole.system_admin)
export class SystemConfigurationController {
  constructor(
    private readonly config: ConfigService,
    private readonly ai: AiConfigService,
    private readonly notifications: NotificationSettingsService,
    private readonly recruitment: DingtalkRecruitmentService,
    private readonly mailbox: RecruitmentMailboxGateway,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, private')
  async getStatus(): Promise<ConfigurationStatus[]> {
    const [ai, notifications] = await Promise.all([
      this.ai.getPublicState().catch(() => null),
      this.notifications.getDingtalkSettings().catch(() => null),
    ]);
    const dingFields = [this.envField('AppKey', 'DINGTALK_APP_KEY'), this.envField('AppSecret', 'DINGTALK_APP_SECRET')];
    const corp = this.envField('企业 ID', 'DINGTALK_CORP_ID');
    const mailEnabled = this.flag('RECRUITMENT_MAIL_ENABLED');
    const file = this.envField('邮箱配置文件', 'RECRUITMENT_MAIL_CONFIG_FILE');
    const recruitment = this.recruitment.status();
    const aiStatus = (id: string, provider: string, enabled: boolean | null): ConfigurationStatus => {
      const summary = ai?.providers.find(item => item.provider === provider);
      return {
        id, fields: [{ label: 'API 地址', state: 'managed' }, field('API Key', summary?.configured ?? null),
          field('凭据加密', ai?.encryptionReady ?? null)],
        verification: !summary ? 'unknown' : summary.tested ? 'passed' : summary.testedAt ? 'failed' : 'untested',
        verifiedAt: summary?.testedAt ?? null, enabled,
      };
    };
    const deployment = (id: string, fields: ConfigurationField[], enabled: boolean | null = null): ConfigurationStatus =>
      ({ id, fields, verification: 'unknown', verifiedAt: null, enabled });

    return [
      aiStatus('ai-progress-kimi', 'kimi', ai ? ai.activeProvider === 'kimi' && ai.botEnabled : null),
      aiStatus('ai-progress-deepseek', 'deepseek', ai ? ai.activeProvider === 'deepseek' && ai.botEnabled : null),
      aiStatus('ai-progress-qwen', 'qwen', ai ? ai.activeProvider === 'qwen' && ai.botEnabled : null),
      aiStatus('ai-resume', 'deepseek', this.flag('AI_RESUME_PARSING_ENABLED')),
      deployment('dingtalk-login', [...dingFields, corp]),
      deployment('dingtalk-notifications', [...dingFields, this.envField('Agent ID', 'DINGTALK_AGENT_ID')],
        notifications?.effectiveEnabled ?? null),
      deployment('dingtalk-calendar', dingFields, this.flag('DINGTALK_INTERVIEW_CALENDAR_ENABLED')),
      deployment('recruitment-demand', [
        ...dingFields, corp, this.envField('审批表单', 'DINGTALK_RECRUITMENT_PROCESS_CODE'),
        this.envField('部门字段', 'DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID'),
        this.envField('岗位字段', 'DINGTALK_RECRUITMENT_POSITION_CONTROL_ID'),
        this.envField('人数字段', 'DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID'),
        this.envField('读取范围证明', 'DINGTALK_RECRUITMENT_VERIFIED_SCOPE'),
      ], recruitment.configured),
      deployment('recruitment-mail', [
        file, field('邮箱账号和授权', this.mailbox.status().configured ? true : file.state === 'missing' ? false : null),
      ], mailEnabled),
      deployment('payroll-attendance', [...dingFields, corp], this.flag('DINGTALK_ATTENDANCE_SYNC_ENABLED')),
      deployment('payroll-access', [], this.flag('PAYROLL_ENABLED') && this.flag('PAYROLL_FORMAL_ENABLED')),
    ];
  }

  private envField(label: string, key: string): ConfigurationField {
    const value = this.config.get<unknown>(key);
    return field(label, typeof value === 'string' && Boolean(value.trim()));
  }

  private flag(key: string): boolean {
    const value = this.config.get<unknown>(key);
    return value === 'true' || value === true;
  }
}
