import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

/** 单条指标实际值更新项。 */
export class ActualValueItemDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  actualValue?: string;

  @IsOptional()
  @IsString()
  actualNote?: string;
}

/** PUT /tasks/:id/actual-value 请求体。 */
export class UpdateActualValueDto {
  @ValidateNested({ each: true })
  @Type(() => ActualValueItemDto)
  indicators!: ActualValueItemDto[];
}
