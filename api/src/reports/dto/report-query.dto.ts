import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PerfGrade } from '@prisma/client';

export enum ReportFormat {
  json = 'json',
  excel = 'excel',
}

/** GET /reports/cycle/:id/summary 查询参数。 */
export class ReportQueryDto {
  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsEnum(PerfGrade)
  grade?: PerfGrade;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}
