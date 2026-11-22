import { Prisma } from '@prisma/client';

export interface PayrollSegment {
  from: string;
  to: string;
  units: string;
  monthUnits: string;
  fixedMonthly: string | null;
  performanceBase: string | null;
  performanceMode: 'included' | 'additional' | 'none';
  coefficient: string | null;
}

export interface PayrollAbsence {
  hours: string;
  normalHourly: string;
  paidHourly: string;
}

export interface PayrollOvertime {
  hours: string;
  hourlyBase: string;
  multiplier: string;
}

export interface PayrollAdjustment {
  amount: string;
  reason: string;
}

export interface PayrollCalculationInput {
  segments: PayrollSegment[];
  absences: PayrollAbsence[];
  overtime: PayrollOvertime[];
  adjustments: PayrollAdjustment[];
}

export interface PayrollSegmentEvidence {
  index: number;
  input: PayrollSegment;
  ratio: string;
  fixedBase: string;
  amount: string;
}

export interface PayrollPerformanceEvidence {
  index: number;
  input: PayrollSegment;
  ratio: string;
  performanceBase: string;
  amount: string;
}

export interface PayrollAbsenceEvidence {
  index: number;
  input: PayrollAbsence;
  hourlyDifference: string;
  amount: string;
}

export interface PayrollOvertimeEvidence {
  index: number;
  input: PayrollOvertime;
  amount: string;
}

export interface PayrollAdjustmentEvidence {
  index: number;
  input: PayrollAdjustment;
  amount: string;
}

export interface PayrollCalculationItem {
  code: 'fixed' | 'absence' | 'overtime' | 'performance' | 'adjustment';
  amount: string;
  evidence: {
    formula: string;
    unroundedAmount: string;
    entries: Array<
      | PayrollSegmentEvidence
      | PayrollPerformanceEvidence
      | PayrollAbsenceEvidence
      | PayrollOvertimeEvidence
      | PayrollAdjustmentEvidence
    >;
  };
}

export interface PayrollCalculationResult {
  status: 'ready' | 'needs_configuration';
  issues: string[];
  items: PayrollCalculationItem[];
  gross: string | null;
}

