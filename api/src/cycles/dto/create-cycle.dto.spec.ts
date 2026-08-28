import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCycleDto } from './create-cycle.dto';
import { PreviewCycleScheduleDto } from './preview-cycle-schedule.dto';
import { UpdateCycleDto } from './update-cycle.dto';

const productionTransformOptions = { enableImplicitConversion: true } as const;

function productionValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    transformOptions: productionTransformOptions,
  });
}

describe('CreateCycleDto', () => {
  it('accepts a v2 monthly scoring plan with period schedule overrides', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      name: '2027 年第一季度绩效',
      type: 'quarterly',
      workflowVersion: 2,
      scoringFrequency: 'monthly',
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      periodSchedules: [{
        periodKey: '2027-01',
        selfEvalOpenAt: '2027-02-01T09:00:00+08:00',
        selfEvalDueAt: '2027-02-03T18:00:00+08:00',
        managerDueAt: '2027-02-08T18:00:00+08:00',
      }],
    }, productionTransformOptions);

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.startDate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(dto.endDate.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });

  it('rejects unsupported workflow, frequency, and malformed nested schedules', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      name: '错误的 v2 计划',
      type: 'quarterly',
      workflowVersion: 3,
      scoringFrequency: 'weekly',
      startDate: '2027-01-01',
      endDate: '2027-03-31',
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
      startDate: '2027-01-01',
      endDate: '2027-06-30',
    });

    const errors = await validate(dto);

    expect(errors.find((error) => error.property === 'type')).toBeUndefined();
  });

  it.each([
    ['a +08 timestamp', '2027-01-01T00:00:00+08:00'],
    ['a Z timestamp', '2027-01-01T00:00:00.000Z'],
    ['an impossible rolled date', '2027-02-30'],
    ['a Date object', new Date('2027-01-01T00:00:00.000Z')],
    ['a non-string value', 20270101],
  ])('rejects %s under the production ValidationPipe options', async (_label, invalidDate) => {
    await expect(productionValidationPipe().transform({
      name: '含歧义日期的周期',
      type: 'quarterly',
      startDate: invalidDate,
      endDate: '2027-03-31',
    }, {
      type: 'body',
      metatype: CreateCycleDto,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    {
      label: 'create',
      metatype: CreateCycleDto,
      payload: { name: '创建周期', type: 'quarterly', startDate: '2027-01-01', endDate: '2027-03-31' },
    },
    {
      label: 'preview',
      metatype: PreviewCycleScheduleDto,
      payload: { type: 'quarterly', startDate: '2027-01-01', endDate: '2027-03-31' },
    },
    {
      label: 'inherited update',
      metatype: UpdateCycleDto,
      payload: { expectedPlanVersion: 3, startDate: '2027-01-01', endDate: '2027-03-31' },
    },
  ])('passes canonical UTC Date values to services for $label DTOs', async ({ metatype, payload }) => {
    const dto = await productionValidationPipe().transform(payload, {
      type: 'body',
      metatype,
    }) as CreateCycleDto | PreviewCycleScheduleDto | UpdateCycleDto;

    expect(dto.startDate).toBeInstanceOf(Date);
    expect(dto.endDate).toBeInstanceOf(Date);
    expect(dto.startDate?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(dto.endDate?.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });
});
