import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfirmationMutationDto } from './confirmation-mutation.dto';

export class RejectConfirmationDto extends ConfirmationMutationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
