import { IsString, MaxLength } from 'class-validator';
import { ConfirmationMutationDto } from './confirmation-mutation.dto';

export class SaveSelfConfirmationDto extends ConfirmationMutationDto {
  @IsString()
  @MaxLength(4000)
  summary!: string;
}
