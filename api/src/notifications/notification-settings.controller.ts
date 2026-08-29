import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { UpdateDingtalkNotificationSettingsDto } from './dto/update-dingtalk-notification-settings.dto';
import { NotificationSettingsService } from './notification-settings.service';

@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get('dingtalk')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('cycle_plan_edit')
  getDingtalkSettings() {
    return this.settings.getDingtalkSettings();
  }

  @Patch('dingtalk')
  @Roles(SysRole.hr, SysRole.system_admin)
  updateDingtalkSettings(
    @Body() dto: UpdateDingtalkNotificationSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.updateDingtalkSettings(dto.enabled, user.id);
  }
}
