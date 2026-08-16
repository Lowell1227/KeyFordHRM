import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  localDateKey,
  orderPerformanceCycles,
  resolvePerformanceCycle,
} from '../../src/utils/performance-cycle';

function cycle(id: string, startDate: string, endDate: string): AssessmentCycle {
  return {
    id,
    name: id,
    type: 'quarterly',
    startDate,
    endDate,
    status: 'self_eval',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  };
}

test('preserves a valid requested historical cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('past', '2026-01-01', '2026-03-31'),
    cycle('current', '2026-07-01', '2026-09-30'),
  ], 'past', '2026-08-16');

  expect(result.selectedCycle?.id).toBe('past');
  expect(result.requestedCycleIsValid).toBe(true);
});

test('defaults to the latest-starting in-progress cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('current-old', '2026-01-01', '2026-12-31'),
    cycle('current-new', '2026-07-01', '2026-09-30'),
    cycle('future', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('current-new');
});

test('falls back to the most recently ended cycle', () => {
  const result = resolvePerformanceCycle([
    cycle('old', '2025-10-01', '2025-12-31'),
    cycle('recent', '2026-04-01', '2026-06-30'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('recent');
});

test('uses the earliest upcoming cycle when no cycle has started', () => {
  const result = resolvePerformanceCycle([
    cycle('later', '2027-01-01', '2027-03-31'),
    cycle('next', '2026-10-01', '2026-12-31'),
  ], undefined, '2026-08-16');

  expect(result.selectedCycle?.id).toBe('next');
});

test('handles inclusive boundaries, invalid dates, empty candidates, and local dates', () => {
  expect(resolvePerformanceCycle([
    cycle('boundary', '2026-08-16', '2026-08-16'),
    cycle('invalid', 'invalid', 'invalid'),
  ], undefined, '2026-08-16').selectedCycle?.id).toBe('boundary');
  expect(resolvePerformanceCycle([], 'missing', '2026-08-16').selectedCycle).toBeNull();
  expect(localDateKey(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
  expect(orderPerformanceCycles([
    cycle('invalid-first', 'invalid', 'invalid'),
  ], '2026-08-16')[0]?.id).toBe('invalid-first');
});
