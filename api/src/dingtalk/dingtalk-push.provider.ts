import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { MessagePushProvider, MessagePushInput, MessagePushResult } from '@/notifications/message-push.provider';
import { DingtalkService } from './dingtalk.service';

/**
 * 钉钉工作通知推送实现。
 *
 * 无凭证 / 用户未绑定钉钉 / 钉钉 API 报错时均抛出异常，
 * 由调用方（NotificationsService）将 notification_logs 状态记为 failed。
 * 若调用方传入 notificationId，本 Provider 也会自行回写结果。
 */
@Injectable()
export class DingtalkPushProvider implements MessagePushProvider {
  private readonly logger = new Logger(DingtalkPushProvider.name);

  constructor(
    private readonly dingtalk: DingtalkService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async push(input: MessagePushInput): Promise<MessagePushResult> {
    const notificationEnabled = this.config.get<string>('DINGTALK_NOTIFICATION_ENABLED', 'false') === 'true';
    if (!notificationEnabled) {
      this.logger.debug('[DingtalkPushProvider] external notification is disabled');
      return { channel: 'system' };
    }

    const externallyAllowed = await this.isExternallyAllowed(input);
    if (!externallyAllowed) {
      this.logger.debug(`[DingtalkPushProvider] notification policy kept ${input.type} in system inbox`);
      return { channel: 'system' };
    }

    this.logger.debug(`[DingtalkPushProvider] push invoked for userId=${input.userId}`);
    const { notificationId, userId, dingtalkId, title, content, url } = input;

    let resolvedDingtalkId = dingtalkId;

    // 若调用方未传 dingtalkId，从本地用户表补查
    if (!resolvedDingtalkId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { dingtalkId: true },
      });
      resolvedDingtalkId = user?.dingtalkId ?? null;
    }

    if (!resolvedDingtalkId) {
      const errorMsg = `用户 ${userId} 未绑定钉钉账号，无法发送工作通知`;
      await this.markFailed(notificationId, errorMsg);
      throw new Error(errorMsg);
    }

    try {
      await this.dingtalk.sendWorkNotification(resolvedDingtalkId, title, content, url);
      await this.markSent(notificationId);
      return { channel: 'dingtalk' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`钉钉工作通知发送失败(userId=${userId}): ${errorMsg}`);
      await this.markFailed(notificationId, errorMsg);
      throw err;
    }
  }

  private async isExternallyAllowed(input: MessagePushInput): Promise<boolean> {
    if (!input.cycleId) return false;

    const [setting, cycle] = await Promise.all([
      this.prisma.systemConfig.findUnique({
        where: { key: 'dingtalk_notification_enabled' },
        select: { value: true },
      }),
      this.prisma.assessmentCycle.findUnique({
        where: { id: input.cycleId },
        select: { notificationMode: true },
      }),
    ]);
    if (setting?.value !== true || !cycle) return false;

    if (cycle.notificationMode === 'launch_only') {
      return input.type === 'indicator_setting_notice';
    }
    if (cycle.notificationMode === 'launch_and_reminders') {
      return ['indicator_setting_notice', 'task_reminder'].includes(input.type);
    }
    return false;
  }

  private async markSent(notificationId?: string): Promise<void> {
    if (!notificationId) return;
    try {
      await this.prisma.notificationLog.update({
        where: { id: notificationId },
        data: { status: 'sent', sentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`回写通知成功状态失败 ${notificationId}`, err);
    }
  }

  private async markFailed(notificationId: string | undefined, errorMsg: string): Promise<void> {
    if (!notificationId) return;
    try {
      await this.prisma.notificationLog.update({
        where: { id: notificationId },
        data: { status: 'failed', errorMsg },
      });
    } catch (err) {
      this.logger.error(`回写通知失败状态失败 ${notificationId}`, err);
    }
  }
}
