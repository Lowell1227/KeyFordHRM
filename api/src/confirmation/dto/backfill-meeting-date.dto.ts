import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';
import { ConfirmationMutationDto } from './confirmation-mutation.dto';

export class BackfillMeetingDateDto extends ConfirmationMutationDto {
  @Type(() => Date)
  @IsDate()
  meetingDate!: Date;
}
