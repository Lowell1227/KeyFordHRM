import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Employment record overlap schema', () => {
  it('allows overlapping employment records so overlap remains a review warning', () => {
    const migrationPath = resolve(
      __dirname,
      '../../prisma/migrations/20260915170000_allow_overlapping_employment_records/migration.sql',
    );

    expect(existsSync(migrationPath)).toBe(true);
    expect(readFileSync(migrationPath, 'utf8')).toContain(
      'DROP CONSTRAINT IF EXISTS "employment_records_no_overlap_excl"',
    );
  });
});
