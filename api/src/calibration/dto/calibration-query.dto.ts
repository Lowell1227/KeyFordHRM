import { IsOptional, IsString, IsUUID } from 'class-validator';

/** GET /cycles/:id/calibration 查询参数。 */
export class CalibrationQueryDto {
  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
