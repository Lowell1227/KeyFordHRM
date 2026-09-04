import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PerfGrade } from '@prisma/client';

export class ManagerPeriodReviewItemDto {
  @IsUUID('4')
  indicatorVersionItemId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  managerScore?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  managerComment?: string | null;
}

export class SaveManagerPeriodReviewDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsEnum(PerfGrade)
  managerGrade?: PerfGrade | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManagerPeriodReviewItemDto)
  indicators!: ManagerPeriodReviewItemDto[];
}
