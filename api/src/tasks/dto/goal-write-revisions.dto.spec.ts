import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SubmitSelfEvalDto } from './submit-self-eval.dto';
import { UpdateActualValueDto } from './update-actual-value.dto';

describe.each([SubmitSelfEvalDto, UpdateActualValueDto])('%s goal write revision', metatype => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const input = { indicators: [], summary: {} };

  it('keeps omitted revisions compatible with unamended legacy callers', async () => {
    const dto = await pipe.transform(input, { type: 'body', metatype });
    expect(dto.expectedUpdatedAt).toBeUndefined();
  });

  it('retains a valid expected revision through HTTP whitelisting', async () => {
    const expectedUpdatedAt = '2026-11-17T08:00:01.000Z';
    const dto = await pipe.transform({ ...input, expectedUpdatedAt }, { type: 'body', metatype });
    expect(dto.expectedUpdatedAt).toBe(expectedUpdatedAt);
  });

  it.each(['', 'invalid-date'])('rejects a malformed supplied revision %s', async expectedUpdatedAt => {
    await expect(pipe.transform({ ...input, expectedUpdatedAt }, { type: 'body', metatype }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
