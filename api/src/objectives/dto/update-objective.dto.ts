import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ObjectiveLevel, ObjectiveStatus } from '@prisma/client';

/** 更新目标。 */
export class UpdateObjectiveDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ObjectiveLevel)
  level?: ObjectiveLevel;

  @IsOptional()
  @IsString()
  deptId?: string | null;

  @IsOptional()
  @IsString()
  ownerId?: string | null;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  cycleId?: string | null;

  @IsOptional()
  @Type(() => Number)
  weight?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsEnum(ObjectiveStatus)
  status?: ObjectiveStatus;

  @IsOptional()
  @IsString()
  relatedIndicatorId?: string | null;
}
