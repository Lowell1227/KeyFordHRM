import { CycleScheduleService } from './cycle-schedule.service';
import { workdayStatus } from './cycle-workday-calendar';

describe('CycleScheduleService', () => {
  let service: CycleScheduleService;

  beforeEach(() => {
    service = new CycleScheduleService();
  });

  it('uses the included 2026 official calendar for holidays and make-up workdays', () => {
    expect(workdayStatus(new Date('2026-01-01T12:00:00+08:00'))).toEqual({ isWorkday: false, official: true });
    expect(workdayStatus(new Date('2026-01-04T12:00:00+08:00'))).toEqual({ isWorkday: true, official: true });
  });

  it('uses the included 2027 base calendar without falling back', () => {
    expect(workdayStatus(new Date('2027-01-01T12:00:00+08:00'))).toEqual({ isWorkday: false, official: true });
    expect(workdayStatus(new Date('2027-01-02T12:00:00+08:00'))).toEqual({ isWorkday: false, official: true });
    expect(workdayStatus(new Date('2027-01-04T12:00:00+08:00'))).toEqual({ isWorkday: true, official: true });
  });

  it('generates one monthly scoring schedule for each calendar month', () => {
    const preview = service.preview({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(preview.reviewFrequency).toBe('cycle');
    expect(preview.schedules).toHaveLength(3);
    expect(preview.schedules[0]).toMatchObject({
      periodKey: '2026-07',
      periodType: 'month',
      sequence: 1,
      isException: false,
    });
    expect(preview.schedules[0].selfEvalOpenAt).toContain('T09:00:00');
    expect(preview.schedules[0].selfEvalDueAt).toContain('T18:00:00');
    expect(preview.schedules[0].managerDueAt).toContain('T18:00:00');
    expect(preview.schedules[0].selfEvalOpenAt).toBe('2026-08-03T09:00:00+08:00');
  });

  it('starts a partial period schedule on the following calendar month and uses third-workday deadlines', () => {
    const preview = service.preview({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-15T00:00:00.000Z'),
    });

    expect(preview.schedules[2]).toMatchObject({
      periodKey: '2026-09',
      selfEvalOpenAt: '2026-10-08T09:00:00+08:00',
      selfEvalDueAt: '2026-10-10T18:00:00+08:00',
      managerDueAt: '2026-10-14T18:00:00+08:00',
    });
  });

  it('blocks schedules whose self-evaluation does not open before it is due', () => {
    const plan = service.normalizeAndValidate({
      type: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-07-31T00:00:00.000Z'),
      schedules: [{
        periodKey: '2026-07',
        selfEvalOpenAt: new Date('2026-08-03T18:00:00+08:00'),
        selfEvalDueAt: new Date('2026-08-03T18:00:00+08:00'),
        managerDueAt: new Date('2026-08-06T18:00:00+08:00'),
      }],
    });

    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: 'SELF_EVAL_OPEN_NOT_BEFORE_DUE', periodKey: '2026-07' }),
    ]);
  });

  it('blocks schedules whose manager deadline is not after self-evaluation', () => {
    const plan = service.normalizeAndValidate({
      type: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-07-31T00:00:00.000Z'),
      schedules: [{
        periodKey: '2026-07',
        selfEvalOpenAt: new Date('2026-08-03T09:00:00+08:00'),
        selfEvalDueAt: new Date('2026-08-05T18:00:00+08:00'),
        managerDueAt: new Date('2026-08-05T18:00:00+08:00'),
      }],
    });

    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: 'SELF_EVAL_DUE_NOT_BEFORE_MANAGER_DUE', periodKey: '2026-07' }),
    ]);
  });

  it('accepts non-workday, cross-month, long, and overlapping custom schedules without warnings', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      schedules: [
        {
          periodKey: '2026-07',
          selfEvalOpenAt: new Date('2026-08-01T09:00:00+08:00'),
          selfEvalDueAt: new Date('2026-08-14T18:00:00+08:00'),
          managerDueAt: new Date('2026-08-18T18:00:00+08:00'),
        },
        {
          periodKey: '2026-08',
          selfEvalOpenAt: new Date('2026-08-17T09:00:00+08:00'),
          selfEvalDueAt: new Date('2026-09-01T18:00:00+08:00'),
          managerDueAt: new Date('2026-09-03T18:00:00+08:00'),
        },
      ],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('generates a single cycle schedule for cycle scoring', () => {
    const preview = service.preview({
      type: 'quarterly',
      scoringFrequency: 'cycle',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(preview.schedules).toEqual([expect.objectContaining({ periodKey: 'cycle' })]);
  });

  it('accepts a cycle-scoring schedule that spans calendar months without warnings', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'cycle',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      schedules: [{
        periodKey: 'cycle',
        selfEvalOpenAt: new Date('2026-10-30T09:00:00+08:00'),
        selfEvalDueAt: new Date('2026-11-03T18:00:00+08:00'),
        managerDueAt: new Date('2026-11-06T18:00:00+08:00'),
      }],
    });

    expect(plan.warnings).toEqual([]);
  });

  it('generates the December scoring schedule from the included 2027 base calendar', () => {
    const preview = service.preview({
      type: 'monthly',
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    });

    expect(preview.warnings).toEqual([]);
    expect(preview.schedules[0]).toMatchObject({
      selfEvalOpenAt: '2027-01-04T09:00:00+08:00',
      selfEvalDueAt: '2027-01-06T18:00:00+08:00',
      managerDueAt: '2027-01-11T18:00:00+08:00',
    });
  });

  it('keeps an explicitly exceptional month through normalization', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      schedules: [{ periodKey: '2026-08', isException: true }],
    });

    expect(plan.schedules[1]).toEqual(expect.objectContaining({ periodKey: '2026-08', isException: true }));
  });

  it('marks a schedule exceptional when a client edits a timestamp but sends isException false', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      schedules: [{
        periodKey: '2026-08',
        managerDueAt: new Date('2026-09-15T18:00:00+08:00'),
        isException: false,
      }],
    });

    expect(plan.schedules[1]).toEqual(expect.objectContaining({
      periodKey: '2026-08',
      managerDueAt: new Date('2026-09-15T18:00:00+08:00'),
      isException: true,
    }));
  });

  it('blocks duplicate schedule overrides instead of silently keeping the last row', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      schedules: [
        { periodKey: '2027-01', isException: false },
        { periodKey: '2027-01', isException: true },
      ],
    });

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'DUPLICATE_PERIOD_KEY',
      periodKey: '2027-01',
    }));
  });

  it('blocks schedule overrides outside the expected period key set', () => {
    const plan = service.normalizeAndValidate({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      schedules: [{ periodKey: '2027-04', isException: true }],
    });

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'UNEXPECTED_PERIOD_KEY',
      periodKey: '2027-04',
    }));
  });
});
