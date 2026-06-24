import { ArrayNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** POST /cycles/:id/approval 批量审批请求体。 */
export class BulkApprovalDto {
  @IsUUID('4', { each: true })
  @ArrayNotEmpty()
  taskIds!: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
