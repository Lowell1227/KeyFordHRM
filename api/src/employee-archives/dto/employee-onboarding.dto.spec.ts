import { ValidationPipe } from '@nestjs/common';
import { CreateEmployeeReentryDto } from './employee-onboarding.dto';

describe('CreateEmployeeReentryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: true },
  });

  it('accepts valid UUID v5 user IDs for both manager relationships', async () => {
    const result = await pipe.transform(
      {
        company: 'fuede',
        rosterManagerId: '886313e1-3b8a-5372-9b90-0c9aee199e5d',
        performanceManagerId: '21f7f8de-8051-5b89-8680-0195ef798b6a',
        effectiveDate: '2026-09-29',
        employeeStatus: 'probation',
        employmentType: 'full_time',
      },
      {
        type: 'body',
        metatype: CreateEmployeeReentryDto,
      },
    );

    expect(result.rosterManagerId).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(result.performanceManagerId).toBe(
      '21f7f8de-8051-5b89-8680-0195ef798b6a',
    );
  });

  it.each([
    ['rosterManagerId', '花名册直属主管信息无效，请重新选择'],
    ['performanceManagerId', '绩效直属上级信息无效，请重新选择'],
  ] as const)(
    'returns a business-facing message for an invalid %s',
    async (field, message) => {
      await expect(
        pipe.transform(
          {
            company: 'fuede',
            [field]: 'FD210105',
            effectiveDate: '2026-09-29',
            employeeStatus: 'probation',
            employmentType: 'full_time',
          },
          {
            type: 'body',
            metatype: CreateEmployeeReentryDto,
          },
        ),
      ).rejects.toMatchObject({
        response: {
          message: [message],
        },
      });
    },
  );
});
