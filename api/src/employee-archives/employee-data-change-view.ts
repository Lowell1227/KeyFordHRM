const SENSITIVE_PROFILE_KEYS = new Set([
  'idNumberEncrypted',
  'idNumberFingerprint',
  'bankAccountEncrypted',
  'bankAccountFingerprint',
]);

function sanitizeJson(value: unknown): unknown {
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
  return {
    ...request,
    baseValue: sanitizeJson(request.baseValue),
    proposedValue: sanitizeJson(request.proposedValue),
    revisionHistory: sanitizeJson(request.revisionHistory),
  } as T;
}
