import { IsEnum } from 'class-validator';
import { PerfGrade } from '@prisma/client';

/** POST /tasks/:id/final-grade 请求体。 */
export class SubmitFinalGradeDto {
  /** 直属上级独立录入的整周期最终等级。 */
  @IsEnum(PerfGrade)
  grade!: PerfGrade;
}
