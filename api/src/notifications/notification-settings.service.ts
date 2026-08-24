import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

export interface DingtalkNotificationSettings {
  available: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
}

@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getDingtalkSettings(): Promise<DingtalkNotificationSettings> {
    const setting = await this.prisma.systemConfig.findUnique({
      where: { key: 'dingtalk_notification_enabled' },
      select: { value: true },
    });
    const available = this.isPlatformAvailable();
    const enabled = setting?.value === true;
    return { available, enabled, effectiveEnabled: available && enabled };
  }

  async updateDingtalkSettings(enabled: boolean, operatorId: string): Promise<DingtalkNotificationSettings> {
    const available = this.isPlatformAvailable();
    if (enabled && !available) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '钉钉通知通道尚未配置完成，暂时不能开启',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.systemConfig.upsert({
        where: { key: 'dingtalk_notification_enabled' },
        create: {
          key: 'dingtalk_notification_enabled',
          value: enabled,
          description: '绩效钉钉通知业务总开关；关闭时仅保留系统站内通知',
          updatedBy: operatorId,
        },
        update: { value: enabled, updatedBy: operatorId, updatedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'dingtalk_notification_setting_updated',
          entityType: 'system_config',
          entityId: null,
          newValue: { configKey: 'dingtalk_notification_enabled', enabled },
        },
      });
    });

    return { available, enabled, effectiveEnabled: available && enabled };
  }

  private isPlatformAvailable(): boolean {
    return this.config.get<string>('DINGTALK_NOTIFICATION_ENABLED', 'false') === 'true'
      && Boolean(this.config.get<string>('DINGTALK_APP_KEY'))
      && Boolean(this.config.get<string>('DINGTALK_APP_SECRET'))
      && Boolean(this.config.get<string>('DINGTALK_AGENT_ID'));
  }
}
