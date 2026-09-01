import { FlowAction, IndicatorVisibilityScope } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('indicator visibility Prisma contract', () => {
  it('exports every supported scope and withdraw action', () => {
    expect(Object.values(IndicatorVisibilityScope)).toEqual([
      'company',
      'department',
      'department_tree',
      'direct_reports',
      'all_reports',
      'supervisors',
      'custom',
    ]);
    expect(FlowAction.withdraw).toBe('withdraw');
  });
});

describe('performance workflow v2 schema', () => {
  it('declares the backward-compatible v2 persistence contract', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

    expect(schema).toMatch(/workflowVersion\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/scoringFrequency\s+ScoringFrequency\s+@default\(cycle\)/);
    expect(schema).toContain('model CyclePeriodSchedule');
    expect(schema).toContain('model AssessmentPeriod');
    expect(schema).toContain('model IndicatorVersion');
    expect(schema).toContain('@@unique([cycleId, periodKey])');
    expect(schema).toContain('@@unique([taskId, periodKey])');
    expect(schema).toContain('@@unique([taskId, version])');
  });

  it('stores period review drafts, formal revisions, and the approved optional reflection fields', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

    expect(schema).toContain('model AssessmentPeriodIndicatorReview');
    expect(schema).toContain('model AssessmentPeriodReviewRevision');
    expect(schema).toContain('@@unique([periodId, indicatorVersionItemId])');
    expect(schema).toMatch(/draftVersion\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/selfEvalOpenAt\s+DateTime/);
    expect(schema).toMatch(/problemReason\s+String\?/);
    expect(schema).toMatch(/nextMonthPlan\s+String\?/);
    expect(schema).toMatch(/supportNeeded\s+String\?/);
    expect(schema).toMatch(/periodId\s+String\?/);
    expect(schema).toMatch(/periodReviewRevisionId\s+String\?/);
    expect(schema).toContain('@@unique([indicatorInstanceId, periodReviewRevisionId])');
  });

  it('stores multi-scope visibility rules and explicit indicator-to-indicator alignments', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

    expect(schema).toContain('model IndicatorVisibilityRule');
    expect(schema).toContain('@@unique([indicatorInstanceId, scope])');
    expect(schema).toContain('model IndicatorInstanceAlignment');
    expect(schema).toContain('@@unique([childIndicatorId, parentIndicatorId])');
    expect(schema).toMatch(/visibilityRules\s+IndicatorVisibilityRule\[\]/);
    expect(schema).toMatch(/parentAlignments\s+IndicatorInstanceAlignment\[\]/);
    expect(schema).toMatch(/childAlignments\s+IndicatorInstanceAlignment\[\]/);
  });
});
