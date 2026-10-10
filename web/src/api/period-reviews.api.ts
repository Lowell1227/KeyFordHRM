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
  PeriodReviewAttachment,
} from '@/types/api.types';
import type { AxiosResponse } from 'axios';

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

  uploadEmployeeAttachment(periodId: string, file: File): Promise<PeriodReviewAttachment> {
    const body = new FormData();
    body.append('file', file);
    return http.post(
      `/assessment-periods/${periodId}/employee-attachments`,
      body,
    ) as unknown as Promise<PeriodReviewAttachment>;
  },

  deleteEmployeeAttachment(periodId: string, attachmentId: string): Promise<PeriodReviewAttachment[]> {
    return http.delete(
      `/assessment-periods/${periodId}/employee-attachments/${attachmentId}`,
    ) as unknown as Promise<PeriodReviewAttachment[]>;
  },

  async downloadAttachment(periodId: string, attachmentId: string): Promise<Blob> {
    const response = await http.get(
      `/assessment-periods/${periodId}/attachments/${attachmentId}`,
      { responseType: 'blob' },
    ) as unknown as AxiosResponse<Blob>;
    return response.data;
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
