import http from './http';
import type { ApprovalOverview, ApprovalTaskView, AssessmentCycle } from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export const approvalApi = {
  /** GET /cycles/:id/approval — 审批人待审批列表 */
  getApprovalList(cycleId: string): Promise<ApprovalTaskView[]> {
    return apiGet(`/cycles/${cycleId}/approval`);
  },

  /** GET /cycles/:id/approval/overview — 审批概览（全校准分布只读 + 退回记录） */
  getOverview(cycleId: string): Promise<ApprovalOverview> {
    return apiGet(`/cycles/${cycleId}/approval/overview`);
  },

  /** POST /cycles/:id/approval — 批量审批通过 */
  approve(
    cycleId: string,
    body: { taskIds: string[]; comment?: string },
  ): Promise<{ approved: number }> {
    return apiPost(`/cycles/${cycleId}/approval`, body);
  },

  /** POST /tasks/:id/approval/reject — 退回绩效校准 */
  rejectTask(taskId: string, body: { comment?: string }): Promise<void> {
    return apiPost(`/tasks/${taskId}/approval/reject`, body);
  },
};

export type { AssessmentCycle };
