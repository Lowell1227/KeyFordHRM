import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export type PersonnelReviewMode = 'relaxed' | 'standard';

export const PERSONNEL_REVIEW_MODE_KEY = 'personnel_review_mode';

/**
 * 人事审核模式：宽松模式下档案变更、组织/岗位变更、入职再入职等提交后系统自动审核通过（全程留痕）；
 * 部门合并始终人工审核。标准模式保持人工审核，未配置时默认为标准模式。
 */
@Injectable()
export class PersonnelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getReviewMode(): Promise<PersonnelReviewMode> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: PERSONNEL_REVIEW_MODE_KEY },
      select: { value: true },
    });
    return this.normalizeMode(row?.value);
  }

  async setReviewMode(mode: PersonnelReviewMode, operatorId: string) {
    if (!['relaxed', 'standard'].includes(mode)) {
      throw new BadRequestException('审核模式取值无效');
    }
    const value: Prisma.InputJsonValue = { mode };
    await this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.systemConfig.findUnique({
          where: { key: PERSONNEL_REVIEW_MODE_KEY },
        });
        await tx.systemConfig.upsert({
          where: { key: PERSONNEL_REVIEW_MODE_KEY },
          create: {
            key: PERSONNEL_REVIEW_MODE_KEY,
            value,
            description:
              '人事审核模式：relaxed=宽松（提交自动审核通过），standard=标准（人工审核）',
            updatedBy: operatorId,
          },
          update: { value, updatedBy: operatorId },
        });
        await tx.auditLog.create({
          data: {
            userId: operatorId,
            action: 'update_personnel_review_mode',
            entityType: 'system_config',
            entityId: null,
            oldValue: { mode: this.normalizeMode(previous?.value) },
            newValue: { key: PERSONNEL_REVIEW_MODE_KEY, mode },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { mode };
  }

  private normalizeMode(value: unknown): PersonnelReviewMode {
    const mode = (value as { mode?: unknown } | null)?.mode;
    return mode === 'relaxed' ? 'relaxed' : 'standard';
  }
}
