import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveConfirmationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
