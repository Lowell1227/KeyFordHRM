import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * 一票否决字段 DTO（V1 周期级评分使用；校准环节的一票否决已移除）。
 */
export class VetoDto {
  @IsOptional()
  @IsBoolean()
  isVeto?: boolean;

  @IsOptional()
  @IsString()
  vetoReason?: string;
}
