import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UpdateIndicatorProgressDto } from './update-indicator-progress.dto';

describe('UpdateIndicatorProgressDto', () => {
  const validBody = {
    progress: 55,
    healthStatus: 'at_risk',
    content: '渠道转化低于预期，已调整投放',
  };

  it('keeps only status, progress, description and concurrency metadata', async () => {
    const dto = await new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }).transform({
      ...validBody,
      expectedLatestUpdateAt: '2026-09-03T10:00:00.000Z',
      attachments: [{ name: '复盘记录.pdf', url: '/uploads/progress/review.pdf', size: 1024 }],
    }, {
      type: 'body',
      metatype: UpdateIndicatorProgressDto,
    });

    expect(dto).toEqual({
      ...validBody,
      expectedLatestUpdateAt: '2026-09-03T10:00:00.000Z',
    });
  });
});