export function calculatePayroll(
  input: PayrollCalculationInput,
): PayrollCalculationResult {
  const issues: string[] = [];
  const items: PayrollCalculationItem[] = [];
  const Decimal = Prisma.Decimal.clone({
    precision: 40,
    rounding: Prisma.Decimal.ROUND_HALF_UP,
    minE: -9000000000000000,
    maxE: 9000000000000000,
  });
  let precision = 40;

  function decimal(
    value: string | null | undefined,
    path: string,
    nonnegative = true,
  ): Prisma.Decimal | null {
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)
    ) {
      issues.push(`${path}: a finite decimal string is required`);
      return null;
    }
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || (nonnegative && parsed.lt(0))) {
      issues.push(`${path}: a finite nonnegative value is required`);
      return null;
    }
    precision += value.length;
    return parsed;
  }

  function date(value: string, path: string): boolean {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      ) {
        return true;
      }
    }
    issues.push(`${path}: a real ISO calendar date is required`);
    return false;
  }

  function collection<T, R>(
    value: T[],
    path: string,
    read: (entry: T, index: number) => R,
  ): { data: R[]; valid: boolean } {
    const start = issues.length;
    const data: R[] = [];
    if (!Array.isArray(value)) {
      issues.push(`${path}: an explicit array is required`);
    } else {
      for (const [index, entry] of value.entries()) {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          Array.isArray(entry)
        ) {
          issues.push(`${path}[${index}]: an object is required`);
        } else {
          data.push(read(entry, index));
        }
      }
    }
    return { data, valid: issues.length === start };
  }

  const segments = collection(input?.segments, 'segments', (entry, index) => {
    const path = `segments[${index}]`;
    const fromValid = date(entry.from, `${path}.from`);
    const toValid = date(entry.to, `${path}.to`);
    if (fromValid && toValid) {
      if (entry.from > entry.to)
        issues.push(`${path}: from must not be after to`);
      if (entry.from.slice(0, 7) !== entry.to.slice(0, 7)) {
        issues.push(`${path}: dates must be in the same calendar month`);
      }
    }
    if (!['included', 'additional', 'none'].includes(entry.performanceMode)) {
      issues.push(
        `${path}.performanceMode: included, additional or none is required`,
      );
    }
    const units = decimal(entry.units, `${path}.units`);
    const monthUnits = decimal(entry.monthUnits, `${path}.monthUnits`);
    if (monthUnits?.isZero())
      issues.push(`${path}.monthUnits: must be greater than zero`);
    const fixedMonthly = decimal(entry.fixedMonthly, `${path}.fixedMonthly`);
    const usesPerformance =
      entry.performanceMode === 'included' ||
      entry.performanceMode === 'additional';
    const performanceBase =
      usesPerformance || entry.performanceBase != null
        ? decimal(entry.performanceBase, `${path}.performanceBase`)
        : null;
    const coefficient =
      usesPerformance || entry.coefficient != null
        ? decimal(entry.coefficient, `${path}.coefficient`)
        : null;
    if (
      entry.performanceMode === 'included' &&
      performanceBase &&
      fixedMonthly &&
      performanceBase.gt(fixedMonthly)
    ) {
      issues.push(
        `${path}.performanceBase: included performance must not exceed fixedMonthly`,
      );
    }
    return {
      index,
      input: {
        from: entry.from,
        to: entry.to,
        units: entry.units,
        monthUnits: entry.monthUnits,
        fixedMonthly: entry.fixedMonthly,
        performanceBase: entry.performanceBase ?? null,
        performanceMode: entry.performanceMode,
        coefficient: entry.coefficient ?? null,
      },
      units,
      monthUnits,
      fixedMonthly,
      performanceBase,
      coefficient,
    };
  });
  if (segments.data.length === 0 && segments.valid) {
    issues.push(
      'segments: at least one explicitly configured salary segment is required',
    );
    segments.valid = false;
  }

  const absences = collection(input?.absences, 'absences', (entry, index) => ({
    index,
    input: {
      hours: entry.hours,
      normalHourly: entry.normalHourly,
      paidHourly: entry.paidHourly,
    },
    hours: decimal(entry.hours, `absences[${index}].hours`),
    normalHourly: decimal(
      entry.normalHourly,
      `absences[${index}].normalHourly`,
    ),
    paidHourly: decimal(entry.paidHourly, `absences[${index}].paidHourly`),
  }));
  const overtime = collection(input?.overtime, 'overtime', (entry, index) => ({
    index,
    input: {
      hours: entry.hours,
      hourlyBase: entry.hourlyBase,
      multiplier: entry.multiplier,
    },
    hours: decimal(entry.hours, `overtime[${index}].hours`),
    hourlyBase: decimal(entry.hourlyBase, `overtime[${index}].hourlyBase`),
    multiplier: decimal(entry.multiplier, `overtime[${index}].multiplier`),
  }));
  const adjustments = collection(
    input?.adjustments,
    'adjustments',
    (entry, index) => {
      const amount = decimal(
        entry.amount,
        `adjustments[${index}].amount`,
        false,
      );
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
        issues.push(
          `adjustments[${index}].reason: an explicit reason is required`,
        );
      }
      return {
        index,
        input: { amount: entry.amount, reason: entry.reason },
        amount,
      };
    },
  );

  // Keep multiplication and summation exact at input scale, without global Decimal configuration changes.
  Decimal.set({ precision });
  const sum = (values: Prisma.Decimal[]) =>
    values.reduce((total, value) => total.plus(value), new Decimal(0));
  function money(value: Prisma.Decimal): string {
    const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return rounded.isZero() ? '0.00' : rounded.toFixed(2);
  }
  function add(
    code: PayrollCalculationItem['code'],
    amount: Prisma.Decimal,
    entries: PayrollCalculationItem['evidence']['entries'],
    formula: string,
  ) {
    items.push({
      code,
      amount: money(amount),
      evidence: { formula, unroundedAmount: amount.toFixed(), entries },
    });
  }

  if (segments.valid) {
    const start = issues.length;
    const denominator = segments.data[0].monthUnits!;
    const month = segments.data[0].input.from.slice(0, 7);
    for (const entry of segments.data) {
      if (entry.input.from.slice(0, 7) !== month) {
        issues.push(
          `segments[${entry.index}]: all segments must share the same calendar month`,
        );
      }
      if (!entry.monthUnits!.eq(denominator)) {
        issues.push(
          `segments[${entry.index}].monthUnits: must match the other segments`,
        );
      }
    }
    if (sum(segments.data.map((entry) => entry.units!)).gt(denominator)) {
      issues.push('segments.units: total must not exceed monthUnits');
    }
    const ordered = [...segments.data].sort((left, right) =>
      left.input.from.localeCompare(right.input.from),
    );
    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index].input.from <= ordered[index - 1].input.to) {
        issues.push(
          `segments[${ordered[index].index}]: inclusive dates overlap another segment`,
        );
      }
    }
    if (issues.length === start) {
      const fixed = segments.data.map((entry) => {
        const base =
          entry.input.performanceMode === 'included'
            ? entry.fixedMonthly!.minus(entry.performanceBase!)
            : entry.fixedMonthly!;
        const numerator = base.times(entry.units!);
        return {
          numerator,
          evidence: {
            index: entry.index,
            input: entry.input,
            ratio: entry.units!.div(denominator).toFixed(),
            fixedBase: base.toFixed(),
            amount: numerator.div(denominator).toFixed(),
          },
        };
      });
      // A common denominator avoids rounding repeating segment fractions before the item total.
      add(
        'fixed',
        sum(fixed.map((entry) => entry.numerator)).div(denominator),
        fixed.map((entry) => entry.evidence),
        'sum(fixedBase * units) / monthUnits',
      );
      const performance = segments.data
        .filter((entry) => entry.input.performanceMode !== 'none')
        .map((entry) => {
          const numerator = entry
            .performanceBase!.times(entry.units!)
            .times(entry.coefficient!);
          return {
            numerator,
            evidence: {
              index: entry.index,
              input: { ...entry.input },
              ratio: entry.units!.div(denominator).toFixed(),
              performanceBase: entry.performanceBase!.toFixed(),
              amount: numerator.div(denominator).toFixed(),
            },
          };
        });
      if (performance.length) {
        add(
          'performance',
          sum(performance.map((entry) => entry.numerator)).div(denominator),
          performance.map((entry) => entry.evidence),
          'sum(performanceBase * units * coefficient) / monthUnits',
        );
      }
    }
  }
  if (absences.valid && absences.data.length) {
    const entries = absences.data.map((entry) => {
      const difference = entry.paidHourly!.minus(entry.normalHourly!);
      return {
        index: entry.index,
        input: entry.input,
        hourlyDifference: difference.toFixed(),
        amount: entry.hours!.times(difference).toFixed(),
      };
    });
    add(
      'absence',
      sum(entries.map((entry) => new Decimal(entry.amount))),
      entries,
      'sum(hours * (paidHourly - normalHourly))',
    );
  }
  if (overtime.valid && overtime.data.length) {
    const entries = overtime.data.map((entry) => ({
      index: entry.index,
      input: entry.input,
      amount: entry
        .hours!.times(entry.hourlyBase!)
        .times(entry.multiplier!)
        .toFixed(),
    }));
    add(
      'overtime',
      sum(entries.map((entry) => new Decimal(entry.amount))),
      entries,
      'sum(hours * hourlyBase * multiplier)',
    );
  }
  if (adjustments.valid && adjustments.data.length) {
    add(
      'adjustment',
      sum(adjustments.data.map((entry) => entry.amount!)),
      adjustments.data.map((entry) => ({
        index: entry.index,
        input: entry.input,
        amount: entry.amount!.toFixed(),
      })),
      'sum(authorized adjustment amounts)',
    );
  }
  return {
    status: issues.length ? 'needs_configuration' : 'ready',
    issues,
    items,
    gross: issues.length
      ? null
      : money(sum(items.map((entry) => new Decimal(entry.amount)))),
  };
}
