import { IsBoolean } from 'class-validator';

export class UpdateDingtalkNotificationSettingsDto {
  @IsBoolean()
  enabled: boolean;
}
