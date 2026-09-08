import type { PeriodReviewDetail, PeriodReviewIndicator, PeriodReviewProgressReference } from '@/types/api.types';

type ReviewPeriod = PeriodReviewDetail['period'];

export function progressReferencesFor(indicator: PeriodReviewIndicator): PeriodReviewProgressReference[] {
  if (indicator.progressReferences) return indicator.progressReferences;
  const latest = indicator.latestProgress;
  return latest?.source === 'active_progress' ? [{
    id: latest.id, periodKey: latest.businessPeriodKey, progress: latest.progress,
    healthStatus: latest.healthStatus ?? null, content: latest.content ?? '',
    attachments: latest.attachments ?? [], createdAt: latest.updatedAt,
  }] : [];
}

export function belongsToReviewPeriod(record: PeriodReviewProgressReference, period: ReviewPeriod): boolean {
  if (period.periodType === 'month') return record.periodKey === period.periodKey;
  // Whole-cycle records must fall inside its actual date window, including partial months.
  const date = new Date(new Date(record.createdAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Boolean(period.periodStart && period.periodEnd
    && date >= period.periodStart.slice(0, 10) && date <= period.periodEnd.slice(0, 10));
}

export function compareProgressRecordedAt(left: PeriodReviewProgressReference, right: PeriodReviewProgressReference): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id);
}

export function summarizePeriodProgress(indicator: PeriodReviewIndicator, period: ReviewPeriod) {
  const records = progressReferencesFor(indicator).filter(record => belongsToReviewPeriod(record, period))
    .sort(compareProgressRecordedAt);
  const latest = records[records.length - 1];
  if (!latest) return null;
  return {
    recordCount: records.length,
    progress: latest.progress,
    healthStatus: latest.healthStatus,
    content: records.filter(record => record.content.trim()).map(record => record.content).join('\n\n'),
  };
}

export type PeriodProgressSummary = NonNullable<ReturnType<typeof summarizePeriodProgress>>;
