import { IsString, Matches } from 'class-validator';

export class ConfirmArchiveIssueDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: '资料版本无效，请刷新后重试' })
  fingerprint!: string;
}
