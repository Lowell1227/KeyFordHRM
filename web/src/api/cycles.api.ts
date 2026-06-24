import http from './http';
import type {
  Paginated,
  AssessmentCycle,
  CycleQuery,
  CreateCycleBody,
  UpdateDeadlinesBody,
  PublishResultsBody,
  PublishResultsResult,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export const cyclesApi = {
  /** GET /cycles — 查询周期列表（hr/system_admin/vp/chairman 可访问） */
  findAll(query?: CycleQuery): Promise<Paginated<AssessmentCycle>> {
    return apiGet('/cycles', query as Record<string, unknown>);
  },

  /** GET /cycles/:id — 周期详情 */
  findOne(id: string): Promise<AssessmentCycle> {
    return apiGet(`/cycles/${id}`);
  },

  /** POST /cycles — 创建周期（限 hr/system_admin） */
  create(body: CreateCycleBody): Promise<AssessmentCycle> {
    return apiPost('/cycles', body);
  },

  /**
   * PATCH /cycles/:id/deadlines — 修改各节点截止日期。
   * 只能改截止日，不能改周期名称/起止日/等级上限等。
   */
  updateDeadlines(id: string, body: UpdateDeadlinesBody): Promise<AssessmentCycle> {
    return apiPatch(`/cycles/${id}/deadlines`, body);
  },

  /**
   * POST /cycles/:id/launch — 发起周期。
   * 会为全员生成考核任务并绑定模板快照，可能耗时较长，调用方需加 loading。
   */
  launch(id: string): Promise<AssessmentCycle> {
    return apiPost(`/cycles/${id}/launch`);
  },

  /** POST /cycles/:id/publish — HR 批量公示结果 */
  publishResults(id: string, body: PublishResultsBody): Promise<PublishResultsResult> {
    return apiPost(`/cycles/${id}/publish`, body);
  },
};
