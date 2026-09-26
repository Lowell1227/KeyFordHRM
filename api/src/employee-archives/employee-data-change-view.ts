import { Prisma } from '@prisma/client';
import { shanghaiBusinessDate } from './employment-timeline';

export const activeApplicationWhere = (): Prisma.EmployeeDataChangeRequestWhereInput => ({
  recordStatus: 'submitted', archivedAt: null, cancelledAt: null,
  OR: [
    { profileReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
    { performanceReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
    { onboardingStatus: 'pending_entry' },
    { sourceType: 'manual_employment_change', profileReviewStatus: 'approved', appliedAt: null,
      employmentRecords: { some: { effectiveFrom: { gt: shanghaiBusinessDate() } } } },
  ],
});

const SENSITIVE_PROFILE_KEYS = new Set([
  'passwordHash',
  'password',
  'idNumber',
  'bankAccount',
  'idNumberEncrypted',
  'idNumberFingerprint',
  'bankAccountEncrypted',
  'bankAccountFingerprint',
]);

function sanitizeJson(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const idNumberConfigured = Boolean(source.idNumberConfigured
    || source.idNumberEncrypted
    || source.idNumberFingerprint);
  const bankAccountConfigured = Boolean(source.bankAccountConfigured
    || source.bankAccountEncrypted
    || source.bankAccountFingerprint);

  for (const [key, item] of Object.entries(source)) {
    if (SENSITIVE_PROFILE_KEYS.has(key)) continue;
    result[key] = sanitizeJson(item);
  }
  if ('idNumberConfigured' in source || 'idNumberEncrypted' in source || 'idNumberFingerprint' in source) {
    result.idNumberConfigured = idNumberConfigured;
  }
  if ('bankAccountConfigured' in source || 'bankAccountEncrypted' in source || 'bankAccountFingerprint' in source) {
    result.bankAccountConfigured = bankAccountConfigured;
  }
  return result;
}

export function employeeDataChangeView<T extends Record<string, any>>(request: T): T {
  return sanitizeJson(request) as T;
}

export function employeeArchiveView<T extends Record<string, any>>(archive: T): T {
  return sanitizeJson(archive) as T;
}
