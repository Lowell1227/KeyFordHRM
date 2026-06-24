import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * 一票否决字段 DTO。
 *
 * 可在校准批量提交中内嵌使用，也可作为未来独立否决端点的基础结构。
 */
export class VetoDto {
  @IsOptional()
  @IsBoolean()
  isVeto?: boolean;

  @IsOptional()
  @IsString()
  vetoReason?: string;
}
