import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export type PayrollAttendanceType =
  | 'normal'
  | 'late'
  | 'early'
  | 'paid_leave'
  | 'unpaid_leave'
  | 'sick_leave'
  | 'business_trip'
  | 'outing'
  | 'makeup'
  | 'overtime'
  | 'missing_punch'
  | 'absence'
  | 'not_required';

export type PayrollOvertimeKind = 'weekday' | 'restday' | 'holiday';

export interface PayrollAttendanceRecord {
  sourceId: string;
  /** Nonnegative safe integer, monotonically increasing per sourceId. */
  sourceVersion: number;
  employeeId: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  type: PayrollAttendanceType;
  state: 'effective' | 'pending' | 'revoked' | 'superseded' | 'cancelled';
  hours: string;
  unit: 'hour' | 'day' | 'unknown';
  overtimeKind?: PayrollOvertimeKind;
}

export interface PayrollAttendanceInput {
  month: string;
  expected: Array<{
    employeeId: string;
    workDate: string;
    units: string;
    required: boolean;
  }>;
  records: PayrollAttendanceRecord[];
}

export interface PayrollNormalizedAttendanceRecord extends Omit<PayrollAttendanceRecord, 'sourceVersion'> {
  sourceVersion: number | null;
  kind: 'regular' | 'overtime' | 'exception' | 'not_required';
  resolution: 'usable' | 'covered' | 'duplicate' | 'unresolved' | 'inactive';
  /** Usable duration, not pay entitlement. Null means unresolved or inactive. */
  effectiveHours: string | null;
}

export interface PayrollAttendanceIssue {
  employeeId: string;
  workDate: string;
  code: string;
  message: string;
}

export interface PayrollAttendanceResult {
  month: string;
  days: Array<{
    employeeId: string;
    workDate: string;
    /** HRM schedule units, not inferred hours. Null for unmapped/conflicting input. */
    units: string | null;
    required: boolean | null;
    records: PayrollNormalizedAttendanceRecord[];
    issues: string[];
  }>;
  issues: PayrollAttendanceIssue[];
  version: string;
}

const messages = {
  MISSING_RECORD: 'No source record was supplied for a required HRM work day.',
  MISSING_REGULAR_COVERAGE: 'Only overtime was supplied for a required regular-attendance day.',
  UNEXPECTED_RECORD: 'The source employee/work day is outside the supplied HRM coverage.',
  INVALID_WORK_DATE: 'The work day must be a real ISO calendar date.',
  OUTSIDE_MONTH: 'The source work day is outside the requested calendar month.',
  INVALID_SOURCE_VERSION: 'The source revision must be a nonnegative safe integer.',
  SOURCE_VERSION_CONFLICT: 'The same source identity and revision have conflicting contents.',
  INVALID_SOURCE_ID: 'A nonempty source identity is required.',
  INVALID_EMPLOYEE_ID: 'A nonempty HRM employee identity is required.',
  INVALID_INTERVAL: 'The interval must have real offset-qualified ISO timestamps and a positive duration.',
  INVALID_HOURS: 'The source duration must be a nonnegative plain decimal string.',
  HOURS_EXCEED_INTERVAL: 'The source hours exceed the elapsed absolute interval and require reconciliation.',
  INVALID_EXPECTED_UNITS: 'The HRM schedule units must be a nonnegative plain decimal string.',
  EXPECTED_CONFLICT: 'The HRM coverage contains conflicting expectations for this employee/work day.',
  INVALID_REQUIREMENT: 'The HRM attendance requirement must be an explicit boolean.',
  INVALID_RECORD_TYPE: 'The source attendance type is not supported.',
  INVALID_RECORD_STATE: 'The source attendance state is not supported.',
  PENDING_APPROVAL: 'The source fact is pending approval and cannot supply effective coverage.',
  REVOKED_RECORD: 'The source fact was revoked; its payroll impact requires reconciliation.',
  DAY_CONVERSION_REQUIRED: 'Day-based source duration needs an explicit day-to-hour conversion.',
  UNKNOWN_UNIT: 'The source duration unit is unknown.',
  OVERTIME_KIND_REQUIRED: 'Positive overtime duration needs an explicit weekday, restday or holiday classification.',
  MISSING_PUNCH: 'An explicit missing punch is not fully covered by effective makeup or approved leave/travel.',
  REQUIREMENT_CONFLICT: 'The not-required fact conflicts with HRM requirements or effective attendance.',
  INTERVAL_CONFLICT: 'Overlapping effective intervals do not identify one unambiguous attendance result.',
} as const;
type IssueCode = keyof typeof messages;
type Day = PayrollAttendanceResult['days'][number];
type WorkingDay = Day & { expected: boolean; codes: Set<IssueCode> };
type Candidate = {
  record: PayrollNormalizedAttendanceRecord;
  problems: IssueCode[];
};
type LocatedRecord = {
  day: WorkingDay;
  record: PayrollNormalizedAttendanceRecord;
};

