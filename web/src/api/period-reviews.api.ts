import http from './http';
import type {
  PeriodReviewActionResult,
  PeriodReviewDetail,
  SaveEmployeePeriodReviewDraftBody,
  SubmitEmployeePeriodReviewBody,
  SaveManagerPeriodReviewDraftBody,
  ReturnManagerPeriodReviewBody,
  SubmitManagerPeriodReviewBody,
} from '@/types/api.types';

export const periodReviewsApi = {
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
};
