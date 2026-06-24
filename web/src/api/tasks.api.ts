import http from './http';
import type {
  Paginated,
  TaskListItem,
  TaskDetail,
  TaskQuery,
  CreateTaskBody,
  BatchCreateTaskBody,
  SetIndicatorBody,
  UpdateActualValueBody,
  SubmitSelfEvalBody,
  SubmitIndicatorProposalBody,
  SubmitIndicatorProposalResult,
  SubmitManagerScoreBody,
  DeptReviewBody,
  ExemptTaskBody,
  FlowRecord,
  PerformanceInterview,
} from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPut<T>(url: string, data?: unknown): Promise<T> {
  return http.put(url, data) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

function apiDelete<T>(url: string): Promise<T> {
  return http.delete(url) as unknown as Promise<T>;
}

export type TaskActionResult = { id: string; status: TaskStatus };

export const tasksApi = {
  /** GET /tasks — 任务列表 */
  findAll(query?: TaskQuery): Promise<Paginated<TaskListItem>> {
    return apiGet('/tasks', query as Record<string, unknown>);
  },

  /** GET /tasks/mine — 我的任务列表 */
  findMine(query?: Omit<TaskQuery, 'employeeId'>): Promise<Paginated<TaskListItem>> {
    return apiGet('/tasks/mine', query as Record<string, unknown>);
  },

  /** GET /tasks/:id — 详情 */
  findOne(id: string): Promise<TaskDetail> {
    return apiGet(`/tasks/${id}`);
  },

  /** POST /tasks — 创建单个任务 */
  create(body: CreateTaskBody): Promise<TaskListItem> {
    return apiPost('/tasks', body);
  },

  /** POST /tasks/batch — 批量创建任务 */
  batchCreate(body: BatchCreateTaskBody): Promise<{ created: number; failed: string[] }> {
    return apiPost('/tasks/batch', body);
  },

  /** DELETE /tasks/:id — 删除任务 */
  remove(id: string): Promise<void> {
    return apiDelete(`/tasks/${id}`);
  },

  // 指标阶段
  /** PUT /tasks/:id/indicators — 制定/修改指标 */
  setIndicators(id: string, body: SetIndicatorBody): Promise<TaskDetail> {
    return apiPut(`/tasks/${id}/indicators`, body);
  },

  /** POST /tasks/:id/indicators/confirm — 员工确认指标 */
  confirmIndicators(id: string): Promise<TaskActionResult> {
    return apiPost(`/tasks/${id}/indicators/confirm`);
  },

  /** POST /tasks/:id/indicators/reject — 员工驳回指标 */
  rejectIndicators(id: string, body: { comment?: string }): Promise<TaskActionResult> {
    return apiPost(`/tasks/${id}/indicators/reject`, body);
  },

  /** POST /tasks/:id/indicator-proposal — 员工提交指标建议 */
  submitIndicatorProposal(
    id: string,
    body: SubmitIndicatorProposalBody,
  ): Promise<SubmitIndicatorProposalResult> {
    return apiPost(`/tasks/${id}/indicator-proposal`, body);
  },

  /** PUT /tasks/:id/actual-value — 更新实际完成值 */
  updateActualValues(
    id: string,
    body: UpdateActualValueBody,
  ): Promise<{ id: string; updatedCount: number }> {
    return apiPut(`/tasks/${id}/actual-value`, body);
  },

  // 自评
  /** POST /tasks/:id/self-eval — 员工提交自评 */
  submitSelfEval(id: string, body: SubmitSelfEvalBody): Promise<TaskActionResult> {
    return apiPost(`/tasks/${id}/self-eval`, body);
  },

  // 主管评分
  /** POST /tasks/:id/manager-score — 提交主管评分 */
  submitManagerScore(id: string, body: SubmitManagerScoreBody): Promise<TaskActionResult> {
    return apiPost(`/tasks/${id}/manager-score`, body);
  },

  // 部门审核
  /** POST /tasks/:id/dept-review — 部门审核 */
  deptReview(id: string, body: DeptReviewBody): Promise<TaskDetail> {
    return apiPost(`/tasks/${id}/dept-review`, body);
  },

  // 结果确认
  /** POST /tasks/:id/employee-confirm — 员工确认结果 */
  confirmResult(id: string): Promise<TaskActionResult> {
    return apiPost(`/tasks/${id}/employee-confirm`);
  },

  /** GET /tasks/:id/interview — 任务详情页查看面谈记录 */
  getInterview(id: string): Promise<PerformanceInterview> {
    return apiGet(`/tasks/${id}/interview`);
  },

  // 豁免
  /** PATCH /tasks/:id/exempt — 设置豁免 */
  setExempt(id: string, body: ExemptTaskBody): Promise<TaskDetail> {
    return apiPatch(`/tasks/${id}/exempt`, body);
  },

  // 流程记录
  /** GET /tasks/:id/flow-records — 任务操作日志 */
  getFlowRecords(id: string): Promise<FlowRecord[]> {
    return apiGet(`/tasks/${id}/flow-records`);
  },
};
