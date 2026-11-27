import { ConflictException } from '@nestjs/common';
import { PeriodReviewsService } from './period-reviews.service';

describe('period claims across goal version activation', () => {
  const service = Object.create(PeriodReviewsService.prototype) as any;
  const period = { id: 'period', taskId: 'task', draftVersion: 3, indicatorVersionId: 'version-old', managerId: 'manager' };
  function transaction() {
    return {
      $queryRaw: jest.fn(async (query: TemplateStringsArray) => {
        const sql = query.join('');
        if (sql.includes('FROM assessment_periods')) return [{ id: period.id }];
        if (sql.includes('FROM assessment_tasks')) return [{ id: period.taskId }];
        throw new Error(`Unexpected period lock query: ${sql}`);
      }),
      assessmentTask: { findUnique: jest.fn().mockResolvedValue({ id: period.taskId, lifecycleStatus: 'active' }) },
      assessmentPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }
  it.each(['claimDraftVersion', 'claimManagerDraftVersion'])('%s refuses a guessed later revision before any write', async (method) => {
    const tx = transaction();
    await expect(service[method](tx, period, 4)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.assessmentPeriod.updateMany).not.toHaveBeenCalled();
  });
  it.each(['claimDraftVersion', 'claimManagerDraftVersion'])('%s binds the update to the version used for validation', async (method) => {
    const tx = transaction();
    await expect(service[method](tx, period, 3)).resolves.toBe(4);
    expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ draftVersion: 3, indicatorVersionId: 'version-old' }),
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.assessmentTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: period.taskId } }));
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.assessmentTask.findUnique.mock.invocationCallOrder[0]);
    expect(tx.assessmentTask.findUnique.mock.invocationCallOrder[0]).toBeLessThan(tx.assessmentPeriod.updateMany.mock.invocationCallOrder[0]);
  });
  it.each(['claimDraftVersion', 'claimManagerDraftVersion'])('%s rechecks the locked task lifecycle before claiming the period', async (method) => {
    const tx = transaction();
    tx.assessmentTask.findUnique.mockResolvedValue({ id: period.taskId, lifecycleStatus: 'terminated' });
    await expect(service[method](tx, period, 3)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.assessmentPeriod.updateMany).not.toHaveBeenCalled();
  });
});
