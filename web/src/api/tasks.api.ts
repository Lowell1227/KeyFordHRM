import http from "./http";
import type {
  Paginated,
  TaskListItem,
  TaskDetail,
  TaskQuery,
  TeamTaskQuery,
  TeamTaskPage,
  BatchReviewResult,
  BatchIndicatorReviewBody,
  BatchRejectIndicatorReviewBody,
  IndicatorReferenceItem,
  ReferenceIndicatorQuery,
  CreateTaskBody,
  BatchCreateTaskBody,
  SetIndicatorBody,
  UpdateActualValueBody,
  SubmitSelfEvalBody,
  SubmitIndicatorProposalBody,
  SubmitIndicatorProposalResult,
  SubmitManagerScoreBody,
  SaveManagerEvaluationDraftBody,
  WithdrawManagerScoreBody,
  DeptReviewBody,
  ExemptTaskBody,
  FlowRecord,
  PerformanceInterview,
} from "@/types/api.types";
import type { TaskStatus } from "@/types/enums";

export interface TasksApiClient {
  get(
    url: string,
    config?: { params?: Record<string, unknown> },
  ): Promise<unknown>;
  post(
    url: string,
    data?: unknown,
    config?: { skipErrorMessage?: boolean },
  ): Promise<unknown>;
  put(
    url: string,
    data?: unknown,
    config?: { skipErrorMessage?: boolean },
  ): Promise<unknown>;
  patch(url: string, data?: unknown): Promise<unknown>;
  delete(url: string): Promise<unknown>;
}

export type TaskActionResult = { id: string; status: TaskStatus; updatedAt?: string };

export function createTasksApi(client: TasksApiClient) {
  const apiGet = <T>(
    url: string,
    params?: Record<string, unknown>,
  ): Promise<T> => client.get(url, { params }) as Promise<T>;
  const apiPost = <T>(
    url: string,
    data?: unknown,
    config?: { skipErrorMessage?: boolean },
  ): Promise<T> => client.post(url, data, config) as Promise<T>;
  const apiPut = <T>(
    url: string,
    data?: unknown,
    config?: { skipErrorMessage?: boolean },
  ): Promise<T> => client.put(url, data, config) as Promise<T>;
  const apiPatch = <T>(url: string, data?: unknown): Promise<T> =>
    client.patch(url, data) as Promise<T>;
  const apiDelete = <T>(url: string): Promise<T> =>
    client.delete(url) as Promise<T>;

  return {
    /** GET /tasks — 任务列表 */
    findAll(query?: TaskQuery): Promise<Paginated<TaskListItem>> {
      return apiGet("/tasks", query as Record<string, unknown>);
    },

    /** GET /tasks/mine — 我的任务列表 */
    findMine(
      query?: Omit<TaskQuery, "employeeId">,
    ): Promise<Paginated<TaskListItem>> {
      return apiGet("/tasks/mine", query as Record<string, unknown>);
    },

    /** GET /tasks/team — 主管团队任务工作台。 */
    findTeam(query: TeamTaskQuery): Promise<TeamTaskPage> {
      return apiGet("/tasks/team", query as unknown as Record<string, unknown>);
    },

    /** GET /tasks/reference-indicators — 可见参考指标。 */
    findReferenceIndicators(
      query?: ReferenceIndicatorQuery,
    ): Promise<Paginated<IndicatorReferenceItem>> {
      return apiGet(
        "/tasks/reference-indicators",
        query as Record<string, unknown>,
      );
    },

    /** POST /tasks/team/indicator-review/batch-approve — 批量通过目标审核。 */
    batchApproveIndicators(
      body: BatchIndicatorReviewBody,
    ): Promise<BatchReviewResult> {
      return apiPost("/tasks/team/indicator-review/batch-approve", body);
    },

    /** POST /tasks/team/indicator-review/batch-reject — 批量退回目标审核。 */
    batchRejectIndicators(
      body: BatchRejectIndicatorReviewBody,
    ): Promise<BatchReviewResult> {
      return apiPost("/tasks/team/indicator-review/batch-reject", body);
    },

    /** GET /tasks/:id — 详情 */
    findOne(id: string): Promise<TaskDetail> {
      return apiGet(`/tasks/${id}`);
    },

    /** POST /tasks/:id/remind — 催办当前处理人 */
    remindCurrentHandler(id: string): Promise<{
      sent: true;
      nodeType: 'employee' | 'manager' | 'deptHead' | 'approver';
    }> {
      return apiPost(`/tasks/${id}/remind`);
    },

    /** POST /tasks — 创建单个任务 */
    create(body: CreateTaskBody): Promise<TaskListItem> {
      return apiPost("/tasks", body);
    },

    /** POST /tasks/batch — 批量创建任务 */
    batchCreate(
      body: BatchCreateTaskBody,
    ): Promise<{ created: number; failed: string[] }> {
      return apiPost("/tasks/batch", body);
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

    /** POST /tasks/:id/indicators/reject — 退回指标 */
    rejectIndicators(
      id: string,
      body: { comment?: string },
    ): Promise<TaskActionResult> {
      return apiPost(`/tasks/${id}/indicators/reject`, body);
    },

    /** POST /tasks/:id/indicators/withdraw — 主管开始审核前撤回 */
    withdrawIndicators(
      id: string,
      body: { expectedUpdatedAt: string },
    ): Promise<TaskActionResult & { updatedAt: string }> {
      return apiPost(`/tasks/${id}/indicators/withdraw`, body);
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
      options?: { skipErrorMessage?: boolean },
    ): Promise<{ id: string; updatedCount: number }> {
      return apiPut(`/tasks/${id}/actual-value`, body, options);
    },

    // 自评
    /** POST /tasks/:id/self-eval — 员工提交自评 */
    submitSelfEval(
      id: string,
      body: SubmitSelfEvalBody,
      options?: { skipErrorMessage?: boolean },
    ): Promise<TaskActionResult> {
      return apiPost(`/tasks/${id}/self-eval`, body, options);
    },

    // 主管评分
    /** POST /tasks/:id/manager-score — 提交主管评分 */
    submitManagerScore(
      id: string,
      body: SubmitManagerScoreBody,
    ): Promise<TaskActionResult> {
      return apiPost(`/tasks/${id}/manager-score`, body);
    },

    /** PUT /tasks/:id/manager-evaluation-draft — 保存主管评分草稿。 */
    saveManagerEvaluationDraft(
      id: string,
      body: SaveManagerEvaluationDraftBody,
    ): Promise<TaskActionResult> {
      return apiPut(`/tasks/${id}/manager-evaluation-draft`, body);
    },

    /** POST /tasks/:id/manager-score/withdraw — 撤回主管评分。 */
    withdrawManagerScore(
      id: string,
      body: WithdrawManagerScoreBody,
    ): Promise<TaskActionResult> {
      return apiPost(`/tasks/${id}/manager-score/withdraw`, body);
    },

    // 部门复核
    /** POST /tasks/:id/dept-review — 部门复核 */
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
}

export const tasksApi = createTasksApi(http);
