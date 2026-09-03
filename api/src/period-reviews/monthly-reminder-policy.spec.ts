import { monthlyEmployeeReminderKind } from './monthly-reminder-policy';

describe('monthly employee reminder policy', () => {
  const dueAt = new Date('2026-09-10T10:00:00.000Z');

  it.each([
    ['2026-09-07T01:00:00.000Z', 'due_soon_3'],
    ['2026-09-10T01:00:00.000Z', 'due_today'],
    ['2026-09-11T01:00:00.000Z', 'overdue_1'],
    ['2026-09-14T01:00:00.000Z', 'overdue_every_3'],
    ['2026-09-17T01:00:00.000Z', 'overdue_every_3'],
  ] as const)('returns %s reminder on the expected Shanghai day', (now, expected) => {
    expect(monthlyEmployeeReminderKind(new Date(now), dueAt, null)).toBe(expected);
  });

  it.each([
    '2026-09-06T01:00:00.000Z',
    '2026-09-08T01:00:00.000Z',
    '2026-09-12T01:00:00.000Z',
    '2026-09-13T01:00:00.000Z',
  ])('returns no reminder outside the configured cadence (%s)', (now) => {
    expect(monthlyEmployeeReminderKind(new Date(now), dueAt, null)).toBeNull();
  });

  it('stops employee reminders after the monthly self evaluation is submitted', () => {
    expect(monthlyEmployeeReminderKind(
      new Date('2026-09-14T01:00:00.000Z'),
      dueAt,
      new Date('2026-09-12T01:00:00.000Z'),
    )).toBeNull();
  });

  it('uses Shanghai calendar days across a UTC date boundary', () => {
    expect(monthlyEmployeeReminderKind(
      new Date('2026-09-10T16:30:00.000Z'),
      new Date('2026-09-09T18:00:00.000Z'),
      null,
    )).toBe('overdue_1');
  });
});
