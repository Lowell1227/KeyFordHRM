import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
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
import { IndicatorType, IndicatorVisibilityScope } from '@prisma/client';

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

  /** 兼容旧客户端；新客户端使用 visibilityScopes。 */
  @IsOptional()
  @IsEnum(IndicatorVisibilityScope)
  visibilityScope?: IndicatorVisibilityScope;

  @IsOptional()
  @IsArray()
  @IsEnum(IndicatorVisibilityScope, { each: true })
  visibilityScopes?: IndicatorVisibilityScope[];

  @IsArray()
  @IsUUID('4', { each: true })
  visibleDepartmentIds: string[] = [];

  @IsArray()
  @IsUUID('4', { each: true })
  visibleUserIds: string[] = [];

  @IsArray()
  @IsUUID('4', { each: true })
  alignedObjectiveIds: string[] = [];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  alignedParentIndicatorIds?: string[];
}

export class SetIndicatorsDto {
  @IsDateString()
  expectedUpdatedAt!: string;

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
