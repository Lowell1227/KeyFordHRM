import http from './http';
import type {
  PeriodReviewActionResult,
  PeriodReviewDetail,
  SaveEmployeePeriodReviewDraftBody,
  SubmitEmployeePeriodReviewBody,
  SaveManagerPeriodReviewDraftBody,
  ReturnManagerPeriodReviewBody,
  SubmitManagerPeriodReviewBody,
  PeriodMonitoringQuery,
  PeriodMonitoringResult,
  ReopenPeriodReviewBody,
} from '@/types/api.types';

export const periodReviewsApi = {
  findCycleMonitoring(
    cycleId: string,
    query: PeriodMonitoringQuery,
  ): Promise<PeriodMonitoringResult> {
    return http.get(`/assessment-periods/cycle/${cycleId}/monitoring`, { params: query }) as unknown as Promise<PeriodMonitoringResult>;
  },

  findOne(periodId: string): Promise<PeriodReviewDetail> {
    return http.get(`/assessment-periods/${periodId}/review`) as unknown as Promise<PeriodReviewDetail>;
  },

  saveEmployeeDraft(
    periodId: string,
    body: SaveEmployeePeriodReviewDraftBody,
  ): Promise<PeriodReviewActionResult> {
    return http.put(`/assessment-periods/${periodId}/employee-draft`, body) as unknown as Promise<PeriodReviewActionResult>;
  },

  submitEmployeeReview(
    periodId: string,
    body: SubmitEmployeePeriodReviewBody,
  ): Promise<PeriodReviewActionResult> {
    return http.post(`/assessment-periods/${periodId}/employee-submit`, body) as unknown as Promise<PeriodReviewActionResult>;
  },

  saveManagerDraft(
    periodId: string,
    body: SaveManagerPeriodReviewDraftBody,
  ): Promise<PeriodReviewActionResult> {
    return http.put(`/assessment-periods/${periodId}/manager-draft`, body) as unknown as Promise<PeriodReviewActionResult>;
  },

  returnManagerReview(
    periodId: string,
    body: ReturnManagerPeriodReviewBody,
  ): Promise<PeriodReviewActionResult> {
    return http.post(`/assessment-periods/${periodId}/manager-return`, body) as unknown as Promise<PeriodReviewActionResult>;
  },

  submitManagerReview(
    periodId: string,
    body: SubmitManagerPeriodReviewBody,
  ): Promise<PeriodReviewActionResult> {
    return http.post(`/assessment-periods/${periodId}/manager-submit`, body) as unknown as Promise<PeriodReviewActionResult>;
  },

  reopenPeriodReview(
    periodId: string,
    body: ReopenPeriodReviewBody,
  ): Promise<PeriodReviewActionResult> {
    return http.post(`/assessment-periods/${periodId}/reopen`, body) as unknown as Promise<PeriodReviewActionResult>;
  },
};
