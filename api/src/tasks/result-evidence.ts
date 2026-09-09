import { PerfGrade, Prisma } from '@prisma/client';

/** Read-only evidence selection shared by each workflow's already-authorized detail query. */
export const RESULT_PERIOD_SELECT = {
  periodKey: true, status: true, selfGrade: true, managerGrade: true,
  selfScoreTotal: true, managerScoreTotal: true,
  indicatorReviews: { select: {
    selfScore: true, managerScore: true,
    indicatorVersionItem: { select: { id: true, sourceInstanceId: true, name: true, weight: true, indicatorType: true } },
  } },
} satisfies Prisma.AssessmentPeriodSelect;

type Numeric = number | Prisma.Decimal;
interface EvidencePeriod {
  periodKey: string; status: string;
  selfGrade?: string | null; managerGrade?: string | null;
  selfScoreTotal?: Numeric | null; managerScoreTotal?: Numeric | null;
  indicatorReviews?: Array<{
    selfScore: Numeric | null; managerScore: Numeric | null;
    indicatorVersionItem: { id: string; sourceInstanceId: string | null; name: string; weight: Numeric; indicatorType: string };
  }>;
}
export interface ResultEvidence {
  periods: Array<{ periodKey: string; status: string; selfGrade: PerfGrade | null; managerGrade: PerfGrade | null; selfScoreTotal: number | null; managerScoreTotal: number | null }>;
  indicators: Array<{ id: string; name: string; weight: number; type: string; avgSelfScore: number | null; avgManagerScore: number | null }>;
}
const numberOrNull = (value: Numeric | null | undefined) => value == null ? null : Number(value);
const average = (scores: number[]) => scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;

export function buildResultEvidence(periods: EvidencePeriod[] = []): ResultEvidence {
  const ordered = [...periods].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  const indicators = new Map<string, { id: string; name: string; weight: number; type: string; self: number[]; manager: number[] }>();
  for (const period of ordered) {
    for (const review of period.indicatorReviews ?? []) {
      const item = review.indicatorVersionItem;
      // A missing source is kept as its own version item, never guessed from a display name.
      const id = item.sourceInstanceId ?? item.id;
      const entry = indicators.get(id) ?? { id, name: item.name, weight: Number(item.weight), type: item.indicatorType, self: [], manager: [] };
      entry.name = item.name; entry.weight = Number(item.weight); entry.type = item.indicatorType;
      if (review.selfScore != null) entry.self.push(Number(review.selfScore));
      if (review.managerScore != null) entry.manager.push(Number(review.managerScore));
      indicators.set(id, entry);
    }
  }
  return {
    periods: ordered.map(p => ({ periodKey: p.periodKey, status: p.status,
      selfGrade: p.selfGrade as PerfGrade ?? null, managerGrade: p.managerGrade as PerfGrade ?? null,
      selfScoreTotal: numberOrNull(p.selfScoreTotal), managerScoreTotal: numberOrNull(p.managerScoreTotal),
    })),
    indicators: [...indicators.values()].map(({ self, manager, ...item }) => ({ ...item, avgSelfScore: average(self), avgManagerScore: average(manager) })),
  };
}

/** Employee-visible evidence follows the same publication controls as the cycle result. */
export function maskResultEvidence(evidence: ResultEvidence, visible: { total_score?: boolean; grade?: boolean; indicator_scores?: boolean }): ResultEvidence {
  return {
    periods: evidence.periods.map(p => ({ ...p, managerScoreTotal: visible.total_score ? p.managerScoreTotal : null, managerGrade: visible.grade ? p.managerGrade : null })),
    indicators: evidence.indicators.map(i => ({ ...i, avgManagerScore: visible.indicator_scores ? i.avgManagerScore : null })),
  };
}
