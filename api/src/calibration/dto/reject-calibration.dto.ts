import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** POST /cycles/:id/calibration/reject 请求体。 */
export class RejectCalibrationDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  taskIds!: string[];

  /** 驳回原因（必填，将退回直属上级重新评定）。 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
