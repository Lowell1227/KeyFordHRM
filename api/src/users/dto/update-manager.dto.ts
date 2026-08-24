import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateManagerDto {
  @IsOptional()
  @IsUUID()
  directManagerId?: string | null;

  @IsOptional()
  @IsBoolean()
  /** @deprecated 绩效直属上级权限由关系动态计算；保留字段只为兼容旧客户端。 */
  grantManagerRole?: boolean;
}
