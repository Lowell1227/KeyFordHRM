export type WorkdayStatus = { isWorkday: boolean; official: boolean };

interface ChinaWorkdayCalendar {
  holidays: ReadonlySet<string>;
  makeupWorkdays: ReadonlySet<string>;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  calendar: 'iso8601',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 国务院办公厅 2026 年部分节假日安排：
// https://www.gov.cn/gongbao/2025/issue_12406/material/gwygb202532.pdf
const OFFICIAL_CALENDARS: Readonly<Record<number, ChinaWorkdayCalendar>> = {
  2026: {
    holidays: new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ]),
    makeupWorkdays: new Set([
      '2026-01-04',
      '2026-02-14', '2026-02-28',
      '2026-05-09',
      '2026-09-20', '2026-10-10',
    ]),
  },
  // 国务院尚未发布 2027 年度调休安排；先按自然工作日和现行办法中
  // 日期确定的法定节日生成默认排期，不预设尚未公布的调休工作日。
  2027: {
    holidays: new Set([
      '2027-01-01',
      '2027-05-01', '2027-05-02',
      '2027-10-01', '2027-10-02', '2027-10-03',
    ]),
    makeupWorkdays: new Set(),
  },
};

const FIXED_STATUTORY_HOLIDAYS = new Set(['01-01', '05-01', '05-02', '10-01', '10-02', '10-03']);

export function workdayStatus(date: Date): WorkdayStatus {
  const { year, month, day } = shanghaiCalendarDate(date);
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const calendar = OFFICIAL_CALENDARS[year];
  if (calendar) {
    if (calendar.makeupWorkdays.has(dateKey)) return { isWorkday: true, official: true };
    if (calendar.holidays.has(dateKey)) return { isWorkday: false, official: true };
    return { isWorkday: weekday(year, month, day), official: true };
  }

  if (FIXED_STATUTORY_HOLIDAYS.has(dateKey.slice(5))) return { isWorkday: false, official: false };
  return { isWorkday: weekday(year, month, day), official: false };
}

export function shiftStatutoryWorkdays(date: Date, count: number): Date {
  const direction = Math.sign(count);
  let current = atShanghaiTime(date, 0);
  let remaining = Math.abs(count);
  while (remaining > 0) {
    current = new Date(current.getTime() + direction * 24 * 60 * 60 * 1000);
    if (workdayStatus(current).isWorkday) remaining -= 1;
  }
  return current;
}

export function atShanghaiTime(date: Date, hour: number): Date {
  const { year, month, day } = shanghaiCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day, hour) - SHANGHAI_OFFSET_MS);
}

function shanghaiCalendarDate(date: Date): { year: number; month: number; day: number } {
  const values = new Map(SHANGHAI_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(values.get('year')), month: Number(values.get('month')), day: Number(values.get('day')) };
}

function weekday(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return value >= 1 && value <= 5;
}
