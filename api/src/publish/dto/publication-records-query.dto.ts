import { PaginationDto } from "@/common/dto/pagination.dto";
import { IsOptional, IsString, IsUUID } from "class-validator";

/** GET /cycles/:id/publication-records 查询参数。 */
export class PublicationRecordsQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  deptId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
