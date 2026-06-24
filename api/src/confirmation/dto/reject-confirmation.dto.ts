import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectConfirmationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
