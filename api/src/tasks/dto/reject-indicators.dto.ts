import { IsOptional, IsString } from 'class-validator';

/** POST /tasks/:id/indicators/reject 请求体。 */
export class RejectIndicatorsDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
