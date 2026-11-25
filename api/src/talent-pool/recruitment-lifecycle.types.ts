export const RECRUITMENT_TRACKING_STATES = ['recruiting', 'filled', 'paused', 'cancelled'] as const;
export type RecruitmentTrackingState = typeof RECRUITMENT_TRACKING_STATES[number];
export const RECRUITMENT_ANALYTICS_METRICS = ['application', 'interviewed', 'offered', 'accepted', 'hired'] as const;
export type RecruitmentAnalyticsMetric = typeof RECRUITMENT_ANALYTICS_METRICS[number];

export interface RecruitmentLifecycleSummary {
  approvedHeadcount: number | null; occupiedCount: number; acceptedCount: number; hiredCount: number;
  remainingCount: number | null; overCount: number | null; inProgressCount: number;
}
export interface RecruitmentLifecycleView {
  id: string; revision: number; trackingState: RecruitmentTrackingState; trackingChangedAt: string | null;
  trackingChangedByName: string | null; trackingReason: string | null; canEdit: boolean;
  summary: RecruitmentLifecycleSummary;
  externalPostings: Array<{ id: string; channel: string; name: string; url: string; active: boolean; ownerName: string | null }>;
  events: Array<{ id: string; action: string; revision: number; createdAt: string; actorName: string | null; reason: string | null;
    previousTrackingState: string | null; trackingState: string | null }>;
}
export interface RecruitmentChannelCounts {
  applicationCount: number; interviewedCount: number; offeredCount: number; acceptedCount: number; hiredCount: number;
}
export interface RecruitmentChannelSummary {
  items: Array<RecruitmentChannelCounts & { sourceChannel: string | null }>;
  totals: RecruitmentChannelCounts; periodBasis: 'application_created_at';
}
export interface RecruitmentAnalyticsApplication {
  id: string; candidateId: string; candidateName: string | null; candidateUnavailable: boolean; positionName: string;
  sourceChannel: string | null; demandId: string | null; stage: string; createdAt: string;
  interviewed: boolean; offered: boolean; accepted: boolean; hired: boolean;
}
