import { payrollHash } from './payroll-transaction';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, ordered((value as Record<string, unknown>)[key])]));
  return value;
}

// JSONB does not preserve object-key order. Keep this versioned digest local to
// attendance; changing the shared hash would invalidate approved wage history.
export function payrollAttendanceHash(payload: unknown): string {
  return payrollHash({ attendanceDigestVersion: 2, payload: ordered(JSON.parse(JSON.stringify(payload))) });
}
