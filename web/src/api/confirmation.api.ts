import http from './http';
import type {
  Paginated,
  ConfirmationApplication,
  ConfirmationQuery,
  CreateConfirmationBody,
  UpdateConfirmationBody,
  ConfirmationWarning,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPut<T>(url: string, data?: unknown): Promise<T> {
  return http.put(url, data) as unknown as Promise<T>;
}

export const confirmationApi = {
  /** POST /confirmation-applications — HR 创建转正申请 */
  create(body: CreateConfirmationBody): Promise<ConfirmationApplication> {
    return apiPost('/confirmation-applications', body);
  },

  /** GET /confirmation-applications — HR 管理列表 */
  findAll(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications', query as Record<string, unknown>);
  },

  /** GET /confirmation-applications/pending — 当前用户待审批列表 */
  findPending(query?: ConfirmationQuery): Promise<Paginated<ConfirmationApplication>> {
    return apiGet('/confirmation-applications/pending', query as Record<string, unknown>);
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

  /** PUT /confirmation-applications/:id — HR 修改草稿 */
  update(id: string, body: UpdateConfirmationBody): Promise<ConfirmationApplication> {
    return apiPut(`/confirmation-applications/${id}`, body);
  },

  /** POST /confirmation-applications/:id/submit — HR 提交审批 */
  submit(id: string): Promise<{ id: string; status: string }> {
    return apiPost(`/confirmation-applications/${id}/submit`);
  },

  /** POST /confirmation-applications/:id/approve — 审批通过 */
  approve(id: string, comment?: string): Promise<{ id: string; status: string }> {
    return apiPost(`/confirmation-applications/${id}/approve`, { comment });
  },

  /** POST /confirmation-applications/:id/reject — 驳回 */
  reject(id: string, reason: string): Promise<{ id: string; status: string }> {
    return apiPost(`/confirmation-applications/${id}/reject`, { reason });
  },
};
