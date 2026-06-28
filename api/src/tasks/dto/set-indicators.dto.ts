import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IndicatorType } from '@prisma/client';

export class SetIndicatorItemDto {
  @IsOptional()
  @IsUUID()
  templateIndicatorId?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

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
  @Type(() => Number)
  @IsNumber()
  targetValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetValueText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number;

  @IsOptional()
  @IsEnum(IndicatorType)
  indicatorType?: IndicatorType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dimensionName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  dimensionWeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class SetIndicatorsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetIndicatorItemDto)
  instances!: SetIndicatorItemDto[];

  @IsOptional()
  @IsIn(['save', 'submit'])
  action?: 'save' | 'submit';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
