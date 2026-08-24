import { ConfigService } from '@nestjs/config';
import { NotificationSettingsService } from './notification-settings.service';

describe('NotificationSettingsService', () => {
  const operatorId = '11111111-1111-4111-8111-111111111111';

  function createService(options: { platformEnabled?: string; storedEnabled?: boolean } = {}) {
    const prisma = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(
          options.storedEnabled === undefined ? null : { value: options.storedEnabled },
        ),
        upsert: jest.fn().mockImplementation(({ create }) => create),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };
    const config = new ConfigService({
      DINGTALK_NOTIFICATION_ENABLED: options.platformEnabled,
      DINGTALK_APP_KEY: 'app-key',
      DINGTALK_APP_SECRET: 'app-secret',
      DINGTALK_AGENT_ID: 'agent-id',
    });
    return {
      prisma,
      service: new NotificationSettingsService(prisma as never, config),
    };
  }

  it('reports the user-visible switch separately from the platform safety gate', async () => {
    const { service } = createService({ platformEnabled: 'true', storedEnabled: false });

    await expect(service.getDingtalkSettings()).resolves.toEqual({
      available: true,
      enabled: false,
      effectiveEnabled: false,
    });
  });

  it('persists an enabled switch with an audit record', async () => {
    const { service, prisma } = createService({ platformEnabled: 'true', storedEnabled: false });

    await expect(service.updateDingtalkSettings(true, operatorId)).resolves.toEqual({
      available: true,
      enabled: true,
      effectiveEnabled: true,
    });
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'dingtalk_notification_enabled' },
      create: expect.objectContaining({ value: true, updatedBy: operatorId }),
      update: expect.objectContaining({ value: true, updatedBy: operatorId }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'dingtalk_notification_setting_updated',
        entityId: null,
        newValue: { configKey: 'dingtalk_notification_enabled', enabled: true },
      }),
    }));
  });
});
