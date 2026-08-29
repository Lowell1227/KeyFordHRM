import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class PeriodReviewAttachmentDto {
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
