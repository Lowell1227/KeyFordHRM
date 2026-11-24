import type { Prisma } from '@prisma/client';

interface DemandCapacity { id: string; approvedHeadcount: number | null; usable: boolean }
interface ApplicationSeatFact {
  id: string; recruitmentDemandId: string | null; stage: string;
  events: ReadonlyArray<{ action: string; version: number }>;
}
export interface RecruitmentDemandSeatCounts {
  occupiedCount: number; acceptedCount: number; hiredCount: number;
  remainingCount: number | null; overCount: number | null;
}

export function summarizeRecruitmentDemandSeats(demand: DemandCapacity, applications: ApplicationSeatFact[]): RecruitmentDemandSeatCounts {
  let occupiedCount = 0, hiredCount = 0;
  const counted = new Set<string>();
  for (const application of applications) {
    if (application.recruitmentDemandId !== demand.id || counted.has(application.id)) continue;
    counted.add(application.id);
    const latest = application.events.filter(event => ['accept_offer', 'terminate_offer'].includes(event.action))
      .sort((a, b) => b.version - a.version)[0];
    if (latest?.action !== 'accept_offer') continue;
    occupiedCount++;
    if (application.stage === 'hired') hiredCount++;
  }
  const capacityKnown = demand.usable && Number.isInteger(demand.approvedHeadcount) && demand.approvedHeadcount! > 0;
  return { occupiedCount, hiredCount, acceptedCount: occupiedCount - hiredCount,
    remainingCount: capacityKnown ? Math.max(demand.approvedHeadcount! - occupiedCount, 0) : null,
    overCount: capacityKnown ? Math.max(occupiedCount - demand.approvedHeadcount!, 0) : null };
}

export async function attachRecruitmentDemandSeats<T extends DemandCapacity>(
  db: Pick<Prisma.TransactionClient, 'talentApplication'>, rows: T[],
): Promise<Array<T & RecruitmentDemandSeatCounts>> {
  if (!rows.length) return [];
  const applications = await db.talentApplication.findMany({
    where: { recruitmentDemandId: { in: [...new Set(rows.map(row => row.id))] } },
    select: { id: true, recruitmentDemandId: true, stage: true, events: {
      where: { action: { in: ['accept_offer', 'terminate_offer'] } }, orderBy: { version: 'desc' }, take: 1,
      select: { action: true, version: true },
    } },
  });
  const byDemand = new Map<string, ApplicationSeatFact[]>();
  for (const application of applications) {
    if (!application.recruitmentDemandId) continue;
    const group = byDemand.get(application.recruitmentDemandId) ?? [];
    group.push(application);
    byDemand.set(application.recruitmentDemandId, group);
  }
  return rows.map(row => ({ ...row, ...summarizeRecruitmentDemandSeats(row, byDemand.get(row.id) ?? []) }));
}
