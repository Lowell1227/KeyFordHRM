import http from './http';
import type {
  Paginated,
  ConfirmationApplication,
  ConfirmationQuery,
  ConfirmationWarning,
  ConfirmationRoster,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export const confirmationApi = {
  myRoster(): Promise<ConfirmationRoster> {
    return apiGet('/confirmation-applications/my-roster');
  },
  handlerCandidates(keyword?: string): Promise<Array<{ id: string; name: string; employeeNo: string | null; deptName: string | null; hrEligible: boolean }>> {
    return apiGet('/confirmation-applications/handler-candidates', { keyword });
  },

  assignHandlers(id: string, body: { hrId: string; companyApproverId: string; reason?: string }): Promise<{ id: string; managerId: string; hrId: string; companyApproverId: string }> {
    return http.put(`/confirmation-applications/${id}/handlers`, body, { skipErrorMessage: true }) as unknown as Promise<{ id: string; managerId: string; hrId: string; companyApproverId: string }>;
  },
  /** 新流程：试用期员工本人创建草稿。 */
  createSelfDraft(summary: string): Promise<ConfirmationApplication> {
    return http.post('/confirmation-applications', { summary }, { skipErrorMessage: true }) as unknown as Promise<ConfirmationApplication>;
  },

  /** 新流程：员工本人保存工作小结。 */
  saveSelfDraft(id: string, summary: string): Promise<ConfirmationApplication> {
    return http.put(`/confirmation-applications/${id}`, { summary }, { skipErrorMessage: true }) as unknown as Promise<ConfirmationApplication>;
  },

  /** 新流程：员工本人提交。 */
  submitSelf(id: string): Promise<{ id: string; status: string }> {
    return http.post(`/confirmation-applications/${id}/submit`, {}, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string }>;
  },

  submitManagerEvaluation(id: string, recommendation: boolean, comment: string): Promise<{ id: string; status: string }> {
    return http.post(`/confirmation-applications/${id}/approve`, { recommendation, comment }, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string }>;
  },

  submitHrConclusion(id: string, body: {
    voteResult: 'pass' | 'extend' | 'fail';
    voteComment?: string;
    meetingDate?: string;
    proposedRegularDate: string;
    comment?: string;
  }): Promise<{ id: string; status: string }> {
    return http.post(`/confirmation-applications/${id}/approve`, body, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string }>;
  },

  uploadMeetingAttachment(id: string, file: File): Promise<{ id: string; name: string; size: number; mimeType: string; uploadedById: string; createdAt: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return http.post(`/confirmation-applications/${id}/meeting-attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }, skipErrorMessage: true,
    }) as unknown as Promise<{ id: string; name: string; size: number; mimeType: string; uploadedById: string; createdAt: string }>;
  },

  downloadMeetingAttachment(id: string, attachmentId: string): Promise<Blob> {
    return http.get(`/confirmation-applications/${id}/meeting-attachments/${attachmentId}/download`, {
      responseType: 'blob', skipErrorMessage: true,
    }).then((response) => (response as unknown as { data: Blob }).data);
  },

  backfillMeetingDate(id: string, meetingDate: string): Promise<{ id: string; meetingDate: string }> {
    return http.put(`/confirmation-applications/${id}/meeting-date`, { meetingDate }, { skipErrorMessage: true }) as unknown as Promise<{ id: string; meetingDate: string }>;
  },

  approveCompany(id: string, confirmedRegularDate: string, comment?: string): Promise<{ id: string; status: string }> {
    return http.post(`/confirmation-applications/${id}/approve`, { confirmedRegularDate, comment }, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string }>;
  },

  declineCompany(id: string, reason: string): Promise<{ id: string; status: string }> {
    return http.post(`/confirmation-applications/${id}/reject`, { reason }, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string }>;
  },

  returnForSupplement(id: string, reason: string): Promise<{ id: string; status: string; returnReason: string }> {
    return http.post(`/confirmation-applications/${id}/return`, { reason }, { skipErrorMessage: true }) as unknown as Promise<{ id: string; status: string; returnReason: string }>;
  },

  /** GET /confirmation-applications — HR 管理列表 */
  findAll(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications', query as Record<string, unknown>);
  },

  /** GET /confirmation-applications/pending — 当前用户待审批列表 */
  findPending(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications/pending', query as Record<string, unknown>);
  },

  findAssignedHistory(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications/assigned-history', query as Record<string, unknown>);
  },

  /** GET /confirmation-applications/mine — 员工查看自己的 */
  findMine(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications/mine', query as Record<string, unknown>);
  },

  /** GET /confirmation-applications/warnings — HR 未提交预警 */
  warnings(): Promise<ConfirmationWarning[]> {
    return apiGet('/confirmation-applications/warnings');
  },

  /** GET /confirmation-applications/:id — 详情 */
  findOne(id: string): Promise<ConfirmationApplication> {
    return apiGet(`/confirmation-applications/${id}`);
  },

};
