import { IndicatorProgressHealth } from '@prisma/client';
import { IsEnum, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class SaveProgressDraftDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  indicatorId?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  periodId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/, { message: '请输入进展说明' })
  @MaxLength(10000)
  content?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: '实际值须为非负数，最多8位整数和2位小数' })
  actualValue?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsEnum(IndicatorProgressHealth)
  healthStatus?: IndicatorProgressHealth | null;
}
