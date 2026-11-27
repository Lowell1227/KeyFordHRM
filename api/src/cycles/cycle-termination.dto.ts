import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class TerminateCycleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedPreviewHash!: string;
}
