import { ValidationPipe } from '@nestjs/common';
import { ApproveConfirmationDto } from './approve-confirmation.dto';
import { ConfirmationMutationDto } from './confirmation-mutation.dto';

describe('confirmation mutation round', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } });
  it.each([0, 1, '2'])('accepts a nonnegative submission version %s including multipart text', async (submissionVersion) => {
    const result = await pipe.transform({ submissionVersion }, { type: 'body', metatype: ConfirmationMutationDto });
    expect(result.submissionVersion).toBe(Number(submissionVersion));
  });
  it.each([-1, 1.5, '', ' ', false, true, 'not-a-round'])('rejects malformed submission version %s', async (submissionVersion) => {
    await expect(pipe.transform({ submissionVersion }, { type: 'body', metatype: ApproveConfirmationDto })).rejects.toMatchObject({ status: 400 });
  });
  it('leaves an omitted version absent so the v2 service can return a conflict', async () => {
    const result = await pipe.transform({}, { type: 'body', metatype: ApproveConfirmationDto });
    expect(result.submissionVersion).toBeUndefined();
  });
});
