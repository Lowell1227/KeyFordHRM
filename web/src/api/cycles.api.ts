import http from './http';
import type {
  Paginated,
  AssessmentCycle,
  CycleQuery,
  CreateCycleBody,
  UpdateCycleBody,
  UpdateDeadlinesBody,
  PublishResultsBody,
  PublishResultsResult,
  LaunchPreflightResult,
  CycleSchedulePreview,
  CycleNotificationMode,
  DingtalkNotificationSettings,
  CyclePeriodSchedule,
} from '@/types/api.types';
import type { CycleType, ScoringFrequency } from '@/types/enums';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

function apiDelete<T>(url: string): Promise<T> {
  return http.delete(url) as unknown as Promise<T>;
}

export const cyclesApi = {
  /** GET /cycles — 查询周期列表（hr/system_admin/vp/chairman 可访问） */
  findAll(query?: CycleQuery): Promise<Paginated<AssessmentCycle>> {
    return apiGet('/cycles', query as Record<string, unknown>);
  },

  /** GET /cycles/mine — 已开放且与本人或直属团队任务相关的周期 */
  findMine(): Promise<AssessmentCycle[]> {
    return apiGet('/cycles/mine');
  },

  /** GET /cycles/:id — 周期详情 */
  findOne(id: string): Promise<AssessmentCycle> {
    return apiGet(`/cycles/${id}`);
  },

  previewSchedule(body: {
    type: CycleType;
    scoringFrequency?: ScoringFrequency;
    startDate: string;
    endDate: string;
    schedules?: CyclePeriodSchedule[];
  }): Promise<CycleSchedulePreview> {
    return apiPost('/cycles/schedule-preview', body);
  },

  /** POST /cycles — 创建周期（限 hr/system_admin） */
  create(body: CreateCycleBody): Promise<AssessmentCycle> {
    return apiPost('/cycles', body);
  },

  /** PATCH /cycles/:id — 更新草稿周期完整计划（限 hr/system_admin） */
  update(id: string, body: UpdateCycleBody): Promise<AssessmentCycle> {
    return apiPatch(`/cycles/${id}`, body);
  },

  /** DELETE /cycles/:id — 删除草稿周期（限 hr/system_admin） */
  remove(id: string): Promise<{ id: string }> {
    return apiDelete(`/cycles/${id}`);
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
   * 会为参与员工生成空白目标任务，可能耗时较长，调用方需加 loading。
   */
  launch(id: string, body: { expectedPlanHash: string; overrideReason?: string }): Promise<AssessmentCycle> {
    return apiPost(`/cycles/${id}/launch`, body);
  },

  preflight(id: string): Promise<LaunchPreflightResult> {
    return apiGet(`/cycles/${id}/preflight`);
  },

  schedule(id: string, expectedPlanHash: string): Promise<{
    cycleId: string;
    status: 'scheduled';
    goalSettingOpenAt: string | null;
    participantCount: number;
    templateCount: number;
  }> {
    return apiPost(`/cycles/${id}/schedule`, { expectedPlanHash });
  },

  cancelSchedule(id: string): Promise<AssessmentCycle> {
    return apiPost(`/cycles/${id}/schedule/cancel`);
  },

  review(id: string, action: 'approve' | 'reject', comment?: string): Promise<AssessmentCycle> {
    return apiPost(`/cycles/${id}/review`, { action, comment });
  },

  updateNotificationMode(id: string, notificationMode: CycleNotificationMode): Promise<AssessmentCycle> {
    return apiPatch(`/cycles/${id}/notification-mode`, { notificationMode });
  },

  getDingtalkNotificationSettings(): Promise<DingtalkNotificationSettings> {
    return apiGet('/notification-settings/dingtalk');
  },

  updateDingtalkNotificationSettings(enabled: boolean): Promise<DingtalkNotificationSettings> {
    return apiPatch('/notification-settings/dingtalk', { enabled });
  },

  /** POST /cycles/:id/publish — HR 批量公示结果 */
  publishResults(id: string, body: PublishResultsBody): Promise<PublishResultsResult> {
    return apiPost(`/cycles/${id}/publish`, body);
  },
};
