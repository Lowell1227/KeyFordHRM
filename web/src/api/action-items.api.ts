import http from './http';
import type {
  ActionItem,
  ActionItemQuery,
  CreateActionItemBody,
  UpdateActionItemBody,
  UpdateActionItemProgressBody,
  Paginated,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export const actionItemsApi = {
  /** GET /action-items — 分页列表。 */
  findAll(query?: ActionItemQuery): Promise<Paginated<ActionItem>> {
    return apiGet('/action-items', query as Record<string, unknown>);
  },

  /** GET /action-items/tree?objectiveId= — 目标下行动项树。 */
  getTree(objectiveId: string): Promise<ActionItem[]> {
    return apiGet('/action-items/tree', { objectiveId });
  },

  /** GET /action-items/:id — 详情。 */
  getDetail(id: string): Promise<ActionItem> {
    return apiGet(`/action-items/${id}`);
  },

  /** POST /action-items — 创建。 */
  create(body: CreateActionItemBody): Promise<ActionItem> {
    return http.post('/action-items', body) as unknown as Promise<ActionItem>;
  },

  /** PATCH /action-items/:id — 更新。 */
  update(id: string, body: UpdateActionItemBody): Promise<ActionItem> {
    return http.patch(`/action-items/${id}`, body) as unknown as Promise<ActionItem>;
  },

  /** PATCH /action-items/:id/progress — 更新进度。 */
  updateProgress(id: string, body: UpdateActionItemProgressBody): Promise<ActionItem> {
    return http.patch(`/action-items/${id}/progress`, body) as unknown as Promise<ActionItem>;
  },

  /** DELETE /action-items/:id — 删除。 */
  remove(id: string): Promise<void> {
    return http.delete(`/action-items/${id}`) as unknown as Promise<void>;
  },
};