const types: PayrollAttendanceType[] = [
  'normal',
  'late',
  'early',
  'paid_leave',
  'unpaid_leave',
  'sick_leave',
  'business_trip',
  'outing',
  'makeup',
  'overtime',
  'missing_punch',
  'absence',
  'not_required',
];
const replacements: PayrollAttendanceType[] = [
  'makeup',
  'paid_leave',
  'unpaid_leave',
  'sick_leave',
  'business_trip',
  'outing',
];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (value: unknown) => JSON.stringify(value);
const identity = (employeeId: string, workDate: string) => key([employeeId, workDate]);

function decimal(value: string): string | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = new Prisma.Decimal(value);
  return parsed.isFinite() ? parsed.toFixed() : null;
}

function validDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

function timestamp(value: string): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  if (match[6] !== 'Z' && (+match[6].slice(1, 3) > 23 || +match[6].slice(4, 6) > 59)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const utc = new Date(time).toISOString();
  const fraction = (match[5] ?? '').replace(/0+$/, '').padEnd(3, '0');
  return `${utc.slice(0, utc.indexOf('.'))}.${fraction}Z`;
}

function compareTime(a: string, b: string): number {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds !== 0) return milliseconds;
  // Date loses submillisecond precision; compare the retained fractions when milliseconds tie.
  const af = a.slice(a.indexOf('.') + 1, -1);
  const bf = b.slice(b.indexOf('.') + 1, -1);
  const width = Math.max(af.length, bf.length);
  return compare(af.padEnd(width, '0'), bf.padEnd(width, '0'));
}

function exceedsInterval(hours: string, startsAt: string, endsAt: string): boolean {
  const Decimal = Prisma.Decimal.clone({ precision: hours.length + startsAt.length + endsAt.length + 20 });
  const milliseconds = (value: string) => {
    const [seconds, fraction] = value.slice(0, -1).split('.');
    // Parse only whole seconds with Date; retain all source fractional digits in Decimal.
    return new Decimal(Date.parse(`${seconds}Z`)).plus(new Decimal(`0.${fraction}`).times(1000));
  };
  return new Decimal(hours).times(3600000).gt(milliseconds(endsAt).minus(milliseconds(startsAt)));
}

