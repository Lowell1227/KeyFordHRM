import { demoId } from './ids';

describe('realistic demo deterministic IDs', () => {
  it('returns stable UUIDv5 values and separates entity kinds', () => {
    expect(demoId('user', 'FD210101')).toBe(demoId('user', 'FD210101'));
    expect(demoId('user', 'FD210101')).not.toBe(demoId('task', 'FD210101'));
    expect(demoId('user', 'FD210101')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
