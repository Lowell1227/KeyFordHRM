import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateIndicatorProgressDto } from './update-indicator-progress.dto';

describe('UpdateIndicatorProgressDto', () => {
  const validBody = {
    progress: 55,
    healthStatus: 'at_risk',
    content: '渠道转化低于预期，已调整投放',
  };

  it('accepts uploaded attachment metadata from the existing storage API', async () => {
    const dto = plainToInstance(UpdateIndicatorProgressDto, {
      ...validBody,
      attachments: [{ name: '复盘记录.pdf', url: '/uploads/progress/review.pdf', size: 1024 }],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsafe or incomplete attachment metadata', async () => {
    const dto = plainToInstance(UpdateIndicatorProgressDto, {
      ...validBody,
      attachments: [{ name: ' ', url: 'javascript:alert(1)' }],
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'attachments' && error.children?.length)).toBe(true);
  });

  it('rejects more than ten attachments', async () => {
    const dto = plainToInstance(UpdateIndicatorProgressDto, {
      ...validBody,
      attachments: Array.from({ length: 11 }, (_, index) => ({
        name: `附件-${index}.txt`,
        url: `/uploads/progress/${index}.txt`,
      })),
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'attachments')).toBe(true);
  });
});
