import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.locale('zh-cn');
dayjs.extend(relativeTime);
dayjs.extend(isBetween);

const DATE_FORMAT = 'YYYY-MM-DD';
const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm';
const MONTH_FORMAT = 'YYYY-MM';

/** 格式化日期。 */
export function formatDate(value?: string | Date | number | null): string {
  if (value == null) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format(DATE_FORMAT) : '-';
}

/** 格式化日期时间。 */
export function formatDateTime(value?: string | Date | number | null): string {
  if (value == null) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format(DATE_TIME_FORMAT) : '-';
}

/** 格式化为年月。 */
export function formatMonth(value?: string | Date | number | null): string {
  if (value == null) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format(MONTH_FORMAT) : '-';
}

/** 相对时间。 */
export function fromNow(value?: string | Date | number | null): string {
  if (value == null) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.fromNow() : '-';
}

/** 是否已逾期。 */
export function isOverdue(deadline?: string | Date | null, now = dayjs()): boolean {
  if (deadline == null) return false;
  const d = dayjs(deadline);
  return d.isValid() && d.isBefore(now, 'day');
}

/** 距截止剩余天数（可为负数）。 */
export function daysUntilDeadline(deadline?: string | Date | null): number | null {
  if (deadline == null) return null;
  const d = dayjs(deadline);
  if (!d.isValid()) return null;
  return d.diff(dayjs(), 'day');
}

/** 是否在时间范围内。 */
export function isInRange(
  value: string | Date | number,
  start?: string | Date | null,
  end?: string | Date | null,
): boolean {
  const d = dayjs(value);
  if (!d.isValid()) return false;
  const s = start ? dayjs(start) : null;
  const e = end ? dayjs(end) : null;
  if (s && e) return d.isBetween(s, e, 'day', '[]');
  if (s) return d.isAfter(s, 'day') || d.isSame(s, 'day');
  if (e) return d.isBefore(e, 'day') || d.isSame(e, 'day');
  return true;
}

/** 获取周期的季度/年度等显示文本。 */
export function getCycleLabel(name?: string, startDate?: string, endDate?: string): string {
  if (name) return name;
  const s = formatMonth(startDate);
  const e = formatMonth(endDate);
  if (s !== '-' && e !== '-') return `${s} ~ ${e}`;
  return '未命名周期';
}
