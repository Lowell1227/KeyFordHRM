import http from './http';
import type {
  Paginated,
  ImprovementPlan,
  ImprovementPlanQuery,
  FillImprovementPlanBody,
  CompleteImprovementPlanBody,
  ConsecutiveDWarning,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export const improvementPlansApi = {
  /** GET /improvement-plans — 改进计划列表。 */
  findAll(query?: ImprovementPlanQuery): Promise<Paginated<ImprovementPlan>> {
    return apiGet('/improvement-plans', query as Record<string, unknown>);
  },

  /** GET /improvement-plans/:id — 详情。 */
  getDetail(id: string): Promise<ImprovementPlan> {
    return apiGet(`/improvement-plans/${id}`);
  },

  /** POST /improvement-plans/:id/fill — 填写计划。 */
  fill(id: string, body: FillImprovementPlanBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/fill`, body) as unknown as Promise<ImprovementPlan>;
  },

  /** POST /improvement-plans/:id/complete — 录最终评分。 */
  complete(id: string, body: CompleteImprovementPlanBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/complete`, body) as unknown as Promise<ImprovementPlan>;
  },

  /** GET /improvement-plans/employee/:employeeId/consecutive-d-warning */
  getConsecutiveDWarning(employeeId: string): Promise<ConsecutiveDWarning> {
    return apiGet(`/improvement-plans/employee/${employeeId}/consecutive-d-warning`);
  },
};
