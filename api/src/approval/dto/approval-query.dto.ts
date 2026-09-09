import { IsOptional, IsString, IsUUID } from 'class-validator';

/** GET /cycles/:id/approval 查询参数。 */
export class ApprovalQueryDto {
  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
