import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ConfirmationMutationDto } from './confirmation-mutation.dto';

export class ReturnConfirmationDto extends ConfirmationMutationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
