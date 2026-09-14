import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class BackfillMeetingDateDto {
  @Type(() => Date)
  @IsDate()
  meetingDate!: Date;
}
