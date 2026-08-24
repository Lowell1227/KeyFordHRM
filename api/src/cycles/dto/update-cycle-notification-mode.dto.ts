import { IsIn } from 'class-validator';

export type CycleNotificationMode = 'off' | 'launch_only' | 'launch_and_reminders';

export class UpdateCycleNotificationModeDto {
  @IsIn(['off', 'launch_only', 'launch_and_reminders'])
  notificationMode: CycleNotificationMode;
}
