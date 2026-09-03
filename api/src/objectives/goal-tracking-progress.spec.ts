import {
  currentGoalProgress,
  shanghaiMonthKey,
  sortGoalProgress,
} from './goal-tracking-progress';

function progress(input: {
  id: string;
  createdAt: string;
  periodKey?: string;
  formal?: boolean;
}) {
  return {
    id: input.id,
    createdAt: new Date(input.createdAt),
    period: input.periodKey ? { periodKey: input.periodKey } : null,
    periodReviewRevisionId: input.formal ? `revision-${input.id}` : null,
  };
}

describe('goal tracking business-month ordering', () => {
  it('does not let a late July monthly result replace August progress', () => {
    const records = [
      progress({
        id: 'jul-formal',
        createdAt: '2026-09-03T02:00:00.000Z',
        periodKey: '2026-07',
        formal: true,
      }),
      progress({ id: 'aug-1', createdAt: '2026-08-20T02:00:00.000Z' }),
    ];

    expect(currentGoalProgress(records)?.id).toBe('aug-1');
    expect(sortGoalProgress(records).map((item) => item.id)).toEqual([
      'aug-1',
      'jul-formal',
    ]);
  });

  it('uses Asia Shanghai when active progress crosses the UTC month boundary', () => {
    expect(shanghaiMonthKey(new Date('2026-07-31T16:30:00.000Z'))).toBe(
      '2026-08',
    );
  });

  it('orders records inside one business month by created time then stable id', () => {
    const records = [
      progress({ id: 'a', createdAt: '2026-08-10T01:00:00.000Z' }),
      progress({ id: 'b', createdAt: '2026-08-10T01:00:00.000Z' }),
      progress({ id: 'older', createdAt: '2026-08-09T01:00:00.000Z' }),
    ];

    expect(sortGoalProgress(records).map((item) => item.id)).toEqual([
      'b',
      'a',
      'older',
    ]);
  });
});