function sanitize(source: PayrollAttendanceRecord): Candidate {
  const problems: IssueCode[] = [];
  const hours = decimal(source.hours);
  const startsAt = timestamp(source.startsAt);
  const endsAt = timestamp(source.endsAt);
  const overtimeKind = ['weekday', 'restday', 'holiday'].includes(source.overtimeKind ?? '')
    ? source.overtimeKind
    : undefined;
  const sourceVersion =
    Number.isSafeInteger(source.sourceVersion) && source.sourceVersion >= 0 ? source.sourceVersion : null;
  if (sourceVersion === null) problems.push('INVALID_SOURCE_VERSION');
  if (typeof source.sourceId !== 'string' || !source.sourceId.trim()) problems.push('INVALID_SOURCE_ID');
  if (typeof source.employeeId !== 'string' || !source.employeeId.trim()) problems.push('INVALID_EMPLOYEE_ID');
  if (hours === null) problems.push('INVALID_HOURS');
  if (!startsAt || !endsAt || compareTime(startsAt, endsAt) >= 0) problems.push('INVALID_INTERVAL');
  else if (source.state === 'effective' && source.unit === 'hour' && hours !== null && exceedsInterval(hours, startsAt, endsAt)) {
    problems.push('HOURS_EXCEED_INTERVAL');
  }
  if (!types.includes(source.type)) problems.push('INVALID_RECORD_TYPE');
  if (!['effective', 'pending', 'revoked', 'superseded', 'cancelled'].includes(source.state)
    || source.state === 'superseded' && source.type !== 'normal'
    || source.state === 'cancelled' && ![...replacements, 'overtime'].includes(source.type)) problems.push('INVALID_RECORD_STATE');
  if (source.type === 'overtime' && hours !== null && new Prisma.Decimal(hours).gt(0) && !overtimeKind) {
    problems.push('OVERTIME_KIND_REQUIRED');
  }
  // Explicit allowlist: external adapter payloads must never leak private metadata into snapshots.
  return {
    problems,
    record: {
      sourceId: source.sourceId,
      sourceVersion,
      employeeId: source.employeeId,
      workDate: source.workDate,
      startsAt: startsAt ?? source.startsAt,
      endsAt: endsAt ?? source.endsAt,
      type: source.type,
      state: source.state,
      hours: hours ?? source.hours,
      unit: source.unit,
      ...(source.type === 'overtime' && overtimeKind ? { overtimeKind } : {}),
      kind:
        source.type === 'overtime'
          ? 'overtime'
          : source.type === 'not_required'
            ? 'not_required'
            : source.type === 'missing_punch' || source.type === 'absence'
              ? 'exception'
              : 'regular',
      resolution: 'unresolved',
      effectiveHours: null,
    },
  };
}

