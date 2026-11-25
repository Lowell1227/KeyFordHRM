import http from './http';
import type { Paginated } from '@/types/api.types';

export type RecruitmentTrackingState = 'recruiting' | 'filled' | 'paused' | 'cancelled';
export type RecruitmentAnalyticsMetric = 'application' | 'interviewed' | 'offered' | 'accepted' | 'hired';
export interface RecruitmentLifecycleView {
  id: string; revision: number; trackingState: RecruitmentTrackingState; trackingChangedAt: string | null;
  trackingChangedByName: string | null; trackingReason: string | null; canEdit: boolean;
  summary: { approvedHeadcount: number | null; occupiedCount: number; acceptedCount: number; hiredCount: number;
    remainingCount: number | null; overCount: number | null; inProgressCount: number };
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
export interface RecruitmentAnalyticsQuery {
  demandId?: string; sourceChannel?: string; unknownSource?: boolean; from?: string; to?: string;
  metric?: RecruitmentAnalyticsMetric; page?: number; pageSize?: number;
}
const localError = { skipErrorMessage: true };
export const recruitmentLifecycleApi = {
  detail(id: string): Promise<RecruitmentLifecycleView> {
    return http.get(`/recruitment-demands/${encodeURIComponent(id)}/lifecycle`, localError) as unknown as Promise<RecruitmentLifecycleView>;
  },
  change(id: string, input: { expectedRevision: number; trackingState: RecruitmentTrackingState; reason: string }): Promise<RecruitmentLifecycleView> {
    return http.patch(`/recruitment-demands/${encodeURIComponent(id)}/lifecycle`, input, localError) as unknown as Promise<RecruitmentLifecycleView>;
  },
};
export const recruitmentAnalyticsApi = {
  channels(query: RecruitmentAnalyticsQuery): Promise<RecruitmentChannelSummary> {
    return http.get('/recruitment-analytics/channels', { params: query, ...localError }) as unknown as Promise<RecruitmentChannelSummary>;
  },
  applications(query: RecruitmentAnalyticsQuery): Promise<Paginated<RecruitmentAnalyticsApplication>> {
    return http.get('/recruitment-analytics/applications', { params: query, ...localError }) as unknown as Promise<Paginated<RecruitmentAnalyticsApplication>>;
  },
};
