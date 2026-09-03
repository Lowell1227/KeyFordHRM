import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('restore unsubmitted monthly self evaluations migration', () => {
  const sql = readFileSync(resolve(
    __dirname,
    '../../prisma/migrations/20260903000002_restore_unsubmitted_months/migration.sql',
  ), 'utf8');

  it('only repairs unopened results that have no employee or manager submission and are not published', () => {
    expect(sql).toContain('cycle."workflow_version" = 2');
    expect(sql).toContain('cycle."opened_at" IS NOT NULL');
    expect(sql).toContain('cycle."published_at" IS NULL');
    expect(sql).toContain('task."published_at" IS NULL');
    expect(sql).toContain('COALESCE(grade_result."is_published", FALSE) = FALSE');
    expect(sql).toContain('grade_result."published_at" IS NULL');
    expect(sql).toContain('period."status" = \'manager_scoring\'');
    expect(sql).toContain('period."employee_submitted_at" IS NULL');
    expect(sql).toContain('period."manager_submitted_at" IS NULL');
    expect(sql).toContain('period."locked_at" IS NULL');
  });

  it('restores the period and task state with an audit row without changing schedules or history', () => {
    expect(sql).toContain('UPDATE "assessment_periods"');
    expect(sql).toContain('"status" = \'self_eval\'');
    expect(sql).toContain('UPDATE "assessment_tasks"');
    expect(sql).toContain("'monthly_period_state_repaired'");
    expect(sql).toContain("'20260903000002_restore_unsubmitted_months'");
    expect(sql).not.toMatch(/UPDATE\s+"cycle_period_schedules"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
