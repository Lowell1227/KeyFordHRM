import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { IndicatorType } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class IndicatorQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(IndicatorType)
  type?: IndicatorType;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (value === undefined ? true : value === 'true' || value === true))
  isActive?: boolean = true;
}
