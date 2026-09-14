import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSelfConfirmationDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;
}