function resolveIntervals(days: WorkingDay[], eligibleMissing: Set<PayrollNormalizedAttendanceRecord>): void {
  const employees = new Map<string, LocatedRecord[]>();
  for (const day of days) {
    for (const record of day.records) {
      if (record.resolution !== 'usable' || record.type === 'not_required') continue;
      const rows = employees.get(record.employeeId) ?? [];
      rows.push({ day, record });
      employees.set(record.employeeId, rows);
    }
  }
  for (const rows of employees.values()) {
    const groups = new Map<string, LocatedRecord[]>();
    for (const row of rows) {
      const record = row.record;
      const signature = key([
        record.workDate,
        record.startsAt,
        record.endsAt,
        record.type,
        record.hours,
        record.unit,
        record.overtimeKind,
      ]);
      const group = groups.get(signature) ?? [];
      group.push(row);
      groups.set(signature, group);
    }
    const intervals = [...groups.values()]
      .map((group) => {
        group.sort((a, b) => compare(key(a.record), key(b.record)));
        for (const duplicate of group.slice(1)) {
          duplicate.record.resolution = 'duplicate';
          duplicate.record.effectiveHours = '0';
        }
        return group;
      })
      .sort(
        (a, b) =>
          compareTime(a[0].record.startsAt, b[0].record.startsAt) || compare(key(a[0].record), key(b[0].record)),
      );
    const unpaidReplacements: Array<{ normal: LocatedRecord[]; leave: LocatedRecord[] }> = [];
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (compareTime(intervals[j][0].record.startsAt, intervals[i][0].record.endsAt) >= 0) break;
        const a = intervals[i][0].record;
        const b = intervals[j][0].record;
        // Only explicit, equal source intervals and durations can replace normal facts; never estimate a partial split.
        if (
          ((a.type === 'normal' && b.type === 'unpaid_leave') || (b.type === 'normal' && a.type === 'unpaid_leave')) &&
          a.workDate === b.workDate &&
          a.startsAt === b.startsAt &&
          a.endsAt === b.endsAt &&
          a.hours === b.hours &&
          a.unit === b.unit
        ) {
          unpaidReplacements.push({
            normal: a.type === 'normal' ? intervals[i] : intervals[j],
            leave: a.type === 'unpaid_leave' ? intervals[i] : intervals[j],
          });
          continue;
        }
        for (const row of [...intervals[i], ...intervals[j]]) {
          row.day.codes.add('INTERVAL_CONFLICT');
          row.record.resolution = 'unresolved';
          row.record.effectiveHours = null;
        }
      }
    }
    for (const { normal, leave } of unpaidReplacements) {
      if (normal[0].record.resolution !== 'usable' || leave[0].record.resolution !== 'usable') continue;
      for (const { record } of normal) {
        record.resolution = 'covered';
        record.effectiveHours = '0';
      }
    }
  }
  for (const day of days) {
    const notRequired = day.records.filter(
      (record) => record.resolution === 'usable' && record.type === 'not_required',
    );
    if (
      notRequired.length &&
      (day.required !== false ||
        day.records.some((record) => record.resolution === 'usable' && record.type !== 'not_required'))
    ) {
      day.codes.add('REQUIREMENT_CONFLICT');
      for (const record of day.records.filter((record) => record.resolution === 'usable')) {
        record.resolution = 'unresolved';
        record.effectiveHours = null;
      }
    }
    const approved = day.records
      .filter(
        (record) =>
          record.resolution === 'usable' &&
          replacements.includes(record.type) &&
          record.effectiveHours !== null &&
          new Prisma.Decimal(record.effectiveHours).gt(0),
      )
      .sort((a, b) => compareTime(a.startsAt, b.startsAt));
    for (const missing of day.records.filter(
      (record) => record.type === 'missing_punch' && record.state === 'effective',
    )) {
      // Coverage follows explicit intervals, not a fabricated daily-hours conversion or sum of overlapping hours.
      if (!eligibleMissing.has(missing)) {
        day.codes.add('MISSING_PUNCH');
        continue;
      }
      let coveredUntil = missing.startsAt;
      for (const record of approved) {
        if (compareTime(record.startsAt, coveredUntil) > 0) break;
        if (compareTime(record.endsAt, coveredUntil) > 0) coveredUntil = record.endsAt;
      }
      if (compareTime(coveredUntil, missing.endsAt) >= 0) {
        missing.resolution = 'covered';
        missing.effectiveHours = '0';
      } else {
        day.codes.add('MISSING_PUNCH');
      }
    }
  }
}

