import { Inject } from '@nestjs/common';
import { RuntimeSettingsService } from '@/system-configuration/runtime-settings.service';
import { Controller, Get, Header, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SysRole } from '@prisma/client';
import { Roles } from './common/decorators/roles.decorator';
import { AiConfigService } from './ai-progress/ai-config.service';
import { DingtalkRecruitmentService } from './dingtalk/dingtalk-recruitment.service';
import { NotificationSettingsService } from './notifications/notification-settings.service';
import { RecruitmentMailboxGateway } from './talent-pool/recruitment-mail-gateway';
import { CurrentUser } from './common/decorators/current-user.decorator';
import { AuthUser } from './common/types/auth.types';
import { SystemConfigurationsService } from './system-configuration/system-configurations.service';

type FieldState = 'present' | 'missing' | 'unknown' | 'managed';
type Verification = 'unknown' | 'untested' | 'passed' | 'failed';
type ConfigurationField = { label: string; state: FieldState };
type ConfigurationStatus = {
  id: string;
  fields: ConfigurationField[];
  verification: Verification;
  verifiedAt: Date | string | null;
  enabled: boolean | null;
  revision?: number | null;
  appliedRevision?: number | null;
  ready?: boolean;
  testKind?: string;
  verificationMessage?: string;
  configuredCount?: number;
  enabledCount?: number;
};

const field = (label: string, present: boolean | null): ConfigurationField => ({
  label,
  state: present === null ? 'unknown' : present ? 'present' : 'missing',
});

@Controller('system/configuration-status')
@Roles(SysRole.system_admin)
export class SystemConfigurationController {
  constructor(
    @Inject(RuntimeSettingsService) private readonly config: ConfigService,
    private readonly ai: AiConfigService,
    private readonly notifications: NotificationSettingsService,
    private readonly recruitment: DingtalkRecruitmentService,
    private readonly mailbox: RecruitmentMailboxGateway,
    @Optional() private readonly editors?: SystemConfigurationsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, private')
  async getStatus(@CurrentUser() user?: AuthUser): Promise<ConfigurationStatus[]> {
    const editorViews = this.editors && user ? await this.editors.status(user.id) : [];
    const [ai, notifications] = await Promise.all([
      this.ai.getPublicState().catch(() => null),
      this.notifications.getDingtalkSettings().catch(() => null),
    ]);
    const dingFields = [this.envField('AppKey', 'DINGTALK_APP_KEY'), this.envField('AppSecret', 'DINGTALK_APP_SECRET')];
    const corp = this.envField('企业 ID', 'DINGTALK_CORP_ID');
    const mailEnabled = this.flag('RECRUITMENT_MAIL_ENABLED');
    const file = this.envField('邮箱配置文件', 'RECRUITMENT_MAIL_CONFIG_FILE');
    let recruitment: { configured: boolean };
    try { recruitment = this.recruitment.status(); } catch { recruitment = { configured: false }; }
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

    const result: ConfigurationStatus[] = [
      aiStatus('ai-progress-kimi', 'kimi', ai ? ai.activeProvider === 'kimi' && ai.botEnabled : null),
      aiStatus('ai-progress-deepseek', 'deepseek', ai ? ai.activeProvider === 'deepseek' && ai.botEnabled : null),
      aiStatus('ai-progress-qwen', 'qwen', ai ? ai.activeProvider === 'qwen' && ai.botEnabled : null),
      aiStatus('ai-resume', 'deepseek', this.flag('AI_RESUME_PARSING_ENABLED')),
      deployment('dingtalk-login', [...dingFields, corp],
        typeof this.editors?.publicLogin === 'function' ? this.editors.publicLogin().enabled : null),
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
    for (const item of result) {
      const view = editorViews.find(entry => entry.id === (item.id === 'dingtalk-login' ? 'dingtalk-app' : item.id));
      if (!view) continue;
      Object.assign(item, { revision: view.revision, appliedRevision: view.appliedRevision, verification: view.verification, verifiedAt: view.verifiedAt, testKind: view.testKind, verificationMessage: view.verificationMessage,
        ready: item.fields.every(value => value.state === 'present' || value.state === 'managed') && item.enabled !== false && view.verification === 'passed' });
      if (item.id === 'ai-resume' && !ai?.providers.find(provider => provider.provider === 'deepseek')?.tested) {
        item.ready = false;
        item.verification = 'untested';
        item.verificationMessage = 'DeepSeek 当前凭据尚未核验通过，请先完成 AI 服务配置';
      }
    }
    if (typeof this.mailbox.choices === 'function') {
      const choices = this.mailbox.choices(), mail = result.find(item => item.id === 'recruitment-mail')!;
      const configuredCount = choices.filter(item => item.configured).length, enabledCount = choices.filter(item => item.enabled && item.configured).length;
      Object.assign(mail, { configuredCount, enabledCount, fields: [field('邮箱账号和指定目录', configuredCount > 0)], enabled: enabledCount > 0, ready: enabledCount > 0,
        verificationMessage: `已配置 ${configuredCount} 个邮箱，已启用 ${enabledCount} 个；各邮箱核验与同步状态请进入维护页查看` });
    }
    return result;
  }

  private envField(label: string, key: string): ConfigurationField {
    try { const value = this.config.get<unknown>(key); return field(label, typeof value === 'string' && Boolean(value.trim())); }
    catch { return field(label, null); }
  }

  private flag(key: string): boolean {
    try { const value = this.config.get<unknown>(key); return value === 'true' || value === true; }
    catch { return false; }
  }
}
