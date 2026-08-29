import { SysRole } from '@prisma/client';
import { HR_CAPABILITIES_KEY } from '@/common/decorators/hr-capabilities.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { NotificationSettingsController } from './notification-settings.controller';

describe('NotificationSettingsController authorization', () => {
  it('allows cycle plan editors to read the effective DingTalk notification status', () => {
    expect(Reflect.getMetadata(
      ROLES_KEY,
      NotificationSettingsController.prototype.getDingtalkSettings,
    )).toEqual([SysRole.hr, SysRole.system_admin]);
    expect(Reflect.getMetadata(
      HR_CAPABILITIES_KEY,
      NotificationSettingsController.prototype.getDingtalkSettings,
    )).toEqual(['cycle_plan_edit']);
  });
});
