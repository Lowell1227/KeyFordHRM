import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** POST /cycles/:id/calibration/confirm 请求体。 */
export class ConfirmCalibrationDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  taskIds!: string[];
}
