import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class IndicatorVersionService {
  async activateConfirmedV1(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorId: string,
  ): Promise<string> {
    const version = await tx.indicatorVersion.findFirst({
      where: { taskId, version: 1 },
    });
    if (!version) throw new ConflictException('未找到待激活的指标版本 V1');
    if (version.status === 'active') return version.id;

    const indicators = await tx.indicatorInstance.findMany({
      where: { taskId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (indicators.length === 0) throw new ConflictException('没有可冻结的考核指标');

    const claimed = await tx.indicatorVersion.updateMany({
      where: { id: version.id, status: 'draft' },
      data: { status: 'active', activatedAt: new Date(), createdById: actorId },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('指标版本状态已变化，请刷新后重试');
    }

    await tx.indicatorVersionItem.createMany({
      data: indicators.map((item) => ({
        indicatorVersionId: version.id,
        sourceInstanceId: item.id,
        name: item.name,
        description: item.description,
        scoringStandard: item.scoringStandard,
        targetValue: item.targetValue,
        targetValueText: item.targetValueText,
        unit: item.unit,
        weight: item.weight,
        indicatorType: item.indicatorType,
        dimensionName: item.dimensionName,
        dimensionWeight: item.dimensionWeight,
        sortOrder: item.sortOrder,
      })),
    });
    await tx.assessmentPeriod.updateMany({
      where: { taskId, indicatorVersionId: null },
      data: { indicatorVersionId: version.id },
    });
    return version.id;
  }
}
