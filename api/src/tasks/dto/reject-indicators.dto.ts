import { IsOptional, IsString, IsISO8601 } from 'class-validator';

/** POST /tasks/:id/indicators/reject 请求体。 */
export class RejectIndicatorsDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
  @IsOptional()
  @IsString()
  comment?: string;
}
