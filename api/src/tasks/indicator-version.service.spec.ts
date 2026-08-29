import { ConflictException } from '@nestjs/common';
import { IndicatorVersionService } from './indicator-version.service';

describe('IndicatorVersionService', () => {
  const tx = {
    indicatorVersion: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    indicatorInstance: { findMany: jest.fn() },
    indicatorVersionItem: { createMany: jest.fn() },
    assessmentPeriod: { updateMany: jest.fn() },
  } as any;
  const service = new IndicatorVersionService();

  beforeEach(() => {
    jest.clearAllMocks();
    tx.indicatorVersion.findFirst.mockResolvedValue({ id: 'version-1', status: 'draft', version: 1 });
    tx.indicatorVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.indicatorInstance.findMany.mockResolvedValue([{
      id: 'indicator-1',
      name: '签约额',
      description: '完成年度签约目标',
      scoringStandard: '完成率达到100%',
      targetValue: null,
      targetValueText: '1000万元',
      unit: '万元',
      weight: 0.6,
      indicatorType: 'kpi',
      dimensionName: '业绩',
      dimensionWeight: 1,
      sortOrder: 0,
    }]);
  });

  it('claims V1 before copying confirmed indicators and recovers every period missing a version', async () => {
    await service.activateConfirmedV1(tx, 'task-1', 'employee-1');

    expect(tx.indicatorVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'version-1', status: 'draft' },
      data: expect.objectContaining({ status: 'active', activatedAt: expect.any(Date) }),
    });
    expect(tx.indicatorVersionItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        indicatorVersionId: 'version-1',
        sourceInstanceId: 'indicator-1',
        name: '签约额',
      })],
    });
    expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', indicatorVersionId: null },
      data: { indicatorVersionId: 'version-1' },
    });
    expect(tx.indicatorVersion.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.indicatorVersionItem.createMany.mock.invocationCallOrder[0]);
  });

  it('rejects a concurrent activation before copying duplicate items', async () => {
    tx.indicatorVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.activateConfirmedV1(tx, 'task-1', 'employee-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.indicatorVersionItem.createMany).not.toHaveBeenCalled();
  });
});
