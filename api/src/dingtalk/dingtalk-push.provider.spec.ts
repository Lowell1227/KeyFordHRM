import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { DingtalkPushProvider } from './dingtalk-push.provider';
import { DingtalkService } from './dingtalk.service';

describe('DingtalkPushProvider', () => {
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    dingtalkId: 'ding-user-1',
    title: '季度目标制定已开放',
    content: '请填写目标',
  };

  function createProvider(notificationEnabled?: string) {
    const dingtalk = {
      sendWorkNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as DingtalkService;
    const prisma = {
      user: { findUnique: jest.fn() },
      notificationLog: { update: jest.fn() },
    } as unknown as PrismaService;
    const config = new ConfigService(
      notificationEnabled === undefined
        ? {}
        : { DINGTALK_NOTIFICATION_ENABLED: notificationEnabled },
    );

    return {
      provider: new DingtalkPushProvider(dingtalk, prisma, config),
      sendWorkNotification: dingtalk.sendWorkNotification as jest.Mock,
    };
  }

  it('keeps external DingTalk notifications disabled when the flag is unset', async () => {
    const { provider, sendWorkNotification } = createProvider();

    await expect(provider.push(input)).resolves.toEqual({ channel: 'system' });
    expect(sendWorkNotification).not.toHaveBeenCalled();
  });

  it('sends a DingTalk work notification only when explicitly enabled', async () => {
    const { provider, sendWorkNotification } = createProvider('true');

    await expect(provider.push(input)).resolves.toEqual({ channel: 'dingtalk' });
    expect(sendWorkNotification).toHaveBeenCalledWith(
      input.dingtalkId,
      input.title,
      input.content,
      undefined,
    );
  });
});
