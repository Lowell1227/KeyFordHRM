import http from './http';
import type {
  Paginated,
  Indicator,
  IndicatorQuery,
  CreateIndicatorBody,
  UpdateIndicatorBody,
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

export const indicatorsApi = {
  /** GET /indicators — 查询指标库 */
  findAll(query?: IndicatorQuery): Promise<Paginated<Indicator>> {
    return apiGet('/indicators', query as Record<string, unknown>);
  },

  /** POST /indicators — 创建指标 */
  create(body: CreateIndicatorBody): Promise<Indicator> {
    return apiPost('/indicators', body);
  },

  /** PUT /indicators/:id — 更新指标 */
  update(id: string, body: UpdateIndicatorBody): Promise<Indicator> {
    return apiPut(`/indicators/${id}`, body);
  },

  /** POST /indicators/import — 导入指标（multipart） */
  import(file: File): Promise<{ imported: number; failed: Array<{ row: number; reason: string }> }> {
    const form = new FormData();
    form.append('file', file);
    return apiPost('/indicators/import', form);
  },

  /** GET /indicators/import/template — 下载导入模板（blob） */
  getImportTemplate(): Promise<Blob> {
    return http
      .get('/indicators/import/template', { responseType: 'blob' })
      .then((res) => (res as { data: Blob }).data);
  },

  /** GET /indicators/export — 导出指标（blob） */
  export(query?: IndicatorQuery): Promise<Blob> {
    return http
      .get('/indicators/export', { params: query, responseType: 'blob' })
      .then((res) => (res as { data: Blob }).data);
  },
};
