import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('improvement V3 score migration', () => {
  it('allows V2 and V3 percentage scores without changing the legacy ten point scale', () => {
    const path = resolve(__dirname, '../../prisma/migrations/20261117183000_improvement_v3_score/migration.sql');
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('"workflow_version" IN (2, 3)');
    expect(sql).toContain('"final_score" BETWEEN 0 AND 100');
    expect(sql).toContain('"workflow_version" = 1 AND "final_score" BETWEEN 1 AND 10');
  });
});
