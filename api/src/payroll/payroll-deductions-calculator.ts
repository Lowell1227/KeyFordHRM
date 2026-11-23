import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface PayrollDeductionRule {
  ruleVersion: string;
  evidenceRef: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PayrollContributionRule extends PayrollDeductionRule {
  status: 'applicable' | 'not_applicable';
  contributionDate: string;
  items: Array<{ code: string; base: string; rate: string }>;
}

export interface PayrollTaxDeductions {
  exemptIncome: string;
  standardDeduction: string;
  specialDeduction: string;
  additionalDeduction: string;
  otherDeduction: string;
  taxRelief: string;
}

export interface PayrollTaxOpening extends PayrollTaxDeductions {
  subjectId: string;
  employeeId: string;
  year: number;
  sourceVersion: string;
  evidenceRef: string;
  confirmed: boolean;
  income: string;
  taxPaid: string;
}

export interface PayrollTaxBracket {
  upTo: string | null;
  rate: string;
  quickDeduction: string;
}

export interface PayrollTaxRule extends PayrollDeductionRule {
  method: string;
  brackets: PayrollTaxBracket[];
  opening: PayrollTaxOpening;
  current: PayrollTaxDeductions;
}

export interface PayrollDeductionsInput {
  subjectId: string;
  employeeId: string;
  payDate: string;
  gross: string;
  rounding: 'component_half_up';
  socialInsurance: PayrollContributionRule;
  housingFund: PayrollContributionRule;
  tax: PayrollTaxRule;
}

export interface PayrollContributionEvidence {
  entries: Array<{
    code: string;
    unroundedAmount: string;
    amount: string;
  }>;
  amount: string;
}

export interface PayrollDeductionsResult {
  status: 'ready' | 'needs_configuration' | 'needs_review';
  issues: string[];
  gross: string | null;
  socialInsurance: string | null;
  housingFund: string | null;
  incomeTax: string | null;
  net: string | null;
  evidence: {
    sourceHash: string | null;
    input: unknown;
    parameter?: { id: string; version: number; releaseId: string; snapshotHash: string };
    grossUnrounded?: string;
    socialInsurance?: PayrollContributionEvidence;
    housingFund?: PayrollContributionEvidence;
    tax?: {
      taxYear: number;
      cumulative: PayrollTaxDeductions & { income: string; taxPaid: string };
      taxableBeforeFloor: string;
      taxableIncome: string;
      bracketIndex: number;
      unroundedTaxBeforeRelief: string;
      unroundedBalance: string;
      carryForwardCredit: string;
    };
    unroundedNet?: string;
  };
}

export function calculatePayrollDeductions(
  input: PayrollDeductionsInput,
): PayrollDeductionsResult {
  const issues: string[] = [];
  const result: PayrollDeductionsResult = {
    status: 'needs_configuration',
    issues,
    gross: null,
    socialInsurance: null,
    housingFund: null,
    incomeTax: null,
    net: null,
    evidence: { sourceHash: null, input: null },
  };
  const D = Prisma.Decimal.clone({
    precision: 40,
    rounding: Prisma.Decimal.ROUND_HALF_UP,
    minE: -9000000000000000,
    maxE: 9000000000000000,
  });

  // Sort object keys, preserve array order and exact input strings; reject lossy JSON coercions.
  function canonical(
    value: unknown,
    path: string,
    ancestors = new Set<object>(),
  ): string {
    if (value === null) return 'null';
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return JSON.stringify(value);
    if (
      typeof value !== 'object' ||
      ancestors.has(value) ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length
    ) {
      throw new Error(`${path}: a finite, acyclic JSON value is required`);
    }
    ancestors.add(value);
    const keys = Object.keys(value);
    let encoded: string;
    if (Array.isArray(value)) {
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        throw new Error(`${path}: a dense JSON array is required`);
      }
      encoded = `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`, ancestors)).join(',')}]`;
    } else {
      encoded = `{${keys
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`, ancestors)}`,
        )
        .join(',')}}`;
    }
    ancestors.delete(value);
    return encoded;
  }

  try {
    const encoded = canonical(input, 'input');
    result.evidence.sourceHash = createHash('sha256')
      .update(encoded)
      .digest('hex');
    result.evidence.input = JSON.parse(encoded);
    // All operations are finite sums/products; input length bounds the precision they need.
    D.set({ precision: Math.max(40, encoded.length * 2) });
  } catch (error) {
    issues.push(
      error instanceof Error ? error.message : 'input: invalid JSON input',
    );
  }

  function object(value: unknown, path: string): Record<string, unknown> {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    ) {
      return value as Record<string, unknown>;
    }
    issues.push(`${path}: an explicit object is required`);
    return {};
  }

  function text(value: unknown, path: string): value is string {
    if (typeof value === 'string' && value.length > 0 && value.trim() === value)
      return true;
    issues.push(
      `${path}: a nonempty string without surrounding whitespace is required`,
    );
    return false;
  }

  function amount(
    value: unknown,
    path: string,
    rate = false,
  ): Prisma.Decimal | null {
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      !(rate ? /^\d+(?:\.\d+)?$/ : /^\d{1,12}(?:\.\d{1,4})?$/).test(value)
    ) {
      issues.push(
        `${path}: an explicit nonnegative fixed-point ${rate ? 'rate' : 'amount (12 integer and 4 decimal digits maximum)'} is required`,
      );
      return null;
    }
    const parsed = new D(value);
    if (!parsed.isFinite() || (rate && parsed.gt(1))) {
      issues.push(
        `${path}: ${rate ? 'rate must be between 0 and 1' : 'amount must be finite'}`,
      );
      return null;
    }
    return parsed;
  }

  function date(value: unknown, path: string): value is string {
    if (
      typeof value === 'string' &&
      value.length === 10 &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !value.startsWith('0000')
    ) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      )
        return true;
    }
    issues.push(`${path}: a real ISO calendar date is required`);
    return false;
  }

  function rule(
    value: Record<string, unknown>,
    path: string,
    referenceDate: unknown,
  ) {
    text(value.ruleVersion, `${path}.ruleVersion`);
    text(value.evidenceRef, `${path}.evidenceRef`);
    const fromValid = date(value.effectiveFrom, `${path}.effectiveFrom`);
    const toValid =
      value.effectiveTo === null ||
      date(value.effectiveTo, `${path}.effectiveTo`);
    if (
      fromValid &&
      toValid &&
      ((value.effectiveTo !== null &&
        (value.effectiveFrom as string) > (value.effectiveTo as string)) ||
        (typeof referenceDate === 'string' &&
          (referenceDate < (value.effectiveFrom as string) ||
            (value.effectiveTo !== null &&
              referenceDate > (value.effectiveTo as string)))))
    ) {
      issues.push(
        `${path}.effectiveFrom/effectiveTo: rule must cover its reference date inclusively`,
      );
    }
  }

  const source = object(input, 'input');
  text(source.subjectId, 'subjectId');
  text(source.employeeId, 'employeeId');
  const payDateValid = date(source.payDate, 'payDate');
  const gross = amount(source.gross, 'gross');
  if (source.rounding !== 'component_half_up')
    issues.push('rounding: component_half_up must be explicitly selected');

  function contribution(field: 'socialInsurance' | 'housingFund') {
    const value = object(source[field], field);
    const validDate = date(value.contributionDate, `${field}.contributionDate`);
    rule(value, field, validDate ? value.contributionDate : null);
    if (value.status !== 'applicable' && value.status !== 'not_applicable') {
      issues.push(
        `${field}.status: applicable or not_applicable must be explicitly selected`,
      );
    }
    const entries: Array<{
      code: string;
      base: Prisma.Decimal;
      rate: Prisma.Decimal;
    }> = [];
    if (!Array.isArray(value.items)) {
      issues.push(`${field}.items: an explicit array is required`);
      return entries;
    }
    if (
      (value.status === 'applicable' && value.items.length === 0) ||
      (value.status === 'not_applicable' && value.items.length !== 0)
    ) {
      issues.push(
        `${field}.items: applicable requires items; not_applicable requires no items`,
      );
    }
    const codes = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      const path = `${field}.items[${index}]`;
      const entry = object(item, path);
      const codeValid = text(entry.code, `${path}.code`);
      if (codeValid) {
        if (codes.has(entry.code as string))
          issues.push(`${path}.code: duplicate contribution code`);
        codes.add(entry.code as string);
      }
      const base = amount(entry.base, `${path}.base`);
      const rate = amount(entry.rate, `${path}.rate`, true);
      if (codeValid && base && rate)
        entries.push({ code: entry.code as string, base, rate });
    }
    return entries;
  }

  const social = contribution('socialInsurance');
  const housing = contribution('housingFund');
  const tax = object(source.tax, 'tax');
  rule(tax, 'tax', payDateValid ? source.payDate : null);
  if (tax.method !== 'resident_cumulative_wage') {
    issues.push(
      'tax.method: only explicitly selected resident_cumulative_wage is supported',
    );
  }
  const opening = object(tax.opening, 'tax.opening');
  const current = object(tax.current, 'tax.current');
  for (const field of ['subjectId', 'employeeId'] as const) {
    if (
      !text(opening[field], `tax.opening.${field}`) ||
      opening[field] !== source[field]
    ) {
      issues.push(`tax.opening.${field}: must match the payment identity`);
    }
  }
  const year = payDateValid
    ? Number((source.payDate as string).slice(0, 4))
    : null;
  if (!Number.isInteger(opening.year) || opening.year !== year) {
    issues.push(
      'tax.opening.year: confirmed opening must match the payment calendar year',
    );
  }
  if (opening.confirmed !== true)
    issues.push('tax.opening.confirmed: confirmed=true is required');
  text(opening.sourceVersion, 'tax.opening.sourceVersion');
  text(opening.evidenceRef, 'tax.opening.evidenceRef');
  const deductionFields = [
    'exemptIncome',
    'standardDeduction',
    'specialDeduction',
    'additionalDeduction',
    'otherDeduction',
    'taxRelief',
  ] as const;
  const openingAmounts: Record<string, Prisma.Decimal | null> = {};
  const currentAmounts: Record<string, Prisma.Decimal | null> = {};
  for (const field of [...deductionFields, 'income', 'taxPaid']) {
    openingAmounts[field] = amount(opening[field], `tax.opening.${field}`);
  }
  for (const field of deductionFields)
    currentAmounts[field] = amount(current[field], `tax.current.${field}`);
  for (const field of Object.keys(current)) {
    if (!(deductionFields as readonly string[]).includes(field)) {
      issues.push(
        `tax.current.${field}: not a supported current deduction fact`,
      );
    }
  }

  const brackets: Array<{
    upTo: Prisma.Decimal | null;
    rate: Prisma.Decimal;
    quickDeduction: Prisma.Decimal;
  }> = [];
  if (!Array.isArray(tax.brackets) || tax.brackets.length === 0) {
    issues.push('tax.brackets: a nonempty complete tax table is required');
  } else {
    for (const [index, item] of tax.brackets.entries()) {
      const path = `tax.brackets[${index}]`;
      const entry = object(item, path);
      const last = index === tax.brackets.length - 1;
      const upTo =
        entry.upTo === null ? null : amount(entry.upTo, `${path}.upTo`);
      const rate = amount(entry.rate, `${path}.rate`, true);
      const quickDeduction = amount(
        entry.quickDeduction,
        `${path}.quickDeduction`,
      );
      if ((entry.upTo === null) !== last)
        issues.push(
          `${path}.upTo: only the last bracket must have an unlimited upper bound`,
        );
      if (
        upTo &&
        (upTo.lte(0) ||
          (brackets[index - 1]?.upTo && upTo.lte(brackets[index - 1].upTo!)))
      ) {
        issues.push(
          `${path}.upTo: finite upper bounds must be strictly increasing and positive`,
        );
      }
      if (rate && quickDeduction) {
        if (index === 0 && !quickDeduction.isZero())
          issues.push(
            `${path}.quickDeduction: the first bracket must cover zero continuously`,
          );
        const previous = brackets[index - 1];
        if (
          previous?.upTo &&
          !quickDeduction.eq(
            previous.quickDeduction.plus(
              previous.upTo.times(rate.minus(previous.rate)),
            ),
          )
        ) {
          issues.push(
            `${path}.quickDeduction: adjacent brackets must be continuous`,
          );
        }
        brackets.push({ upTo, rate, quickDeduction });
      }
    }
  }

  if (issues.length || !gross) return result;
  const sum = (values: Prisma.Decimal[]) =>
    values.reduce((total, value) => total.plus(value), new D(0));
  const rounded = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(2, D.ROUND_HALF_UP);
  const money = (value: Prisma.Decimal) =>
    (value.isZero() ? new D(0) : value).toFixed(2);
  const positive = (value: Prisma.Decimal) => D.max(0, value);
  function calculateContribution(
    entries: typeof social,
  ): PayrollContributionEvidence {
    const calculated = entries.map((entry) => {
      const raw = entry.base.times(entry.rate);
      return {
        code: entry.code,
        unroundedAmount: raw.toFixed(),
        amount: money(rounded(raw)),
      };
    });
    return {
      entries: calculated,
      amount: money(sum(calculated.map((entry) => new D(entry.amount)))),
    };
  }

  const payableGross = rounded(gross);
  const socialEvidence = calculateContribution(social);
  const housingEvidence = calculateContribution(housing);
  const cumulative: Record<string, Prisma.Decimal> = {
    income: openingAmounts.income!.plus(payableGross),
    taxPaid: openingAmounts.taxPaid!,
  };
  for (const field of deductionFields)
    cumulative[field] = openingAmounts[field]!.plus(currentAmounts[field]!);
  const taxableBeforeFloor = cumulative.income.minus(
    sum(
      deductionFields
        .filter((field) => field !== 'taxRelief')
        .map((field) => cumulative[field]),
    ),
  );
  const taxableIncome = positive(taxableBeforeFloor);
  const bracketIndex = brackets.findIndex(
    (entry) => entry.upTo === null || taxableIncome.lte(entry.upTo),
  );
  const bracket = brackets[bracketIndex];
  const taxBeforeRelief = taxableIncome
    .times(bracket.rate)
    .minus(bracket.quickDeduction);
  const balance = taxBeforeRelief
    .minus(cumulative.taxRelief)
    .minus(cumulative.taxPaid);
  const incomeTax = rounded(positive(balance));
  const net = payableGross
    .minus(socialEvidence.amount)
    .minus(housingEvidence.amount)
    .minus(incomeTax);
  result.evidence.grossUnrounded = source.gross as string;
  result.evidence.socialInsurance = socialEvidence;
  result.evidence.housingFund = housingEvidence;
  result.evidence.tax = {
    taxYear: year!,
    cumulative: {
      income: cumulative.income.toFixed(),
      exemptIncome: cumulative.exemptIncome.toFixed(),
      standardDeduction: cumulative.standardDeduction.toFixed(),
      specialDeduction: cumulative.specialDeduction.toFixed(),
      additionalDeduction: cumulative.additionalDeduction.toFixed(),
      otherDeduction: cumulative.otherDeduction.toFixed(),
      taxRelief: cumulative.taxRelief.toFixed(),
      taxPaid: cumulative.taxPaid.toFixed(),
    },
    taxableBeforeFloor: taxableBeforeFloor.toFixed(),
    taxableIncome: taxableIncome.toFixed(),
    bracketIndex,
    unroundedTaxBeforeRelief: taxBeforeRelief.toFixed(),
    unroundedBalance: balance.toFixed(),
    carryForwardCredit: money(rounded(positive(balance.negated()))),
  };
  result.evidence.unroundedNet = net.toFixed();
  if (net.lt(0)) {
    result.status = 'needs_review';
    issues.push(
      'net: negative net requires review; no payable amounts are released',
    );
    return result;
  }
  return {
    ...result,
    status: 'ready',
    gross: money(payableGross),
    socialInsurance: socialEvidence.amount,
    housingFund: housingEvidence.amount,
    incomeTax: money(incomeTax),
    net: money(net),
  };
}
