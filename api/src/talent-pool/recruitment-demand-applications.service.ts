import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PaginationDto, type Paginated } from '@/common/dto/pagination.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { assertRecruitmentReader } from './talent-recruitment-policy';
import { summarizeRecruitmentDemandSeats } from './recruitment-demand-seats';

export const RECRUITMENT_DEMAND_APPLICATION_CATEGORIES = ['awaiting_reply', 'accepted', 'terminated', 'hired'] as const;
export type RecruitmentDemandApplicationCategory = typeof RECRUITMENT_DEMAND_APPLICATION_CATEGORIES[number];

export class RecruitmentDemandApplicationsQueryDto extends PaginationDto {
  @IsOptional() @IsIn(RECRUITMENT_DEMAND_APPLICATION_CATEGORIES) category?: RecruitmentDemandApplicationCategory;
}

export interface RecruitmentDemandApplicationItem {
  id: string;
  candidateId: string;
  candidateName: string | null;
  candidateUnavailable: boolean;
  positionName: string;
  stage: string;
  revision: number;
  ownerName: string | null;
  expectedEntryDate: string | null;
  category: RecruitmentDemandApplicationCategory | null;
  occupied: boolean;
  onboardingRequest: { id: string; recordStatus: string; onboardingStatus: string | null } | null;
}

type ProgressRow = Omit<RecruitmentDemandApplicationItem, 'occupied'> & { seatAction: string | null; seatVersion: number | null };

const latestSeat = Prisma.sql`LEFT JOIN LATERAL (
  SELECT e.action, e.version FROM talent_application_events e
  WHERE e.application_id = a.id AND e.action IN ('accept_offer', 'terminate_offer')
  ORDER BY e.version DESC, e.id DESC LIMIT 1
) seat ON TRUE`;
const categoryExpression = Prisma.sql`CASE
  WHEN seat.action = 'accept_offer' AND a.stage = 'hired' THEN 'hired'
  WHEN seat.action = 'accept_offer' THEN 'accepted'
  WHEN seat.action = 'terminate_offer' AND a.stage = 'withdrawn' THEN 'terminated'
  WHEN a.stage = 'offered' THEN 'awaiting_reply'
  ELSE NULL END`;

@Injectable()
export class RecruitmentDemandApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(id: string, query: RecruitmentDemandApplicationsQueryDto, user: AuthUser): Promise<Paginated<RecruitmentDemandApplicationItem>> {
    return this.prisma.$transaction(async tx => {
      await assertRecruitmentReader(tx, user);
      const page = query.page ?? 1, pageSize = query.pageSize ?? 20, skip = (page - 1) * pageSize;
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(skip)
        || (query.category !== undefined && !RECRUITMENT_DEMAND_APPLICATION_CATEGORIES.includes(query.category))) throw new BadRequestException('关联进度筛选或分页参数无效');
      if (!await tx.recruitmentDemand.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('招聘需求不存在');
      const matching = Prisma.sql`a.recruitment_demand_id = ${id}::uuid
        ${query.category ? Prisma.sql`AND (${categoryExpression}) = ${query.category}` : Prisma.empty}`;
      // Count and page use the same event classification inside one consistent read snapshot.
      const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total FROM talent_applications a ${latestSeat} WHERE ${matching}`);
      const rows = await tx.$queryRaw<ProgressRow[]>(Prisma.sql`
        SELECT a.id, a.candidate_id AS "candidateId", CASE WHEN c.deleted_at IS NULL THEN c.name ELSE NULL END AS "candidateName",
          (c.deleted_at IS NOT NULL) AS "candidateUnavailable", a.position_name AS "positionName",
          a.stage, a.revision, owner.name AS "ownerName", to_char(a.expected_entry_date, 'YYYY-MM-DD') AS "expectedEntryDate",
          (${categoryExpression}) AS category, seat.action AS "seatAction", seat.version AS "seatVersion",
          CASE WHEN intake.id IS NULL THEN NULL ELSE jsonb_build_object('id', intake.id, 'recordStatus', intake.record_status,
            'onboardingStatus', intake.onboarding_status) END AS "onboardingRequest"
        FROM talent_applications a
        JOIN talent_candidates c ON c.id = a.candidate_id
        LEFT JOIN users owner ON owner.id = a.owner_id
        ${latestSeat}
        LEFT JOIN LATERAL (
          SELECT r.id, r.record_status, r.onboarding_status FROM employee_data_change_requests r
          WHERE r.talent_application_id = a.id
          ORDER BY CASE WHEN r.cancelled_at IS NULL AND r.archived_at IS NULL AND r.onboarding_status IN ('draft', 'submitted', 'pending_entry')
            THEN 0 ELSE 1 END, r.created_at DESC, r.id ASC LIMIT 1
        ) intake ON TRUE
        WHERE ${matching}
        ORDER BY a.updated_at DESC, a.id ASC LIMIT ${pageSize} OFFSET ${skip}`);
      const items = rows.map(({ seatAction, seatVersion, ...row }): RecruitmentDemandApplicationItem => ({
        ...row, occupied: summarizeRecruitmentDemandSeats({ id, approvedHeadcount: null, usable: false }, [{ id: row.id,
          recruitmentDemandId: id, stage: row.stage, events: seatAction && seatVersion !== null ? [{ action: seatAction, version: seatVersion }] : [] }]).occupiedCount === 1,
      }));
      return { items, total: Number(count.total), page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
  }
}
