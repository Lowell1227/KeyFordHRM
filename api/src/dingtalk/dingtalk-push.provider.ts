import { Injectable, Logger } from '@nestjs/common';
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
  ) {}

  async push(input: MessagePushInput): Promise<MessagePushResult> {
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
