import { IsISO8601, IsOptional, IsString } from 'class-validator';
export class ApproveIndicatorsDto {
  @IsISO8601() expectedUpdatedAt!: string;
  @IsOptional() @IsString() comment?: string;
}
