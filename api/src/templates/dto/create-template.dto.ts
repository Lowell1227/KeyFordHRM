import { IsString, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateDimensionDto } from './template-dimension.dto';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  applicableDepts: string[];

  @IsArray()
  @IsString({ each: true })
  applicableUsers: string[];

  @IsOptional()
  @IsNumber()
  maxScore?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateDimensionDto)
  dimensions: TemplateDimensionDto[];
}
