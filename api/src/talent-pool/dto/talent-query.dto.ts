import { Transform } from 'class-transformer';
import { BooleanQuery } from '../../common/dto/boolean-query';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { TALENT_SOURCE_CHANNELS, TALENT_STATUSES, TALENT_TAGS } from '../talent.constants';
import { TALENT_APPLICATION_STAGES } from '../talent-application-filter';

function ToNumber() {
  return Transform(({ value }) => (value === undefined || value === null || value === '') ? value : Number(value));
}

export class TalentQueryDto extends PaginationDto {
  /** 关键词：姓名/手机/当前公司/当前职位/意向岗位，模糊匹配。 */
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(TALENT_STATUSES as readonly string[])
  status?: string;

  @IsOptional()
  @IsIn(TALENT_SOURCE_CHANNELS as readonly string[])
  source?: string;

  @IsOptional()
  @IsIn(TALENT_TAGS as readonly string[])
  tag?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(100)
  applicationPosition?: string;

  @IsOptional()
  @IsIn(TALENT_APPLICATION_STAGES)
  applicationStage?: string;

  /** 期望薪资区间（K/月）。两端都有值时取区间交集；任一端为空的记录不纳入。 */
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(0) @Max(2147483647)
  salaryMin?: number;

  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(0) @Max(2147483647)
  salaryMax?: number;

  /** 精确元/月区间，与旧版 K/月筛选互斥。 */
  @IsOptional()
  @ToNumber()
  @IsInt() @Min(0) @Max(2147483647)
  salaryMinYuan?: number;

  @IsOptional()
  @ToNumber()
  @IsInt() @Min(0) @Max(2147483647)
  salaryMaxYuan?: number;

  /** 仅看待跟进：从未跟进，或已安排下次跟进（含未来）；招聘阶段独立筛选。 */
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  dueOnly?: boolean;

  /** 超 18 个月未联系：last_follow_up_at 早于 18 个月前，或从未跟进且入库早于 18 个月前。 */
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  staleOnly?: boolean;

  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  mineOnly?: boolean;
}
