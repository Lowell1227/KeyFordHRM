import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AppealResult, PerfGrade } from '@prisma/client';

/** POST /appeals/:id/resolve — HR 录入处理结论。 */
export class ResolveAppealDto {
  @IsString()
  @IsNotEmpty()
  resolution!: string;

  @IsEnum(AppealResult)
  result!: AppealResult;

  @IsEnum(PerfGrade)
  @IsOptional()
  newGrade?: PerfGrade;

  @IsString()
  @IsOptional()
  newGradeNote?: string;
}
