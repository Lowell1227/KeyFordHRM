import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

/** 改进措施单行。 */
export class ImprovementMeasureDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  responsible: string;

  @IsDateString()
  deadline: string;
}

/** 填写/修改改进计划。 */
export class FillImprovementPlanDto {
  @IsString()
  @IsNotEmpty()
  improvementNeed: string;

  @IsString()
  @IsNotEmpty()
  importance: string;

  @IsString()
  @IsNotEmpty()
  improvementGoal: string;

  @IsDateString()
  targetDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImprovementMeasureDto)
  measures: ImprovementMeasureDto[];
}
