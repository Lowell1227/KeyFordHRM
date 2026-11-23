import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class ConfirmArchiveIssueDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: '资料版本无效，请刷新后重试' })
  fingerprint!: string;
}

export class SetArchiveIssueExemptionDto extends ConfirmArchiveIssueDto {
  @IsBoolean()
  isExempt!: boolean;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
