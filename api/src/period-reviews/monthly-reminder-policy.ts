export type MonthlyEmployeeReminderKind =
  | 'due_soon_3'
  | 'due_today'
  | 'overdue_1'
  | 'overdue_every_3';

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function shanghaiDayNumber(date: Date): number {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function shanghaiDateKey(date: Date): string {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function monthlyReminderKind(
  now: Date,
  dueAt: Date,
  submittedAt: Date | null,
): MonthlyEmployeeReminderKind | null {
  if (submittedAt) return null;
  const daysUntilDue = shanghaiDayNumber(dueAt) - shanghaiDayNumber(now);
  if (daysUntilDue === 3) return 'due_soon_3';
  if (daysUntilDue === 0) return 'due_today';
  if (daysUntilDue > 0) return null;
  const overdueDays = -daysUntilDue;
  if (overdueDays === 1) return 'overdue_1';
  return (overdueDays - 1) % 3 === 0 ? 'overdue_every_3' : null;
}

export const monthlyEmployeeReminderKind = monthlyReminderKind;
