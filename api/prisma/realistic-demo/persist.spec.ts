import { normalizePersistedSystemPermission } from './persist';

describe('realistic demo persisted system permissions', () => {
  it.each([
    ['system_admin', 'system_admin'],
    ['hr', 'hr'],
    ['chairman', 'employee'],
    ['vp', 'employee'],
    ['dept_head', 'employee'],
    ['manager', 'employee'],
    ['employee', 'employee'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizePersistedSystemPermission(input)).toBe(expected);
  });
});
