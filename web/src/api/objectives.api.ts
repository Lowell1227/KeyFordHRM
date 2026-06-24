import http from './http';
import type {
  Objective,
  ObjectiveQuery,
  CreateObjectiveBody,
  UpdateObjectiveBody,
  UpdateObjectiveProgressBody,
  Paginated,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export const objectivesApi = {
  /** GET /objectives/tree — 目标地图树。 */
  getTree(cycleId?: string): Promise<Objective[]> {
    return apiGet('/objectives/tree', cycleId ? { cycleId } : undefined);
  },

  /** GET /objectives — 列表（默认树）。 */
  findAll(query?: ObjectiveQuery): Promise<Objective[] | Paginated<Objective>> {
    return apiGet('/objectives', query as Record<string, unknown>);
  },

  /** GET /objectives/:id — 详情。 */
  getDetail(id: string): Promise<Objective> {
    return apiGet(`/objectives/${id}`);
  },

  /** POST /objectives — 创建。 */
  create(body: CreateObjectiveBody): Promise<Objective> {
    return http.post('/objectives', body) as unknown as Promise<Objective>;
  },

  /** PATCH /objectives/:id — 更新。 */
  update(id: string, body: UpdateObjectiveBody): Promise<Objective> {
    return http.patch(`/objectives/${id}`, body) as unknown as Promise<Objective>;
  },

  /** PATCH /objectives/:id/progress — 更新进度。 */
  updateProgress(id: string, body: UpdateObjectiveProgressBody): Promise<Objective> {
    return http.patch(`/objectives/${id}/progress`, body) as unknown as Promise<Objective>;
  },

  /** DELETE /objectives/:id — 删除。 */
  remove(id: string): Promise<void> {
    return http.delete(`/objectives/${id}`) as unknown as Promise<void>;
  },
};
