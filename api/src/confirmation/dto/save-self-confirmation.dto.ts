import { IsString, MaxLength } from 'class-validator';

export class SaveSelfConfirmationDto {
  @IsString()
  @MaxLength(4000)
  summary!: string;
}
