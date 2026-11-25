import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ChangeRecruitmentLifecycleDto, RecruitmentAnalyticsQueryDto } from './recruitment-lifecycle.dto';

describe('recruitment lifecycle HTTP input with global implicit conversion', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
  it.each([['false', false], ['true', true]])('retains the literal unknownSource=%s query meaning', async (raw, expected) => {
    const result = await pipe.transform({ unknownSource: raw }, { type: 'query', metatype: RecruitmentAnalyticsQueryDto });
    expect(result.unknownSource).toBe(expected);
  });
  it.each(['invalid', '0', '1', ''])('rejects an invalid unknownSource=%j rather than coercing it to true', async raw => {
    await expect(pipe.transform({ unknownSource: raw }, { type: 'query', metatype: RecruitmentAnalyticsQueryDto })).rejects.toThrow(BadRequestException);
  });
  it('rejects a revision that cannot be safely incremented in the persisted integer column', async () => {
    await expect(pipe.transform({ expectedRevision: 2147483647, trackingState: 'filled', reason: 'Synthetic filled' }, { type: 'body', metatype: ChangeRecruitmentLifecycleDto })).rejects.toThrow(BadRequestException);
  });
});
