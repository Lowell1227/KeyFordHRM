import type { TransformFnParams } from 'class-transformer';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse the public YYYY-MM-DD contract into the single persisted date-only representation. */
export function transformDateOnly({ value }: TransformFnParams): unknown {
  if (value instanceof Date) return canonicalUtcDate(value);
  if (typeof value !== 'string') return value;

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return new Date(Number.NaN);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value ? parsed : new Date(Number.NaN);
}

function canonicalUtcDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) return value;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
