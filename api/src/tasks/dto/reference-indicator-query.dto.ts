import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class ReferenceIndicatorQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}
