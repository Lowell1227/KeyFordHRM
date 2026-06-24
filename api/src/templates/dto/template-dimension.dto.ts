import { IsString, IsOptional, IsNumber, IsEnum, Min, Max, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { DimensionType } from '@prisma/client';
import { TemplateIndicatorDto } from './template-indicator.dto';

export class TemplateDimensionDto {
  @IsString()
  name: string;

  @IsEnum(DimensionType)
  type: DimensionType;

  @IsNumber()
  @Min(0.0001)
  @Max(1)
  weight: number;

  @IsNumber()
  sortOrder: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateIndicatorDto)
  indicators: TemplateIndicatorDto[];
}
