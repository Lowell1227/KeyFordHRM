import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ConfirmationStatus } from '@prisma/client';
import { PaginationDto } from '@/common/dto/pagination.dto';

export class ConfirmationQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(ConfirmationStatus)
  status?: ConfirmationStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
