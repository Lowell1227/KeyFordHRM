import http from './http';
import type {
  Paginated,
  ImprovementPlan,
  ImprovementPlanQuery,
  CreateImprovementPlanBody,
  UpdateImprovementPlanBody,
  ImprovementDecisionBody,
  ImprovementGoalDecisionBody,
  ImprovementEvaluationBody,
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

  eligibleEmployees(): Promise<Array<{ id: string; name: string; employeeNo: string | null; deptName: string | null }>> {
    return apiGet('/improvement-plans/eligible-employees');
  },

  cycles(): Promise<Array<{ id: string; name: string }>> { return apiGet('/improvement-plans/cycles'); },
  myPending(): Promise<ImprovementPlan[]> { return apiGet('/improvement-plans/my-pending'); },
  create(body: CreateImprovementPlanBody): Promise<ImprovementPlan> {
    return http.post('/improvement-plans', body) as unknown as Promise<ImprovementPlan>;
  },
  update(id: string, body: UpdateImprovementPlanBody): Promise<ImprovementPlan> {
    return http.patch(`/improvement-plans/${id}`, body) as unknown as Promise<ImprovementPlan>;
  },
  submitGoals(id: string): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/submit-goals`) as unknown as Promise<ImprovementPlan>;
  },
  decideGoals(id: string, body: ImprovementGoalDecisionBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/decide-goals`, body) as unknown as Promise<ImprovementPlan>;
  },
  evaluate(id: string, body: ImprovementEvaluationBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/evaluate`, body) as unknown as Promise<ImprovementPlan>;
  },
  saveEvaluation(id: string, body: ImprovementEvaluationBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/save-evaluation`, body) as unknown as Promise<ImprovementPlan>;
  },
  decideFinal(id: string, body: ImprovementDecisionBody): Promise<ImprovementPlan> {
    return http.post(`/improvement-plans/${id}/decide-final`, body) as unknown as Promise<ImprovementPlan>;
  },
};
