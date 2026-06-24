import http from './http';
import type {
  Paginated,
  Appeal,
  AppealListItem,
  AppealDetail,
  AppealQuery,
  CreateAppealBody,
  ResolveAppealBody,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export const appealsApi = {
  /** GET /appeals — 申诉列表 */
  findAll(query?: AppealQuery): Promise<Paginated<AppealListItem>> {
    return apiGet('/appeals', query as Record<string, unknown>);
  },

  /** GET /appeals/:id — 申诉详情 */
  findOne(id: string): Promise<AppealDetail> {
    return apiGet(`/appeals/${id}`);
  },

  /** POST /appeals — HR 录入申诉记录 */
  create(body: CreateAppealBody): Promise<Appeal> {
    return apiPost('/appeals', body);
  },

  /** POST /appeals/:id/resolve — HR 录入处理结论 */
  resolve(id: string, body: ResolveAppealBody): Promise<AppealDetail> {
    return apiPost(`/appeals/${id}/resolve`, body);
  },
};
