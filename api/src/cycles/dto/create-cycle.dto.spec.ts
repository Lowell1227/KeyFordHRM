import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCycleDto } from './create-cycle.dto';

describe('CreateCycleDto', () => {
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
