import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export type PersonnelReviewMode = 'relaxed' | 'standard';

export const PERSONNEL_REVIEW_MODE_KEY = 'personnel_review_mode';

/** Legacy endpoint compatibility; historical mode values no longer control approvals. */
@Injectable()
export class PersonnelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getReviewMode(): Promise<PersonnelReviewMode> {
    return 'standard';
  }

  async setReviewMode(mode: PersonnelReviewMode, _operatorId: string) {
    if (mode !== 'standard') {
      throw new BadRequestException('宽松审核模式已取消，请按固定规则提交变更');
    }
    return { mode };
  }
}
