import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { DingtalkPushProvider } from './dingtalk-push.provider';
import { DingtalkService } from './dingtalk.service';

describe('DingtalkPushProvider', () => {
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    dingtalkId: 'ding-user-1',
    cycleId: '22222222-2222-4222-8222-222222222222',
    type: 'indicator_setting_notice',
    title: '季度目标制定已开放',
    content: '请填写目标',
  };

  function createProvider(options: {
    platformEnabled?: string;
    systemEnabled?: boolean;
    cycleMode?: 'off' | 'launch_only' | 'launch_and_reminders';
  } = {}) {
    const dingtalk = {
      sendWorkNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as DingtalkService;
    const prisma = {
      user: { findUnique: jest.fn() },
      notificationLog: { update: jest.fn() },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(
          options.systemEnabled === undefined ? null : { value: options.systemEnabled },
        ),
      },
      assessmentCycle: {
        findUnique: jest.fn().mockResolvedValue(
          options.cycleMode === undefined ? null : { notificationMode: options.cycleMode },
        ),
      },
    } as unknown as PrismaService;
    const config = new ConfigService(
      options.platformEnabled === undefined
        ? {}
        : { DINGTALK_NOTIFICATION_ENABLED: options.platformEnabled },
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

  it('keeps external DingTalk notifications disabled when the visible system switch is off', async () => {
    const { provider, sendWorkNotification } = createProvider({
      platformEnabled: 'true',
      systemEnabled: false,
      cycleMode: 'launch_and_reminders',
    });

    await expect(provider.push(input)).resolves.toEqual({ channel: 'system' });
    expect(sendWorkNotification).not.toHaveBeenCalled();
  });

  it('sends the formal launch notice once for a launch-only cycle', async () => {
    const { provider, sendWorkNotification } = createProvider({
      platformEnabled: 'true',
      systemEnabled: true,
      cycleMode: 'launch_only',
    });

    await expect(provider.push(input)).resolves.toEqual({ channel: 'dingtalk' });
    expect(sendWorkNotification).toHaveBeenCalledWith(
      input.dingtalkId,
      input.title,
      input.content,
      undefined,
    );
  });

  it('does not send deadline reminders for a launch-only cycle', async () => {
    const { provider, sendWorkNotification } = createProvider({
      platformEnabled: 'true',
      systemEnabled: true,
      cycleMode: 'launch_only',
    });

    await expect(provider.push({ ...input, type: 'task_reminder' })).resolves.toEqual({ channel: 'system' });
    expect(sendWorkNotification).not.toHaveBeenCalled();
  });

  it('keeps an off cycle in the system inbox even when the master switch is on', async () => {
    const { provider, sendWorkNotification } = createProvider({
      platformEnabled: 'true',
      systemEnabled: true,
      cycleMode: 'off',
    });

    await expect(provider.push(input)).resolves.toEqual({ channel: 'system' });
    expect(sendWorkNotification).not.toHaveBeenCalled();
  });

  it('sends deadline reminders for a launch-and-reminders cycle', async () => {
    const { provider, sendWorkNotification } = createProvider({
      platformEnabled: 'true',
      systemEnabled: true,
      cycleMode: 'launch_and_reminders',
    });

    await expect(provider.push({ ...input, type: 'task_reminder' })).resolves.toEqual({ channel: 'dingtalk' });
    expect(sendWorkNotification).toHaveBeenCalledTimes(1);
  });
});
