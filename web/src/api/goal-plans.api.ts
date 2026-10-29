import http from './http';
import type {
  AssessmentTask,
  IndicatorInstance,
  FlowRecord,
  Paginated,
  CurrentUser,
} from '@/types/api.types';
export type GoalScope = 'mine' | 'review' | 'monitor';
export interface GoalPlanItem extends AssessmentTask {
  goalWorkflowVersion: number;
  currentStep:
    | 'employee_drafting'
    | 'manager_review'
    | 'department_review'
    | 'employee_confirmation'
    | 'leader_review'
    | 'effective'
    | 'exempt';
  currentHandlerId: string | null;
  currentHandlerName: string | null;
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    canConfirm: boolean;
    canReject: boolean;
  };
}
export type GoalIndicator = Omit<
  IndicatorInstance,
  | 'taskId'
  | 'actualValue'
  | 'actualNote'
  | 'selfScore'
  | 'selfComment'
  | 'managerScore'
  | 'managerComment'
  | 'extraScores'
  | 'finalScore'
>;
export interface GoalPlanDetail extends GoalPlanItem {
  indicatorInstances: GoalIndicator[];
  flowRecords: FlowRecord[];
}
export function canMonitorGoals(user: CurrentUser | null): boolean {
  return (
    user?.sysRole === 'system_admin' ||
    user?.systemPermission === 'hr_admin' ||
    (user?.sysRole === 'hr_user' &&
      !!user.hrCapabilities?.includes('cycle_plan_edit') &&
      user.hrCapabilities.includes('performance_publish'))
  );
}
export const GOAL_STEP_LABELS: Record<GoalPlanItem['currentStep'], string> = {
  employee_drafting: '员工填写目标',
  manager_review: '待绩效上级审核',
  department_review: '待部门负责人审核',
  employee_confirmation: '待员工确认',
  leader_review: '待分管领导审核',
  effective: '目标已生效',
  exempt: '已豁免',
};
export const goalPlansApi = {
  findAll(params: {
    scope: GoalScope;
    cycleId?: string;
    deptId?: string;
    employeeName?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<GoalPlanItem>> {
    return http.get('/goal-plans', { params });
  },
  options(scope: GoalScope): Promise<{
    cycles: { id: string; name: string }[];
    departments: { id: string; name: string }[];
  }> {
    return http.get('/goal-plans/options', { params: { scope } });
  },
  findOne(id: string): Promise<GoalPlanDetail> {
    return http.get(`/goal-plans/${id}`);
  },
};
