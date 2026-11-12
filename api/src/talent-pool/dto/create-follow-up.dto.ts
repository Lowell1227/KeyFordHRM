import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { FOLLOW_UP_CHANNELS } from '../talent.constants';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFollowUpDto {
  /** 沟通日期（YYYY-MM-DD），默认今天。 */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: '沟通日期格式应为 YYYY-MM-DD' })
  occurredAt?: string;

  @IsIn(FOLLOW_UP_CHANNELS as readonly string[], { message: '跟进方式无效' })
  channel!: string;

  @Transform(trim)
  @IsString() @IsNotEmpty({ message: '请填写沟通内容' })
  @MaxLength(500, { message: '沟通内容不能超过 500 字' })
  summary!: string;

  /** 下次跟进日期（YYYY-MM-DD），可选。 */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: '下次跟进日期格式应为 YYYY-MM-DD' })
  nextFollowUpAt?: string;
}

export class ConvertTalentDto {
  /** 对应员工（users.id）。仅 HR 手动标记已入职时提供。 */
  @IsString() @IsNotEmpty({ message: '请选择对应员工' })
  userId!: string;
}

export function parseTalentDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}
