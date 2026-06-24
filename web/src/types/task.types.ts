import type { TaskDetail, IndicatorInstance, GradeResult, TaskListItem } from './api.types';
import type { TaskStatus, PerfGrade, FlowNodeType } from './enums';

/**
 * 任务流节点：用于驱动任务详情页步骤条/操作按钮。
 * 每个节点对应一个可执行或已完成的业务动作。
 */
export interface TaskFlowNode {
  key: FlowNodeType;
  label: string;
  status: 'pending' | 'active' | 'done';
  completedAt?: string;
  actorName?: string;
}

/**
 * 任务视图模式：区分员工/主管/HR/审批人等不同视角。
 */
export type TaskViewMode = 'employee' | 'manager' | 'dept_head' | 'hr' | 'approver' | 'admin';

/**
 * 任务可执行操作集合。
 * UI 层根据这些布尔值渲染对应按钮。
 */
export interface TaskActions {
  canSetIndicator: boolean;
  canConfirmIndicator: boolean;
  canSelfEval: boolean;
  canManagerScore: boolean;
  canDeptReview: boolean;
  canHrCalibrate: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canAppeal: boolean;
  canConfirmResult: boolean;
  canExempt: boolean;
  canViewManagerScore: boolean;
}

/**
 * 任务状态变更事件，用于 useTaskFlow。
 */
export interface TaskStatusChange {
  from: TaskStatus;
  to: TaskStatus;
  actorId?: string;
  actorName?: string;
  comment?: string;
  timestamp: string;
}

/**
 * 评分输入模型（ScoreInput 组件用）。
 */
export interface ScoreInputModel {
  value?: number;
  comment?: string;
}

/**
 * 指标行在自评/主管评分阶段的编辑模型。
 */
export interface IndicatorScoreRow extends IndicatorInstance {
  selfScoreInput?: number;
  selfCommentInput?: string;
  managerScoreInput?: number;
  managerCommentInput?: string;
}

/**
 * 任务详情聚合，用于 task.store 共享。
 */
export interface TaskDetailViewModel extends TaskDetail {
  flowNodes: TaskFlowNode[];
  actions: TaskActions;
  changes: TaskStatusChange[];
  viewMode: TaskViewMode;
}

/**
 * 公示可见字段配置项元数据。
 */
export interface VisibleFieldMeta {
  key: keyof NonNullable<GradeResult> | 'indicatorScores' | 'totalScore' | 'grade' | 'coefficient';
  label: string;
  defaultOn: boolean;
}

/**
 * 导出任务查询参数（用于报表/导出）。
 */
export interface TaskExportQuery {
  cycleId?: string;
  deptId?: string;
  status?: TaskStatus;
  keyword?: string;
}

/**
 * 任务草稿状态：指标制定阶段暂存。
 */
export interface IndicatorDraft {
  taskId: string;
  instances: IndicatorInstance[];
  savedAt: string;
}
