import { IsISO8601, IsOptional } from 'class-validator';

/** Legacy cycles allow an empty body; v2 requires the displayed task version. */
export class ConfirmIndicatorsDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
