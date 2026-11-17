import { ConflictException } from '@nestjs/common';
import { PeriodReviewsService } from './period-reviews.service';

describe('period claims across goal version activation', () => {
  const service = Object.create(PeriodReviewsService.prototype) as any;
  const period = { id: 'period', draftVersion: 3, indicatorVersionId: 'version-old', managerId: 'manager' };
  it.each(['claimDraftVersion', 'claimManagerDraftVersion'])('%s refuses a guessed later revision before any write', async (method) => {
    const tx = { assessmentPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await expect(service[method](tx, period, 4)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.assessmentPeriod.updateMany).not.toHaveBeenCalled();
  });
  it.each(['claimDraftVersion', 'claimManagerDraftVersion'])('%s binds the update to the version used for validation', async (method) => {
    const tx = { assessmentPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await expect(service[method](tx, period, 3)).resolves.toBe(4);
    expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ draftVersion: 3, indicatorVersionId: 'version-old' }),
    }));
  });
});
