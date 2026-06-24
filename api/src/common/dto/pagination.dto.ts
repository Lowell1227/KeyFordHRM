import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** 通用分页查询参数。page 从 1 起，pageSize 默认 20、上限 100。
 *  「选人」等大数据量场景一律走远程搜索/分页（见 UserSelect），不再一次性拉全量。 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  get take(): number {
    return this.pageSize;
  }
}

/** 分页响应包装。 */
export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export function paginated<T>(items: T[], total: number, dto: PaginationDto): Paginated<T> {
  return { total, page: dto.page, pageSize: dto.pageSize, items };
}
