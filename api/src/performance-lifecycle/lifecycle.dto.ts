import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { LifecycleFilter } from './lifecycle-policy';

export class LifecycleQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['active', 'terminated', 'deleted', 'all'])
  lifecycleStatus?: LifecycleFilter;
}

export class LifecycleMutationDto {
  @IsDateString()
  expectedUpdatedAt!: string;

  @IsInt()
  @Min(0)
  expectedLifecycleVersion!: number;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
