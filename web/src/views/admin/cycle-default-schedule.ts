import dayjs, { type Dayjs } from 'dayjs';

interface ChinaWorkdayCalendar {
  holidays: ReadonlySet<string>;
  makeupWorkdays: ReadonlySet<string>;
}

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

const FIXED_STATUTORY_HOLIDAYS = new Set([
  '01-01',
  '05-01', '05-02',
  '10-01', '10-02', '10-03',
]);

export interface DefaultCycleSchedule {
  goalSettingOpenAt: Date;
  deadlineIndicatorSetting: Date;
  deadlineIndicatorConfirm: Date;
  selfEvalOpenAt: Date;
  deadlineSelfEval: Date;
  deadlineManagerScore: Date;
  deadlineHrCalibration: Date;
  deadlineApproval: Date;
  deadlinePublish: Date;
  provisionalYears: number[];
}

function workdayStatus(value: Dayjs): { isWorkday: boolean; official: boolean } {
  const dateKey = value.format('YYYY-MM-DD');
  const calendar = OFFICIAL_CALENDARS[value.year()];
  if (calendar) {
    if (calendar.makeupWorkdays.has(dateKey)) return { isWorkday: true, official: true };
    if (calendar.holidays.has(dateKey)) return { isWorkday: false, official: true };
    const weekday = value.day();
    return { isWorkday: weekday >= 1 && weekday <= 5, official: true };
  }

  if (FIXED_STATUTORY_HOLIDAYS.has(value.format('MM-DD'))) {
    return { isWorkday: false, official: false };
  }
  const weekday = value.day();
  return { isWorkday: weekday >= 1 && weekday <= 5, official: false };
}

function shiftWorkdays(
  value: Dayjs,
  count: number,
  direction: 1 | -1,
  provisionalYears: Set<number>,
): Dayjs {
  let current = value.startOf('day');
  let remaining = count;
  while (remaining > 0) {
    current = current.add(direction, 'day');
    const status = workdayStatus(current);
    if (!status.official) provisionalYears.add(current.year());
    if (status.isWorkday) remaining -= 1;
  }
  return current;
}

function atTime(value: Dayjs, hour: number): Date {
  return value.hour(hour).minute(0).second(0).millisecond(0).toDate();
}

export function buildDefaultCycleSchedule(startDate: Date, endDate: Date): DefaultCycleSchedule {
  const start = dayjs(startDate).startOf('day');
  const end = dayjs(endDate).startOf('day');
  const provisionalYears = new Set<number>();

  const goalSettingOpen = shiftWorkdays(start, 10, -1, provisionalYears);
  const indicatorSetting = shiftWorkdays(start, 3, -1, provisionalYears);
  const indicatorConfirm = shiftWorkdays(start, 1, -1, provisionalYears);
  const selfEvalOpen = shiftWorkdays(end, 1, 1, provisionalYears);
  const selfEvalDeadline = shiftWorkdays(selfEvalOpen, 2, 1, provisionalYears);
  const managerDeadline = shiftWorkdays(selfEvalDeadline, 3, 1, provisionalYears);
  const hrCalibrationDeadline = shiftWorkdays(managerDeadline, 2, 1, provisionalYears);
  const approvalDeadline = shiftWorkdays(hrCalibrationDeadline, 2, 1, provisionalYears);
  const publishDeadline = shiftWorkdays(approvalDeadline, 1, 1, provisionalYears);

  return {
    goalSettingOpenAt: atTime(goalSettingOpen, 9),
    deadlineIndicatorSetting: atTime(indicatorSetting, 18),
    deadlineIndicatorConfirm: atTime(indicatorConfirm, 18),
    selfEvalOpenAt: atTime(selfEvalOpen, 9),
    deadlineSelfEval: atTime(selfEvalDeadline, 18),
    deadlineManagerScore: atTime(managerDeadline, 18),
    deadlineHrCalibration: atTime(hrCalibrationDeadline, 18),
    deadlineApproval: atTime(approvalDeadline, 18),
    deadlinePublish: atTime(publishDeadline, 18),
    provisionalYears: [...provisionalYears].sort((left, right) => left - right),
  };
}
