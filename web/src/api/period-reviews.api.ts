import http from './http';
import type {
  PeriodReviewActionResult,
  PeriodReviewDetail,
  SaveEmployeePeriodReviewDraftBody,
  SubmitEmployeePeriodReviewBody,
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
};
