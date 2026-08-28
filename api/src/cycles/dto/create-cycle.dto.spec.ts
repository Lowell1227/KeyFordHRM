import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCycleDto } from './create-cycle.dto';

describe('CreateCycleDto', () => {
  it('accepts a v2 monthly scoring plan with period schedule overrides', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      name: '2027 年第一季度绩效',
      type: 'quarterly',
      workflowVersion: 2,
      scoringFrequency: 'monthly',
      startDate: '2027-01-01T00:00:00+08:00',
      endDate: '2027-03-31T00:00:00+08:00',
      periodSchedules: [{
        periodKey: '2027-01',
        selfEvalOpenAt: '2027-02-01T09:00:00+08:00',
        selfEvalDueAt: '2027-02-03T18:00:00+08:00',
        managerDueAt: '2027-02-08T18:00:00+08:00',
      }],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported workflow, frequency, and malformed nested schedules', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      name: '错误的 v2 计划',
      type: 'quarterly',
      workflowVersion: 3,
      scoringFrequency: 'weekly',
      startDate: '2027-01-01T00:00:00+08:00',
      endDate: '2027-03-31T00:00:00+08:00',
      periodSchedules: [{ periodKey: 'January' }],
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'workflowVersion',
      'scoringFrequency',
      'periodSchedules',
    ]));
  });

  it('accepts a half-year cycle type', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      name: '2027 上半年绩效考核',
      type: 'semiannual',
      startDate: new Date('2027-01-01T00:00:00+08:00'),
      endDate: new Date('2027-06-30T00:00:00+08:00'),
    });

    const errors = await validate(dto);

    expect(errors.find((error) => error.property === 'type')).toBeUndefined();
  });
});
