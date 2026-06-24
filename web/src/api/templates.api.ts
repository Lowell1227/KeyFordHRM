import http from './http';
import type {
  Paginated,
  AssessmentTemplate,
  TemplateListItem,
  TemplateQuery,
  CreateTemplateBody,
  UpdateTemplateBody,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPut<T>(url: string, data?: unknown, options?: { skipErrorMessage?: boolean }): Promise<T> {
  return http.put(url, data, options) as unknown as Promise<T>;
}

function apiDelete<T>(url: string, data?: unknown): Promise<T> {
  return http.delete(url, { data }) as unknown as Promise<T>;
}

export const templatesApi = {
  /** GET /templates — 查询模板列表 */
  findAll(query?: TemplateQuery): Promise<Paginated<TemplateListItem>> {
    return apiGet('/templates', query as Record<string, unknown>);
  },

  /** GET /templates/:id — 查询模板详情 */
  findOne(id: string): Promise<AssessmentTemplate> {
    return apiGet(`/templates/${id}`);
  },

  /** POST /templates — 创建模板 */
  create(body: CreateTemplateBody): Promise<AssessmentTemplate> {
    return apiPost('/templates', body);
  },

  /** PUT /templates/:id — 更新模板 */
  update(id: string, body: UpdateTemplateBody): Promise<AssessmentTemplate> {
    return apiPut(`/templates/${id}`, body, { skipErrorMessage: true });
  },

  /** POST /templates/:id/duplicate — 复制模板 */
  duplicate(id: string): Promise<AssessmentTemplate> {
    return apiPost(`/templates/${id}/duplicate`);
  },

  /** DELETE /templates — 逻辑删除模板 */
  removeMany(ids: string[]): Promise<{ deletedCount: number }> {
    return apiDelete('/templates', { ids });
  },
};
