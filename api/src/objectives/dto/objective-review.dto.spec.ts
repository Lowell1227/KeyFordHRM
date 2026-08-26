import { validate } from 'class-validator';
import {
  ApproveObjectiveDto,
  RequestObjectiveChangesDto,
} from './objective-review.dto';

describe('objective review DTO version contract', () => {
  it.each([
    [ApproveObjectiveDto, { expectedUpdatedAt: '2026-08-25T08:00:00.000Z' }],
    [RequestObjectiveChangesDto, {
      comment: '请补充量化口径',
      expectedUpdatedAt: '2026-08-25T08:00:00.000Z',
    }],
  ])('requires an ISO timestamp for %p', async (Dto, validValue) => {
    const valid = Object.assign(new Dto(), validValue);
    const missing = Object.assign(new Dto(), {
      ...validValue,
      expectedUpdatedAt: undefined,
    });
    const malformed = Object.assign(new Dto(), {
      ...validValue,
      expectedUpdatedAt: 'not-a-timestamp',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(missing)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(malformed)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
  });
});
