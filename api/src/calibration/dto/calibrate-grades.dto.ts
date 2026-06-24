import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { PerfGrade } from '@prisma/client';
import { VetoDto } from './veto.dto';

/** 单条校准项。 */
export class CalibrationItemDto extends VetoDto {
  @IsUUID()
  taskId!: string;

  @IsEnum(PerfGrade)
  calibratedGrade!: PerfGrade;

  @IsOptional()
  @IsString()
  calibrationNote?: string;
}

/** POST /cycles/:id/calibration 请求体。 */
export class CalibrateGradesDto {
  @IsBoolean()
  submit!: boolean;

  @ValidateNested({ each: true })
  @Type(() => CalibrationItemDto)
  calibrations!: CalibrationItemDto[];
}
