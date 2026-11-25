import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { AuthUser } from '@/common/types/auth.types';
import type { Paginated } from '@/common/dto/pagination.dto';
import { PrismaService } from '@/prisma/prisma.service';
import type { RecruitmentAnalyticsQueryDto } from './recruitment-lifecycle.dto';
import { RECRUITMENT_ANALYTICS_METRICS, type RecruitmentAnalyticsApplication, type RecruitmentChannelCounts, type RecruitmentChannelSummary } from './recruitment-lifecycle.types';
import { assertRecruitmentReader } from './talent-recruitment-policy';
import { currentRecruitmentDemandSql, recruitmentSeatJoin } from './recruitment-progress-sql';

const facts = Prisma.sql`WITH facts AS (
  SELECT a.id, a.candidate_id, a.position_name, a.stage, a.created_at,
    NULLIF(BTRIM(a.source_channel), '') AS source_channel, (${currentRecruitmentDemandSql}) AS demand_id,
    EXISTS (SELECT 1 FROM talent_interviews interview WHERE interview.application_id = a.id AND interview.status <> 'cancelled') AS interviewed,
    (a.stage = 'offered' OR EXISTS (SELECT 1 FROM talent_application_events approval WHERE approval.application_id = a.id AND approval.action = 'approve_hiring')) AS offered,
    (seat.action IS NOT DISTINCT FROM 'accept_offer') AS accepted, (a.stage = 'hired') AS hired
  FROM talent_applications a ${recruitmentSeatJoin}
)`;
const countNames = ['applicationCount', 'interviewedCount', 'offeredCount', 'acceptedCount', 'hiredCount'] as const;
const counts = Prisma.sql`COUNT(*)::bigint AS "applicationCount", COUNT(*) FILTER (WHERE f.interviewed)::bigint AS "interviewedCount",
  COUNT(*) FILTER (WHERE f.offered)::bigint AS "offeredCount", COUNT(*) FILTER (WHERE f.accepted)::bigint AS "acceptedCount",
  COUNT(*) FILTER (WHERE f.hired)::bigint AS "hiredCount"`;
type RawCounts = Record<typeof countNames[number], bigint>;

function dateBoundary(day: string | undefined): Date | undefined {
  if (day === undefined) return undefined;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('请选择有效的应聘登记起止日期');
  const utc = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== day) throw new BadRequestException('应聘登记日期无效');
  return new Date(utc.getTime() - 8 * 3600000);
}

function matching(query: RecruitmentAnalyticsQueryDto) {
  const page = query.page ?? 1, pageSize = query.pageSize ?? 20, skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(skip)
    || (query.demandId !== undefined && !isUUID(query.demandId)) || (query.metric !== undefined && !RECRUITMENT_ANALYTICS_METRICS.includes(query.metric))
    || (query.unknownSource !== undefined && typeof query.unknownSource !== 'boolean')) throw new BadRequestException('招聘分析筛选或分页参数无效');
  const source = query.sourceChannel === undefined ? undefined : typeof query.sourceChannel === 'string' ? query.sourceChannel.trim() : '';
  if (source !== undefined && (!source || source.length > 80 || query.unknownSource)) throw new BadRequestException('请选择一个明确渠道或待确认来源，不可同时选择');
  const from = dateBoundary(query.from), lastDay = dateBoundary(query.to);
  if (from && lastDay && from > lastDay) throw new BadRequestException('开始日期不能晚于结束日期');
  const to = lastDay ? new Date(lastDay.getTime() + 86400000) : undefined;
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.demandId) conditions.push(Prisma.sql`f.demand_id = ${query.demandId}::uuid`);
  if (source) conditions.push(Prisma.sql`f.source_channel = ${source}`);
  if (query.unknownSource) conditions.push(Prisma.sql`f.source_channel IS NULL`);
  if (from) conditions.push(Prisma.sql`f.created_at >= ${from}`);
  if (to) conditions.push(Prisma.sql`f.created_at < ${to}`);
  const metrics = { interviewed: Prisma.sql`f.interviewed`, offered: Prisma.sql`f.offered`, accepted: Prisma.sql`f.accepted`, hired: Prisma.sql`f.hired` };
  if (query.metric && query.metric !== 'application') conditions.push(metrics[query.metric]);
  return { where: Prisma.join(conditions, ' AND '), page, pageSize, skip };
}

function numbers(row: RawCounts): RecruitmentChannelCounts {
  return Object.fromEntries(countNames.map(key => [key, Number(row[key])])) as unknown as RecruitmentChannelCounts;
}

@Injectable()
export class RecruitmentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  async channels(query: RecruitmentAnalyticsQueryDto, user: AuthUser): Promise<RecruitmentChannelSummary> {
    return this.prisma.$transaction(async tx => {
      await assertRecruitmentReader(tx, user);
      const { where } = matching(query);
      const rows = await tx.$queryRaw<Array<RawCounts & { sourceChannel: string | null }>>(Prisma.sql`${facts}
        SELECT f.source_channel AS "sourceChannel", ${counts} FROM facts f WHERE ${where}
        GROUP BY f.source_channel ORDER BY COUNT(*) DESC, f.source_channel ASC NULLS LAST`);
      const items = rows.map(row => ({ sourceChannel: row.sourceChannel, ...numbers(row) }));
      const totals: RecruitmentChannelCounts = { applicationCount: 0, interviewedCount: 0, offeredCount: 0, acceptedCount: 0, hiredCount: 0 };
      for (const item of items) for (const key of countNames) totals[key] += item[key];
      return { items, totals, periodBasis: 'application_created_at' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
  }

  async applications(query: RecruitmentAnalyticsQueryDto, user: AuthUser): Promise<Paginated<RecruitmentAnalyticsApplication>> {
    return this.prisma.$transaction(async tx => {
      await assertRecruitmentReader(tx, user);
      const { where, page, pageSize, skip } = matching(query);
      const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`${facts} SELECT COUNT(*)::bigint AS total FROM facts f WHERE ${where}`);
      const rows = await tx.$queryRaw<Array<Omit<RecruitmentAnalyticsApplication, 'createdAt'> & { createdAt: Date }>>(Prisma.sql`${facts}
        SELECT f.id, f.candidate_id AS "candidateId", CASE WHEN c.deleted_at IS NULL THEN c.name ELSE NULL END AS "candidateName",
          (c.deleted_at IS NOT NULL) AS "candidateUnavailable", f.position_name AS "positionName", f.source_channel AS "sourceChannel",
          f.demand_id AS "demandId", f.stage, f.created_at AS "createdAt", f.interviewed, f.offered, f.accepted, f.hired
        FROM facts f JOIN talent_candidates c ON c.id = f.candidate_id WHERE ${where}
        ORDER BY f.created_at DESC, f.id ASC LIMIT ${pageSize} OFFSET ${skip}`);
      return { items: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), total: Number(count.total), page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
  }
}
