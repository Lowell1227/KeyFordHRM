import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IndicatorProgressHealth } from '@prisma/client';

class IndicatorProgressAttachmentDto {
  @IsString()
  @Matches(/\S/, { message: '附件名称不能为空' })
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(2048)
  @Matches(/^(?:https?:\/\/|\/(?!\/))/i, { message: '附件地址无效' })
  url!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  size?: number;
}

export class UpdateIndicatorProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsEnum(IndicatorProgressHealth)
  healthStatus!: IndicatorProgressHealth;

  @IsString()
  @Matches(/\S/, { message: '进展说明不能为空' })
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => IndicatorProgressAttachmentDto)
  attachments?: IndicatorProgressAttachmentDto[];

  @IsOptional()
  @IsISO8601({ strict: true })
  expectedLatestUpdateAt?: string | null;
}
