import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { CreateFollowUpDto, parseTalentDate } from './dto/create-follow-up.dto';
import { TalentsService } from './talents.service';

@Injectable()
export class TalentFollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly talents: TalentsService,
  ) {}

  /** Insert history while advancing last_follow_up_at only when the date is newer. */
  async create(candidateId: string, input: CreateFollowUpDto, operator: AuthUser) {
    await this.talents.findActive(candidateId);
    const occurredAt = parseTalentDate(input.occurredAt) ?? this.today();
    const nextFollowUpAt = parseTalentDate(input.nextFollowUpAt);
    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.talentFollowUp.create({
        data: {
          candidateId,
          occurredAt,
          channel: input.channel,
          summary: input.summary,
          nextFollowUpAt,
          createdById: operator.id,
        },
      });
      await tx.talentCandidate.updateMany({
        where: { id: candidateId, deletedAt: null, OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: occurredAt } }] },
        data: { lastFollowUpAt: occurredAt, updatedById: operator.id },
      });
      return followUp;
    });
  }

  /** 跟进列表（倒序，附记录人姓名用于时间线展示）。 */
  async list(candidateId: string) {
    await this.talents.findActive(candidateId);
    const rows = await this.prisma.talentFollowUp.findMany({
      where: { candidateId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
    const creatorIds = [...new Set(rows.map((row) => row.createdById))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(creators.map((user) => [user.id, user.name]));
    return rows.map((row) => ({ ...row, createdByName: nameById.get(row.createdById) ?? null }));
  }

  private today(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
}
