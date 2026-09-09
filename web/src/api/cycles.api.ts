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
  CycleParticipantRecord,
  CycleSchedulePreview,
  CycleNotificationMode,
  DingtalkNotificationSettings,
  CyclePeriodSchedule,
  PerformanceCycleContext,
} from '@/types/api.types';
import type { CycleType, ScoringFrequency } from '@/types/enums';

export interface CycleParticipantCandidate {
  id: string;
  name: string;
  employeeNo: string | null;
  deptId: string | null;
  deptName: string | null;
  position: string | null;
}

export interface CycleParticipantPreview extends Paginated<CycleParticipantCandidate> {
  departmentCount: number;
}

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
  previewParticipants(body: {
    scope: 'all' | 'custom';
    departmentIds: string[];
    userIds: string[];
    excludedDepartmentIds: string[];
    excludedUserIds: string[];
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<CycleParticipantPreview> {
    return apiPost('/cycles/participant-preview', body);
  },

  findParticipantCandidates(query: { keyword?: string; ids?: string[]; page?: number; pageSize?: number } = {}): Promise<Paginated<CycleParticipantCandidate>> {
    return apiGet('/cycles/participant-candidates', { ...query, ids: query.ids?.join(',') });
  },

  /** GET /cycles — 查询周期列表（hr/system_admin/vp/chairman 可访问） */
  findAll(query?: CycleQuery): Promise<Paginated<AssessmentCycle>> {
    return apiGet('/cycles', query as Record<string, unknown>);
  },

  /** 管理视图的完整周期选项，避免首屏分页遗漏历史周期。 */
  async findAllOptions(query: Omit<CycleQuery, 'page' | 'pageSize'> = {}): Promise<AssessmentCycle[]> {
    const items: AssessmentCycle[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await apiGet<Paginated<AssessmentCycle>>('/cycles', { ...query, page, pageSize: 100 });
      items.push(...result.items);
      total = result.total;
      page += 1;
    } while (items.length < total);
    return items;
  },

  /** GET /cycles/mine — 已开放且与本人或直属团队任务相关的周期 */
  findMine(): Promise<AssessmentCycle[]> {
    return apiGet('/cycles/mine');
  },

  /** 已开放且存在 owner 冻结任务的正式目标跟进上下文。 */
  findTrackingContexts(ownerId: string): Promise<PerformanceCycleContext[]> {
    return apiGet('/cycles/tracking-contexts', { ownerId });
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
    goalSettingOpenAt?: string;
    deadlineIndicatorSetting?: string;
    deadlineIndicatorConfirm?: string;
    deadlineHrCalibration?: string;
    deadlineApproval?: string;
    deadlinePublish?: string;
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

  participantRecord(id: string): Promise<CycleParticipantRecord> {
    return apiGet(`/cycles/${id}/participant-record`);
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

  review(
    id: string,
    action: 'approve' | 'reject',
    expectedPlanVersion: number,
    comment?: string,
  ): Promise<AssessmentCycle> {
    return apiPost(`/cycles/${id}/review`, { action, expectedPlanVersion, comment });
  },

  remindReview(id: string): Promise<{
    recipientCount: number;
    reminderAvailableAt: string;
  }> {
    return apiPost(`/cycles/${id}/review-reminder`, {});
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
