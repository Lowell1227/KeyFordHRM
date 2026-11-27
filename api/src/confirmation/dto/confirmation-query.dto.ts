import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ConfirmationStatus } from '@prisma/client';
import { LifecycleQueryDto } from '@/performance-lifecycle/lifecycle.dto';

export class ConfirmationQueryDto extends LifecycleQueryDto {
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
