import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class ShareRecipientQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
