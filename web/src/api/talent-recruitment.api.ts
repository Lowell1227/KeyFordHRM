import http from './http';
import type { Paginated } from '@/types/api.types';
import type {
  TalentApplicationAction, TalentApplicationInput, TalentApplicationView, TalentFeedbackOutcome,
  TalentFeedbackResponse, TalentRecruitmentOwner,
} from '@/types/talent.types';

const base = '/talent-recruitment';
const localError = { skipErrorMessage: true };
export const talentRecruitmentApi = {
  hiringReviews(): Promise<TalentApplicationView[]> {
    return http.get(`${base}/hiring-reviews`) as unknown as Promise<TalentApplicationView[]>;
  },
  owners(query: { keyword?: string; page?: number; pageSize?: number } = {}): Promise<Paginated<TalentRecruitmentOwner>> {
    return http.get(`${base}/owners`, { params: query }) as unknown as Promise<Paginated<TalentRecruitmentOwner>>;
  },
  applications(candidateId: string): Promise<TalentApplicationView[]> {
    return http.get(`${base}/candidates/${candidateId}/applications`) as unknown as Promise<TalentApplicationView[]>;
  },
  create(candidateId: string, body: TalentApplicationInput): Promise<TalentApplicationView> {
    return http.post(`${base}/candidates/${candidateId}/applications`, body, localError) as unknown as Promise<TalentApplicationView>;
  },
  detail(id: string): Promise<TalentApplicationView> {
    return http.get(`${base}/applications/${id}`) as unknown as Promise<TalentApplicationView>;
  },
  update(id: string, body: Partial<TalentApplicationInput> & { expectedRevision: number }): Promise<TalentApplicationView> {
    return http.patch(`${base}/applications/${id}`, body, localError) as unknown as Promise<TalentApplicationView>;
  },
  action(id: string, body: { expectedRevision: number; action: TalentApplicationAction; note?: string; expectedEntryDate?: string | null }): Promise<TalentApplicationView> {
    return http.post(`${base}/applications/${id}/actions`, body, localError) as unknown as Promise<TalentApplicationView>;
  },
  feedback(interviewId: string): Promise<TalentFeedbackResponse> {
    return http.get(`${base}/interviews/${interviewId}/feedback`) as unknown as Promise<TalentFeedbackResponse>;
  },
  saveFeedback(interviewId: string, body: { interviewVersion: number; expectedRevision: number; outcome?: TalentFeedbackOutcome; summary?: string; submit: boolean }): Promise<TalentFeedbackResponse> {
    return http.put(`${base}/interviews/${interviewId}/feedback`, body, localError) as unknown as Promise<TalentFeedbackResponse>;
  },
  returnFeedback(interviewId: string, userId: string, body: { interviewVersion: number; expectedRevision: number; note: string }): Promise<TalentFeedbackResponse> {
    return http.post(`${base}/interviews/${interviewId}/feedback/${userId}/return`, body, localError) as unknown as Promise<TalentFeedbackResponse>;
  },
};

export function recruitmentError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
  if (response?.status === 409) return '记录已变化，输入已保留。请核对最新记录后重新办理。';
  if (response?.status === 403) return '当前无权执行此操作，请联系经办或管理员核对权限。';
  const message = response?.data?.message;
  return Array.isArray(message) ? message.join('；') : message || '读取或保存失败，请重试。';
}