/** Pure, fail-closed normalization. Any issue requires reconciliation before sealing payroll input. */
export function normalizeAttendance(input: PayrollAttendanceInput): PayrollAttendanceResult {
  if (typeof input.month !== 'string' || !validDate(`${input.month}-01`)) {
    throw new RangeError('month must be a real YYYY-MM calendar month');
  }
  const days = new Map<string, WorkingDay>();
  const dayFor = (employeeId: string, workDate: string): WorkingDay => {
    const id = identity(employeeId, workDate);
    let day = days.get(id);
    if (!day) {
      day = {
        employeeId,
        workDate,
        units: null,
        required: null,
        records: [],
        issues: [],
        expected: false,
        codes: new Set(),
      };
      if (typeof employeeId !== 'string' || !employeeId.trim()) day.codes.add('INVALID_EMPLOYEE_ID');
      if (!validDate(workDate)) day.codes.add('INVALID_WORK_DATE');
      else if (!workDate.startsWith(`${input.month}-`)) day.codes.add('OUTSIDE_MONTH');
      days.set(id, day);
    }
    return day;
  };
  const expectations = new Map<string, Set<string>>();
  for (const expected of input.expected) {
    const day = dayFor(expected.employeeId, expected.workDate);
    const units = decimal(expected.units);
    const required = typeof expected.required === 'boolean' ? expected.required : null;
    if (units === null) day.codes.add('INVALID_EXPECTED_UNITS');
    if (required === null) day.codes.add('INVALID_REQUIREMENT');
    const id = identity(day.employeeId, day.workDate);
    const variants = expectations.get(id) ?? new Set<string>();
    variants.add(key([units, required]));
    expectations.set(id, variants);
    day.expected = true;
    if (variants.size > 1) {
      day.codes.add('EXPECTED_CONFLICT');
      day.units = null;
      day.required = null;
    } else {
      day.units = units;
      day.required = required;
    }
  }
  const sources = new Map<string, Candidate[]>();
  const eligibleMissing = new Set<PayrollNormalizedAttendanceRecord>();
  for (const source of input.records) {
    const candidate = sanitize(source);
    const rows = sources.get(source.sourceId) ?? [];
    rows.push(candidate);
    sources.set(source.sourceId, rows);
  }
  for (const rows of sources.values()) {
    const revisions = new Map<number | null, Map<string, Candidate>>();
    for (const candidate of rows) {
      const variants = revisions.get(candidate.record.sourceVersion) ?? new Map<string, Candidate>();
      variants.set(key(candidate.record), candidate);
      revisions.set(candidate.record.sourceVersion, variants);
    }
    for (const variants of revisions.values()) {
      if (variants.size > 1)
        for (const { record } of variants.values()) {
          dayFor(record.employeeId, record.workDate).codes.add('SOURCE_VERSION_CONFLICT');
        }
    }
    const versions = [...revisions.keys()].filter((version): version is number => version !== null);
    const latest = versions.length ? versions.reduce((a, b) => Math.max(a, b)) : null;
    const selected = [...(revisions.get(latest)?.values() ?? [])];
    if (latest !== null) selected.push(...(revisions.get(null)?.values() ?? []));
    for (const { record, problems } of selected) {
      const day = dayFor(record.employeeId, record.workDate);
      if (!day.expected) day.codes.add('UNEXPECTED_RECORD');
      for (const problem of problems) day.codes.add(problem);
      if (record.state === 'pending') day.codes.add('PENDING_APPROVAL');
      if (record.state === 'revoked') day.codes.add('REVOKED_RECORD');
      if (record.unit === 'day') day.codes.add('DAY_CONVERSION_REQUIRED');
      else if (record.unit !== 'hour') day.codes.add('UNKNOWN_UNIT');
      const invalidDay =
        !day.expected ||
        day.units === null ||
        day.required === null ||
        !validDate(day.workDate) ||
        !day.workDate.startsWith(`${input.month}-`);
      if (!invalidDay && !problems.length && (revisions.get(record.sourceVersion)?.size ?? 0) === 1) {
        if (record.state !== 'effective') record.resolution = 'inactive';
        else if (record.unit === 'hour' && record.type === 'missing_punch') eligibleMissing.add(record);
        else if (record.unit === 'hour') {
          record.resolution = 'usable';
          record.effectiveHours = record.type === 'not_required' ? '0' : record.hours;
          if (record.type === 'not_required' && new Prisma.Decimal(record.hours).gt(0)) {
            day.codes.add('REQUIREMENT_CONFLICT');
            record.resolution = 'unresolved';
            record.effectiveHours = null;
          }
        }
      }
      day.records.push(record);
    }
  }
  resolveIntervals([...days.values()], eligibleMissing);
  const normalizedDays = [...days.values()]
    .sort((a, b) => compare(identity(a.employeeId, a.workDate), identity(b.employeeId, b.workDate)))
    .map(({ expected, codes, ...day }) => {
      const coverage = day.records.filter(record => record.state !== 'superseded' && record.state !== 'cancelled');
      if (expected && day.required && !coverage.length) codes.add('MISSING_RECORD');
      if (expected && day.required && coverage.length && coverage.every((record) => record.type === 'overtime')) {
        codes.add('MISSING_REGULAR_COVERAGE');
      }
      return {
        ...day,
        records: day.records.sort((a, b) => compare(key(a), key(b))),
        issues: [...codes].sort(compare),
      };
    });
  const issues = normalizedDays.flatMap((day) =>
    day.issues.map((code) => ({
      employeeId: day.employeeId,
      workDate: day.workDate,
      code,
      message: messages[code],
    })),
  );
  const result = { month: input.month, days: normalizedDays, issues };
  return {
    ...result,
    version: createHash('sha256')
      .update(key(['payroll-attendance-v1', result]))
      .digest('hex'),
  };
}
