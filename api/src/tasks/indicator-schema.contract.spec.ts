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
});
