import type { TransformFnParams } from 'class-transformer';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse the public YYYY-MM-DD contract into the single persisted date-only representation. */
export function transformDateOnly({ obj, key }: TransformFnParams): Date {
  const rawValue = (obj as Record<string, unknown>)[key];
  if (typeof rawValue !== 'string') return new Date(Number.NaN);

  const match = DATE_ONLY_PATTERN.exec(rawValue);
  if (!match) return new Date(Number.NaN);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === rawValue ? parsed : new Date(Number.NaN);
}
