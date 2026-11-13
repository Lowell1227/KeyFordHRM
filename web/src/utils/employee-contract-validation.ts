type Contract = Record<string, unknown>;
const dateFields = ['signedAt', 'effectiveFrom', 'expiresAt'] as const;

export function contractCalendarDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value)) ? day : null;
}

function comparable(key: string, value: unknown): string {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  if (dateFields.includes(key as typeof dateFields[number])) return contractCalendarDay(value) ?? String(value);
  return JSON.stringify(value);
}

export function validateContractDates(contract: Contract, previous?: Contract): Record<string, string> {
  // Unchanged legacy records may contain incomplete or invalid imported dates.
  if (previous && Object.entries(contract).every(([key, value]) => key.startsWith('__') || key === 'sequence'
    || comparable(key, value) === comparable(key, previous[key]))) return {};
  const errors: Record<string, string> = {};
  for (const key of dateFields) {
    if (contract[key] != null && contract[key] !== '' && !contractCalendarDay(contract[key])) errors[key] = '请填写有效日期';
  }
  const start = contractCalendarDay(contract.effectiveFrom), end = contractCalendarDay(contract.expiresAt);
  if (start && end && end < start) errors.expiresAt = '到期日期不能早于生效日期';
  return errors;
}
