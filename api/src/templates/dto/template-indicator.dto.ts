import { IsString, IsOptional, IsNumber, IsUUID, Min, Max } from 'class-validator';

export class TemplateIndicatorDto {
  @IsOptional()
  @IsUUID()
  indicatorId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  scoringStandard?: string;

  @IsOptional()
  @IsString()
  dataSource?: string;

  @IsOptional()
  @IsString()
  dataCaliber?: string;

  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  @Min(0.0001)
  @Max(1)
  weight: number;

  @IsNumber()
  sortOrder: number;
}
