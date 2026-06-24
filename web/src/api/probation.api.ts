import http from './http';
import type {
  Paginated,
  ProbationReview,
  ProbationReviewQuery,
  CreateProbationReviewBody,
  UpdateProbationReviewBody,
  SubmitProbationSelfEvalBody,
  SubmitProbationManagerScoreBody,
  ProbationReviewActionResult,
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

export const probationApi = {
  /** POST /probation-reviews — HR 发起试用期考核 */
  create(body: CreateProbationReviewBody): Promise<ProbationReview> {
    return apiPost('/probation-reviews', body);
  },

  /** GET /probation-reviews — HR 管理列表 */
  findAll(query?: ProbationReviewQuery): Promise<Paginated<ProbationReview>> {
    return apiGet('/probation-reviews', query as Record<string, unknown>);
  },

  /** GET /probation-reviews/managed — 主管查看管理的考核 */
  findManaged(query?: ProbationReviewQuery): Promise<Paginated<ProbationReview>> {
    return apiGet('/probation-reviews/managed', query as Record<string, unknown>);
  },

  /** GET /probation-reviews/mine — 员工查看自己的考核 */
  findMine(query?: ProbationReviewQuery): Promise<Paginated<ProbationReview>> {
    return apiGet('/probation-reviews/mine', query as Record<string, unknown>);
  },

  /** GET /probation-reviews/:id — 详情 */
  findOne(id: string): Promise<ProbationReview> {
    return apiGet(`/probation-reviews/${id}`);
  },

  /** PUT /probation-reviews/:id — HR 更新 */
  update(id: string, body: UpdateProbationReviewBody): Promise<ProbationReview> {
    return apiPut(`/probation-reviews/${id}`, body);
  },

  /** POST /probation-reviews/:id/self-eval — 员工自评 */
  submitSelfEval(id: string, body: SubmitProbationSelfEvalBody): Promise<ProbationReviewActionResult> {
    return apiPost(`/probation-reviews/${id}/self-eval`, body);
  },

  /** POST /probation-reviews/:id/manager-score — 主管评分 */
  submitManagerScore(id: string, body: SubmitProbationManagerScoreBody): Promise<ProbationReviewActionResult> {
    return apiPost(`/probation-reviews/${id}/manager-score`, body);
  },

  /** POST /probation-reviews/:id/close — HR 结束考核 */
  close(id: string): Promise<ProbationReviewActionResult> {
    return apiPost(`/probation-reviews/${id}/close`);
  },
};
