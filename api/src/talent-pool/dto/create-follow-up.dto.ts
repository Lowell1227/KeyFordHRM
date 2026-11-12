import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateBy } from 'class-validator';
import { FOLLOW_UP_CHANNELS } from '../talent.constants';

const DATE_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

function isTalentDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function IsTalentDate(label: string) {
  return ValidateBy({ name: 'isTalentDate', validator: { validate: isTalentDate } }, {
    message: `${label}必须是有效日期（YYYY-MM-DD）`,
  });
}

export class CreateFollowUpDto {
  /** 沟通日期（YYYY-MM-DD），默认北京时间今天。 */
  @IsOptional()
  @IsTalentDate('沟通日期')
  occurredAt?: string | null;

  @IsIn(FOLLOW_UP_CHANNELS as readonly string[], { message: '跟进方式无效' })
  channel!: string;

  @Transform(trim)
  @IsString() @IsNotEmpty({ message: '请填写沟通内容' })
  @MaxLength(500, { message: '沟通内容不能超过 500 字' })
  summary!: string;

  /** 下次跟进日期（YYYY-MM-DD），可选。 */
  @IsOptional()
  @IsTalentDate('下次跟进日期')
  nextFollowUpAt?: string | null;
}

export class ConvertTalentDto {
  /** 对应员工（users.id）。仅 HR 手动标记已入职时提供。 */
  @IsString() @IsNotEmpty({ message: '请选择对应员工' })
  userId!: string;
}

export function parseTalentDate(value: string | null | undefined, label = '沟通日期'): Date | null {
  if (value == null) return null;
  if (!isTalentDate(value)) throw new BadRequestException(`${label}必须是有效日期（YYYY-MM-DD）`);
  // Date-only database values are day labels, not the instant of Beijing midnight.
  return new Date(`${value}T00:00:00.000Z`);
}
