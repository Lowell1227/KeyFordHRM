import { IsString, IsOptional, IsNotEmpty, IsEnum, IsBoolean, IsNumber, MaxLength } from 'class-validator';
import { IndicatorType } from '@prisma/client';

export class CreateIndicatorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsEnum(IndicatorType)
  type: IndicatorType;

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
  @MaxLength(100)
  targetValueText?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
