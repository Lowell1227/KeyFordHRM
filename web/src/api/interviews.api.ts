import http from './http';
import type {
  Paginated,
  PerformanceInterview,
  UpdateInterviewBody,
} from '@/types/api.types';
import type { InterviewQuery } from '@/types/interview.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPut<T>(url: string, data?: unknown): Promise<T> {
  return http.put(url, data) as unknown as Promise<T>;
}

export const interviewsApi = {
  /** GET /interviews — 主管面谈列表 */
  findAll(query?: InterviewQuery): Promise<Paginated<PerformanceInterview>> {
    return apiGet('/interviews', query as Record<string, unknown>);
  },

  /** GET /interviews/mine — 员工自己的面谈列表 */
  findMine(query?: InterviewQuery): Promise<Paginated<PerformanceInterview>> {
    return apiGet('/interviews/mine', query as Record<string, unknown>);
  },

  /** GET /interviews/:id — 面谈详情 */
  findOne(id: string): Promise<PerformanceInterview> {
    return apiGet(`/interviews/${id}`);
  },

  /** PUT /interviews/:id — 主管填写/更新面谈记录 */
  update(id: string, body: UpdateInterviewBody): Promise<PerformanceInterview> {
    return apiPut(`/interviews/${id}`, body);
  },

  /** POST /interviews/:id/manager-sign — 主管签字 */
  managerSign(id: string): Promise<PerformanceInterview> {
    return apiPost(`/interviews/${id}/manager-sign`);
  },

  /** POST /interviews/:id/employee-sign — 员工签字 */
  employeeSign(id: string): Promise<PerformanceInterview> {
    return apiPost(`/interviews/${id}/employee-sign`);
  },
};
